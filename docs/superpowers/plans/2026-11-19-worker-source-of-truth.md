# Worker là nguồn dữ liệu chính — Kế hoạch thực hiện

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển nhập điện nước, tính và phát hành hoá đơn, đăng nhập Zalo, đăng ký/duyệt cư dân và dữ liệu app cư dân sang Worker; Google Sheet chỉ nhận bản sao một chiều; có công tắc `sheet | worker` (mặc định `sheet`).

**Architecture:** Thêm bảng phí dịch vụ, dòng hoá đơn và cột "đã phát hành" vào dữ liệu nghiệp vụ (D1 cũ và kho riêng, cùng lược đồ). Một hàm tính tiền thuần (pure) dùng chung cho mọi nơi. Worker thêm các API cùng đường dẫn và cùng hình dạng JSON như Express đang trả, nên frontend chỉ đổi nơi gửi khi công tắc là `worker`; Express `/api/auth/worker-session` lấy hồ sơ và hoá đơn từ Worker thay vì Sheet khi công tắc là `worker`, để phiên Express (giặt sấy…) vẫn còn. Xuất Sheet qua hàng đợi dùng đúng các action Apps Script đang có.

**Tech Stack:** Cloudflare Workers, Hono 4, D1, Durable Objects SQLite, TypeScript, Vitest 4.1 + `@cloudflare/vitest-plugin` 1.5.1; Express (Render); React (Vite).

**Spec:** `docs/superpowers/specs/2026-11-19-worker-source-of-truth-design.md`

## Global Constraints

- Công tắc `settings.source_of_truth` ∈ {`sheet`,`worker`}, mặc định và giá trị khi deploy: **`sheet`** (không đổi hành vi). Bật `worker` trên bản thật chỉ khi người dùng đồng ý.
- Công thức (spec §2): số điện/nước = `max(mới − cũ, 0)`; tiền = số × đơn giá; tiền phòng = `rooms.price`; dịch vụ = giá × số lượng theo "tính theo" (`room` = 1, `person` = min(số cư dân đã duyệt, max_qty nếu có), `vehicle` = số cư dân đã duyệt có biển số); Khác = số điện × (`houses.actual_electric_price` − đơn giá điện) chỉ khi `actual_electric_price` không NULL; **tiền cọc không cộng vào tổng**; mọi số tiền là số nguyên đồng.
- Dữ liệu ban đầu nhà Trung Kim và LVC: Rác 30.000 `room`; Internet 40.000 `person` max_qty 2; Xe máy 50.000 `vehicle`; `actual_electric_price` = 3.300; điện 3.500, nước 20.000 (lấy theo `house_rates` hiện có).
- Hoá đơn **nháp** = `issued_at IS NULL`; cư dân không bao giờ nhận hoá đơn nháp; SePay gặp mã của hoá đơn nháp: ghi `payments`, không đổi trạng thái.
- Sửa hoá đơn: được khi chưa trả đủ; sau khi sửa tính lại trạng thái theo (đã nhận + tiền chờ) so với tổng mới; tổng mới < đã nhận → hiển thị "dư X đồng", không tự hoàn tiền; phòng đã đóng khoá sửa.
- 352 hoá đơn cũ đóng băng (không tính lại); kiểm chứng chỉ đọc.
- Bảng nghiệp vụ mới nằm trong kho chủ trọ (cùng `TENANT_TABLES`, có trong chạy thử/chuyển/quay lại và băm); bảng mới ở trung tâm chỉ cho công tắc và hàng đợi xuất Sheet.
- Đường dẫn và hình dạng JSON các API chuyển từ Express sang Worker **giữ nguyên** như Express trả hôm nay (tham chiếu hàm Express ghi trong từng task).
- Giặt sấy, hợp đồng CT01, kỳ kê khai: không đụng tới.
- Mỗi commit: `npm test` (thư mục `cloudflare/`) xanh, `npx tsc --noEmit` và `npx tsc --noEmit -p test` sạch; thay đổi frontend: `npm run lint` ở gốc sạch. Dòng attribution theo file global-constraints của phiên.

## Review Focus

