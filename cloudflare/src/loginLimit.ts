/**
 * Abuse limits on the public routes, kept in the central D1 table login_attempts (migration 0024):
 *  - wrong passwords: 5 in a 15-minute window lock the phone for 15 minutes; 30 from one IP lock the IP;
 *  - public register: 5 attempts per IP per hour, 3 per phone per day.
 * Cost control for the D1 write budget: a failure is one batched upsert, a success writes only when a row
 * exists, a refused register attempt writes nothing. `now` is Unix seconds, injectable for tests.
 */
export const LOGIN_LIMITS = { maxFails: 5, ipMaxFails: 30, windowSec: 15 * 60, lockSec: 15 * 60 } as const;
export const REGISTER_LIMITS = { ip: { max: 5, windowSec: 3600 }, phone: { max: 3, windowSec: 86400 } } as const;

export type LimitScope = 'phone' | 'ip' | 'reg_ip' | 'reg_phone';
const nowSec = () => Math.floor(Date.now() / 1000);

/** Minutes shown to the user: whole minutes, rounded up, at least 1. */
export const minutesLeft = (lockedUntil: number, now = nowSec()) => Math.max(1, Math.ceil((lockedUntil - now) / 60));

export const lockedMessage = (lockedUntil: number, now = nowSec()) => `Sai mật khẩu quá nhiều lần. Thử lại sau ${minutesLeft(lockedUntil, now)} phút.`;

export interface LoginStatus {
  /** Unix seconds until which this phone or IP is locked; null when neither is. */
  lockedUntil: number | null;
  /** A phone row exists (so a success has something to reset). */
  phoneRow: boolean;
}

/** One read for the phone row and the IP row. */
export async function loginStatus(db: D1Database, phone: string, ip: string | null, now = nowSec()): Promise<LoginStatus> {
  const { results } = await db
    .prepare(`SELECT scope, locked_until FROM login_attempts WHERE (scope = 'phone' AND key = ?1) OR (scope = 'ip' AND key = ?2)`)
    .bind(phone, ip ?? '')
    .all<{ scope: string; locked_until: number | null }>();
  let lockedUntil: number | null = null;
  for (const r of results) if (r.locked_until !== null && r.locked_until > now && (lockedUntil === null || r.locked_until > lockedUntil)) lockedUntil = r.locked_until;
  return { lockedUntil, phoneRow: results.some((r) => r.scope === 'phone') };
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

/** Records one wrong password (phone, and IP when known) in a single batch; says which key just became locked. */
export async function loginFailure(db: D1Database, phone: string, ip: string | null, now = nowSec()): Promise<{ phoneLocked: boolean; ipLocked: boolean }> {
  const stmts = [failUpsert(db, 'phone', phone, LOGIN_LIMITS.maxFails, now)];
  if (ip) stmts.push(failUpsert(db, 'ip', ip, LOGIN_LIMITS.ipMaxFails, now));
  const out = await db.batch<{ locked_until: number | null }>(stmts);
  return { phoneLocked: out[0].results[0]?.locked_until != null, ipLocked: ip ? out[1].results[0]?.locked_until != null : false };
}

/** A correct password: forget the phone's failures. Call only when loginStatus saw a row (no write otherwise). */
export async function loginSuccess(db: D1Database, phone: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE scope = 'phone' AND key = ?`).bind(phone).run();
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
