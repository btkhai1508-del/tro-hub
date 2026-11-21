# Nút Lưu và cập nhật ngay ở chế độ Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi nút Lưu / công tắc của trang admin chạy đúng với Cloudflare Worker (đang là nguồn chính), báo lỗi rõ ràng, và màn hình phản ánh thay đổi ngay (≤ 1–2 giây) thay vì chờ vòng làm mới 8 giây.

**Architecture:** Backend bổ sung đúng những chỗ còn thiếu (houseId cho trạng thái thu tiền, cổng thanh toán gộp nhiều căn, sửa thông tin cư dân và tiền phòng/cọc từ màn chi tiết phòng). Frontend: mỗi lần lưu đều chờ kết quả, áp dữ liệu trả về ngay, tải lại đúng phần liên quan, chặn vòng làm mới đè dữ liệu mới bằng một "write guard" dùng chung, bỏ đường lưu cũ sang Express/Apps Script khi ở chế độ worker.

**Tech Stack:** Worker: Hono 4, D1 + Durable Object per-landlord stores, vitest + @cloudflare/vitest-plugin (`describe.each(BACKENDS)`). Frontend: React 19 + Vite + Tailwind, `src/lib/api.ts` (apiFetch/workerFetch). Pure frontend helpers tested with `node --import tsx --test` (tsx already installed; no new dependency).

**Spec:** `.superpowers/sdd/2026-11-19-worker-source-of-truth/task-17-report.md` (chẩn đoán RC1–RC7, bảng 26 thao tác, số đo). Global rules: `.superpowers/sdd/2026-11-19-worker-source-of-truth/global-constraints.md`.

## Global Constraints

- Production đang chạy `source_of_truth = 'worker'`; chế độ `sheet` phải giữ nguyên hành vi y như hiện tại (mọi thay đổi frontend nằm sau `getSource() === 'worker'` hoặc chỉ đi qua route Worker).
- Không đổi công thức tính tiền (`cloudflare/src/billing/compute.ts`), không đổi quy tắc khoá hoá đơn: hoá đơn đã đóng (`paid`/`cash`) bị khoá; hoá đơn đã phát hành của tháng trước bị đóng băng.
- Tiền là số nguyên đồng, `0 ≤ x ≤ 100.000.000` cho tiền phòng và cọc.
- Mọi route mới: chỉ staff (owner = Admin Tổng, manager = Admin căn) của đúng căn chứa phòng/cư dân; cư dân và người lạ: 403/401. Developer theo quy tắc hiện có.
- Mọi lỗi trả `{ success:false, code, error }` tiếng Việt qua `fail()`; frontend luôn hiện `error` của server, không bao giờ nuốt lỗi im lặng.
- Static test `cloudflare/test/no-direct-tenant-access.test.ts` phải xanh (không dùng `env.DB` cho bảng của kho chủ trọ).
- Laundry, Hợp đồng/CT01, Kỳ kê khai vẫn ở Express (ngoài phạm vi).
- Lệnh kiểm tra cuối mỗi task: `cd cloudflare && npm test && npx tsc --noEmit && npx tsc --noEmit -p test`; root `npm run lint`; `npm run test:lib` (từ Task 3). Nếu chạy `npm run build` thì `git checkout app-config.json` sau đó.
- Không chạm production, không chạy wrangler `--remote`, không in/commit secret. Trailers commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` và `Claude-Session: https://claude.ai/code/session_01WeBCFaspeV6Mz4AppeonRD`.

## Review Focus

