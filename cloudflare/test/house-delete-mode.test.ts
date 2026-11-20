import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { reserveResident, setStorage } from '../src/central/directory.ts';
import { purgeDeletedHouses } from '../src/cron.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const send = (method: string, body: unknown, token?: string): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const NEW_HOUSE = {
  name: 'Nhà Thử', abbreviation: 'Nha Thu', address_detail: '1 A', ward: 'W', province: 'P', floors: 2, price: 2000000,
  rooms: [{ name: '101', floor: 1, capacity: 2 }, { name: '102', floor: 1, capacity: 2 }], modules: [], rates: { electricity_per_kwh: 3500 },
};
const HOUSE_TABLES = ['house_fee_services', 'house_fee_months', 'house_services', 'payments', 'meter_readings', 'invoices', 'notifications', 'payment_gates', 'residents', 'rooms', 'house_rates'];
const central = async (sql: string, ...b: unknown[]) => (await e.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;
const audits = async (action: string) =>
  (await e.DB.prepare(`SELECT actor, house_id, target FROM audit_log WHERE action = ? ORDER BY id`).bind(action).all<{ actor: string; house_id: string | null; target: string | null }>()).results;

describe.each(BACKENDS)('chế độ xoá căn [%s]', (backend) => {
  let dev: string;
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM settings WHERE key = 'house_delete_mode'`).run();
    await e.DB.prepare(`DELETE FROM audit_log`).run();
    dev = await login(PHONES.developer);
  });
  const setMode = (mode: string) => api('/api/dev/house-delete-mode', send('PUT', { mode }, dev));
  const del = (id: string) => api(`/api/dev/houses/${id}/delete`, send('POST', {}, dev));
  const storeCount = async (owner: number, table: string, house: string) =>
    (await (await tenantOfOwner(e, owner)).prepare(`SELECT COUNT(*) n FROM ${table} WHERE house_id = ?`).bind(house).first<{ n: number }>())!.n;

  it('mặc định là grace và xoá vẫn hẹn 7 ngày', async () => {
    expect(await (await api('/api/dev/house-delete-mode', {}, dev)).json()).toEqual({ success: true, mode: 'grace', graceDays: 7 });
    const res = await del('LVC');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.deleted).toBeUndefined();
    expect(typeof body.deleteAfter).toBe('string');
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC' AND status = 'inactive' AND delete_after > datetime('now', '+6 days')`)).toBe(1);
    expect(await storeCount(1, 'rooms', 'LVC')).toBe(1);
  });

  it('chỉ Developer: owner/manager/resident 403, chưa đăng nhập 401', async () => {
    for (const phone of [PHONES.owner, PHONES.manager, PHONES.residentTk]) {
      const t = await login(phone);
      expect((await api('/api/dev/house-delete-mode', {}, t)).status).toBe(403);
      expect((await api('/api/dev/house-delete-mode', send('PUT', { mode: 'immediate' }, t))).status).toBe(403);
    }
    expect((await api('/api/dev/house-delete-mode')).status).toBe(401);
    expect((await api('/api/dev/house-delete-mode', send('PUT', { mode: 'immediate' }))).status).toBe(401);
    expect(await central(`SELECT COUNT(*) n FROM settings WHERE key = 'house_delete_mode'`)).toBe(0);
  });

  it('PUT kiểm tra giá trị và ghi audit cũ→mới', async () => {
    for (const bad of [undefined, '', 'now', 'IMMEDIATE', 1, null]) expect((await setMode(bad as any)).status).toBe(400);
    expect((await api('/api/dev/house-delete-mode', { method: 'PUT', headers: { Authorization: `Bearer ${dev}` }, body: 'x' })).status).toBe(400);
    expect(await central(`SELECT COUNT(*) n FROM settings WHERE key = 'house_delete_mode'`)).toBe(0);
    expect(await (await setMode('immediate')).json()).toEqual({ success: true, mode: 'immediate', graceDays: 7 });
    expect(((await (await api('/api/dev/house-delete-mode', {}, dev)).json()) as any).mode).toBe('immediate');
    await setMode('grace');
    expect((await audits('house_delete_mode')).map((a) => a.target)).toEqual(['grace→immediate', 'immediate→grace']);
  });

  it('immediate: xoá hẳn căn, căn khác của cùng chủ và chủ khác còn nguyên', async () => {
    await setMode('immediate');
    // Payments + a gate + an invoice line on LVC so the counts and the cleanup are visible.
    const store = await tenantOfOwner(e, 1);
    const inv = (await store.prepare(`SELECT id FROM invoices WHERE house_id = 'LVC'`).first<{ id: number }>())!.id;
    await store.batch([
      store.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, paid_at) VALUES ('LVC', ?, 100, 'cash', 'x'), ('LVC', ?, 200, 'cash', 'y')`).bind(inv, inv),
      store.prepare(`INSERT INTO payment_gates (house_id, month, value) VALUES ('LVC', '2026-11', 'START')`),
      store.prepare(`INSERT INTO invoice_lines (invoice_id, kind, name, qty, unit_price, amount) VALUES (?, 'room', 'Tiền phòng', 1, 3500000, 3500000)`).bind(inv),
    ]);
    await e.DB.prepare(`INSERT INTO resident_index (resident_id, phone, owner_id, house_id) VALUES (900, '0999999990', 1, 'LVC')`).run().catch(() => {});

    const res = await del('LVC');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deleted: true });

    for (const t of HOUSE_TABLES) expect(await storeCount(1, t, 'LVC'), t).toBe(0);
    expect((await store.prepare(`SELECT COUNT(*) n FROM houses WHERE id = 'LVC'`).first<{ n: number }>())!.n).toBe(0);
    expect((await store.prepare(`SELECT COUNT(*) n FROM invoice_lines WHERE invoice_id = ?`).bind(inv).first<{ n: number }>())!.n).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM resident_index WHERE house_id = 'LVC'`)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM staff_houses WHERE house_id = 'LVC'`)).toBe(0);
    // Same landlord's other house, other landlord, staff links of other houses.
    for (const t of ['rooms', 'residents', 'invoices']) expect(await storeCount(1, t, 'TRUNG_KIM'), t).toBe(1);
    expect(await storeCount(4, 'rooms', 'NTTD')).toBe(2);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id IN ('TRUNG_KIM', 'NTTD')`)).toBe(2);
    expect(await central(`SELECT COUNT(*) n FROM resident_index WHERE house_id = 'TRUNG_KIM'`)).toBe(1);
    expect(await central(`SELECT COUNT(*) n FROM staff_houses WHERE house_id = 'TRUNG_KIM'`)).toBe(2);
    expect(await central(`SELECT room_count n FROM house_directory WHERE house_id = 'TRUNG_KIM'`)).toBe(1);

    const [row] = await audits('house_delete_now');
    expect(row).toMatchObject({ actor: expect.any(String), house_id: 'LVC' });
    expect(row.target).toBe('rooms:1 residents:1 invoices:1 payments:2');
    expect(await audits('house_delete_scheduled')).toEqual([]);
    expect((await audits('house_purged')).map((a) => a.house_id)).toEqual(['LVC']);
    // Deleting it again: 404.
    expect((await del('LVC')).status).toBe(404);
  });

  it('immediate không đụng căn đang chờ xoá; cron vẫn xoá chúng', async () => {
    await e.DB.prepare(`UPDATE house_directory SET status = 'inactive', delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    await (await tenantOfOwner(e, 1)).prepare(`UPDATE houses SET status = 'inactive', delete_after = datetime('now', '-1 day') WHERE id = 'LVC'`).run();
    await setMode('immediate');
    expect((await del('TRUNG_KIM')).status).toBe(200);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`)).toBe(1);
    expect(await storeCount(1, 'rooms', 'LVC')).toBe(1);
    expect(await purgeDeletedHouses(e)).toEqual(['LVC']);
    expect(await storeCount(1, 'rooms', 'LVC')).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`)).toBe(0);
    expect(await storeCount(4, 'rooms', 'NTTD')).toBe(2);
  });

  it('409 HOUSE_BUSY khi kho của chủ trọ đang chuyển, không xoá gì', async () => {
    await setMode('immediate');
    await setStorage(e.DB, 1, 'migrating');
    const res = await del('LVC');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, errorCode: 'HOUSE_BUSY', error: expect.stringContaining('chuyển') });
    await setStorage(e.DB, 1, backend); // unlock to look at the store
    expect(await storeCount(1, 'rooms', 'LVC')).toBe(1);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`)).toBe(1);
    expect(await central(`SELECT COUNT(*) n FROM resident_index WHERE house_id = 'LVC'`)).toBe(1);
    expect(await audits('house_delete_now')).toEqual([]);
  });

  it('đổi về grace thì hành vi cũ trở lại', async () => {
    await setMode('immediate');
    await setMode('grace');
    const res = (await (await del('LVC')).json()) as any;
    expect(res.deleted).toBeUndefined();
    expect(res.deleteAfter).toBeTruthy();
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC' AND status = 'inactive'`)).toBe(1);
    expect(await storeCount(1, 'rooms', 'LVC')).toBe(1);
    expect((await audits('house_delete_scheduled')).length).toBe(1);
  });

  it('chuỗi đầy đủ: chủ trọ + căn có phòng/cư dân/hoá đơn/thu tiền → xoá ngay căn → xoá chủ trọ → không còn gì', async () => {
    await setMode('immediate');
    const land = (await (await api('/api/dev/landlords', send('POST', { fullName: 'Chủ thử', phone: '0955555555', password: 'abcdef' }, dev))).json()) as { id: number };
    const made = (await (await api(`/api/dev/landlords/${land.id}/houses`, send('POST', NEW_HOUSE, dev))).json()) as { id: string };
    const houseId = made.id;
    const store = await tenantOfOwner(e, land.id);
    const rooms = (await store.prepare(`SELECT id FROM rooms WHERE house_id = ?`).bind(houseId).all<{ id: number }>()).results;
    expect(rooms.length).toBe(2);
    const rid = await reserveResident(e.DB, { phone: '0955555501', ownerId: land.id, houseId });
    await store.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (?, ?, ?, 'Cư dân thử', '0955555501', 'x', 'approved')`).bind(rid, houseId, rooms[0].id).run();
    for (const r of rooms)
      await store.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, status, issued_at) VALUES (?, ?, '2026-11', 100, 100, 'paid', '2026-11-01 00:00:00')`).bind(houseId, r.id).run();
    const inv = (await store.prepare(`SELECT id FROM invoices WHERE house_id = ?`).bind(houseId).first<{ id: number }>())!.id;
    await store.prepare(`INSERT INTO payments (house_id, invoice_id, amount, method, paid_at) VALUES (?, ?, 100, 'cash', 'x')`).bind(houseId, inv).run();
    await store.prepare(`INSERT INTO payment_gates (house_id, month, value) VALUES (?, '2026-11', 'START')`).bind(houseId).run();
    // Still has a house: the landlord cannot be deleted yet.
    expect(await (await api(`/api/dev/landlords/${land.id}/delete`, send('POST', {}, dev))).json()).toMatchObject({ errorCode: 'LANDLORD_HAS_HOUSES' });

    expect(await (await del(houseId)).json()).toEqual({ success: true, deleted: true });
    const [row] = await audits('house_delete_now');
    expect(row.target).toBe('rooms:2 residents:1 invoices:2 payments:1');

    const gone = await api(`/api/dev/landlords/${land.id}/delete`, send('POST', {}, dev));
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ success: true });

    for (const t of [...HOUSE_TABLES, 'houses']) {
      const col = t === 'houses' ? 'id' : 'house_id';
      expect((await e.DB.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ?`).bind(houseId).first<{ n: number }>())!.n, `D1 ${t}`).toBe(0);
    }
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE owner_id = ?`, land.id)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM house_directory WHERE house_id = ?`, houseId)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM resident_index WHERE owner_id = ? OR house_id = ?`, land.id, houseId)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM staff_houses WHERE staff_id = ? OR house_id = ?`, land.id, houseId)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM tenant_storage WHERE owner_id = ?`, land.id)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM staff WHERE id = ?`, land.id)).toBe(0);
    expect(await central(`SELECT COUNT(*) n FROM sepay_connections WHERE owner_id = ?`, land.id)).toBe(0);
    // The other landlords are untouched.
    expect(await storeCount(1, 'rooms', 'TRUNG_KIM')).toBe(1);
    expect(await storeCount(4, 'rooms', 'NTTD')).toBe(2);
  });
});
