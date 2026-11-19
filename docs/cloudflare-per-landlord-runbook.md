# Vận hành kho dữ liệu riêng của từng chủ trọ

Tài liệu này dành cho người vận hành (Developer). Mỗi chủ trọ có thể chạy trên **D1 dùng chung** (`d1`) hoặc trên **kho riêng** (Durable Object SQLite `owner:<staff.id>`, `do`). Công tắc nằm ở bảng `tenant_storage`; trong lúc chuyển công tắc là `migrating` (đọc từ D1, ghi trả 503 `TENANT_MIGRATING`). Mọi lệnh dưới đây chỉ dành cho Developer.

## Danh sách kiểm tra trước khi triển khai

1. `npm test`, `npx tsc --noEmit`, `npx tsc --noEmit -p test` (trong `cloudflare/`) đều xanh.
2. `npx wrangler deploy --dry-run` chạy được.
3. Đã **diễn tập** (mục dưới) trên bản sao lưu D1 mới nhất và mọi bước đều đạt.
4. Đã sao lưu D1 production ngay trước khi áp migration (`wrangler d1 export`), cất ở nơi riêng tư, ngoài repo.
5. Áp migration (0016 trở đi) lên production rồi mới deploy Worker; mọi chủ trọ vẫn ở `d1` cho đến khi bạn chạy `migrate`.
6. Chọn giờ ít người dùng cho từng lần `migrate`: ghi bị chặn khoảng 15–20 giây.
7. Có sẵn token Developer trong biến môi trường (xem bên dưới); không dán token vào lệnh, không ghi vào log.

## Dùng CLI

Chạy trong thư mục `cloudflare/`. Token Developer chỉ đọc từ biến môi trường `TROHUB_DEV_TOKEN` (không in ra).

```
export TROHUB_DEV_TOKEN=...   # token Developer đăng nhập được từ /api/auth/login
node scripts/migrate-tenant.mts dry-run  <ownerId> --base https://<worker>
node scripts/migrate-tenant.mts migrate  <ownerId> --base https://<worker>
node scripts/migrate-tenant.mts rollback <ownerId> --base https://<worker>
```

- **dry-run**: chép dữ liệu sang kho thử `dryrun:owner:<id>`, đối chiếu số dòng, SHA-256 từng bảng, tổng tiền hoá đơn theo tháng, rồi xoá kho thử. Không đổi công tắc, không chặn ghi. Chạy bao nhiêu lần cũng được; từ chối nếu chủ trọ đã ở kho riêng.
- **migrate**: khoá ghi, đợi 15 giây cho các yêu cầu đang chạy xong, xoá kho cũ (nếu có), chép, đối chiếu, bật công tắc sang `do`, phát lại tiền SePay đã hoãn. Dữ liệu D1 cũ **không bị xoá**.
- **rollback**: chép từ kho riêng về D1 trong một lô nguyên tử, đối chiếu, bật công tắc về `d1`.
- Với `migrate` và `rollback`, CLI chụp các API đọc (nhà, phòng, hoá đơn tháng này, cổng thanh toán của từng nhà) trước và sau rồi so sánh. Mã thoát 1 nếu `ok=false` hoặc JSON khác nhau; khi đó CLI in lệnh quay lại.

Gọi trực tiếp API (cùng token Developer, phương thức POST, không cần body):

| Việc | Đường dẫn |
|---|---|
| Xem công tắc, khoá, số liệu kho của mọi chủ trọ | `GET /api/dev/storage` |
| Chạy thử / chuyển / quay lại | `POST /api/dev/storage/:ownerId/dry-run` · `/migrate` · `/rollback` |
| `clear-store`: xoá kho riêng còn sót của chủ trọ đang ở `d1` (sau một lần chạy hỏng) | `POST /api/dev/storage/:ownerId/clear-store` |
| `unlock`: mở khoá ghi bị kẹt (ở `migrating`), chỉ khi chắc không có lần chạy nào còn sống; tự đưa công tắc về nơi dữ liệu thật và phát lại tiền hoãn | `POST /api/dev/storage/:ownerId/unlock` |

