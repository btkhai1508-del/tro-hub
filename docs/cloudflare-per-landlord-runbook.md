# Vận hành kho dữ liệu riêng của từng chủ trọ

Tài liệu này dành cho người vận hành (Developer). Mỗi chủ trọ có thể chạy trên **D1 dùng chung** (`d1`) hoặc trên **kho riêng** (Durable Object SQLite `owner:<staff.id>`, `do`). Công tắc nằm ở bảng `tenant_storage`; trong lúc chuyển công tắc là `migrating` (đọc từ D1, ghi trả 503 `TENANT_MIGRATING`). Mọi lệnh dưới đây chỉ dành cho Developer.

## Danh sách kiểm tra trước khi triển khai

1. `npm test`, `npx tsc --noEmit`, `npx tsc --noEmit -p test` (trong `cloudflare/`) đều xanh.
2. `npx wrangler deploy --dry-run` chạy được.
3. Đã **diễn tập** (mục dưới) trên bản sao lưu D1 mới nhất và mọi bước đều đạt.
4. Đã sao lưu D1 production ngay trước khi áp migration (`npx wrangler d1 export <DATABASE_NAME> --remote --output <file.sql>`), cất ở nơi riêng tư, ngoài repo.
5. Xem các migration còn thiếu trên production: `npx wrangler d1 migrations list <DATABASE_NAME> --remote` (chỉ liệt kê, không áp).
6. Áp migration (0016 trở đi) lên production rồi **deploy Worker ngay sau đó** (làm liền hai bước, không để cách nhau lâu); mọi chủ trọ vẫn ở `d1` cho đến khi bạn chạy `migrate`. Xem mục "Cửa sổ giữa migration và deploy" bên dưới.
7. Ngay sau khi deploy chạy `dry-run` một chủ trọ trên production (`node scripts/migrate-tenant.mts dry-run <ownerId> --base https://<worker>`): việc này chạy thử Durable Object binding thật mà không đổi công tắc và không chặn ghi.
8. Chọn giờ ít người dùng cho từng lần `migrate`: ghi bị chặn khoảng 15–20 giây.
9. Có sẵn token Developer trong biến môi trường (xem bên dưới); không dán token vào lệnh, không ghi vào log.

### Cửa sổ giữa migration và deploy

Từ lúc áp migration đến lúc Worker mới chạy, Worker **cũ** vẫn phục vụ: nó không ghi `house_directory` và `resident_index` (phần backfill của migration 0019 chỉ chạy một lần), và migration 0020 đặt khoá ngoại `staff_houses.house_id → house_directory`, nên Worker cũ không gán được quản lý cho một căn chưa có trong thư mục (câu `INSERT INTO staff_houses` báo lỗi).

1. Áp migration và deploy liền nhau; báo chủ trọ **không tạo căn hoặc cư dân mới** trong khoảng đó.
2. Ngay sau deploy chạy file bù (idempotent, chỉ thêm dòng còn thiếu, chạy lại nhiều lần cũng được):
   `npx wrangler d1 execute <DATABASE_NAME> --remote --file scripts/post-deploy-catchup.sql`
   (đây là việc người vận hành làm tay; không có công cụ nào tự chạy file này).
3. Hai câu `SELECT` cuối file là phần kiểm tra: `houses_missing_from_directory` và `residents_missing_from_index` đều phải bằng **0**. Khác 0 thì đọc kỹ lỗi (thường là trùng số điện thoại hoặc `pay_no`) và xử lý tay trước khi `migrate` bất kỳ chủ trọ nào.
4. Cron hằng ngày (`reconcile`) cũng báo cư dân thiếu trong `resident_index` và căn lệch giữa thư mục và kho, nhưng chỉ báo, không sửa.
5. Đưa Worker về bản cũ sau khi đã deploy bản mới là **an toàn cho dữ liệu** (không dòng nào bị mất); chỉ có việc tạo căn mới trên bản cũ sẽ báo lỗi do khoá ngoại 0020, vô hại nếu lúc đó không ai tạo căn.

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
| `NOT_LOCKED` | 409 | `unlock` khi chủ trọ không đang bị khoá; không có gì để mở. |
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