1. **Cư dân đang có, đăng nhập Zalo sau khi bật `worker`**, số điện thoại trong Worker khác định dạng Zalo trả về (`+84…`, `84…`) → vẫn khớp nhờ chuẩn hoá. → test Task 7.
2. **Tháng mới bắt đầu khi tháng trước chưa có số điện nước** (số cũ không có) → số cũ = số mới gần nhất có được, không về 0 khiến tính cả công tơ. → test Task 4.
3. **Admin đổi đơn giá giữa tháng sau khi đã mở thu** → hoá đơn đã phát hành giữ nguyên, chỉ nháp đổi. → test Task 5.
4. **Phòng có 3 người nhưng Internet tối đa 2** và phòng có người không có biển số → số lượng đúng 2 và xe = số người có biển. → test Task 2.
5. **Hàng đợi xuất Sheet khi Apps Script lỗi liên tục** → không chặn việc ghi hoá đơn, thử lại tối đa 5 lần rồi báo trên trang Developer. → test Task 10.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `cloudflare/migrations/0022_billing_services.sql` | D1: `house_services`, `room_service_optouts`, `invoice_lines`, `invoices.issued_at`, `houses.actual_electric_price`, `settings.source_of_truth`, `sheet_export_queue`, dữ liệu ban đầu |
| `cloudflare/src/tenant/schema.ts` | Thêm phiên bản lược đồ kho (`TENANT_MIGRATIONS[n]`) và 3 bảng mới vào `TENANT_TABLES` |
| `cloudflare/src/billing/compute.ts` | Hàm tính tiền thuần |
| `cloudflare/src/billing/invoices.ts` | Lập nháp, tính lại, phát hành, quy tắc sửa |
| `cloudflare/src/routes/admin.ts` | API admin chuyển từ Express (`/api/admin/rooms`, `room-detail`, `config`, `accounts*`) |
| `cloudflare/src/routes/tenant.ts` | `GET /api/tenant/session`, `GET /api/sheets/tenant-data`, `POST /api/profile/update` |
| `cloudflare/src/routes/auth.ts` | Thêm `POST /api/auth/zalo`, `POST /api/auth/register` |
| `cloudflare/src/zalo.ts` | Gọi Graph API Zalo (bản Worker của `src/server/zaloService.ts`) |
| `cloudflare/src/source.ts` | Đọc/ghi công tắc; `GET /api/source` |
| `cloudflare/src/sheetExport.ts` | Hàng đợi và gọi Apps Script |
| `cloudflare/scripts/verify-billing.mts` | Kiểm chứng chỉ đọc 8 tháng |
| `src/server/workerSession.ts`, `server.ts` | Chế độ `worker`: lấy hồ sơ/hoá đơn từ Worker |
| `src/lib/api.ts`, `src/services/authService.ts`, `src/lib/zaloAuth.ts`, `src/context/AppContext.tsx` | Gửi tới Worker khi công tắc `worker` |
| `src/components/AdminPortal.tsx` (+ tách `src/components/admin/FeeSettings.tsx`, `src/components/admin/MonthBilling.tsx`) | Cài đặt phí tuỳ chỉnh, nhập điện nước, mở thu, "dư" |

---

## GIAI ĐOẠN 1 — Tính tiền

### Task 1: Lược đồ phí dịch vụ, dòng hoá đơn, công tắc

**Files:** Create `cloudflare/migrations/0022_billing_services.sql`; Modify `cloudflare/src/tenant/schema.ts`, `cloudflare/test/helpers.ts`; Test `cloudflare/test/billing-schema.test.ts`

**Interfaces — Produces:**
- Bảng kho (D1 cũ + kho riêng, cùng cột): `house_services(id INTEGER PK AUTOINCREMENT, house_id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, per TEXT NOT NULL CHECK (per IN ('room','person','vehicle')), max_qty INTEGER, sheet_col TEXT CHECK (sheet_col IN ('K','L','M')), sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`; `room_service_optouts(room_id INTEGER NOT NULL, service_id INTEGER NOT NULL, PRIMARY KEY (room_id, service_id))`; `invoice_lines(id INTEGER PK AUTOINCREMENT, invoice_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('room','electricity','water','service','other')), service_id INTEGER, name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL, amount INTEGER NOT NULL)`; `invoices.issued_at TEXT` (NULL = nháp); `houses.actual_electric_price INTEGER`.
- Trung tâm: `sheet_export_queue(id INTEGER PK AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT)`; `settings('source_of_truth','sheet')`.
- Dữ liệu ban đầu theo Global Constraints cho `TRUNG_KIM`, `LVC` (sheet_col K/L/M cho Rác/Internet/Xe); hoá đơn hiện có: tháng trước tháng hiện tại → `issued_at = created_at`; tháng hiện tại → `issued_at = created_at` nếu `payment_gates` của căn/tháng đó là `START`, ngược lại để NULL (nháp) (spec §12 "Thời điểm bật").
- `TENANT_TABLES` thêm `house_services` `['id']`, `room_service_optouts` `['room_id','service_id']`, `invoice_lines` `['id']` sau `invoices`; `TENANT_MIGRATIONS` thêm phần tử mới đưa kho cũ lên lược đồ mới.

