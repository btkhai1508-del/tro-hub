-- Đổi hoặc đặt lại mật khẩu thì đăng xuất mọi phiên cũ: Worker từ chối token cấp trước thời điểm này
-- (giây, epoch). NULL: chưa đổi lần nào, mọi token còn hạn đều dùng được.
ALTER TABLE staff ADD COLUMN password_changed_at INTEGER;
ALTER TABLE residents ADD COLUMN password_changed_at INTEGER;
