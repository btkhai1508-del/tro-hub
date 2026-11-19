// Schema of a per-landlord Durable Object store: the 9 business tables copied from D1 (final shape
// after migrations 0001-0018) plus a `meta` key/value table. The only change: `houses.owner_id` has
// no REFERENCES staff(id) because staff lives in the central D1 only.

export type SqlValue = string | number | null;

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
  { name: 'meter_readings', pk: ['id'] },
  { name: 'payments', pk: ['id'] },
  { name: 'payment_gates', pk: ['house_id', 'month'] },
  { name: 'notifications', pk: ['id'] },
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
];
