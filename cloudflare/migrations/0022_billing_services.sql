-- Service fees per house, invoice lines, draft invoices and the source-of-truth switch.

ALTER TABLE houses ADD COLUMN actual_electric_price INTEGER;

ALTER TABLE invoices ADD COLUMN issued_at TEXT;  -- NULL = draft (never shown to residents)

CREATE TABLE house_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  per TEXT NOT NULL CHECK (per IN ('room', 'person', 'vehicle')),
  max_qty INTEGER,
  sheet_col TEXT CHECK (sheet_col IN ('K', 'L', 'M')),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE room_service_optouts (
  room_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  PRIMARY KEY (room_id, service_id)
);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('room', 'electricity', 'water', 'service', 'other')),
  service_id INTEGER,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL
);

-- Seed for the two houses that exist today; a database without them stays unchanged.
INSERT INTO house_services (house_id, name, price, per, max_qty, sheet_col, sort)
SELECT h.id, s.name, s.price, s.per, s.max_qty, s.sheet_col, s.sort
FROM houses h
JOIN (
  SELECT 'Rác' AS name, 30000 AS price, 'room' AS per, NULL AS max_qty, 'K' AS sheet_col, 1 AS sort
  UNION ALL SELECT 'Internet', 40000, 'person', 2, 'L', 2
  UNION ALL SELECT 'Xe máy', 50000, 'vehicle', NULL, 'M', 3
) s
WHERE h.id IN ('TRUNG_KIM', 'LVC');

UPDATE houses SET actual_electric_price = 3300 WHERE id IN ('TRUNG_KIM', 'LVC');

-- Existing invoices: every one is already visible to residents today (the payment gate only controls paying), so all of
-- them count as issued. The gate rule (a current-month invoice is issued only when its gate is START) applies to
-- drafts the Worker creates after the switch, not to this backfill.
UPDATE invoices SET issued_at = created_at WHERE issued_at IS NULL;

-- Central only: the export queue towards the Google Sheet and the source-of-truth switch.
CREATE TABLE sheet_export_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('source_of_truth', 'sheet');