1. Hai căn của cùng một chủ trọ có phòng trùng tên (ví dụ cả hai có "101"): mọi lần lưu từ màn admin phải gửi `houseId` và lưu đúng căn, không 404, không lưu nhầm căn kia. → test trong Task 1 và Task 2, kiểm tra tay trong Task 4.
2. Vòng làm mới chạy đúng lúc vừa bấm Lưu: phản hồi đọc cũ không được đè giá trị vừa lưu; phản hồi đọc mới hơn (thay đổi từ máy khác) phải hiện trong ≤ 1 vòng. → test writeGuard trong Task 3, kiểm tra trong Task 5.
3. Sửa tiền phòng / cọc khi hoá đơn tháng này đã đóng: giá mới vẫn được lưu nhưng hoá đơn đã đóng không đổi một đồng; màn hình nói rõ "áp dụng từ tháng sau". → test trong Task 2, Task 4.
4. Kiểm tra nguồn (`/api/source`) bị timeout: thao tác ghi không được âm thầm rơi về Express; nếu Express trả `SOURCE_CHANGED` thì tự gửi lại sang Worker một lần. → test trong Task 3.
5. Số điện thoại nhập có khoảng trắng, `+84`, 9 chữ số, 11 chữ số: frontend hiển thị đúng số sẽ lưu theo cùng quy tắc với `cloudflare/src/password.ts normalizePhone`, chặn số không hợp lệ trước khi gửi. → test trong Task 3, dùng trong Task 8.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `cloudflare/src/routes/rent.ts` | `payment-status` nhận `houseId`; `payment-gate` GET gộp mọi căn |
| `cloudflare/src/routes/source.ts` | Cache `/api/source` ngắn lại |
| `cloudflare/src/routes/admin.ts` | room-detail trả thêm `occupants` + `roomPrice/roomDeposit`; route sửa cư dân & tiền phòng |
| `cloudflare/src/routes/notifications.ts` | Nhận mọi căn staff quản lý làm đích thông báo |
| `cloudflare/test/admin-edit.test.ts` (mới) | Test route sửa cư dân / tiền phòng |
| `cloudflare/test/rent.test.ts`, `source-session.test.ts` | Test houseId, gate gộp, cache |
| `src/lib/phone.ts` (mới) | Chuẩn hoá & kiểm tra số điện thoại phía frontend |
| `src/lib/writeGuard.ts` (mới) | Chặn phản hồi đọc cũ đè dữ liệu vừa ghi |
| `src/lib/__tests__/*.test.ts` (mới) | Test node:test cho hai file trên và cho apiFetch retry |
| `src/lib/api.ts` | Xử lý `SOURCE_CHANGED` trong apiFetch; thử lại kiểm tra nguồn |
| `src/components/AdminPortal.tsx` | Lưu chi tiết phòng, công tắc thu tiền, cổng thanh toán, làm mới, form tạo tài khoản |
| `src/components/admin/MonthBilling.tsx`, `FeeSettings.tsx` | Nút Lưu từng dòng, báo AdminPortal tải lại |
| `src/context/AppContext.tsx` | Không chạy vòng làm mới của cư dân cho staff; gate nhận ngay lần đầu |
| `src/components/Profile.tsx`, `DeveloperPortal.tsx`, `LoginPage.tsx` | Hiện lỗi thật của server; gợi ý số điện thoại |

---

### Task 1: Backend — trạng thái thu tiền theo căn, cổng thanh toán gộp nhiều căn, cache nguồn

**Files:**
- Modify: `cloudflare/src/routes/rent.ts:339-374`, `cloudflare/src/routes/source.ts:40`
- Test: `cloudflare/test/rent.test.ts`, `cloudflare/test/source-session.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/payment-status` body `{ roomNumber: string, status, month?, houseId?: string }` — có `houseId` thì tìm phòng bằng `findRoom`-style lookup trong đúng căn (tên phòng hoặc mã cũ), căn phải thuộc staff (403 `HOUSE_FORBIDDEN` nếu không); không có thì giữ hành vi cũ.
- Produces: `GET /api/admin/payment-gate?month=` → `{ success, month, value: 'START'|'STOP', houses: Record<houseId,'START'|'STOP'>, mixed: boolean }` với `value = 'START'` chỉ khi mọi căn START. `POST` trả cùng shape (sau khi ghi).
- Produces: `GET /api/source` header `Cache-Control: public, max-age=5`.

- [ ] **Step 1: Write failing tests** (trong `describe.each(BACKENDS)` của rent.test.ts):
  - `payment-status with houseId picks the room of that house when two houses share the name` — seed thêm phòng trùng tên ở căn thứ hai của cùng chủ trọ; gọi với `houseId` căn 2 → hoá đơn căn 2 `paid`, căn 1 vẫn `unpaid`; không có `houseId` → 404 `ROOM_NOT_FOUND` (giữ hành vi cũ).
  - `payment-status rejects a houseId the staff does not manage` → 403.
  - `payment-gate GET aggregates all houses` — owner 2 căn, `issue-month` chỉ căn 1 → `{ value:'STOP', mixed:true, houses:{[h1]:'START',[h2]:'STOP'} }`; POST START → `{ value:'START', mixed:false }`.
  - source-session: `GET /api/source` có `Cache-Control` = `public, max-age=5`.
- [ ] **Step 2: Run** `cd cloudflare && npx vitest run test/rent.test.ts test/source-session.test.ts` — Expected: các test mới FAIL.
- [ ] **Step 3: Implement** trong rent.ts (dùng lại `staffHouseIds`, `tenantFor`, `gateFor`, `storesOf`), source.ts header.
- [ ] **Step 4: Run** lại — PASS; rồi toàn bộ `npm test`, hai lệnh tsc.
- [ ] **Step 5: Commit** `fix(worker): payment-status by house, aggregated payment gate, short source cache`

---

### Task 2: Backend — sửa cư dân, tiền phòng/cọc theo phòng và giá chung của căn

**Files:**
- Create: `cloudflare/migrations/0026_room_money_defaults.sql`
- Modify: `cloudflare/src/routes/admin.ts` (`loadRooms` ~100-145, `detailOf` ~151, `readConfig`/`saveConfig` ~340-415, thêm 2 route), `cloudflare/src/tenant/schema.ts`, `cloudflare/src/routes/houses.ts` (tạo phòng)
- Test: `cloudflare/test/admin-edit.test.ts` (mới)

