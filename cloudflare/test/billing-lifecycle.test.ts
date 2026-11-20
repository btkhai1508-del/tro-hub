import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { assertEditable, canEdit, createDrafts, ensureDraftForRoom, InvoiceFrozenError, InvoiceLockedError, issueMonth, previousReadings, recompute } from '../src/billing/invoices.ts';
import { DAILY_CRON, runCron } from '../src/cron.ts';
import { deferRent, settleRent } from '../src/payments/settle.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const M = '2099-01'; // far enough from "now" that it is never in the past
const QM = 'month=01/2099';
const OWNER = 1;
const store = () => tenantOfOwner(e, OWNER);
const setSource = (v: 'sheet' | 'worker') =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('source_of_truth', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(v).run();

const invoiceOf = async (house: string, room: string, month = M) =>
  (await store()).prepare(
    `SELECT i.* FROM invoices i JOIN rooms r ON r.id = i.room_id WHERE i.house_id = ? AND r.name = ? AND i.month = ?`
  ).bind(house, room, month).first<any>();
const linesOf = async (id: number) =>
  (await (await store()).prepare(`SELECT kind, name, qty, unit_price, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY id`).bind(id).all<any>()).results;
const setMeter = async (house: string, roomId: number, month: string, eOld: number, eNew: number, wOld: number, wNew: number) =>
  (await store()).prepare(
    `INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (room_id, month) DO UPDATE SET electric_old = excluded.electric_old, electric_new = excluded.electric_new, water_old = excluded.water_old, water_new = excluded.water_new`
  ).bind(house, roomId, month, eOld, eNew, wOld, wNew).run();
const transfer = (amount: number) => ({ transferAmount: amount, content: 'x', transactionDate: '2099-01-02 10:00:00' });

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)('hoá đơn nháp, phát hành, quy tắc sửa [%s]', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sync:2099-01', ?)`).bind(new Date().toISOString()).run(); // no Sheet read
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000)`),
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, 20000)`),
    ]);
    await setSource('sheet');
  });

  describe('createDrafts', () => {
    it('tạo nháp cho phòng có cư dân đã duyệt: tiền phòng + dịch vụ, chưa phát hành', async () => {
      expect(await createDrafts(e, OWNER, M)).toBe(2);
      const lvc = await invoiceOf('LVC', '101');
      expect(lvc).toMatchObject({ issued_at: null, status: 'unpaid', room_rent: 3_500_000, electricity: 0, water: 0, other: 0, trash: 30_000, internet: 40_000, parking: 0, deposit: 0, total: 3_570_000 });
      expect(await linesOf(lvc.id)).toEqual([
        { kind: 'room', name: 'Tiền phòng', qty: 1, unit_price: 3_500_000, amount: 3_500_000 },
        { kind: 'electricity', name: 'Tiền điện', qty: 0, unit_price: 3500, amount: 0 },
        { kind: 'water', name: 'Tiền nước', qty: 0, unit_price: 20_000, amount: 0 },
        { kind: 'service', name: 'Rác', qty: 1, unit_price: 30_000, amount: 30_000 },
        { kind: 'service', name: 'Internet', qty: 1, unit_price: 40_000, amount: 40_000 },
        { kind: 'service', name: 'Xe máy', qty: 0, unit_price: 50_000, amount: 0 },
        { kind: 'other', name: 'Khác', qty: 0, unit_price: -200, amount: 0 },
      ]);
      expect((await invoiceOf('TRUNG_KIM', '101'))!.total).toBe(3_000_000 + 70_000);
    });

    it('không lập lần hai, bỏ qua phòng đã có hoá đơn, phòng trống và phòng của chủ trọ khác', async () => {
      expect(await createDrafts(e, OWNER, '2026-11')).toBe(0); // both rooms already have 2026-11
      expect(await createDrafts(e, OWNER, M)).toBe(2);
      expect(await createDrafts(e, OWNER, M)).toBe(0);
      expect(await createDrafts(e, 4, M)).toBe(0); // NTTD has no resident
      const n = await (await store()).prepare(`SELECT COUNT(*) AS n FROM invoices WHERE month = ?`).bind(M).first<{ n: number }>();
      expect(n!.n).toBe(2);
    });

    it('không tạo meter_readings; dịch vụ theo người, xe và phòng từ chối dịch vụ', async () => {
      const db = await store();
      await db.prepare(`UPDATE residents SET plate_number = '59A1-12345' WHERE house_id = 'LVC'`).run();
      await db.prepare(`INSERT INTO room_service_optouts (room_id, service_id) SELECT 3, id FROM house_services WHERE house_id = 'LVC' AND name = 'Rác'`).run();
      await createDrafts(e, OWNER, M);
      const lvc = await invoiceOf('LVC', '101');
      expect(lvc).toMatchObject({ trash: 0, internet: 40_000, parking: 50_000, total: 3_500_000 + 40_000 + 50_000 });
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM meter_readings WHERE month = ?`).bind(M).first<{ n: number }>())!.n).toBe(0);
    });

    it('dịch vụ không có sheet_col nằm trong tổng nhưng không nằm cột cũ', async () => {
      const db = await store();
      await db.prepare(`INSERT INTO house_services (house_id, name, price, per, max_qty, sheet_col, sort) VALUES ('LVC', 'Giữ xe đạp', 20000, 'room', NULL, NULL, 9)`).run();
      await createDrafts(e, OWNER, M);
      const lvc = await invoiceOf('LVC', '101');
      expect(lvc).toMatchObject({ trash: 30_000, internet: 40_000, parking: 0, total: 3_500_000 + 30_000 + 40_000 + 20_000 });
    });
  });

  describe('previousReadings', () => {
    it('lấy số mới của tháng gần nhất trước đó có số, không chỉ tháng liền trước', async () => {
      await setMeter('LVC', 3, '2026-08', 90, 100, 10, 12);
      await setMeter('LVC', 3, '2026-09', 100, 120, 12, 35);
      await setMeter('LVC', 3, '2026-10', 0, 0, 0, 0); // a row with no numbers is skipped
      expect(await previousReadings(await store(), 3, '2026-12')).toEqual({ electricOld: 120, waterOld: 35 });
      expect(await previousReadings(await store(), 3, '2026-09')).toEqual({ electricOld: 100, waterOld: 12 });
      expect(await previousReadings(await store(), 3, '2026-08')).toEqual({ electricOld: null, waterOld: null });
    });
  });

  describe('recompute', () => {
    it('ghi lại dòng, các cột cũ và tổng khi đã có số điện nước', async () => {
      await createDrafts(e, OWNER, M);
      await setMeter('LVC', 3, M, 120, 150, 35, 40);
      const inv = await invoiceOf('LVC', '101');
      const r = await recompute(await store(), inv.id, { central: e.DB });
      // rent 3.500.000 + electric 30*3500 + water 5*20000 + services 70.000 + other 30*(3300-3500)
      expect(r.total).toBe(3_500_000 + 105_000 + 100_000 + 70_000 - 6_000);
      expect(r.surplus).toBe(0);
      expect(await invoiceOf('LVC', '101')).toMatchObject({ room_rent: 3_500_000, electricity: 105_000, water: 100_000, other: -6_000, trash: 30_000, internet: 40_000, total: r.total, issued_at: null });
      expect(await linesOf(inv.id)).toHaveLength(7); // replaced, not appended
      await recompute(await store(), inv.id, { central: e.DB });
      expect(await linesOf(inv.id)).toHaveLength(7);
    });

    it('hoá đơn trả một phần: sửa cho tổng bằng số đã nhận thì tự Đã đóng', async () => {
      await createDrafts(e, OWNER, M);
      await issueMonth(e, 'LVC', M, true);
      const inv = await invoiceOf('LVC', '101');
      expect(inv.issued_at).not.toBeNull();
      await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_000_000), 'P1');
      expect((await invoiceOf('LVC', '101')).status).toBe('unpaid');
      await (await store()).prepare(`UPDATE rooms SET price = 2930000 WHERE id = 3`).run();
      const r = await recompute(await store(), inv.id, { central: e.DB });
      expect(r).toEqual({ total: 3_000_000, surplus: 0 });
      expect(await invoiceOf('LVC', '101')).toMatchObject({ status: 'paid', total: 3_000_000 });
      expect((await invoiceOf('LVC', '101')).paid_at).not.toBeNull();
    });

    it('tổng mới nhỏ hơn đã nhận: dư, không tự hoàn tiền', async () => {
      await createDrafts(e, OWNER, M);
      await issueMonth(e, 'LVC', M, true);
      const inv = await invoiceOf('LVC', '101');
      await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_000_000), 'P2');
      await (await store()).prepare(`UPDATE rooms SET price = 2000000 WHERE id = 3`).run();
      const r = await recompute(await store(), inv.id, { central: e.DB });
      expect(r).toEqual({ total: 2_070_000, surplus: 930_000 });
      expect((await invoiceOf('LVC', '101')).status).toBe('paid');
      const pay = await (await store()).prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE invoice_id = ?`).bind(inv.id).first<{ s: number }>();
      expect(pay!.s).toBe(3_000_000);
    });

    it('hoá đơn đã đóng không tính lại được', async () => {
      await createDrafts(e, OWNER, M);
      await issueMonth(e, 'LVC', M, true);
      const inv = await invoiceOf('LVC', '101');
      await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'P3');
      expect((await invoiceOf('LVC', '101')).status).toBe('paid');
      // a paid invoice is locked: it is not recomputed at all
      await expect(recompute(await store(), inv.id, { central: e.DB })).rejects.toBeInstanceOf(InvoiceLockedError);
    });

    it('tiền chờ ở trung tâm (deferred) cũng được tính', async () => {
      await createDrafts(e, OWNER, M);
      await issueMonth(e, 'LVC', M, true);
      const inv = await invoiceOf('LVC', '101');
      await e.DB.prepare(
        `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('D-1', 'rent', 3570000, 'x', 'LVC', '101', ?, 1, 'deferred')`
      ).bind(M).run();
      const r = await recompute(await store(), inv.id, { central: e.DB });
      expect(r).toEqual({ total: 3_570_000, surplus: 0 });
      expect((await invoiceOf('LVC', '101')).status).toBe('paid');
    });

    it('hoá đơn tháng đã qua đóng băng trừ khi allowPast; hoá đơn tiền mặt khoá', async () => {
      const db = await store();
      await db.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, issued_at) VALUES ('LVC', 3, '2020-01', 1, 1, '2020-01-02')`).run();
      const old = await db.prepare(`SELECT id FROM invoices WHERE month = '2020-01'`).first<{ id: number }>();
      await expect(recompute(db, old!.id)).rejects.toBeInstanceOf(InvoiceFrozenError);
      expect((await recompute(db, old!.id, { allowPast: true })).total).toBe(3_570_000);
      await db.prepare(`UPDATE invoices SET status = 'cash' WHERE id = ?`).bind(old!.id).run();
      await expect(recompute(db, old!.id, { allowPast: true })).rejects.toBeInstanceOf(InvoiceLockedError);
    });
  });

  describe('quy tắc sửa', () => {
    it('canEdit / assertEditable: paid và cash bị khoá (409 INVOICE_LOCKED)', () => {
      expect(canEdit({ status: 'unpaid' })).toBe(true);
      expect(canEdit({ status: 'pending' })).toBe(true);
      expect(canEdit({ status: 'paid' })).toBe(false);
      expect(canEdit({ status: 'cash' })).toBe(false);
      expect(() => assertEditable({ status: 'unpaid' })).not.toThrow();
      for (const status of ['paid', 'cash'] as const) {
        try {
          assertEditable({ status });
          throw new Error('expected a throw');
        } catch (err) {
          expect(err).toBeInstanceOf(InvoiceLockedError);
          expect(err).toMatchObject({ status: 409, code: 'INVOICE_LOCKED' });
        }
      }
    });
  });

  describe('issueMonth', () => {
    it('thiếu số mới: không phát hành, trả tên phòng thiếu', async () => {
      await createDrafts(e, OWNER, M);
      await setMeter('LVC', 3, M, 120, 150, 35, 40);
      const r = await issueMonth(e, 'TRUNG_KIM', M, false);
      expect(r).toEqual({ issued: 0, missingMeters: ['101'] });
      expect((await invoiceOf('TRUNG_KIM', '101')).issued_at).toBeNull();
      expect(await issueMonth(e, 'LVC', M, false)).toEqual({ issued: 1, missingMeters: [] });
      expect((await invoiceOf('LVC', '101')).issued_at).not.toBeNull();
    });

    it('force: phát hành dù thiếu số, báo phòng thiếu, mở cổng START', async () => {
      await createDrafts(e, OWNER, M);
      const r = await issueMonth(e, 'TRUNG_KIM', M, true);
      expect(r).toEqual({ issued: 1, missingMeters: ['101'] });
      expect((await invoiceOf('TRUNG_KIM', '101')).issued_at).not.toBeNull();
      expect((await invoiceOf('LVC', '101')).issued_at).toBeNull(); // another house untouched
      const gate = await (await store()).prepare(`SELECT value FROM payment_gates WHERE house_id = 'TRUNG_KIM' AND month = ?`).bind(M).first<{ value: string }>();
      expect(gate!.value).toBe('START');
      const none = await (await store()).prepare(`SELECT value FROM payment_gates WHERE house_id = 'LVC' AND month = ?`).bind(M).first();
      expect(none).toBeNull();
      expect(await issueMonth(e, 'TRUNG_KIM', M, true)).toMatchObject({ issued: 0 }); // nothing left to issue
    });
  });

  describe('SePay vào hoá đơn nháp', () => {
    it('ghi payments nhưng giữ trạng thái; sau khi phát hành tính đủ thì Đã đóng', async () => {
      await createDrafts(e, OWNER, M);
      const r = await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'DR1');
      const inv = await invoiceOf('LVC', '101');
      expect(r).toEqual({ settled: false, reason: 'draft', invoiceId: inv.id, received: 3_570_000, total: 3_570_000 });
      expect(inv.status).toBe('unpaid');
      expect(inv.paid_at).toBeNull();
      const pays = (await (await store()).prepare(`SELECT invoice_id, amount, reference FROM payments WHERE invoice_id = ?`).bind(inv.id).all<any>()).results;
      expect(pays).toEqual([{ invoice_id: inv.id, amount: 3_570_000, reference: 'sepay-DR1' }]);
      // the same transfer again books nothing more
      await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'DR1');
      expect((await (await store()).prepare(`SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?`).bind(inv.id).first<{ n: number }>())!.n).toBe(1);

      await issueMonth(e, 'LVC', M, true);
      expect((await invoiceOf('LVC', '101'))).toMatchObject({ status: 'paid' });
      const resident = await login(PHONES.residentLvc);
      const st = (await (await api(`/api/payment/status?${QM}`, {}, resident)).json()) as any;
      expect(st).toMatchObject({ paymentStatus: 'paid', statusText: 'Đã đóng', amount: 3_570_000 });
    });

    it('chuyển thiếu vào nháp: sau khi phát hành vẫn chưa đóng', async () => {
      await createDrafts(e, OWNER, M);
      await settleRent(e, OWNER, 'LVC', '101', M, transfer(1_000_000), 'DR2');
      await issueMonth(e, 'LVC', M, true);
      expect((await invoiceOf('LVC', '101')).status).toBe('unpaid');
    });

    it('deferRent trên nháp không đổi gì và không lỗi', async () => {
      await createDrafts(e, OWNER, M);
      await e.DB.prepare(
        `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('DR3', 'rent', 3570000, 'x', 'LVC', '101', ?, 1, 'deferred')`
      ).bind(M).run();
      await deferRent(e, OWNER, 'LVC', '101', M, 'DR3');
      expect((await invoiceOf('LVC', '101')).status).toBe('unpaid');
    });
  });

  describe('API: nháp ẩn với cư dân', () => {
    it('cư dân không thấy nháp ở danh sách, trạng thái, báo đã chuyển; nhân viên thấy với draft: true', async () => {
      await createDrafts(e, OWNER, M);
      const resident = await login(PHONES.residentLvc);
      const owner = await login(PHONES.owner);
      const manager = await login(PHONES.manager);

      const mine = (await (await api(`/api/houses/LVC/invoices?month=${M}`, {}, resident)).json()) as any;
      expect(mine.invoices).toEqual([]);
      // without ?month the resident's latest month is the latest ISSUED one (2026-11), not the draft
      const latest = (await (await api(`/api/houses/LVC/invoices`, {}, resident)).json()) as any;
      expect(latest.month).toBe('2026-11');
      expect(latest.invoices.map((i: any) => i.draft)).toEqual([false]);

      const st = (await (await api(`/api/payment/status?${QM}`, {}, resident)).json()) as any;
      expect(st).toMatchObject({ success: true, amount: 0, foundRow: -1, paymentStatus: 'unpaid' });

      const mark = await api('/api/payment/mark-paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '01/2099' }) }, resident);
      expect(mark.status).toBe(404);
      expect((await invoiceOf('LVC', '101')).status).toBe('unpaid');

      for (const token of [owner, manager]) {
        const list = (await (await api(`/api/houses/TRUNG_KIM/invoices?month=${M}`, {}, token)).json()) as any;
        expect(list.invoices).toHaveLength(1);
        expect(list.invoices[0]).toMatchObject({ room_name: '101', draft: true, total: 3_070_000, status: 'unpaid' });
        const staff = (await (await api(`/api/payment/status?${QM}&room=LVC-101`, {}, token)).json()) as any;
        if (token === owner) expect(staff).toMatchObject({ success: true, amount: 3_570_000 });
      }
      const billing = (await (await api(`/api/admin/billing?${QM}`, {}, owner)).json()) as any;
      expect(billing.billing.map((b: any) => [b.room, b.tongTien])).toEqual(expect.arrayContaining([['LVC-101', 3_570_000]]));

      await issueMonth(e, 'LVC', M, true);
      const after = (await (await api(`/api/houses/LVC/invoices?month=${M}`, {}, resident)).json()) as any;
      expect(after.invoices).toMatchObject([{ room_name: '101', draft: false, total: 3_570_000 }]);
      const st2 = (await (await api(`/api/payment/status?${QM}`, {}, resident)).json()) as any;
      expect(st2.amount).toBe(3_570_000);
    });
  });

  describe('ensureDraftForRoom', () => {
    it('chỉ chạy khi công tắc là worker; tạo nháp tháng hiện tại cho phòng chưa có', async () => {
      const { currentMonth } = await import('../src/sheetSync.ts');
      const month = currentMonth();
      const db = await store();
      await db.prepare(`DELETE FROM invoices WHERE room_id = 3`).run();
      await ensureDraftForRoom(e, OWNER, 'LVC', 3);
      expect(await invoiceOf('LVC', '101', month)).toBeNull(); // source is 'sheet'
      await setSource('worker');
      await ensureDraftForRoom(e, OWNER, 'LVC', 3);
      expect(await invoiceOf('LVC', '101', month)).toMatchObject({ issued_at: null, total: 3_570_000 });
    });

    it('chỉ lập cho đúng phòng được duyệt', async () => {
      const { currentMonth } = await import('../src/sheetSync.ts');
      const month = currentMonth();
      const db = await store();
      await db.prepare(`DELETE FROM invoices WHERE month = ?`).bind(month).run();
      await setSource('worker');
      await ensureDraftForRoom(e, OWNER, 'LVC', 3);
      expect(await invoiceOf('LVC', '101', month)).not.toBeNull();
      expect(await invoiceOf('TRUNG_KIM', '101', month)).toBeNull();
    });

    it('route tạo cư dân đã duyệt gọi nó', async () => {
      const { currentMonth } = await import('../src/sheetSync.ts');
      const month = currentMonth();
      const db = await store();
      await db.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (20, 'LVC', '201', 2800000)`).run();
      await setSource('worker');
      const owner = await login(PHONES.owner);
      const res = await api('/api/houses/LVC/residents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: 'Người mới', phone: '0900000999', password: '123456', roomId: 20 }),
      }, owner);
      expect(res.status).toBe(200);
      expect(await invoiceOf('LVC', '201', month)).toMatchObject({ issued_at: null, room_rent: 2_800_000, total: 2_800_000 + 30_000 + 40_000 });
    });
  });

  describe('cron: ngày 1 giờ Việt Nam', () => {
    const day1 = Date.UTC(2099, 0, 1, 2, 0) - 7 * 3600_000; // 2099-01-01 02:00 Vietnam
    const day2 = day1 + 3 * 24 * 3600_000; // day 4: outside the 1-3 window

    it('worker + ngày 1: tạo nháp tháng hiện tại cho mọi chủ trọ', async () => {
      await setSource('worker');
      await runCron(DAILY_CRON, e, day1);
      expect((await invoiceOf('LVC', '101'))).toMatchObject({ issued_at: null, total: 3_570_000 });
      expect((await invoiceOf('TRUNG_KIM', '101'))).toMatchObject({ issued_at: null });
    });

    it('ngoài ngày 1-3, hoặc công tắc sheet: không tạo gì', async () => {
      await setSource('worker');
      await runCron(DAILY_CRON, e, day2);
      expect(await invoiceOf('LVC', '101')).toBeNull();
      await setSource('sheet');
      await runCron(DAILY_CRON, e, day1);
      expect(await invoiceOf('LVC', '101')).toBeNull();
    });

    // Only on D1 does a 'migrating' landlord still have rows to read; the refused write must be logged, not thrown.
    it.runIf(backend === 'd1')('một chủ trọ lỗi không chặn chủ trọ khác', async () => {
      await setSource('worker');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await e.DB.prepare(`UPDATE tenant_storage SET backend = 'migrating' WHERE owner_id = 1`).run();
      await runCron(DAILY_CRON, e, day1); // owner 1 is read-only: its write is refused, logged, and the run goes on
      expect(warn).toHaveBeenCalled();
    });
  });
});

