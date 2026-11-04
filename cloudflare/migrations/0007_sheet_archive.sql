-- Bản sao lưu nguyên vẹn của các file Google Sheet trước khi ngắt kết nối.
-- Mỗi file lưu hai dạng: 'xlsx' (cả file, giữ màu và định dạng để khôi phục được) và
-- 'tab' (giá trị từng tab dạng JSON để đọc lại nhanh). Nội dung có CCCD và mật khẩu cũ
-- nên được mã hoá bằng CCCD_KEY, rồi cắt thành từng đoạn vì D1 giới hạn độ dài câu lệnh.
CREATE TABLE sheet_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('xlsx', 'tab')),
  tab TEXT,
  row_count INTEGER,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                 -- của dữ liệu gốc trước khi mã hoá, để kiểm tra khi khôi phục
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sheet_archive_chunks (
  archive_id INTEGER NOT NULL REFERENCES sheet_archive(id),
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (archive_id, seq)
);