- **Sau `rollback` kho riêng được xoá sạch** (sau khi đối chiếu D1 khớp; bản cũ vẫn khôi phục được bằng point-in-time recovery). Chỉ khi bước xoá lỗi thì kho còn lại và báo cáo có cảnh báo; khi đó `migrate` lần sau tự xoá, hoặc dùng `clear-store`. Trong lúc khoá của `rollback`, các lượt đọc lấy từ kho riêng ở chế độ chỉ đọc (`route.ts`), vì kho vẫn là bản đúng cho đến khi công tắc về `d1`.
- **`migrate` tự xoá kho còn sót**: nếu ai đó đã tự đổi công tắc về `d1` bằng tay trong khi kho đang giữ dữ liệu mới hơn D1, `migrate` kế tiếp sẽ xoá kho đó và chép lại từ D1; phần dữ liệu mới chỉ có trong kho **mất**, chỉ khôi phục được bằng point-in-time recovery của D1/DO. Không đổi công tắc bằng tay; dùng `rollback`.
- **Đợi 15 giây (drain)**: mỗi `migrate`/`rollback` ngủ 15 giây sau khi khoá ghi để các yêu cầu ghi đang bay kịp xong; ghi mới bị trả 503 trong suốt thời gian khoá (khoảng 15–20 giây). Đọc không bao giờ bị chặn.
- **Dải id theo chủ trọ**: id mới trong kho của chủ trọ `N` bắt đầu từ `N × 10^9 + k × 10^12` (k tăng thêm 1 mỗi lần chuyển lại), luôn trên id lớn nhất hiện có trong D1, nên không đụng id D1 hay của chủ trọ khác. Id cũ được giữ nguyên.
- **Khoản tiền chưa gắn nhà** chỉ được chép cho chủ trọ có nhà dùng đúng tài khoản ngân hàng đó; tài khoản trùng giữa hai chủ trọ thì bị từ chối (`SHARED_BANK_ACCOUNT`).
- D1 cũ không bị xoá sau khi chuyển; dọn dẹp là việc của một kế hoạch sau.
- **Mã chủ trọ phải nhỏ hơn 1000** (`ownerId` từ 1 đến 999): dải id `N × 10^9` chỉ rời nhau khi `N < 1000`. Chủ trọ có mã ngoài khoảng đó bị `migrate` từ chối an toàn (`MIGRATION_FAILED`, khoá được nhả về `d1`).
- **Chủ trọ mới mặc định ở `d1`**: `settings.new_owner_backend` mặc định `d1` và hiện chỉ được **đọc** (`directory.ts`); không có API hay giao diện để đổi. Muốn chủ trọ tạo sau này chạy thẳng trên kho riêng phải tự chạy SQL: `INSERT INTO settings (key, value) VALUES ('new_owner_backend', 'do') ON CONFLICT (key) DO UPDATE SET value = excluded.value;` (hoàn tác bằng `'d1'`).
- **Tiền hoãn (deferred)**: khi chủ trọ đang bị khoá, tiền SePay vào được giữ ở `sepay_events` với `status = 'deferred'`; màn hình cư dân và chủ trọ cộng nó vào nên thấy "Đã đóng" ngay. Việc ghi vào kho do cron 10 phút, hoặc `migrate` / `unlock`, làm sau. Cũng vì thế, nếu một lần ghi giữa chừng lỗi, sự kiện nằm ở `deferred` hoặc `replaying` cho đến lần phát lại kế tiếp. Tìm sự kiện bị kẹt lâu: `SELECT sepay_id, house_id, room, month, amount, status, created_at FROM sepay_events WHERE status IN ('deferred','replaying') ORDER BY created_at;` (bình thường rỗng sau vài phút).
- **Lịch cron** (`wrangler.toml`): mỗi 10 phút (`*/10 * * * *`) đọc lại Sheet cũ và phát lại tiền hoãn; hằng ngày 19:00 UTC (`0 19 * * *`) xoá hẳn các căn hết hạn rồi chạy `reconcile` (chạy lần lượt: xoá trước, đối chiếu sau). `reconcile` sửa số đếm phòng/cư dân trong thư mục, và **chỉ báo** các chỗ lệch: `resident_index` so với kho, và danh sách căn (thư mục thiếu hoặc kho thiếu, hoặc khác tên, trạng thái, `delete_after`, `pay_no`). Kết quả nằm ở `settings.last_reconcile`: `SELECT value, updated_at FROM settings WHERE key = 'last_reconcile';`
- **Mã lỗi HTTP khi đang chuyển**: API ghi trả **503** `TENANT_MIGRATING`; riêng `GET /api/dev/storage/:ownerId/export` trả **409** `TENANT_MIGRATING` (xuất khi đang khoá bị từ chối) và **500** `EXPORT_FAILED` nếu không đọc được kho riêng. Mã khác xem bảng ở trên.
- **Sau `migrate` dữ liệu cũ vẫn còn trong D1, gồm cả dữ liệu cá nhân** (họ tên, số điện thoại, CCCD đã mã hoá...). Yêu cầu xoá dữ liệu của một người phải xoá ở **cả hai nơi**: kho riêng của chủ trọ và các bảng cũ trong D1.
- **Developer không đóng trang** khi đang `migrate` / `rollback` từ giao diện: yêu cầu chạy trong lúc trang mở. Nếu lỡ đóng, đợi khoá tự hết hạn (10 phút) hoặc xem `GET /api/dev/storage`. Nút **Mở khoá** (`unlock`) **không hỏi xác nhận lần hai**: chỉ bấm khi chắc không còn lần chạy nào sống.
- **Tiền về trước khi có hoá đơn**: khoản tiền được ghi với `invoice_id = NULL` và không bao giờ tự đánh dấu hoá đơn nào là đã đóng; quản lý đánh dấu tay khi hoá đơn có (hành vi cũ, không đổi).
- **Giới hạn gói Workers Free**: mỗi lần gọi Worker tối đa 50 subrequest ra ngoài nhưng 1000 subrequest tới dịch vụ Cloudflare (D1, Durable Object). Một lần `migrate` khoảng 85 lệnh gọi, nằm trong giới hạn (xem tài liệu Cloudflare, "Workers limits", mục Subrequests). Dung lượng Durable Object tính theo GB thập phân (1 GB = 1.000.000.000 byte); tab Lưu trữ cảnh báo từ 70%.

