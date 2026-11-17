-- Tiện ích = các chức năng trong mục Tiện ích của trang admin, là thứ Developer bán cho chủ trọ.
-- Mỗi tiện ích có giá theo phòng mỗi tháng. Phí của một căn = số phòng × tổng giá các tiện ích căn đó dùng.
-- core = 1: luôn bật, không tắt được.
CREATE TABLE service_modules (
  key TEXT PRIMARY KEY,               -- trùng với key menu trong AdminPortal
  label TEXT NOT NULL,
  price_per_room INTEGER NOT NULL DEFAULT 0,
  core INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO service_modules (key, label, core, sort) VALUES
  ('accountManagement', 'Quản lý tài khoản', 1, 1),
  ('invoices', 'Hoá đơn phòng', 1, 2),
  ('config', 'Cài đặt phí', 1, 3),
  ('paymentPortal', 'Thông tin thanh toán', 1, 4),
  ('meter', 'Điện nước', 0, 5),
  ('createNotification', 'Tạo thông báo', 0, 6),
  ('contract', 'Hợp đồng & CT01', 0, 7),
  ('declaration', 'Kỳ kê khai', 0, 8),
  ('laundry', 'Giặt Sấy 24/7', 0, 9);

-- Tiện ích căn đang dùng (JSON danh sách key). NULL: căn có từ trước, dùng tất cả.
ALTER TABLE houses ADD COLUMN modules TEXT;

-- Cột amenities (bếp, WC riêng…) ở 0009 hiểu sai ý, bỏ đi.
ALTER TABLE houses DROP COLUMN amenities;