- [ ] **Step 1: Test** `billing-schema.test.ts`: lược đồ kho giống D1 cho 3 bảng mới (dùng cách so `PRAGMA table_info` như `tenant-store.test.ts`); kho tạo trước khi có phiên bản mới được nâng cấp khi mở lại; dữ liệu ban đầu cho Trung Kim có đúng 3 dịch vụ (giá, per, max_qty); hoá đơn cũ có `issued_at` khác NULL; `settings.source_of_truth = 'sheet'`; chạy thử/chuyển (`migrateOwner`) vẫn khớp băm khi có dữ liệu ở 3 bảng mới.
- [ ] **Step 2: FAIL. Step 3: viết migration + schema. Step 4: `npm test` PASS. Step 5: Commit** `feat(worker): service fees, invoice lines and draft column (0022)`

### Task 2: Hàm tính tiền

**Files:** Create `cloudflare/src/billing/compute.ts`; Test `cloudflare/test/billing-compute.test.ts`

**Interfaces — Produces:**
```ts
export type Per = 'room' | 'person' | 'vehicle';
export interface ServiceFee { id: number; name: string; price: number; per: Per; maxQty: number | null; sheetCol: 'K' | 'L' | 'M' | null }
export interface BillingInput {
  rent: number; electricOld: number | null; electricNew: number | null; waterOld: number | null; waterNew: number | null;
  electricPrice: number; waterPrice: number; actualElectricPrice: number | null;
  services: ServiceFee[]; people: number; vehicles: number;
}
export interface InvoiceLine { kind: 'room' | 'electricity' | 'water' | 'service' | 'other'; serviceId: number | null; name: string; qty: number; unitPrice: number; amount: number }
export function computeInvoice(input: BillingInput): { lines: InvoiceLine[]; total: number; electricUsage: number; waterUsage: number };
```
Thứ tự dòng: phòng, điện, nước, dịch vụ (theo `sort`), Khác. Dịch vụ có số lượng 0 vẫn có dòng (amount 0). Số đọc NULL → số tiêu thụ 0.

- [ ] **Step 1: Test** (giá trị thật từ Sheet tháng 10, phòng 2 người, 2 xe):
```ts
expect(computeInvoice({ rent: 2_300_000, electricOld: 1000, electricNew: 1065, waterOld: 100, waterNew: 104, electricPrice: 3500, waterPrice: 20000, actualElectricPrice: 3300,
  services: TK_SERVICES, people: 2, vehicles: 2 }).total).toBe(2_300_000 + 227_500 + 80_000 + 30_000 + 80_000 + 100_000 - 13_000);
// điện 65 × 3500 = 227.500; Khác 65 × (3300 − 3500) = −13.000
it('internet tối đa 2 người', …)            // people 3 → internet qty 2 = 80.000
it('xe tính theo số người có biển số', …)    // vehicles 1 → 50.000
it('số mới nhỏ hơn số cũ → 0', …)
it('không có actualElectricPrice → không có dòng Khác', …)
it('tháng 4 (giá 3300, actual 3300) → Khác = 0', …)
```
- [ ] **Step 2: FAIL. Step 3: viết. Step 4: PASS. Step 5: Commit** `feat(worker): pure invoice calculation`

### Task 3: Kiểm chứng 8 tháng trên dữ liệu thật (chỉ đọc)

**Files:** Create `cloudflare/scripts/verify-billing.mts`, `cloudflare/src/billing/verify.ts`; Test `cloudflare/test/billing-verify.test.ts`

