/**
 * Moving one landlord's business data between the shared D1 and the landlord's own store, with proof
 * that nothing was lost: row counts and SHA-256 of every row per table, plus invoice totals per month.
 * Reading and writing tenant tables in the shared D1 is deliberate here (migration only).
 *
 * Safety rules, in order of importance:
 *  - The only mutual exclusion is the compare-and-set 'd1' -> 'migrating' (rollback: 'do' -> 'migrating').
 *    Every later transition is a compare-and-set that also names this run's lock (`ownedLock`), so a run
 *    whose lock expired or was unlocked can never switch to 'do' (or back), and never resets a store that
 *    some other run or the live landlord may be using.
 *  - Any failure while holding the lock is fatal: the destination is emptied (best effort) and the switch
 *    goes back, with the error in the report. A store call that fails comes back as a value, never as an
 *    exception across the RPC boundary.
 *  - D1 is never emptied before the store's rows are in memory, and the copy back into D1 is one atomic batch.
 */
import type { Env } from '../app.ts';
import { getStorage, ROLLBACK_NOTE, setStorage, type Backend } from '../central/directory.ts';
import { syncLegacySheets } from '../cron.ts';
import { replayDeferred } from '../payments/settle.ts';
import { tenantStub } from '../tenant/route.ts';
import { TENANT_TABLES, type SqlValue, type TenantTable } from '../tenant/schema.ts';
import type { TenantStore } from '../tenant/store.ts';
import { digestRows, ownerRowsFromD1 } from './digest.ts';

type Row = Record<string, SqlValue>;
type Store = DurableObjectStub<TenantStore>;

export interface TableReport { table: string; d1Count: number; doCount: number; d1Sha: string; doSha: string; ok: boolean }
export interface MonthReport { month: string; d1Total: number; doTotal: number; d1Paid: number; doPaid: number; ok: boolean }

export type MigrationErrorCode =
  | 'LANDLORD_NOT_FOUND'
  | 'MIGRATION_RUNNING' // another run holds the lock
  | 'ALREADY_MIGRATED' // already on the landlord's own store
  | 'NOT_MIGRATED' // rollback of a landlord that is not on the store
  | 'STORE_IN_USE' // clear-store while the landlord is on, or being moved to, the store
  | 'SHARED_BANK_ACCOUNT' // house-less payments cannot be told apart between landlords
  | 'VERIFY_FAILED' // copied data does not match
  | 'LOCK_LOST' // the lock ran out or was unlocked while the run was working
  | 'MIGRATION_FAILED'; // anything else that went wrong

export interface MigrationReport {
  ownerId: number;
  mode: 'dry-run' | 'migrate' | 'rollback';
  ok: boolean;
  tables: TableReport[];
  months: MonthReport[];
  deferredReplayed: number;
  lockedMs: number;
  error?: string;
  errorCode?: MigrationErrorCode;
  /** Payments without a house that no landlord's bank account matches (they stay in D1 for nobody). Informational. */
  unmatchedPayments?: number;
  /** Steps after the switch that failed without undoing it (the cron picks the work up again). */
  warnings?: string[];
}

/** Steps a test can interleave with a run; the API never passes any. */
export interface MigrateHooks {
  afterReset?: () => Promise<void>;
  afterCopy?: () => Promise<void>;
  beforeFlip?: () => Promise<void>;
  afterRestore?: () => Promise<void>;
  /** After the drain wait, before the first read. */
  afterDrain?: () => Promise<void>;
}

interface RunOptions { hooks?: MigrateHooks; drainMs?: number }

const PAGE = 200;
const LOCK_MS = 10 * 60_000;
/**
 * After the lock is taken, wait this long before the first read: a handler that picked the old backend just
 * before the lock can still be writing (a Sheet fetch inside settleRent takes seconds). Well inside the lock.
 */
export const DRAIN_MS = 15_000;
/** Tests set `config.drainMs = 0`; a run can also be given `drainMs` directly. */
export const config = { drainMs: DRAIN_MS };
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** AUTOINCREMENT tables of a store (residents get their ids from the central index). */
const SEQUENCE_TABLES = ['rooms', 'invoices', 'meter_readings', 'payments', 'notifications'];
const OWNER_ID_BASE = 1_000_000_000;

