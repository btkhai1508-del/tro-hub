-- Bộ tiện ích mới: Điện nước, Tạo thông báo, Hợp đồng & CT01, Kỳ kê khai thành bắt buộc (luôn bật, luôn tính phí).
-- Giặt Sấy 24/7 ngừng bán: enabled = 0 thì không hiện trong bảng giá, không tính phí, menu admin ẩn đi.
ALTER TABLE service_modules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
UPDATE service_modules SET core = 1 WHERE key IN ('meter', 'createNotification', 'contract', 'declaration');
UPDATE service_modules SET enabled = 0, core = 0 WHERE key = 'laundry';