**Interfaces:**
- Produces: `GET/POST /api/admin/room-detail` và `GET /api/admin/rooms` mỗi dòng thêm `occupants: { residentId: number; name: string; phone: string; plate: string; vehicleType: string; cccdLast4: string }[]` (tối đa 3, cùng thứ tự với `nguoi1..3`), `roomPrice: number`, `roomDeposit: number` (lấy từ `rooms.price`, `rooms.deposit`). Các trường cũ giữ nguyên.
- Produces: `PATCH /api/admin/residents/:residentId` body `{ houseId: string, fullName?, phone?, cccd?, plateNumber?, vehicleType? }` → `{ success, message, data: <detailOf row của phòng cư dân đó cho tháng hiện tại> }`. Quy tắc kiểm tra giống `/api/profile/update` (tenant.ts:262) và tạo cư dân (people.ts:118): chuẩn hoá SĐT bằng `normalizePhone`, 10 số bắt đầu 0, không trùng trong `resident_index` (409 `PHONE_TAKEN`), CCCD 12 số mã hoá bằng `CCCD_KEY` + `cccd_hash` không trùng (409 `CCCD_TAKEN`); cập nhật `resident_index` khi đổi SĐT; ghi `audit` `resident_edit_by_staff`; `enqueueExport(db,'update_profile',…)` như profile update khi ở chế độ worker.
- Produces: migration `cloudflare/migrations/0026_room_money_defaults.sql` + phần tử migration tương ứng trong `cloudflare/src/tenant/schema.ts` (hai nơi phải giống nhau; công cụ xuất/nhập/băm kho phải biết cột mới): `houses.default_room_price INTEGER` (NULL = chưa đặt), `houses.default_deposit INTEGER` (NULL), `rooms.price_custom INTEGER NOT NULL DEFAULT 1`, `rooms.deposit_custom INTEGER NOT NULL DEFAULT 1` (phòng hiện có giữ giá riêng đang có).
- Produces: `PATCH /api/admin/rooms/:roomId` body `{ houseId: string, price?: number, deposit?: number, useDefaultPrice?: boolean, useDefaultDeposit?: boolean }` → `{ success, message, appliesFrom: 'this_month' | 'next_month', data: <detailOf row> }`. Số nguyên 0..100.000.000 (400 `MONEY_INVALID`). Gửi `price` → lưu `rooms.price`, `price_custom = 1`; `useDefaultPrice` → `price = houses.default_room_price`, `price_custom = 0` (400 `NO_DEFAULT_PRICE` khi căn chưa có giá chung); tương tự cho cọc. **Đổi giá lúc nào cũng được**: luôn lưu vào phòng; nếu hoá đơn tháng hiện tại (và nháp tháng sau, nếu có) chưa khoá thì `recompute` → `appliesFrom: 'this_month'`; nếu hoá đơn tháng này đã đóng/khoá thì không đụng hoá đơn đó, trả `appliesFrom: 'next_month'` và câu "Đã lưu giá mới, áp dụng từ hoá đơn tháng sau vì tháng này đã đóng." Ghi `audit` `room_money_edit`.
- Produces: `GET /api/admin/config?houseId&month` trả thêm `defaultRoomPrice: number|null`, `defaultDeposit: number|null`; `PUT/POST /api/admin/config` nhận thêm `defaultRoomPrice?`, `defaultDeposit?`, `applyToAllRooms?: boolean` (mức căn, không theo tháng): lưu giá chung, rồi cập nhật mọi phòng `price_custom = 0` (và mọi phòng nếu `applyToAllRooms`, đặt `price_custom = 0`) cùng quy tắc recompute như trên. Phòng tạo mới (`POST /api/dev/houses/:id/rooms`, tạo căn) khi không truyền giá → lấy giá chung, `*_custom = 0`.
- Dòng phòng (`/api/admin/rooms`, room-detail) thêm `priceCustom: boolean`, `depositCustom: boolean`.
- Cả hai route: chỉ staff của đúng căn (`houseId` phải nằm trong `staffHouseIds`, phòng/cư dân phải thuộc căn đó), 403 cho cư dân, 401 ẩn danh.

