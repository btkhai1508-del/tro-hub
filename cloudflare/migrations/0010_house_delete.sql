-- Xoá căn trọ có hẹn giờ: Developer bấm xoá thì căn chờ 7 ngày (delete_after) để tải bản sao lưu
-- hoặc khôi phục. Hết hạn, Worker (cron hằng ngày) xoá hẳn mọi dữ liệu của căn.
ALTER TABLE houses ADD COLUMN delete_after TEXT;
