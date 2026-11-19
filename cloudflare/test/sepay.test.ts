import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage } from '../src/central/directory.ts';
import { deferRent, replayDeferred, replayPendingDeferred } from '../src/payments/settle.ts';
import { findPayCode } from '../src/routes/sepay.ts';
import { tenantOfOwner, tenantStub } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld, type BackendName } from './helpers.ts';

const e = env as unknown as Env;
const MONTH = '2026-11';
const Q = 'month=11/2026';
const DEV_KEY = 'developer-key-123';
const OWNER4_KEY = 'th_owner4_manual_key';
const OWNER1_KEY = 'th_owner1_manual_key';
const LVC_CODE = '002101112026'; // house 002 (LVC), room 101, 11/2026
const TK_CODE = '001101112026'; // house 001 (TRUNG_KIM)
const NTTD_CODE = '003101112026'; // house 003 (NTTD, landlord 4)

const sha = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

let seq = 0;
async function webhook(key: string, over: Record<string, unknown>) {
  const res = await api('/api/sepay/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${key}` },
    body: JSON.stringify({ id: 9000 + ++seq, gateway: 'MBBank', transferType: 'in', accountNumber: '0123456789', referenceCode: `FT${seq}`,
      transactionDate: '2026-11-17 20:10:00', ...over }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const markSynced = () =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(`legacy_sync:${MONTH}`, new Date().toISOString()).run();

/** Rows that point at staff must go before seedWorld replaces the staff. */
async function world(backend: BackendName) {
  await e.DB.batch([
    e.DB.prepare(`DELETE FROM sepay_manual_webhooks`), e.DB.prepare(`DELETE FROM sepay_connections`),
    e.DB.prepare(`DELETE FROM service_payments`), e.DB.prepare(`DELETE FROM service_invoices`),
  ]);
  await seedWorld(backend);
  await seedSepay(backend);
}

/** Room pay numbers and the key table the webhook authenticates against. */
async function seedSepay(backend: BackendName) {
  await e.DB.batch([
    e.DB.prepare(`DELETE FROM sepay_events`), e.DB.prepare(`DELETE FROM unassigned_payments`),
    e.DB.prepare(`DELETE FROM sepay_manual_webhooks`), e.DB.prepare(`DELETE FROM sepay_connections`),
    e.DB.prepare(`DELETE FROM service_payments`), e.DB.prepare(`DELETE FROM service_invoices`),
    e.DB.prepare(`DELETE FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`),
    e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('sepay_key_sha256', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(await sha(DEV_KEY)),
    e.DB.prepare(`INSERT INTO sepay_manual_webhooks (owner_id, key_sha256, key_hint) VALUES (1, ?, 'ey_1'), (4, ?, 'ey_4')`).bind(await sha(OWNER1_KEY), await sha(OWNER4_KEY)),
  ]);
  for (const owner of [1, 4]) {
    const db = backend === 'do' ? await tenantOfOwner(e, owner) : e.DB;
    await db.prepare(`UPDATE rooms SET pay_no = CAST(name AS INTEGER)`).run();
  }
  await markSynced();
}

const storeOf = async (backend: BackendName, owner = 1) => (backend === 'do' ? tenantOfOwner(e, owner) : e.DB);
const payments = async (backend: BackendName, owner = 1) =>
  (await (await storeOf(backend, owner)).prepare(`SELECT house_id, invoice_id, amount, reference FROM payments ORDER BY id`).all<any>()).results;
const lvcInvoice = async (backend: BackendName) =>
  (await storeOf(backend)).prepare(`SELECT id, status FROM invoices WHERE room_id = 3 AND month = ?`).bind(MONTH).first<{ id: number; status: string }>();
const events = async () => (await e.DB.prepare(`SELECT sepay_id, kind, status, house_id, room, month FROM sepay_events ORDER BY rowid`).all<any>()).results;

interface Seen { resident: string; statusStaff: string; ownerBilling: string; managerBilling: string; ownerInvoices: string; managerInvoices: string; dashboard: number }
async function seen(tokens: { resident: string; owner: string; manager: string }): Promise<Seen> {
  const get = async (path: string, token: string) => {
    const res = await api(path, {}, token);
    expect(res.status, path).toBe(200);
    return (await res.json()) as any;
  };
  const billingOf = async (t: string) => (await get(`/api/admin/billing?${Q}`, t)).billing.find((b: any) => b.room === 'LVC-101');
  const invoiceOf = async (t: string) => (await get(`/api/houses/LVC/invoices?month=${MONTH}`, t)).invoices.find((i: any) => i.room_name === '101');
  const dash = await get(`/api/admin/dashboard?${Q}`, tokens.owner);
  await get(`/api/admin/dashboard?${Q}`, tokens.manager);
  return {
    resident: (await get(`/api/payment/status?${Q}`, tokens.resident)).paymentStatus,
    statusStaff: (await get(`/api/payment/status?${Q}&room=LVC-101`, tokens.owner)).paymentStatus,
    ownerBilling: (await billingOf(tokens.owner)).paymentStatus,
    managerBilling: (await billingOf(tokens.manager)).paymentStatus,
    ownerInvoices: (await invoiceOf(tokens.owner)).status,
    managerInvoices: (await invoiceOf(tokens.manager)).status,
    dashboard: JSON.stringify(dash).length,
  };
}
const everyone = (s: string) => ({ resident: s, statusStaff: s, ownerBilling: s, managerBilling: s, ownerInvoices: s, managerInvoices: s });
const view = (s: Seen) => { const { dashboard, ...rest } = s; void dashboard; return rest; };

/** A rent event for LVC/101 as the webhook leaves it. */
const insertEvent = (id: string, amount: number, status = 'done') =>
  e.DB.prepare(`INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status, paid_at)
    VALUES (?, 'rent', ?, 'x', 'LVC', '101', ?, 1, ?, '2026-11-17 20:10:00')`).bind(id, amount, MONTH, status).run();


type Mode = BackendName | 'migrating';
const MODES: Mode[] = ['d1', 'migrating', 'do'];

describe.each(MODES)('SePay webhook, tiền trọ (%s)', (mode) => {
  const backend: BackendName = mode === 'do' ? 'do' : 'd1';
  let tokens: { resident: string; owner: string; manager: string; dev: string };
  beforeEach(async () => {
    await world(backend);
    await e.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (2, 'LVC')`).run();
    tokens = { resident: await login(PHONES.residentLvc), owner: await login(PHONES.owner), manager: await login(PHONES.manager), dev: await login(PHONES.developer) };
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
  });
  afterEach(() => vi.restoreAllMocks());

  it('webhook đủ tiền: cư dân và chủ trọ đều thấy Đã đóng ngay', async () => {
    const r = await webhook(DEV_KEY, { transferAmount: 3_500_000, content: `CHUYEN TIEN ${LVC_CODE}` });
    expect(r).toMatchObject({ status: 200, body: { success: true, kind: 'rent', houseId: 'LVC', room: '101', month: MONTH } });
    expect(view(await seen(tokens))).toEqual(everyone('paid'));
    if (mode === 'migrating') {
      // Nothing was written to the store/D1; the money waits centrally.
      expect(await payments('d1')).toEqual([]);
      expect((await lvcInvoice('d1'))!.status).toBe('unpaid');
      expect(await events()).toMatchObject([{ kind: 'rent', status: 'deferred', house_id: 'LVC', room: '101', month: MONTH }]);
    } else {
      expect(await payments(backend)).toMatchObject([{ house_id: 'LVC', amount: 3_500_000 }]);
      expect((await lvcInvoice(backend))!.status).toBe('paid');
      expect(await events()).toMatchObject([{ status: 'done' }]);
      if (backend === 'do') expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM payments`).first<{ n: number }>())!.n).toBe(0);
    }
  });

  it('webhook thiếu tiền: cả hai thấy chưa đóng; đủ phần còn lại thì Đã đóng', async () => {
    await webhook(DEV_KEY, { transferAmount: 1_000_000, content: LVC_CODE });
    expect(view(await seen(tokens))).toEqual(everyone('unpaid'));
    await webhook(DEV_KEY, { transferAmount: 2_499_999, content: LVC_CODE });
    expect(view(await seen(tokens))).toEqual(everyone('unpaid'));
    await webhook(DEV_KEY, { transferAmount: 1, content: LVC_CODE });
    expect(view(await seen(tokens))).toEqual(everyone('paid'));
  });

  it('gửi lại cùng giao dịch: không cộng trùng', async () => {
    const body = { id: 777, transferAmount: 2_000_000, content: LVC_CODE };
    await webhook(DEV_KEY, body);
    expect(await webhook(DEV_KEY, body)).toMatchObject({ body: { ignored: 'duplicate' } });
    await webhook(DEV_KEY, { id: 778, transferAmount: 2_000_000, content: LVC_CODE });
    expect(view(await seen(tokens))).toEqual(everyone('paid')); // 2 distinct transfers, 4M ≥ 3.5M
    const d = await webhook(DEV_KEY, body);
    expect(d.body.ignored).toBe('duplicate');
    expect((await events()).length).toBe(2);
  });

  it('mã căn không tồn tại → unassigned_payments', async () => {
    const r = await webhook(DEV_KEY, { id: 555, transferAmount: 500_000, content: 'CHUYEN 999101112026', accountNumber: '0123456789' });
    expect(r.body).toMatchObject({ success: true, unassigned: true });
    expect((await e.DB.prepare(`SELECT sepay_id, amount, account_no FROM unassigned_payments`).all<any>()).results).toEqual([{ sepay_id: '555', amount: 500_000, account_no: '0123456789' }]);
    expect(await payments(backend)).toEqual([]);
    expect(view(await seen(tokens))).toEqual(everyone('unpaid'));
  });

  it('unassigned_payments lỗi: webhook báo lỗi (SePay gửi lại), không để lại sự kiện done; gửi lại thì vào unassigned đúng một lần', async () => {
    await e.DB.prepare(`CREATE TRIGGER boom_un BEFORE INSERT ON unassigned_payments BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();
    const body = { id: 8181, transferAmount: 500_000, content: 'CHUYEN 999101112026', accountNumber: '0123456789' };
    try {
      const failed = await webhook(DEV_KEY, body).catch(() => ({ status: 500, body: { success: false } }));
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(failed.body.success).not.toBe(true);
      expect(await events()).toEqual([]); // no 'done' event: the retry is not a duplicate
    } finally {
      await e.DB.prepare(`DROP TRIGGER boom_un`).run();
    }
    const retry = await webhook(DEV_KEY, body);
    expect(retry.body).toMatchObject({ success: true, unassigned: true });
    expect((await e.DB.prepare(`SELECT sepay_id, amount FROM unassigned_payments`).all<any>()).results).toEqual([{ sepay_id: '8181', amount: 500_000 }]);
    expect(await events()).toMatchObject([{ sepay_id: '8181', status: 'done' }]);
    expect(await webhook(DEV_KEY, body)).toMatchObject({ body: { ignored: 'duplicate' } });
    expect((await e.DB.prepare(`SELECT COUNT(*) n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(1);
  });

  it('phòng không có trong căn → unassigned, không ghi payments', async () => {
    const r = await webhook(DEV_KEY, { id: 556, transferAmount: 500_000, content: '002555112026' });
    expect(r.body.unassigned).toBe(true);
    expect((await payments(backend)).length).toBe(0);
  });

  it('webhook chủ trọ A không cộng được vào căn của chủ trọ B', async () => {
    // Landlord 4's own key, LVC belongs to landlord 1: by pay code and by the old code.
    for (const content of [LVC_CODE, 'LVC-101-T11-2026']) {
      const r = await webhook(OWNER4_KEY, { transferAmount: 3_500_000, content });
      expect(r.status).toBe(200);
      expect(r.body.rent ?? null).toBeNull();
    }
    expect(await payments(backend)).toEqual([]);
    expect(await payments('d1', 4)).toEqual([]);
    expect(view(await seen(tokens))).toEqual(everyone('unpaid'));
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(2);
    expect(await events()).toMatchObject([{ house_id: null }, { house_id: null }]);
  });

  it('webhook chủ trọ 4 vào căn của chính họ: ghi vào kho của chủ trọ 4', async () => {
    const r = await webhook(OWNER4_KEY, { transferAmount: 2_500_000, content: NTTD_CODE });
    expect(r.body).toMatchObject({ kind: 'rent', houseId: 'NTTD', room: '101' });
    expect(await payments(backend, 4)).toMatchObject([{ house_id: 'NTTD', amount: 2_500_000 }]);
    if (backend === 'do') expect(await payments(backend, 1)).toEqual([]);
    expect((await payments(backend, 1)).filter((p) => p.house_id !== 'NTTD')).toEqual([]);
  });

  it('key sai bị từ chối', async () => {
    expect((await webhook('nope-nope-nope', { transferAmount: 1, content: LVC_CODE })).status).toBe(401);
    expect(await events()).toEqual([]);
  });

  it('findPayCode: XXX tra thư mục, PPP tra kho của chủ trọ', async () => {
    expect(await findPayCode(e, `x ${LVC_CODE} y`, null)).toEqual({ houseId: 'LVC', ownerId: 1, room: '101', month: MONTH });
    expect(await findPayCode(e, '002 101 11 2026', null)).toMatchObject({ houseId: 'LVC' });
    expect(await findPayCode(e, LVC_CODE, 1)).toMatchObject({ houseId: 'LVC' });
    expect(await findPayCode(e, LVC_CODE, 4)).toBeNull();
    expect(await findPayCode(e, TK_CODE, 4)).toBeNull();
    expect(await findPayCode(e, '002999112026', null)).toBeNull();
    expect(await findPayCode(e, '000101112026', null)).toBeNull();
  });

  it('GET /api/payments/unassigned: chuyển khoản chưa gắn khớp tài khoản của chủ trọ', async () => {
    const db = await storeOf(backend);
    if (mode === 'migrating') await setStorage(e.DB, 1, 'd1');
    await db.prepare(`UPDATE houses SET bank_account_no = '111222333' WHERE id = 'LVC'`).run();
    await db.prepare(`INSERT INTO payments (house_id, amount, method, account_no, reference, paid_at) VALUES (NULL, 70000, 'bank', '111222333', 'ST1', '2026-11-02')`).run();
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
    await webhook(DEV_KEY, { id: 601, transferAmount: 100_000, content: 'khong ro', accountNumber: '111222333', transactionDate: '2026-11-09 10:00:00' });
    await webhook(DEV_KEY, { id: 602, transferAmount: 200_000, content: 'khong ro', accountNumber: '999000111' }); // another account
    const res = await api('/api/payments/unassigned', {}, tokens.owner);
    expect(res.status).toBe(200);
    const list = ((await res.json()) as any).payments as any[];
    expect(list.map((p) => p.amount)).toEqual([100_000, 70_000]);
    expect(list[0]).toMatchObject({ method: 'bank', bank_name: 'MBBank' });
    expect((await api('/api/payments/unassigned', {}, tokens.manager)).status).toBe(403);
    expect((await api('/api/payments/unassigned', {}, tokens.resident)).status).toBe(403);
  });

  it('replaying chưa có payments: cả năm màn hình vẫn thấy Đã đóng', async () => {
    await insertEvent('RP1', 3_500_000, 'replaying');
    expect(view(await seen(tokens))).toEqual(everyone('paid'));
    const res = await api('/api/admin/dashboard?' + Q, {}, tokens.owner);
    expect(res.status).toBe(200);
  });

  it('replaying đã ghi payments: không cộng trùng (thiếu tiền vẫn chưa đóng, đủ tiền đóng đúng một lần)', async () => {
    const db = await storeOf(backend);
    const inv = (await lvcInvoice(backend))!;
    if (mode === 'migrating') await setStorage(e.DB, 1, 'd1');
    await db.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 2000000, 'bank', 'sepay-RP2', '2026-11-17')`).bind(inv.id).run();
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
    await insertEvent('RP2', 2_000_000, 'replaying'); // 2M booked once, the event must not add another 2M
    expect(view(await seen(tokens))).toEqual(everyone('unpaid'));
    await insertEvent('RP3', 1_500_000, 'deferred'); // 2M booked + 1.5M waiting = 3.5M
    expect(view(await seen(tokens))).toEqual(everyone('paid'));
  });

  if (mode !== 'migrating') {
    it('lỗi ghi không phải khoá: webhook vẫn thành công, hai phía thấy Đã đóng, replay ghi đúng một lần, gửi lại là duplicate', async () => {
      const trigger = `CREATE TRIGGER boom BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'boom'); END`;
      const run = async (sql: string) =>
        backend === 'do'
          ? runInDurableObject(tenantStub(e, 1), (_i, state) => { state.storage.sql.exec(sql); })
          : void (await e.DB.prepare(sql).run());
      await run(trigger);
      const body = { id: 4242, transferAmount: 3_500_000, content: LVC_CODE };
      const r = await webhook(DEV_KEY, body);
      expect(r).toMatchObject({ status: 200, body: { success: true, rent: { settled: false, deferred: true } } });
      expect(await events()).toMatchObject([{ sepay_id: '4242', status: 'deferred' }]);
      expect(view(await seen(tokens))).toEqual(everyone('paid'));
      await run('DROP TRIGGER boom');
      // SePay sends it again: nothing new is recorded.
      expect(await webhook(DEV_KEY, body)).toMatchObject({ body: { ignored: 'duplicate' } });
      expect(await payments(backend)).toEqual([]);
      expect(await replayDeferred(e, 1)).toBe(1);
      expect(await payments(backend)).toMatchObject([{ amount: 3_500_000, reference: 'sepay-4242' }]);
      expect((await lvcInvoice(backend))!.status).toBe('paid');
      expect(await replayDeferred(e, 1)).toBe(0);
      expect((await payments(backend)).length).toBe(1);
      expect(view(await seen(tokens))).toEqual(everyone('paid'));
    });
  }

  if (mode !== 'migrating') {
    // settleRent books the payment and then marks the invoice: the gap between the two must not show "Chưa đóng".
    const sqlOf = (sql: string) =>
      backend === 'do'
        ? runInDurableObject(tenantStub(e, 1), (_i, state) => { state.storage.sql.exec(sql); })
        : void e.DB.prepare(sql).run();
    const blockInvoices = `CREATE TRIGGER no_inv_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT, 'invoice update blocked'); END`;

    it('payment ghi xong nhưng UPDATE hoá đơn lỗi: cả năm màn hình vẫn Đã đóng, replay ghi đúng một lần, không cộng trùng', async () => {
      await sqlOf(blockInvoices);
      try {
        const r = await webhook(DEV_KEY, { id: 5151, transferAmount: 3_500_000, content: LVC_CODE });
        expect(r).toMatchObject({ status: 200, body: { success: true, rent: { settled: false, deferred: true } } });
        expect(await payments(backend)).toMatchObject([{ amount: 3_500_000, reference: 'sepay-5151' }]); // booked
        expect((await lvcInvoice(backend))!.status).toBe('unpaid'); // invoice row lags
        expect(await events()).toMatchObject([{ sepay_id: '5151', status: 'deferred' }]);
        expect(view(await seen(tokens))).toEqual(everyone('paid'));
      } finally {
        await sqlOf('DROP TRIGGER no_inv_update');
      }
      expect(await replayDeferred(e, 1)).toBe(1);
      expect((await payments(backend)).length).toBe(1); // booked once
      expect((await lvcInvoice(backend))!.status).toBe('paid');
      expect(await events()).toMatchObject([{ status: 'done' }]);
      expect(view(await seen(tokens))).toEqual(everyone('paid'));
    });

    it('payment ghi nhưng UPDATE hoá đơn lỗi, tiền mới là một phần: vẫn chưa đóng; phần còn lại đủ thì Đã đóng (không cộng trùng)', async () => {
      await sqlOf(blockInvoices);
      try {
        await webhook(DEV_KEY, { id: 5252, transferAmount: 1_000_000, content: LVC_CODE });
        expect(await payments(backend)).toMatchObject([{ amount: 1_000_000 }]);
        expect(view(await seen(tokens))).toEqual(everyone('unpaid')); // 1M booked, the open event adds nothing again
        await webhook(DEV_KEY, { id: 5253, transferAmount: 2_500_000, content: LVC_CODE });
        expect(view(await seen(tokens))).toEqual(everyone('paid')); // 1M + 2.5M
      } finally {
        await sqlOf('DROP TRIGGER no_inv_update');
      }
      expect(await replayDeferred(e, 1)).toBe(1); // only the 2.5M event was left open
      expect((await payments(backend)).length).toBe(2);
      expect((await lvcInvoice(backend))!.status).toBe('paid');
    });
  }

  it('mark-paid: tiền đã về (deferred) thì trả Đã đóng, không ghi; chưa có tiền thì ghi (503 khi kho đang khoá)', async () => {
    const claim = () => api('/api/payment/mark-paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '11/2026' }) }, tokens.resident);
    if (mode === 'migrating') {
      const r = await claim();
      expect(r.status).toBe(503);
      expect(((await r.json()) as any).errorCode).toBe('TENANT_MIGRATING');
    }
    await webhook(DEV_KEY, { id: 6161, transferAmount: 3_500_000, content: LVC_CODE });
    const ok = await claim();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).status.paymentStatus).toBe('paid');
    const stored = (await lvcInvoice(mode === 'migrating' ? 'd1' : backend))!.status;
    expect(stored).toBe(mode === 'migrating' ? 'unpaid' : 'paid'); // nothing was written while migrating
  });

  it('giặt sấy vẫn chuyển sang Express', async () => {
    const real = globalThis.fetch;
    const seenUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('onrender.com')) { seenUrls.push(url); return new Response('{}'); }
      return real(input, init);
    });
    const r = await webhook(DEV_KEY, { transferAmount: 30_000, content: 'MG3 giat say' });
    expect(r.body.kind).toBe('laundry');
    await vi.waitFor(() => expect(seenUrls).toEqual(['https://tro-hub.onrender.com/api/sepay/webhook']));
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(0);
  });
});

describe('tiền chờ (migrating) và xử lý lại', () => {
  const tokensOf = async () => ({ resident: await login(PHONES.residentLvc), owner: await login(PHONES.owner), manager: await login(PHONES.manager) });
  afterEach(() => vi.restoreAllMocks());

  /** The Sheet is the old one for LVC and SHEET_WRITES is on: every paint shows up as an Apps Script call. */
  async function withSheet() {
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('legacy_sheet_id', 'SHEET') ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
      e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('legacy_sheet_houses', 'LVC') ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
    ]);
    const paints: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('script.google.com')) { paints.push(url); return new Response('{}'); }
      return real(input, init);
    });
    return paints;
  }
  beforeEach(async () => {
    await world('d1');
  });

  it('migrating + đủ tiền: Sheet được tô "đã trả" đúng 1 lần (qua webhook)', async () => {
    const paints = await withSheet();
    (e as any).SHEET_WRITES = 'on';
    try {
      await setStorage(e.DB, 1, 'migrating');
      await webhook(DEV_KEY, { id: 1, transferAmount: 2_000_000, content: LVC_CODE });
      expect(paints).toEqual([]); // not enough yet
      await webhook(DEV_KEY, { id: 2, transferAmount: 1_500_000, content: LVC_CODE });
      expect(paints.length).toBe(1);
      expect(paints[0]).toContain('action=update_payment');
      expect(paints[0]).toContain('status=paid');
      expect(paints[0]).toContain('room=LVC-101');
      await webhook(DEV_KEY, { id: 3, transferAmount: 1_000, content: LVC_CODE }); // overpay: no second paint
      expect(paints.length).toBe(1);
    } finally {
      (e as any).SHEET_WRITES = 'off';
    }
  });

  it('deferRent gọi trực tiếp: tô khi tiền đã ghi + chờ ≥ tổng, mỗi sự kiện một lần', async () => {
    const paints = await withSheet();
    const on = { ...e, SHEET_WRITES: 'on' } as Env;
    const db = e.DB;
    const inv = (await lvcInvoice('d1'))!;
    // 1.5M was booked before the move, 1M and then 1M wait.
    await db.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 1500000, 'bank', 'B1', '2026-11-05')`).bind(inv.id).run();
    await setStorage(e.DB, 1, 'migrating');
    await insertEvent('D1', 1_000_000, 'deferred');
    await deferRent(on, 1, 'LVC', '101', MONTH, 'D1');
    expect(paints).toEqual([]);
    await insertEvent('D2', 1_000_000, 'done');
    await deferRent(on, 1, 'LVC', '101', MONTH, 'D2');
    expect(paints.length).toBe(1);
    expect((await events()).map((x) => x.status)).toEqual(['deferred', 'deferred']);
    // SHEET_WRITES=off paints nothing.
    await insertEvent('D3', 5_000_000, 'done');
    await deferRent(e, 1, 'LVC', '101', MONTH, 'D3');
    expect(paints.length).toBe(1);
  });

  it('replay: ghi vào kho, đặt done, hai lần chỉ ghi một lần', async () => {
    await insertEvent('R1', 3_500_000, 'deferred');
    await insertEvent('R2', 100, 'deferred');
    expect(await replayDeferred(e, 1)).toBe(2);
    expect((await events()).map((x) => x.status)).toEqual(['done', 'done']);
    expect((await payments('d1')).map((p) => p.amount)).toEqual([3_500_000, 100]);
    expect((await lvcInvoice('d1'))!.status).toBe('paid');
    expect(await replayDeferred(e, 1)).toBe(0);
    expect((await payments('d1')).length).toBe(2);
    expect(view(await seen(await tokensOf2()))).toEqual(everyone('paid'));
  });

  const tokensOf2 = async () => {
    await e.DB.prepare(`INSERT OR IGNORE INTO staff_houses (staff_id, house_id) VALUES (2, 'LVC')`).run();
    return tokensOf();
  };

  it('replay: lúc payments được ghi, sự kiện đã không còn "deferred" (không cộng trùng)', async () => {
    await insertEvent('O1', 3_500_000, 'deferred');
    const real = e.DB;
    const statusAtInsert: string[] = [];
    // Wrap the statement so its run() first reports the event's status at the moment of the payment insert.
    const wrap = (stmt: D1PreparedStatement, isInsert: boolean): D1PreparedStatement => ({
      bind: (...a: unknown[]) => wrap(stmt.bind(...a), isInsert),
      first: (c?: string) => stmt.first(c as string),
      all: () => stmt.all(),
      raw: () => stmt.raw(),
      run: async () => {
        if (isInsert) statusAtInsert.push((await real.prepare(`SELECT status FROM sepay_events WHERE sepay_id = 'O1'`).first<{ status: string }>())!.status);
        return stmt.run();
      },
    }) as D1PreparedStatement;
    const spyDb = {
      prepare: (sql: string) => wrap(real.prepare(sql), /INSERT OR IGNORE INTO payments/.test(sql)),
      batch: (x: D1PreparedStatement[]) => real.batch(x),
    } as unknown as D1Database;
    expect(await replayDeferred({ ...e, DB: spyDb } as Env, 1)).toBe(1);
    expect(statusAtInsert).toEqual(['replaying']);
    expect((await events())[0].status).toBe('done');
  });

  it('giữa lúc replay (INSERT payments đang treo): các màn hình vẫn đọc Đã đóng', async () => {
    await insertEvent('G1', 3_500_000, 'deferred');
    await e.DB.prepare(`INSERT OR IGNORE INTO staff_houses (staff_id, house_id) VALUES (2, 'LVC')`).run();
    const tokens = await tokensOf();
    const real = e.DB;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let blocked!: () => void;
    const reached = new Promise<void>((r) => { blocked = r; });
    const wrap = (stmt: D1PreparedStatement, hold: boolean): D1PreparedStatement => ({
      bind: (...a: unknown[]) => wrap(stmt.bind(...a), hold),
      first: (c?: string) => stmt.first(c as string),
      all: () => stmt.all(),
      raw: () => stmt.raw(),
      run: async () => { if (hold) { blocked(); await gate; } return stmt.run(); },
    }) as D1PreparedStatement;
    const slow = { prepare: (sql: string) => wrap(real.prepare(sql), /INSERT OR IGNORE INTO payments/.test(sql)), batch: (x: D1PreparedStatement[]) => real.batch(x) } as unknown as D1Database;
    const replay = replayDeferred({ ...e, DB: slow } as Env, 1);
    await reached;
    expect((await events())[0].status).toBe('replaying');
    expect(view(await seen(tokens))).toEqual(everyone('paid')); // payment not written yet, money still counted
    release();
    expect(await replay).toBe(1);
    expect(view(await seen(tokens))).toEqual(everyone('paid'));
    expect((await payments('d1')).length).toBe(1);
  });

  it('replay tô Sheet "đã trả" đúng một lần khi chính nó làm hoá đơn thành paid', async () => {
    const paints = await withSheet();
    await insertEvent('K1', 2_000_000, 'deferred');
    await insertEvent('K2', 1_500_000, 'deferred');
    expect(await replayDeferred({ ...e, SHEET_WRITES: 'on' } as Env, 1)).toBe(2);
    expect(paints.length).toBe(1);
    expect(paints[0]).toContain('status=paid');
    expect((await lvcInvoice('d1'))!.status).toBe('paid');
  });

  it('replay vào kho riêng (do)', async () => {
    await world('do');
    await insertEvent('R1', 3_500_000, 'deferred');
    expect(await replayDeferred(e, 1)).toBe(1);
    expect(await payments('do')).toMatchObject([{ house_id: 'LVC', amount: 3_500_000, reference: 'sepay-R1' }]);
    expect((await lvcInvoice('do'))!.status).toBe('paid');
    expect(await replayDeferred(e, 1)).toBe(0);
    expect((await payments('do')).length).toBe(1);
  });

  it('replay không mở khoảng cộng trùng: sự kiện rời deferred trước khi payments được ghi', async () => {
    // Crash after the event left 'deferred' but before the payment: the next run books it.
    await insertEvent('C1', 3_500_000, 'replaying');
    expect(await replayPendingDeferred(e)).toBe(1);
    expect((await payments('d1')).map((p) => p.amount)).toEqual([3_500_000]);
    expect((await events())[0].status).toBe('done');
  });

  it('replay: payments đã ghi rồi mới sập → không cộng trùng, cả lúc chờ lẫn sau đó', async () => {
    await insertEvent('C2', 2_000_000, 'replaying');
    const inv = (await lvcInvoice('d1'))!;
    await e.DB.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 2000000, 'bank', 'sepay-C2', '2026-11-17')`).bind(inv.id).run();
    // 2M booked + 2M of the same event must not read as 4M ≥ 3.5M while the event waits.
    expect(view(await seen(await tokensOf2()))).toEqual(everyone('unpaid'));
    expect(await replayDeferred(e, 1)).toBe(1);
    expect((await payments('d1')).length).toBe(1);
    expect((await lvcInvoice('d1'))!.status).toBe('unpaid');
    expect(view(await seen(await tokensOf2()))).toEqual(everyone('unpaid'));
  });

  it('replayPendingDeferred bỏ qua chủ trọ đang migrating, xử lý khi hết khoá', async () => {
    await insertEvent('P1', 3_500_000, 'deferred');
    await setStorage(e.DB, 1, 'migrating');
    expect(await replayPendingDeferred(e)).toBe(0);
    expect(await replayDeferred(e, 1)).toBe(0);
    expect((await events())[0].status).toBe('deferred');
    expect(await payments('d1')).toEqual([]);
    await setStorage(e.DB, 1, 'd1');
    expect(await replayPendingDeferred(e)).toBe(1);
    expect((await events())[0].status).toBe('done');
    expect(await replayPendingDeferred(e)).toBe(0);
  });

  it('khoá hết hạn giữa chừng: tiền vẫn hiện Đã đóng, rồi được ghi', async () => {
    await setStorage(e.DB, 1, 'migrating', { lockMinutes: -1 }); // already expired → reads as d1
    const r = await webhook(DEV_KEY, { transferAmount: 3_500_000, content: LVC_CODE });
    expect(r.body.rent).toMatchObject({ settled: true });
    expect((await lvcInvoice('d1'))!.status).toBe('paid');
  });
});

describe.each(BACKENDS)('phí dịch vụ (%s)', (backend) => {
  let dev: string;
  beforeEach(async () => {
    await world(backend);
    await e.DB.prepare(`UPDATE service_modules SET price_per_room = 1000 WHERE key = 'meter'`).run();
    dev = await login(PHONES.developer);
  });
  afterEach(() => e.DB.prepare(`UPDATE service_modules SET price_per_room = 0`).run());

  it('số phòng lấy từ kho của từng chủ trọ', async () => {
    const store1 = await tenantOfOwner(e, 1);
    // A third room only in landlord 1's own database (the store, or D1 for the d1 backend).
    await store1.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (50, 'LVC', '102', 1)`).run();
    await store1.prepare(`INSERT INTO rooms (id, house_id, name, price, deleted_at) VALUES (51, 'LVC', '103', 1, datetime('now'))`).run();
    const make = await api('/api/dev/billing/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: MONTH }) }, dev);
    expect(await make.json()).toMatchObject({ success: true, created: 2 });
    const data = (await (await api(`/api/dev/billing?month=${MONTH}`, {}, dev)).json()) as any;
    const byOwner = Object.fromEntries(data.invoices.map((i: any) => [i.owner_id, i]));
    expect(byOwner[1].detail.map((h: any) => [h.id, h.rooms]).sort()).toEqual([['LVC', 2], ['TRUNG_KIM', 1]]);
    expect(byOwner[1].amount).toBe(3000);
    expect(byOwner[4].detail.map((h: any) => [h.id, h.rooms])).toEqual([['NTTD', 2]]);
    expect(byOwner[4].amount).toBe(2000);
    expect(data.unbilled).toBe(0);
    // Billing the same month twice skips landlords already billed.
    expect(await (await api('/api/dev/billing/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: MONTH }) }, dev)).json()).toMatchObject({ created: 0 });
  });

  it('thanh toán phí dịch vụ: webhook key Developer khớp mã hoá đơn, không đụng tiền trọ', async () => {
    await api('/api/dev/billing/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: MONTH }) }, dev);
    const inv = (await e.DB.prepare(`SELECT code, amount FROM service_invoices WHERE owner_id = 1`).first<{ code: string; amount: number }>())!;
    const r = await webhook(DEV_KEY, { transferAmount: inv.amount, content: `CT ${inv.code} PHI TRO HUB` });
    expect(r.body).toMatchObject({ kind: 'service', matched: true, settled: true });
    expect((await e.DB.prepare(`SELECT status FROM service_invoices WHERE owner_id = 1`).first<{ status: string }>())!.status).toBe('paid');
    // A landlord's key never settles a service invoice.
    const other = (await e.DB.prepare(`SELECT code, amount FROM service_invoices WHERE owner_id = 4`).first<{ code: string; amount: number }>())!;
    const r2 = await webhook(OWNER4_KEY, { transferAmount: other.amount, content: other.code });
    expect(r2.body.kind).not.toBe('service');
    expect((await e.DB.prepare(`SELECT status FROM service_invoices WHERE owner_id = 4`).first<{ status: string }>())!.status).toBe('unpaid');
  });

  it('/api/dev/sepay, khoá thủ công, mô phỏng và QR chạy trên route mới', async () => {
    const list = (await (await api('/api/dev/sepay', {}, dev)).json()) as any;
    expect(list).toMatchObject({ success: true, manual: { 1: { keyHint: 'ey_1' }, 4: { keyHint: 'ey_4' } } });
    const key = (await (await api('/api/dev/landlords/1/sepay/manual-key', { method: 'POST' }, dev)).json()) as any;
    expect(key.key).toMatch(/^th_/);
    expect((await webhook(OWNER1_KEY, { transferAmount: 1, content: 'x' })).status).toBe(401); // the old key stopped working
    expect((await webhook(key.key, { transferAmount: 1, content: 'x' })).status).toBe(200);
    expect((await api('/api/dev/landlords/999/sepay/manual-key', { method: 'POST' }, dev)).status).toBe(404);
    expect((await api('/qr.png?acc=%24%24', {})).status).toBe(400);
    expect((await api('/api/sepay/oauth/callback?code=x&state=bad', {})).status).toBe(400);
    expect((await api('/api/dev/billing', {}, await login(PHONES.owner))).status).toBe(403);
  });
});