describe.each(BACKENDS)('vòng sửa lỗi sau review [%s]', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sync:2099-01', ?)`).bind(new Date().toISOString()).run();
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000)`),
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, 20000)`),
    ]);
    await setSource('worker');
  });
  afterEach(async () => {
    const db = await store();
    for (const t of ['t_fail_issue', 't_fail_lines', 't_cash_during', 't_issue_during']) await db.prepare(`DROP TRIGGER IF EXISTS ${t}`).run().catch(() => {});
  });

  it('phát hành nguyên tử: tiền đã đủ thì cư dân thấy Đã đóng ngay, không qua chưa đóng', async () => {
    await createDrafts(e, OWNER, M);
    await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'AT1');
    const resident = await login(PHONES.residentLvc);
    await issueMonth(e, 'LVC', M, true);
    const row = await invoiceOf('LVC', '101');
    expect(row).toMatchObject({ status: 'paid' });
    expect(row.issued_at).not.toBeNull();
    const st = (await (await api(`/api/payment/status?${QM}`, {}, resident)).json()) as any;
    expect(st.paymentStatus).toBe('paid');
  });

  it('lỗi giữa chừng khi phát hành: không phát hành gì, không mở cổng', async () => {
    await createDrafts(e, OWNER, M);
    const db = await store();
    await db.prepare(
      `CREATE TRIGGER t_fail_issue BEFORE UPDATE OF issued_at ON invoices WHEN NEW.room_id = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END`
    ).run();
    await expect(issueMonth(e, 'LVC', M, true)).rejects.toThrow();
    expect((await invoiceOf('LVC', '101')).issued_at).toBeNull();
    expect(await db.prepare(`SELECT 1 FROM payment_gates WHERE house_id = 'LVC' AND month = ?`).bind(M).first()).toBeNull();
  });

  it('chỉ số cũ = 0 trong dòng đồng hồ thì lấy tháng trước; thiếu số gồm cả mới = 0', async () => {
    await createDrafts(e, OWNER, M);
    await setMeter('LVC', 3, '2098-12', 0, 100, 0, 10);
    await setMeter('LVC', 3, M, 0, 130, 0, 14); // only new readings written
    const inv = await invoiceOf('LVC', '101');
    await recompute(await store(), inv.id, { central: e.DB });
    expect(await invoiceOf('LVC', '101')).toMatchObject({ electricity: 30 * 3500, water: 4 * 20000 });
    // zero new readings count as missing
    await setMeter('TRUNG_KIM', 1, M, 0, 0, 0, 0);
    expect(await issueMonth(e, 'TRUNG_KIM', M, false)).toEqual({ issued: 0, missingMeters: ['101'] });
  });

  it('recompute không ghi đè paid/cash đặt xen vào sau khi đọc', async () => {
    await createDrafts(e, OWNER, M);
    await issueMonth(e, 'LVC', M, true);
    const inv = await invoiceOf('LVC', '101');
    const db = await store();
    await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'RC1'); // paid → locked, so build the race instead:
    await db.prepare(`UPDATE invoices SET status = 'unpaid', paid_at = NULL WHERE id = ?`).bind(inv.id).run();
    await db.prepare(
      `CREATE TRIGGER t_cash_during AFTER INSERT ON invoice_lines BEGIN UPDATE invoices SET status = 'cash' WHERE id = NEW.invoice_id; END`
    ).run();
    await recompute(db, inv.id, { central: e.DB }); // covered by bank money: wants 'paid', but cash was set meanwhile
    expect((await invoiceOf('LVC', '101')).status).toBe('cash');
  });

  it('SePay: phát hành xen giữa lúc đọc và lúc ghi tiền vẫn ra Đã đóng', async () => {
    await createDrafts(e, OWNER, M);
    const db = await store();
    await db.prepare(
      `CREATE TRIGGER t_issue_during AFTER INSERT ON payments BEGIN UPDATE invoices SET issued_at = datetime('now') WHERE id = NEW.invoice_id; END`
    ).run();
    const r = await settleRent(e, OWNER, 'LVC', '101', M, transfer(3_570_000), 'RACE1');
    expect(r).toMatchObject({ settled: true });
    expect((await invoiceOf('LVC', '101')).status).toBe('paid');
  });

  it('nháp có sự kiện deferred mở: staff thấy trạng thái đã lưu (chưa đóng), sau phát hành thì Đã đóng', async () => {
    await createDrafts(e, OWNER, M);
    await e.DB.prepare(
      `INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('DF1', 'rent', 3570000, 'x', 'LVC', '101', ?, 1, 'deferred')`
    ).bind(M).run();
    const owner = await login(PHONES.owner);
    const list = (await (await api(`/api/houses/LVC/invoices?month=${M}`, {}, owner)).json()) as any;
    expect(list.invoices[0]).toMatchObject({ draft: true, status: 'unpaid' });
    const st = (await (await api(`/api/payment/status?${QM}&room=LVC-101`, {}, owner)).json()) as any;
    expect(st.paymentStatus).toBe('unpaid');
    await issueMonth(e, 'LVC', M, true);
    expect((await invoiceOf('LVC', '101')).status).toBe('paid'); // deferred money counted at issue
  });

  it('createDrafts: một phòng lỗi không chặn phòng khác và không để lại nháp rỗng', async () => {
    const db = await store();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.prepare(
      `CREATE TRIGGER t_fail_lines BEFORE INSERT ON invoice_lines WHEN NEW.invoice_id IN (SELECT id FROM invoices WHERE room_id = 1) BEGIN SELECT RAISE(ABORT, 'boom'); END`
    ).run();
    expect(await createDrafts(e, OWNER, M)).toBe(1);
    expect(warn).toHaveBeenCalled();
    expect(await invoiceOf('TRUNG_KIM', '101')).toBeNull();
    expect(await invoiceOf('LVC', '101')).toMatchObject({ total: 3_570_000 });
    await db.prepare(`DROP TRIGGER t_fail_lines`).run();
    expect(await createDrafts(e, OWNER, M)).toBe(1); // repaired on the next run
  });

  it('cron tạo nháp vào ngày 1-3, không phải ngày 4', async () => {
    const d = (day: number) => Date.UTC(2099, 0, day, 2, 0) - 7 * 3600_000;
    await runCron(DAILY_CRON, e, d(4));
    expect(await invoiceOf('LVC', '101')).toBeNull();
    await runCron(DAILY_CRON, e, d(3));
    expect(await invoiceOf('LVC', '101')).not.toBeNull();
  });

  it('chế độ sheet: hoá đơn nháp tồn đọng được phát hành ở lần đồng bộ Sheet sau, không bị gỡ', async () => {
    await setSource('sheet');
    const { syncMonthFromSheet } = await import('../src/sheetSync.ts');
    const db = await store();
    await db.prepare(`UPDATE invoices SET issued_at = NULL WHERE room_id = 3`).run();
    await e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sheet_id', 'S1'), ('legacy_sheet_houses', 'LVC')`).run();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (/google\.com/.test(url)) {
        if (url.includes('/export')) return new Response(['T', 'Số phòng,a,b', 'u', 'LVC-101,10,20,,1,3,,0,0,"4.000.000 đ",,,,,,"4.000.000 đ"'].join('\n'));
        return new Response(`{name: "11/2026", pageUrl: "https://docs.google.com/x?gid=777"}`);
      }
      return real(input, init);
    });
    await syncMonthFromSheet(e.DB, db, '2026-11');
    const row = await db.prepare(`SELECT issued_at FROM invoices WHERE room_id = 3 AND month = '2026-11'`).first<{ issued_at: string | null }>();
    expect(row!.issued_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    const first = row!.issued_at;
    await syncMonthFromSheet(e.DB, db, '2026-11');
    expect((await db.prepare(`SELECT issued_at FROM invoices WHERE room_id = 3 AND month = '2026-11'`).first<{ issued_at: string }>())!.issued_at).toBe(first);
  });
});
