-- Mã thanh toán tiền trọ dạng số: XXXPPPMMYYYY
--   XXX    số căn (001–999), cấp tự động, không đổi, không dùng lại sau khi căn bị xoá
--   PPP    số phòng trong căn (001–999), không đổi khi đổi tên phòng
--   MMYYYY tháng, năm
-- Ví dụ căn 001, phòng 101, tháng 11/2026: 001101112026.
-- Số được Worker cấp (assignPayNumbers) cho căn/phòng còn trống, kể cả căn có từ trước.
ALTER TABLE houses ADD COLUMN pay_no INTEGER;
ALTER TABLE rooms ADD COLUMN pay_no INTEGER;
CREATE UNIQUE INDEX houses_pay_no ON houses(pay_no);
CREATE UNIQUE INDEX rooms_pay_no ON rooms(house_id, pay_no);