## Diễn tập

Diễn tập chạy toàn bộ quy trình trên bản sao D1, hoàn toàn trên máy (miniflare, thư mục dữ liệu tạm ngoài repo), không đụng production.

Chuẩn bị: `wrangler d1 export tro-hub --remote --output <file.sql>` (một lần, ở nơi riêng tư, **không** đặt trong repo, không commit; file chứa dữ liệu cá nhân thật). Rồi, trong `cloudflare/`:

```
scripts/rehearse-migration.sh <file-sao-lưu.sql> [thư-mục-kết-quả] [ownerId ...]   # mặc định: 4 rồi 1
```

Script: nạp bản sao lưu vào D1 local (đưa bảng `staff` lên đầu vì bản export liệt kê nó sau các bảng tham chiếu tới nó), áp các migration còn thiếu (0016 trở đi), chạy `wrangler dev --local` trên cổng trống, đặt mật khẩu ngẫu nhiên chỉ-local cho tài khoản Developer trong bản sao rồi đăng nhập lấy token (xuất vào `TROHUB_DEV_TOKEN` của riêng script, không in), rồi chạy lần lượt `dry-run` các chủ trọ, `migrate` các chủ trọ, `rollback` chủ trọ đầu và `migrate` lại. Mỗi bước ghi báo cáo (chỉ số đếm và cờ) vào thư mục kết quả; cuối cùng tắt wrangler dev và xoá dữ liệu tạm. Lưu ý: `01-load.log` (thư mục kết quả) có thể chứa nguyên văn câu SQL, tức dữ liệu cá nhân; xoá hoặc che trước khi chia sẻ thư mục kết quả. Trên macOS (không có `setsid`) script tự dừng wrangler dev và workerd bằng `pgrep`/`pkill` theo cây tiến trình và thư mục tạm của lần chạy (ép dùng cách này bằng `REHEARSE_NO_SETSID=1`). Mã thoát khác 0 nếu bất kỳ bước nào `ok=false` hoặc API đọc khác nhau.