- [ ] **Step 1: Write failing tests** (`describe.each(BACKENDS)`):
  - `room detail lists occupants with residentId and room money`.
  - `staff edits a resident's name, phone, plate` → GET lại thấy giá trị mới; `resident_index` có SĐT mới, không còn SĐT cũ.
  - `phone already used by another resident → 409 PHONE_TAKEN`, `cccd taken → 409 CCCD_TAKEN`, `9-digit phone is stored with a leading 0`.
  - `manager of another house → 403; resident → 403; anonymous → 401`.
  - `editing rent recomputes the open current-month invoice total` (tổng mới = tổng cũ − giá cũ + giá mới).
  - `editing rent when this month's invoice is paid saves the room price, leaves the paid invoice untouched, returns appliesFrom next_month`.
  - `house default rent applies to rooms without a custom price and recomputes their open invoices; custom rooms keep their price; applyToAllRooms resets every room`.
  - `useDefaultPrice without a house default → 400 NO_DEFAULT_PRICE`; `migration 0026 keeps existing room prices (custom = 1)` on both backends.
  - `same room name in two houses: houseId decides which room changes`.
- [ ] **Step 2: Run** `cd cloudflare && npx vitest run test/admin-edit.test.ts` — FAIL.
- [ ] **Step 3: Implement** trong admin.ts; dùng lại helper sẵn có (`normalizePhone`, mã hoá CCCD ở chỗ profile update đang dùng, `recompute`/`assertEditable`/`InvoiceLockedError` từ `billing/invoices.ts`, `enqueueExport` từ `sheetExport.ts`, `refreshCounts` nếu cần). Không sao chép logic kiểm tra: nếu profile update có hàm kiểm tra cục bộ, tách ra hàm dùng chung trong cùng file nguồn rồi gọi từ cả hai chỗ.
- [ ] **Step 4: Run** test mới PASS, toàn bộ `npm test`, tsc ×2.
- [ ] **Step 5: Commit** `feat(worker): staff edit of residents and room rent/deposit from room detail`

---

### Task 3: Frontend lib — số điện thoại, write guard, apiFetch không rơi về Express

**Files:**
- Create: `src/lib/phone.ts`, `src/lib/writeGuard.ts`, `src/lib/__tests__/phone.test.ts`, `src/lib/__tests__/writeGuard.test.ts`, `src/lib/__tests__/apiSource.test.ts`
- Modify: `src/lib/api.ts:56-173`, `package.json` (script `"test:lib": "node --import tsx --test src/lib/__tests__/*.test.ts"`)

**Interfaces:**
- Produces: `normalizeVnPhone(input: string): string` — đúng quy tắc `cloudflare/src/password.ts normalizePhone` (bỏ ký tự không phải số; `84` + 9 số → `0` + 9 số; đúng 9 số → thêm `0`).
- Produces: `phoneProblem(input: string): string | null` — `null` khi kết quả chuẩn hoá là 10 số bắt đầu bằng `0`; ngược lại câu tiếng Việt `'Số điện thoại phải có 10 chữ số, bắt đầu bằng 0.'`.
- Produces: `createWriteGuard(): { beginRead(): number; acceptRead(ticket: number): boolean; beginWrite(): void; endWrite(): void }` — `acceptRead` trả `false` nếu có lần ghi bắt đầu hoặc kết thúc sau khi lần đọc đó bắt đầu, hoặc nếu một lần đọc mới hơn đã được nhận (đọc mới nhất thắng).
- Produces: trong `api.ts`, `apiFetch` khi nhận 409 `SOURCE_CHANGED` từ Express: gọi `resetSource()` rồi gửi lại **một lần** sang Worker nếu đường dẫn thuộc `WORKER_SOURCE_ROUTES`; `ensureSource()` khi có Worker token và lần kiểm tra lỗi/timeout: thử lại tối đa 2 lần (cách 1s) trước khi trả `'sheet'`.

- [ ] **Step 1: Write failing tests** (node:test + `assert/strict`):
  - phone: `'912345678'→'0912345678'`, `'+84 912 345 678'→'0912345678'`, `'84912345678'→'0912345678'`, `'0912345678'` giữ nguyên; `phoneProblem('12345')` và `phoneProblem('091234567890')` ra câu lỗi; `phoneProblem('0912 345 678')` → `null`.
  - writeGuard: đọc A bắt đầu → ghi bắt đầu → A kết thúc: `acceptRead(A)===false`; đọc B bắt đầu sau `endWrite` → `true`; hai đọc chồng nhau, đọc mới nhận trước → đọc cũ `false`.
  - apiSource: mock `fetch`/`localStorage` toàn cục; Express trả 409 `{code:'SOURCE_CHANGED'}` cho `POST /api/admin/room-detail` → apiFetch gửi lại tới `WORKER_API_URL` đúng 1 lần và trả response của Worker; `/api/source` timeout lần 1, thành công lần 2 → `ensureSource()` trả `'worker'`.
- [ ] **Step 2: Run** `npm run test:lib` — FAIL.
- [ ] **Step 3: Implement** ba thay đổi (api.ts chỉ sửa đúng các hàm nêu trên; chế độ sheet không đổi).
- [ ] **Step 4: Run** `npm run test:lib` PASS; `npm run lint` sạch.
- [ ] **Step 5: Commit** `feat(frontend): phone helper, write guard, apiFetch retries on SOURCE_CHANGED`

---