**Interfaces — Produces:** `verifyHistory(db: TenantDb, houseIds: string[], opts: { electricPriceByMonth: Record<string, number> }): Promise<{ checked: number; mismatches: { houseId: string; room: string; month: string; stored: number; computed: number }[] }>` — đọc `invoices` + `meter_readings`; người/xe lấy từ các cột `internet`/`parking` đã lưu chia đơn giá (vì danh sách người lịch sử không có); kiểm tra phần điện + nước + phòng + Khác khớp `total − trash − internet − parking`. Script chạy bằng `wrangler d1 execute --remote --command` **chỉ đọc** do controller chạy (không trong test).

- [ ] **Step 1: Test** trên dữ liệu mẫu: một tháng khớp → mismatches rỗng; sửa một `total` → báo đúng phòng/tháng.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): read-only billing verification over history`
- [ ] **Step 6 (controller):** chạy trên D1 thật, ghi kết quả (số hoá đơn, số lệch) vào báo cáo; lệch → dừng, báo người dùng.

## GIAI ĐOẠN 2 — Vòng đời hoá đơn và nhập điện nước

### Task 4: Lập nháp, phát hành, quy tắc sửa

**Files:** Create `cloudflare/src/billing/invoices.ts`; Modify `cloudflare/src/cron.ts`, `cloudflare/src/routes/rent.ts`, `cloudflare/src/routes/people.ts`, `cloudflare/src/payments/settle.ts`; Test `cloudflare/test/billing-lifecycle.test.ts`

**Interfaces — Produces:**
- `createDrafts(env: Env, ownerId: number, month: string): Promise<number>` — mỗi phòng có cư dân đã duyệt và chưa có hoá đơn tháng đó: tạo nháp; số cũ = `electric_new`/`water_new` của tháng gần nhất trước đó có số (không chỉ tháng liền trước).
- `recompute(db: TenantDb, invoiceId: number): Promise<{ total: number; surplus: number }>` — xoá/ghi lại `invoice_lines`, cập nhật các cột tiền cũ (`room_rent, electricity, water, trash/internet/parking` theo `sheet_col`, `other` = Khác) và `total`; rồi tính lại trạng thái: đã nhận (bank + cash) + tiền chờ ≥ tổng → `paid`; `surplus = max(đã nhận − tổng, 0)`.
- `issueMonth(env: Env, houseId: string, month: string, force: boolean): Promise<{ issued: number; missingMeters: string[] }>` — `force=false` và còn phòng thiếu số mới → không phát hành, trả danh sách phòng; phát hành = đặt `issued_at` + cổng START như hiện nay.
- Quy tắc sửa: `canEdit(invoice) = status not in ('paid','cash')`.
- Cron: ngày 1 (giờ VN) gọi `createDrafts` cho mọi chủ trọ khi công tắc `worker`. Duyệt cư dân vào phòng chưa có hoá đơn tháng hiện tại → `createDrafts` cho phòng đó.
- API cư dân (`/api/payment/status`, danh sách hoá đơn cư dân) bỏ qua `issued_at IS NULL`; `settleRent` với hoá đơn nháp: ghi `payments`, không đổi trạng thái (test).

- [ ] **Step 1: Test** (cả hai backend): nháp không hiện với cư dân; số cũ lấy tháng gần nhất có số (Review Focus 2); `issueMonth` thiếu số → `missingMeters` có tên phòng và không phát hành, `force` → phát hành; sửa hoá đơn trả một phần → tính lại và tự `paid` khi đủ; tổng mới < đã nhận → `surplus`; hoá đơn `paid` không sửa được (409 `INVOICE_LOCKED`); SePay vào nháp → có `payments`, trạng thái giữ.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): monthly drafts, issuing and edit rules`

### Task 5: API admin (nhập điện nước, cài đặt phí, danh sách phòng)

**Files:** Create `cloudflare/src/routes/admin.ts`; Test `cloudflare/test/admin-billing.test.ts`

