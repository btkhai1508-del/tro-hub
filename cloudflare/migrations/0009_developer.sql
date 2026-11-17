-- Developer: người bán dịch vụ Trọ Hub. Tạo chủ trọ (Admin Tổng) và căn trọ cho từng chủ trọ.
-- CHECK của staff.role vẫn còn 'developer' từ 0005, nên không cần dựng lại bảng staff.

-- Email để sau này gửi OTP khi đăng nhập. otp_required = 0: chưa bật trong lúc thử nghiệm.
ALTER TABLE staff ADD COLUMN email TEXT;
ALTER TABLE staff ADD COLUMN otp_required INTEGER NOT NULL DEFAULT 0;

-- Cấu trúc căn trọ: số tầng và tiện ích chung (JSON danh sách tên), tầng của từng phòng.
ALTER TABLE houses ADD COLUMN floors INTEGER;
ALTER TABLE houses ADD COLUMN amenities TEXT;
ALTER TABLE houses ADD COLUMN owner_id INTEGER REFERENCES staff(id);
ALTER TABLE rooms ADD COLUMN floor INTEGER;

-- Chủ trọ của các nhà hiện có: Admin Tổng đầu tiên đang giữ nhà đó.
UPDATE houses SET owner_id = (
  SELECT MIN(s.id) FROM staff s JOIN staff_houses sh ON sh.staff_id = s.id
   WHERE sh.house_id = houses.id AND s.role = 'owner'
);

-- Tài khoản Developer. Mật khẩu "1" trong lúc thử nghiệm.
INSERT INTO staff (full_name, phone, password_hash, role, email, otp_required)
VALUES ('Developer', '0918338863', 'pbkdf2$100000$eMWX+brlAGVGoXUq+P8/Kw==$+pS/9SpmCknvHpXcpBTyiFchirM7fwvtOsNiahSvExA=',
        'developer', 'btkhai1508@gmail.com', 0)
ON CONFLICT (phone) DO UPDATE SET role = 'developer', email = excluded.email;
