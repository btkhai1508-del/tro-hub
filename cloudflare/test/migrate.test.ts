import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { getStorage, ROLLBACK_NOTE, setStorage } from '../src/central/directory.ts';
import { config, DRAIN_MS, idFloor, migrateOwner, rollbackOwner, unlockOwner, type MigrationReport } from '../src/migrate/tenant.ts';
import { replayDeferred, replayPendingDeferred } from '../src/payments/settle.ts';
import { TENANT_TABLES } from '../src/tenant/schema.ts';
import { tenantOfOwner, tenantStub } from '../src/tenant/route.ts';
import type { TenantStore } from '../src/tenant/store.ts';
import { api, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const MONTH = '2026-11';
const Q = 'month=11/2026';
const DEV_KEY = 'developer-key-123';
const LVC_CODE = '002101112026'; // house 002 (LVC), room 101, 11/2026
const HOUSES = ['TRUNG_KIM', 'LVC'];

const sha = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

let seq = 0;
async function webhook(over: Record<string, unknown>) {
  const res = await api('/api/sepay/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${DEV_KEY}` },
    body: JSON.stringify({ id: 7000 + ++seq, gateway: 'MBBank', transferType: 'in', accountNumber: '0123456789', referenceCode: `FT${seq}`,
      transactionDate: '2026-11-17 20:10:00', ...over }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Central tables the tests touch, cleaned before seedWorld replaces the staff. */
async function world() {
  await e.DB.batch([
    e.DB.prepare(`DELETE FROM sepay_manual_webhooks`), e.DB.prepare(`DELETE FROM sepay_connections`),
    e.DB.prepare(`DELETE FROM service_payments`), e.DB.prepare(`DELETE FROM service_invoices`),
    e.DB.prepare(`DELETE FROM sepay_events`), e.DB.prepare(`DELETE FROM unassigned_payments`),
    e.DB.prepare(`DELETE FROM audit_log`),
    // Counters from earlier tests (a rollback leaves D1's inside a landlord's id range) must not leak in.
    e.DB.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('rooms', 'invoices', 'meter_readings', 'payments', 'notifications')`),
  ]);
  await seedWorld('d1');
  await e.DB.batch([
    e.DB.prepare(`DELETE FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`), // no Sheet to read in tests
    e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('sepay_key_sha256', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(await sha(DEV_KEY)),
    e.DB.prepare(`UPDATE rooms SET pay_no = CAST(name AS INTEGER)`),
  ]);
  for (const id of [1, 4]) await tenantStub(e, id, { dryRun: true }).reset();
}

const store = (owner = 1) => tenantStub(e, owner);
const backend = async (owner = 1) => (await getStorage(e.DB, owner)).backend;
const rowsOf = async (db: D1Database | Awaited<ReturnType<typeof tenantOfOwner>>, sql: string) => (await db.prepare(sql).all<any>()).results;
const counts = async (stub = store()) => {
  const out: Record<string, number> = {};
  for (const t of TENANT_TABLES) {
    const d = await stub.digest(t.name);
    out[t.name] = d.ok ? d.count : -1;
  }
  return out;
};
const storeEmpty = async (stub = store()) => Object.values(await counts(stub)).every((n) => n === 0);
const lockRow = () => e.DB.prepare(`SELECT backend, lock_expires_at, note FROM tenant_storage WHERE owner_id = 1`).first<{ backend: string; lock_expires_at: number | null; note: string | null }>();
const events = async () => (await e.DB.prepare(`SELECT sepay_id, status FROM sepay_events ORDER BY rowid`).all<any>()).results;
// runInDurableObject's own generics are too deep for the store's type: go through a plain signature.
const runIn = runInDurableObject as unknown as (stub: unknown, fn: (instance: any) => unknown) => Promise<any>;
const run = <T = any>(stub: DurableObjectStub<TenantStore>, fn: (s: any) => T | Promise<T>): Promise<T> => runIn(stub, fn);
const sql = (stub: DurableObjectStub<TenantStore>, text: string) => stub.query([{ sql: text, params: [], mode: 'run' }], false);

/** D1 digest of the landlord's rows, to prove D1 did or did not change. */
async function d1State(owner = 1) {
  const q = (t: string, where: string) => rowsOf(e.DB, `SELECT * FROM ${t} WHERE ${where} ORDER BY 1, 2`);
  const own = `house_id IN (SELECT id FROM houses WHERE owner_id = ${owner})`;
  return JSON.stringify([
    await q('houses', `owner_id = ${owner}`), await q('rooms', own), await q('invoices', own), await q('residents', own),
    await q('payments', `${own} OR house_id IS NULL`), await q('notifications', own), await q('payment_gates', own),
  ]);
}

/** The read APIs the CLI snapshots, for each house of the landlord. */
async function snapshot(token: string) {
  const out: Record<string, unknown> = {};
  const get = async (path: string) => {
    const res = await api(path, {}, token);
    out[path] = { status: res.status, body: await res.json() };
  };
  await get('/api/houses');
  for (const h of HOUSES) {
    await get(`/api/houses/${h}/rooms`);
    await get(`/api/houses/${h}/invoices?month=${MONTH}`);
    await get(`/api/admin/payment-gate?houseId=${h}&${Q}`);
  }
  await get(`/api/admin/dashboard?${Q}`);
  await get(`/api/admin/billing?${Q}`);
  return out;
}

async function statusSeen(tokens: { resident: string; owner: string; manager: string }) {
  const get = async (path: string, token: string) => {
    const res = await api(path, {}, token);
    expect(res.status, path).toBe(200);
    return (await res.json()) as any;
  };
  return {
    resident: (await get(`/api/payment/status?${Q}`, tokens.resident)).paymentStatus,
    ownerBilling: (await get(`/api/admin/billing?${Q}`, tokens.owner)).billing.find((b: any) => b.room === 'LVC-101').paymentStatus,
    managerBilling: (await get(`/api/admin/billing?${Q}`, tokens.manager)).billing.find((b: any) => b.room === 'LVC-101')?.paymentStatus ?? 'n/a',
    ownerInvoices: (await get(`/api/houses/LVC/invoices?month=${MONTH}`, tokens.owner)).invoices.find((i: any) => i.room_name === '101').status,
  };
}

const okReport = (r: MigrationReport) => {
  expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  expect(r.ok).toBe(true);
  expect(r.tables).toHaveLength(9);
  expect(r.tables.every((t) => t.ok && t.d1Sha === t.doSha && t.d1Count === t.doCount)).toBe(true);
  expect(r.months.length).toBeGreaterThan(0);
  expect(r.months.every((m) => m.ok)).toBe(true);
};

let tokens: { dev: string; owner: string; other: string; manager: string; resident: string };
beforeEach(async () => {
  config.drainMs = 0; // the drain wait has its own tests
  await world();
  await e.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (2, 'LVC')`).run();
  tokens = { dev: await login(PHONES.developer), owner: await login(PHONES.owner), other: await login(PHONES.otherOwner), manager: await login(PHONES.manager), resident: await login(PHONES.residentLvc) };
});

describe('chạy thử', () => {
  it('dry-run khớp, công tắc vẫn d1, kho thật không bị đụng', async () => {
    const before = await d1State();
    const r = await migrateOwner(e, 1, { dryRun: true });
    okReport(r);
    expect(r).toMatchObject({ mode: 'dry-run', lockedMs: 0 });
    expect(r.tables.find((t) => t.table === 'houses')).toMatchObject({ d1Count: 2, doCount: 2 });
    expect(r.tables.find((t) => t.table === 'invoices')).toMatchObject({ d1Count: 2 });
    expect(r.months).toEqual([{ month: MONTH, d1Total: 6_500_000, doTotal: 6_500_000, d1Paid: 0, doPaid: 0, ok: true }]);
    expect(await backend()).toBe('d1');
    expect(await lockRow()).toMatchObject({ backend: 'd1', lock_expires_at: null });
    expect(await storeEmpty()).toBe(true); // the real store
    expect(await storeEmpty(tenantStub(e, 1, { dryRun: true }))).toBe(true); // the trial store is emptied after the report
    expect(await d1State()).toBe(before);
    // Again: the trial store is emptied first, so a second run is just as clean.
    okReport(await migrateOwner(e, 1, { dryRun: true }));
  });

  it('dry-run lệch (kho thử bị chèn thêm dòng) → ok=false, vẫn không đổi gì', async () => {
    const r = await migrateOwner(e, 1, { dryRun: true, hooks: { afterCopy: async () => { await sql(tenantStub(e, 1, { dryRun: true }), `INSERT INTO rooms (id, house_id, name) VALUES (900, 'LVC', 'X')`); } } });
    expect(r).toMatchObject({ ok: false, errorCode: 'VERIFY_FAILED' });
    expect(r.tables.find((t) => t.table === 'rooms')).toMatchObject({ ok: false, d1Count: 2, doCount: 3 });
    expect(await backend()).toBe('d1');
  });

  it('dry-run và migrate qua API: chỉ Developer, báo cáo trong body', async () => {
    const res = await api('/api/dev/storage/1/dry-run', { method: 'POST' }, tokens.dev);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ success: true, report: { ownerId: 1, mode: 'dry-run', ok: true } });
    expect(body.report.tables).toHaveLength(9);
    expect((await api('/api/dev/storage/999/dry-run', { method: 'POST' }, tokens.dev)).status).toBe(404);
    expect((await api('/api/dev/storage/abc/migrate', { method: 'POST' }, tokens.dev)).status).toBe(404);
    // A landlord who is on the shared D1 only: a staff id that is not an owner is not found either.
    expect((await api('/api/dev/storage/3/migrate', { method: 'POST' }, tokens.dev)).status).toBe(404);
  });
});

describe('chuyển', () => {
  it('migrate khớp: công tắc do, JSON của các API đọc trước/sau giống nhau, D1 giữ nguyên', async () => {
    const before = await snapshot(tokens.owner);
    const beforeDev = await snapshot(tokens.dev);
    const d1Before = await d1State();
    const r = await migrateOwner(e, 1);
    okReport(r);
    expect(r).toMatchObject({ mode: 'migrate', deferredReplayed: 0 });
    expect(r.lockedMs).toBeGreaterThanOrEqual(0);
    expect(await backend()).toBe('do');
    expect(await lockRow()).toMatchObject({ backend: 'do', lock_expires_at: null });
    expect(await snapshot(tokens.owner)).toEqual(before);
    expect(await snapshot(tokens.dev)).toEqual(beforeDev);
    // The API really reads the store now: a change there shows, a change in D1 does not.
    await sql(store(), `UPDATE rooms SET price = 1 WHERE id = 1`);
    const rooms = (await (await api('/api/houses/TRUNG_KIM/rooms', {}, tokens.owner)).json()) as any;
    expect(rooms.rooms[0].price).toBe(1);
    // D1 is not touched, the other landlord is not touched, and the store knows where it came from.
    expect(await d1State()).toBe(d1Before);
    expect(await backend(4)).toBe('d1');
    expect(await storeEmpty(store(4))).toBe(true);
    expect(await store().info()).toMatchObject({ ownerId: 1, migratedFrom: 'd1' });
    expect((await store().info()).migratedAt).toBeGreaterThan(0);
    expect((await getStorage(e.DB, 1)).migratedAt).not.toBeNull();
  });

  it('nhiều dòng: đúng bội của 200 và dư lẻ đều chép đủ', async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => e.DB.prepare(`INSERT INTO notifications (house_id, title, content, created_by) VALUES ('LVC', ?, 'c', 'x')`).bind(`n${i}`));
    await e.DB.batch(mk(400)); // exactly two pages (the paging loop must not stop short or loop forever)
    await e.DB.batch(Array.from({ length: 5 }, (_, i) => e.DB.prepare(`INSERT INTO payments (house_id, amount, method, paid_at) VALUES ('LVC', ?, 'cash', 'x')`).bind(i + 1)));
    const r = await migrateOwner(e, 1);
    okReport(r);
    expect(r.tables.find((t) => t.table === 'notifications')).toMatchObject({ d1Count: 400, doCount: 400 });
    expect(r.tables.find((t) => t.table === 'payments')).toMatchObject({ d1Count: 5, doCount: 5 });
  });

  it('cố tình lệch một dòng → ok=false, reset kho, về d1', async () => {
    const r = await migrateOwner(e, 1, { hooks: { afterCopy: async () => { await sql(store(), `INSERT INTO rooms (id, house_id, name) VALUES (900, 'LVC', 'X')`); } } });
    expect(r).toMatchObject({ ok: false, errorCode: 'VERIFY_FAILED', mode: 'migrate' });
    expect(r.tables.find((t) => t.table === 'rooms')).toMatchObject({ ok: false });
    expect(await backend()).toBe('d1');
    expect(await lockRow()).toMatchObject({ lock_expires_at: null });
    expect(await storeEmpty()).toBe(true);
    expect((await store().info()).migratedFrom).toBeNull();
  });

  it('qua API, lần chạy hỏng giữa chừng trả 500 kèm báo cáo, kho sạch, công tắc d1', async () => {
    await run(store(), (s) => s.ctx.storage.sql.exec(`CREATE TRIGGER block_rooms BEFORE INSERT ON rooms BEGIN SELECT RAISE(ABORT, 'no rooms today'); END`));
    const res = await api('/api/dev/storage/1/migrate', { method: 'POST' }, tokens.dev);
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ success: false, errorCode: 'MIGRATION_FAILED', report: { ok: false, mode: 'migrate' } });
    expect(body.error).toMatch(/no rooms today/);
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
    await run(store(), (s) => s.ctx.storage.sql.exec(`DROP TRIGGER block_rooms`));
    expect((await api('/api/dev/storage/1/migrate', { method: 'POST' }, tokens.dev)).status).toBe(200);
  });

  it('một dòng D1 đổi sau khi chép (đối chiếu dùng D1 mới đọc) → ok=false', async () => {
    const r = await migrateOwner(e, 1, { hooks: { afterCopy: async () => { await e.DB.prepare(`UPDATE rooms SET price = price + 1 WHERE id = 1`).run(); } } });
    expect(r).toMatchObject({ ok: false, errorCode: 'VERIFY_FAILED' });
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
  });

  it('lỗi từ kho (trùng khoá) là lỗi nặng: reset kho, về d1, báo lỗi, không ném ngoại lệ', async () => {
    const r = await migrateOwner(e, 1, { hooks: { afterReset: async () => { await sql(store(), `INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('LVC','n','a','d','w','p','l','0')`); } } });
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(r.error).toMatch(/houses.*UNIQUE/);
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
    // The failed run left nothing behind that blocks the next one.
    okReport(await migrateOwner(e, 1));
  });

  it('lỗi từ kho khi chép bảng giữa chừng (houses đã chép, rooms bị từ chối) cũng vậy', async () => {
    const r = await migrateOwner(e, 1, {
      hooks: { afterReset: async () => { await run(store(), (s) => s.ctx.storage.sql.exec(`CREATE TRIGGER block_rooms BEFORE INSERT ON rooms BEGIN SELECT RAISE(ABORT, 'no rooms today'); END`)); } },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(r.error).toMatch(/no rooms today/);
    expect(await backend()).toBe('d1');
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM houses`).one().n)).toBe(0);
    await run(store(), (s) => s.ctx.storage.sql.exec(`DROP TRIGGER block_rooms`));
  });

  it('gọi migrate lần hai khi đang chạy → 409 MIGRATION_RUNNING', async () => {
    let second: MigrationReport | undefined;
    let viaApi: { status: number; body: any } | undefined;
    const r = await migrateOwner(e, 1, {
      hooks: {
        beforeFlip: async () => {
          second = await migrateOwner(e, 1);
          const res = await api('/api/dev/storage/1/migrate', { method: 'POST' }, tokens.dev);
          viaApi = { status: res.status, body: await res.json() };
        },
      },
    });
    expect(second).toMatchObject({ ok: false, errorCode: 'MIGRATION_RUNNING' });
    expect(viaApi).toMatchObject({ status: 409, body: { success: false, errorCode: 'MIGRATION_RUNNING' } });
    okReport(r); // the first run is not disturbed by the refused ones
    expect(await backend()).toBe('do');
    expect(await storeEmpty()).toBe(false);
  });

  it('migrate chủ trọ đã ở kho riêng → 409 ALREADY_MIGRATED, kho không bị đụng', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE rooms SET price = 7 WHERE id = 1`);
    const r = await migrateOwner(e, 1);
    expect(r).toMatchObject({ ok: false, errorCode: 'ALREADY_MIGRATED' });
    expect(await backend()).toBe('do');
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT price FROM rooms WHERE id = 1`).one().price)).toBe(7);
    expect((await api('/api/dev/storage/1/migrate', { method: 'POST' }, tokens.dev)).status).toBe(409);
    expect((await migrateOwner(e, 1, { dryRun: true })).errorCode).toBe('ALREADY_MIGRATED');
  });

  it('kho sót dữ liệu từ lần hỏng (migrated_from null) → tự reset rồi chuyển', async () => {
    await sql(store(), `INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('JUNK','n','a','d','w','p','l','0')`);
    await sql(store(), `INSERT INTO rooms (id, house_id, name) VALUES (999, 'JUNK', 'J')`);
    expect((await store().info()).migratedFrom).toBeNull();
    okReport(await migrateOwner(e, 1));
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM houses WHERE id = 'JUNK'`).one().n)).toBe(0);
    expect((await counts()).rooms).toBe(2);
  });

  it('kho sót marker của lần chuyển xong nhưng công tắc ở d1 (sập giữa chừng) → migrate tự reset rồi chuyển', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE rooms SET price = 7 WHERE id = 1`);
    await setStorage(e.DB, 1, 'd1'); // the crash left the switch on d1 and the marker in the store
    expect((await store().info()).migratedFrom).toBe('d1');
    okReport(await migrateOwner(e, 1));
    expect(await backend()).toBe('do');
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT price FROM rooms WHERE id = 1`).one().price)).toBe(3000000); // D1's value, not the leftover
  });

  it('chủ trọ lạ → 404', async () => {
    expect(await migrateOwner(e, 3)).toMatchObject({ ok: false, errorCode: 'LANDLORD_NOT_FOUND' }); // the Developer, not a landlord
    expect(await rollbackOwner(e, 99)).toMatchObject({ ok: false, errorCode: 'LANDLORD_NOT_FOUND' });
  });
});

