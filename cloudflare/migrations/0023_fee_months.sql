-- Fee settings per month. A snapshot (house_fee_months + house_fee_services) is the fee set of ONE month;
-- house_rates / house_services stay as the live template (mirror of the current month's snapshot, and the id
-- registry for services: service_id is the stable house_services.id that opt-outs and invoice lines point at).
-- Additive only: nothing existing is changed or dropped.

CREATE TABLE house_fee_months (
  house_id TEXT NOT NULL,
  month TEXT NOT NULL,                -- 'YYYY-MM'
  electricity_per_kwh INTEGER NOT NULL DEFAULT 0,
  water_per_m3 INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, month)
);

CREATE TABLE house_fee_services (
  house_id TEXT NOT NULL,
  month TEXT NOT NULL,
  service_id INTEGER NOT NULL,        -- house_services.id
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  per TEXT NOT NULL CHECK (per IN ('room', 'person', 'vehicle')),
  max_qty INTEGER,
  sheet_col TEXT CHECK (sheet_col IN ('K', 'L', 'M')),
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (house_id, month, service_id)
);

-- Backfill: one snapshot of the CURRENT Vietnam month per house, from today's rates and services, so billing
-- behaves exactly as before. Earlier months have no snapshot (they read the template, as they always did).
INSERT INTO house_fee_months (house_id, month, electricity_per_kwh, water_per_m3)
SELECT h.id, strftime('%Y-%m', 'now', '+7 hours'), COALESCE(r.electricity_per_kwh, 0), COALESCE(r.water_per_m3, 0)
FROM houses h LEFT JOIN house_rates r ON r.house_id = h.id;

INSERT INTO house_fee_services (house_id, month, service_id, name, price, per, max_qty, sheet_col, active, sort)
SELECT s.house_id, strftime('%Y-%m', 'now', '+7 hours'), s.id, s.name, s.price, s.per, s.max_qty, s.sheet_col, s.active, s.sort
FROM house_services s;
