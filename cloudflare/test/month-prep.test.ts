import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { adminDefaultMonth, prepMonth } from '../src/billing/period.ts';
import { feeConfigFor } from '../src/billing/fees.ts';
import { recompute } from '../src/billing/invoices.ts';
import { FREQUENT_CRON, MONTH_CRON, runCron } from '../src/cron.ts';
import { drainExportQueue } from '../src/sheetExport.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const store = () => tenantOfOwner(e, 1);
const NOV = '2026-11';
const DEC = '2026-12';
// Vietnam is UTC+7: hh:mm there = hh-7:mm UTC.
const vn = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h - 7, min, 0);
const setSource = (v: 'sheet' | 'worker') =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('source_of_truth', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(v).run();
const call = async (phone: string, method: string, path: string, body?: unknown) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, await login(phone));
const json = async (res: Response) => (await res.json()) as any;
const invoiceOf = async (house: string, room: string, month: string) =>
  (await store()).prepare(`SELECT i.* FROM invoices i JOIN rooms r ON r.id = i.room_id WHERE i.house_id = ? AND r.name = ? AND i.month = ?`).bind(house, room, month).first<any>();
const decCount = async () => (await (await store()).prepare(`SELECT COUNT(*) AS n FROM invoices WHERE month = ?`).bind(DEC).first<{ n: number }>())!.n;
const snapshotCount = async (month: string) =>
  (await (await store()).prepare(`SELECT COUNT(*) AS n FROM house_fee_months WHERE month = ? AND house_id IN ('LVC', 'TRUNG_KIM')`).bind(month).first<{ n: number }>())!.n;
