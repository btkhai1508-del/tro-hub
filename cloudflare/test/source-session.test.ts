import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const store = () => tenantOfOwner(e, 1);
const putSource = (source: unknown, token?: string) =>
  api('/api/dev/source', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) }, token);
const sourceNow = async () => ((await (await api('/api/source')).json()) as any).source;
const queueRow = (attempts: number, done: boolean) =>
  e.DB.prepare(`INSERT INTO sheet_export_queue (kind, payload, attempts, done_at) VALUES ('x', '{}', ?, ${done ? `datetime('now')` : 'NULL'})`).bind(attempts).run();

// The keys Express' fetchFreshTenantDataFromSheet answers with (src/server/googleSheetsBackendService.ts).
const TENANT_DATA_KEYS = ['allResidentsCount', 'invoices', 'logsTransactionFound', 'profile', 'success', 'timestamp'];
const PROFILE_KEYS = [
  'name', 'phone', 'cccd', 'email', 'dob', 'gender', 'address', 'plateNumber', 'vehicleType', 'roomNumber', 'personType',
  'emergencyName', 'emergencyRelation', 'emergencyPhone', 'contractUrl', 'rentPrice', 'depositAmount', 'totalMonthlyAmount',
];

describe.each(BACKENDS)('công tắc nguồn dữ liệu [%s]', (backend) => {
  let developer: string;
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`UPDATE settings SET value = 'sheet' WHERE key = 'source_of_truth'`).run();
    await e.DB.prepare(`DELETE FROM settings WHERE key IN ('source_worker_since', 'legacy_sheet_id', 'legacy_sheet_houses')`).run();
    (e as any).ZALO_APP_SECRET = 'test-zalo-secret';
    developer = await login(PHONES.developer);
  });
  afterEach(() => {
    (e as any).ZALO_APP_SECRET = 'test-zalo-secret';
  });

  it('GET /api/source công khai, mặc định sheet, cho phép cache 30 giây', async () => {
    const res = await api('/api/source');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect(await res.json()).toEqual({ success: true, source: 'sheet' });
  });

  it('chỉ Developer đổi được', async () => {
    expect((await putSource('worker')).status).toBe(401);
    for (const phone of [PHONES.owner, PHONES.manager, PHONES.residentTk]) expect((await putSource('worker', await login(phone))).status).toBe(403);
    expect(await sourceNow()).toBe('sheet');
    const res = await putSource('worker', developer);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, source: 'worker' });
    expect(await sourceNow()).toBe('worker');
  });

  it('giá trị lạ bị từ chối', async () => {
    expect((await putSource('both', developer)).status).toBe(400);
    expect(await sourceNow()).toBe('sheet');
  });

  it('bật worker khi thiếu ZALO_APP_SECRET: 409 ZALO_NOT_CONFIGURED', async () => {
    (e as any).ZALO_APP_SECRET = undefined;
    const res = await putSource('worker', developer);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.errorCode).toBe('ZALO_NOT_CONFIGURED');
    expect(body.error).toBe('Chưa thêm khoá bí mật Zalo vào Worker. Thêm ZALO_APP_SECRET rồi bật lại.');
    expect(await sourceNow()).toBe('sheet');
  });

  it('đổi nguồn ghi nhật ký', async () => {
    await e.DB.prepare(`DELETE FROM audit_log`).run();
    await putSource('worker', developer);
    const row = await e.DB.prepare(`SELECT actor, action, target FROM audit_log WHERE action = 'source_set'`).first<any>();
    expect(row).toMatchObject({ actor: 'staff:3', target: 'worker' });
  });

  it('về sheet: bị chặn 409 EXPORT_PENDING khi hàng đợi còn dòng chờ hoặc đang lỗi (<5 lần)', async () => {
    await putSource('worker', developer);
    await queueRow(0, false);
    let res = await putSource('sheet', developer);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).errorCode).toBe('EXPORT_PENDING');
    expect(await sourceNow()).toBe('worker');
    await e.DB.prepare(`DELETE FROM sheet_export_queue`).run();
    await queueRow(3, false); // failing but still retried
    res = await putSource('sheet', developer);
    expect(res.status).toBe(409);
  });

  it('về sheet: cho phép khi chỉ còn dòng đã xong', async () => {
    await putSource('worker', developer);
    await queueRow(1, true);
    const res = await putSource('sheet', developer);
    expect(res.status).toBe(200);
    expect(await sourceNow()).toBe('sheet');
  });

  it('về sheet: dòng đã lỗi đủ 5 lần chặn 409 EXPORT_FAILED, trừ khi xác nhận acknowledgeFailed', async () => {
    await putSource('worker', developer);
    await queueRow(5, false);
    const res = await putSource('sheet', developer);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).errorCode).toBe('EXPORT_FAILED');
    expect(await sourceNow()).toBe('worker');
    const ok = await api('/api/dev/source', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'sheet', acknowledgeFailed: true }) }, developer);
    expect(ok.status).toBe(200);
    expect(await sourceNow()).toBe('sheet');
  });

  it('về sheet trả workerOnlyResidents: cư dân tạo sau lúc bật worker ở các nhà còn Sheet cũ', async () => {
    await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('legacy_sheet_id', 'abc'), ('legacy_sheet_houses', 'TRUNG_KIM,LVC')`).run();
    const db = await store();
    await db.prepare(`UPDATE residents SET created_at = '2020-01-01 00:00:00'`).run();
    const res0 = await putSource('worker', developer);
    expect(((await res0.json()) as any).workerOnlyResidents).toBe(0);
    await db.prepare(`INSERT INTO residents (house_id, room_id, full_name, phone, password_hash, status, created_at) VALUES ('TRUNG_KIM', 1, 'Mới', '0900000999', 'x', 'approved', '2999-01-01 00:00:00')`).run();
    // a house without a legacy Sheet (another landlord's NTTD) is not counted; the insert must really happen
    const other = await tenantOfOwner(e, 4);
    await other.prepare(`INSERT INTO residents (house_id, room_id, full_name, phone, password_hash, status, created_at) VALUES ('NTTD', 5, 'Khác', '0900000998', 'x', 'approved', '2999-01-01 00:00:00')`).run();
    expect((await other.prepare(`SELECT COUNT(*) AS n FROM residents WHERE house_id = 'NTTD' AND created_at >= '2999'`).first<{ n: number }>())!.n).toBe(1);
    const res = await putSource('sheet', developer);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).workerOnlyResidents).toBe(1);
  });
});

describe.each(BACKENDS)('phiên cư dân từ Worker [%s]', (backend) => {
  let resident: string;
  let nov: number; // id of the seeded 11/2026 invoice of room 101
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (2, 'TRUNG_KIM', '102', 2000000)`),
      db.prepare(`UPDATE rooms SET floor = 1, deposit = 1000000 WHERE id = 1`),
      db.prepare(`UPDATE residents SET email = 'a@b.vn', dob = '01/02/1990', plate_number = '59A1', vehicle_type = 'Xe máy', emergency_name = 'Mẹ', emergency_relation = 'Mẹ', emergency_phone = '0911', move_in_date = '05/01/2026' WHERE room_id = 1`),
      // 2026-10: issued, full set of lines; 2026-12: draft; 102 / 2026-11: another room.
      db.prepare(`INSERT INTO invoices (id, house_id, room_id, month, room_rent, total, status, issued_at) VALUES (101, 'TRUNG_KIM', 1, '2026-10', 3000000, 3395000, 'unpaid', '2026-10-01 03:00:00')`),
      db.prepare(`INSERT INTO invoices (id, house_id, room_id, month, room_rent, total, status, issued_at) VALUES (102, 'TRUNG_KIM', 1, '2026-12', 3000000, 3000000, 'unpaid', NULL)`),
      db.prepare(`INSERT INTO invoices (id, house_id, room_id, month, room_rent, total, status, issued_at) VALUES (103, 'TRUNG_KIM', 2, '2026-11', 2000000, 2000000, 'unpaid', '2026-11-01 00:00:00')`),
      db.prepare(`INSERT INTO house_services (id, house_id, name, price, per, max_qty, sheet_col, sort) VALUES (901, 'TRUNG_KIM', 'Bảo vệ', 10000, 'room', NULL, 'K', 9)`),
      ...[
        ['room', null, 'Tiền phòng', 1, 3000000, 3000000],
        ['electricity', null, 'Tiền điện', 65, 3500, 227500],
        ['water', null, 'Tiền nước', 3, 20000, 60000],
        ['service', 901, 'Rác', 1, 30000, 30000],
        ['service', 902, 'Internet', 2, 40000, 80000],
        ['service', 903, 'Xe máy', 1, 50000, 50000],
        ['other', null, 'Khác', 1, -52500, -52500],
      ].map(([kind, sid, name, qty, price, amount]) =>
        db.prepare(`INSERT INTO invoice_lines (invoice_id, kind, service_id, name, qty, unit_price, amount) VALUES (101, ?, ?, ?, ?, ?, ?)`).bind(kind, sid, name, qty, price, amount)
      ),
      db.prepare(`INSERT INTO house_services (id, house_id, name, price, per, max_qty, sheet_col, sort) VALUES (902, 'TRUNG_KIM', 'Internet 2', 40000, 'person', 2, 'L', 10)`),
      db.prepare(`INSERT INTO house_services (id, house_id, name, price, per, max_qty, sheet_col, sort) VALUES (903, 'TRUNG_KIM', 'Xe 2', 50000, 'vehicle', NULL, 'M', 11)`),
      db.prepare(`INSERT INTO invoice_lines (invoice_id, kind, name, qty, unit_price, amount) VALUES (102, 'room', 'Tiền phòng', 1, 3000000, 3000000)`),
    ]);
    resident = await login(PHONES.residentTk);
    nov = (await db.prepare(`SELECT id FROM invoices WHERE room_id = 1 AND month = '2026-11'`).first<{ id: number }>())!.id;
  });

  const session = async (token = resident) => {
    const res = await api('/api/tenant/session', {}, token);
    expect(res.status).toBe(200);
    return (await res.json()) as any;
  };

  it('cần đăng nhập', async () => {
    expect((await api('/api/tenant/session')).status).toBe(401);
    expect((await api('/api/sheets/tenant-data')).status).toBe(401);
  });

  it('user theo AuthenticatedTenantUser, house theo Express', async () => {
    const body = await session();
    expect(body.success).toBe(true);
    expect(body.isAdmin).toBe(false);
    expect(body.house).toEqual({ role: 'resident', houseIds: ['TRUNG_KIM'] });
    expect(body.user).toMatchObject({
      name: 'Cư dân Trung Kim', phone: PHONES.residentTk, cccd: '', email: 'a@b.vn', dob: '01/02/1990', vehicleType: 'Xe máy', plateNumber: '59A1',
      roomNumber: '101', building: 'NHÀ TRỌ TRUNG KIM', floor: '1', startDate: '05/01/2026', personType: 'tenant',
      emergencyName: 'Mẹ', emergencyRelation: 'Mẹ', emergencyPhone: '0911', rentPrice: 3000000, depositAmount: 1000000,
    });
  });

  it('chỉ hoá đơn đã phát hành của phòng mình, mới nhất trước; không có nháp, không lộ phòng khác', async () => {
    const { invoices } = await session();
    expect(invoices.map((i: any) => i.id)).toEqual([`INV-${nov}`, 'INV-101']);
    expect(invoices.map((i: any) => i.month)).toEqual(['11/2026', '10/2026']);
    expect(JSON.stringify(invoices)).not.toContain('2000000');
  });

  it('hình dạng Invoice: ngày phát hành, hạn 05, details từ invoice_lines theo kiểu dòng', async () => {
    const { invoices } = await session();
    const oct = invoices.find((i: any) => i.id === 'INV-101');
    expect(oct).toMatchObject({ month: '10/2026', issueDate: '01/10/2026', dueDate: '05/10/2026', total: 3395000, status: 'unpaid' });
    expect(oct.details).toEqual([
      { name: 'Tiền phòng', amount: 3000000, type: 'room' },
      { name: 'Tiền điện', amount: 227500, type: 'electricity', metric: '65 số' },
      { name: 'Tiền nước', amount: 60000, type: 'water', metric: '3 khối' },
      { name: 'Rác', amount: 30000, type: 'service' },
      { name: 'Internet', amount: 80000, type: 'internet' },
      { name: 'Xe máy', amount: 50000, type: 'parking' },
      { name: 'Khác', amount: -52500, type: 'service' },
    ]);
  });

  it('chỉ 12 tháng gần nhất', async () => {
    const db = await store();
    const stmts = [];
    for (let m = 1; m <= 14; m++) {
      stmts.push(db.prepare(`INSERT INTO invoices (house_id, room_id, month, total, status, issued_at) VALUES ('TRUNG_KIM', 1, ?, 1, 'paid', '2001-01-01 00:00:00')`).bind(`${2000 + m}-01`));
    }
    await db.batch(stmts);
    expect((await session()).invoices).toHaveLength(12);
  });

  it('trạng thái: tiền chờ (deferred) đủ tổng thì đã đóng; tiền mặt hiển thị cash', async () => {
    await e.DB.prepare(`INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('S1', 'rent', 3000000, 'x', 'TRUNG_KIM', '101', '2026-11', 1, 'deferred')`).run();
    const db = await store();
    await db.prepare(`UPDATE invoices SET status = 'cash', paid_at = '2026-10-03 05:00:00' WHERE id = 101`).run();
    const { invoices } = await session();
    const novInv = invoices.find((i: any) => i.id === `INV-${nov}`);
    const oct = invoices.find((i: any) => i.id === 'INV-101');
    expect(novInv).toMatchObject({ status: 'paid', paymentMethod: 'qr' });
    expect(novInv.paidAt).toContain('Đã thanh toán');
    expect(oct).toMatchObject({ status: 'paid', paymentMethod: 'cash' });
    expect(oct.paidAt).toContain('03/10/2026');
  });

  it('tiền chờ của phòng khác không đổi trạng thái phòng 101', async () => {
    await e.DB.prepare(`INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('S2', 'rent', 3000000, 'x', 'TRUNG_KIM', '102', '2026-11', 1, 'deferred')`).run();
    await e.DB.prepare(`INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, owner_id, status) VALUES ('S3', 'rent', 3000000, 'x', 'LVC', '101', '2026-11', 1, 'deferred')`).run();
    expect((await session()).invoices.find((i: any) => i.id === `INV-${nov}`).status).toBe('unpaid');
  });

  it('cư dân LVC: roomNumber theo mã cũ LVC-<phòng>', async () => {
    const body = await session(await login(PHONES.residentLvc));
    expect(body.user.roomNumber).toBe('LVC-101');
    expect(body.house).toEqual({ role: 'resident', houseIds: ['LVC'] });
  });

  it('chờ xác nhận hiện pending', async () => {
    await (await store()).prepare(`UPDATE invoices SET status = 'pending' WHERE id = ?`).bind(nov).run();
    expect((await session()).invoices[0].status).toBe('pending');
  });

  it('staff: hồ sơ staff, không hoá đơn, house theo vai trò', async () => {
    const body = await session(await login(PHONES.owner));
    expect(body).toMatchObject({ success: true, isAdmin: true, invoices: [] });
    expect(body.user).toMatchObject({ phone: PHONES.owner, roomNumber: 'admin', personType: 'person1', isAdmin: true });
    expect(body.house).toEqual({ role: 'owner', houseIds: expect.arrayContaining(['TRUNG_KIM', 'LVC']) });
  });

  it('tenant-data: cùng khoá với Express, hoá đơn và hồ sơ khớp phiên', async () => {
    const res = await api('/api/sheets/tenant-data', {}, resident);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Object.keys(body).sort()).toEqual(TENANT_DATA_KEYS);
    // Every key Express answers with is there (building, floor and startDate are extra: the session user has them too).
    expect(Object.keys(body.profile)).toEqual(expect.arrayContaining(PROFILE_KEYS));
    expect(Object.keys(body.profile).sort()).toEqual([...PROFILE_KEYS, 'building', 'floor', 'startDate'].sort());
    expect(body.success).toBe(true);
    expect(body.profile).toMatchObject({ name: 'Cư dân Trung Kim', roomNumber: '101', phone: PHONES.residentTk });
    expect(body.allResidentsCount).toBe(1);
    expect(body.invoices).toEqual((await session()).invoices);
  });

  it('cư dân chưa có phòng: không hoá đơn', async () => {
    await (await store()).prepare(`UPDATE residents SET room_id = NULL WHERE phone = ?`).bind(PHONES.residentTk).run();
    const body = await session();
    expect(body.invoices).toEqual([]);
    expect(body.user.roomNumber).toBe('');
  });
});
