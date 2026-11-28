// Schema of a per-landlord Durable Object store: the business tables copied from D1 (final shape
// after migrations 0001-0026) plus a `meta` key/value table. The only change: `houses.owner_id` has
// no REFERENCES staff(id) because staff lives in the central D1 only.

export type SqlValue = string | number | null;

const LEADING_TRIVIA_RE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;
const WRITE_VERB_RE = /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
const WITH_RE = /^WITH\b/i;
const WRITE_WORD_RE = /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;

/**
 * Whether a statement writes data: after leading whitespace and comments it starts with
 * INSERT/UPDATE/DELETE/REPLACE, or it is a WITH statement that contains one of those words. The one
 * detector for both the store (which reports changes only for writes) and the read-only wrapper.
 * A WITH read that merely mentions one of the words (say `replace(...)`) counts as a write.
 */
export function isWriteSql(sql: string): boolean {
  const body = sql.replace(LEADING_TRIVIA_RE, '');
  return WRITE_VERB_RE.test(body) || (WITH_RE.test(body) && WRITE_WORD_RE.test(body));
}

export interface TenantTable {
  name: string;
  pk: string[];
}

/** Tables copied into a tenant store, in copy order (parents before children). */
export const TENANT_TABLES: readonly TenantTable[] = [
  { name: 'houses', pk: ['id'] },
  { name: 'house_rates', pk: ['house_id'] },
  { name: 'rooms', pk: ['id'] },
  { name: 'residents', pk: ['id'] },
  { name: 'invoices', pk: ['id'] },
  { name: 'house_services', pk: ['id'] },
  { name: 'house_fee_months', pk: ['house_id', 'month'] },
  { name: 'house_fee_services', pk: ['house_id', 'month', 'service_id'] },
  { name: 'room_service_optouts', pk: ['room_id', 'service_id'] },
  { name: 'invoice_lines', pk: ['id'] },
  { name: 'meter_readings', pk: ['id'] },
  { name: 'payments', pk: ['id'] },
  { name: 'payment_gates', pk: ['house_id', 'month'] },
  { name: 'notifications', pk: ['id'] },
  { name: 'admin_alerts', pk: ['id'] },
  { name: 'admin_alert_reads', pk: ['alert_id', 'reader'] },
];

