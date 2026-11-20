/**
 * Abuse limits on the public routes, kept in the central D1 table login_attempts (migration 0024):
 *  - wrong passwords: 5 in a 15-minute window for the same (phone, IP) lock that pair for 15 minutes, so a
 *    stranger from another address cannot lock the real owner out; a high per-phone ceiling (50 across all IPs)
 *    stops distributed guessing; 100 from one IP (IPv6: one /64) lock that address;
 *  - public register: 30 attempts per IP per hour, 5 per phone per day.
 * The Developer can list and clear locks (routes in routes/auth.ts).
 * Cost control for the D1 write budget: a failure is one batched upsert, a success writes only when a row
 * exists, a refused register attempt writes nothing. `now` is Unix seconds, injectable for tests.
 */
export const LOGIN_LIMITS = { maxFails: 5, phoneMaxFails: 50, ipMaxFails: 100, windowSec: 15 * 60, lockSec: 15 * 60 } as const;
export const REGISTER_LIMITS = { ip: { max: 30, windowSec: 3600 }, phone: { max: 5, windowSec: 86400 } } as const;

/** phone_ip: key `phone|ip-key`; phone_all: key phone (all IPs); ip: ip-key; reg_*: register throttles. */
export type LimitScope = 'phone_ip' | 'phone_all' | 'ip' | 'reg_ip' | 'reg_phone';

/** Counter key of an address: IPv4 as is, IPv6 (and v4-mapped) reduced to its /64 so one host cannot hop addresses. */
export function ipKey(ip: string | null | undefined): string | null {
  const raw = (ip ?? '').trim().toLowerCase();
  if (!raw) return null;
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!raw.includes(':')) return raw.slice(0, 45);
  const [head, tail = ''] = raw.split('::');
  const a = head ? head.split(':') : [];
  const b = raw.includes('::') && tail ? tail.split(':') : [];
  const groups = raw.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return 'v6:' + groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '/64';
}
const nowSec = () => Math.floor(Date.now() / 1000);

/** Minutes shown to the user: whole minutes, rounded up, at least 1. */
export const minutesLeft = (lockedUntil: number, now = nowSec()) => Math.max(1, Math.ceil((lockedUntil - now) / 60));

export const lockedMessage = (lockedUntil: number, now = nowSec()) => `Sai mật khẩu quá nhiều lần. Thử lại sau ${minutesLeft(lockedUntil, now)} phút.`;

export interface LoginStatus {
  /** Unix seconds until which this (phone, IP), the phone overall or the IP is locked; null when none is. */
  lockedUntil: number | null;
  /** A (phone, IP) row exists (so a success has something to reset). */
  phoneRow: boolean;
}

/** One read for the three rows a login touches. */
export async function loginStatus(db: D1Database, phone: string, ip: string | null, now = nowSec()): Promise<LoginStatus> {
  const ik = ipKey(ip);
  const pair = `${phone}|${ik ?? ''}`;
  const { results } = await db
    .prepare(`SELECT scope, locked_until FROM login_attempts WHERE (scope = 'phone_ip' AND key = ?1) OR (scope = 'phone_all' AND key = ?2) OR (scope = 'ip' AND key = ?3)`)
    .bind(pair, phone, ik ?? '')
    .all<{ scope: string; locked_until: number | null }>();
  let lockedUntil: number | null = null;
  for (const r of results) if (r.locked_until !== null && r.locked_until > now && (lockedUntil === null || r.locked_until > lockedUntil)) lockedUntil = r.locked_until;
  return { lockedUntil, phoneRow: results.some((r) => r.scope === 'phone_ip') };
}