const GENERATION = 1_000_000_000_000;

/**
 * The first id a landlord's store may hand out: the smallest `ownerId * 1e9 + k * 1e12` (k >= 0) strictly above
 * `maxId`, the highest id of that table anywhere in the shared D1. Each (landlord, generation) range is its own,
 * disjoint from every other landlord's and far above what D1's own allocator reaches, so a store's new ids can
 * never meet an id D1 hands out later; a re-migration simply moves to the next generation.
 */
export function idFloor(ownerId: number, maxId: number): number {
  // ownerId * 1e9 and the generation step 1e12 only stay disjoint across landlords while ownerId < 1000.
  if (!Number.isInteger(ownerId) || ownerId < 1 || ownerId >= 1000)
    throw new Error(`Mã chủ trọ ${ownerId} nằm ngoài giới hạn 1–999 của dải id riêng; không thể chuyển sang kho riêng.`);
  const base = ownerId * OWNER_ID_BASE;
  const k = base > maxId ? 0 : Math.floor((maxId - base) / GENERATION) + 1;
  const floor = base + k * GENERATION;
  if (!Number.isSafeInteger(floor) || floor + GENERATION > Number.MAX_SAFE_INTEGER)
    throw new Error(`Hết dải id cho chủ trọ ${ownerId} (id lớn nhất hiện có: ${maxId}); không thể cấp thêm dải mới.`);
  return floor;
}

/** The next id of each AUTOINCREMENT table in a landlord's store (see idFloor); only ever raised by the store. */
async function sequenceFloors(env: Env, ownerId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of SEQUENCE_TABLES) {
    // D1's allocator may sit above MAX(id) (rows deleted at the top): the floor must clear both.
    const row = await env.DB
      .prepare(`SELECT MAX(COALESCE((SELECT MAX(id) FROM ${t}), 0), COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?1), 0)) AS m`)
      .bind(t)
      .first<{ m: number }>();
    out[t] = idFloor(ownerId, row?.m ?? 0);
  }
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mask = (account: string) => `••${account.slice(-4)}`;

function blank(ownerId: number, mode: MigrationReport['mode']): MigrationReport {
  return { ownerId, mode, ok: false, tables: [], months: [], deferredReplayed: 0, lockedMs: 0 };
}

function refuse(r: MigrationReport, errorCode: MigrationErrorCode, error: string): MigrationReport {
  return { ...r, ok: false, errorCode, error };
}

// ---------------------------------------------------------------------------
// Checks before anything is touched
// ---------------------------------------------------------------------------

async function ownerExists(env: Env, ownerId: number): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM staff WHERE id = ? AND role = 'owner'`).bind(ownerId).first());
}

/**
 * Payments without a house are told apart by the bank account they came in on. When that account is
 * declared by houses of more than one landlord the owner of such a payment is unknowable: refuse.
 */
async function sharedBankAccounts(env: Env, ownerId: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.account_no FROM payments p
      WHERE p.house_id IS NULL
        AND p.account_no IN (SELECT bank_account_no FROM houses WHERE owner_id = ?1 AND bank_account_no IS NOT NULL)
        AND (SELECT COUNT(DISTINCT owner_id) FROM houses h WHERE h.bank_account_no = p.account_no) > 1`
  ).bind(ownerId).all<{ account_no: string }>();
  return results.map((r) => r.account_no);
}

