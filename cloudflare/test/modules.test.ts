import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const send = (method: string, path: string, body: unknown, token: string) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, token);
const setModules = (house: string, value: string | null) =>
  e.DB.prepare(`UPDATE house_directory SET modules = ? WHERE house_id = ?`).bind(value, house).run();
const meter = (token: string, house: string, extra: Record<string, unknown> = {}) =>
  send('POST', '/api/admin/room-detail', { month: '2026-11', room: '101', houseId: house, data: { dienCu: 10, dienMoi: 20 }, ...extra }, token);
const notify = (token: string, target: string) => send('POST', '/api/admin/notifications', { title: 'T', desc: 'D', target }, token);

describe.each(BACKENDS)('Tiện ích enforced by the Worker (%s)', (backend) => {
  let owner: string;
  let manager: string;
  let dev: string;
  let resident: string;
  beforeEach(async () => {
    await seedWorld(backend);
    [owner, manager, dev, resident] = await Promise.all([login(PHONES.owner), login(PHONES.manager), login(PHONES.developer), login(PHONES.residentTk)]);
  });

  it('meter entry: house without "meter" -> 403 MODULE_DISABLED; with it -> 200; NULL = every tool', async () => {
    await setModules('TRUNG_KIM', '["invoices"]'); // core tools only (core keys are implied)
    const off = await meter(manager, 'TRUNG_KIM');
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ success: false, errorCode: 'MODULE_DISABLED' });
    await setModules('TRUNG_KIM', '["meter"]');
    expect((await meter(manager, 'TRUNG_KIM')).status).toBe(200);
    await setModules('TRUNG_KIM', null);
    expect((await meter(manager, 'TRUNG_KIM')).status).toBe(200);
  });

  it('is decided per house: an owner of two houses can enter meters only where the tool is on', async () => {
    await setModules('TRUNG_KIM', '[]');
    await setModules('LVC', '["meter"]');
    expect((await meter(owner, 'TRUNG_KIM')).status).toBe(403);
    expect((await meter(owner, 'LVC')).status).toBe(200);
  });

  it('core routes are unaffected when every non-core tool is off, and marking paid is not a meter write', async () => {
    await setModules('TRUNG_KIM', '[]');
    expect((await api('/api/admin/rooms?houseId=TRUNG_KIM&month=2026-11', {}, manager)).status).toBe(200);
    expect((await api('/api/admin/room-detail?houseId=TRUNG_KIM&room=101&month=2026-11', {}, manager)).status).toBe(200);
    expect((await api('/api/admin/config?houseId=TRUNG_KIM', {}, manager)).status).toBe(200);
    const paid = await send('POST', '/api/admin/room-detail', { month: '2026-11', room: '101', houseId: 'TRUNG_KIM', data: { paymentStatus: 'paid' } }, manager);
    expect(paid.status).toBe(200);
  });

  it('the Developer bypasses', async () => {
    await setModules('TRUNG_KIM', '[]');
    expect((await meter(dev, 'TRUNG_KIM')).status).toBe(200);
  });

  it('notifications: off -> 403; ALL reaches only the houses that have the tool; on -> 200', async () => {
    await setModules('TRUNG_KIM', '[]');
    await setModules('LVC', '[]');
    const off = await notify(owner, 'ALL');
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ errorCode: 'MODULE_DISABLED' });
    expect((await notify(owner, 'TRUNG_KIM')).status).toBe(403);

    await setModules('LVC', '["createNotification"]');
    expect((await notify(owner, 'TRUNG_KIM')).status).toBe(403);
    expect((await notify(owner, 'ALL')).status).toBe(200);
    const list = (await (await api('/api/admin/notifications', {}, owner)).json()) as { notifications: unknown[] };
    expect(list.notifications).toHaveLength(1); // only LVC got it
    expect((await api('/api/notifications', {}, resident)).status).toBe(200); // reading stays open
  });

  it('GET /api/modules: staff get the union, a resident gets their own house, no house = core only', async () => {
    await setModules('TRUNG_KIM', '["laundry"]');
    const core = (await e.DB.prepare(`SELECT key FROM service_modules WHERE core = 1`).all<{ key: string }>()).results.map((m) => m.key);
    const res = (token: string) => api('/api/modules', {}, token).then((r) => r.json() as Promise<{ modules: string[] }>);
    expect((await res(manager)).modules.sort()).toEqual([...core, 'laundry'].sort());
    expect((await res(resident)).modules.sort()).toEqual([...core, 'laundry'].sort());
    expect((await res(dev)).modules).toContain('contract');
    await e.DB.prepare(`DELETE FROM staff_houses WHERE staff_id = 2`).run();
    expect((await res(manager)).modules.sort()).toEqual([...core].sort());
  });

  it('a house the owner creates starts with the core tools only (never NULL)', async () => {
    const made = await send('POST', '/api/houses', { name: 'Mới', abbreviation: 'MOI', rooms: '101-102' }, owner);
    expect(made.status).toBe(200);
    const row = await e.DB.prepare(`SELECT modules FROM house_directory WHERE house_id = 'MOI'`).first<{ modules: string | null }>();
    expect(row!.modules).not.toBeNull();
    const core = (await e.DB.prepare(`SELECT key FROM service_modules WHERE core = 1`).all<{ key: string }>()).results.map((m) => m.key);
    expect((JSON.parse(row!.modules!) as string[]).sort()).toEqual([...core].sort());
  });

  it('a house the Developer creates stores the chosen list plus core (never NULL)', async () => {
    const made = await send('POST', '/api/dev/landlords/1/houses', {
      name: 'Nhà Mới', abbreviation: 'NM2', address_detail: 'x', ward: 'y', province: 'z', floors: 2, price: 1000000,
      rooms: [{ name: '101', floor: 1, capacity: 2 }], modules: ['laundry'],
    }, dev);
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    const row = await e.DB.prepare(`SELECT modules FROM house_directory WHERE house_id = ?`).bind(id).first<{ modules: string | null }>();
    expect(JSON.parse(row!.modules!)).toEqual(expect.arrayContaining(['laundry', 'invoices']));
    expect(JSON.parse(row!.modules!)).not.toContain('meter');
  });
});
