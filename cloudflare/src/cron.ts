/**
 * Scheduled jobs. Every job isolates failures per landlord / per house: one failing owner is logged
 * and never blocks the rest.
 */
import type { Env } from './app.ts';
import { createDraftsDetailed } from './billing/invoices.ts';
import { prepMonth, vnMonthAt } from './billing/period.ts';
import { isWorkerSource } from './billing/source.ts';
import { allHouses, getStorage, houseOwner, removeHouseDir, setHouseCounts } from './central/directory.ts';
import { purgeStaleAttempts } from './loginLimit.ts';
import { replayPendingDeferred } from './payments/settle.ts';
import { drainExportQueue } from './sheetExport.ts';
import { currentMonth, ensureMonthFresh, legacySheet, previousMonth, syncMonthFromSheet } from './sheetSync.ts';
import { TenantLockedError, tenantOfOwner } from './tenant/route.ts';

async function warn(env: Env, action: string, houseId: string | null, target: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO audit_log (actor, action, house_id, target) VALUES ('system', ?, ?, ?)`)
    .bind(action, houseId, target.slice(0, 500)).run().catch(() => {});
}

/** Re-reads this and last month from the old Sheet into the store of every landlord that owns one of its houses. */
export async function syncLegacySheets(env: Env, onlyOwner?: number, strict = false): Promise<void> {
  if (await isWorkerSource(env.DB)) return; // the Worker owns the invoices: no Sheet read
  const legacy = await legacySheet(env.DB);
  if (!legacy) return;
  const owners = new Set<number>();
  for (const h of legacy.houses) {
    const owner = await houseOwner(env.DB, h).catch(() => null);
    if (owner !== null) owners.add(owner);
  }
  const month = currentMonth();
  for (const ownerId of owners) {
    if (onlyOwner !== undefined && ownerId !== onlyOwner) continue;
    try {
      if ((await getStorage(env.DB, ownerId)).backend === 'migrating') continue;
      const tenant = await tenantOfOwner(env, ownerId);
      // strict (the final sync before the switch to worker): a read failure must surface, not be swallowed.
      for (const m of [month, previousMonth(month)]) {
        if (strict) await syncMonthFromSheet(env.DB, tenant, m);
        else await ensureMonthFresh(env.DB, tenant, m, 0);
      }
    } catch (err) {
      if (strict) throw err;
      console.warn('[cron] sheet sync', ownerId, err);
    }
  }
}

// Children first: foreign keys are on, in D1 and in a landlord's store alike.
const HOUSE_TABLES = ['house_fee_services', 'house_fee_months', 'house_services', 'payments', 'meter_readings', 'invoices', 'notifications', 'payment_gates', 'residents', 'rooms', 'house_rates'];

export interface PurgeOutcome {
  /** purged: the store's data is gone; busy: the landlord's store is locked (nothing changed); not_due: restored or no longer due; failed: the store step failed (nothing changed). */
  status: 'purged' | 'busy' | 'not_due' | 'missing' | 'failed';
  /** False when a step after the store failed: a warning is in the audit log and the nightly run / reconcile finishes it. */
  complete: boolean;
  counts: { rooms: number; residents: number; invoices: number; payments: number };
}

const NO_COUNTS = { rooms: 0, residents: 0, invoices: 0, payments: 0 };

/**
 * Removes one house for good: the landlord's store first, then the resident index, then the directory
 * (and the staff links that point at it). Shared by the daily cron (`onlyIfDue`: the grace period must be over,
 * checked again right before deleting) and the Developer's immediate delete (`force`). A later step that fails
 * leaves a warning in the audit log and the rest for the nightly reconcile / next run.
 */
export async function purgeHouse(
  env: Env,
  houseId: string,
  opts: { onlyIfDue?: boolean; beforeDelete?: (houseId: string) => Promise<void> } = {}
): Promise<PurgeOutcome> {
  const ownerId = await houseOwner(env.DB, houseId);
  if (ownerId === null) return { status: 'missing', complete: false, counts: NO_COUNTS };
  let counts = NO_COUNTS;
  try {
    if ((await getStorage(env.DB, ownerId)).backend === 'migrating') return { status: 'busy', complete: false, counts }; // retried on the next run
    const store = await tenantOfOwner(env, ownerId);
    await opts.beforeDelete?.(houseId);
    if (opts.onlyIfDue) {
      // The list the cron works from may be minutes old: a house restored meanwhile must survive, so look again right before deleting.
      const stillDue = await env.DB
        .prepare(`SELECT 1 FROM house_directory WHERE house_id = ? AND delete_after IS NOT NULL AND delete_after <= datetime('now')`)
        .bind(houseId)
        .first();
      if (!stillDue) return { status: 'not_due', complete: false, counts };
    }
    const n = await store
      .prepare(
        `SELECT (SELECT COUNT(*) FROM rooms WHERE house_id = ?1) AS rooms, (SELECT COUNT(*) FROM residents WHERE house_id = ?1) AS residents,
                (SELECT COUNT(*) FROM invoices WHERE house_id = ?1) AS invoices, (SELECT COUNT(*) FROM payments WHERE house_id = ?1) AS payments`
      )
      .bind(houseId)
      .first<PurgeOutcome['counts']>();
    if (n) counts = n;
    await store.batch([
      // Children without a house_id first: they are reached through their invoice or room.
      store.prepare(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE house_id = ?)`).bind(houseId),
      store.prepare(`DELETE FROM room_service_optouts WHERE room_id IN (SELECT id FROM rooms WHERE house_id = ?)`).bind(houseId),
      ...HOUSE_TABLES.map((t) => store.prepare(`DELETE FROM ${t} WHERE house_id = ?`).bind(houseId)),
      store.prepare(`DELETE FROM houses WHERE id = ?`).bind(houseId),
    ]);
  } catch (err) {
    if (err instanceof TenantLockedError) return { status: 'busy', complete: false, counts };
    console.warn('[cron] purge store', houseId, err);
    await warn(env, 'house_purge_warning', houseId, `store: ${String((err as Error)?.message ?? err)}`);
    return { status: 'failed', complete: false, counts };
  }
  // The store is empty now. If a later step fails, make sure the directory row is due so the nightly purge finishes the job.
  const markDue = () =>
    env.DB.prepare(`UPDATE house_directory SET status = 'inactive', delete_after = datetime('now') WHERE house_id = ? AND delete_after IS NULL`).bind(houseId).run().catch(() => {});
  try {
    await env.DB.prepare(`DELETE FROM resident_index WHERE house_id = ?`).bind(houseId).run();
  } catch (err) {
    await warn(env, 'house_purge_warning', houseId, `resident_index: ${String((err as Error)?.message ?? err)}`);
    await markDue();
    return { status: 'purged', complete: false, counts };
  }
  try {
    await env.DB.prepare(`DELETE FROM staff_houses WHERE house_id = ?`).bind(houseId).run();
    await removeHouseDir(env.DB, houseId);
  } catch (err) {
    await warn(env, 'house_purge_warning', houseId, `directory: ${String((err as Error)?.message ?? err)}`);
    await markDue();
    return { status: 'purged', complete: false, counts };
  }
  await env.DB.prepare(`INSERT INTO audit_log (actor, action, house_id) VALUES ('system', 'house_purged', ?)`).bind(houseId).run().catch(() => {});
  return { status: 'purged', complete: true, counts };
}