describe('khoá không còn của mình', () => {
  it('khoá hết hạn giữa chừng → không bật kho riêng, reset kho, về d1, báo LOCK_LOST', async () => {
    const r = await migrateOwner(e, 1, {
      hooks: { beforeFlip: async () => { await e.DB.prepare(`UPDATE tenant_storage SET lock_expires_at = ? WHERE owner_id = 1`).bind(Date.now() - 1000).run(); } },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'LOCK_LOST' });
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
    expect((await store().info()).migratedFrom).toBeNull();
    okReport(await migrateOwner(e, 1)); // and a new run works
  });

  it('Developer bấm Mở khoá giữa chừng → run đang chạy không bật được kho riêng', async () => {
    const r = await migrateOwner(e, 1, {
      hooks: { beforeFlip: async () => { expect((await api('/api/dev/storage/1/unlock', { method: 'POST' }, tokens.dev)).status).toBe(200); } },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'LOCK_LOST' });
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
  });

  it('khoá đã bị run khác lấy lại → run cũ không đụng kho và khoá của run mới', async () => {
    let newToken = 0;
    const r = await migrateOwner(e, 1, {
      hooks: {
        beforeFlip: async () => {
          // An admin unlocks, then a second run takes the lock and starts filling the store.
          expect(await setStorage(e.DB, 1, 'd1', { expect: 'migrating' })).toBe(true);
          newToken = Date.now() + 9 * 60_000;
          expect(await setStorage(e.DB, 1, 'migrating', { expect: 'd1', lockUntil: newToken, note: 'migrate' })).toBe(true);
          await sql(store(), `INSERT INTO notifications (house_id, title, content, created_by) VALUES ('LVC', 'B partial copy', 'c', 'x')`);
        },
      },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'LOCK_LOST' });
    expect(await lockRow()).toMatchObject({ backend: 'migrating', lock_expires_at: newToken }); // the other run's lock stands
    expect((await counts()).notifications).toBe(1); // and its store was not emptied
  });
});