Hình dạng kết quả mỗi bước (chỉ mang tính tham khảo, quan sát được chứ không cam kết): dòng `<lệnh> chủ trọ #N: KHỚP`, bảng 9 dòng (D1 = kho, SHA khớp, `OK`), bảng theo tháng (tổng và số hoá đơn đã đóng khớp), `Tiền về bị hoãn đã ghi`, `Thời gian khoá ghi` (migrate/rollback), và `Các API đọc giống hệt nhau trước và sau.`

### Kết quả lần diễn tập 19/11/2026 (bản sao lưu ngày 18/11, trước migration 0016)

- Bản sao lưu đã áp tới 0015 (15 migration); sau khi áp thêm là 21 (0001–0021).
- D1: houses 3, house_rates 3, rooms 63, residents 69, invoices 352, meter_readings 352, payments 13, payment_gates 0, notifications 0.
- Chủ trọ #4: houses 1, rooms 19, còn lại 0. Chủ trọ #1: houses 2, rooms 44, residents 69, invoices 352, meter_readings 352, payments 13 (8 tháng, 04/2026 đến 11/2026, tổng và số đã đóng khớp từng tháng).
- Cả 6 bước (dry-run 4, dry-run 1, migrate 4, migrate 1, rollback 4, migrate 4 lần nữa) đều `ok=true`, SHA từng bảng khớp, API đọc trước/sau giống hệt; không có cảnh báo.
- 13 khoản tiền chưa gắn nhà **có trong bản sao lưu** và cả 13 thuộc kho của chủ trọ #1 (khớp theo tài khoản ngân hàng của nhà); chủ trọ #4 nhận 0; không có khoản nào không khớp.
- Thời gian: `dry-run` dưới 1 giây; mỗi `migrate`/`rollback` khoảng 15 đến 16 giây, trong đó khoá ghi 15,05 đến 15,22 giây (gần như toàn bộ là 15 giây drain; việc chép dữ liệu chỉ mất vài trăm mili giây trên dữ liệu cỡ này). Cả buổi diễn tập khoảng 1 phút 54 giây kể cả nạp dữ liệu và khởi động.
- Lưu ý khi chạy lại local: `wrangler d1 execute --file` không nạp được trực tiếp bản export vì thứ tự bảng; script đã xử lý.

## Bật Worker là nguồn chính

Công tắc `settings.source_of_truth` có hai giá trị: `sheet` (mặc định, hành vi như trước) và `worker`. **Không bật `worker` khi chưa có người dùng đồng ý.** Deploy code luôn để công tắc ở `sheet`.