**Interfaces — Produces** (đường dẫn như Express; hình dạng JSON như hàm Express ghi trong ngoặc):
- `GET /api/admin/rooms?month=` (`getRoomListByMonth`, `src/server/adminService.ts:457`) — thêm trường `draft: boolean`, `surplus: number`.
- `GET /api/admin/room-detail?month=&room=` (`getRoomDataByMonth`, `:593`); `POST /api/admin/room-detail` body `{ month, room, data: { dienCu?, dienMoi?, nuocCu?, nuocMoi?, paymentStatus? } }` → ghi `meter_readings`, `recompute`, 409 `INVOICE_LOCKED` nếu đã đóng.
- `GET /api/admin/config?month=&houseId=` → `{ success, config: { electricPrice, waterPrice, services: ServiceFee[] } }`; `PUT /api/admin/config` body cùng hình dạng → lưu; tính lại **chỉ các hoá đơn nháp** (Review Focus 3).
- `PUT /api/admin/rooms/:roomId/services` body `{ optOut: number[] }`.
- `POST /api/admin/issue-month` body `{ houseId, month, force }` → `issueMonth`.
- Mọi route: `requireAuth`, `staffOnly`, `tenantFor` theo căn; tháng nhận cả `11/2026` và `2026-11`.

- [ ] **Step 1: Test** (cả hai backend): nhập số → tổng đổi đúng theo Task 2; đổi giá sau khi phát hành → hoá đơn đã phát hành giữ nguyên, nháp đổi; quản lý căn khác → 403; JSON `rooms` có đủ khoá như Express (so danh sách khoá với một mẫu lấy từ `getRoomListByMonth`).
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): admin meters, fee settings and issuing APIs`

## GIAI ĐOẠN 3 — Đăng nhập, đăng ký, duyệt cư dân

### Task 6: Zalo, đăng ký, duyệt, hồ sơ trên Worker

**Files:** Create `cloudflare/src/zalo.ts`, `cloudflare/src/routes/tenant.ts`; Modify `cloudflare/src/routes/auth.ts`, `cloudflare/src/routes/admin.ts`, `cloudflare/src/app.ts` (`ZALO_APP_SECRET?: string`); Test `cloudflare/test/zalo-accounts.test.ts`

**Interfaces — Produces:**
- `zaloPhone(env: Env, accessToken: string, phoneToken: string): Promise<{ phone: string; zaloId: string; name: string; avatar: string }>` — gọi `https://graph.zalo.me/v2.0/me` (header `appsecret_proof` = HMAC-SHA256 hex của access token với `ZALO_APP_SECRET`) và `/v2.0/me/info` (header `code`, `secret_key`), như `src/server/zaloService.ts`; chuẩn hoá số (`+84`/`84` → `0`).
- `POST /api/auth/zalo` body `{ accessToken, phoneToken }` → tra `staff` rồi `resident_index` theo số; trả như `/api/auth/login` của Worker (`{ success, token, viewer }`) + `zalo: { id, name, avatar }`; `pending` → 403 `AUTH_PENDING_APPROVAL` "đang chờ chủ trọ duyệt"; không có → 404 `AUTH_TENANT_NOT_MAPPED` với đúng câu Express đang dùng; thiếu secret → 503 `ZALO_NOT_CONFIGURED`.
- `POST /api/auth/register` (công khai) như Express (`server.ts:138`): tạo cư dân `pending` theo thứ tự danh bạ trước, kho sau.
- `GET /api/admin/accounts`, `POST /api/admin/accounts/status`, `POST /api/admin/accounts/delete` — hình dạng như Express (`server.ts:1006-1035`), theo căn của staff.
- `POST /api/profile/update` như Express (`server.ts:502`), cho cư dân đang đăng nhập.