describe('tiền về trong lúc chuyển', () => {
  it('tiền về khi migrating được cộng đúng một lần sau khi bật', async () => {
    let hook: Awaited<ReturnType<typeof webhook>> | undefined;
    let during: Awaited<ReturnType<typeof statusSeen>> | undefined;
    const r = await migrateOwner(e, 1, {
      hooks: {
        beforeFlip: async () => {
          expect(await backend()).toBe('migrating');
          hook = await webhook({ id: 555001, transferAmount: 3_500_000, content: `CHUYEN TIEN ${LVC_CODE}` });
          during = await statusSeen(tokens);
        },
      },
    });
    okReport(r);
    expect(hook).toMatchObject({ status: 200, body: { kind: 'rent', rent: { settled: false, deferred: true } } });
    expect(during).toEqual({ resident: 'paid', ownerBilling: 'paid', managerBilling: 'paid', ownerInvoices: 'paid' }); // paid at once, though nothing is booked yet
    expect(r.deferredReplayed).toBe(1);
    expect(await backend()).toBe('do');
    const db = await tenantOfOwner(e, 1);
    expect(await rowsOf(db, `SELECT reference, amount FROM payments`)).toEqual([{ reference: 'sepay-555001', amount: 3_500_000 }]);
    expect(await rowsOf(db, `SELECT status FROM invoices WHERE room_id = 3`)).toEqual([{ status: 'paid' }]);
    expect(await events()).toEqual([{ sepay_id: '555001', status: 'done' }]);
    expect(await statusSeen(tokens)).toEqual(during);
    // Once is once: a second replay (the cron) books nothing more.
    expect(await replayDeferred(e, 1)).toBe(0);
    expect(await replayPendingDeferred(e)).toBe(0);
    expect(await rowsOf(db, `SELECT id FROM payments`)).toHaveLength(1);
  });

  it('SePay gửi lại giao dịch đã deferred sau khi bật → bỏ qua, ghi đúng một lần', async () => {
    await migrateOwner(e, 1, { hooks: { beforeFlip: async () => { await webhook({ id: 555002, transferAmount: 3_500_000, content: `CHUYEN TIEN ${LVC_CODE}` }); } } });
    expect(await backend()).toBe('do');
    for (let i = 0; i < 2; i++) {
      const again = await webhook({ id: 555002, transferAmount: 3_500_000, content: `CHUYEN TIEN ${LVC_CODE}` });
      expect(again).toMatchObject({ status: 200, body: { success: true, ignored: 'duplicate' } });
    }
    const db = await tenantOfOwner(e, 1);
    expect(await rowsOf(db, `SELECT reference FROM payments`)).toEqual([{ reference: 'sepay-555002' }]);
    expect(await events()).toEqual([{ sepay_id: '555002', status: 'done' }]);
    expect(await statusSeen(tokens)).toEqual({ resident: 'paid', ownerBilling: 'paid', managerBilling: 'paid', ownerInvoices: 'paid' });
  });

  it('khoá hết hạn: về d1, cả hai phía vẫn thấy Đã đóng, cron cộng vào D1 một lần', async () => {
    // A lock whose run died: expired, with enough money waiting.
    await e.DB.prepare(`INSERT INTO tenant_storage (owner_id, backend, lock_expires_at, note) VALUES (1, 'd1', NULL, NULL) ON CONFLICT (owner_id) DO NOTHING`).run();
    await e.DB.prepare(`UPDATE tenant_storage SET backend = 'migrating', lock_expires_at = ?, note = 'migrate' WHERE owner_id = 1`).bind(Date.now() - 60_000).run();
    await e.DB.prepare(
      `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status, paid_at)
       VALUES ('EXP1', 'rent', 3500000, 'x', 'LVC', '101', ?, 1, 'deferred', '2026-11-17 20:10:00')`
    ).bind(MONTH).run();
    // Resident, landlord and manager all see "paid" before anything is booked.
    expect(await statusSeen(tokens)).toEqual({ resident: 'paid', ownerBilling: 'paid', managerBilling: 'paid', ownerInvoices: 'paid' });
    expect(await backend()).toBe('d1');
    expect(await rowsOf(e.DB, `SELECT id FROM payments WHERE reference = 'sepay-EXP1'`)).toHaveLength(0);
    // The 10-minute cron books it into D1.
    expect(await replayPendingDeferred(e)).toBe(1);
    expect(await rowsOf(e.DB, `SELECT amount FROM payments WHERE reference = 'sepay-EXP1'`)).toEqual([{ amount: 3_500_000 }]);
    expect(await events()).toEqual([{ sepay_id: 'EXP1', status: 'done' }]);
    expect(await statusSeen(tokens)).toEqual({ resident: 'paid', ownerBilling: 'paid', managerBilling: 'paid', ownerInvoices: 'paid' });
    expect(await replayPendingDeferred(e)).toBe(0);
    expect(await rowsOf(e.DB, `SELECT id FROM payments WHERE reference = 'sepay-EXP1'`)).toHaveLength(1);
    expect(await rowsOf(e.DB, `SELECT status FROM invoices WHERE room_id = 3`)).toEqual([{ status: 'paid' }]);
  });
});