/** Removes the houses whose grace period is over, each through purgeHouse. */
export async function purgeDeletedHouses(env: Env, hooks: { beforeDelete?: (houseId: string) => Promise<void> } = {}): Promise<string[]> {
  const { results } = await env.DB
    .prepare(`SELECT house_id FROM house_directory WHERE delete_after IS NOT NULL AND delete_after <= datetime('now')`)
    .all<{ house_id: string }>();
  const purged: string[] = [];
  for (const { house_id: houseId } of results) {
    const r = await purgeHouse(env, houseId, { onlyIfDue: true, beforeDelete: hooks.beforeDelete });
    if (r.status === 'purged') purged.push(houseId);
  }
  return purged;
}

export interface ReconcileResult {
  countsFixed: number;
  indexMismatches: { residentId: number; problem: string }[];
  /** Directory vs the landlord's store (report only). */
  houseMismatches: { houseId: string; problem: string }[];
}

/**
 * Recomputes each house's room/resident counters from its landlord's store and compares the resident
 * index with the store's residents. Mismatches are only reported, never fixed. Saved in settings.last_reconcile.
 */
export async function reconcile(env: Env): Promise<ReconcileResult> {
  const out: ReconcileResult = { countsFixed: 0, indexMismatches: [], houseMismatches: [] };
  const houses = await allHouses(env.DB);
  // A landlord on their own store with no house in the directory is still checked (their store may hold houses the directory lacks).
  const { results: inDo } = await env.DB.prepare(`SELECT owner_id FROM tenant_storage WHERE backend = 'do'`).all<{ owner_id: number }>();
  const owners = [...new Set([...houses.map((h) => h.owner_id), ...inDo.map((r) => r.owner_id)])];
  for (const ownerId of owners) {
    try {
      if ((await getStorage(env.DB, ownerId)).backend === 'migrating') continue;
      const store = await tenantOfOwner(env, ownerId);
      for (const h of houses.filter((x) => x.owner_id === ownerId)) {
        const n = await store
          .prepare(
            `SELECT (SELECT COUNT(*) FROM rooms WHERE house_id = ?1 AND deleted_at IS NULL) AS rooms,
                    (SELECT COUNT(*) FROM residents WHERE house_id = ?1 AND status = 'approved' AND deleted_at IS NULL) AS residents`
          )
          .bind(h.house_id)
          .first<{ rooms: number; residents: number }>();
        if (n && (n.rooms !== h.room_count || n.residents !== h.resident_count)) {
          await setHouseCounts(env.DB, h.house_id, { rooms: n.rooms, residents: n.residents });
          out.countsFixed++;
        }
      }
      const { results: storeHouses } = await store
        .prepare(`SELECT id, name, status, delete_after, pay_no FROM houses WHERE owner_id = ?`)
        .bind(ownerId)
        .all<{ id: string; name: string; status: string; delete_after: string | null; pay_no: number | null }>();
      const inStoreHouses = new Map(storeHouses.map((x) => [x.id, x]));
      const ownDir = houses.filter((x) => x.owner_id === ownerId);
      for (const h of ownDir) {
        const x = inStoreHouses.get(h.house_id);
        if (!x) {
          out.houseMismatches.push({ houseId: h.house_id, problem: 'in directory but missing from store' });
          continue;
        }
        const diff = (['name', 'status', 'delete_after', 'pay_no'] as const)
          .filter((f) => (h[f] ?? null) !== (x[f] ?? null))
          .map((f) => `${f} (directory ${h[f] ?? 'null'}, store ${x[f] ?? 'null'})`);
        if (diff.length) out.houseMismatches.push({ houseId: h.house_id, problem: `differs: ${diff.join('; ')}` });
      }
      const dirIds = new Set(ownDir.map((x) => x.house_id));
      for (const x of storeHouses) if (!dirIds.has(x.id)) out.houseMismatches.push({ houseId: x.id, problem: 'in store but missing from directory' });
      let { results: stored } = await store
        .prepare(`SELECT id, house_id, deleted_at FROM residents`)
        .all<{ id: number; house_id: string; deleted_at: string | null }>();
      const ownHouses = new Set(houses.filter((x) => x.owner_id === ownerId).map((x) => x.house_id));
      stored = stored.filter((r) => ownHouses.has(r.house_id)); // the shared D1 also holds other landlords' rows
      const inStore = new Map(stored.map((r) => [r.id, r]));
      const { results: indexed } = await env.DB
        .prepare(`SELECT resident_id, house_id FROM resident_index WHERE owner_id = ?`)
        .bind(ownerId)
        .all<{ resident_id: number; house_id: string }>();
      const inIndex = new Set(indexed.map((r) => r.resident_id));
      for (const r of indexed) {
        const s = inStore.get(r.resident_id);
        if (!s) out.indexMismatches.push({ residentId: r.resident_id, problem: 'in index but missing from store' });
        else if (s.house_id !== r.house_id) out.indexMismatches.push({ residentId: r.resident_id, problem: `house differs (index ${r.house_id}, store ${s.house_id})` });
      }
      for (const s of stored) if (!s.deleted_at && !inIndex.has(s.id)) out.indexMismatches.push({ residentId: s.id, problem: 'in store but missing from index' });
    } catch (err) {
      console.warn('[cron] reconcile', ownerId, err);
    }
  }
  await env.DB
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('last_reconcile', ?, datetime('now'))
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify({ ranAt: new Date().toISOString(), ...out }))
    .run();
  return out;
}

