import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { LOGIN_LIMITS, loginFailure, loginStatus, registerHit } from '../src/loginLimit.ts';
import { cleanupLoginAttempts } from '../src/cron.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const post = (path: string, body: unknown, ip?: string): Promise<Response> =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, body: JSON.stringify(body) });
const bad = (phone: string, ip?: string) => post('/api/auth/login', { phone, password: 'wrong' }, ip);
const row = (scope: string, key: string) =>
  e.DB.prepare(`SELECT count, window_start, locked_until FROM login_attempts WHERE scope = ? AND key = ?`).bind(scope, key).first<{ count: number; window_start: number; locked_until: number | null }>();
const nowSec = () => Math.floor(Date.now() / 1000);

describe.each(BACKENDS)('login lockout on %s', (backend) => {
  beforeEach(() => seedWorld(backend));

  it('4 wrong passwords answer 401, the 5th locks the phone for 15 minutes (429 AUTH_LOCKED)', async () => {
    for (let i = 0; i < 4; i++) expect((await bad(PHONES.residentTk)).status).toBe(401);
    const fifth = await bad(PHONES.residentTk);
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toMatchObject({ success: false, errorCode: 'AUTH_LOCKED', error: 'Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.' });
    // Even the right password is refused while locked, and the lock is not extended by more attempts.
    const before = (await row('phone', PHONES.residentTk))!;
    const right = await post('/api/auth/login', { phone: PHONES.residentTk, password: '1' });
    expect(right.status).toBe(429);
    expect((await row('phone', PHONES.residentTk))).toEqual(before);
    expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'login_locked' AND target = ?`).bind(PHONES.residentTk).first()).not.toBeNull();
  });

  it('the message names the minutes left', async () => {
    for (let i = 0; i < 5; i++) await bad(PHONES.residentTk);
    await e.DB.prepare(`UPDATE login_attempts SET locked_until = ? WHERE scope = 'phone'`).bind(nowSec() + 5 * 60 + 30).run();
    const res = await bad(PHONES.residentTk);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('Sai mật khẩu quá nhiều lần. Thử lại sau 6 phút.');
  });

  it('a success resets the counter; with no row a success writes nothing', async () => {
    await login(PHONES.residentTk);
    expect(await row('phone', PHONES.residentTk)).toBeNull();
    for (let i = 0; i < 3; i++) await bad(PHONES.residentTk);
    expect((await row('phone', PHONES.residentTk))!.count).toBe(3);
    await login(PHONES.residentTk);
    expect(await row('phone', PHONES.residentTk)).toBeNull();
    for (let i = 0; i < 4; i++) expect((await bad(PHONES.residentTk)).status).toBe(401); // 4 again: not locked
  });

  it('the window expires: old failures stop counting', async () => {
    for (let i = 0; i < 4; i++) await bad(PHONES.residentTk);
    await e.DB.prepare(`UPDATE login_attempts SET window_start = window_start - ? WHERE scope = 'phone'`).bind(LOGIN_LIMITS.windowSec + 1).run();
    expect((await bad(PHONES.residentTk)).status).toBe(401);
    expect((await row('phone', PHONES.residentTk))!.count).toBe(1);
  });

  it('the lock expires on its own (also for the Developer)', async () => {
    for (let i = 0; i < 5; i++) await bad(PHONES.developer);
    expect((await post('/api/auth/login', { phone: PHONES.developer, password: '1' })).status).toBe(429);
    await e.DB.prepare(`UPDATE login_attempts SET locked_until = ?, window_start = window_start - 2000 WHERE scope = 'phone'`).bind(nowSec() - 1).run();
    expect((await post('/api/auth/login', { phone: PHONES.developer, password: '1' })).status).toBe(200);
  });

  it('an unknown phone locks too, with the same shape as a known one', async () => {
    const unknown = '0999999999';
    for (let i = 0; i < 4; i++) expect((await bad(unknown)).status).toBe(401);
    const a = await bad(unknown);
    for (let i = 0; i < 4; i++) await bad(PHONES.residentLvc);
    const b = await bad(PHONES.residentLvc);
    expect(a.status).toBe(429);
    expect(await a.json()).toEqual(await b.json());
  });

  it('per-IP guard: 30 failures from one address (any phones) lock that address', async () => {
    for (let i = 0; i < 29; i++) expect((await bad(`09000010${String(i).padStart(2, '0')}`, '203.0.113.7')).status).toBe(401);
    const last = await bad('0900001099', '203.0.113.7');
    expect(last.status).toBe(429);
    expect(((await last.json()) as { errorCode: string }).errorCode).toBe('AUTH_LOCKED');
    // A good login from that address is refused too; another address is fine.
    expect((await post('/api/auth/login', { phone: PHONES.owner, password: '1' }, '203.0.113.7')).status).toBe(429);
    expect((await post('/api/auth/login', { phone: PHONES.owner, password: '1' }, '203.0.113.8')).status).toBe(200);
    expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'login_locked' AND target = 'ip:203.0.113.7'`).first()).not.toBeNull();
  });

  it('without an IP header only the phone is counted', async () => {
    await bad(PHONES.residentTk);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE scope = 'ip'`).first<{ n: number }>())!.n).toBe(0);
  });

  it('cleanup drops stale rows, keeps live ones', async () => {
    await bad(PHONES.residentTk);
    await e.DB.prepare(`INSERT INTO login_attempts (scope, key, count, window_start) VALUES ('phone', '0911999999', 2, ?)`).bind(nowSec() - 3 * 86400).run();
    await cleanupLoginAttempts(e);
    expect(await row('phone', '0911999999')).toBeNull();
    expect(await row('phone', PHONES.residentTk)).not.toBeNull();
  });
});

describe('limiter helpers with an injected clock', () => {
  beforeEach(() => seedWorld('d1'));

  it('loginFailure counts, locks at the limit and restarts after the window', async () => {
    const t0 = 1_800_000_000;
    for (let i = 1; i <= 4; i++) expect(await loginFailure(e.DB, '0900', null, t0 + i)).toEqual({ phoneLocked: false, ipLocked: false });
    expect((await loginFailure(e.DB, '0900', null, t0 + 5)).phoneLocked).toBe(true);
    expect(await loginStatus(e.DB, '0900', null, t0 + 6)).toMatchObject({ lockedUntil: t0 + 5 + LOGIN_LIMITS.lockSec });
    expect((await loginStatus(e.DB, '0900', null, t0 + 5 + LOGIN_LIMITS.lockSec + 1)).lockedUntil).toBeNull();
    expect((await loginFailure(e.DB, '0900', null, t0 + 5 + LOGIN_LIMITS.lockSec + 2)).phoneLocked).toBe(false);
  });

  it('registerHit allows the limit, then refuses without writing', async () => {
    const t0 = 1_800_000_000;
    for (let i = 0; i < 5; i++) expect(await registerHit(e.DB, 'reg_ip', '1.2.3.4', 5, 3600, t0 + i)).toBe(true);
    expect(await registerHit(e.DB, 'reg_ip', '1.2.3.4', 5, 3600, t0 + 10)).toBe(false);
    expect((await row('reg_ip', '1.2.3.4'))!.count).toBe(5);
    expect(await registerHit(e.DB, 'reg_ip', '1.2.3.4', 5, 3600, t0 + 3601)).toBe(true); // window over
  });
});

describe.each(BACKENDS)('register throttle on %s', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('source_of_truth', 'worker') ON CONFLICT (key) DO UPDATE SET value = 'worker'`).run();
  });
  const reg = (phone: string, ip?: string) =>
    post('/api/auth/register', { name: 'Người Mới', phone, password: 'secret1', roomNumber: '101', houseId: 'TRUNG_KIM' }, ip);

  it('6th attempt from one IP within an hour answers 429 REGISTER_LIMIT', async () => {
    for (let i = 0; i < 5; i++) expect((await reg(`09000009${i}0`, '198.51.100.1')).status).toBeLessThan(429);
    const res = await reg('0900000999', '198.51.100.1');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false, errorCode: 'REGISTER_LIMIT' });
    expect((await reg('0900000998', '198.51.100.2')).status).toBeLessThan(429);
  });

  it('4th attempt for one phone within a day answers 429 REGISTER_LIMIT', async () => {
    for (let i = 0; i < 3; i++) expect((await reg('0900000555')).status).toBeLessThan(429); // 200 then PHONE_TAKEN 400
    expect((await reg('0900000555')).status).toBe(429);
  });
});