### Trước khi deploy
1. Sao lưu D1 (export hoặc bookmark Time Travel).
2. **Áp migration 0022 lên D1 TRƯỚC khi deploy Worker.** Code mới đọc `invoices.issued_at`; code mới trên lược đồ cũ làm hỏng SePay và đồng bộ. Code cũ trên lược đồ mới thì vô hại, nên quay lại bản Worker cũ vẫn an toàn. Migration không chạy lại được (ALTER ADD COLUMN). Hoá đơn có sẵn đều được đánh dấu đã phát hành.
3. Deploy Worker; kiểm tra `GET /api/source` trả `sheet`, đăng nhập cư dân và chủ trọ, một giao dịch SePay thử, cron vẫn đồng bộ Sheet.
4. Đặt secret `ZALO_APP_SECRET` cho Worker (`wrangler secret put ZALO_APP_SECRET`, không in giá trị ra). Thiếu khoá này công tắc từ chối chuyển sang `worker` (409 `ZALO_NOT_CONFIGURED`).
5. Chạy `node cloudflare/scripts/verify-billing.mts sql TRUNG_KIM LVC`, chạy câu SELECT trên D1 thật, rồi `check rows.json ...` để so các hoá đơn đã lưu với công thức (chỉ đọc). Phải không có sai lệch.
6. Chủ trọ ngừng sửa Sheet. Khi chuyển, Worker tự đọc Sheet lần cuối (tháng này và tháng trước) trước khi đổi công tắc; nếu đọc lỗi, công tắc không đổi và trả 409 `SYNC_FAILED`.

### Bật
Trang Developer, tab Lưu trữ, thẻ "Nguồn dữ liệu", nút "Chuyển sang Worker" (hoặc `PUT /api/dev/source {"source":"worker"}`). Từ lúc này Worker không đọc Sheet nữa; điện nước, thanh toán, đơn giá, đăng ký, hồ sơ, duyệt và xoá cư dân được xếp hàng và cron 10 phút ghi sang Sheet một chiều (tối đa 20 dòng mỗi lần, mỗi dòng thử tối đa 5 lần).

Express và Mini App nhớ nguồn khoảng 30 giây (cộng thêm 30 giây cache của `GET /api/source`), nên có độ trễ tới khoảng 1 phút. Trong lúc đó, các route Express ghi Sheet trả 409 `SOURCE_CHANGED` ("Hệ thống đã chuyển nguồn dữ liệu, hãy tải lại trang"); tab cũ chỉ cần tải lại.

### Theo dõi hàng đợi
Thẻ "Nguồn dữ liệu" (hoặc `GET /api/dev/storage`, trường `exportQueue`) cho số dòng chờ và danh sách dòng lỗi kèm lý do. Dòng lỗi thường do tab tháng chưa có trên Sheet (tab tháng mới do `createMonthlySheet` trong AutoSheet.gs của Apps Script tạo lúc 07:00 ngày 1 hàng tháng; Worker tạo nháp từ 00:00 nên nếu có nhập điện nước trước 07:00 ngày 1 thì dòng xuất có thể lỗi, bấm "Thử lại" sau khi tab đã có). Sửa Sheet rồi bấm "Thử lại" (`POST /api/dev/export-queue/requeue`) để đưa các dòng đã bỏ cuộc về 0 lần thử. Gửi lại luôn an toàn vì Apps Script ghi đè giá trị ô.
Mật khẩu và CCCD không được chép sang Sheet: cư dân đăng ký khi ở `worker` có cột mật khẩu trống trên Sheet.

### Quay lại Sheet
Nút "Quay lại Sheet" (hoặc `PUT /api/dev/source {"source":"sheet"}`):
- Còn dòng chờ: 409 `EXPORT_PENDING`, đợi hàng đợi chạy hết.
- Còn dòng đã lỗi 5 lần: 409 `EXPORT_FAILED`. Thử lại các dòng đó, hoặc xác nhận bỏ qua (`acknowledgeFailed: true`; số liệu các dòng ấy sẽ không có trên Sheet và lần đọc Sheet tiếp theo có thể ghi đè số liệu ở Worker).
- Khi thành công, phản hồi có `workerOnlyResidents`: số cư dân chỉ tồn tại ở Worker (đăng ký sau lúc bật), cần nhập tay vào Sheet. Trang Developer hiện cảnh báo này.
- Cron đọc Sheet chạy lại; số liệu Sheet đã nhận từ hàng đợi.

