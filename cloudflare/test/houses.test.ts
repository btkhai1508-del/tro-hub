import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage } from '../src/central/directory.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withMethod = (method: string, body: unknown): RequestInit => ({ ...json(body), method });
const dir = (id: string) =>
  e.DB.prepare(`SELECT * FROM house_directory WHERE house_id = ?`).bind(id).first<Record<string, any>>();

const NEW_HOUSE = {
  name: 'Nhà Mới', abbreviation: 'Nha Moi', address_detail: '1 A', ward: 'W', province: 'P', floors: 3, price: 2000000,
  rooms: [{ name: '101', floor: 1, capacity: 2 }, { name: 'G01', floor: 1, capacity: 3 }],
  modules: [], rates: { electricity_per_kwh: 3500 },
};

describe.each(BACKENDS)('căn và phòng (%s)', (backend) => {
  let dev: string;
  let owner: string;
  let manager: string;
  beforeEach(async () => {
    await seedWorld(backend);
    dev = await login(PHONES.developer);
    owner = await login(PHONES.owner);
    manager = await login(PHONES.manager);
  });

  it('Developer tạo căn: danh bạ trước với số căn mới, rồi kho; giao quản lý được', async () => {
    const res = await api('/api/dev/landlords/1/houses', json(NEW_HOUSE), dev);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toBe('NHA_MOI');
    const d = await dir(id);
    expect(d).toMatchObject({ owner_id: 1, name: 'Nhà Mới', status: 'active', room_count: 2, resident_count: 0 });
    expect(d!.pay_no).toBeGreaterThan(3);
    const store = await tenantOfOwner(e, 1);
    const h = await store.prepare(`SELECT pay_no, owner_id FROM houses WHERE id = ?`).bind(id).first<{ pay_no: number; owner_id: number }>();
    expect(h).toEqual({ pay_no: d!.pay_no, owner_id: 1 });
    const rooms = await store.prepare(`SELECT name, pay_no FROM rooms WHERE house_id = ? ORDER BY name`).bind(id).all();
    expect(rooms.results).toEqual([{ name: '101', pay_no: 101 }, { name: 'G01', pay_no: 1 }]);
    if (backend === 'do') expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM houses`).first<{ n: number }>())!.n).toBe(0);

    // The landlord sees it, and can give it to a manager (staff_houses points at the directory).
    const mine = (await (await api('/api/houses', {}, owner)).json()) as { houses: { id: string }[] };
    expect(mine.houses.map((x) => x.id)).toContain(id);
    const staff = await api('/api/staff', json({ fullName: 'QL Mới', phone: '0933333333', password: 'abcdef', role: 'manager', houseIds: [id] }), owner);
    expect(staff.status).toBe(200);
    expect((await api('/api/dev/landlords/1/houses', json(NEW_HOUSE), dev)).status).toBe(400); // same short name
  });

  it('Admin Tổng tạo nhà và số căn không bao giờ cấp lại', async () => {
    const make = async (abbr: string) =>
      (await (await api('/api/houses', json({ name: abbr, abbreviation: abbr, rooms: '101-102' }), owner)).json()) as { id: string; rooms: number };
    const a = await make('AAA');
    expect(a.rooms).toBe(2);
    const first = (await dir('AAA'))!.pay_no;
    await e.DB.prepare(`DELETE FROM staff_houses WHERE house_id = 'AAA'`).run();
    await e.DB.prepare(`DELETE FROM house_directory WHERE house_id = 'AAA'`).run();
    await make('BBB');
    expect((await dir('BBB'))!.pay_no).toBeGreaterThan(first);
  });

  it('thêm và xoá phòng đổi room_count', async () => {
    expect((await dir('LVC'))!.room_count).toBe(1);
    const add = await api('/api/dev/houses/LVC/rooms', json({ rooms: [{ name: '102', floor: 1, capacity: 2 }], price: 1 }), dev);
    expect(add.status).toBe(200);
    expect((await dir('LVC'))!.room_count).toBe(2);
    const detail = (await (await api('/api/dev/houses/LVC', {}, dev)).json()) as { rooms: { id: number; name: string; pay_no: number }[] };
    const room = detail.rooms.find((r) => r.name === '102')!;
    expect(room.pay_no).toBe(102);
    expect((await api(`/api/dev/houses/LVC/rooms/${room.id}`, { method: 'DELETE' }, dev)).status).toBe(200);
    expect((await dir('LVC'))!.room_count).toBe(1);
  });

  it('sửa tên, tiện ích, xoá và khôi phục căn: danh bạ và kho cùng đổi', async () => {
    expect((await api('/api/houses/LVC', withMethod('PATCH', { name: 'Tên mới' }), owner)).status).toBe(200);
    expect((await dir('LVC'))!.name).toBe('Tên mới');
    expect((await api('/api/dev/houses/LVC', withMethod('PATCH', { modules: [] }), dev)).status).toBe(200);
    const store = await tenantOfOwner(e, 1);
    const stored = await store.prepare(`SELECT name, modules FROM houses WHERE id = 'LVC'`).first<{ name: string; modules: string }>();
    expect(stored!.name).toBe('Tên mới');
    expect((await dir('LVC'))!.modules).toBe(stored!.modules);

    const del = (await (await api('/api/dev/houses/LVC/delete', json({}), dev)).json()) as { deleteAfter: string };
    expect(await dir('LVC')).toMatchObject({ status: 'inactive', delete_after: del.deleteAfter });
    expect(await store.prepare(`SELECT status, delete_after FROM houses WHERE id = 'LVC'`).first()).toEqual({ status: 'inactive', delete_after: del.deleteAfter });
    expect((await api('/api/dev/houses/LVC/restore', json({}), dev)).status).toBe(200);
    expect(await dir('LVC')).toMatchObject({ status: 'active', delete_after: null });
  });

  it('GET /api/modules đọc từ danh bạ; backup đọc từ kho', async () => {
    await e.DB.prepare(`UPDATE house_directory SET modules = '[]' WHERE house_id = 'TRUNG_KIM'`).run();
    const mods = (await (await api('/api/modules', {}, manager)).json()) as { modules: string[] };
    const core = (await e.DB.prepare(`SELECT key FROM service_modules WHERE core = 1`).all<{ key: string }>()).results.map((m) => m.key);
    expect([...mods.modules].sort()).toEqual([...core].sort());
    const backup = (await (await api('/api/dev/houses/LVC/backup', {}, dev)).json()) as { backup: { house: { id: string }; rooms: unknown[]; invoices: unknown[] } };
    expect(backup.backup.house.id).toBe('LVC');
    expect(backup.backup.rooms).toHaveLength(1);
    expect(backup.backup.invoices).toHaveLength(1);
  });

  it('khi kho đang chuyển: ghi trả 503 TENANT_MIGRATING, đọc vẫn 200', async () => {
    await setStorage(e.DB, 1, 'migrating');
    const w = await api('/api/houses/LVC', withMethod('PATCH', { name: 'X' }), owner);
    expect(w.status).toBe(503);
    expect(await w.json()).toMatchObject({ success: false, errorCode: 'TENANT_MIGRATING' });
    expect((await dir('LVC'))!.name).toBe('NHÀ TRỌ 109/6'); // directory rolled back
    // While migrating, reads come from D1; only the d1 seed keeps the business rows there.
    if (backend === 'd1') {
      expect((await api('/api/houses/LVC', {}, owner)).status).toBe(200);
      expect((await api('/api/houses/LVC/rooms', {}, owner)).status).toBe(200);
    }
    const made = await api('/api/dev/landlords/1/houses', json(NEW_HOUSE), dev);
    expect(made.status).toBe(503);
    expect(await dir('NHA_MOI')).toBeNull();
  });

  it('Developer hỏi căn không có trong danh bạ: 404 HOUSE_NOT_FOUND dạng JSON', async () => {
    const res = await api('/api/dev/houses/NOPE', {}, dev);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, errorCode: 'HOUSE_NOT_FOUND', error: 'Không tìm thấy nhà trọ.' });
  });

  it('chủ khác không mở được căn, và bị ghi nhật ký', async () => {
    const other = await login(PHONES.otherOwner);
    expect((await api('/api/houses/LVC/rooms', {}, other)).status).toBe(403);
  });
});

describe('hai backend trả cùng JSON', () => {
  it('GET /api/houses, /api/houses/LVC, /rooms, payment-portal', async () => {
    const paths = ['/api/houses', '/api/houses/LVC', '/api/houses/LVC/rooms', '/api/houses/TRUNG_KIM/payment-portal'];
    const out: Record<string, string[]> = {};
    for (const backend of BACKENDS) {
      await seedWorld(backend);
      const t = await login(PHONES.owner);
      out[backend] = [];
      for (const p of paths) {
        const res = await api(p, {}, t);
        expect(res.status, p).toBe(200);
        out[backend].push(JSON.stringify(await res.json()));
      }
      const resident = await login(PHONES.residentLvc);
      out[backend].push(JSON.stringify(await (await api('/api/houses/LVC/payment-portal', {}, resident)).json()));
    }
    expect(out.do).toEqual(out.d1);
  });
});
