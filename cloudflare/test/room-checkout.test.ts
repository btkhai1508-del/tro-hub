import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const store = () => tenantOfOwner(e, 1);
const post = (token: string, path: string, body: unknown) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, token);

afterEach(() => vi.useRealTimers());

describe.each(BACKENDS)('trả phòng (%s)', (backend) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 20, 5));
    await seedWorld(backend);
  });

  it('mọi cư dân của phòng về trạng thái đã trả phòng, phòng trống, nháp tháng sau chưa có tiền bị xoá', async () => {
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (9101, 'LVC', 3, 'Người ở ghép', '0900009101', 'x', 'approved')`),
      db.prepare(`INSERT INTO invoices (house_id, room_id, month, total, status, issued_at) VALUES ('LVC', 3, '2026-12', 1, 'unpaid', NULL)`),
    ]);
    const owner = await login(PHONES.owner);
    const res = await post(owner, '/api/admin/rooms/3/checkout', { houseId: 'LVC' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, room: '101', movedOut: 2 });
    const left = (await db.prepare(`SELECT status, move_out_date FROM residents WHERE room_id = 3 ORDER BY id`).all<any>()).results;
    expect(left.map((r) => r.status)).toEqual(['moved_out', 'moved_out']);
    expect(left.every((r) => r.move_out_date === '20/11/2026')).toBe(true);
    // This month's invoice is still owed; the next month's empty draft is gone.
    expect(await db.prepare(`SELECT month FROM invoices WHERE room_id = 3 ORDER BY month`).all()).toMatchObject({ results: [{ month: '2026-11' }] });
    const rooms = (await (await post(owner, '/api/admin/rooms/3/checkout', { houseId: 'LVC' })).json()) as any;
    expect(rooms).toMatchObject({ success: false, errorCode: 'ROOM_EMPTY' });
    // The resident can no longer sign in.
    const signIn = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONES.residentLvc, password: '1' }) });
    expect(signIn.status).not.toBe(200);
  });

  it('quản lý chỉ trả phòng của căn được giao; phòng của căn khác bị từ chối', async () => {
    const manager = await login(PHONES.manager); // manages TRUNG_KIM only
    const forbidden = await post(manager, '/api/admin/rooms/3/checkout', { houseId: 'LVC' });
    expect(forbidden.status).toBe(403);
    const wrongHouse = await post(manager, '/api/admin/rooms/3/checkout', { houseId: 'TRUNG_KIM' }); // room 3 is in LVC
    expect(wrongHouse.status).toBe(404);
    expect((await (await store()).prepare(`SELECT status FROM residents WHERE room_id = 3`).first<any>()).status).toBe('approved');
    const ok = await post(manager, '/api/admin/rooms/1/checkout', { houseId: 'TRUNG_KIM' });
    expect(ok.status).toBe(200);
    const resident = await login(PHONES.residentTk).catch(() => null);
    expect(resident).toBeNull();
  });
});