const failUpsert = (db: D1Database, scope: LimitScope, key: string, limit: number, now: number) =>
  db
    .prepare(
      `INSERT INTO login_attempts (scope, key, count, window_start, locked_until) VALUES (?1, ?2, 1, ?3, NULL)
       ON CONFLICT (scope, key) DO UPDATE SET
         count = CASE WHEN window_start + ?4 <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start + ?4 <= ?3 THEN ?3 ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN window_start + ?4 <= ?3 THEN 1 ELSE count + 1 END) >= ?5 THEN ?3 + ?6 ELSE NULL END
       RETURNING locked_until`
    )
    .bind(scope, key, now, LOGIN_LIMITS.windowSec, limit, LOGIN_LIMITS.lockSec);

/** Records one wrong password (pair, phone ceiling, IP when known) in one batch; says which just became locked. */
export async function loginFailure(db: D1Database, phone: string, ip: string | null, now = nowSec()): Promise<{ phoneLocked: boolean; ipLocked: boolean }> {
  const ik = ipKey(ip);
  const stmts = [failUpsert(db, 'phone_ip', `${phone}|${ik ?? ''}`, LOGIN_LIMITS.maxFails, now), failUpsert(db, 'phone_all', phone, LOGIN_LIMITS.phoneMaxFails, now)];
  if (ik) stmts.push(failUpsert(db, 'ip', ik, LOGIN_LIMITS.ipMaxFails, now));
  const out = await db.batch<{ locked_until: number | null }>(stmts);
  const hit = (i: number) => out[i]?.results[0]?.locked_until != null;
  return { phoneLocked: hit(0) || hit(1), ipLocked: ik ? hit(2) : false };
}

/** A correct password: forget this (phone, IP)'s failures. Call only when loginStatus saw the row (no write otherwise). */
export async function loginSuccess(db: D1Database, phone: string, ip: string | null): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE scope = 'phone_ip' AND key = ?`).bind(`${phone}|${ipKey(ip) ?? ''}`).run();
}

export interface LoginLock { scope: string; key: string; locked_until: number }

/** Locks in force now (Developer view). */
export async function activeLocks(db: D1Database, now = nowSec()): Promise<LoginLock[]> {
  const { results } = await db
    .prepare(`SELECT scope, key, locked_until FROM login_attempts WHERE scope IN ('phone_ip', 'phone_all', 'ip') AND locked_until > ? ORDER BY locked_until DESC LIMIT 200`)
    .bind(now)
    .all<LoginLock>();
  return results;
}

/** Developer unlock: clears every counter and lock of a phone (all IPs). Returns the rows removed. */
export async function unlockPhone(db: D1Database, phone: string): Promise<number> {
  const r = await db
    .prepare(`DELETE FROM login_attempts WHERE (scope = 'phone_all' AND key = ?1) OR (scope = 'phone_ip' AND key LIKE ?1 || '|%')`)
    .bind(phone)
    .run();
  return r.meta.changes ?? 0;
}

/**
 * Counts one public register attempt; false once `max` attempts were made inside the window. A refused
 * attempt writes nothing (the DO UPDATE is skipped), so a flood cannot burn the write budget.
 */
export async function registerHit(db: D1Database, scope: 'reg_ip' | 'reg_phone', key: string, max: number, windowSec: number, now = nowSec()): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (scope, key, count, window_start, locked_until) VALUES (?1, ?2, 1, ?3, NULL)
       ON CONFLICT (scope, key) DO UPDATE SET
         count = CASE WHEN window_start + ?4 <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start + ?4 <= ?3 THEN ?3 ELSE window_start END
       WHERE window_start + ?4 <= ?3 OR count < ?5
       RETURNING count`
    )
    .bind(scope, key, now, windowSec, max)
    .first<{ count: number }>();
  return row !== null;
}

/** Drops rows whose window and lock are both over for good (the longest window is one day). */
export async function purgeStaleAttempts(db: D1Database, now = nowSec()): Promise<void> {
  await db
    .prepare(`DELETE FROM login_attempts WHERE window_start < ?1 AND (locked_until IS NULL OR locked_until < ?1)`)
    .bind(now - 86400)
    .run();
}
