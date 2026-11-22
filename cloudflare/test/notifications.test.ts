import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../src/app.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const send = (path: string, body: unknown, token: string) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, token);
const notify = (token: string, body: Record<string, unknown>) => send('/api/admin/notifications', { title: 'T', desc: 'D', ...body }, token);
const loginWith = async (phone: string) =>
  ((await (await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: '123456' }) })).json()) as { token: string }).token;
const inbox = async (token: string) => ((await (await api('/api/notifications', {}, token)).json()) as { notifications: { title: string }[] }).notifications;

describe.each(BACKENDS)('notifications for any house (%s)', (backend) => {
  let owner: string;
  let otherOwner: string;
  let residentTk: string;
  let residentNttd: string;
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (4, 'NTTD')`).run(); // the second landlord manages NTTD
    [owner, otherOwner, residentTk] = await Promise.all([login(PHONES.owner), login(PHONES.otherOwner), login(PHONES.residentTk)]);
    for (const [i, name] of ['101', '102'].entries()) {
      const res = await send('/api/houses/NTTD/residents', { fullName: `Cư dân ${name}`, phone: `091200000${i}`, password: '123456', roomId: 5 + i }, otherOwner);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    residentNttd = await loginWith('0912000000');
  });

  it('a non-legacy house id the staff manages is created and only that house sees it', async () => {
    const res = await notify(otherOwner, { target: 'NTTD', title: 'Cho NTTD' });
    expect(res.status).toBe(200);
    expect((await inbox(residentNttd)).map((n) => n.title)).toEqual(['Cho NTTD']);
    expect(await inbox(residentTk)).toEqual([]);
  });

  it('custom rooms with houseId reach only that house\'s room', async () => {
    const res = await notify(otherOwner, { target: 'CUSTOM', title: 'Phòng 102', customRooms: [{ houseId: 'NTTD', room: '102' }] });
    expect(res.status).toBe(200);
    expect(await inbox(residentNttd)).toEqual([]); // resident of 101
    const resident102 = await loginWith('0912000001');
    expect((await inbox(resident102)).map((n) => n.title)).toEqual(['Phòng 102']);
    expect(await inbox(residentTk)).toEqual([]);
  });

  it('legacy forms keep working', async () => {
    expect((await notify(owner, { target: 'LVC', title: 'L' })).status).toBe(200);
    expect((await notify(owner, { target: 'CUSTOM', title: 'C', customRooms: ['101'] })).status).toBe(200);
    expect((await inbox(residentTk)).map((n) => n.title)).toEqual(['C']);
  });

  it('a house of another landlord -> 403', async () => {
    const res = await notify(owner, { target: 'NTTD' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, errorCode: 'NOTIFICATION_FORBIDDEN' });
    expect((await notify(owner, { target: 'CUSTOM', customRooms: [{ houseId: 'NTTD', room: '101' }] })).status).toBe(403);
    expect((await notify(owner, { target: 'NO_SUCH_HOUSE' })).status).toBe(403);
    expect(await inbox(residentNttd)).toEqual([]);
  });
});