### Task 4: Frontend — nút "Lưu cập nhật phòng & chỉ số" và công tắc thu tiền

**Files:**
- Modify: `src/components/AdminPortal.tsx` (`openRoomDetail ~927`, `updateRoomPaymentStatus ~1100-1160`, room-detail form ~2030-2451, Thu tiền switches ~2484 và bảng)

**Interfaces:**
- Consumes: Task 1 (`houseId` cho payment-status), Task 2 (`occupants`, `roomPrice`, `roomDeposit`, `PATCH /api/admin/residents/:id`, `PATCH /api/admin/rooms/:id`), Task 3 (`createWriteGuard`).
- Produces: hàm `applyRoomUpdate(row: RoomRow)` trong AdminPortal cập nhật cùng lúc `currentRoomData`, dòng tương ứng trong `roomsList` và `billingList` (khớp theo `houseId` + `roomId`).

- [ ] **Step 1: Repro trước khi sửa** — chạy script có sẵn `scratchpad/audit/*.cjs` (room-detail) trên `npm run dev:local` chế độ worker: ghi lại `POST /api/admin/room-detail → 400 COMBINED_EDIT` và không có toast.
- [ ] **Step 2: Implement (chỉ nhánh `workerMode`)**:
  - Mở chi tiết phòng gửi `houseId` (dòng danh sách đã có).
  - "Lưu" gửi tuần tự, chỉ phần đã đổi: (1) chỉ số → `POST /api/admin/room-detail {month, houseId, room, data:{dienCu?,dienMoi?,nuocCu?,nuocMoi?}}` (không gửi `paymentStatus`, không gửi `row`); (2) mỗi cư dân đã đổi → `PATCH /api/admin/residents/:residentId`; (3) tiền phòng/cọc đã đổi → `PATCH /api/admin/rooms/:roomId` (cạnh ô có nhãn "Giá riêng"/"Giá chung" và nút "Dùng giá chung"; hiện câu `message` server trả khi `appliesFrom = 'next_month'`). Mỗi bước chờ kết quả; lỗi dừng lại, hiện `error` của server bằng toast, khôi phục giá trị của phần lỗi, giữ phần đã lưu. Thành công: `applyRoomUpdate(data)` + toast "Đã lưu".
  - Rác / net / xe trên màn chi tiết: chỉ đọc ở chế độ worker, kèm dòng "Đổi giá ở Cài đặt phí; bỏ dịch vụ cho phòng ở mục Dịch vụ của phòng" (không có ghi đè từng hoá đơn — xem Quyết định ở cuối plan).
  - Công tắc "Trạng thái thu tiền" (chi tiết phòng + Thu tiền tháng): `await` `POST /api/admin/payment-status {roomNumber, status, month, houseId}`; lỗi → khôi phục + toast lỗi server; thành công → cập nhật dòng; dùng writeGuard cho rooms/billing để vòng 8 giây không đè.
  - Bỏ `pushUpdateToGoogleSheet` khi `getSource() === 'worker'` (Worker đã tự ghi Sheet).
  - Ước tính tiền khi đang gõ dùng đơn giá thật của tháng từ `GET /api/admin/config?houseId&month` (không dùng mặc định 3500/20000 của `unitConfig`, ~353-359).
  - `workerMode` ban đầu: hiện trạng thái "Đang tải…" cho tới khi `ensureSource()` trả lời, không vẽ tạm các form kiểu cũ (Express) trong lúc chờ (~187).
  - `saveConfig` / `saveBatchMeters` kiểu cũ (~1030-1098, chỉ dùng ở chế độ sheet): hiện lỗi thật thay vì báo "đã lưu" khi request thất bại.
- [ ] **Step 3: Verify (Playwright, local, worker mode)**: sửa chỉ số + tên cư dân + tiền phòng → một lần bấm Lưu, toast "Đã lưu", danh sách Phòng & Khách và Thu tiền đổi ngay không reload; hoá đơn đã đóng + đổi tiền phòng → lưu được, toast "áp dụng từ tháng sau", tổng hoá đơn đã đóng không đổi; nút "Dùng giá chung" trả phòng về giá chung; bật/tắt "đã đóng" → đổi ngay, không bị lật lại sau 10 giây. Ảnh `fix4-*.png` vào scratchpad.
- [ ] **Step 4: Run** `npm run lint`, `npm run test:lib`.
- [ ] **Step 5: Commit** `fix(admin): room detail save and payment switch work on the Worker`

---

### Task 5: Frontend — cổng thanh toán phản ánh ngay và đúng nhiều căn

**Files:**
- Modify: `src/components/AdminPortal.tsx` (`lastGateToggleTimeRef` ~321, `loadPaymentGateStatus`/`togglePaymentGate` ~709-750, công tắc sidebar ~1511 và dock ~4396), `src/context/AppContext.tsx:562-578`

