import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { createDrafts } from '../src/billing/invoices.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const OWNER = 1;
const A = '2099-01'; // far enough from "now" that it is never in the past
const B = '2099-02';
const store = () => tenantOfOwner(e, OWNER);

const call = (token: string, method: string, path: string, body?: unknown) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, token);
const json = async (res: Response) => (await res.json()) as any;

const invoiceOf = async (house: string, room: string, month: string) =>
  (await store()).prepare(`SELECT i.* FROM invoices i JOIN rooms r ON r.id = i.room_id WHERE i.house_id = ? AND r.name = ? AND i.month = ?`)
    .bind(house, room, month).first<any>();
const linesOf = async (id: number) =>
  (await (await store()).prepare(`SELECT kind, name, qty, unit_price, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY id`).bind(id).all<any>()).results;

/** Keys the admin screen reads from a room of the list (extracted from AdminPortal.tsx: r./item./localFound.), plus the new ones. */
const FRONTEND_ROOM_KEYS = [
  'row', 'room', 'name', 'phone', 'status', 'statusText', 'paymentStatus',
  'dienCu', 'dienMoi', 'dienUsed', 'nuocCu', 'nuocMoi', 'nuocUsed',
  'tienDien', 'tienNuoc', 'tienPhong', 'tienRac', 'tienNet', 'tienXe', 'tienKhac', 'tienCoc', 'tongTien',
  'nguoi1', 'cccd1', 'sdt1', 'xe1', 'nguoi2', 'cccd2', 'sdt2', 'xe2', 'nguoi3', 'cccd3', 'sdt3', 'xe3', 'soNguoi', 'soXe',
  'draft', 'surplus', 'missingMeters', 'roomId', 'invoiceId',
];
/** Keys of room-detail `data` the screen reads (currentRoomData.*). */
const FRONTEND_DETAIL_KEYS = [
  'row', 'dienCu', 'dienMoi', 'dienUsed', 'nuocCu', 'nuocMoi', 'nuocUsed', 'tienDien', 'tienNuoc', 'tienPhong', 'tienRac', 'tienNet', 'tienXe',
  'tienKhac', 'tienCoc', 'tongTien', 'nguoi1', 'nguoi2', 'nguoi3', 'soNguoi', 'soXe', 'soNet', 'statusHTML', 'paymentStatus', 'draft', 'surplus',
];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(BACKENDS)('API admin điện nước, phí, mở thu tiền [%s]', (backend) => {
  let owner: string;
  let manager: string;
  let otherOwner: string;
  let resident: string;

  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM audit_log`).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sync:2099-01', ?)`).bind(new Date().toISOString()).run();
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000)`),
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, 20000)`),
    ]);
    [owner, manager, otherOwner, resident] = await Promise.all([login(PHONES.owner), login(PHONES.manager), login(PHONES.otherOwner), login(PHONES.residentLvc)]);
  });

  /** Issuing a month needs it to have started: pin the Vietnam clock inside A (a month cannot be issued before its day 1). */
  const startMonthA = async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2099, 0, 15, 5, 0, 0));
    owner = await login(PHONES.owner);
  };

  const enter = (month: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    call(owner, 'POST', '/api/admin/room-detail', { month, room: '101', houseId: 'LVC', data, ...extra });

  describe('POST /api/admin/room-detail', () => {
    it('nhập số lần đầu: tạo nháp, tổng đúng theo công thức (3.500.000 + 175.000 + 80.000 + 30.000 + 40.000 − 10.000)', async () => {
      expect(await invoiceOf('LVC', '101', A)).toBeNull();
      const res = await enter('01/2099', { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toMatchObject({ success: true, invoice: { total: 3_815_000, status: 'unpaid', draft: true, surplus: 0 } });
      const inv = await invoiceOf('LVC', '101', A);
      expect(inv).toMatchObject({ issued_at: null, room_rent: 3_500_000, electricity: 175_000, water: 80_000, other: -10_000, trash: 30_000, internet: 40_000, parking: 0, total: 3_815_000 });
      expect(body.invoice.invoiceId).toBe(inv.id);
      expect(await linesOf(inv.id)).toEqual([
        { kind: 'room', name: 'Tiền phòng', qty: 1, unit_price: 3_500_000, amount: 3_500_000 },
        { kind: 'electricity', name: 'Tiền điện', qty: 50, unit_price: 3500, amount: 175_000 },
        { kind: 'water', name: 'Tiền nước', qty: 4, unit_price: 20_000, amount: 80_000 },
        { kind: 'service', name: 'Rác', qty: 1, unit_price: 30_000, amount: 30_000 },
        { kind: 'service', name: 'Internet', qty: 1, unit_price: 40_000, amount: 40_000 },
        { kind: 'service', name: 'Xe máy', qty: 0, unit_price: 50_000, amount: 0 },
        { kind: 'other', name: 'Khác', qty: 50, unit_price: -200, amount: -10_000 },
      ]);
      expect(body.data).toMatchObject({ dienCu: 100, dienMoi: 150, dienUsed: 50, nuocUsed: 4, tongTien: 3_815_000 });
    });

    it('sửa lại: chỉ đổi trường được gửi; số cũ 0 giữ số cũ đã lưu', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const res = await enter(A, { dienCu: 0, dienMoi: 160 });
      expect((await json(res)).invoice.total).toBe(3_848_000); // 60 × 3.500 = 210.000, Khác −12.000, nước 80.000
      const row = await (await store()).prepare(`SELECT electric_old, electric_new, water_old, water_new FROM meter_readings WHERE month = ?`).bind(A).first<any>();
      expect(row).toEqual({ electric_old: 100, electric_new: 160, water_old: 10, water_new: 14 });
    });

    it('số mới nhỏ hơn số cũ: 400 METER_INVALID, không ghi gì; số âm hoặc lẻ cũng vậy', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      for (const bad of [{ dienMoi: 90 }, { nuocCu: 10, nuocMoi: 5 }, { dienMoi: -1 }, { dienMoi: 1.5 }, { dienMoi: 'abc' }]) {
        const res = await enter(A, bad);
        expect(res.status, JSON.stringify(bad)).toBe(400);
        expect((await json(res)).errorCode).toBe('METER_INVALID');
      }
      expect((await invoiceOf('LVC', '101', A)).electricity).toBe(175_000);
    });

    it('nhận mã kiểu cũ LVC-101 không cần houseId, và tháng hai dạng 2099-01 / 01/2099', async () => {
      const res = await call(owner, 'POST', '/api/admin/room-detail', { month: '2099-01', room: 'LVC-101', data: { dienCu: 5, dienMoi: 25 } });
      expect(res.status).toBe(200);
      expect((await invoiceOf('LVC', '101', A)).electricity).toBe(70_000);
      const get = await json(await call(owner, 'GET', '/api/admin/room-detail?month=01/2099&room=LVC-101'));
      expect(get.data).toMatchObject({ dienMoi: 25, tongTien: 3_500_000 + 70_000 + 70_000 - 4000 });
      expect((await call(owner, 'POST', '/api/admin/room-detail', { month: 'hôm qua', room: 'LVC-101', data: { dienMoi: 1 } })).status).toBe(400);
    });

    it('hoá đơn đã đóng: 409 INVOICE_LOCKED; bỏ đã đóng (paymentStatus unpaid) rồi sửa được', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      await (await store()).prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE month = ?`).bind(A).run();
      const locked = await enter(A, { dienMoi: 170 });
      expect(locked.status).toBe(409);
      expect((await json(locked)).errorCode).toBe('INVOICE_LOCKED');
      expect((await invoiceOf('LVC', '101', A)).electricity).toBe(175_000);
      // The screen resends the same numbers with every save: nothing changed, so nothing is locked.
      expect((await enter(A, { dienCu: 100, dienMoi: 150 })).status).toBe(200);
      expect((await json(await enter(A, { paymentStatus: 'unpaid' }))).invoice).toMatchObject({ status: 'unpaid' });
      const open = await enter(A, { dienMoi: 170 });
      expect(open.status).toBe(200);
      expect((await json(open)).invoice).toMatchObject({ status: 'unpaid', total: 3_500_000 + 245_000 + 70_000 - 14_000 });
    });

    it('một lần lưu vừa đổi "đã đóng" vừa sửa số: 400 COMBINED_EDIT, không ghi gì; status cũ không được tính', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      await (await store()).prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE month = ?`).bind(A).run();
      const combined = await enter(A, { paymentStatus: 'unpaid', dienMoi: 170 });
      expect(combined.status).toBe(400);
      expect((await json(combined)).errorCode).toBe('COMBINED_EDIT');
      // A stale screen resends data.status and meter fields: the status is ignored, the paid invoice is locked.
      const stale = await enter(A, { status: 'unpaid', dienMoi: 170 });
      expect(stale.status).toBe(409);
      expect((await json(stale)).errorCode).toBe('INVOICE_LOCKED');
      const meter = await (await store()).prepare(`SELECT electric_new AS n FROM meter_readings WHERE month = ?`).bind(A).first<any>();
      expect(meter.n).toBe(150);
      expect(await invoiceOf('LVC', '101', A)).toMatchObject({ status: 'paid', electricity: 175_000 });
    });

    it('tháng sau lưu sẵn số cũ = số mới tháng trước (bản sao > 0): sửa tháng trước thì tháng sau đổi theo, tiền tính lại', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      await enter(B, { dienMoi: 180, nuocMoi: 20 });
      // As the Sheet import (or an older screen) writes it: B keeps its own copy of A's new readings.
      await (await store()).prepare(`UPDATE meter_readings SET electric_old = 150, water_old = 14 WHERE month = ?`).bind(B).run();
      expect(await enter(A, { dienMoi: 160, nuocMoi: 16 }).then((r) => r.status)).toBe(200);
      const row = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${B}&houseId=LVC`))).rooms[0];
      expect(row).toMatchObject({ dienCu: 160, dienMoi: 180, dienUsed: 20, nuocCu: 16, nuocUsed: 4 });
      expect(await invoiceOf('LVC', '101', B)).toMatchObject({ electricity: 20 * 3500, water: 4 * 20_000 });
      // Changed again: still follows (B now holds 0 = "the earlier month decides").
      await enter(A, { dienMoi: 170 });
      expect((await json(await call(owner, 'GET', `/api/admin/rooms?month=${B}&houseId=LVC`))).rooms[0]).toMatchObject({ dienCu: 170, dienUsed: 10 });
    });

    it('tháng sau có số cũ riêng (thay đồng hồ) hoặc đã đóng: sửa tháng trước không đụng tới', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      await enter(B, { dienMoi: 180, nuocMoi: 20 });
      const db = await store();
      await db.prepare(`UPDATE meter_readings SET electric_old = 5, electric_new = 30, water_old = 14 WHERE month = ?`).bind(B).run(); // new meter started at 5
      await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE month = ?`).bind(B).run();
      await enter(A, { dienMoi: 160, nuocMoi: 16 });
      const row = await db.prepare(`SELECT electric_old AS eo, water_old AS wo FROM meter_readings WHERE month = ?`).bind(B).first<any>();
      expect(row).toEqual({ eo: 5, wo: 14 }); // 5 is not a copy; 14 is, but B is paid
    });

    it('sửa hai trường từ hai tab: không ghi đè nhau; chỉ số trên 10.000.000 bị từ chối', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      // Another tab changed water between our read and write: only the electric column is written by us.
      await (await store()).prepare(`UPDATE meter_readings SET water_new = 30 WHERE month = ?`).bind(A).run();
      await enter(A, { dienMoi: 160 });
      const row = await (await store()).prepare(`SELECT electric_new AS en, water_new AS wn FROM meter_readings WHERE month = ?`).bind(A).first<any>();
      expect(row).toEqual({ en: 160, wn: 30 });
      const huge = await enter(A, { dienMoi: 10_000_001 });
      expect(huge.status).toBe(400);
      expect((await json(huge)).errorCode).toBe('METER_INVALID');
    });

    it('đồng hồ mới bắt đầu từ 0, chưa có tháng trước: số cũ 0 là số cũ thật, tính 150 kWh; có tháng trước thì giữ luật cũ', async () => {
      const res = await json(await enter(A, { dienCu: 0, dienMoi: 150, nuocCu: 0, nuocMoi: 10 }));
      expect(res.invoice.total).toBe(3_500_000 + 150 * 3500 + 10 * 20_000 + 70_000 - 150 * 200);
      expect(res.data).toMatchObject({ dienUsed: 150, nuocUsed: 10 });
      const list = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${A}&houseId=LVC`))).rooms[0];
      expect(list).toMatchObject({ dienCu: 0, dienMoi: 150, dienUsed: 150 });
      // Next month: old 0 in the row → the earlier month's new reading (150) is the old.
      const next = await json(await enter(B, { dienMoi: 180 }));
      expect(next.data).toMatchObject({ dienCu: 150, dienUsed: 30 });
    });

    it('tháng đầu (chưa có tháng trước) được nhập số cũ; từ tháng sau số cũ khoá theo tháng trước', async () => {
      let row = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${A}&houseId=LVC`))).rooms[0];
      expect(row).toMatchObject({ dienCuEditable: true, nuocCuEditable: true });
      const first = await json(await enter(A, { dienCu: 5000, nuocCu: 300 }));
      expect(first.data).toMatchObject({ dienCu: 5000, nuocCu: 300 });
      await enter(A, { dienMoi: 5080, nuocMoi: 306 });
      row = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${A}&houseId=LVC`))).rooms[0];
      expect(row).toMatchObject({ dienCu: 5000, dienUsed: 80, nuocUsed: 6, dienCuEditable: true });
      row = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${B}&houseId=LVC`))).rooms[0];
      expect(row).toMatchObject({ dienCu: 5080, nuocCu: 306, dienCuEditable: false, nuocCuEditable: false });
    });

    it('paymentStatus paid đánh dấu đã đóng như /api/admin/payment-status', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      const res = await enter(A, { paymentStatus: 'paid' });
      expect((await json(res)).invoice).toMatchObject({ status: 'paid', draft: true });
      expect(await invoiceOf('LVC', '101', A)).toMatchObject({ status: 'paid', status_by: 'staff:1' });
    });

    it('hoá đơn đã phát hành của tháng đã qua: 409 INVOICE_FROZEN', async () => {
      const db = await store();
      await db.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, status, issued_at) VALUES ('LVC', 3, '2020-01', 3500000, 3500000, 'unpaid', '2020-01-01 00:00:00')`).run();
      const res = await enter('2020-01', { dienCu: 1, dienMoi: 5 });
      expect(res.status).toBe(409);
      expect((await json(res)).errorCode).toBe('INVOICE_FROZEN');
    });

    it('hoá đơn đã phát hành của tháng này, chưa đóng: sửa được và tính lại', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      await (await store()).prepare(`UPDATE invoices SET issued_at = datetime('now') WHERE month = ?`).bind(A).run();
      const res = await enter(A, { dienMoi: 160 });
      expect((await json(res)).invoice).toMatchObject({ draft: false, status: 'unpaid', total: 3_500_000 + 210_000 + 70_000 - 12_000 });
    });

    it('phòng chưa có cư dân: lưu chỉ số, chưa có hoá đơn (invoice null)', async () => {
      await (await store()).prepare(`UPDATE residents SET room_id = NULL, status = 'pending' WHERE house_id = 'LVC'`).run();
      const res = await json(await enter(A, { dienCu: 1, dienMoi: 5 }));
      expect(res).toMatchObject({ success: true, invoice: null });
      expect(await invoiceOf('LVC', '101', A)).toBeNull();
    });

    it('GET room-detail trả đủ khoá màn hình đọc', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const body = await json(await call(owner, 'GET', `/api/admin/room-detail?month=${A}&room=101&houseId=LVC`));
      for (const k of FRONTEND_DETAIL_KEYS) expect(body.data, k).toHaveProperty(k);
      expect(body.data).toMatchObject({ draft: true, surplus: 0, paymentStatus: 'unpaid', tongTien: 3_815_000 });
      expect(JSON.stringify(body)).not.toMatch(/cccd[0-9]":"[^"]/);
    });
  });

  describe('GET /api/admin/rooms', () => {
    it('có đủ khoá màn hình đọc, kèm draft, surplus, missingMeters; phòng chưa có hoá đơn vẫn hiện với null', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const lvc = await json(await call(owner, 'GET', '/api/admin/rooms?month=01/2099&houseId=LVC'));
      expect(lvc.success).toBe(true);
      const r = lvc.rooms[0];
      for (const k of FRONTEND_ROOM_KEYS) expect(r, k).toHaveProperty(k);
      expect(r).toMatchObject({ room: 'LVC-101', roomName: '101', roomId: 3, tongTien: 3_815_000, tienDien: 175_000, tienNuoc: 80_000, tienPhong: 3_500_000, tienRac: 30_000, tienNet: 40_000,
        status: 'unpaid', paymentStatus: 'unpaid', draft: true, surplus: 0, missingMeters: false, dienUsed: 50, nuocUsed: 4, soNguoi: 1, cccd1: '' });
      expect(r.name).toBe('Cư dân LVC');

      const tk = await json(await call(owner, 'GET', `/api/admin/rooms?month=${A}&houseId=TRUNG_KIM`));
      expect(tk.rooms[0]).toMatchObject({ room: '101', invoiceId: null, tongTien: null, draft: false, surplus: 0, missingMeters: true });
    });

    it('tiền dư khi tổng mới thấp hơn tiền đã nhận', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150 });
      const inv = await invoiceOf('LVC', '101', A);
      await (await store()).prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, reference, paid_at) VALUES ('LVC', ?, 4000000, 'bank', 'x1', datetime('now'))`).bind(inv.id).run();
      const r = (await json(await call(owner, 'GET', `/api/admin/rooms?month=${A}&houseId=LVC`))).rooms[0];
      expect(r.surplus).toBe(4_000_000 - r.tongTien);
    });

    it('chủ nhiều nhà phải chọn nhà (HOUSE_REQUIRED); quản lý một nhà không cần', async () => {
      const res = await call(owner, 'GET', `/api/admin/rooms?month=${A}`);
      expect(res.status).toBe(400);
      expect((await json(res)).errorCode).toBe('HOUSE_REQUIRED');
      const ok = await call(manager, 'GET', `/api/admin/rooms?month=${A}`);
      expect(ok.status).toBe(200);
      expect((await json(ok)).rooms).toHaveLength(1);
    });
  });

  describe('config', () => {
    const getConfig = async (houseId = 'LVC', month?: string) => (await json(await call(owner, 'GET', `/api/admin/config?houseId=${houseId}${month ? `&month=${month}` : ''}`))).config;

    it('GET: giá và dịch vụ theo thứ tự, không lộ giá điện thực thu', async () => {
      const res = await call(owner, 'GET', '/api/admin/config?houseId=LVC');
      const text = await res.text();
      expect(text).not.toMatch(/actual/i);
      expect(text).not.toContain('3300');
      const config = JSON.parse(text).config;
      expect(config).toMatchObject({ electricPrice: 3500, waterPrice: 20000 });
      expect(config.services.map((s: any) => [s.name, s.price, s.per, s.maxQty, s.active])).toEqual([
        ['Rác', 30000, 'room', null, true], ['Internet', 40000, 'person', 2, true], ['Xe máy', 50000, 'vehicle', null, true],
      ]);
    });

    it('PUT đổi giá/dịch vụ của một tháng: nháp tháng đó tính lại, tháng khác và hoá đơn đã phát hành giữ nguyên; dịch vụ bỏ khỏi danh sách chỉ tắt', async () => {
      // Fee edits are limited to this month and the next: pin the clock to November 2026 (Vietnam) and use it with December.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 10, 20, 5, 0, 0));
      owner = await login(PHONES.owner);
      const [A, B] = ['2026-11', '2026-12'];
      await enter('11/2026', { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      await (await store()).prepare(`UPDATE invoices SET issued_at = datetime('now') WHERE month = ?`).bind(A).run();
      await enter('12/2026', { dienMoi: 180, nuocMoi: 18 });
      expect((await invoiceOf('LVC', '101', B)).total).toBe(3_749_000);

      const before = await getConfig('LVC', B);
      const rac = before.services[0], net = before.services[1];
      const res = await call(owner, 'PUT', '/api/admin/config', {
        houseId: 'LVC', month: B, electricPrice: 4000, waterPrice: 20000,
        services: [{ ...rac, price: 35000 }, net, { name: 'Bảo vệ', price: 10000, per: 'room', maxQty: null }],
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.success).toBe(true);
      expect(body.config.services.map((s: any) => [s.name, s.active])).toEqual([['Rác', true], ['Internet', true], ['Bảo vệ', true], ['Xe máy', false]]);

      expect((await invoiceOf('LVC', '101', A)).total).toBe(3_815_000); // issued: untouched
      expect((await invoiceOf('LVC', '101', B)).total).toBe(3_764_000); // draft of the edited month: new prices
      // Month A keeps its own fees, and the edited month B is a different snapshot.
      expect(await getConfig('LVC', A)).toMatchObject({ electricPrice: 3500 });
      expect((await getConfig('LVC', A)).services.map((s: any) => [s.name, s.price, s.active])).toEqual([['Rác', 30000, true], ['Internet', 40000, true], ['Xe máy', 50000, true]]);
      const xe = await (await store()).prepare(`SELECT active FROM house_fee_services WHERE house_id = 'LVC' AND month = ? AND service_id = (SELECT id FROM house_services WHERE house_id = 'LVC' AND name = 'Xe máy')`).bind(B).first<any>();
      expect(xe).toEqual({ active: 0 });
      // A month other than the current one does not move the live template.
      const rates = await (await store()).prepare(`SELECT electricity_per_kwh AS e FROM house_rates WHERE house_id = 'LVC'`).first<any>();
      expect(rates.e).toBe(3500);
      // The hidden setting is not exposed and not changed.
      const hidden = await (await store()).prepare(`SELECT actual_electric_price AS p FROM houses WHERE id = 'LVC'`).first<any>();
      expect(hidden.p).toBe(3300);
      // The other house keeps its rates.
      expect((await getConfig('TRUNG_KIM')).electricPrice).toBe(3500);
      vi.useRealTimers();
    });

    it('POST cũng lưu được, dạng { config: {...} }', async () => {
      const cfg = await getConfig();
      const res = await call(owner, 'POST', '/api/admin/config', { houseId: 'LVC', config: { electricPrice: 3600, waterPrice: 21000, services: cfg.services } });
      expect(res.status).toBe(200);
      expect(await getConfig()).toMatchObject({ electricPrice: 3600, waterPrice: 21000 });
    });

    it('PUT trả recomputeFailed (rỗng khi ổn)', async () => {
      const res = await json(await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 3600, waterPrice: 20000 }));
      expect(res).toMatchObject({ success: true, recomputeFailed: [] });
    });

    it('dịch vụ sai: 400 SERVICE_INVALID, không lưu gì', async () => {
      const ok = { name: 'Bảo vệ', price: 10000, per: 'room', maxQty: null };
      const bad: Record<string, unknown>[] = [
        { ...ok, name: '' }, { ...ok, name: '   ' }, { ...ok, name: 'x'.repeat(41) }, { ...ok, price: -1 }, { ...ok, price: 1.5 }, { ...ok, price: 100_000_001 },
        { ...ok, per: 'month' }, { ...ok, maxQty: 2 }, { ...ok, per: 'person', maxQty: 0 }, { ...ok, per: 'person', maxQty: 1.5 },
      ];
      for (const s of bad) {
        const res = await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 9999, waterPrice: 9999, services: [s] });
        expect(res.status, JSON.stringify(s)).toBe(400);
        expect((await json(res)).errorCode).toBe('SERVICE_INVALID');
      }
      expect(await getConfig()).toMatchObject({ electricPrice: 3500, waterPrice: 20000 });
      expect((await getConfig()).services).toHaveLength(3);
      const rate = await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: -5, waterPrice: 1, services: [] });
      expect(rate.status).toBe(400);
      expect((await json(rate)).errorCode).toBe('RATE_INVALID');
    });

    it('Internet mỗi người tối đa 3 được lưu; maxQty null cho mỗi người', async () => {
      const cfg = await getConfig();
      const services = cfg.services.map((s: any) => (s.name === 'Internet' ? { ...s, maxQty: null } : s));
      expect((await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 3500, waterPrice: 20000, services })).status).toBe(200);
      expect((await getConfig()).services[1].maxQty).toBeNull();
    });
  });

  describe('PUT /api/admin/rooms/:roomId/services', () => {
    it('phòng từ chối dịch vụ: dòng biến mất, tổng giảm; bỏ từ chối thì quay lại', async () => {
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const rac = (await json(await call(owner, 'GET', '/api/admin/config?houseId=LVC'))).config.services[0];
      const res = await call(owner, 'PUT', '/api/admin/rooms/3/services', { houseId: 'LVC', month: A, optOut: [rac.id] });
      expect(res.status).toBe(200);
      expect((await json(res)).invoice).toMatchObject({ total: 3_785_000, draft: true });
      expect((await linesOf((await invoiceOf('LVC', '101', A)).id)).map((l: any) => l.name)).not.toContain('Rác');
      const back = await json(await call(owner, 'PUT', '/api/admin/rooms/3/services', { houseId: 'LVC', month: A, optOut: [] }));
      expect(back.invoice.total).toBe(3_815_000);
    });

    it('chỉ nhận dịch vụ của nhà phòng đó; phòng không thuộc nhà → 404', async () => {
      const tkService = await (await store()).prepare(`SELECT id FROM house_services WHERE house_id = 'TRUNG_KIM' LIMIT 1`).first<{ id: number }>();
      const res = await call(owner, 'PUT', '/api/admin/rooms/3/services', { houseId: 'LVC', optOut: [tkService!.id] });
      expect(res.status).toBe(400);
      expect((await json(res)).errorCode).toBe('SERVICE_INVALID');
      expect((await call(owner, 'PUT', '/api/admin/rooms/1/services', { houseId: 'LVC', optOut: [] })).status).toBe(404);
    });
  });

  describe('POST /api/admin/issue-month', () => {
    it('chưa đủ số điện nước và không ép: issued 0 kèm tên phòng (200), không đổi gì; ép thì phát hành', async () => {
      await startMonthA();
      await createDrafts(e, OWNER, A);
      const res = await call(owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: '01/2099', force: false });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ success: true, issued: 0, missingMeters: ['101'] });
      expect((await invoiceOf('LVC', '101', A)).issued_at).toBeNull();

      const forced = await json(await call(owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: A, force: true }));
      expect(forced).toEqual({ success: true, issued: 1, missingMeters: ['101'] });
      expect((await invoiceOf('LVC', '101', A)).issued_at).not.toBeNull();
      expect((await invoiceOf('TRUNG_KIM', '101', A)).issued_at).toBeNull(); // another house untouched
    });

    it('đủ số: phát hành không cần ép và mở cổng thu tiền', async () => {
      await startMonthA();
      await enter(A, { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const res = await json(await call(owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: A }));
      expect(res).toEqual({ success: true, issued: 1, missingMeters: [] });
      const gate = await (await store()).prepare(`SELECT value FROM payment_gates WHERE house_id = 'LVC' AND month = ?`).bind(A).first<any>();
      expect(gate).toEqual({ value: 'START' });
    });
  });

  describe('quyền', () => {
    const routes: [string, string, unknown?][] = [
      ['GET', `/api/admin/rooms?month=${A}&houseId=LVC`],
      ['GET', `/api/admin/room-detail?month=${A}&room=101&houseId=LVC`],
      ['POST', '/api/admin/room-detail', { month: A, room: '101', houseId: 'LVC', data: { dienMoi: 5 } }],
      ['GET', '/api/admin/config?houseId=LVC'],
      ['PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 1, waterPrice: 1, services: [] }],
      ['PUT', '/api/admin/rooms/3/services', { houseId: 'LVC', optOut: [] }],
      ['POST', '/api/admin/issue-month', { houseId: 'LVC', month: A, force: true }],
    ];

    it('quản lý chỉ có nhà Trung Kim: 403 với nhà LVC, không đổi gì', async () => {
      for (const [m, path, body] of routes) {
        const res = await call(manager, m, path, body);
        expect(res.status, `${m} ${path}`).toBe(403);
      }
      expect(await invoiceOf('LVC', '101', A)).toBeNull();
      expect((await (await store()).prepare(`SELECT electricity_per_kwh AS e FROM house_rates WHERE house_id = 'LVC'`).first<any>()).e).toBe(3500);
    });

    it('quản lý Trung Kim lách bằng mã phòng LVC-101 hoặc id phòng LVC kèm nhà của mình: không ghi được gì', async () => {
      const db = await store();
      const before = await db.prepare(`SELECT COUNT(*) AS n FROM meter_readings`).first<any>();
      for (const body of [
        { month: A, room: 'LVC-101', data: { dienMoi: 5 } },
        { month: A, room: 'LVC-101', houseId: 'TRUNG_KIM', data: { dienMoi: 5 } },
      ]) {
        const res = await call(manager, 'POST', '/api/admin/room-detail', body);
        expect(res.status, JSON.stringify(body)).not.toBe(200);
      }
      // Room 3 is LVC 101: asked through the manager's own house it is not found.
      expect((await call(manager, 'PATCH', '/api/admin/rooms/3', { houseId: 'TRUNG_KIM', month: A, price: 1 })).status).toBe(404);
      expect((await call(manager, 'PATCH', '/api/admin/rooms/3', { houseId: 'LVC', month: A, price: 1 })).status).toBe(403);
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM meter_readings`).first<any>()).toEqual(before);
      expect((await db.prepare(`SELECT price FROM rooms WHERE id = 3`).first<any>()).price).toBe(3_500_000);
      const houses = await json(await call(manager, 'GET', '/api/houses'));
      expect(houses.houses.map((h: any) => h.id)).toEqual(['TRUNG_KIM']);
    });

    it('chủ trọ khác: 403 với nhà không phải của mình', async () => {
      for (const [m, path, body] of routes) expect((await call(otherOwner, m, path, body)).status, `${m} ${path}`).toBe(403);
    });

    it('cư dân: 403 STAFF_ONLY; chưa đăng nhập: 401', async () => {
      for (const [m, path, body] of routes) {
        const res = await call(resident, m, path, body);
        expect(res.status, `${m} ${path}`).toBe(403);
        expect((await json(res)).errorCode).toBe('STAFF_ONLY');
        expect((await api(path, { method: m })).status).toBe(401);
      }
    });

    it('ghi nhật ký cho sửa số, đổi phí, mở thu tiền', async () => {
      await startMonthA();
      await enter(A, { dienCu: 1, dienMoi: 5 });
      await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 3500, waterPrice: 20000, services: [] });
      await call(owner, 'POST', '/api/admin/issue-month', { houseId: 'LVC', month: A, force: true });
      const { results } = await e.DB.prepare(`SELECT action FROM audit_log WHERE house_id = 'LVC' AND action LIKE 'admin_%'`).all<{ action: string }>();
      expect(results.map((r) => r.action).sort()).toEqual(['admin_config_save', 'admin_issue_month', 'admin_meter_save']);
    });
  });
});
