/**
 * Data isolation between landlords, houses and roles: the guarantee Trọ Hub sells. Every account
 * below has the password "1"; the seed mirrors scripts/seed.ts (two houses, one landlord, one
 * manager of TRUNG_KIM, the Developer, residents in each house).
 */
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { login, PHONES, seedWorld } from './helpers.ts';

const BASE = 'https://tro-hub.test';

const get = (path: string, token?: string) =>
  SELF.fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('cách ly dữ liệu', () => {
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    await seedWorld('d1');
    tokens.developer = await login(PHONES.developer);
    tokens.owner = await login(PHONES.owner);
    tokens.otherOwner = await login(PHONES.otherOwner);
    tokens.manager = await login(PHONES.manager);
    tokens.residentLvc = await login(PHONES.residentLvc);
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