describe('quay lại', () => {
  it('rollback khi chưa ghi gì: chỉ đổi công tắc (không chép lại), kho được reset', async () => {
    const d1Before = await d1State();
    okReport(await migrateOwner(e, 1));
    let restored = false;
    const r = await rollbackOwner(e, 1, { hooks: { afterRestore: async () => { restored = true; } } });
    okReport(r);
    expect(r.mode).toBe('rollback');
    expect(restored).toBe(false);
    expect(await backend()).toBe('d1');
    expect(await d1State()).toBe(d1Before);
    expect(await storeEmpty()).toBe(true);
    expect(await store().info()).toMatchObject({ migratedFrom: null, migratedAt: null, lastWriteAt: null });
    expect((await lockRow())!.lock_expires_at).toBeNull();
  });

  it('rollback sau khi có ghi mới: D1 có dữ liệu mới, đối chiếu khớp, kho reset', async () => {
    okReport(await migrateOwner(e, 1));
    // New writes after the switch: through the API (invoice paid), and straight into the store.
    expect((await api('/api/admin/payment-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomNumber: 'LVC-101', status: 'cash', month: '11/2026' }) }, tokens.owner)).status).toBe(200);
    await sql(store(), `UPDATE rooms SET price = 3300000 WHERE id = 3`);
    await sql(store(), `INSERT INTO rooms (house_id, name, price) VALUES ('LVC', '102', 3600000)`);
    await sql(store(), `INSERT INTO notifications (house_id, title, content, created_by) VALUES ('LVC', 'mới', 'c', 'x')`);
    const storeSnapshot = await snapshot(tokens.owner);
    const r = await rollbackOwner(e, 1);
    okReport(r);
    expect(await backend()).toBe('d1');
    expect(await rowsOf(e.DB, `SELECT id, price FROM rooms WHERE house_id = 'LVC' ORDER BY id`)).toEqual([{ id: 3, price: 3300000 }, { id: 1_000_000_000, price: 3600000 }]);
    expect(await rowsOf(e.DB, `SELECT status, status_by FROM invoices WHERE room_id = 3`)).toEqual([{ status: 'cash', status_by: 'staff:1' }]);
    expect(await rowsOf(e.DB, `SELECT title FROM notifications`)).toEqual([{ title: 'mới' }]);
    expect(await snapshot(tokens.owner)).toEqual(storeSnapshot); // the API shows the same before and after the rollback
    expect(await storeEmpty()).toBe(true);
    // The other landlord's rows in the shared D1 were not touched.
    expect(await rowsOf(e.DB, `SELECT id FROM rooms WHERE house_id = 'NTTD' ORDER BY id`)).toEqual([{ id: 5 }, { id: 6 }]);
    // New rows in D1 keep numbering after the restored ids.
    const next = await e.DB.prepare(`INSERT INTO rooms (house_id, name) VALUES ('LVC', '103') RETURNING id`).first<{ id: number }>();
    expect(next!.id).toBeGreaterThan(1_000_000_000);
  });

  it('rollback rồi migrate lại: thành công, rồi rollback lần nữa cũng được', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE rooms SET price = 4000000 WHERE id = 3`);
    okReport(await rollbackOwner(e, 1));
    okReport(await migrateOwner(e, 1));
    expect(await backend()).toBe('do');
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT price FROM rooms WHERE id = 3`).one().price)).toBe(4000000);
    okReport(await rollbackOwner(e, 1));
    expect(await backend()).toBe('d1');
  });

  it('rollback khi đang d1 → 409 NOT_MIGRATED; khi đang chuyển → 409 MIGRATION_RUNNING', async () => {
    expect(await rollbackOwner(e, 1)).toMatchObject({ ok: false, errorCode: 'NOT_MIGRATED' });
    expect((await api('/api/dev/storage/1/rollback', { method: 'POST' }, tokens.dev)).status).toBe(409);
    await setStorage(e.DB, 1, 'migrating', { expect: 'd1' });
    expect(await rollbackOwner(e, 1)).toMatchObject({ ok: false, errorCode: 'MIGRATION_RUNNING' });
  });

  it('rollback lệch id với chủ trọ khác: lỗi an toàn, D1 không đổi, vẫn dùng kho riêng', async () => {
    okReport(await migrateOwner(e, 1));
    // A room id the store gave out that already belongs to the other landlord in the shared D1 (id 5).
    await sql(store(), `INSERT INTO rooms (id, house_id, name) VALUES (5, 'LVC', 'clash')`);
    const d1Before = await d1State();
    const d4Before = await d1State(4);
    const r = await rollbackOwner(e, 1);
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(r.error).toMatch(/UNIQUE/);
    expect(await backend()).toBe('do');
    expect((await lockRow())!.lock_expires_at).toBeNull();
    expect(await d1State()).toBe(d1Before); // the batch is atomic: the delete was undone too
    expect(await d1State(4)).toBe(d4Before);
    expect((await counts()).rooms).toBe(3); // the store still holds everything
    expect((await getStorage(e.DB, 1)).migratedAt).not.toBeNull();
  });

  it('rollback: khoá hết hạn giữa chừng → vẫn dùng kho riêng (không về D1 cũ), kho không bị reset', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE rooms SET price = 3300000 WHERE id = 3`);
    const r = await rollbackOwner(e, 1, {
      hooks: { afterRestore: async () => { await e.DB.prepare(`UPDATE tenant_storage SET lock_expires_at = ? WHERE owner_id = 1`).bind(Date.now() - 1000).run(); } },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'LOCK_LOST' });
    expect(await backend()).toBe('do');
    expect((await counts()).rooms).toBe(2);
  });

  it('khoá rollback để hết hạn tự về do; khoá chuyển thường về d1', async () => {
    okReport(await migrateOwner(e, 1));
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: 'rollback' });
    await e.DB.prepare(`UPDATE tenant_storage SET lock_expires_at = ? WHERE owner_id = 1`).bind(Date.now() - 1000).run();
    expect(await backend()).toBe('do');
    await setStorage(e.DB, 1, 'd1');
    await setStorage(e.DB, 1, 'migrating', { expect: 'd1', note: 'migrate' });
    await e.DB.prepare(`UPDATE tenant_storage SET lock_expires_at = ? WHERE owner_id = 1`).bind(Date.now() - 1000).run();
    expect(await backend()).toBe('d1');
  });
});

describe('mở khoá', () => {
  it('unlock: về d1 và ghi tiền đã hoãn vào D1; không bị khoá thì 409', async () => {
    expect((await api('/api/dev/storage/1/unlock', { method: 'POST' }, tokens.dev)).status).toBe(409);
    await setStorage(e.DB, 1, 'migrating', { expect: 'd1', note: 'migrate' });
    await e.DB.prepare(
      `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status, paid_at)
       VALUES ('UNL1', 'rent', 3500000, 'x', 'LVC', '101', ?, 1, 'deferred', '2026-11-17 20:10:00')`
    ).bind(MONTH).run();
    const res = await api('/api/dev/storage/1/unlock', { method: 'POST' }, tokens.dev);
    expect(await res.json()).toEqual({ success: true, backend: 'd1', replayed: 1 });
    expect(await backend()).toBe('d1');
    expect(await rowsOf(e.DB, `SELECT reference FROM payments`)).toEqual([{ reference: 'sepay-UNL1' }]);
    expect(await events()).toEqual([{ sepay_id: 'UNL1', status: 'done' }]);
  });

  it('unlock khoá rollback → về do (dữ liệu thật còn ở kho)', async () => {
    okReport(await migrateOwner(e, 1));
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: 'rollback' });
    expect(await unlockOwner(e, 1)).toMatchObject({ ok: true, backend: 'do' });
    expect(await backend()).toBe('do');
  });
});

describe('tài khoản ngân hàng', () => {
  const house = (id: string, acc: string | null) => e.DB.prepare(`UPDATE houses SET bank_account_no = ? WHERE id = ?`).bind(acc, id).run();
  const lessPayment = (acc: string | null, amount = 1000) =>
    e.DB.prepare(`INSERT INTO payments (house_id, amount, method, account_no, paid_at) VALUES (NULL, ?, 'bank', ?, 'x')`).bind(amount, acc).run();

  it('tài khoản dùng chung nhiều chủ trọ + khoản chưa gắn căn → 409 SHARED_BANK_ACCOUNT (chạy thử, chuyển, quay lại)', async () => {
    await house('TRUNG_KIM', '9990001800');
    await house('NTTD', '9990001800');
    await lessPayment('9990001800');
    for (const dryRun of [true, false]) {
      const r = await migrateOwner(e, 1, { dryRun });
      expect(r).toMatchObject({ ok: false, errorCode: 'SHARED_BANK_ACCOUNT' });
      expect(r.error).toContain('••1800');
      expect(r.error).not.toContain('9990001800'); // masked
    }
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
    const res = await api('/api/dev/storage/4/migrate', { method: 'POST' }, tokens.dev);
    expect(res.status).toBe(409);
    expect((await res.json()) as any).toMatchObject({ errorCode: 'SHARED_BANK_ACCOUNT' });
  });

  it('rollback vẫn làm được khi tài khoản dùng chung: khoản chưa gắn căn của chủ trọ kia còn nguyên (có ghi mới và không)', async () => {
    for (const withWrites of [false, true]) {
      await world();
      await house('TRUNG_KIM', '9990001800');
      await lessPayment('9990001800', 1);
      okReport(await migrateOwner(e, 1));
      await house('NTTD', '9990001800'); // now shared
      await lessPayment('9990001800', 77); // belongs to the other landlord's world
      if (withWrites) await sql(store(), `UPDATE rooms SET price = 3300000 WHERE id = 3`);
      let restored = false;
      const r = await rollbackOwner(e, 1, { hooks: { afterRestore: async () => { restored = true; } } });
      okReport(r);
      expect(restored).toBe(withWrites);
      expect(await backend()).toBe('d1');
      expect(await rowsOf(e.DB, `SELECT amount FROM payments WHERE house_id IS NULL ORDER BY amount`)).toEqual([{ amount: 1 }, { amount: 77 }]);
      if (withWrites) expect(await rowsOf(e.DB, `SELECT price FROM rooms WHERE id = 3`)).toEqual([{ price: 3300000 }]);
    }
  });

  it('tài khoản dùng chung nhưng không có khoản chưa gắn căn → chuyển bình thường', async () => {
    await house('TRUNG_KIM', '9990001800');
    await house('NTTD', '9990001800');
    okReport(await migrateOwner(e, 1));
  });

  it('khoản chưa gắn căn khớp đúng một chủ trọ đi theo chủ trọ đó; khoản không khớp ai được đếm trong báo cáo', async () => {
    await house('TRUNG_KIM', '9990001800');
    await house('NTTD', '9990004444');
    await lessPayment('9990001800', 1);
    await lessPayment('9990004444', 2);
    await lessPayment('9990009999', 3); // nobody's account
    await lessPayment(null, 4);
    const r = await migrateOwner(e, 1);
    okReport(r);
    expect(r.unmatchedPayments).toBe(2);
    expect(r.tables.find((t) => t.table === 'payments')).toMatchObject({ d1Count: 1, doCount: 1 });
    expect(await rowsOf(await tenantOfOwner(e, 1), `SELECT amount FROM payments`)).toEqual([{ amount: 1 }]);
    const dry = await migrateOwner(e, 4, { dryRun: true });
    expect(dry.tables.find((t) => t.table === 'payments')).toMatchObject({ d1Count: 1 });
    expect(dry.unmatchedPayments).toBe(2);
  });

  it('rollback mang khoản chưa gắn căn về D1 đúng chỗ', async () => {
    await house('TRUNG_KIM', '9990001800');
    await lessPayment('9990001800', 1);
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO payments (house_id, amount, method, account_no, paid_at) VALUES (NULL, 5, 'bank', '9990001800', 'y')`);
    okReport(await rollbackOwner(e, 1));
    expect(await rowsOf(e.DB, `SELECT amount FROM payments WHERE house_id IS NULL ORDER BY amount`)).toEqual([{ amount: 1 }, { amount: 5 }]);
  });
});

