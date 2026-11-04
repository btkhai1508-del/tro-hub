-- Vùng 2: dữ liệu riêng của từng nhà. Mỗi dòng đều có house_id; không lưu tên hay CCCD ở đây.
-- Tháng lưu dạng 'YYYY-MM' để sắp xếp đúng.

-- Tài khoản nhận tiền của nhà. Chỉ Admin Tổng được sửa (Worker kiểm tra).
ALTER TABLE houses ADD COLUMN bank_name TEXT;           -- tên hiển thị, ví dụ 'MB Bank'
ALTER TABLE houses ADD COLUMN bank_code TEXT;           -- mã VietQR, ví dụ 'mbbank'
ALTER TABLE houses ADD COLUMN bank_account_no TEXT;
ALTER TABLE houses ADD COLUMN bank_account_name TEXT;

ALTER TABLE rooms ADD COLUMN deposit INTEGER NOT NULL DEFAULT 0;

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, month)
);
CREATE INDEX invoices_house_month ON invoices(house_id, month);

-- Log thu tiền. house_id trống: giao dịch ngân hàng chưa biết của nhà nào (chỉ Admin Tổng thấy).
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
CREATE INDEX payments_house ON payments(house_id, paid_at);

-- Thông báo chỉ lưu ở đây, không ghi ra Google Sheet. room_id trống: gửi cả nhà.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id TEXT NOT NULL REFERENCES houses(id),
  room_id INTEGER REFERENCES rooms(id),
  type TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX notifications_house ON notifications(house_id, created_at);