**Interfaces:**
- Consumes: Task 1 (`houses`, `mixed`), Task 3 (`createWriteGuard`).

- [ ] **Step 1: Implement**: bỏ cửa sổ 20 giây, dùng một writeGuard cho gate; toggle chờ kết quả POST và áp `value` trả về; khi `mixed` hiện nhãn "Một số căn đang mở thu" và bấm công tắc sẽ đặt cùng giá trị cho tất cả căn (hỏi xác nhận một câu); chỉ tải gate khi đổi tháng và theo vòng làm mới, không tải thêm mỗi lần đổi tab. AppContext ở chế độ worker nhận ngay câu trả lời gate đầu tiên (không cần hai lần trùng).
- [ ] **Step 2: Verify (Playwright)**: bật/tắt trên máy A → hiện ngay; đổi từ máy B → máy A thấy trong ≤ 1 vòng làm mới (≤ 8 s, trước đây 21 s); owner 2 căn sau "Mở thu tiền" một căn → hiện trạng thái hỗn hợp. Ảnh `fix5-*.png`.
- [ ] **Step 3: Run** `npm run lint`, `npm run test:lib`.
- [ ] **Step 4: Commit** `fix(admin): payment gate reflects at once and handles several houses`

---

### Task 6: Frontend — nút Lưu cho Điện nước và Cài đặt phí báo tải lại

**Files:**
- Modify: `src/components/admin/MonthBilling.tsx:60-151`, `src/components/admin/FeeSettings.tsx:63`, `src/components/AdminPortal.tsx:2745`

**Interfaces:**
- Produces: `MonthBilling` prop `onChanged?: () => void`; `FeeSettings` prop `onSaved?: () => void`. AdminPortal truyền hàm tải lại `roomsList`/`billingList`/dashboard của tháng đang xem.

- [ ] **Step 1: Implement**: mỗi dòng có thay đổi chưa lưu hiện nút **"Lưu"** (và Enter) — vẫn lưu khi rời ô như trước; sau khi lưu hiện dấu "Đã lưu ✓" 2 giây; không gửi trùng khi một lần lưu cùng dữ liệu đang chạy; lỗi hiện `error` của server ngay dưới dòng và giữ giá trị người dùng nhập. Gọi `onChanged`/`onSaved` sau mỗi lần lưu thành công. Bỏ câu "chạm ra ngoài ô để lưu". FeeSettings thêm hai ô **Tiền phòng chung** và **Tiền cọc chung** (mức căn, dùng Task 2) cùng ô chọn "Áp dụng cho tất cả phòng (kể cả phòng đang có giá riêng)"; Rác/Net/Xe vẫn sửa ở đây (giá chung theo tháng) — màn chi tiết phòng chỉ hiển thị.
- [ ] **Step 2: Verify (Playwright 390px & 1280px)**: nhập số mới → nút Lưu hiện → bấm → "Đã lưu ✓", tab Thu tiền đổi tổng ngay. Ảnh `fix6-*.png`.
- [ ] **Step 3: Run** `npm run lint`.
- [ ] **Step 4: Commit** `fix(admin): visible Save for meter rows, refresh lists after fee and meter saves`

---

### Task 7: Frontend — bớt chậm: bỏ vòng gọi thừa và chỉ làm mới phần đang xem

**Files:**
- Modify: `src/components/AdminPortal.tsx` (`fetchWorkerRooms ~826-837`, `loadTabContent ~753-841`, vòng làm mới ~610-622), `src/context/AppContext.tsx:597-605`

- [ ] **Step 1: Đo trước** bằng `scratchpad/audit/repro2.cjs` (RTT giả lập 150 ms): ghi thời gian từng tab và số request trong 17 giây đứng yên ở tab Phòng & Khách (mốc hiện tại: 470/560/909 ms; 22 request).
- [ ] **Step 2: Implement**: nhớ danh sách căn trong phiên (chỉ tải lại khi đăng nhập lại hoặc khi danh sách rỗng); tải phòng của mọi căn song song trong một bước; tab Tổng quan không tải lại danh sách phòng nếu vừa có; vòng làm mới 8 s chỉ tải dữ liệu của tab đang mở; AppContext không chạy vòng tenant-data / payment status / gate 5 s cho tài khoản staff ở chế độ worker; sau mỗi lần lưu chỉ tải lại tài nguyên bị ảnh hưởng; giữ debounce đổi tháng nhưng ≤ 150 ms.
- [ ] **Step 3: Đo sau**: Phòng & Khách còn 1 vòng gọi nối tiếp; đứng yên 17 s ≤ 8 request; không tab nào chậm hơn trước. Ghi số đo trước/sau vào report của task.
- [ ] **Step 4: Run** `npm run lint`.
- [ ] **Step 5: Commit** `perf(admin): fewer round trips, poll only the visible tab, no resident polls for staff`

---

### Task 8: Số điện thoại, lỗi hồ sơ, thông báo cho mọi căn