- [ ] **Step 1: Test**: Zalo giả lập (`fetchMock` cho `graph.zalo.me`) trả `+84900000099` → đăng nhập được cư dân `0900000099` (Review Focus 1); số staff → token staff; `pending` → 403; không có → 404 đúng câu; thiếu secret → 503; đăng ký → chờ duyệt → duyệt → đăng nhập mật khẩu được; quản lý không thấy tài khoản căn khác.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): Zalo login, registration and account approval`

## GIAI ĐOẠN 4 — Công tắc và frontend

### Task 7: Công tắc và dữ liệu phiên cư dân

**Files:** Create `cloudflare/src/source.ts`; Modify `cloudflare/src/routes/tenant.ts`, `src/server/workerSession.ts`, `server.ts`; Test `cloudflare/test/source-session.test.ts`

**Interfaces — Produces:**
- `getSource(db: D1Database): Promise<'sheet' | 'worker'>`; `GET /api/source` (công khai) → `{ success, source }`; `PUT /api/dev/source` (Developer) body `{ source }` — chuyển về `sheet` bị từ chối 409 `EXPORT_PENDING` khi hàng đợi xuất còn dòng chưa xong; trả thêm `workerOnlyResidents` (số cư dân không có dòng ở Sheet: `residents` tạo sau thời điểm bật).
- `GET /api/tenant/session` (token Worker) → `{ success, user, invoices, isAdmin, house }` đúng hình dạng Express `/api/auth/worker-session` (`src/server/workerSession.ts:52`): `user` theo `AuthenticatedTenantUser` (`src/services/authService.ts`), `invoices` theo `Invoice` (`src/context/AppContext.tsx:19`) chỉ gồm hoá đơn đã phát hành, `details` từ `invoice_lines`.
- `GET /api/sheets/tenant-data` (token Worker) → hình dạng `fetchFreshTenantDataFromSheet` (`src/server/googleSheetsBackendService.ts:1198`) lấy từ Worker.
- Express `/api/auth/worker-session`: khi `GET {WORKER}/api/source` = `worker` (cache 30 s), lấy `user`/`invoices` từ `GET {WORKER}/api/tenant/session` với cùng Bearer thay vì `authenticateUser`; vẫn ký token Express như cũ.

- [ ] **Step 1: Test** (Worker): `source` mặc định `sheet`; chỉ Developer đổi được; về `sheet` khi hàng đợi chưa rỗng → 409; `tenant/session` không chứa nháp và `details` khớp `invoice_lines`.
- [ ] **Step 2–4: FAIL → code → PASS** (Express: `npm run lint` ở gốc). **Step 5: Commit** `feat: source-of-truth switch and Worker-backed tenant session`

### Task 8: Frontend gửi tới Worker khi công tắc `worker`

**Files:** Modify `src/lib/api.ts`, `src/services/authService.ts`, `src/lib/zaloAuth.ts`, `src/context/AppContext.tsx`, `src/components/PaymentModal.tsx`

**Interfaces — Consumes:** Task 6, 7.
- `api.ts`: tải `GET /api/source` một lần khi khởi động (lưu bộ nhớ, thử lại khi lỗi; lỗi → coi như `sheet`); khi `worker`, thêm vào tập gửi Worker: `/api/sheets/tenant-data`, `/api/admin/rooms`, `/api/admin/room-detail`, `/api/admin/config`, `/api/admin/accounts`, `/api/admin/accounts/status`, `/api/admin/accounts/delete`, `/api/profile/update`, `/api/auth/register`.
- `zaloAuth.ts`/`authService.loginWithZalo`: khi `worker`, gọi Worker `/api/auth/zalo`, lưu token Worker, rồi gọi Express `/api/auth/worker-session` như luồng mật khẩu.
- Gộp sửa tháng cố định `10/2026` từ nhánh `fix-payment-current-month` (commit `f8b3b81`).

- [ ] **Step 1:** `npm run lint` sạch. **Step 2:** chạy local (`npm run dev:local`), Playwright: đặt công tắc `worker` ở D1 local, đăng nhập cư dân seed bằng mật khẩu → trang thanh toán có hoá đơn tháng hiện tại từ Worker; công tắc `sheet` → hành vi cũ. Ảnh chụp vào scratchpad. **Step 3: Commit** `feat: frontend follows the source-of-truth switch`

### Task 9: Trang admin — cài đặt phí, nhập điện nước, mở thu

**Files:** Create `src/components/admin/FeeSettings.tsx`, `src/components/admin/MonthBilling.tsx`; Modify `src/components/AdminPortal.tsx`

**Interfaces — Consumes:** Task 5.
- "Cài đặt phí" (khi `worker`): điện, nước (đơn giá); danh sách dịch vụ thêm/sửa/xoá/tắt, mỗi dịch vụ: tên, giá, tính theo (Mỗi phòng/Mỗi người/Mỗi xe), tối đa (chỉ với Mỗi người); không hiện `actual_electric_price`.
- Tab tháng: mỗi phòng một dòng có ô số điện mới, số nước mới, tổng, nhãn `Nháp`/`Chưa đóng`/`Đã đóng`, "dư X đ" nếu có; phòng đã đóng khoá ô nhập; nút "Mở thu tiền tháng N" → nếu `missingMeters` không rỗng, hộp xác nhận liệt kê phòng thiếu và nút "Vẫn mở".
- Khi công tắc `sheet`: giữ nguyên giao diện hiện tại.

- [ ] **Step 1:** `npm run lint` sạch. **Step 2:** Playwright local ở công tắc `worker`: nhập số cho một phòng → tổng đổi; mở thu khi còn phòng thiếu → hộp xác nhận; ảnh 390 px và 1280 px vào scratchpad. **Step 3: Commit** `feat: admin fee settings, meter entry and month issuing on Worker`

## GIAI ĐOẠN 5 — Sheet một chiều và đưa lên

### Task 10: Xuất Sheet một chiều, tắt đọc Sheet

**Files:** Create `cloudflare/src/sheetExport.ts`; Modify `cloudflare/src/cron.ts`, `cloudflare/src/sheetSync.ts`, `cloudflare/src/routes/storage.ts`, `cloudflare/src/billing/invoices.ts`, `cloudflare/src/routes/admin.ts`; Test `cloudflare/test/sheet-export.test.ts`

**Interfaces — Produces:**
- `enqueueExport(db: D1Database, kind: 'meters' | 'payment' | 'config' | 'register_account' | 'update_profile' | 'update_account_status' | 'delete_resident', payload: Record<string, unknown>): Promise<void>` — chỉ với căn có Sheet (`legacySheet(db).houses`) và chỉ khi công tắc `worker`.
- `drainExportQueue(env: Env): Promise<{ sent: number; failed: number }>` — gọi Apps Script đúng action hiện có (`update_meters`, `update_payment`, `update_config`, `register_account`, `update_profile`, `update_account_status`, `delete_resident`; tham số như `google_apps_script.js` và các chỗ Express đang gọi); lỗi → `attempts+1`, `last_error`; dừng thử ở 5 lần.
- Gọi `enqueueExport` sau: nhập điện nước, đổi trạng thái thanh toán, đổi đơn giá, đăng ký/sửa hồ sơ/duyệt/xoá cư dân.
- Khi `worker`: `syncLegacySheets` và `ensureMonthFresh` không chạy (trả ngay); cron 10 phút gọi `drainExportQueue`.
- `GET /api/dev/storage` thêm `exportQueue: { pending: number; failed: { id: number; kind: string; lastError: string }[] }` và `source`.
- Chuyển công tắc về `sheet`: cron đọc Sheet chạy lại (giá trị Sheet đã nhận từ hàng đợi).

- [ ] **Step 1: Test**: ở `worker`, nhập số → có dòng hàng đợi `meters`; `drainExportQueue` với `fetchMock` 200 → `done_at`; 500 liên tục → `attempts = 5`, ngừng thử, hiện trong `/api/dev/storage` (Review Focus 5) và việc ghi hoá đơn không bị ảnh hưởng; ở `worker` không có lần tải CSV nào của Sheet; ở `sheet` mọi thứ như cũ.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): one-way Sheet export queue, Sheet reads off in worker mode`

### Task 11: Review và đưa lên (công tắc `sheet`)

- [ ] **Step 1:** Review toàn nhánh (một reviewer cho cả nhánh), sửa phát hiện quan trọng, `npm test` + lint sạch.
- [ ] **Step 2 (đã được đồng ý "triển khai deploy"):** sao lưu D1 (`wrangler d1 export --remote`), áp migration 0022, deploy Worker; gộp vào `main` để Render build Express/frontend. Kiểm tra: `GET /api/source` = `sheet`; đăng nhập cư dân/chủ trọ như cũ; Task 3 Step 6 chạy trên bản thật.
- [ ] **Step 3:** Ghi vào runbook (`docs/cloudflare-per-landlord-runbook.md`) mục "Bật Worker là nguồn chính": thêm `ZALO_APP_SECRET` vào Worker, chạy kiểm chứng, đặt `source = worker`, theo dõi hàng đợi xuất; cách quay lại. **Không** bật `worker` khi chưa có người dùng đồng ý.