### Ghi chú
- Kho riêng (Durable Object) đã có dữ liệu mà chưa nâng bảng mới: hãy chạy chạy thử (dry-run) trước; `AUTOINCREMENT` của bảng mới chưa có mốc sàn nên không dùng cho chủ trọ đã chuyển kho khi chưa kiểm tra.
- `POST /api/auth/register` chỉ tồn tại khi công tắc là `worker` (404 ở `sheet`).

## Phí theo tháng và chuyển tháng 00:00

**Phí theo tháng.** Đơn giá điện, nước và danh sách dịch vụ (giá, "tính theo", tối đa) thuộc từng tháng: bảng `house_fee_months` (giá điện, nước) và `house_fee_services` (dịch vụ, khoá theo `service_id` = `house_services.id` nên "phòng từ chối dịch vụ" và dòng hoá đơn vẫn trỏ đúng). Sửa phí trong tháng M chỉ đổi tháng M; hoá đơn nháp của M được tính lại, hoá đơn đã phát hành không bị tính lại. Tháng trước tháng hiện tại (giờ Việt Nam) chỉ xem: `PUT/POST /api/admin/config` trả 409 `MONTH_READONLY`. `GET /api/admin/config?houseId=&month=` trả thêm `month` và `editable`.

- Tháng chưa có ảnh chụp thì chép từ tháng gần nhất trước đó (nếu không có thì lấy `house_rates` / `house_services`) và được lưu khi tạo nháp hoặc khi sửa; xem thì không ghi gì.
- `house_rates` / `house_services` vẫn còn: là "mẫu hiện hành" (luôn khớp ảnh chụp tháng hiện tại, được cập nhật cùng lúc) và là kho cấp `service_id`. Chỉ dùng làm gốc khi một nhà chưa có ảnh chụp nào.
- Migration `0023_fee_months.sql` chỉ thêm 2 bảng và điền một ảnh chụp của tháng hiện tại (giờ VN) cho mỗi nhà từ `house_rates` / `house_services`, nên hành vi tính tiền không đổi. Phần dành cho kho riêng nằm trong `TENANT_MIGRATIONS` (phần tử thứ 3) và 2 bảng đã có trong `TENANT_TABLES` (chạy thử, chuyển, quay lại, xuất và băm đều gồm chúng).

**Chuyển tháng lúc 00:00 giờ VN.** Khi công tắc là `worker`, cron `0 17 * * *` (17:00 UTC = 00:00 VN) tạo ảnh chụp phí của tháng mới (chép từ tháng trước) rồi hoá đơn nháp cho mọi phòng có cư dân đã duyệt. Số cũ điện/nước của tháng mới chính là số mới của tháng trước (suy ra khi tính, không chép), nên chủ trọ chỉ nhập số mới. Cron 10 phút bắt kịp nếu lần 00:00 bị lỡ: mỗi lần chỉ đọc 1 dòng `settings.month_started`; đã ghi tháng hiện tại thì không làm và không ghi gì thêm. Lỗi thì ghi `YYYY-MM!n` và thử lại ở lần sau, dừng sau 6 lần (cron 00:00 / hằng ngày làm tiếp). Không bao giờ tạo bù tháng đã qua. Xem trạng thái: `SELECT value, updated_at FROM settings WHERE key = 'month_started';`

**Khi triển khai.** Danh sách `crons` trong `wrangler.toml` đổi thành `["0 19 * * *", "0 17 * * *", "*/10 * * * *"]`: phải deploy Worker mới **cùng lúc** với migration `0023` (`npx wrangler d1 migrations apply`): nếu có cron mới mà thiếu bảng, bước chuyển tháng sẽ lỗi và chỉ ghi cảnh báo; nếu có bảng mà thiếu cron thì cron 10 phút vẫn bắt kịp trong vòng 10 phút. Gói Cloudflare miễn phí giới hạn số cron trên cả tài khoản (hiện 5): kiểm tra còn chỗ cho cron thứ 3 của Worker này.

