/**
 * Wrong-password limiter for the legacy Express login (sheet mode): 5 consecutive failures for the same
 * phone inside 15 minutes lock that phone for 15 minutes. Same policy as the Worker's /api/auth/login.
 *
 * LIMITATION: state is an in-memory Map, so it is per process. It resets when the server restarts or
 * Render spins the instance down, and would not be shared if more than one instance ran (today there is
 * one). It is a stop-gap for the legacy path; the Worker keeps the authoritative counters in D1.
 */
export interface LoginLimiterOptions {
  maxFails?: number;
  windowMs?: number;
  lockMs?: number;
  maxKeys?: number;
  now?: () => number;
}

export interface LockState { locked: boolean; minutes: number }

export function createLoginLimiter(opts: LoginLimiterOptions = {}) {
  const maxFails = opts.maxFails ?? 5;
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const lockMs = opts.lockMs ?? 15 * 60_000;
  const maxKeys = opts.maxKeys ?? 5000; // bound memory under a flood of random phones
  const now = opts.now ?? Date.now;
  const rows = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

  const minutes = (until: number) => Math.max(1, Math.ceil((until - now()) / 60_000));

  function purge() {
    const t = now();
    for (const [k, r] of rows) if (r.windowStart + windowMs <= t && r.lockedUntil <= t) rows.delete(k);
    // Still too big: drop the oldest UNLOCKED rows only, so a flood of random phones cannot erase a lock.
    for (const [k, r] of rows) {
      if (rows.size <= maxKeys) break;
      if (r.lockedUntil <= t) rows.delete(k);
    }
  }

  return {
    /** Is this phone locked right now? Works for phones that do not exist too. */
    check(key: string): LockState {
      const r = rows.get(key);
      if (r && r.lockedUntil > now()) return { locked: true, minutes: minutes(r.lockedUntil) };
      return { locked: false, minutes: 0 };
    },
    /** Records a wrong password; the failure that reaches the limit locks the phone. */
    fail(key: string): LockState {
      const t = now();
      let r = rows.get(key);
      if (!r || r.windowStart + windowMs <= t) {
        r = { count: 0, windowStart: t, lockedUntil: 0 };
        rows.set(key, r);
        if (rows.size > maxKeys) purge();
      }
      r.count++;
      if (r.count >= maxFails) r.lockedUntil = t + lockMs;
      return r.lockedUntil > t ? { locked: true, minutes: minutes(r.lockedUntil) } : { locked: false, minutes: 0 };
    },
    success(key: string): void {
      rows.delete(key);
    },
    size: () => rows.size,
  };
}

export const lockedMessage = (minutes: number) => `Sai mật khẩu quá nhiều lần. Thử lại sau ${minutes} phút.`;
