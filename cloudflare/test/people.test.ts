import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage, updateResidentIndex } from '../src/central/directory.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const json = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const withMethod = (method: string, body: unknown): RequestInit => ({ ...json(body), method });
const payload = (token: string) => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
const indexRow = (phone: string) =>
  e.DB.prepare(`SELECT resident_id, owner_id, house_id FROM resident_index WHERE phone = ?`).bind(phone).first<{ resident_id: number; owner_id: number; house_id: string }>();
const dirRow = (id: string) => e.DB.prepare(`SELECT room_count, resident_count FROM house_directory WHERE house_id = ?`).bind(id).first<{ room_count: number; resident_count: number }>();

const NEW_RESIDENT = { fullName: 'Cư dân Mới', phone: '0900000777', password: 'secret1', roomId: 1 };
const NEW_HOUSE = {
  name: 'Nhà Mới', abbreviation: 'Nha Moi', address_detail: '1 A', ward: 'W', province: 'P', floors: 3, price: 2000000,
  rooms: [{ name: '101', floor: 1, capacity: 2 }], modules: [], rates: { electricity_per_kwh: 3500 },
};

describe.each(BACKENDS)('cư dân, staff, chủ trọ (%s)', (backend) => {
  let dev: string;
  let owner: string;
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM settings WHERE key = 'new_owner_backend'`).run();
    dev = await login(PHONES.developer);
    owner = await login(PHONES.owner);
  });

  it('tạo cư dân: id từ resident_index, có trong kho, bộ đếm tăng', async () => {
    const res = await api('/api/houses/TRUNG_KIM/residents', json(NEW_RESIDENT, owner));
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await indexRow(NEW_RESIDENT.phone)).toEqual({ resident_id: id, owner_id: 1, house_id: 'TRUNG_KIM' });
    const store = await tenantOfOwner(e, 1);
    expect(await store.prepare(`SELECT house_id, room_id, status FROM residents WHERE id = ?`).bind(id).first()).toEqual({ house_id: 'TRUNG_KIM', room_id: 1, status: 'approved' });
    expect((await dirRow('TRUNG_KIM'))!.resident_count).toBe(2);
  });

  it('kho lỗi thì không để lại dòng resident_index', async () => {
    const seq = await e.DB.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'resident_index'`).first<{ seq: number }>();
    const next = seq!.seq + 1;
    // A row already holds the id the index will hand out, so the store's INSERT hits the primary key.
    const store = await tenantOfOwner(e, 1);
    await store.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, password_hash, status) VALUES (?, 'TRUNG_KIM', 1, 'Chiếm id', 'x', 'rejected')`).bind(next).run();
    const res = await api('/api/houses/TRUNG_KIM/residents', json(NEW_RESIDENT, owner));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await indexRow(NEW_RESIDENT.phone)).toBeNull();
    expect((await dirRow('TRUNG_KIM'))!.resident_count).toBe(1);
  });

  it('số điện thoại của staff không tạo được cư dân', async () => {
    const res = await api('/api/houses/TRUNG_KIM/residents', json({ ...NEW_RESIDENT, phone: PHONES.manager }, owner));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, errorCode: 'PHONE_TAKEN', error: 'Số điện thoại này đã có tài khoản.' });
  });

  it('số của cư dân (đã sang kho) không tạo được chủ trọ hay staff', async () => {
    const land = await api('/api/dev/landlords', json({ fullName: 'Chủ mới', phone: PHONES.residentTk, password: 'abcdef' }, dev));
    expect(land.status).toBe(400);
    expect(await land.json()).toMatchObject({ errorCode: 'PHONE_TAKEN', error: 'Số điện thoại này đã có tài khoản.' });
    const staff = await api('/api/staff', json({ fullName: 'QL', phone: PHONES.residentTk, password: 'abcdef', role: 'manager', houseIds: ['TRUNG_KIM'] }, owner));
    expect(staff.status).toBe(400);
    expect(await staff.json()).toMatchObject({ errorCode: 'PHONE_TAKEN' });
    const edit = await api('/api/dev/landlords/4', withMethod('PATCH', { phone: PHONES.residentLvc }), dev);
    expect(edit.status).toBe(400);
    // The same phone again for a second resident is refused too.
    expect((await api('/api/houses/TRUNG_KIM/residents', json({ ...NEW_RESIDENT, phone: PHONES.residentLvc }, owner))).status).toBe(400);
  });

  it('danh sách chủ trọ có room_count/resident_count đúng', async () => {
    const list = async () => {
      const res = await api('/api/dev/landlords', {}, dev);
      expect(res.status).toBe(200);
      const { landlords } = (await res.json()) as { landlords: { id: number; houses: Record<string, any>[] }[] };
      return landlords;
    };
    let ls = await list();
    const h = (o: number, id: string) => ls.find((l) => l.id === o)!.houses.find((x) => x.id === id)!;
    expect(h(1, 'TRUNG_KIM')).toMatchObject({ name: 'NHÀ TRỌ TRUNG KIM', room_count: 1, resident_count: 1, status: 'active', abbreviation: 'NTTK' });
    expect(h(1, 'TRUNG_KIM')).toHaveProperty('monthly_fee');
    expect(h(4, 'NTTD')).toMatchObject({ room_count: 2, resident_count: 0 });
    await api('/api/houses/TRUNG_KIM/residents', json(NEW_RESIDENT, owner));
    ls = await list();
    expect(h(1, 'TRUNG_KIM').resident_count).toBe(2);
  });

  it('tạo chủ trọ: có dòng tenant_storage theo new_owner_backend; xoá chủ trọ không còn căn', async () => {
    const res = await api('/api/dev/landlords', json({ fullName: 'Chủ mới', phone: '0933333333', password: 'abcdef' }, dev));
    const { id } = (await res.json()) as { id: number };
    const row = await e.DB.prepare(`SELECT backend FROM tenant_storage WHERE owner_id = ?`).bind(id).first<{ backend: string }>();
    expect(row!.backend).toBe('d1');
    expect((await api(`/api/dev/landlords/${id}/delete`, json({}, dev))).status).toBe(200);
    expect(await e.DB.prepare(`SELECT 1 FROM tenant_storage WHERE owner_id = ?`).bind(id).first()).toBeNull();
    // A landlord with houses cannot be deleted.
    const withHouses = await api('/api/dev/landlords/1/delete', json({}, dev));
    expect(withHouses.status).toBe(400);
    expect(await withHouses.json()).toMatchObject({ errorCode: 'LANDLORD_HAS_HOUSES' });
  });

  it('new_owner_backend=do: chủ trọ mới tạo căn → dữ liệu chỉ nằm trong kho owner:<id>, D1 không có dòng', async () => {
    await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('new_owner_backend', 'do') ON CONFLICT (key) DO UPDATE SET value = 'do'`).run();
    const res = await api('/api/dev/landlords', json({ fullName: 'Chủ riêng', phone: '0944444444', password: 'abcdef' }, dev));
    const { id } = (await res.json()) as { id: number };
    expect((await e.DB.prepare(`SELECT backend FROM tenant_storage WHERE owner_id = ?`).bind(id).first<{ backend: string }>())!.backend).toBe('do');
    const made = await api(`/api/dev/landlords/${id}/houses`, json(NEW_HOUSE, dev));
    expect(made.status).toBe(200);
    const { id: houseId } = (await made.json()) as { id: string };
    expect(await e.DB.prepare(`SELECT 1 FROM houses WHERE id = ?`).bind(houseId).first()).toBeNull();
    expect(await e.DB.prepare(`SELECT 1 FROM rooms WHERE house_id = ?`).bind(houseId).first()).toBeNull();
    const own = await (await tenantOfOwner(e, id)).prepare(`SELECT id FROM houses`).all<{ id: string }>();
    expect(own.results.map((r) => r.id)).toEqual([houseId]);
  });

  it('cư dân tạo xong đăng nhập được; đổi số điện thoại thì số mới vào được, số cũ thì không', async () => {
    const res = await api('/api/houses/TRUNG_KIM/residents', json(NEW_RESIDENT, owner));
    const { id } = (await res.json()) as { id: number };
    const login1 = await api('/api/auth/login', json({ phone: NEW_RESIDENT.phone, password: NEW_RESIDENT.password }));
    expect(login1.status).toBe(200);
    // No route edits a resident's phone yet: do what one must (store first, index second).
    const store = await tenantOfOwner(e, 1);
    await store.prepare(`UPDATE residents SET phone = ? WHERE id = ?`).bind('0900000888', id).run();
    await updateResidentIndex(e.DB, id, { phone: '0900000888' });
    expect((await api('/api/auth/login', json({ phone: '0900000888', password: NEW_RESIDENT.password }))).status).toBe(200);
    expect((await api('/api/auth/login', json({ phone: NEW_RESIDENT.phone, password: NEW_RESIDENT.password }))).status).toBe(401);
  });

  it('token cư dân có tid, token staff thì không', async () => {
    const resident = await login(PHONES.residentTk);
    expect(payload(resident)).toMatchObject({ kind: 'resident', tid: 1 });
    expect(payload(owner)).not.toHaveProperty('tid');
    expect(payload(await login(PHONES.manager))).not.toHaveProperty('tid');
  });

  it('đổi mật khẩu cư dân khi chủ trọ đang migrating → 503 TENANT_MIGRATING', async () => {
    const resident = await login(PHONES.residentTk);
    if (backend === 'do') {
      // While a landlord is moving, the rows are already copied into D1 (reads come from there).
      const store = await tenantOfOwner(e, 1);
      const r = await store.prepare(`SELECT id, house_id, room_id, full_name, phone, password_hash, status FROM residents WHERE phone = ?`).bind(PHONES.residentTk).first<Record<string, any>>();
      await e.DB.prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES ('TRUNG_KIM', 'x', 'x', 'x', 'x', 'x', 'x', 'x') ON CONFLICT DO NOTHING`).run();
      await e.DB.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (?, ?, NULL, ?, ?, ?, ?)`)
        .bind(r!.id, r!.house_id, r!.full_name, r!.phone, r!.password_hash, r!.status).run();
    }
    await setStorage(e.DB, 1, 'migrating');
    const res = await api('/api/auth/change-password', json({ currentPassword: '1', newPassword: 'newpass1' }, resident));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, errorCode: 'TENANT_MIGRATING' });
  });
});