**Files:**
- Modify: `src/components/AdminPortal.tsx` (form tạo tài khoản ~4060-4115; form thông báo ~225-270, ~3200-3300), `src/lib/workerAccounts.ts:43-68`, `src/components/LoginPage.tsx:340`, `src/components/DeveloperPortal.tsx` (form chủ trọ ~902, ~1033), `src/components/Profile.tsx:120-137`, `cloudflare/src/routes/notifications.ts:89-130`
- Test: `cloudflare/test/` (file test thông báo hiện có hoặc `notifications.test.ts`)

**Interfaces:**
- Consumes: Task 3 (`normalizeVnPhone`, `phoneProblem`).
- Produces: `POST /api/admin/notifications` nhận `target` là bất kỳ `houseId` staff quản lý (giữ `LVC`/`TRUNG_KIM`/`ALL` như cũ) và `customRooms` dạng `{ houseId, room }[]` bên cạnh mã cũ; căn ngoài quyền → 403.

- [ ] **Step 1: Write failing Worker test**: `notification to a non-legacy house id the staff manages is created`; `custom rooms with houseId reach only that house's room`; `target house of another landlord → 403`.
- [ ] **Step 2: Run** — FAIL; **Step 3: Implement** route; PASS; `npm test`, tsc ×2.
- [ ] **Step 4: Implement frontend**: dưới mọi ô số điện thoại tạo/sửa tài khoản hiện "Số sẽ lưu: 0xxxxxxxxx" (từ `normalizeVnPhone`) và chặn gửi khi `phoneProblem` khác null; thông báo thành công dùng số server trả/đã chuẩn hoá; Profile hiện `error` của server (ví dụ `PHONE_LOCKED`, `CCCD_TAKEN`); danh sách đích thông báo lấy từ `/api/houses` (giữ `ALL`).
- [ ] **Step 5: Verify (Playwright)**: nhập `912345678` → thấy "Số sẽ lưu: 0912345678"; nhập `12345` → nút tạo bị chặn với câu lỗi; tạo thông báo cho một căn không phải LVC/TRUNG_KIM → thành công. `npm run lint`, `npm run test:lib`.
- [ ] **Step 6: Commit** `fix: phone hint everywhere, real profile errors, notifications for any house`

---

### Task 9: Backend — 5 ngày cuối tháng mở sẵn tháng sau cho chủ trọ chuẩn bị

**Files:**
- Modify: `cloudflare/src/cron.ts` (`createMonthlyDrafts`, catch-up 10 phút), `cloudflare/src/billing/invoices.ts` (`issueMonth`), `cloudflare/src/routes/admin.ts` (`/api/admin/months`, `issue-month`, `config` editable), `cloudflare/src/sheetExport.ts` (`drainExportQueue`)
- Create: helper `cloudflare/src/billing/period.ts`
- Test: `cloudflare/test/month-prep.test.ts` (mới)

**Interfaces:**
- Produces: `prepMonth(nowMs: number): string | null` trong `billing/period.ts` — giờ Việt Nam (UTC+7); trả tháng kế tiếp `'YYYY-MM'` khi ngày hiện tại nằm trong **5 ngày cuối tháng** (ngày ≥ số ngày của tháng − 4, ví dụ 27–31/12, 26–30/11, 24–28/02 năm thường, 25–29/02 năm nhuận), ngược lại `null`. `adminDefaultMonth(nowMs): string` = `prepMonth ?? tháng hiện tại`.
- Cron (17:00 UTC = 00:00 VN và catch-up 10 phút): ngoài tháng hiện tại, khi `prepMonth` khác null thì tạo bản phí sao chép (`feeConfigFor`) và hoá đơn **nháp** cho tháng kế tiếp (idempotent, đánh dấu riêng `settings.month_prepared = 'YYYY-MM'`, cùng quy tắc chỉ chạy khi nguồn là `worker`). Chỉ số cũ tháng sau vẫn suy ra từ chỉ số mới tháng này (nhập muộn vẫn đúng).
- `GET /api/admin/months` trả thêm `defaultMonth` (= `adminDefaultMonth`) và luôn có tháng chuẩn bị trong danh sách.
- `POST /api/admin/issue-month` cho tháng chưa tới (tháng > tháng hiện tại theo lịch VN) → 409 `MONTH_NOT_STARTED` "Tháng 12/2026 mở thu được từ 01/12/2026." Cư dân không thấy hoá đơn tháng sau (nháp vốn ẩn với cư dân — giữ nguyên).
- `drainExportQueue`: dòng của tháng chưa tới **không** bị thử và không tăng `attempts` cho tới ngày 1 của tháng đó (tab Sheet tháng mới do AutoSheet.gs tạo lúc 00:00 ngày 1).

