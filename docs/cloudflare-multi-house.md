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

## Phân quyền quản lý (hai tầng, quyết định 2026-11-04)

- **Admin Tổng** (`owner`): một chủ trọ độc lập. Chỉ thấy các nhà của mình (`staff_houses`), có ô chọn nhà và trang tổng hợp, tạo nhà mới (nhà thuộc về người tạo), tạo và khoá Admin căn, đặt **Thông tin thanh toán** (ngân hàng + STK), kết nối Google của riêng mình.
- **Admin căn** (`manager`): chỉ nhà được giao, không có ô chọn nhà.
- Thêm Admin Tổng mới = thêm một chủ trọ độc lập (thương mại hoá, có bảng giá). Việc này sẽ làm qua **một trang web dịch vụ riêng**, sau này; app hiện tại không tạo Admin Tổng.

| Việc | Admin Tổng | Admin căn |
|---|---|---|
| Tạo nhà trọ | ✅ (nhà của mình) | ❌ |
| Tạo / khoá Admin căn (Quản lý tài khoản → Admin căn) | ✅ nhà mình | ❌ |
| Trang tổng hợp nhiều nhà | ✅ nhà mình | ❌ |
| Thông tin thanh toán (ngân hàng, STK) | ✅ nhà mình | ❌ |
| Kết nối Google (Sheet nằm trong Drive của Admin Tổng) | ✅ | ❌ |
| Giao dịch ngân hàng chưa gắn nhà | ✅ tài khoản của mình | ❌ |
| Mọi việc vận hành khác của nhà | ✅ nhà mình | ✅ nhà mình |

Thông tin thanh toán: chọn ngân hàng trong danh sách VietQR và nhập STK; mã QR cho cư dân do VietQR tạo từ BIN + STK. Nút "Chuyển khoản nhanh" qua Zalo chỉ hiện khi STK của nhà trùng tài khoản đã đăng ký Zalo Checkout (`ZALO_CHECKOUT_ACCOUNT`), vì Zalo chỉ chuyển vào tài khoản đó.

Mọi API đều qua cùng một bước kiểm tra: `owner` được qua; `manager` chỉ được qua khi có `house_id` đó trong `staff_houses`; còn lại trả 403 và ghi vào `audit_log`.

## Hai vùng dữ liệu (quyết định 2026-11-04)

**Vùng 1: Thông tin cá nhân**, dùng chung cho mọi nhà: `residents`, `staff`, `staff_houses`. Chỉ vùng này chứa CCCD.

**Vùng 2: Riêng từng nhà**, mỗi dòng đều có `house_id`:

| Bảng | Nội dung | Ai được sửa |
|---|---|---|
| `houses` | Tên, địa chỉ, **ngân hàng + số tài khoản + chủ tài khoản** nhận tiền | Thông tin nhà: Admin Tổng + Admin căn. **Ngân hàng/STK: chỉ Admin Tổng** |
| `house_rates` | Đơn giá điện/số, nước/khối, rác, internet, xe | Admin Tổng + Admin căn |
| `rooms` | Tên phòng, tiền phòng, tiền cọc, sức chứa | Admin Tổng + Admin căn |
| `meter_readings` | Chỉ số điện, nước cũ/mới theo tháng | Admin Tổng + Admin căn |
| `invoices` | Hoá đơn tháng từng phòng: các khoản, tổng, trạng thái | Admin Tổng + Admin căn |
| `payments` | Log thu tiền (giao dịch ngân hàng, tiền mặt) | Ghi tự động / xác nhận tiền mặt |
| `notifications` | Thông báo cho cư dân. **Chỉ lưu trên D1**, không ghi ra Sheet | Admin Tổng + Admin căn |

Vùng 2 không lưu tên hay CCCD, chỉ lưu `resident_id` khi cần.