async function unmatchedPayments(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payments
      WHERE house_id IS NULL AND (account_no IS NULL OR account_no NOT IN (SELECT bank_account_no FROM houses WHERE bank_account_no IS NOT NULL))`
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Null when the move may start; otherwise the refusal. Also fills the informational count. */
async function preflight(env: Env, ownerId: number, r: MigrationReport): Promise<MigrationReport | null> {
  if (!(await ownerExists(env, ownerId))) return refuse(r, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  const shared = await sharedBankAccounts(env, ownerId);
  if (shared.length)
    return refuse(r, 'SHARED_BANK_ACCOUNT',
      `Tài khoản ngân hàng ${shared.map(mask).join(', ')} được khai báo ở nhà của nhiều chủ trọ, nên các khoản tiền chưa gắn căn không chia được. Cần xử lý tay trước khi chuyển.`);
  r.unmatchedPayments = await unmatchedPayments(env);
  return null;
}

// ---------------------------------------------------------------------------
// Copy and compare
// ---------------------------------------------------------------------------

/** Copy this landlord's rows from D1 into the store, parents first, 200 rows a time, ids kept. */
async function copyToStore(env: Env, ownerId: number, store: Store): Promise<void> {
  for (const t of TENANT_TABLES) {
    for (let offset = 0; ; offset += PAGE) {
      const rows = await ownerRowsFromD1(env, ownerId, t, offset, PAGE);
      if (rows.length) {
        const r = await store.importRows(t.name, rows);
        if (!r.ok) throw new Error(`${t.name}: ${r.error}`);
      }
      if (rows.length < PAGE) break;
    }
  }
}

async function d1Digest(env: Env, ownerId: number, t: TenantTable, lessIds?: Set<number>): Promise<{ count: number; sha: string }> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await ownerRowsFromD1(env, ownerId, t, offset, PAGE);
    // Rollback: house-less payments count only when the store has them (a bank account shared with another landlord brings foreign ones).
    rows.push(...(t.name === 'payments' && lessIds ? page.filter((x) => x.house_id !== null || lessIds.has(x.id as number)) : page));
    if (page.length < PAGE) break;
  }
  return { count: rows.length, sha: await digestRows(rows, t.pk) };
}

const MONTH_SQL = `SELECT month, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(CASE WHEN status IN ('paid', 'cash') THEN 1 ELSE 0 END), 0) AS paid FROM invoices`;

async function storeMonths(store: Store): Promise<Map<string, { total: number; paid: number }>> {
  const r = await store.query([{ sql: `${MONTH_SQL} GROUP BY month`, params: [], mode: 'all' }], false);
  if (!r.ok) throw new Error(`invoices by month: ${r.error}`);
  return new Map(r.results[0].results.map((x) => [String(x.month), { total: Number(x.total), paid: Number(x.paid) }]));
}

async function d1Months(env: Env, ownerId: number): Promise<Map<string, { total: number; paid: number }>> {
  const { results } = await env.DB.prepare(`${MONTH_SQL} WHERE house_id IN (SELECT id FROM houses WHERE owner_id = ?) GROUP BY month`)
    .bind(ownerId).all<{ month: string; total: number; paid: number }>();
  return new Map(results.map((x) => [x.month, { total: x.total, paid: x.paid }]));
}

/** Compare D1's rows of this landlord with the store: per table count + SHA-256, per month invoice totals and paid counts. */
async function compare(env: Env, ownerId: number, store: Store, lessIds?: Set<number>): Promise<{ ok: boolean; tables: TableReport[]; months: MonthReport[] }> {
  const tables: TableReport[] = [];
  for (const t of TENANT_TABLES) {
    const d1 = await d1Digest(env, ownerId, t, lessIds);
    const doSide = await store.digest(t.name);
    if (!doSide.ok) throw new Error(`${t.name}: ${doSide.error}`);
    tables.push({ table: t.name, d1Count: d1.count, doCount: doSide.count, d1Sha: d1.sha, doSha: doSide.sha256, ok: d1.count === doSide.count && d1.sha === doSide.sha256 });
  }
  const [a, b] = [await d1Months(env, ownerId), await storeMonths(store)];
  const months: MonthReport[] = [...new Set([...a.keys(), ...b.keys()])].sort().map((month) => {
    const x = a.get(month) ?? { total: 0, paid: 0 };
    const y = b.get(month) ?? { total: 0, paid: 0 };
    return { month, d1Total: x.total, doTotal: y.total, d1Paid: x.paid, doPaid: y.paid, ok: x.total === y.total && x.paid === y.paid };
  });
  return { ok: tables.every((t) => t.ok) && months.every((m) => m.ok), tables, months };
}

// ---------------------------------------------------------------------------
// Giving up
// ---------------------------------------------------------------------------

/**
 * Undo a failed run. The store is emptied only while nobody else can be using it: when this run still
 * holds its lock, or the switch is back on d1 (a store nobody reads). A switch that is now 'do' or held
 * by another run is left alone entirely. The switch goes back only if this run's lock is still the one held.
 */
async function giveUp(env: Env, ownerId: number, store: Store | null, token: number, opts: { resetStore: boolean; to: Backend; note: string }): Promise<void> {
  const now = await getStorage(env.DB, ownerId).catch(() => null);
  if (!now) return;
  const mine = now.backend === 'migrating' && now.lockExpiresAt === token;
  if (opts.resetStore && (mine || now.backend === 'd1')) {
    try {
      await (store ?? tenantStub(env, ownerId)).reset();
    } catch (e) {
      console.warn('[migrate] reset after failure', ownerId, e); // the switch must still go back
    }
  }
  if (mine) {
    await setStorage(env.DB, ownerId, opts.to, { expect: 'migrating', ownedLock: token, note: opts.note, keepMigratedAt: true })
      .catch((e) => console.warn('[migrate] switch back', ownerId, e));
  }
}

// ---------------------------------------------------------------------------
// Dry run and migrate
// ---------------------------------------------------------------------------

/** Dry run: copy into `dryrun:owner:<id>` and compare. No lock, no switch, the real store is never touched. */
async function dryRun(env: Env, ownerId: number, r: MigrationReport, hooks: MigrateHooks): Promise<MigrationReport> {
  if ((await getStorage(env.DB, ownerId)).backend === 'do')
    return refuse(r, 'ALREADY_MIGRATED', 'Chủ trọ này đã dùng kho riêng; dữ liệu D1 cũ không còn được cập nhật nên không chạy thử được.');
  const store = tenantStub(env, ownerId, { dryRun: true });
  try {
    await store.reset();
    await hooks.afterReset?.();
    await copyToStore(env, ownerId, store);
    await hooks.afterCopy?.();
    const c = await compare(env, ownerId, store);
    return { ...r, ok: c.ok, tables: c.tables, months: c.months, ...(c.ok ? {} : { errorCode: 'VERIFY_FAILED' as const, error: 'Dữ liệu chép sang kho thử không khớp D1.' }) };
  } catch (e) {
    return refuse(r, 'MIGRATION_FAILED', message(e));
  } finally {
    await store.reset().catch(() => {}); // the report is all that is kept
  }
}

/**
 * Move one landlord to their own store (spec §7.1). `dryRun` copies into the trial store only.
 * Steps: lock writes (d1 -> migrating, 10 minutes) -> empty a leftover store -> copy -> compare ->
 * switch to 'do' -> book the transfers that waited -> re-read the old Sheet once.
 */
export async function migrateOwner(env: Env, ownerId: number, opts: RunOptions & { dryRun?: boolean } = {}): Promise<MigrationReport> {
  const r = blank(ownerId, opts.dryRun ? 'dry-run' : 'migrate');
  const hooks = opts.hooks ?? {};
  let held: { token: number } | null = null;
  try {
    const refused = await preflight(env, ownerId, r);
    if (refused) return refused;
    if (opts.dryRun) return await dryRun(env, ownerId, r, hooks);

    const token = Date.now() + LOCK_MS;
    if (!(await setStorage(env.DB, ownerId, 'migrating', { expect: 'd1', lockUntil: token, note: 'migrate' }))) {
      const { backend } = await getStorage(env.DB, ownerId);
      return backend === 'do'
        ? refuse(r, 'ALREADY_MIGRATED', 'Chủ trọ này đã dùng kho riêng.')
        : refuse(r, 'MIGRATION_RUNNING', 'Đang có một lần chuyển dữ liệu khác của chủ trọ này.');
    }
    held = { token }; // from here on the outer catch releases the lock
    const startedAt = Date.now();
    const store = tenantStub(env, ownerId);
    const stop = async (code: MigrationErrorCode, error: string, resetStore = true): Promise<MigrationReport> => {
      await giveUp(env, ownerId, store, token, { resetStore, to: 'd1', note: `migrate failed: ${code}` });
      return { ...r, ok: false, errorCode: code, error, lockedMs: Date.now() - startedAt };
    };

    let compared: Awaited<ReturnType<typeof compare>>;
    try {
      // Let handlers that picked the old backend just before the lock finish their writes before anything is read.
      await sleep(opts.drainMs ?? config.drainMs);
      await hooks.afterDrain?.();
      // The switch is 'd1' (we just took the lock from it), so whatever the store holds, even a finished
      // migration's marker left by a crash, is not serving traffic: empty it.
      await store.reset();
      await store.setMeta('owner_id', String(ownerId));
      await hooks.afterReset?.();
      await copyToStore(env, ownerId, store);
      await hooks.afterCopy?.();
      compared = await compare(env, ownerId, store);
      if (!compared.ok) {
        const bad = [...compared.tables.filter((t) => !t.ok).map((t) => t.table), ...compared.months.filter((m) => !m.ok).map((m) => `tháng ${m.month}`)];
        return { ...(await stop('VERIFY_FAILED', `Đối chiếu không khớp: ${bad.join(', ')}.`)), tables: compared.tables, months: compared.months };
      }
      await hooks.beforeFlip?.();
      // After reset and copy (reset clears the counters), before the switch. Not a data write: last_write_at stays.
      const seq = await store.setSequences(await sequenceFloors(env, ownerId));
      if (!seq.ok) throw new Error(`sequences: ${seq.error}`);
      await store.setMeta('migrated_from', 'd1');
      await store.setMeta('migrated_at', String(Date.now()));
    } catch (e) {
      return await stop('MIGRATION_FAILED', message(e));
    }

    // Only the run that still holds its own, unexpired lock may switch.
    let flipped = false;
    try {
      flipped = await setStorage(env.DB, ownerId, 'do', { expect: 'migrating', ownedLock: token, note: 'migrate' });
    } catch (e) {
      return await stop('MIGRATION_FAILED', message(e));
    }
    if (!flipped) return { ...(await stop('LOCK_LOST', 'Khoá ghi đã hết hạn hoặc bị mở trong lúc chuyển; chưa bật kho riêng.')), tables: compared.tables, months: compared.months };

    const out: MigrationReport = { ...r, ok: true, tables: compared.tables, months: compared.months, lockedMs: Date.now() - startedAt };
    const warnings: string[] = [];
    try {
      out.deferredReplayed = await replayDeferred(env, ownerId);
    } catch (e) {
      warnings.push(`Chưa ghi hết tiền về bị hoãn (cron 10 phút sẽ ghi tiếp): ${message(e)}`);
    }
    try {
      await syncLegacySheets(env, ownerId);
    } catch (e) {
      warnings.push(`Chưa chép lại từ Sheet cũ: ${message(e)}`);
    }
    if (warnings.length) out.warnings = warnings;
    return out;
  } catch (e) {
    if (held) await giveUp(env, ownerId, null, held.token, { resetStore: true, to: 'd1', note: 'migrate failed: MIGRATION_FAILED' });
    return refuse(r, 'MIGRATION_FAILED', message(e));
  }
}

/**
 * Empty the landlord's live store `owner:<id>` by hand (leftover of a crashed run). Only while the switch is
 * 'd1': a store the switch does not point at serves nobody. Takes the lock so no run starts meanwhile.
 */
export async function clearStore(env: Env, ownerId: number): Promise<{ ok: boolean; errorCode?: MigrationErrorCode; error?: string }> {
  if (!(await ownerExists(env, ownerId))) return { ok: false, errorCode: 'LANDLORD_NOT_FOUND', error: 'Không tìm thấy chủ trọ.' };
  const token = Date.now() + LOCK_MS;
  if (!(await setStorage(env.DB, ownerId, 'migrating', { expect: 'd1', lockUntil: token, note: 'clear-store' })))
    return { ok: false, errorCode: 'STORE_IN_USE', error: 'Chủ trọ này đang dùng kho riêng hoặc đang được chuyển; chỉ xoá kho khi công tắc ở D1.' };
  try {
    await tenantStub(env, ownerId).reset();
  } catch (e) {
    await setStorage(env.DB, ownerId, 'd1', { expect: 'migrating', ownedLock: token, note: 'clear-store failed' }).catch(() => {});
    return { ok: false, errorCode: 'MIGRATION_FAILED', error: message(e) };
  }
  await setStorage(env.DB, ownerId, 'd1', { expect: 'migrating', ownedLock: token, note: 'store cleared' });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

const OWNER_HOUSE_IDS = 'SELECT id FROM houses WHERE owner_id = ?1';

/**
 * The statement that removes one landlord's rows of a table from D1. Payments without a house are never deleted
 * here: a bank account may be shared with another landlord, whose rows must survive; the store's own are put back by id.
 */
function deleteOwnerRows(env: Env, ownerId: number, t: TenantTable): D1PreparedStatement {
  let where: string;
  if (t.name === 'houses') where = 'owner_id = ?1';
  else if (t.name === 'payments') where = `house_id IN (${OWNER_HOUSE_IDS})`; // house-less ones: see restoreToD1
  else where = `house_id IN (${OWNER_HOUSE_IDS})`;
  return env.DB.prepare(`DELETE FROM ${t.name} WHERE ${where}`).bind(ownerId);
}

/**
 * Replace this landlord's rows in D1 with the store's. The store's rows are all read first; then ONE
 * atomic batch deletes the landlord's rows (children first) and inserts the store's (parents first), so
 * D1 either holds the old rows or the new ones, never half. A row whose id already belongs to another
 * landlord's row in the shared D1 makes the whole batch fail: nothing changes.
 */
async function restoreToD1(env: Env, ownerId: number, store: Store): Promise<void> {
  const data = new Map<string, Row[]>();
  for (const t of TENANT_TABLES) {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await store.exportTable(t.name, offset, PAGE);
      if (!page.ok) throw new Error(`${t.name}: ${page.error}`);
      rows.push(...page.rows);
      if (page.rows.length < PAGE) break;
    }
    data.set(t.name, rows);
  }
  const stmts: D1PreparedStatement[] = [...TENANT_TABLES].reverse().map((t) => deleteOwnerRows(env, ownerId, t));
  for (const t of TENANT_TABLES) {
    for (const row of data.get(t.name)!) {
      const cols = Object.keys(row);
      const verb = t.name === 'payments' && row.house_id === null ? 'INSERT OR REPLACE' : 'INSERT';
      stmts.push(env.DB.prepare(`${verb} INTO ${t.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])));
    }
  }
  await env.DB.batch(stmts);
}