**Bổ sung sau rà soát.** (1) Tháng cũ hơn ảnh chụp đầu tiên không có phí riêng: màn hình báo "Chưa lưu phí" (`known: false`, chỉ xem) và phí hiện tại không bao giờ được lưu làm ảnh chụp của tháng đã qua. (2) `PUT /api/houses/:id/rates` ghi xuống ảnh chụp tháng hiện tại và tính lại nháp tháng đó. (3) API phí chỉ nhận tháng đến hết tháng sau tháng hiện tại (sai: 400 `MONTH_INVALID`). (4) Khi bật nguồn `worker` giữa tháng, hệ thống tạo ngay hoá đơn nháp cho tháng hiện tại các phòng có cư dân mà chưa có hoá đơn; số lượng trả về ở `draftsCreated` và hiện trên thẻ Developer. Nên tạm không sửa phí trong khoảng giữa lúc chạy migration `0023` và lúc deploy Worker mới.

## SePay Bank Hub (thử nghiệm sandbox)

Tính năng tắt mặc định và không đổi gì ở bản đang chạy: chưa đặt khoá thì mọi route Bank Hub trả 503 `BANKHUB_NOT_CONFIGURED` hoặc 401. Chỉ Developer thao tác; Worker nhận tin từ SePay rồi ghi tiền trọ y như webhook SePay hiện có (cùng mã `XXXPPPMMYYYY`, cùng xử lý đủ / thiếu / chờ khi kho đang chuyển / chưa gán, không bao giờ qua chủ trọ khác).

**Cài đặt (chỉ tên, giá trị do SePay cấp, không ghi vào repo).** Migration `0025_bankhub.sql` phải áp trước (bảng `bankhub_companies`, `bankhub_accounts`, `bankhub_link_tokens`).
- Biến: `BANKHUB_BASE` (bỏ trống = `https://bankhub-api.sepay.vn`; thử nghiệm đặt `https://bankhub-api-sandbox.sepay.vn`).
- Secret: `BANKHUB_CLIENT_ID`, `BANKHUB_CLIENT_SECRET` (Basic auth lấy token ở `POST /v1/token`), `BANKHUB_IPN_KEY` (khoá SePay gửi kèm IPN và webhook sự kiện; để trống thì từ chối hết).

**Địa chỉ đưa cho SePay**
- IPN biến động số dư: `https://tro-hub-api.trohub.workers.dev/api/bankhub/ipn` (SePay gửi `Authorization: Apikey <khoá>`, Worker trả `{"success": true}`).
- Webhook sự kiện liên kết: `https://tro-hub-api.trohub.workers.dev/api/bankhub/events`. Theo tài liệu, API cập nhật webhook gửi `secret_key` trong header `X-Secret-Key`; hãy đặt `secret_key` đúng bằng `BANKHUB_IPN_KEY`. Worker chấp nhận khoá ở `Authorization: Apikey` hoặc `X-Secret-Key`.

**Cách thử (Developer):** Cổng Developer → chủ trọ → SePay → khối "Bank Hub (thử nghiệm)": Tạo công ty Bank Hub → Mở liên kết ngân hàng → liên kết tài khoản mẫu → Đồng bộ tài khoản. Tài khoản mẫu công khai trong trang Sandbox của SePay (`/vi/bankhub/thong-tin-sandbox`): MBBank cá nhân 0123456789, OTP 12345678. Số tài khoản trong giao diện che còn 4 số cuối. Trọ Hub không tự sửa số tài khoản trong cài đặt căn trọ.

