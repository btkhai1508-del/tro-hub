import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage } from '../src/central/directory.ts';
import { effectiveStatus } from '../src/central/deferred.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld, type BackendName } from './helpers.ts';

const e = env as unknown as Env;
const gateStatementFor = (db: Awaited<ReturnType<typeof tenantOfOwner>>, houseId: string, value: 'START' | 'STOP') =>
  db.prepare(`INSERT INTO payment_gates (house_id, month, value, updated_by) VALUES (?, ?, ?, 'test')`).bind(houseId, MONTH, value).run();
const MONTH = '2026-11';
const Q = 'month=11/2026';

/**
 * Google Sheet stand-in. The Worker runs in the test isolate, so its global fetch can be watched:
 * every call to Google is recorded and answered with a one-tab Sheet (11/2026: LVC-101 at 4.000.000).
 */
let sheetCalls: string[] = [];
const SHEET_HTML = `{name: "11/2026", pageUrl: "https://docs.google.com/x?gid=777"}`;
const SHEET_CSV = ['Tiêu đề', 'Số phòng,a,b', 'đơn vị', 'LVC-101,10,20,,1,3,,0,0,"4.000.000 đ",,,,,,"4.000.000 đ"'].join('\n');
function watchSheet() {
  sheetCalls = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (/google\.com/.test(url)) {
      sheetCalls.push(url);
      if (url.includes('/htmlview')) return new Response(SHEET_HTML);
      if (url.includes('/export')) return new Response(SHEET_CSV);
      return new Response('{}');
    }
    return real(input, init);
  });
}

/** Pretend the Sheet was read a moment ago, so the read APIs don't sync. */
const markSynced = () =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(`legacy_sync:${MONTH}`, new Date().toISOString()).run();
const clearSynced = () => e.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(`legacy_sync:${MONTH}`).run();

let seq = 0;
/** A SePay rent transfer recorded centrally while the landlord's store could not take it. */
const deferEvent = (amount: number, over: { status?: string; kind?: string; room?: string; house?: string; month?: string } = {}) =>
  e.DB.prepare(
    `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES (?, ?, ?, 'x', ?, ?, ?, 1, ?)`
  ).bind(`T8-${++seq}`, over.kind ?? 'rent', amount, over.house ?? 'LVC', over.room ?? '101', over.month ?? MONTH, over.status ?? 'deferred').run();

interface Seen { resident: string; staffStatus: string; ownerBilling: string; managerBilling: string; ownerInvoices: string; managerInvoices: string; residentInvoices: string }

/** LVC/101 as the resident, the landlord and the manager each see it. */
async function lvc101(tokens: { resident: string; owner: string; manager: string }): Promise<Seen> {
  const get = async (path: string, token: string) => {
    const res = await api(path, {}, token);
    expect(res.status, path).toBe(200);
    return (await res.json()) as any;
  };
  const billingOf = async (t: string) => (await get(`/api/admin/billing?${Q}`, t)).billing.find((b: any) => b.room === 'LVC-101');
  const invoiceOf = async (t: string) => (await get(`/api/houses/LVC/invoices?month=${MONTH}`, t)).invoices.find((i: any) => i.room_name === '101');
  const resident = await get(`/api/payment/status?${Q}`, tokens.resident);
  const staffStatus = await get(`/api/payment/status?${Q}&room=LVC-101`, tokens.owner);
  const ownerBilling = await billingOf(tokens.owner);
  const managerBilling = await billingOf(tokens.manager);
  // The dashboard has no per-room status; it must still answer.
  await get(`/api/admin/dashboard?${Q}`, tokens.owner);
  await get(`/api/admin/dashboard?${Q}`, tokens.manager);
  expect(resident.statusText === 'Đã đóng').toBe(resident.paymentStatus === 'paid');
  expect(ownerBilling.statusText === 'Đã đóng').toBe(ownerBilling.paymentStatus === 'paid');
  return {
    resident: resident.paymentStatus,
    staffStatus: staffStatus.paymentStatus,
    ownerBilling: ownerBilling.paymentStatus,
    managerBilling: managerBilling.paymentStatus,
    ownerInvoices: (await invoiceOf(tokens.owner)).status,
    managerInvoices: (await invoiceOf(tokens.manager)).status,
    residentInvoices: (await invoiceOf(tokens.resident)).status,
  };
}
const all = (s: string): Seen => ({ resident: s, staffStatus: s, ownerBilling: s, managerBilling: s, ownerInvoices: s, managerInvoices: s, residentInvoices: s });