describe('API Developer', () => {
  it('chủ trọ, quản lý, cư dân và người chưa đăng nhập không gọi được', async () => {
    const calls: [string, string][] = [['GET', '/api/dev/storage']];
    for (const a of ['dry-run', 'migrate', 'rollback', 'unlock']) calls.push(['POST', `/api/dev/storage/1/${a}`]);
    for (const token of [tokens.owner, tokens.other, tokens.manager, tokens.resident]) {
      for (const [method, path] of calls) {
        const res = await api(path, { method }, token);
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    }
    for (const [method, path] of calls) expect((await api(path, { method })).status, path).toBe(401);
    expect(await backend()).toBe('d1');
    expect(await storeEmpty()).toBe(true);
  });

  it('GET /api/dev/storage: từng chủ trọ, công tắc, khoá, thông tin kho (chỉ khi đang dùng kho)', async () => {
    okReport(await migrateOwner(e, 1));
    await setStorage(e.DB, 4, 'migrating', { expect: 'd1', note: 'migrate' });
    const res = await api('/api/dev/storage', {}, tokens.dev);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.newOwnerBackend).toBe('d1');
    const [one, four] = body.owners;
    expect(one).toMatchObject({ ownerId: 1, houses: 2, backend: 'do', lockExpiresAt: null });
    expect(one.store).toMatchObject({ migratedFrom: 'd1', schemaVersion: 1 });
    expect(four).toMatchObject({ ownerId: 4, houses: 1, backend: 'migrating' });
    expect(four.lockExpiresAt).toBeGreaterThan(Date.now());
    expect(body.owners.map((o: any) => o.ownerId)).toEqual([1, 4]);
  });

  it('mỗi lần chạy để lại dấu trong nhật ký', async () => {
    await api('/api/dev/storage/1/dry-run', { method: 'POST' }, tokens.dev);
    await api('/api/dev/storage/1/migrate', { method: 'POST' }, tokens.dev);
    const acts = (await rowsOf(e.DB, `SELECT action FROM audit_log WHERE action LIKE 'storage_%' ORDER BY id`)).map((r) => r.action);
    expect(acts).toEqual(['storage_dry_run', 'storage_dry_run_ok', 'storage_migrate', 'storage_migrate_ok']);
  });
});