**Giới hạn ngân hàng (theo trang "SePay Bank Hub là gì?", mục Các ngân hàng hỗ trợ)**
- BIDV, OCB, KienLongBank, MSB, VPBank hộ kinh doanh: "chỉ nhận tiền vào từ VA", nghĩa là tiền chuyển thẳng vào tài khoản chính không báo về.
- VietinBank (cá nhân, hộ kinh doanh): QR do hệ thống tạo có tiền tố `SEVQR ` ở đầu nội dung; người chuyển phải giữ nguyên, nếu xoá SePay không gửi IPN. Worker đã nhận được nội dung dạng `SEVQR 001101112026`.
- Vietcombank không có trong danh sách ngân hàng Bank Hub hỗ trợ. VietinBank, TPBank, OCB, MSB, KienLongBank khi "Hủy liên kết" chỉ vô hiệu hoá trong Bank Hub.
- IPN chỉ gửi khi công ty ở trạng thái `Active` và còn lượt giao dịch (`transaction_amount` lớn hơn 0 hoặc `Unlimited`).

**Chưa quyết (thương mại):** có bắt buộc mã số thuế / pháp nhân cho công ty Bank Hub của từng chủ trọ không (sandbox chỉ cần tên công ty); hạn mức lượt giao dịch tính cho ai (Trọ Hub hay từng chủ trọ). Cần hỏi SePay trước khi chạy thật.

**Khôi phục tiền:** SePay không gửi lại IPN khi Worker đã trả 200. Mọi IPN hợp lệ được lưu trước khi xử lý (`unassigned_payments` cho tới khi gán được căn; mã `bh-sbx-…` là sandbox, `bh-…` là thật). IPN lỗi số tiền (không nguyên dương, quá 100 tỷ) bị bỏ qua và ghi audit `bankhub_ipn_bad_amount`. Giao dịch nghi sót: đối chiếu bằng `GET /v1/transaction` của Bank Hub. `BANKHUB_BASE` phải là https trên `*.sepay.vn`, sai thì tính năng coi như chưa cấu hình.

**Tắt:** xoá `BANKHUB_IPN_KEY` (`wrangler secret delete BANKHUB_IPN_KEY`): `/api/bankhub/ipn` và `/api/bankhub/events` từ chối mọi yêu cầu ngay. Xoá thêm `BANKHUB_CLIENT_ID` / `BANKHUB_CLIENT_SECRET` để các nút Developer ngừng gọi SePay. Dữ liệu đã ghi (tiền trọ, `sepay_events` mã `bh-…`) giữ nguyên.

## Chế độ xoá căn

Cài đặt `settings.house_delete_mode`, chỉ Developer đổi được (tab Lưu trữ, thẻ "Chế độ xoá căn", hoặc `GET/PUT /api/dev/house-delete-mode`, mỗi lần đổi ghi audit `house_delete_mode` cũ→mới).

- `grace` (mặc định, cũng là giá trị khi chưa có dòng nào): xoá căn chuyển sang chờ 7 ngày, có sao lưu và khôi phục, cron hằng ngày xoá hẳn. **Chạy thật luôn để chế độ này.**
- `immediate`: `POST /api/dev/houses/:houseId/delete` xoá hẳn ngay (cùng hàm `purgeHouse` với cron), trả `{success, deleted: true}`, audit `house_delete_now` kèm số phòng/cư dân/hoá đơn/thu tiền đã xoá. Không sao lưu, không hoàn tác. Chỉ dùng cho tài khoản thử nghiệm. Nếu kho của chủ trọ đang chuyển/khoá thì trả 409 `HOUSE_BUSY`, không xoá gì. Các căn đang chờ xoá từ trước không bị đụng, cron vẫn xử lý.

Dọn tài khoản thử: bật `immediate`, xoá từng căn, rồi bấm "Xoá chủ trọ" (chủ trọ không còn căn và chưa có hoá đơn phí). Xong việc thì chuyển lại `grace`.