const mark = async (key: string) => (await e.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>())?.value ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(vn(2026, 11, 20, 12));
});
afterEach(() => {
  (e as any).SHEET_WRITES = 'off';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('prepMonth / adminDefaultMonth', () => {
  it('5 ngày cuối tháng theo giờ Việt Nam', () => {
    expect(prepMonth(vn(2026, 11, 26, 0, 0))).toBe('2026-12');
    expect(prepMonth(vn(2026, 11, 25, 23, 59))).toBeNull();
    expect(prepMonth(vn(2026, 11, 30, 23, 59))).toBe('2026-12');
    expect(prepMonth(vn(2026, 12, 1, 0, 0))).toBeNull();
    expect(prepMonth(vn(2026, 12, 27))).toBe('2027-01');
    expect(prepMonth(vn(2026, 12, 26, 23, 59))).toBeNull();
    expect(prepMonth(vn(2027, 2, 24))).toBe('2027-03');
    expect(prepMonth(vn(2027, 2, 23, 23, 59))).toBeNull();
    expect(prepMonth(vn(2028, 2, 25))).toBe('2028-03');
    expect(prepMonth(vn(2028, 2, 24))).toBeNull();
    expect(prepMonth(vn(2026, 10, 27))).toBe('2026-11'); // 31-day month
    expect(prepMonth(vn(2026, 10, 26, 23, 59))).toBeNull();
  });

  it('giờ UTC khác ngày VN: 17:00 UTC 25/11 đã là 00:00 26/11 ở Việt Nam', () => {
    expect(prepMonth(Date.UTC(2026, 10, 25, 17, 0, 0))).toBe('2026-12');
    expect(prepMonth(Date.UTC(2026, 10, 25, 16, 59, 59))).toBeNull();
  });

  it('adminDefaultMonth = tháng chuẩn bị, không thì tháng hiện tại', () => {
    expect(adminDefaultMonth(vn(2026, 11, 20))).toBe('2026-11');
    expect(adminDefaultMonth(vn(2026, 11, 28))).toBe('2026-12');
    expect(adminDefaultMonth(vn(2026, 12, 1))).toBe('2026-12');
  });
});

describe.each(BACKENDS)('chuẩn bị tháng sau 5 ngày cuối tháng [%s]', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000), ('TRUNG_KIM', 3500, 20000)`),
    ]);
    await setSource('worker');
    await feeConfigFor(db, 'LVC', NOV);
    await feeConfigFor(db, 'TRUNG_KIM', NOV);
    await e.DB.prepare(`DELETE FROM settings WHERE key = 'month_prepared'`).run();
  });

  describe('thêm người ở ghép (đợt 4)', () => {
    const addResident = (roomId: number, phone: string) =>
      call(PHONES.owner, 'POST', '/api/houses/LVC/residents', { fullName: `Người ${phone}`, phone, password: '123456', roomId });

    it('đang chuẩn bị tháng sau: phòng trống có người mới thì có nháp cả tháng này lẫn tháng sau', async () => {
      vi.setSystemTime(vn(2026, 11, 27, 9));
      await (await store()).prepare(`INSERT INTO rooms (id, house_id, name, price, capacity) VALUES (7, 'LVC', '102', 2000000, 3)`).run();
      expect((await addResident(7, '0900007001')).status).toBe(200);
      expect(await invoiceOf('LVC', '102', NOV)).toMatchObject({ issued_at: null, people: 1 });
      expect(await invoiceOf('LVC', '102', DEC)).toMatchObject({ issued_at: null, people: 1 });
    });

    it('nháp tháng sau đã có thì được tính lại với số người mới', async () => {
      vi.setSystemTime(vn(2026, 11, 27, 9));
      await (await store()).prepare(`UPDATE rooms SET capacity = 3 WHERE id = 3`).run();
      await runCron(FREQUENT_CRON, e, vn(2026, 11, 27, 9));
      expect(await invoiceOf('LVC', '101', DEC)).toMatchObject({ people: 1 });
      expect((await addResident(3, '0900007002')).status).toBe(200);
      const dec = await invoiceOf('LVC', '101', DEC);
      expect(dec.people).toBe(2);
      expect(dec.internet).toBe(80_000); // Internet 40.000 đ/người
    });

    it('ngoài 5 ngày cuối tháng: chỉ tháng hiện tại', async () => {
      await (await store()).prepare(`INSERT INTO rooms (id, house_id, name, price, capacity) VALUES (7, 'LVC', '102', 2000000, 3)`).run();
      expect((await addResident(7, '0900007003')).status).toBe(200);
      expect(await invoiceOf('LVC', '102', NOV)).not.toBeNull();
      expect(await invoiceOf('LVC', '102', DEC)).toBeNull();
    });
  });

  it('ngày 25/11 chưa tạo gì; 00:00 ngày 26/11 tạo nháp tháng 12 cho mọi phòng có cư dân, chạy lại không ghi thêm', async () => {
    vi.setSystemTime(vn(2026, 11, 25, 23, 59));
    await runCron(MONTH_CRON, e, vn(2026, 11, 25, 23, 59));
    await runCron(FREQUENT_CRON, e, vn(2026, 11, 25, 23, 59));
    expect(await decCount()).toBe(0);
    expect(await snapshotCount(DEC)).toBe(0);
    expect(await mark('month_prepared')).toBeNull();

    const t = vn(2026, 11, 26, 0, 0);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    expect(await invoiceOf('LVC', '101', DEC)).toMatchObject({ issued_at: null, status: 'unpaid' });
    expect(await invoiceOf('TRUNG_KIM', '101', DEC)).toMatchObject({ issued_at: null });
    expect(await decCount()).toBe(2);
    expect(await snapshotCount(DEC)).toBe(2);
    expect(await mark('month_prepared')).toBe(DEC);
    expect(await mark('month_started')).toBe(NOV); // the current month is untouched by the preparation

    // A second run (and the catch-up) writes nothing: remove a draft, it must not come back.
    const db = await store();
    const id = (await invoiceOf('LVC', '101', DEC)).id;
    await db.batch([db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).bind(id), db.prepare(`DELETE FROM invoices WHERE id = ?`).bind(id)]);
    await runCron(FREQUENT_CRON, e, t + 600_000);
    expect(await invoiceOf('LVC', '101', DEC)).toBeNull();
  });

  it('10 phút bắt kịp: lỡ 00:00 ngày 28/11 vẫn tạo nháp tháng 12 một lần', async () => {
    const t = vn(2026, 11, 28, 9, 10);
    vi.setSystemTime(t);
    await runCron(FREQUENT_CRON, e, t);
    expect(await decCount()).toBe(2);
    expect(await mark('month_prepared')).toBe(DEC);
  });

  it('ngày 1/12 00:00 cron chuyển tháng giữ nguyên nháp đã chuẩn bị (không nhân đôi) và đánh dấu tháng 12 đã bắt đầu', async () => {
    const t26 = vn(2026, 11, 26, 0, 0);
    vi.setSystemTime(t26);
    await runCron(MONTH_CRON, e, t26);
    const before = (await invoiceOf('LVC', '101', DEC)).id;
    const t1 = vn(2026, 12, 1, 0, 0);
    vi.setSystemTime(t1);
    await runCron(MONTH_CRON, e, t1);
    expect((await invoiceOf('LVC', '101', DEC)).id).toBe(before);
    expect(await decCount()).toBe(2);
    expect(await mark('month_started')).toBe(DEC);
  });

  it('nháp tháng 12 không hiện với cư dân', async () => {
    const t = vn(2026, 11, 28, 10);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    expect(await decCount()).toBe(2);
    const session = await json(await call(PHONES.residentLvc, 'GET', '/api/tenant/session'));
    expect(JSON.stringify(session)).not.toMatch(/12\/2026|2026-12/);
    const dec = await json(await call(PHONES.residentLvc, 'GET', '/api/payment/status?month=12/2026'));
    expect(dec.invoice ?? null).toBeNull();
    expect(dec.status ?? 'none').not.toBe('paid');
    expect(JSON.stringify(dec)).not.toMatch(/3\d{6}/); // no amount of an invisible draft
  });

  it('issue-month tháng 12 ngày 28/11: tháng sau đã chuẩn bị thì tạo hoá đơn được ngay, cư dân thấy hoá đơn tháng 12', async () => {
    const t = vn(2026, 11, 28, 10);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    const ok = await call(PHONES.owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: '12/2026', force: true });
    expect(ok.status).toBe(200);
    expect((await json(ok)).issued).toBe(1);
    expect((await invoiceOf('LVC', '101', DEC)).issued_at).not.toBeNull();
    // Two months ahead is still refused (only up to next month).
    const far = await call(PHONES.owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: '01/2027', force: true });
    expect(far.status).toBe(400);
  });

  it('nhập chỉ số mới tháng 11 sau khi đã có nháp tháng 12: số cũ và tiền của nháp tháng 12 đổi theo', async () => {
    const t = vn(2026, 11, 27, 8);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    let rooms = await json(await call(PHONES.owner, 'GET', `/api/admin/rooms?houseId=LVC&month=${DEC}`));
    expect(rooms.rooms[0]).toMatchObject({ roomName: '101', dienCu: 0, draft: true });

    const entered = await call(PHONES.owner, 'POST', '/api/admin/room-detail', { month: NOV, room: '101', houseId: 'LVC', data: { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 } });
    expect(entered.status).toBe(200);
    rooms = await json(await call(PHONES.owner, 'GET', `/api/admin/rooms?houseId=LVC&month=${DEC}`));
    expect(rooms.rooms[0]).toMatchObject({ dienCu: 150, nuocCu: 14, draft: true });

    // The December draft is priced from the new old-readings once December numbers are entered.
    const dec = await call(PHONES.owner, 'POST', '/api/admin/room-detail', { month: DEC, room: '101', houseId: 'LVC', data: { dienMoi: 180, nuocMoi: 20 } });
    expect(dec.status).toBe(200);
    expect(await invoiceOf('LVC', '101', DEC)).toMatchObject({ electricity: 30 * 3500, water: 6 * 20_000 });
    // Correcting November afterwards moves December's old reading and its money.
    await call(PHONES.owner, 'POST', '/api/admin/room-detail', { month: NOV, room: '101', houseId: 'LVC', data: { dienMoi: 160 } });
    expect(await invoiceOf('LVC', '101', DEC)).toMatchObject({ electricity: 20 * 3500 });
  });

  it('dòng xuất Sheet của tháng 12: ngày 28/11 không bị thử (attempts = 0), ngày 1/12 được gửi', async () => {
    (e as any).SHEET_WRITES = 'on';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    await e.DB.batch([
      e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sheet_id', 'S'), ('legacy_sheet_houses', 'LVC')`),
      e.DB.prepare(`INSERT INTO sheet_export_queue (kind, payload) VALUES ('meters', ?)`).bind(JSON.stringify({ houseId: 'LVC', room: 'LVC-101', month: '12/2026', dienCu: 150, dienMoi: 180, nuocCu: 14, nuocMoi: 20 })),
      e.DB.prepare(`INSERT INTO sheet_export_queue (kind, payload) VALUES ('meters', ?)`).bind(JSON.stringify({ houseId: 'LVC', room: 'LVC-102', month: '11/2026', dienCu: 1, dienMoi: 2 })),
    ]);
    vi.setSystemTime(vn(2026, 11, 28, 10));
    const r1 = await drainExportQueue(e);
    expect(r1).toEqual({ sent: 1, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const held = await e.DB.prepare(`SELECT attempts, done_at, last_error FROM sheet_export_queue WHERE payload LIKE '%12/2026%'`).first<any>();
    expect(held).toMatchObject({ attempts: 0, done_at: null, last_error: null });

    vi.setSystemTime(vn(2026, 12, 1, 0, 10));
    expect(await drainExportQueue(e)).toEqual({ sent: 1, failed: 0 });
    expect((await e.DB.prepare(`SELECT done_at FROM sheet_export_queue WHERE payload LIKE '%12/2026%'`).first<any>()).done_at).not.toBeNull();
    await e.DB.prepare(`DELETE FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`).run();
  });

  it('/api/admin/months: ngày 20/11 defaultMonth là tháng 11; ngày 28/11 có tháng 12 và defaultMonth = 2026-12', async () => {
    let res = await json(await call(PHONES.owner, 'GET', '/api/admin/months'));
    expect(res.defaultMonth).toBe(NOV);
    expect(res.months).not.toContain('12/2026');

    vi.setSystemTime(vn(2026, 11, 28, 10)); // no drafts yet: the month is listed anyway
    res = await json(await call(PHONES.owner, 'GET', '/api/admin/months'));
    expect(res.defaultMonth).toBe(DEC);
    expect(res.months).toEqual(expect.arrayContaining(['11/2026', '12/2026']));

    vi.setSystemTime(vn(2026, 12, 1, 8));
    res = await json(await call(PHONES.owner, 'GET', '/api/admin/months'));
    expect(res.defaultMonth).toBe(DEC);
  });

  it('chế độ sheet: không tạo gì, không đánh dấu, danh sách tháng không thêm tháng sau, issue-month không bị chặn bởi quy tắc mới', async () => {
    await setSource('sheet');
    const t = vn(2026, 11, 28, 10);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    await runCron(FREQUENT_CRON, e, t);
    expect(await decCount()).toBe(0);
    expect(await snapshotCount(DEC)).toBe(0);
    expect(await mark('month_prepared')).toBeNull();
    const res = await json(await call(PHONES.owner, 'GET', '/api/admin/months'));
    expect(res.months).not.toContain('12/2026');
    expect(res.defaultMonth).toBe(NOV);
  });

  it('cổng thu tiền của tháng chưa bắt đầu luôn là STOP, không thừa hưởng START của tháng này', async () => {
    const db = await store();
    await db.prepare(`INSERT INTO payment_gates (house_id, month, value, updated_by) VALUES ('LVC', ?, 'START', 'test')`).bind(NOV).run();
    vi.setSystemTime(vn(2026, 11, 28, 10));
    const g = await json(await call(PHONES.owner, 'GET', '/api/admin/payment-gate?houseId=LVC&month=12/2026'));
    expect(g.houses.LVC).toBe('STOP');
    const cur = await json(await call(PHONES.owner, 'GET', '/api/admin/payment-gate?houseId=LVC&month=11/2026'));
    expect(cur.houses.LVC).toBe('START');
  });

  it('cấu hình phí tháng sau sửa được trong 5 ngày cuối và nháp tháng sau tính lại', async () => {
    const t = vn(2026, 11, 28, 10);
    vi.setSystemTime(t);
    await runCron(MONTH_CRON, e, t);
    const db = await store();
    await recompute(db, (await invoiceOf('LVC', '101', DEC)).id, { central: e.DB });
    const res = await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', month: DEC, electricPrice: 4000, waterPrice: 20000 });
    expect(res.status).toBe(200);
    expect((await json(res)).editable).toBe(true);
  });
});