async function storedInvoice(backend: BackendName) {
  const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
  return db.prepare(`SELECT id, status, paid_at FROM invoices WHERE room_id = 3 AND month = ?`).bind(MONTH).first<{ id: number; status: string; paid_at: string | null }>();
}

it('effectiveStatus', () => {
  expect(effectiveStatus('unpaid', 3_500_000, 0, 3_500_000)).toBe('paid');
  expect(effectiveStatus('unpaid', 3_500_000, 1_500_000, 2_000_000)).toBe('paid');
  expect(effectiveStatus('unpaid', 3_500_000, 0, 2_000)).toBe('unpaid');
  expect(effectiveStatus('pending', 3_500_000, 0, 2_000)).toBe('pending');
  expect(effectiveStatus('pending', 3_500_000, 0, 3_500_000)).toBe('paid');
  expect(effectiveStatus('cash', 1, 0, 0)).toBe('cash');
  expect(effectiveStatus('paid', 9, 0, 0)).toBe('paid');
});

type Mode = BackendName | 'migrating';
const MODES: Mode[] = ['d1', 'migrating', 'do'];

describe.each(MODES)('tiền trọ và trạng thái thanh toán (%s)', (mode) => {
  // While migrating, reads come from D1: the d1 seed keeps the business rows there.
  const backend: BackendName = mode === 'do' ? 'do' : 'd1';
  let tokens: { resident: string; owner: string; manager: string };
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    await e.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (2, 'LVC')`).run(); // the manager looks after LVC too
    await markSynced();
    watchSheet();
    tokens = { resident: await login(PHONES.residentLvc), owner: await login(PHONES.owner), manager: await login(PHONES.manager) };
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
  });
  afterEach(() => vi.restoreAllMocks());

  it('không có tiền về: cả hai thấy chưa đóng', async () => {
    expect(await lvc101(tokens)).toEqual(all('unpaid'));
  });

  it('deferred đủ tiền: cư dân và chủ trọ đều thấy Đã đóng (trước khi xử lý lại)', async () => {
    await deferEvent(3_500_000);
    expect(await lvc101(tokens)).toEqual(all('paid'));
    // Nothing was replayed: the stored invoice is still unpaid, no payment row was written.
    expect((await storedInvoice(backend))!.status).toBe('unpaid');
  });

  it('deferred cộng tiền ngân hàng đã ghi: đủ thì Đã đóng', async () => {
    const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
    const inv = await storedInvoice(backend);
    // The bank part arrived before the lock (as written in the store/D1 then).
    if (mode === 'migrating') await setStorage(e.DB, 1, 'd1');
    await db.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 1500000, 'bank', 'R1', '2026-11-05')`).bind(inv!.id).run();
    // Cash isn't money SePay saw; it doesn't count towards the bank total.
    await db.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 1999000, 'cash', 'R2', '2026-11-05')`).bind(inv!.id).run();
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
    await deferEvent(1_999_000);
    expect(await lvc101(tokens)).toEqual(all('unpaid'));
    await deferEvent(1_000);
    expect(await lvc101(tokens)).toEqual(all('paid'));
  });

  it('deferred thiếu: cả hai thấy chưa đóng', async () => {
    await deferEvent(2_000);
    // Events that don't count: already replayed (done), not rent, another room or month.
    await deferEvent(3_500_000, { status: 'done' });
    await deferEvent(3_500_000, { kind: 'laundry' });
    await deferEvent(3_500_000, { room: '102' });
    await deferEvent(3_500_000, { month: '2026-10' });
    expect(await lvc101(tokens)).toEqual(all('unpaid'));
  });

  it('chủ trọ đã đánh dấu tiền mặt: vẫn là tiền mặt dù có deferred', async () => {
    const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
    if (mode === 'migrating') await setStorage(e.DB, 1, 'd1');
    await db.prepare(`UPDATE invoices SET status = 'cash', paid_at = '2026-11-03 01:00:00' WHERE room_id = 3 AND month = ?`).bind(MONTH).run();
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
    await deferEvent(3_500_000);
    const res = await api(`/api/payment/status?${Q}`, {}, tokens.resident);
    expect(await res.json()).toMatchObject({ paymentStatus: 'paid', paymentMethod: 'cash', label: 'Đã thanh toán tiền mặt ngày 03/11/2026' });
  });

  it('một phòng khác không bị ảnh hưởng', async () => {
    await deferEvent(3_500_000);
    const res = await api(`/api/admin/billing?${Q}`, {}, tokens.owner);
    const billing = ((await res.json()) as any).billing as any[];
    expect(billing.find((b) => b.room === '101')).toMatchObject({ houseId: 'TRUNG_KIM', paymentStatus: 'unpaid' });
  });

  it('các API đọc khác trả 200 (payments, months, gate)', async () => {
    for (const path of ['/api/houses/LVC/payments', '/api/admin/months', `/api/payment/gate?${Q}`, `/api/admin/payment-gate?${Q}`]) {
      const res = await api(path, {}, tokens.owner);
      expect(res.status, path).toBe(200);
    }
    expect((await api(`/api/payment/gate?${Q}`, {}, tokens.resident)).status).toBe(200);
  });

  if (mode === 'migrating') {
    it('migrating: API đọc trả 200, không tải Sheet, không ghi', async () => {
      await clearSynced(); // the month is stale: outside a lock this would read the Sheet
      await e.DB.prepare(`DELETE FROM payment_gates`).run();
      for (const path of [`/api/admin/dashboard?${Q}`, `/api/admin/billing?${Q}`, `/api/payment/gate?${Q}`, `/api/admin/payment-gate?${Q}`]) {
        const res = await api(path, {}, tokens.owner);
        expect(res.status, path).toBe(200);
      }
      const status = await api(`/api/payment/status?${Q}`, {}, tokens.resident);
      expect(status.status).toBe(200);
      expect(sheetCalls.filter((u) => u.includes('/export'))).toEqual([]);
      expect(sheetCalls.filter((u) => u.includes('docs.google.com'))).toEqual([]);
      expect(await e.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(`legacy_sync:${MONTH}`).first()).toBeNull();
      expect((await storedInvoice('d1'))!).toMatchObject({ status: 'unpaid' });
      expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM payment_gates`).first<{ n: number }>())!.n).toBe(0);
    });

    it('migrating: ghi trả 503 TENANT_MIGRATING', async () => {
      const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      for (const [path, body, token] of [
        ['/api/admin/payment-status', { roomNumber: 'LVC-101', status: 'cash', month: '11/2026' }, tokens.owner],
        ['/api/admin/payment-gate', { month: '11/2026', value: 'START' }, tokens.owner],
        ['/api/payment/mark-paid', { month: '11/2026' }, tokens.resident],
      ] as const) {
        const res = await api(path, json(body), token);
        expect(res.status, path).toBe(503);
        expect(await res.json()).toMatchObject({ success: false, errorCode: 'TENANT_MIGRATING' });
      }
    });
  } else {
    it('Sheet cũ: tháng cũ được đọc lại vào kho của chủ trọ', async () => {
      await clearSynced();
      const res = await api(`/api/admin/billing?${Q}`, {}, tokens.owner);
      expect(res.status).toBe(200);
      expect(sheetCalls.some((u) => u.includes('/export'))).toBe(true);
      const row = ((await res.json()) as any).billing.find((b: any) => b.room === 'LVC-101');
      expect(row).toMatchObject({ tongTien: 4_000_000, dienCu: 10, dienMoi: 20, row: 4 });
      expect(await e.DB.prepare(`SELECT 1 AS ok FROM settings WHERE key = ?`).bind(`legacy_sync:${MONTH}`).first()).toEqual({ ok: 1 });
    });

    it('ghi trạng thái, cổng thanh toán và báo đã chuyển khoản đi vào kho của chủ trọ', async () => {
      const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const claim = await api('/api/payment/mark-paid', json({ month: '11/2026' }), tokens.resident);
      expect(await claim.json()).toMatchObject({ success: true, status: { paymentStatus: 'pending' } });
      expect((await storedInvoice(backend))!.status).toBe('pending');
      const set = await api('/api/admin/payment-status', json({ roomNumber: 'LVC-101', status: 'cash', month: '11/2026' }), tokens.owner);
      expect(set.status).toBe(200);
      expect((await storedInvoice(backend))!.status).toBe('cash');
      const gate = await api('/api/admin/payment-gate', json({ month: '11/2026', value: 'START' }), tokens.owner);
      expect(gate.status).toBe(200);
      expect(await (await api(`/api/payment/gate?${Q}`, {}, tokens.resident)).json()).toMatchObject({ value: 'START' });
    });

    const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const statusOf = async (roomId: number) => {
      const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
      return (await db.prepare(`SELECT status FROM invoices WHERE room_id = ? AND month = ?`).bind(roomId, MONTH).first<{ status: string }>())!.status;
    };

    it('payment-status with houseId picks the room of that house when two houses share the name', async () => {
      // Cả TRUNG_KIM (id 1) và LVC (id 3) của cùng chủ trọ có phòng "A1".
      const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
      await db.prepare(`UPDATE rooms SET name = 'A1' WHERE id IN (1, 3)`).run();
      // Có houseId: đúng căn đó, căn kia không đổi.
      const res = await api('/api/admin/payment-status', post({ roomNumber: 'A1', status: 'paid', month: '11/2026', houseId: 'LVC' }), tokens.owner);
      expect(res.status).toBe(200);
      expect(await statusOf(3)).toBe('paid');
      expect(await statusOf(1)).toBe('unpaid');
      // Không có houseId: hành vi cũ (tên trần thuộc Trung Kim theo mã cũ), không nhầm sang LVC.
      await api('/api/admin/payment-status', post({ roomNumber: 'A1', status: 'unpaid', month: '11/2026', houseId: 'LVC' }), tokens.owner);
      const legacy = await api('/api/admin/payment-status', post({ roomNumber: 'A1', status: 'cash', month: '11/2026' }), tokens.owner);
      expect(legacy.status).toBe(200);
      expect(await statusOf(1)).toBe('cash');
      expect(await statusOf(3)).toBe('unpaid');
      // Căn không có phòng đó: 404.
      const none = await api('/api/admin/payment-status', post({ roomNumber: 'Z9', status: 'paid', month: '11/2026', houseId: 'LVC' }), tokens.owner);
      expect(none.status).toBe(404);
      expect(await none.json()).toMatchObject({ success: false, errorCode: 'ROOM_NOT_FOUND' });
    });

    it('payment-status rejects a houseId the staff does not manage', async () => {
      for (const token of [tokens.owner, tokens.manager]) {
        const res = await api('/api/admin/payment-status', post({ roomNumber: '101', status: 'paid', month: '11/2026', houseId: 'NTTD' }), token);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ success: false, errorCode: 'HOUSE_FORBIDDEN' });
      }
      expect(await statusOf(3)).toBe('unpaid');
    });

    it('payment-gate GET aggregates all houses', async () => {
      const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
      await gateStatementFor(db, 'LVC', 'START');
      const get = async () => (await (await api(`/api/admin/payment-gate?${Q}`, {}, tokens.owner)).json()) as any;
      expect(await get()).toMatchObject({ success: true, month: '11/2026', value: 'STOP', mixed: true, houses: { LVC: 'START', TRUNG_KIM: 'STOP' } });
      const set = await api('/api/admin/payment-gate', post({ month: '11/2026', value: 'START' }), tokens.owner);
      expect(await set.json()).toMatchObject({ success: true, value: 'START', mixed: false, houses: { LVC: 'START', TRUNG_KIM: 'START' } });
      expect(await get()).toMatchObject({ value: 'START', mixed: false });
    });
  }
});

