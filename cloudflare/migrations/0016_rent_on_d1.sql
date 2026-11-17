-- Nhóm 2: tiền phòng và trạng thái thanh toán nằm trên D1.
-- Số tiền mỗi tháng vẫn do chủ trọ nhập trên Google Sheet (tới khi điện nước chuyển sang D1 ở nhóm 4):
-- Worker đọc lại tab tháng và cập nhật số tiền, không bao giờ đổi trạng thái đã thanh toán.

-- Dòng của phòng trong tab tháng, để tô lại ô cột P đúng chỗ.
ALTER TABLE invoices ADD COLUMN sheet_row INTEGER;
-- Lần cuối số tiền được đọc từ Sheet, và người đổi trạng thái gần nhất ('staff:3', 'resident:12', 'sepay').
ALTER TABLE invoices ADD COLUMN synced_at TEXT;
ALTER TABLE invoices ADD COLUMN status_by TEXT;

-- Cổng thanh toán theo từng nhà, từng tháng. Tháng chưa có dòng: dùng giá trị mới nhất của nhà.
CREATE TABLE payment_gates (
  house_id TEXT NOT NULL REFERENCES houses(id),
  month TEXT NOT NULL,               -- 'YYYY-MM'
  value TEXT NOT NULL CHECK (value IN ('START', 'STOP')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (house_id, month)
);

-- Google Sheet cũ chứa tab tháng của TRUNG_KIM và LVC (phòng LVC ghi 'LVC-101').
-- Nhà nào có trong danh sách thì Worker đọc số tiền từ file này.
INSERT OR IGNORE INTO settings (key, value) VALUES ('legacy_sheet_id', '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A');
INSERT OR IGNORE INTO settings (key, value) VALUES ('legacy_sheet_houses', 'TRUNG_KIM,LVC');
