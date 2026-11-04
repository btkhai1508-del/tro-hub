# Nhiều nhà trọ trên Cloudflare

Thiết kế cho giai đoạn mở rộng từ 2 lên 4–5 nhà trọ trở lên, dùng chung một frontend.

## Nguyên tắc

- **Cloudflare D1 là database chính** cho mọi dữ liệu: nhà trọ, phòng, cư dân, hoá đơn, điện nước, thanh toán, thông báo.
- **Google Sheet chỉ là bản dự phòng**, đồng bộ **một chiều** từ D1 sang Sheet. Không đọc ngược từ Sheet về app. Sửa tay trong Sheet sẽ không được ghi vào app, và lần đồng bộ sau sẽ ghi đè lên.
- Mỗi nhà trọ được gắn một link Google Sheet riêng (không bắt buộc).
- Ảnh CCCD và PDF hợp đồng lưu trong **R2 private**. Frontend chỉ nhận link xem có hạn từ Worker.
- Frontend không bao giờ biết ID sheet hay đường dẫn trong R2. Mọi request đều đi qua Worker, và Worker kiểm tra quyền **ở mỗi request**.

## Kiến trúc

```
Frontend chung (Cloudflare Pages)
        │
        ▼
Worker: xác thực + phân quyền + audit_log
        ├──► D1  (database chính)
        ├──► R2  (ảnh CCCD, PDF — private)
        └──► Queue / Cron ──► Google Sheet của từng nhà (bản dự phòng, một chiều)

Cron hàng tuần ──► bản sao lưu mã hoá ──► PC (FileVault) + ổ cứng rời
D1 Time Travel: khôi phục về bất kỳ thời điểm nào trong 30 ngày
```

## Dữ liệu trên D1

| Bảng | Cột chính |
|---|---|
| `houses` | id, tên, địa chỉ (số nhà + đường, phường/tỉnh mới), chủ trọ, `sheet_id` (có thể trống), trạng thái |
| `rooms` | id, `house_id`, tên phòng (không trùng trong cùng nhà), giá, sức chứa (tối đa 3) |
| `residents` | id, `house_id`, `room_id`, họ tên, SĐT, mật khẩu (băm), CCCD mã hoá + 4 số cuối, ngày vào/ra, `status` (pending / approved / rejected / moved_out) |
| `invoices` | id, `house_id`, `room_id`, tháng, các khoản, tổng, trạng thái đã đóng / chưa đóng |
| `meter_readings` | id, `room_id`, tháng, chỉ số điện, chỉ số nước |
| `payments` | id, `invoice_id`, số tiền, phương thức, thời gian, mã giao dịch |
| `notifications` | id, `house_id`, phòng (hoặc tất cả), loại, nội dung |
| `invites` | `code` ngẫu nhiên, `house_id`, hết hạn, số lần dùng, đã thu hồi |
| `staff` | id, họ tên, SĐT, mật khẩu (băm), `role` (owner / manager), trạng thái |
| `staff_houses` | `staff_id`, `house_id` (chỉ dùng cho Admin căn) |
| `audit_log` | ai, việc gì, nhà nào, đối tượng, thời gian |

Thay vì xoá hẳn, dữ liệu được đánh dấu bằng `deleted_at`, và mỗi lần xoá đều ghi vào `audit_log`.

## Đăng ký cư dân mới

```
Nhà trọ X ──(link mã mời ngẫu nhiên)──► User ──► Frontend
   Frontend hỏi Worker: mã này của nhà nào? → hiện "Đăng ký – Nhà trọ X"
   Gửi form + mã mời ──► Worker tra lại mã → house_id = X
                         kiểm tra trùng SĐT/CCCD → mã hoá CCCD
                         ──► D1 residents: status = pending
   Admin của nhà X duyệt + gán phòng → approved
```