- [ ] **Step 1: Write failing tests**: `prepMonth` các mốc (26/11 00:00 VN → '2026-12'; 25/11 23:59 VN → null; 27/12 → '2027-01'; 24/02/2027 → '2027-03'; 25/02/2028 → '2028-03'; 24/02/2028 → null); cron ngày 26/11 tạo nháp 12/2026 cho mọi phòng có cư dân, chạy lại không ghi thêm; nháp tháng 12 không hiện với cư dân (`/api/tenant/session`, `/api/payment/status`); `issue-month` tháng 12 vào ngày 28/11 → 409, vào 01/12 → 200; nhập chỉ số mới tháng 11 sau khi đã có nháp tháng 12 → chỉ số cũ tháng 12 đổi theo; dòng xuất Sheet tháng 12 ngày 28/11 giữ `attempts = 0`, ngày 01/12 được gửi; chế độ `sheet` không tạo gì. `describe.each(BACKENDS)`.
- [ ] **Step 2: Run** `cd cloudflare && npx vitest run test/month-prep.test.ts` — FAIL.
- [ ] **Step 3: Implement**; dùng lại `createDrafts`, `feeConfigFor`, cờ `month_started` hiện có làm mẫu.
- [ ] **Step 4: Run** test mới + toàn bộ `npm test`, tsc ×2 — PASS.
- [ ] **Step 5: Commit** `feat(worker): last 5 days of a month prepare next month's drafts for the landlord`

---

### Task 10: Frontend — admin tự chuyển sang tháng chuẩn bị

**Files:**
- Modify: `src/components/AdminPortal.tsx` (chọn tháng mặc định, `loadTabContent` months), `src/components/admin/MonthBilling.tsx` (nút "Mở thu tiền tháng N")

**Interfaces:**
- Consumes: Task 9 (`defaultMonth`, 409 `MONTH_NOT_STARTED`).

- [ ] **Step 1: Implement (chỉ chế độ worker)**: khi mở trang admin, tháng chọn mặc định = `defaultMonth` server trả (5 ngày cuối tháng → tháng sau); có dải thông báo "Đang chuẩn bị hoá đơn tháng 12/2026 — cư dân chưa thấy cho tới khi mở thu"; vẫn chọn lại được tháng hiện tại. Nút "Mở thu tiền tháng N" cho tháng chưa tới bị khoá, ghi "Mở được từ 01/MM/YYYY" (vẫn xử lý 409 nếu đồng hồ máy lệch).
- [ ] **Step 2: Verify (Playwright, giả lập ngày bằng cách đặt đồng hồ trình duyệt và cron local)**: ngày 27 → mặc định tháng sau, nhập điện nước được, nút mở thu khoá; tài khoản cư dân không thấy hoá đơn tháng sau. Ảnh `fix10-*.png`.
- [ ] **Step 3: Run** `npm run lint`.
- [ ] **Step 4: Commit** `feat(admin): open next month for preparation in the last 5 days`

---

### Task 11: Kiểm tra toàn nhánh, chạy thử đầu-cuối, đưa lên

- [ ] **Step 1:** Review toàn nhánh (một reviewer), sửa phát hiện quan trọng; `cd cloudflare && npm test`, tsc ×2, `npm run lint`, `npm run test:lib` sạch.
- [ ] **Step 2:** Playwright đầu-cuối trên `npm run dev:local` chế độ worker, mỗi thao tác phản ánh ≤ 2 giây không reload: tạo/khoá/xoá tài khoản; giá chung + giá riêng phòng; tháng chuẩn bị; sửa chi tiết phòng (chỉ số + cư dân + tiền phòng); nhập điện nước; lưu cài đặt phí; bật/tắt cổng thanh toán; đánh dấu đã đóng/chưa đóng; tạo thông báo; sửa hồ sơ cư dân. Khôi phục công tắc local về `sheet` sau khi thử.
- [ ] **Step 3 (chờ người dùng đồng ý "deploy"):** sao lưu D1 (`wrangler d1 export --remote`), áp migration 0026 rồi deploy Worker ngay sau đó, push `main` để Render build; kiểm tra `GET /api/source` = `worker`, các route mới trả 401 khi không đăng nhập.

---

## Quyết định đã chốt (người dùng, 21/11/2026)

1. Rác / net / xe: sửa ở phần chung (Cài đặt phí theo tháng); màn chi tiết phòng chỉ hiển thị.
2. Tiền phòng và cọc sửa được theo từng phòng, mặc định lấy **tiền phòng chung / tiền cọc chung** của căn.
3. Giá phòng đổi lúc nào cũng được; hoá đơn đã đóng không bị đổi, giá mới áp dụng từ hoá đơn kế tiếp.
4. 5 ngày cuối tháng: trang admin chuyển sang tháng kế tiếp để chủ trọ chuẩn bị (nháp, nhập chỉ số); cư dân chưa có hoá đơn tháng đó cho tới khi tháng bắt đầu và chủ trọ mở thu.