describe('chờ ghi dở dang (drain)', () => {
  it('mặc định 15 giây, nằm gọn trong khoá 10 phút', () => {
    expect(DRAIN_MS).toBe(15_000);
    expect(DRAIN_MS).toBeLessThan(10 * 60_000 / 10);
    config.drainMs = DRAIN_MS; // the default is what a plain call uses (restored by beforeEach)
    expect(config.drainMs).toBe(DRAIN_MS);
  });

  it('migrate chờ sau khi khoá, trước lần đọc đầu tiên', async () => {
    const t0 = Date.now();
    const seen: [string, number, string][] = [];
    const mark = (name: string) => async () => { seen.push([name, Date.now() - t0, await backend()]); };
    const r = await migrateOwner(e, 1, { drainMs: 150, hooks: { afterDrain: mark('drain'), afterReset: mark('reset'), afterCopy: mark('copy') } });
    okReport(r);
    expect(seen.map((x) => x[0])).toEqual(['drain', 'reset', 'copy']);
    expect(seen[0][1]).toBeGreaterThanOrEqual(140);
    expect(seen.every((x) => x[2] === 'migrating')).toBe(true); // already locked while it waits
  });

  it('một ghi D1 đến trong lúc chờ được chép theo (không mất)', async () => {
    const run1 = migrateOwner(e, 1, { drainMs: 200 });
    await new Promise((r) => setTimeout(r, 50));
    await e.DB.prepare(`UPDATE rooms SET price = 3111111 WHERE id = 3`).run(); // a handler that began before the lock
    okReport(await run1);
    expect(await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT price FROM rooms WHERE id = 3`).one().price)).toBe(3111111);
  });

  it('rollback chờ: một ghi vào kho đến trong lúc chờ làm rollback chép về D1 thay vì đi đường tắt', async () => {
    okReport(await migrateOwner(e, 1));
    const run1 = rollbackOwner(e, 1, { drainMs: 200 });
    await new Promise((r) => setTimeout(r, 50));
    await sql(store(), `UPDATE rooms SET price = 3222222 WHERE id = 3`);
    okReport(await run1);
    expect(await rowsOf(e.DB, `SELECT price FROM rooms WHERE id = 3`)).toEqual([{ price: 3222222 }]);
    expect(await backend()).toBe('d1');
  });
});

describe('đọc trong lúc khoá rollback', () => {
  it('khoá rollback: đọc từ kho (hoá đơn đã đóng ở kho vẫn Đã đóng), ghi trả 503; khoá chuyển thường đọc D1', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE room_id = 3`); // paid while on do
    const status = async () => (await (await api(`/api/payment/status?${Q}`, {}, tokens.resident)).json() as any).paymentStatus;
    expect(await status()).toBe('paid');
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: ROLLBACK_NOTE });
    expect(await status()).toBe('paid'); // D1 still says unpaid: it must not be read
    const write = await api('/api/admin/payment-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomNumber: 'LVC-101', status: 'unpaid', month: '11/2026' }) }, tokens.owner);
    expect(write.status).toBe(503);
    expect((await write.json()) as any).toMatchObject({ errorCode: 'TENANT_MIGRATING' });
    expect((await (await api(`/api/houses/LVC/invoices?month=${MONTH}`, {}, tokens.owner)).json() as any).invoices[0].status).toBe('paid');
    // A migrate lock is different: the landlord's data is still in D1.
    await setStorage(e.DB, 1, 'do', { expect: 'migrating' });
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: 'migrate' });
    expect(await status()).toBe('unpaid');
  });

  it('rollback copy-back: trong lúc khoá, đọc vẫn ra dữ liệu của kho', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE room_id = 3`);
    const during: string[] = [];
    const r = await rollbackOwner(e, 1, {
      hooks: { afterRestore: async () => { during.push((await (await api(`/api/payment/status?${Q}`, {}, tokens.resident)).json() as any).paymentStatus); } },
    });
    okReport(r);
    expect(during).toEqual(['paid']);
  });
});

describe('kho sót lại', () => {
  it('clear-store: xoá kho khi công tắc ở d1; từ chối khi do hoặc migrating; chỉ Developer', async () => {
    await sql(store(), `INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('JUNK','n','a','d','w','p','l','0')`);
    await store().setMeta('migrated_from', 'd1');
    for (const token of [tokens.owner, tokens.manager, tokens.resident]) expect((await api('/api/dev/storage/1/clear-store', { method: 'POST' }, token)).status).toBe(403);
    expect((await api('/api/dev/storage/1/clear-store', { method: 'POST' })).status).toBe(401);
    expect(await storeEmpty()).toBe(false);
    expect((await api('/api/dev/storage/99/clear-store', { method: 'POST' }, tokens.dev)).status).toBe(404);
    const ok = await api('/api/dev/storage/1/clear-store', { method: 'POST' }, tokens.dev);
    expect(ok.status).toBe(200);
    expect(await storeEmpty()).toBe(true);
    expect((await store().info()).migratedFrom).toBeNull();
    expect(await lockRow()).toMatchObject({ backend: 'd1', lock_expires_at: null });
    // On 'do' and while migrating the store serves traffic or is being filled: refuse, touch nothing.
    okReport(await migrateOwner(e, 1));
    expect((await api('/api/dev/storage/1/clear-store', { method: 'POST' }, tokens.dev)).status).toBe(409);
    expect(await storeEmpty()).toBe(false);
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: 'migrate' });
    expect((await api('/api/dev/storage/1/clear-store', { method: 'POST' }, tokens.dev)).status).toBe(409);
    expect(await storeEmpty()).toBe(false);
  });

  it('lần chạy chết giữa chừng (kho đầy, marker có, khoá hết hạn) → migrate chạy lại được', async () => {
    okReport(await migrateOwner(e, 1));
    await setStorage(e.DB, 1, 'migrating', { expect: 'do', note: 'migrate', lockUntil: Date.now() - 1000 }); // expired -> reads as d1? (migrate note)
    expect(await backend()).toBe('d1');
    okReport(await migrateOwner(e, 1));
    expect(await backend()).toBe('do');
  });

  it('khoá hết hạn được coi là trống: lần thử lại đầu tiên không bị MIGRATION_RUNNING', async () => {
    await setStorage(e.DB, 1, 'migrating', { expect: 'd1', note: 'migrate', lockUntil: Date.now() - 1000 });
    okReport(await migrateOwner(e, 1));
  });
});

describe('dải id của kho riêng', () => {
  const idsOf = async (table: string) => (await run(store(), (s) => s.ctx.storage.sql.exec(`SELECT id FROM ${table} ORDER BY id`).toArray())).map((r: any) => r.id as number);
  const FLOOR = 1_000_000_000;

  it('sau migrate, hàng mới trong kho có id ≥ ngưỡng; rollback chép về D1 không đụng hàng chủ trọ khác tạo trong lúc đó', async () => {
    okReport(await migrateOwner(e, 1));
    expect(await store().info()).toMatchObject({ lastWriteAt: expect.anything() }); // copy wrote; counters did not change that
    const res = await api('/api/admin/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 't', desc: 'd', target: 'LVC' }) }, tokens.owner);
    expect(res.status).toBe(200);
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '102')`);
    expect((await idsOf('notifications')).every((id: number) => id >= FLOOR)).toBe(true);
    expect((await idsOf('rooms')).filter((id: number) => id >= FLOOR)).toEqual([FLOOR]);
    // Meanwhile a landlord still on d1 creates rows in the shared D1.
    const d1Room = await e.DB.prepare(`INSERT INTO rooms (house_id, name) VALUES ('NTTD', '103') RETURNING id`).first<{ id: number }>();
    expect(d1Room!.id).toBeLessThan(FLOOR);
    okReport(await rollbackOwner(e, 1));
    expect(await rowsOf(e.DB, `SELECT id FROM rooms WHERE id >= ${FLOOR}`)).toEqual([{ id: FLOOR }]);
    expect(await rowsOf(e.DB, `SELECT id FROM rooms WHERE id = ${d1Room!.id}`)).toHaveLength(1);
    expect((await rowsOf(e.DB, `SELECT id FROM notifications`)).every((r) => r.id >= FLOOR)).toBe(true);
  });

  it('migrate → rollback → migrate: id mới trong kho không đụng id D1 đã cấp', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '102')`);
    okReport(await rollbackOwner(e, 1)); // D1's counter is now inside the landlord's range
    const d1Room = await e.DB.prepare(`INSERT INTO rooms (house_id, name) VALUES ('NTTD', '103') RETURNING id`).first<{ id: number }>();
    expect(d1Room!.id).toBeGreaterThan(FLOOR);
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '104')`);
    const ids = await idsOf('rooms');
    expect(Math.max(...ids)).toBeGreaterThan(d1Room!.id);
    expect(ids).not.toContain(d1Room!.id);
    okReport(await rollbackOwner(e, 1)); // and it goes back without a collision
  });

  it('chủ trọ khác có dải riêng; đặt bộ đếm không đếm là ghi (đường tắt rollback còn nguyên)', async () => {
    expect((await migrateOwner(e, 4)).ok).toBe(true); // no invoices, so okReport's month check does not apply
    await sql(store(4), `INSERT INTO rooms (house_id, name) VALUES ('NTTD', '103')`);
    expect(await idsOf4()).toContain(4 * FLOOR);
    async function idsOf4() { return (await run(store(4), (s) => s.ctx.storage.sql.exec(`SELECT id FROM rooms`).toArray())).map((r: any) => r.id as number); }
    okReport(await migrateOwner(e, 1));
    const info = await store().info();
    expect(info.lastWriteAt!).toBeLessThanOrEqual(info.migratedAt!);
  });
});