const MONTH_MARK = 'month_started'; // settings key: 'YYYY-MM' when that month is fully started, 'YYYY-MM!n' after n failed tries
const PREP_MARK = 'month_prepared'; // same shape: the NEXT month whose drafts were made during the last 5 days of a month
const CATCHUP_TRIES = 6; // the frequent cron stops retrying a month after this many failed tries (about an hour)

const vnMonthOf = vnMonthAt; // Vietnam wall clock

/**
 * Switches every landlord to `month` (Vietnam month of `now`): the fee snapshot of each house (copy-forward from
 * the previous month) and a draft for every room with an approved resident. Old meter readings need no copying:
 * the old reading of a month is the previous month's new one, derived when the invoice is computed. Idempotent;
 * records the month as started in settings only when every landlord went through, so a failure is retried.
 */
async function startMonth(env: Env, month: string, tries = 0, markKey = MONTH_MARK): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT DISTINCT owner_id FROM house_directory`).all<{ owner_id: number }>();
  let made = 0;
  let failed = 0;
  for (const { owner_id } of results) {
    try {
      const r = await createDraftsDetailed(env, owner_id, month);
      made += r.made;
      failed += r.failed;
    } catch (err) {
      failed++;
      console.warn('[cron] monthly drafts', owner_id, err);
    }
  }
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .bind(markKey, failed ? `${month}!${tries + 1}` : month).run();
  return made;
}

/**
 * During the last 5 days of a month (Vietnam time) the landlord prepares the NEXT month: its fee snapshot and a DRAFT
 * for every room with an approved resident (drafts are invisible to residents; the month cannot be issued before day 1).
 * Same idempotent path as startMonth, with its own marker; the template is not mirrored (the current month still owns it).
 * `cheap`: read the marker first and do nothing when the month is already prepared (the 10-minute catch-up).
 */
async function prepareNextMonth(env: Env, now: number, cheap: boolean): Promise<number> {
  const month = prepMonth(now);
  if (month === null) return 0;
  let tries = 0;
  const mark = (await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(PREP_MARK).first<{ value: string }>())?.value ?? '';
  const [done, failedTries] = mark.split('!');
  if (done === month) {
    if (failedTries === undefined) return 0;
    tries = Number(failedTries) || 0;
    if (cheap && tries >= CATCHUP_TRIES) return 0;
  }
  return startMonth(env, month, tries, PREP_MARK);
}

/**
 * Daily 02:00 run: on days 1-3 (Vietnam time) of a month, when the Worker owns the invoices, start the month
 * (kept from before the midnight job existed; startMonth is idempotent, so it only adds a second chance).
 * In the last 5 days it also prepares the next month.
 */
export async function createMonthlyDrafts(env: Env, now = Date.now()): Promise<number> {
  if (!(await isWorkerSource(env.DB))) return 0;
  const vn = new Date(now + 7 * 3600_000).toISOString();
  const started = Number(vn.slice(8, 10)) > 3 ? 0 : await startMonth(env, vn.slice(0, 7));
  return started + (await prepareNextMonth(env, now, false));
}

/** 17:00 UTC = 00:00 Vietnam: switch to the new month right at midnight (whatever the day, only the CURRENT month), then prepare the next one in the last 5 days. */
export async function startCurrentMonth(env: Env, now = Date.now()): Promise<number> {
  if (!(await isWorkerSource(env.DB))) return 0;
  const made = await startMonth(env, vnMonthOf(now));
  return made + (await prepareNextMonth(env, now, false));
}

/**
 * Every 10 minutes: catches a missed midnight run. One settings read decides; when the current Vietnam month is
 * already recorded as started (and, in the last 5 days, the next one as prepared) nothing else is read or written.
 * Not limited to days 1-3, never touches past months.
 */
export async function catchUpMonthStart(env: Env, now = Date.now()): Promise<number> {
  if (!(await isWorkerSource(env.DB))) return 0;
  const month = vnMonthOf(now);
  const mark = (await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(MONTH_MARK).first<{ value: string }>())?.value ?? '';
  const [done, tries] = mark.split('!');
  let made = 0;
  if (!(done === month && tries === undefined)) {
    const failedTries = done === month ? Number(tries) || 0 : 0;
    if (failedTries < CATCHUP_TRIES) made = await startMonth(env, month, failedTries); // else: the next midnight / daily run tries again
  }
  return made + (await prepareNextMonth(env, now, true));
}

/** Daily: forgets login/register counters whose windows are long over (keeps the table tiny). */
export async function cleanupLoginAttempts(env: Env, now = Math.floor(Date.now() / 1000)): Promise<void> {
  await purgeStaleAttempts(env.DB, now);
}

export const FREQUENT_CRON = '*/10 * * * *';
export const DAILY_CRON = '0 19 * * *';
export const MONTH_CRON = '0 17 * * *'; // 00:00 Vietnam

/** The jobs behind one cron expression, each failing alone. */
export async function runCron(cron: string, env: Env, now = Date.now()): Promise<void> {
  const jobs: [string, () => Promise<unknown>][] =
    cron === DAILY_CRON
      ? [['purge', () => purgeDeletedHouses(env)], ['reconcile', () => reconcile(env)], ['monthly drafts', () => createMonthlyDrafts(env, now)], ['login attempts', () => cleanupLoginAttempts(env)]]
      : cron === MONTH_CRON
        ? [['month start', () => startCurrentMonth(env, now)]]
        : [['sheet sync', () => syncLegacySheets(env)], ['replay deferred', () => replayPendingDeferred(env)], ['sheet export', () => drainExportQueue(env)], ['month catch-up', () => catchUpMonthStart(env, now)]]; // drain and catch-up are no-ops unless source is worker
  // One after another (purge before reconcile, so reconcile sees the purged state); each fails alone.
  for (const [name, job] of jobs) await job().catch((err) => console.warn('[cron]', name, err));
}