**Giấy tờ không lưu**: hợp đồng, CT01, thông báo tiền phòng và sổ doanh thu (kỳ kê khai S1a-HKD) được tạo ngay khi mở, bằng `src/lib/documents` từ dữ liệu trong D1. Không lưu file và không lưu bản sổ (`declarationStore.json` sẽ bỏ).

## Google Sheet dự phòng

Đồng bộ một chiều D1 → Sheet qua service account. Không chia sẻ dạng "bất kỳ ai có liên kết". Không có CCCD đầy đủ.

```
📄 Trọ-Hub – Thông tin cá nhân            (1 file, chỉ Admin Tổng)
   ├─ Cư dân     Họ tên | Nhà trọ | Phòng | SĐT | CCCD ****1234 | Ngày sinh | Địa chỉ | Xe | Biển số | Liên hệ khẩn | Ngày vào | Trạng thái
   └─ Quản lý    Họ tên | SĐT | Vai trò | Nhà được giao | Trạng thái

📄 Trọ-Hub – <tên nhà>                    (1 file / nhà, tạo tự động khi tạo nhà)
   ├─ MM/YYYY    tự tạo khi sang tháng mới (nếu chưa có):
   │             Phòng | Điện cũ | Điện mới | Số điện | Nước cũ | Nước mới | Số nước | Tiền điện | Tiền nước
   │             | Tiền phòng | Rác | Internet | Xe | Khác | Cọc | Tổng | Trạng thái | Người ở (tên)
   └─ Thu tiền   Ngày | Phòng | Tháng | Số tiền | Hình thức | Ngân hàng | Mã giao dịch | Nội dung | Người xác nhận
```

- Mỗi lần ghi vào D1 thì cập nhật đúng dòng trên Sheet. Cron mỗi đêm ghi lại toàn bộ để bù những lần lỗi.
- Nhà chưa có Sheet thì bỏ qua bước đồng bộ.

## Tạo nhà trọ mới (chỉ Admin Tổng)

Chỉ một màn hình, không sửa code:
1. Nhập tên, địa chỉ, chủ trọ, ngân hàng + STK, đơn giá, danh sách phòng (ví dụ "101-110, 201-210").
2. Worker tạo dòng trong `houses`, `house_rates`, `rooms`.
3. Worker tạo file Google Sheet của nhà (tab tháng hiện tại + tab Thu tiền) và lưu `sheet_id`.
4. Có thể giao ngay một Admin căn và tạo link mời đăng ký.

## Lộ trình

Đã xong:
- ✅ D1 + Worker, nhập dữ liệu tab THÔNG TIN CÁ NHÂN, đăng nhập và đổi mật khẩu qua Worker.

Tiếp theo, mỗi bước là một commit:
1. **Bảng vùng 2 trên D1**: ngân hàng/STK trên `houses` (chỉ Admin Tổng sửa), `house_rates`, tiền phòng/cọc trên `rooms`, `meter_readings`, `invoices`, `payments`, `notifications`. Nhập lịch sử các tab tháng 03–11/2026.
2. **Kết nối Google**: service account, Worker tự ký token Google. Bạn tạo service account; mình viết code.
3. **Sheet Thông tin cá nhân**: tạo file, tab Cư dân + Quản lý, đồng bộ khi có thay đổi.
4. **Sheet từng nhà**: tạo file, tự tạo tab tháng hiện tại, tab Thu tiền, đồng bộ hoá đơn và thanh toán.
5. **Tạo nhà trọ mới** trong một màn hình.
6. **Thông báo** chỉ trên D1: bỏ tab Notifications và Apps Script phần thông báo.
7. **Giấy tờ** lấy từ D1, không lưu (bỏ `declarationStore.json`).
8. **Đăng ký bằng link mời**, chuyển trang Admin và cư dân sang Worker, ô chọn nhà + trang tổng hợp.
9. **Dọn dẹp**: bỏ Apps Script, bỏ đọc sheet công khai, đổi mới `JWT_SECRET` và `ZALO_APP_SECRET`, sao lưu hàng tuần.