/**
 * Bring a landlord back from their own store to D1 (spec §7.2). The store stays the truth until the very
 * end: no write since the switch -> D1 is still identical, verify and switch; otherwise lock writes, copy the
 * store back into D1 (atomically), verify, switch. Any failure returns the switch to 'do' (a rollback lock that
 * merely expires also goes back to 'do'). On success the store is emptied, so the next migration starts clean.
 */
export async function rollbackOwner(env: Env, ownerId: number, opts: RunOptions = {}): Promise<MigrationReport> {
  const r = blank(ownerId, 'rollback');
  const hooks = opts.hooks ?? {};
  let held: { token: number } | null = null;
  try {
    if (!(await ownerExists(env, ownerId))) return refuse(r, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const token = Date.now() + LOCK_MS;
    if (!(await setStorage(env.DB, ownerId, 'migrating', { expect: 'do', lockUntil: token, note: ROLLBACK_NOTE }))) {
      const { backend } = await getStorage(env.DB, ownerId);
      return backend === 'migrating'
        ? refuse(r, 'MIGRATION_RUNNING', 'Đang có một lần chuyển dữ liệu khác của chủ trọ này.')
        : refuse(r, 'NOT_MIGRATED', 'Chủ trọ này đang dùng D1, không có gì để quay lại.');
    }
    held = { token }; // from here on the outer catch releases the lock
    const startedAt = Date.now();
    const store = tenantStub(env, ownerId);
    const stop = async (code: MigrationErrorCode, error: string): Promise<MigrationReport> => {
      await giveUp(env, ownerId, store, token, { resetStore: false, to: 'do', note: `rollback failed: ${code}` });
      return { ...r, ok: false, errorCode: code, error, lockedMs: Date.now() - startedAt };
    };

    let compared: Awaited<ReturnType<typeof compare>>;
    try {
      // Let a write that began just before the lock land in the store before anything is read; after that
      // nothing writes to it any more, so this reading is final.
      await sleep(opts.drainMs ?? config.drainMs);
      await hooks.afterDrain?.();
      const info = await store.info();
      const untouched = info.migratedFrom === 'd1' && info.migratedAt !== null && (info.lastWriteAt === null || info.lastWriteAt <= info.migratedAt);
      // House-less payments count only when the store has them (a shared bank account brings another landlord's).
      const lessRes = await store.query([{ sql: `SELECT id FROM payments WHERE house_id IS NULL`, params: [], mode: 'all' }], false);
      if (!lessRes.ok) throw new Error(`payments: ${lessRes.error}`);
      const lessIds = new Set(lessRes.results[0].results.map((x) => x.id as number));
      compared = await compare(env, ownerId, store, lessIds); // the store against D1 as it is now
      if (!(untouched && compared.ok)) {
        await restoreToD1(env, ownerId, store);
        await hooks.afterRestore?.();
        compared = await compare(env, ownerId, store, lessIds);
      }
      if (!compared.ok) {
        const bad = compared.tables.filter((t) => !t.ok).map((t) => t.table);
        return { ...(await stop('VERIFY_FAILED', `Đối chiếu sau khi chép về D1 không khớp: ${bad.join(', ') || 'theo tháng'}.`)), tables: compared.tables, months: compared.months };
      }
      await hooks.beforeFlip?.();
    } catch (e) {
      return await stop('MIGRATION_FAILED', message(e));
    }

    let flipped = false;
    try {
      flipped = await setStorage(env.DB, ownerId, 'd1', { expect: 'migrating', ownedLock: token, note: 'rolled back' });
    } catch (e) {
      return await stop('MIGRATION_FAILED', message(e));
    }
    if (!flipped) return { ...(await stop('LOCK_LOST', 'Khoá ghi đã hết hạn hoặc bị mở trong lúc quay lại; vẫn dùng kho riêng.')), tables: compared.tables, months: compared.months };

    const out: MigrationReport = { ...r, ok: true, tables: compared.tables, months: compared.months, lockedMs: Date.now() - startedAt };
    try {
      await store.reset(); // D1 is verified equal: empty the store (point-in-time recovery can still bring it back)
    } catch (e) {
      out.warnings = [`Chưa xoá được kho riêng sau khi quay lại (lần chuyển sau sẽ tự xoá; hoặc dùng clear-store): ${message(e)}`];
    }
    try {
      out.deferredReplayed = await replayDeferred(env, ownerId);
    } catch (e) {
      (out.warnings ??= []).push(`Chưa ghi hết tiền về bị hoãn (cron 10 phút sẽ ghi tiếp): ${message(e)}`);
    }
    return out;
  } catch (e) {
    if (held) await giveUp(env, ownerId, null, held.token, { resetStore: false, to: 'do', note: 'rollback failed: MIGRATION_FAILED' });
    return refuse(r, 'MIGRATION_FAILED', message(e));
  }
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

/**
 * The Developer's "Mở khoá": end a lock now. A migration lock goes back to d1 (and the transfers that waited
 * are booked there); a rollback lock goes back to 'do', where the data still is. The run that held the lock
 * will find its lock gone and stop.
 */
export async function unlockOwner(env: Env, ownerId: number): Promise<{ ok: boolean; backend?: Backend; replayed?: number; error?: string }> {
  const row = await env.DB.prepare(`SELECT backend, note FROM tenant_storage WHERE owner_id = ?`).bind(ownerId).first<{ backend: Backend; note: string | null }>();
  if (row?.backend !== 'migrating') return { ok: false, error: 'Chủ trọ này không đang bị khoá.' };
  const to: Backend = row.note === ROLLBACK_NOTE ? 'do' : 'd1';
  if (!(await setStorage(env.DB, ownerId, to, { expect: 'migrating', note: 'unlocked', keepMigratedAt: true })))
    return { ok: false, error: 'Khoá đã được mở hoặc hết hạn.' };
  const replayed = await replayDeferred(env, ownerId).catch((e) => {
    console.warn('[migrate] replay after unlock', ownerId, e);
    return 0;
  });
  return { ok: true, backend: to, replayed };
}