describe('JSON hoá đơn giống nhau giữa hai backend', () => {
  afterEach(() => vi.restoreAllMocks());

  it('JSON hoá đơn giống nhau giữa hai backend', async () => {
    const drop = new Set(['id', 'invoiceId', 'invoice_id', 'created_at']);
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, strip(x)])) : v;
    const snapshot = async (backend: BackendName) => {
      await seedWorld(backend);
      await e.DB.prepare(`DELETE FROM sepay_events`).run();
      await markSynced();
      watchSheet();
      await deferEvent(3_500_000);
      const owner = await login(PHONES.owner);
      const resident = await login(PHONES.residentLvc);
      const db = backend === 'do' ? await tenantOfOwner(e, 1) : e.DB;
      await db.prepare(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES ('TRUNG_KIM', 1, ?, 1, 9, 2, 5)`).bind(MONTH).run();
      const out: Record<string, unknown> = {};
      for (const [path, token] of [
        [`/api/houses/LVC/invoices`, owner], [`/api/houses/TRUNG_KIM/invoices?month=${MONTH}`, owner], [`/api/houses/LVC/invoices`, resident],
        [`/api/admin/billing?${Q}`, owner], [`/api/admin/dashboard?${Q}`, owner], [`/api/payment/status?${Q}`, resident],
        [`/api/payment/status?${Q}&room=101`, owner], ['/api/houses/LVC/payments', owner],
      ] as const) {
        const res = await api(path, {}, token);
        expect(res.status, `${backend} ${path}`).toBe(200);
        out[`${path} ${token === owner ? 'owner' : 'resident'}`] = strip(await res.json());
      }
      vi.restoreAllMocks();
      return out;
    };
    const d1 = await snapshot('d1');
    const store = await snapshot('do');
    expect(store).toEqual(d1);
    expect((d1[`/api/houses/LVC/invoices resident`] as any).invoices[0]).toMatchObject({ status: 'paid', total: 3_500_000 });
  });
});
