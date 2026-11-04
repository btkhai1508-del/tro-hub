-- Bỏ tầng Developer: chỉ còn Admin Tổng (owner) và Admin căn (manager).
-- Mỗi Admin Tổng là một chủ trọ độc lập, chỉ thấy các nhà của mình trong staff_houses.
-- Tài khoản Developer cũ (Bùi Trung Khải) thành Admin Tổng của mọi nhà hiện có.
-- CHECK của staff.role vẫn còn chữ 'developer' nhưng app không tạo vai trò này nữa.

INSERT OR IGNORE INTO staff_houses (staff_id, house_id)
  SELECT s.id, h.id FROM staff s CROSS JOIN houses h WHERE s.role = 'developer';
UPDATE staff SET role = 'owner' WHERE role = 'developer';
