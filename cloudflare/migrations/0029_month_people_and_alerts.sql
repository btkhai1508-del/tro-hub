-- Đợt 4. Additive only: nothing existing is changed or dropped.
-- 1) The people / vehicles a month was billed for. A draft stores the count of that month, issuing freezes it.
--    NULL = an invoice from before this migration, it keeps counting today's residents, as before.
ALTER TABLE invoices ADD COLUMN people INTEGER;
ALTER TABLE invoices ADD COLUMN vehicles INTEGER;

-- 2) Resident notices written by the Worker itself (one per issued invoice) carry a key so a retry adds nothing.
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 3) The admin bell (landlord and managers). kind has no CHECK so later kinds (password reset requests) fit.
CREATE TABLE IF NOT EXISTS admin_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  kind TEXT NOT NULL,                 -- 'invoice_paid' | 'overpaid'
  room_name TEXT,
  month TEXT,                         -- 'YYYY-MM'
  invoice_id INTEGER,
  amount INTEGER,
  received_at TEXT NOT NULL,          -- when SePay received the money, else when it was marked paid (UTC)
  source TEXT,                        -- 'sepay' | 'staff:<id>' | 'recompute'
  dedupe_key TEXT NOT NULL UNIQUE,    -- 'paid:<invoiceId>' | 'sepay:<sepayId>': a webhook sent again adds nothing
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS admin_alerts_house ON admin_alerts(house_id, created_at);

-- Read state is per person: the landlord reading an alert does not mark it read for the manager.
CREATE TABLE IF NOT EXISTS admin_alert_reads (
  alert_id INTEGER NOT NULL REFERENCES admin_alerts(id),
  reader TEXT NOT NULL,               -- 'staff:<id>'
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (alert_id, reader)
);
