-- Ba tầng tài khoản quản lý:
--   developer: tạo nhà trọ, tạo Admin Tổng và giao nhà cho họ; thấy mọi nhà.
--   owner (Admin Tổng): quản lý các nhà được giao trong staff_houses, tạo Admin căn cho các nhà đó.
--   manager (Admin căn): chỉ nhà được giao.
-- SQLite không sửa được CHECK, nên tạo lại bảng staff. staff_houses tham chiếu tới staff,
-- nên dữ liệu của nó được chép ra bảng tạm (không khoá ngoại) và dựng lại sau cùng.

CREATE TABLE staff_houses_copy AS SELECT staff_id, house_id FROM staff_houses;
DROP TABLE staff_houses;

CREATE TABLE staff_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('developer', 'owner', 'manager')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO staff_new (id, full_name, phone, password_hash, role, status, created_at)
  SELECT id, full_name, phone, password_hash, role, status, created_at FROM staff;
DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;

CREATE TABLE staff_houses (
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  house_id TEXT NOT NULL REFERENCES houses(id),
  PRIMARY KEY (staff_id, house_id)
);
INSERT INTO staff_houses (staff_id, house_id) SELECT staff_id, house_id FROM staff_houses_copy;
DROP TABLE staff_houses_copy;

-- Bùi Trung Khải là Developer.
UPDATE staff SET role = 'developer' WHERE phone = '0902371800';

-- Cổng thanh toán: mã BIN của ngân hàng theo VietQR, để tạo mã QR.
ALTER TABLE houses ADD COLUMN bank_bin TEXT;
UPDATE houses SET bank_bin = '970422' WHERE bank_code = 'mbbank';
