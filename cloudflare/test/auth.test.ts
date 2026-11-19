import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { signToken } from '../src/token.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe.each(BACKENDS)('auth on %s', (backend) => {
  beforeEach(() => seedWorld(backend));

  it('resident logs in and /api/me returns the right house and room', async () => {
    const token = await login(PHONES.residentTk);
    const res = await api('/api/me', {}, token);
    expect(res.status).toBe(200);
    const { viewer } = (await res.json()) as { viewer: Record<string, unknown> };
    expect(viewer).toMatchObject({ kind: 'resident', name: 'Cư dân Trung Kim', houseId: 'TRUNG_KIM', roomId: 1, roomName: '101' });
    const lvc = (await (await api('/api/me', {}, await login(PHONES.residentLvc))).json()) as { viewer: Record<string, unknown> };
    expect(lvc.viewer).toMatchObject({ houseId: 'LVC', roomId: 3 });
  });

  it('wrong password or unknown phone answers like today', async () => {
    for (const body of [{ phone: PHONES.residentTk, password: 'x' }, { phone: '0999999999', password: '1' }]) {
      const res = await api('/api/auth/login', json(body));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ success: false, errorCode: 'AUTH_INVALID_CREDENTIALS' });
    }
  });

  it('a resident token without tid still works', async () => {
    const token = await login(PHONES.residentTk);
    const sub = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as number;
    const bare = await signToken(sub, 'resident', e.JWT_SECRET);
    expect((await api('/api/me', {}, bare)).status).toBe(200);
  });

  it('changing a resident password ends the old session and the new token works', async () => {
    const old = await login(PHONES.residentTk);
    await new Promise((r) => setTimeout(r, 1100)); // iat and password_changed_at are whole seconds
    const res = await api('/api/auth/change-password', { ...json({ currentPassword: '1', newPassword: 'newpass1' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${old}` } });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect((await api('/api/me', {}, old)).status).toBe(401);
    expect((await api('/api/me', {}, token)).status).toBe(200);
    expect((await api('/api/auth/login', json({ phone: PHONES.residentTk, password: 'newpass1' }))).status).toBe(200);
  });

  it('staff login is unchanged', async () => {
    const token = await login(PHONES.owner);
    const { viewer } = (await (await api('/api/me', {}, token)).json()) as { viewer: Record<string, unknown> };
    expect(viewer).toMatchObject({ kind: 'staff', role: 'owner', houseIds: expect.arrayContaining(['TRUNG_KIM', 'LVC']) });
    const dev = (await (await api('/api/me', {}, await login(PHONES.developer))).json()) as { viewer: { houseIds: string[] } };
    expect(dev.viewer.houseIds).toEqual(expect.arrayContaining(['TRUNG_KIM', 'LVC', 'NTTD']));
  });
});

describe('resident token with the wrong landlord', () => {
  beforeEach(() => seedWorld('do'));

  it('does not reach another landlord resident', async () => {
    const token = await login(PHONES.residentTk); // resident of landlord 1
    const sub = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as number;
    const forged = await signToken(sub, 'resident', e.JWT_SECRET, 4); // landlord 4's store has no such resident
    expect((await api('/api/me', {}, forged)).status).toBe(401);
  });
});
