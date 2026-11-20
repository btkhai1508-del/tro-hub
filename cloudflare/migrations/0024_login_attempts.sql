-- Abuse limits for the public routes (wrong-password lockout, per-IP guard, register throttle).
-- One row per (scope, key); additive and cheap: a failure is one upsert, a success deletes a row only
-- when one exists, and the daily cron drops stale rows.
--   scope 'phone'      key = phone      wrong password count, locks the phone for 15 minutes at 5 failures
--   scope 'ip'         key = client IP  wrong password count, locks the IP for 15 minutes at 30 failures
--   scope 'reg_ip'     key = client IP  public register attempts per hour (max 5)
--   scope 'reg_phone'  key = phone      public register attempts per day (max 3)
-- Times are Unix seconds. locked_until is NULL unless a lock was set.
CREATE TABLE login_attempts (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER,
  PRIMARY KEY (scope, key)
) WITHOUT ROWID;