describe('dải id theo thế hệ (R21)', () => {
  const G = 1_000_000_000_000;
  const B = 1_000_000_000;

  it('idFloor: nhỏ nhất dạng owner*1e9 + k*1e12 mà lớn hơn MAX của D1', () => {
    const cases: [number, number, number][] = [
      [1, 0, B], // empty D1
      [1, 6, B],
      [1, B - 1, B],
      [1, B, B + G], // D1 max inside the owner's own range -> next generation
      [1, B + 5, B + G],
      [1, B + G - 1, B + G],
      [1, B + G, B + 2 * G],
      [1, 4 * B + 5, B + G], // another owner's range: still this owner's own form, above max
      [4, B + 5, 4 * B], // below this owner's base
      [4, 4 * B + 7, 4 * B + G],
    ];
    for (const [owner, max, want] of cases) {
      const got = idFloor(owner, max);
      expect(got, `owner ${owner}, max ${max}`).toBe(want);
      expect(got).toBeGreaterThan(max);
      expect((got - owner * B) % G).toBe(0);
    }
  });

  it('idFloor: không tràn số nguyên an toàn, báo lỗi rõ', () => {
    expect(Number.isSafeInteger(idFloor(999, 8_000 * G))).toBe(true);
    expect(() => idFloor(1, Number.MAX_SAFE_INTEGER - 5)).toThrow(/Hết dải id/);
    expect(() => idFloor(999, 9_007 * G)).toThrow(/Hết dải id/);
  });

  it('idFloor: chủ trọ ngoài 1–999 hoặc không nguyên bị từ chối', () => {
    for (const bad of [0, -1, 1000, 1001, 1.5, Number.NaN]) expect(() => idFloor(bad, 0), String(bad)).toThrow(/giới hạn 1–999/);
    expect(idFloor(999, 0)).toBe(999 * B);
  });

  it('migrate chủ trọ có mã >= 1000: lỗi an toàn, khoá được nhả về d1', async () => {
    await e.DB.prepare(`INSERT INTO staff (id, full_name, phone, password_hash, role) VALUES (1000, 'Chủ 1000', '0900000999', 'x', 'owner')`).run();
    await e.DB.prepare(`INSERT OR IGNORE INTO tenant_storage (owner_id, backend, changed_at) VALUES (1000, 'd1', datetime('now'))`).run();
    const r = await migrateOwner(e, 1000);
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(r.error).toMatch(/giới hạn 1–999/);
    expect((await getStorage(e.DB, 1000)).backend).toBe('d1');
    expect(await e.DB.prepare(`SELECT lock_expires_at FROM tenant_storage WHERE owner_id = 1000`).first()).toEqual({ lock_expires_at: null });
  });

  it('sequenceFloors đọc cả sqlite_sequence: xoá dòng id cao ở D1 không hạ sàn dưới bộ cấp id của D1', async () => {
    const high = B + 500_000_000; // inside landlord 1's first range
    await e.DB.prepare(`INSERT INTO rooms (id, house_id, name) VALUES (?, 'NTTD', 'tmp')`).bind(high).run();
    await e.DB.prepare(`DELETE FROM rooms WHERE id = ?`).bind(high).run();
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '199')`);
    const top = Math.max(...(await ids(1, 'rooms')));
    expect(top).toBeGreaterThan(high);
    expect(top).toBe(B + G);
  });

  const ids = async (owner: number, table: string) => (await run(store(owner), (s) => s.ctx.storage.sql.exec(`SELECT id FROM ${table} ORDER BY id`).toArray())).map((r: any) => r.id as number);

  it('migrate → ghi → rollback → landlord d1 chèn → migrate lại → chèn → landlord d1 chèn → rollback có ghi: không đụng id, không đè khoản của chủ trọ khác', async () => {
    const lessPay = (acc: string, amount: number) => e.DB.prepare(`INSERT INTO payments (house_id, amount, method, account_no, paid_at) VALUES (NULL, ?, 'bank', ?, 'x') RETURNING id`).bind(amount, acc).first<{ id: number }>();
    await e.DB.prepare(`UPDATE houses SET bank_account_no = '111' WHERE id = 'TRUNG_KIM'`).run();
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '102')`);
    await sql(store(), `INSERT INTO payments (house_id, amount, method, account_no, paid_at) VALUES (NULL, 5, 'bank', '111', 'y')`);
    okReport(await rollbackOwner(e, 1)); // D1's counters now sit inside the landlord's range
    const d1a = await e.DB.prepare(`INSERT INTO rooms (house_id, name) VALUES ('NTTD', '103') RETURNING id`).first<{ id: number }>();
    expect(d1a!.id).toBeGreaterThan(B);
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '104')`);
    await sql(store(), `INSERT INTO payments (house_id, amount, method, account_no, paid_at) VALUES (NULL, 6, 'bank', '111', 'z')`);
    const storeRooms = await ids(1, 'rooms');
    expect(storeRooms.filter((id: number) => id >= B + G)).toHaveLength(1); // next generation
    // Landlords still on d1 keep inserting, including a house-less payment on an account of their own.
    const d1b = await e.DB.prepare(`INSERT INTO rooms (house_id, name) VALUES ('NTTD', '105') RETURNING id`).first<{ id: number }>();
    const other = await lessPay('222', 77);
    expect(storeRooms).not.toContain(d1b!.id);
    expect(other!.id).toBeLessThan(B + G); // not in the landlord's new generation
    const r = await rollbackOwner(e, 1);
    okReport(r);
    expect(await rowsOf(e.DB, `SELECT amount FROM payments WHERE account_no = '222'`)).toEqual([{ amount: 77 }]); // not overwritten
    expect(await rowsOf(e.DB, `SELECT amount FROM payments WHERE account_no = '111' AND house_id IS NULL ORDER BY amount`)).toEqual([{ amount: 5 }, { amount: 6 }]);
    expect(await rowsOf(e.DB, `SELECT id FROM rooms WHERE id IN (${d1a!.id}, ${d1b!.id})`)).toHaveLength(2);
  });

  it('hai chủ trọ cùng chuyển sau một rollback có dải rời nhau', async () => {
    okReport(await migrateOwner(e, 1));
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '102')`);
    okReport(await rollbackOwner(e, 1));
    okReport(await migrateOwner(e, 1));
    expect((await migrateOwner(e, 4)).ok).toBe(true);
    await sql(store(), `INSERT INTO rooms (house_id, name) VALUES ('LVC', '104')`);
    await sql(store(4), `INSERT INTO rooms (house_id, name) VALUES ('NTTD', '103')`);
    const mine = (await ids(1, 'rooms')).filter((id: number) => id >= B + G); // the 1e9 row is the restored one
    const theirs = (await ids(4, 'rooms')).filter((id: number) => id >= B);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect((mine[0] - B) % G).toBe(0);
    expect((theirs[0] - 4 * B) % G).toBe(0);
    expect(mine[0]).not.toBe(theirs[0]);
  });
});

describe('khoá được nhả khi lỗi ngoài các bước đã bọc', () => {
  const broken = { ...({} as object), DB: e.DB, TENANT: { get: () => { throw new Error('no store today'); }, idFromName: () => ({}) } } as unknown as Env;

  it('migrate: tenantStub ném ngay sau khi lấy khoá → khoá được nhả về d1', async () => {
    const r = await migrateOwner({ ...e, TENANT: broken.TENANT } as Env, 1);
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(r.error).toMatch(/no store today/);
    expect(await lockRow()).toMatchObject({ backend: 'd1', lock_expires_at: null });
  });

  it('rollback: tenantStub ném → khoá được nhả về do (dữ liệu thật vẫn ở kho)', async () => {
    okReport(await migrateOwner(e, 1));
    const r = await rollbackOwner({ ...e, TENANT: broken.TENANT } as Env, 1);
    expect(r).toMatchObject({ ok: false, errorCode: 'MIGRATION_FAILED' });
    expect(await lockRow()).toMatchObject({ backend: 'do', lock_expires_at: null });
    expect(await storeEmpty()).toBe(false);
  });
});