/** Element i brings the schema to version i + 1. Append only; never edit an applied entry. */
export const TENANT_MIGRATIONS: readonly string[] = [
  `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE houses (
  id TEXT PRIMARY KEY,                -- ví dụ 'TRUNG_KIM', 'LVC'
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  address_detail TEXT NOT NULL,       -- chỉ số nhà + tên đường
  ward TEXT NOT NULL,
  province TEXT NOT NULL,
  landlord_name TEXT NOT NULL,
  landlord_phone TEXT NOT NULL,
  sheet_id TEXT,                      -- Google Sheet dự phòng, có thể trống
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, bank_name TEXT, bank_code TEXT, bank_account_no TEXT, bank_account_name TEXT, bank_bin TEXT, floors INTEGER, owner_id INTEGER, delete_after TEXT, modules TEXT, pay_no INTEGER);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  name TEXT NOT NULL,                 -- không trùng trong cùng một nhà
  price INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 3,
  deleted_at TEXT, deposit INTEGER NOT NULL DEFAULT 0, floor INTEGER, pay_no INTEGER,
  UNIQUE (house_id, name)
);

CREATE TABLE residents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_id INTEGER REFERENCES rooms(id),  -- trống khi đang chờ duyệt
  full_name TEXT NOT NULL,
  gender TEXT,
  phone TEXT UNIQUE,                  -- trống: chưa đăng nhập bằng SĐT được
  password_hash TEXT NOT NULL,
  cccd_enc TEXT,                      -- CCCD mã hoá AES-GCM
  cccd_last4 TEXT,
  cccd_hash TEXT UNIQUE,              -- để kiểm tra trùng mà không cần giải mã
  email TEXT,
  dob TEXT,
  address_detail TEXT,
  ward TEXT,
  province TEXT,
  plate_number TEXT,
  vehicle_type TEXT,
  emergency_name TEXT,
  emergency_relation TEXT,
  emergency_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'moved_out')),
  move_in_date TEXT,
  move_out_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, password_changed_at INTEGER);

CREATE TABLE house_rates (
  house_id TEXT PRIMARY KEY REFERENCES houses(id),
  electricity_per_kwh INTEGER NOT NULL DEFAULT 0,
  water_per_m3 INTEGER NOT NULL DEFAULT 0,
  trash INTEGER NOT NULL DEFAULT 0,
  internet INTEGER NOT NULL DEFAULT 0,
  parking INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meter_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  month TEXT NOT NULL,
  electric_old INTEGER NOT NULL DEFAULT 0,
  electric_new INTEGER NOT NULL DEFAULT 0,
  water_old INTEGER NOT NULL DEFAULT 0,
  water_new INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room_id, month)
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  month TEXT NOT NULL,
  room_rent INTEGER NOT NULL DEFAULT 0,
  electricity INTEGER NOT NULL DEFAULT 0,
  water INTEGER NOT NULL DEFAULT 0,
  trash INTEGER NOT NULL DEFAULT 0,
  internet INTEGER NOT NULL DEFAULT 0,
  parking INTEGER NOT NULL DEFAULT 0,
  other INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'pending', 'paid', 'cash')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), sheet_row INTEGER, synced_at TEXT, status_by TEXT,
  UNIQUE (room_id, month)
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT REFERENCES houses(id),
  invoice_id INTEGER REFERENCES invoices(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('bank', 'cash')),
  bank_name TEXT,
  account_no TEXT,
  reference TEXT UNIQUE,              -- mã tham chiếu của ngân hàng, chặn ghi trùng
  content TEXT,
  paid_at TEXT NOT NULL,
  confirmed_by TEXT,                  -- 'staff:3' khi quản lý xác nhận tiền mặt
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_names TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('invoice', 'alert', 'success', 'info')),
  time_label TEXT,
  sender TEXT,
  scheduled_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE payment_gates (
  house_id TEXT NOT NULL REFERENCES houses(id),
  month TEXT NOT NULL,               -- 'YYYY-MM'
  value TEXT NOT NULL CHECK (value IN ('START', 'STOP')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, month)
);

CREATE INDEX residents_house ON residents(house_id, status);

CREATE INDEX invoices_house_month ON invoices(house_id, month);

CREATE INDEX payments_house ON payments(house_id, paid_at);

CREATE INDEX notifications_house ON notifications(house_id, created_at);

CREATE UNIQUE INDEX houses_pay_no ON houses(pay_no);

CREATE UNIQUE INDEX rooms_pay_no ON rooms(house_id, pay_no);
`,

  // 0022: service fees, invoice lines, draft invoices. Mirrors D1 migration 0022 (store part, incl. seed and backfill).
  `
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
`,

  // 0023: fee settings per month. Mirrors D1 migration 0023 (tables + backfill of the current Vietnam month).
  `
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
`,

  // 0026: common rent/deposit per house and per-room custom flags. Mirrors D1 migration 0026 (same statements).
  `
-- Room rent and deposit: a house can have a common rent and deposit; a room either follows them (custom = 0)
-- or keeps its own price (custom = 1). Rooms that exist today keep the price they have (custom = 1).
-- Additive only: nothing existing is changed or dropped.

ALTER TABLE houses ADD COLUMN default_room_price INTEGER;   -- NULL = no common rent set
ALTER TABLE houses ADD COLUMN default_deposit INTEGER;      -- NULL = no common deposit set

ALTER TABLE rooms ADD COLUMN price_custom INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN deposit_custom INTEGER NOT NULL DEFAULT 1;
`,

  // 0028: lookups by invoice (fee lines, money booked). Mirrors D1 migration 0028 (same statements).
  `
CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id);
`,

  // 0029: people per month on invoices, notice dedupe key, admin bell. Mirrors D1 migration 0029 (same statements).
  `
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
`,
];
