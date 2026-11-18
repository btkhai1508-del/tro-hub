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

## Ngắt Google Sheet: chuyển theo nhóm dữ liệu

Toàn bộ hai file Sheet đã được sao lưu, mã hoá, trong bảng `sheet_archive` (xem `cloudflare/scripts/restore-archive.mts`).
Mỗi nhóm chuyển **cả phía admin lẫn cư dân cùng lúc**, để hai bên không thấy dữ liệu khác nhau. Worker giữ đúng đường dẫn và dạng dữ liệu của Express; `src/lib/api.ts` (`WORKER_ROUTES`) chuyển từng đường dẫn sang Worker. Trước khi chuyển một nhóm, nhập lại phần dữ liệu đó từ Sheet để có số mới nhất.

| # | Nhóm | API Express | Trạng thái |
|---|---|---|---|
| 1 | Thông báo | `/api/notifications`, `/api/admin/notifications` | ✅ trên D1 |
| 2 | Tiền phòng, thanh toán | `/api/payment/*`, `/api/admin/billing`, `/api/admin/payment-status`, `/api/admin/payment-gate`, `/api/admin/dashboard`, `/api/admin/months`, webhook SePay, `/api/payment/zalo-order` | ✅ code xong trên nhánh, chưa đưa lên (xem dưới) |
| 3 | Cư dân, phòng | `/api/sheets/tenant-data`, `/api/admin/rooms`, `/api/admin/room-detail`, `/api/admin/accounts*`, `/api/auth/register`, `/api/profile/update`, đăng nhập Express | |
| 4 | Điện nước, đơn giá | `/api/admin/room-detail` (ghi), `/api/admin/config` | |
| 5 | Giấy tờ | `/api/admin/contract/history`, `/api/admin/declaration` (tạo khi mở, không lưu) | |
| 6 | Giặt sấy | `/api/laundry/*` | |
| 7 | Đăng nhập Zalo | `/api/auth/zalo` (Worker cấp token) | |
| 8 | Ngắt | bỏ Apps Script, `googleSheetsService`, `googleSheetSyncService`, đọc sheet công khai, server Express | |

Phiên đăng nhập bằng Zalo chưa có token Worker nên vẫn đi qua Express cho tới nhóm 7.

### Nhóm 2: cách chạy

- **Trạng thái thanh toán và cổng thanh toán nằm trên D1.** Số tiền, chỉ số điện nước vẫn do chủ trọ nhập trên tab tháng của Sheet cũ (tới nhóm 4): Worker đọc lại bằng bản xuất CSV công khai mỗi 10 phút (cron), và ngay khi trang Thu tiền / Tổng quan mở một tháng chưa đọc trong 60 giây (`cloudflare/src/sheetSync.ts`). Đọc Sheet không bao giờ đổi trạng thái.
- Khi trạng thái đổi trên D1, Worker tô lại ô cột P (Apps Script `update_payment`) và lưu cổng sang Apps Script (`set_payment_gate`), để phần còn trên Express (đăng nhập Zalo, danh sách phòng) thấy giống nhau. Chủ trọ không tô màu cột P bằng tay nữa.
- Cư dân bấm "đã chuyển khoản" → **Chờ xác nhận** (trước đây là Đã đóng ngay). Đã đóng chỉ khi SePay báo tiền về đủ số tiền hoá đơn (mã `XXXPPPMMYYYY` hoặc mã cũ), hoặc quản lý bật.
- Webhook SePay trên Worker ghi tiền vào bảng `payments`, và chuyển giao dịch giặt sấy (MG/MS) sang Express.
- `/api/payment/zalo-order` không đụng dữ liệu, vẫn ở Express.

### Webhook tự tạo (kết nối SePay không cần OAuth)

Trong lúc chờ SePay duyệt ứng dụng OAuth: Developer bấm "Kết nối SePay" → tab **Webhook tự tạo** → **Tạo URL và key**. Chủ trọ thêm webhook trên my.sepay.vn của họ (Tiền vào, API Key, bật "Dùng để xác thực thanh toán"). Worker nhận ra chủ trọ qua key (bảng `sepay_manual_webhooks`, migration 0017, chỉ lưu SHA-256). Tạo key mới thì key cũ ngừng ngay. Dòng trạng thái chuyển "Đang hoạt động" khi webhook đầu tiên về. Chạy chung với OAuth: cùng một URL webhook.

### Cổng thanh toán SePay (phí dịch vụ, tuỳ chọn)

Chủ trọ trả hoá đơn phí Trọ Hub bằng thẻ / chuyển khoản / NAPAS VietQR trên trang của SePay; tiền vào tài khoản merchant của Developer. Tiền trọ không đi qua đây.

- Link mỗi hoá đơn: `/pay/service/<mã hoá đơn>` (nút **Link thẻ** trên trang Developer). Worker ký form theo tài liệu SePay rồi chuyển sang `pay(-sandbox).sepay.vn/v1/checkout/init`. Mỗi lần mở là một đơn mới `<mã>_<hậu tố>` vì SePay cần mã đơn không trùng.
- IPN: `/api/sepay/pg/ipn`, xác thực header `X-Secret-Key`. Chỉ `ORDER_PAID` + `CAPTURED` + `APPROVED` mới ghi tiền, qua cùng hàm đối chiếu với chuyển khoản (`service_payments`, id `PG-…` chống ghi trùng).
- Cài đặt (secret): `SEPAY_PG_MERCHANT_ID`, `SEPAY_PG_SECRET_KEY` (Cổng thanh toán → Cấu hình → Thông tin đơn vị), `SEPAY_PG_IPN_SECRET` (tự đặt ở tab IPN, Auth Type SECRET_KEY). `SEPAY_PG_ENV=production` mới là tiền thật; mặc định sandbox.

Khi đưa lên (theo thứ tự): deploy Worker + migration 0016, 0017 → đưa giao diện lên Render → chạy `cloudflare/scripts/import-statuses.mts` cho tháng này và tháng trước trên D1 thật → đổi URL webhook SePay sang `https://tro-hub-api.trohub.workers.dev/api/sepay/webhook`.

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
