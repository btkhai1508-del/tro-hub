-- Cư dân nhập từ tab THÔNG TIN CÁ NHÂN: một số người chưa có SĐT riêng (sheet ghi "1"),
-- nên SĐT được để trống; UNIQUE vẫn chặn trùng với các SĐT có thật.
-- Thêm xe và người liên hệ khẩn cấp. Bảng còn trống nên tạo lại được.

DROP TABLE residents;

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
);
CREATE INDEX residents_house ON residents(house_id, status);