- `house_id` luôn lấy từ mã mời, không bao giờ lấy từ form gửi lên.
- Link mời thu hồi được và có hạn dùng.
- Mỗi SĐT hoặc CCCD chỉ có một hồ sơ. Cư dân chuyển nhà thì đổi `house_id`, không tạo hồ sơ mới.
- Giới hạn số lần đăng ký theo link và theo IP.

## Đăng nhập và điều hướng

```
Đăng nhập ──► Worker tra residents (hoặc staff)
   pending  → màn hình chờ duyệt (liên hệ Zalo)
   approved → token { id, role, house_id, room_id }
Mỗi request ──► Worker lấy house_id TỪ TOKEN ──► D1 lọc theo nhà và phòng
```

## Phân quyền quản lý

- **Admin Tổng** (`owner`): vào được mọi nhà. Có ô chọn nhà trọ, trong đó có thêm mục **"Tất cả"** để xem trang tổng hợp.
- **Admin căn** (`manager`): chỉ vào được các nhà gắn với mình trong `staff_houses`, không có ô chọn nhà.

| Việc | Admin Tổng | Admin căn |
|---|---|---|
| Xem trang tổng hợp mọi nhà | ✅ | ❌ |
| Tạo / khoá Admin căn, giao nhà | ✅ | ❌ |
| Tạo nhà trọ mới | ✅ | ❌ |
| Sửa thông tin nhà, gắn link Google Sheet | ✅ | ✅ nhà mình |
| Tạo / thu hồi link đăng ký | ✅ | ✅ nhà mình |
| Duyệt cư dân, gán phòng | ✅ | ✅ nhà mình |
| Ghi điện nước, đánh dấu đã đóng tiền | ✅ | ✅ nhà mình |
| Gửi thông báo | ✅ | ✅ nhà mình |
| Xem CCCD đầy đủ và ảnh CCCD (có ghi nhật ký) | ✅ | ✅ nhà mình |
| Đổi giá phòng, giá điện nước | ✅ | ✅ nhà mình |
| Xoá cư dân / hoá đơn (xoá mềm) | ✅ | ✅ nhà mình |
| Xem nhật ký truy cập | ✅ | ✅ nhà mình |

Mọi API đều qua cùng một bước kiểm tra: `owner` được qua; `manager` chỉ được qua khi có `house_id` đó trong `staff_houses`; còn lại trả 403 và ghi vào `audit_log`.

## Google Sheet dự phòng

- Mỗi nhà một file, tạo theo cùng một mẫu: tab `Phòng`, `Cư dân`, và mỗi tháng một tab `MM/YYYY` gồm hoá đơn và điện nước.
- Chỉ chia sẻ cho service account và chủ trọ. Không bật chế độ "bất kỳ ai có liên kết".
- Sheet **không chứa CCCD đầy đủ**, chỉ có 4 số cuối. Bản đầy đủ chỉ nằm trong D1 (đã mã hoá) và trong bản sao lưu mã hoá trên PC.
- Đồng bộ: mỗi lần ghi vào D1 thì đẩy một việc vào Queue để cập nhật đúng dòng trên Sheet. Ngoài ra Cron chạy mỗi đêm ghi lại toàn bộ để bù những lần lỗi.
- Nhà chưa gắn link Sheet thì bỏ qua bước đồng bộ.

## Lộ trình

1. Tạo D1 + Worker với các bảng `houses`, `rooms`, `residents`, `staff`, `staff_houses`. Nhập dữ liệu cư dân từ tab THÔNG TIN CÁ NHÂN. Đăng nhập chạy qua Worker.
2. Đăng ký bằng link mời và luồng duyệt.
3. Chuyển hoá đơn, điện nước, thanh toán sang D1. Nhập dữ liệu cũ từ các tab tháng của 2 sheet hiện có.
4. Phân quyền hai cấp, ô chọn nhà, trang tổng hợp.
5. Đồng bộ một chiều D1 → Sheet, sao lưu hàng tuần.
6. Bỏ Apps Script, bỏ việc đọc sheet công khai, đổi mới `JWT_SECRET` và `ZALO_APP_SECRET`, chuyển secret sang `wrangler secret`.