Khoá tự hết hạn sau 10 phút nên thường không cần `unlock` thủ công.

## Mã lỗi

| Mã | HTTP | Ý nghĩa và cách xử lý |
|---|---|---|
| `LANDLORD_NOT_FOUND` | 404 | Không có chủ trọ với id này. Xem `GET /api/dev/storage`. |
| `MIGRATION_RUNNING` | 409 | Một lần chuyển/quay lại khác đang giữ khoá. Đợi; quá 10 phút mà không thấy kết thúc thì `unlock`. |
| `ALREADY_MIGRATED` | 409 | Chủ trọ đã ở kho riêng (kể cả `dry-run`: D1 cũ không còn được cập nhật). Muốn chạy lại thì `rollback` trước. |
| `NOT_MIGRATED` | 409 | `rollback` cho chủ trọ đang ở D1: không có gì để quay lại. |
| `STORE_IN_USE` | 409 | `clear-store` khi chủ trọ đang dùng hoặc đang chuyển sang kho riêng. Chỉ xoá kho khi công tắc ở `d1`. |
| `SHARED_BANK_ACCOUNT` | 409 | Có khoản tiền chưa gắn nhà cùng tài khoản ngân hàng với nhà của chủ trọ khác; không phân biệt được thuộc ai. Sửa dữ liệu (gắn nhà hoặc đổi tài khoản) rồi chạy lại. |
| `VERIFY_FAILED` | 500 | Dữ liệu chép sang (hoặc về) không khớp D1. Kho/đích đã được dọn, công tắc quay về nơi dữ liệu thật. Đọc bảng đối chiếu trong báo cáo để biết bảng nào lệch. |
| `LOCK_LOST` | 500 | Khoá hết hạn hoặc bị `unlock` giữa chừng nên không bật công tắc. Chủ trọ vẫn dùng nơi cũ; chạy lại. |
| `MIGRATION_FAILED` | 500 | Lỗi khác; thông điệp nằm trong `error`. Công tắc đã quay về; kiểm tra `GET /api/dev/storage` rồi chạy lại sau khi sửa nguyên nhân. |

Cảnh báo trong `warnings` của báo cáo: các bước sau khi bật công tắc bị lỗi nhưng không huỷ công tắc (cron 10 phút sẽ làm tiếp, ví dụ phát lại tiền hoãn). `unmatchedPayments` > 0: có khoản tiền chưa gắn nhà mà không tài khoản chủ trọ nào khớp; chúng ở lại D1, thông tin để biết.

## Giới hạn cần biết

- **Quay lại (rollback) rồi vẫn còn kho riêng**: sau `rollback`, kho riêng không bị xoá và các lượt đọc cũ còn nằm trên kho đó ở chế độ chỉ đọc cho đến khi `migrate` lần sau xoá nó (hoặc `clear-store`).
- **`migrate` tự xoá kho còn sót**: nếu ai đó đã tự đổi công tắc về `d1` bằng tay trong khi kho đang giữ dữ liệu mới hơn D1, `migrate` kế tiếp sẽ xoá kho đó và chép lại từ D1; phần dữ liệu mới chỉ có trong kho **mất**, chỉ khôi phục được bằng point-in-time recovery của D1/DO. Không đổi công tắc bằng tay; dùng `rollback`.
- **Đợi 15 giây (drain)**: mỗi `migrate`/`rollback` ngủ 15 giây sau khi khoá ghi để các yêu cầu ghi đang bay kịp xong; ghi mới bị trả 503 trong suốt thời gian khoá (khoảng 15–20 giây). Đọc không bao giờ bị chặn.
- **Dải id theo chủ trọ**: id mới trong kho của chủ trọ `N` bắt đầu từ `N × 10^9 + k × 10^12` (k tăng thêm 1 mỗi lần chuyển lại), luôn trên id lớn nhất hiện có trong D1, nên không đụng id D1 hay của chủ trọ khác. Id cũ được giữ nguyên.
- **Khoản tiền chưa gắn nhà** chỉ được chép cho chủ trọ có nhà dùng đúng tài khoản ngân hàng đó; tài khoản trùng giữa hai chủ trọ thì bị từ chối (`SHARED_BANK_ACCOUNT`).
- D1 cũ không bị xoá sau khi chuyển; dọn dẹp là việc của một kế hoạch sau.

