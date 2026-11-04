-- Bước 1: nhà trọ, phòng, cư dân, người quản lý và nhật ký truy cập.

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
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  name TEXT NOT NULL,                 -- không trùng trong cùng một nhà
  price INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 3,
  deleted_at TEXT,
  UNIQUE (house_id, name)
);

CREATE TABLE residents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_id INTEGER REFERENCES rooms(id),  -- trống khi đang chờ duyệt
  full_name TEXT NOT NULL,
  gender TEXT,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  cccd_enc TEXT,                      -- CCCD mã hoá AES-GCM
  cccd_last4 TEXT,
  cccd_hash TEXT UNIQUE,              -- để kiểm tra trùng mà không cần giải mã
  email TEXT,
  dob TEXT,
  address_detail TEXT,
  ward TEXT,
  province TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'moved_out')),
  move_in_date TEXT,
  move_out_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX residents_house ON residents(house_id, status);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chỉ dùng cho Admin căn: người quản lý được giao nhà nào.
CREATE TABLE staff_houses (
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  house_id TEXT NOT NULL REFERENCES houses(id),
  PRIMARY KEY (staff_id, house_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                -- 'staff:3', 'resident:12', 'anonymous'
  action TEXT NOT NULL,
  house_id TEXT,
  target TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_log_house ON audit_log(house_id, created_at);
