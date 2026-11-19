/**
 * Data isolation between landlords, houses and roles: the guarantee Trọ Hub sells. Every account
 * below has the password "1"; the seed mirrors scripts/seed.ts (two houses, one landlord, one
 * manager of TRUNG_KIM, the Developer, residents in each house).
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/password.ts';

const DB = (env as unknown as { DB: D1Database }).DB;
const BASE = 'https://tro-hub.test';

async function seed() {
  const pw = await hashPassword('1');
  await DB.batch([
    DB.prepare(`DELETE FROM staff_houses`),
    DB.prepare(`DELETE FROM residents`),
    DB.prepare(`DELETE FROM rooms`),
    DB.prepare(`DELETE FROM houses`),
    DB.prepare(`DELETE FROM staff`),
    DB.prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES
      ('TRUNG_KIM', 'NHÀ TRỌ TRUNG KIM', 'NTTK', '116/32 Đường 17', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Chủ trọ', '0902371800'),
      ('LVC', 'NHÀ TRỌ 109/6', 'NT1096', '109/6 Lê Văn Chí', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Chủ trọ', '0902371800')`),
    DB.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (1, 'TRUNG_KIM', '101', 3000000), (3, 'LVC', '101', 3500000)`),
    DB.prepare(`INSERT INTO staff (id, full_name, phone, password_hash, role) VALUES
      (1, 'Chủ trọ', '0902371800', ?1, 'owner'),
      (2, 'Quản lý Trung Kim', '0900000001', ?1, 'manager'),
      (3, 'Developer', '0918338863', ?1, 'developer'),
      (4, 'Chủ trọ khác', '0911111111', ?1, 'owner')`).bind(pw),
    DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (1, 'TRUNG_KIM'), (1, 'LVC'), (2, 'TRUNG_KIM')`),
    DB.prepare(`UPDATE houses SET owner_id = 1`),
    DB.prepare(`INSERT INTO residents (house_id, room_id, full_name, phone, password_hash, status) VALUES
      ('TRUNG_KIM', 1, 'Cư dân Trung Kim', '0900000101', ?1, 'approved'),
      ('LVC', 3, 'Cư dân LVC', '0900000201', ?1, 'approved')`).bind(pw),
  ]);
}

async function login(phone: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: '1' }),
  });
  const data = (await res.json()) as { token?: string };
  expect(res.status, `login ${phone}`).toBe(200);
  return data.token!;
}

const get = (path: string, token?: string) =>
  SELF.fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('cách ly dữ liệu', () => {
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    await seed();
    tokens.developer = await login('0918338863');
    tokens.owner = await login('0902371800');
    tokens.otherOwner = await login('0911111111');
    tokens.manager = await login('0900000001');
    tokens.residentLvc = await login('0900000201');
  });

  it('sai mật khẩu bị từ chối', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0902371800', password: 'sai' }),
    });
    expect(res.status).not.toBe(200);
  });

  it('không có token hoặc token giả thì bị chặn', async () => {
    expect((await get('/api/me')).status).toBe(401);
    expect((await get('/api/me', 'abc.def.ghi')).status).toBe(401);
  });

  it('chỉ Developer vào được /api/dev', async () => {
    expect((await get('/api/dev/landlords', tokens.developer)).status).toBe(200);
    for (const who of ['owner', 'otherOwner', 'manager', 'residentLvc']) {
      expect((await get('/api/dev/landlords', tokens[who])).status, who).toBe(403);
    }
  });

  it('chủ trọ chỉ thấy căn của mình', async () => {
    const mine = (await (await get('/api/houses', tokens.owner)).json()) as { houses: { id: string }[] };
    expect(mine.houses.map((h) => h.id).sort()).toEqual(['LVC', 'TRUNG_KIM']);
    const other = (await (await get('/api/houses', tokens.otherOwner)).json()) as { houses: { id: string }[] };
    expect(other.houses).toEqual([]);
    expect((await get('/api/houses/LVC/rooms', tokens.otherOwner)).status).not.toBe(200);
  });

  it('quản lý chỉ thấy căn được giao', async () => {
    const data = (await (await get('/api/houses', tokens.manager)).json()) as { houses: { id: string }[] };
    expect(data.houses.map((h) => h.id)).toEqual(['TRUNG_KIM']);
    expect((await get('/api/houses/LVC/rooms', tokens.manager)).status).not.toBe(200);
  });

  it('cư dân không xem được căn khác', async () => {
    expect((await get('/api/houses/LVC/payment-portal', tokens.residentLvc)).status).toBe(200);
    expect((await get('/api/houses/TRUNG_KIM/payment-portal', tokens.residentLvc)).status).not.toBe(200);
  });

  it('webhook SePay sai key bị từ chối', async () => {
    const res = await SELF.fetch(`${BASE}/api/sepay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Apikey sai' },
      body: JSON.stringify({ id: 1, content: 'x', transferType: 'in', transferAmount: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