## Diễn tập

Diễn tập chạy toàn bộ quy trình trên bản sao D1, hoàn toàn trên máy (miniflare, thư mục dữ liệu tạm ngoài repo), không đụng production.

Chuẩn bị: `wrangler d1 export tro-hub --remote --output <file.sql>` (một lần, ở nơi riêng tư, **không** đặt trong repo, không commit; file chứa dữ liệu cá nhân thật). Rồi, trong `cloudflare/`:

```
scripts/rehearse-migration.sh <file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId ...]   # mặc định: 4 rồi 1
```

Script: nạp bản sao lưu vào D1 local (đưa bảng `staff` lên đầu vì bản export liệt kê nó sau các bảng tham chiếu tới nó), áp các migration còn thiếu (0016 trở đi), chạy `wrangler dev --local` trên cổng trống, đặt mật khẩu ngẫu nhiên chỉ-local cho tài khoản Developer trong bản sao rồi đăng nhập lấy token (xuất vào `TROHUB_DEV_TOKEN` của riêng script, không in), rồi chạy lần lượt `dry-run` các chủ trọ, `migrate` các chủ trọ, `rollback` chủ trọ đầu và `migrate` lại. Mỗi bước ghi báo cáo (chỉ số đếm và cờ) vào thư mục kết quả; cuối cùng tắt wrangler dev và xoá dữ liệu tạm. Mã thoát khác 0 nếu bất kỳ bước nào `ok=false` hoặc API đọc khác nhau.

Hình dạng kết quả mong đợi mỗi bước: dòng `<lệnh> chủ trọ #N: KHỚP`, bảng 9 dòng (D1 = kho, SHA khớp, `OK`), bảng theo tháng (tổng và số hoá đơn đã đóng khớp), `Tiền về bị hoãn đã ghi`, `Thời gian khoá ghi` (migrate/rollback), và `Các API đọc giống hệt nhau trước và sau.`

### Kết quả lần diễn tập 19/11/2026 (bản sao lưu ngày 18/11, trước migration 0016)

- Bản sao lưu đã áp tới 0015 (15 migration); sau khi áp thêm là 21 (0001–0021).
- D1: houses 3, house_rates 3, rooms 63, residents 69, invoices 352, meter_readings 352, payments 13, payment_gates 0, notifications 0.
- Chủ trọ #4: houses 1, rooms 19, còn lại 0. Chủ trọ #1: houses 2, rooms 44, residents 69, invoices 352, meter_readings 352, payments 13 (8 tháng, 04/2026 đến 11/2026, tổng và số đã đóng khớp từng tháng).
- Cả 6 bước (dry-run 4, dry-run 1, migrate 4, migrate 1, rollback 4, migrate 4 lần nữa) đều `ok=true`, SHA từng bảng khớp, API đọc trước/sau giống hệt; không có cảnh báo.
- 13 khoản tiền chưa gắn nhà **có trong bản sao lưu** và cả 13 thuộc kho của chủ trọ #1 (nhà dùng tài khoản đuôi 1800); chủ trọ #4 nhận 0; không có khoản nào không khớp.
- Thời gian: `dry-run` dưới 1 giây; mỗi `migrate`/`rollback` khoảng 15 đến 16 giây, trong đó khoá ghi 15,05 đến 15,22 giây (gần như toàn bộ là 15 giây drain; việc chép dữ liệu chỉ mất vài trăm mili giây trên dữ liệu cỡ này). Cả buổi diễn tập khoảng 1 phút 54 giây kể cả nạp dữ liệu và khởi động.
- Lưu ý khi chạy lại local: `wrangler d1 execute --file` không nạp được trực tiếp bản export vì thứ tự bảng; script đã xử lý.
