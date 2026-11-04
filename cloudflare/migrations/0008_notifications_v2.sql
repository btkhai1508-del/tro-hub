-- Thông báo cho cư dân, chỉ lưu trên D1 (không còn tab Notifications trên Google Sheet).
-- Bảng cũ chưa từng có dữ liệu nên tạo lại cho đủ cột.
--   room_names: JSON danh sách tên phòng của nhà đó; NULL = gửi cả nhà.
--   scheduled_at: hẹn giờ (ISO); cư dân chỉ thấy khi đã tới giờ.
DROP TABLE notifications;
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
CREATE INDEX notifications_house ON notifications(house_id, created_at);
