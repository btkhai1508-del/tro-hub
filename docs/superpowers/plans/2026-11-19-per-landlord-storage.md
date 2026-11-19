# Kho dữ liệu riêng cho từng chủ trọ — Kế hoạch thực hiện

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển các bảng nghiệp vụ của mỗi chủ trọ sang một Durable Object SQLite riêng (`TenantStore`), D1 `tro-hub` thành DB trung tâm, chuyển dữ liệu thật từng chủ trọ một, có đối chiếu và quay lại được.

**Architecture:** D1 trung tâm giữ tài khoản staff, danh bạ căn (`house_directory`), định tuyến cư dân (`resident_index`), công tắc lưu trữ (`tenant_storage`), thu phí dịch vụ, SePay. Mỗi chủ trọ một `TenantStore` tên `owner:<id>` chứa 9 bảng nghiệp vụ, cùng cột với D1. Code truy cập kho qua adapter `TenantDb` có giao diện giống D1, nên cùng một câu SQL chạy trên backend `d1` (bảng cũ) lẫn `do` (kho mới); công tắc từng chủ trọ chọn backend.

**Tech Stack:** Cloudflare Workers, Hono 4, D1, Durable Objects SQLite (`cloudflare:workers`), TypeScript, Vitest 4.1 + `@cloudflare/vitest-plugin` 1.5.1, wrangler 4.157.

**Spec:** `docs/superpowers/specs/2026-11-19-per-landlord-storage-design.md`

## Global Constraints

- Đường dẫn API và hình dạng JSON trả về **không đổi**; frontend chỉ đổi ở Task 15 (tab Lưu trữ trên trang Developer).
- 9 bảng kho chủ trọ (`houses, house_rates, rooms, residents, invoices, meter_readings, payments, payment_gates, notifications`) có **cột, khoá, ràng buộc UNIQUE, chỉ mục giống hệt D1** (trừ khoá ngoại sang `staff`).
- Tên kho: `owner:<staff.id>`; kho chạy thử: `dryrun:owner:<staff.id>`; luôn lấy stub với `{ locationHint: 'apac' }`.
- Công tắc `tenant_storage.backend ∈ {'d1','migrating','do'}`; khoá tự hết hạn sau **10 phút** (`lock_expires_at`).
- Khi `migrating`: đọc từ D1; ghi trả **503** `{ success:false, errorCode:'TENANT_MIGRATING', error:'Đang nâng cấp dữ liệu, thử lại sau ít phút.' }`.
- **Bắt buộc:** tiền SePay về đủ cho một hoá đơn → cư dân (`/api/payment/status`) và chủ trọ/quản lý (`/api/admin/billing`, `/api/admin/dashboard`, `/api/houses/:id/invoices`, cùng trang admin tự làm mới 8 giây) đều thấy "Đã đóng" ở cả `d1` / `migrating` / `do`. 4 API này **luôn** cộng tiền `deferred` chưa ghi vào hoá đơn (không chỉ khi `migrating`), để không có khoảng trống khi khoá hết hạn hoặc chờ xử lý lại.
- API chỉ đọc không bao giờ trả 503 vì khoá ghi: đồng bộ Sheet bên trong API đọc (`ensureMonthFresh`) bỏ qua khi kho đang chỉ đọc.
- Review sau mỗi giai đoạn bằng skill `code-review` mức **high** trên diff của giai đoạn; Task 3 (adapter, định tuyến) và Task 12–13 (chuyển dữ liệu) mức **xhigh** (spec §9.1; mức `max` chỉ khi bạn yêu cầu).
- Thứ tự ghi hai nơi (spec §6): tạo cư dân → `resident_index` trước, kho sau, kho lỗi thì xoá dòng index; sửa/xoá cư dân → kho trước, index sau; căn → `house_directory` trước, kho sau, rồi cập nhật bộ đếm.
- Chép dữ liệu: 200 dòng/lần, giữ nguyên id/khoá chính; mỗi câu SQL ≤ 100 tham số (chèn từng dòng trong `transactionSync`).
- Dữ liệu D1 cũ **không bị xoá** trong kế hoạch này.
- Gói Workers **Free**; **không** dùng R2.
- Mỗi commit: `npm test` (thư mục `cloudflare/`) xanh, `npx tsc --noEmit` và `npx tsc --noEmit -p test` sạch; commit kèm dòng attribution của phiên.

## Review Focus

1. **Cư dân đang đăng nhập bằng token cũ (không có `tid`)** khi chủ trọ của họ vừa chuyển sang `do` → phiên vẫn dùng được, không bị đá ra. → test trong Task 5.
2. **Khoá hết hạn (10 phút) khi còn sự kiện SePay `deferred`** → trạng thái tự về `d1`; trong lúc chờ xử lý lại, cư dân và chủ trọ vẫn thấy "Đã đóng"; sau đó tiền được cộng vào D1 đúng một lần. → test trong Task 13.
3. **Bấm "Chuyển" hai lần liên tiếp cho cùng chủ trọ** → lần hai bị từ chối 409, không chép trùng. → test trong Task 13.
4. **SePay gửi lại đúng giao dịch đã `deferred` sau khi đã bật `do`** → bỏ qua vì trùng, hoá đơn chỉ được cộng một lần. → test trong Task 13.
5. **Số điện thoại đã thuộc staff được dùng tạo cư dân (hoặc ngược lại)** sau khi cư dân sang kho riêng → vẫn báo "Số điện thoại này đã có tài khoản". → test trong Task 7.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `cloudflare/migrations/0019_central_directory.sql` | Bảng trung tâm mới + điền dữ liệu từ bảng hiện có |
| `cloudflare/src/app.ts` | `Env`, `App`, `Viewer`, `fail`, `audit`, `actorOf`, `isOwner`, `isDeveloper`, `canAccessHouse`, `requireHouse`, `staffOnly`, `ownerOnly`, `developerOnly` (tách từ `index.ts`) |
| `cloudflare/src/central/directory.ts` | Danh bạ căn, định tuyến cư dân, mã căn, bộ đếm, công tắc lưu trữ |
| `cloudflare/src/central/deferred.ts` | Tiền về bị hoãn và trạng thái hoá đơn "hiệu lực" |
| `cloudflare/src/payments/settle.ts` | `settleRent`, `deferRent`, `replayDeferred`, `replayPendingDeferred` (dùng chung cho webhook, chuyển dữ liệu, cron) |
| `cloudflare/src/tenant/schema.ts` | DDL kho, danh sách migration theo phiên bản, `TENANT_TABLES` |
| `cloudflare/src/tenant/store.ts` | `class TenantStore extends DurableObject` |
| `cloudflare/src/tenant/db.ts` | Adapter `TenantDb` cho kho, bọc chặn ghi khi khoá |
| `cloudflare/src/tenant/route.ts` | `tenantStub`, `tenantOfOwner`, `tenantFor`, `TenantLockedError` |
| `cloudflare/src/migrate/digest.ts` | Băm chuẩn hoá các dòng |
| `cloudflare/src/migrate/tenant.ts` | Chạy thử, chuyển, quay lại |
| `cloudflare/src/routes/{auth,houses,integrations,people,rent,sepay,billing,notifications,storage}.ts` | API theo khu vực, mỗi file `export function register<Tên>(app: Hono<App>): void` |
| `src/components/AdminPortal.tsx` | Vòng làm mới 8 giây tải lại cả tab Thu tiền / Tổng quan (Task 8) |
| `cloudflare/src/cron.ts` | Chép Sheet, xoá căn hết hạn, đối soát hằng đêm |
| `cloudflare/src/index.ts` | Chỉ còn tạo app, gắn middleware, gọi các `register*`, `export default { fetch, scheduled }`, `export { TenantStore }` |
| `cloudflare/scripts/migrate-tenant.mts` | CLI gọi API chuyển dữ liệu và in báo cáo |
| `cloudflare/test/helpers.ts` | Dữ liệu mẫu cho cả hai backend, đăng nhập, gọi API |
| `docs/cloudflare-per-landlord-runbook.md` | Quy trình đưa lên |

## Ánh xạ với lộ trình trong spec (§10)

| GĐ spec | Task | Ghi chú |
|---|---|---|
| 1. Nền móng | 1–4 | |
| 2. Port API, tách `index.ts` | 6, 7, 8, 11 | |
| 3. Đăng nhập `tid`, webhook + `deferred`, cron, bộ đếm | 5, 9, 10 | Đăng nhập (Task 5) làm trước Task 6–8 vì test cư dân ở backend `do` cần nó |
| 4. Chuyển dữ liệu | 12, 13, 14 | |
| 5. Xuất dữ liệu, đối soát, mức sử dụng | 15 (+ đối soát ở Task 10) | |
| 6. Review, đưa lên | 16 | |

---

## GIAI ĐOẠN 1 — Nền móng (không đổi hành vi)

### Task 1: Bảng trung tâm và danh bạ

**Files:**
- Create: `cloudflare/migrations/0019_central_directory.sql`, `cloudflare/src/central/directory.ts`
- Test: `cloudflare/test/directory.test.ts`

**Interfaces:**
- Produces (`central/directory.ts`):
  - `type Backend = 'd1' | 'migrating' | 'do'`
  - `interface HouseDir { house_id: string; owner_id: number; name: string; status: string; delete_after: string | null; pay_no: number | null; modules: string | null; room_count: number; resident_count: number }`
  - `houseOwner(db: D1Database, houseId: string): Promise<number | null>`
  - `ownerHouses(db: D1Database, ownerId: number): Promise<HouseDir[]>`
  - `allHouses(db: D1Database): Promise<HouseDir[]>`
  - `upsertHouseDir(db: D1Database, row: Omit<HouseDir, 'room_count' | 'resident_count'>): Promise<void>`
  - `removeHouseDir(db: D1Database, houseId: string): Promise<void>`
  - `allocateHousePayNo(db: D1Database): Promise<number>` — dùng/tăng `settings.house_pay_seq`, không bao giờ cấp lại số cũ
  - `setHouseCounts(db: D1Database, houseId: string, counts: { rooms: number; residents: number }): Promise<void>`
  - `phoneTaken(db: D1Database, phone: string, except?: { staffId?: number; residentId?: number }): Promise<boolean>` — xét `staff.phone` và `resident_index.phone`
  - `reserveResident(db: D1Database, input: { phone: string | null; ownerId: number; houseId: string }): Promise<number>` — chèn `resident_index`, trả id; số trùng ném `PhoneTakenError`
  - `releaseResident(db: D1Database, residentId: number): Promise<void>`
  - `residentRoute(db: D1Database, by: { id: number } | { phone: string }): Promise<{ resident_id: number; owner_id: number; house_id: string } | null>`
  - `updateResidentIndex(db: D1Database, residentId: number, patch: { phone?: string | null; houseId?: string }): Promise<void>`
  - `getStorage(db: D1Database, ownerId: number, now?: number): Promise<{ backend: Backend; lockExpiresAt: number | null; migratedAt: string | null }>` — khoá đã hết hạn thì đổi về `d1` bằng một câu `UPDATE … WHERE backend='migrating' AND lock_expires_at < ?` rồi trả `d1`; chủ trọ chưa có dòng → `d1`
  - `newOwnerBackend(db: D1Database): Promise<'d1' | 'do'>` — đọc `settings.new_owner_backend`, mặc định `'d1'`
  - `setStorage(db: D1Database, ownerId: number, backend: Backend, opts?: { expect?: Backend; lockMinutes?: number; note?: string }): Promise<boolean>` — có `expect` thì chỉ đổi khi giá trị hiện tại khớp (trả `false` nếu không khớp)
  - `class PhoneTakenError extends Error`

- [ ] **Step 1: Viết migration `0019_central_directory.sql`**

Tạo: `house_directory(house_id TEXT PK, owner_id INTEGER NOT NULL, name, status, delete_after, pay_no INTEGER UNIQUE, modules, room_count INTEGER NOT NULL DEFAULT 0, resident_count INTEGER NOT NULL DEFAULT 0)`; `resident_index(resident_id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, owner_id INTEGER NOT NULL, house_id TEXT NOT NULL)`; `tenant_storage(owner_id INTEGER PK, backend TEXT NOT NULL CHECK (backend IN ('d1','migrating','do')), lock_expires_at INTEGER, changed_at TEXT, migrated_at TEXT, note TEXT)`; `unassigned_payments(id INTEGER PK AUTOINCREMENT, sepay_id TEXT UNIQUE, amount INTEGER NOT NULL, content TEXT, account_no TEXT, bank_name TEXT, reference TEXT, paid_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`; `ALTER TABLE sepay_events ADD COLUMN status TEXT NOT NULL DEFAULT 'done'`; `CREATE INDEX sepay_events_deferred ON sepay_events(house_id, month) WHERE status = 'deferred'` (API trạng thái hỏi chỉ mục này mỗi lần, gần như không đọc dòng nào); `ALTER TABLE audit_log ADD COLUMN owner_id INTEGER`. Phần điền dữ liệu đặt giữa hai dòng `-- backfill:start` / `-- backfill:end`: `house_directory` từ `houses` (+ đếm phòng chưa xoá, cư dân `approved` chưa xoá), `resident_index` từ `residents` giữ nguyên id (owner lấy qua `houses.owner_id`), `tenant_storage` một dòng `d1` cho mỗi `staff.role='owner'`, `settings.house_pay_seq` = `MAX(houses.pay_no)`.

- [ ] **Step 2: Viết test `directory.test.ts`**

```ts
it('backfill khớp bảng gốc', ...)            // xoá 3 bảng mới, seed staff/houses/rooms/residents, chạy đoạn SQL giữa hai dấu backfill (đọc từ TEST_MIGRATIONS) → houseOwner('LVC') === 1, resident_index có đúng id cư dân, room_count đúng
it('mã căn không cấp lại', async () => { const a = await allocateHousePayNo(DB); await removeHouseDir(DB, 'X'); expect(await allocateHousePayNo(DB)).toBe(a + 1); });
it('reserveResident chặn số trùng staff', async () => { await expect(reserveResident(DB, { phone: '0902371800', ownerId: 1, houseId: 'LVC' })).rejects.toBeInstanceOf(PhoneTakenError); });
it('setStorage có expect là CAS', async () => { expect(await setStorage(DB, 1, 'migrating', { expect: 'd1' })).toBe(true); expect(await setStorage(DB, 1, 'migrating', { expect: 'd1' })).toBe(false); });
it('khoá hết hạn tự về d1', async () => { await setStorage(DB, 1, 'migrating', { lockMinutes: 10 }); expect((await getStorage(DB, 1, Date.now() + 11 * 60_000)).backend).toBe('d1'); });
```

- [ ] **Step 3: Chạy test, thấy FAIL** — `npx vitest run test/directory.test.ts` → lỗi import `../src/central/directory.ts`.
- [ ] **Step 4: Viết `central/directory.ts`** theo Interfaces.
- [ ] **Step 5: Chạy `npm test`, thấy PASS** (cả `isolation.test.ts` cũ).
- [ ] **Step 6: Commit** — `feat(worker): central directory tables and helpers (0019)`

### Task 2: `TenantStore` và lược đồ kho

**Files:**
- Create: `cloudflare/src/tenant/schema.ts`, `cloudflare/src/tenant/store.ts`
- Modify: `cloudflare/wrangler.toml` (binding `TENANT`, `[exports.TenantStore] type="durable-object" storage="sqlite"`), `cloudflare/src/index.ts` (`export { TenantStore } from './tenant/store.ts'`, thêm `TENANT: DurableObjectNamespace<TenantStore>` vào `Env`)
- Test: `cloudflare/test/tenant-store.test.ts`

**Interfaces:**
- Produces (`tenant/schema.ts`):
  - `type SqlValue = string | number | null`
  - `interface TenantTable { name: string; pk: string[] }`
  - `const TENANT_TABLES: readonly TenantTable[]` — đúng thứ tự chép: houses `['id']`, house_rates `['house_id']`, rooms `['id']`, residents `['id']`, invoices `['id']`, meter_readings `['id']`, payments `['id']`, payment_gates `['house_id','month']`, notifications `['id']`
  - `const TENANT_MIGRATIONS: readonly string[]` — phần tử `i` đưa lược đồ lên phiên bản `i + 1`; phần tử 0 là DDL đầy đủ 9 bảng + bảng `meta(key TEXT PRIMARY KEY, value TEXT)`
- Produces (`tenant/store.ts`, `class TenantStore extends DurableObject<Env>`):
  - `interface SqlOp { sql: string; params: SqlValue[]; mode: 'all' | 'first' | 'run' }`
  - `interface SqlResult { results: Record<string, SqlValue>[]; changes: number; lastRowId: number }`
  - `query(ops: SqlOp[], atomic: boolean): Promise<SqlResult[]>` — `atomic` chạy trong `ctx.storage.transactionSync`; lệnh ghi cập nhật `meta.last_write_at`
  - `importRows(table: string, rows: Record<string, SqlValue>[]): Promise<number>`
  - `exportTable(table: string, offset: number, limit: number): Promise<Record<string, SqlValue>[]>` — xếp theo `pk`
  - `digest(table: string): Promise<{ count: number; sha256: string }>` (dùng `digestRows`, Task 12; tạm ném `Error('not implemented')` cho tới Task 12)
  - `info(): Promise<{ ownerId: number | null; schemaVersion: number; lastWriteAt: number | null; migratedFrom: string | null; migratedAt: number | null; sizeBytes: number; rowsWrittenToday: number }>` — `sizeBytes` = `ctx.storage.sql.databaseSize`; `rowsWrittenToday` cộng dồn `cursor.rowsWritten` của các lệnh ghi trong ngày UTC (khoá meta `writes_today` = `YYYY-MM-DD:n`, ghi cùng lúc với `last_write_at`)
  - `setMeta(key: string, value: string | null): Promise<void>`
  - `reset(): Promise<void>` — xoá dữ liệu mọi bảng trong `TENANT_TABLES` và `sqlite_sequence`, xoá meta `last_write_at`, `migrated_from`, `migrated_at`; giữ lược đồ, `schema_version`, `owner_id`

- [ ] **Step 1: Lấy DDL gốc** — `npx wrangler d1 execute tro-hub --local --command "SELECT sql FROM sqlite_master WHERE tbl_name IN ('houses','house_rates','rooms','residents','invoices','meter_readings','payments','payment_gates','notifications') AND sql IS NOT NULL"`; dán vào `TENANT_MIGRATIONS[0]`, bỏ `REFERENCES staff(id)`.
- [ ] **Step 2: Viết test**

```ts
it('lược đồ kho giống D1', async () => {
  for (const t of TENANT_TABLES) expect(await doColumns(t.name)).toEqual(await d1Columns(t.name)); // PRAGMA table_info: name,type,notnull,dflt_value,pk
  expect(await doIndexes()).toEqual(await d1Indexes());                                            // PRAGMA index_list + index_info, bỏ tên tự sinh
});
it('migration chạy một lần, phiên bản tăng', ...)   // runInDurableObject: info().schemaVersion === TENANT_MIGRATIONS.length; gọi lại không lỗi
it('query atomic quay lui khi một lệnh lỗi', ...)   // hai INSERT rooms trùng (house_id,name) atomic → bảng không đổi
it('reset xoá dữ liệu, giữ lược đồ', ...)
it('ghi cập nhật last_write_at và rowsWrittenToday, đọc thì không', ...)
```

- [ ] **Step 3: Chạy test, thấy FAIL.**
- [ ] **Step 4: Viết `schema.ts` và `store.ts`** — migration chạy trong `ctx.blockConcurrencyWhile` ở constructor theo `meta.schema_version`.
- [ ] **Step 5: Chạy `npm test`, thấy PASS.** Nếu khai báo `exports` không chạy ở local (vitest/wrangler dev) thì đổi sang `[[migrations]] tag="v1" new_sqlite_classes=["TenantStore"]` và ghi lý do vào commit (spec §11).
- [ ] **Step 6: `npx wrangler deploy --dry-run` thành công.**
- [ ] **Step 7: Commit** — `feat(worker): TenantStore durable object with tenant schema`

### Task 3: Adapter `TenantDb` và định tuyến

**Files:**
- Create: `cloudflare/src/tenant/db.ts`, `cloudflare/src/tenant/route.ts`, `cloudflare/src/app.ts`
- Modify: `cloudflare/src/index.ts` (chuyển các khai báo dùng chung sang `app.ts`; `app.onError` ánh xạ `TenantLockedError` → 503 theo Global Constraints)
- Test: `cloudflare/test/tenant-db.test.ts`

**Interfaces:**
- Consumes: `getStorage`, `houseOwner` (Task 1); `TenantStore.query` (Task 2).
- Produces (`tenant/db.ts`):
  - `interface TenantStatement { bind(...values: SqlValue[]): TenantStatement; first<T = Record<string, SqlValue>>(column?: string): Promise<T | null>; all<T = Record<string, SqlValue>>(): Promise<{ results: T[]; meta: { changes: number; last_row_id: number } }>; run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> }`
  - `interface TenantDb { prepare(sql: string): TenantStatement; batch(statements: TenantStatement[]): Promise<{ results: Record<string, SqlValue>[]; meta: { changes: number; last_row_id: number } }[]> }` — `D1Database` thoả kiểu này
  - `remoteTenantDb(stub: DurableObjectStub<TenantStore>): TenantDb` — `batch` gửi một `query(ops, true)`
  - `readOnlyDb(db: TenantDb): TenantDb` — câu SQL bắt đầu bằng `INSERT|UPDATE|DELETE|REPLACE` (bỏ khoảng trắng/chú thích đầu) ném `TenantLockedError`
  - `isReadOnly(db: TenantDb): boolean` — `true` với đối tượng do `readOnlyDb` tạo
- Produces (`tenant/route.ts`):
  - `class TenantLockedError extends Error`
  - `tenantStub(env: Env, ownerId: number, opts?: { dryRun?: boolean }): DurableObjectStub<TenantStore>` — tên `owner:<id>` / `dryrun:owner:<id>`, `locationHint: 'apac'`
  - `tenantOfOwner(env: Env, ownerId: number): Promise<TenantDb>` — `d1` → `env.DB`; `migrating` → `readOnlyDb(env.DB)`; `do` → `remoteTenantDb(tenantStub(...))`
  - `tenantFor(c: Context<App>, houseId: string): Promise<TenantDb>` — 404 `HOUSE_NOT_FOUND` nếu không có trong danh bạ; 403 `HOUSE_FORBIDDEN` nếu `!canAccessHouse`

- [ ] **Step 1: Viết test** — cùng một bộ kiểm tra chạy trên `env.DB` và trên `remoteTenantDb(stub)`:

```ts
describe.each(['d1', 'do'])('adapter %s', (backend) => {
  it('first/all/run trả cùng dạng như D1', ...)        // INSERT rooms → run().meta.changes === 1, last_row_id > 0; first('name') trả chuỗi
  it('RETURNING trả dòng vừa chèn', ...)
  it('batch là nguyên tử', ...)                        // lệnh thứ hai vi phạm UNIQUE → lệnh thứ nhất bị quay lui
  it('lỗi UNIQUE có message chứa "UNIQUE constraint failed"', ...)
});
it('readOnlyDb chặn ghi, cho đọc', ...)
it('tenantOfOwner theo công tắc', ...)                 // setStorage(1,'do') → ghi vào kho, env.DB không đổi
it('ghi khi migrating trả 503 TENANT_MIGRATING', ...)  // qua SELF.fetch một API ghi sau khi Task 6 xong: đánh dấu it.todo tới Task 6
```

- [ ] **Step 2: Chạy test, thấy FAIL.**
- [ ] **Step 3: Viết `app.ts`, `db.ts`, `route.ts`.**
- [ ] **Step 4: Chạy `npm test`, thấy PASS.**
- [ ] **Step 5: Commit** — `feat(worker): D1-compatible TenantDb adapter and tenant routing`

### Task 4: Bộ dữ liệu mẫu cho hai backend

**Files:**
- Create: `cloudflare/test/helpers.ts`
- Modify: `cloudflare/test/isolation.test.ts` (dùng helpers, vẫn chạy `d1`)

**Interfaces:**
- Consumes: Task 1–3.
- Produces (`test/helpers.ts`):
  - `const BACKENDS = ['d1', 'do'] as const; type BackendName = typeof BACKENDS[number]`
  - `const PHONES = { developer: '0918338863', owner: '0902371800', otherOwner: '0911111111', manager: '0900000001', residentTk: '0900000101', residentLvc: '0900000201' }`
  - `seedWorld(backend: BackendName): Promise<void>` — staff, staff_houses, house_directory, resident_index ở trung tâm; houses/rooms/residents/invoices tháng `2026-11` (phòng 101 LVC tổng 3.500.000 đ) ghi qua `tenantOfOwner(env, 1)` sau khi `setStorage(1, backend)`; chủ trọ 4 có căn `NTTD` 2 phòng
  - `login(phone: string): Promise<string>` · `api(path: string, init?: RequestInit, token?: string): Promise<Response>`

- [ ] **Step 1: Viết helpers và sửa `isolation.test.ts`** dùng `seedWorld('d1')`.
- [ ] **Step 2: Chạy `npm test`, thấy PASS** (7 test cách ly vẫn xanh).
- [ ] **Step 3: Commit** — `test(worker): shared seed for d1 and do backends`

---

## GIAI ĐOẠN 2 — Chuyển các API sang `TenantDb`

Mỗi task: chuyển route sang `routes/<khu vực>.ts`, thay mọi truy cập 9 bảng kho bằng `tenantFor`/`tenantOfOwner`, giữ nguyên SQL và JSON trả về; test khu vực chạy `describe.each(BACKENDS)` trên `seedWorld(backend)`.

### Task 5: Đăng nhập và phiên

**Files:** Create `cloudflare/src/routes/auth.ts`; Modify `cloudflare/src/token.ts`, `cloudflare/src/index.ts` (`loadViewer`, `requireAuth`); Test `cloudflare/test/auth.test.ts`

**Interfaces:**
- Produces: `TokenPayload` thêm `tid?: number`; `signToken(sub, kind, secret, tid?: number)`; `registerAuth(app)` (login, `/api/me`, change-password).
- Cư dân: đăng nhập tra `residentRoute(DB, { phone })` → `tenantOfOwner` → câu SQL `residents` hiện có; token cư dân có `tid = owner_id`. `loadViewer` cư dân: `tid` có thì dùng, không thì `residentRoute(DB, { id: sub })`.

- [ ] **Step 1: Viết test** (cả hai backend):

```ts
it('cư dân đăng nhập, /api/me trả houseId/roomName đúng', ...)
it('token cư dân không có tid vẫn dùng được', ...)            // ký token bằng signToken(sub,'resident',secret) không tid → /api/me 200
it('đổi mật khẩu cư dân: phiên cũ 401, token mới 200', ...)
it('staff đăng nhập không đổi', ...)
```

- [ ] **Step 2: FAIL → Step 3: viết code → Step 4: `npm test` PASS → Step 5: Commit** `refactor(worker): auth and sessions through tenant routing`

### Task 6: Căn và phòng

**Files:** Create `cloudflare/src/routes/houses.ts`, `cloudflare/src/routes/integrations.ts` (`/api/banks`, `/api/google/*`: chỉ chuyển chỗ, không đổi, toàn bảng trung tâm); Test `cloudflare/test/houses.test.ts`

**Phạm vi route:** `GET /api/houses`, `POST /api/houses`, `GET /api/modules` (đọc `house_directory.modules`), `GET|PATCH /api/houses/:houseId`, `PUT /api/houses/:houseId/rates`, `GET /api/houses/:houseId/rooms`, `GET|PUT /api/houses/:houseId/payment-portal`, `GET /api/dev/modules`, `PUT /api/dev/modules/:key`, `POST /api/dev/landlords/:id/houses`, `GET|PATCH /api/dev/houses/:houseId`, `POST|PATCH|DELETE /api/dev/houses/:houseId/rooms[/:roomId]`, `POST /api/dev/houses/:houseId/delete|restore`, `GET /api/dev/houses/:houseId/backup`.

**Interfaces:**
- Consumes: `upsertHouseDir`, `allocateHousePayNo`, `setHouseCounts`, `ownerHouses`, `allHouses` (Task 1).
- Danh sách căn của staff: owner/manager từ `staff_houses`, Developer từ `allHouses`. `assignPayNumbers` tách: số căn ở `house_directory` (trung tâm), số phòng ở kho.
- Mọi thao tác thêm/xoá phòng gọi `setHouseCounts` sau khi ghi kho.

- [ ] **Step 1: Viết test** (cả hai backend): tạo căn mới qua Developer → có trong `house_directory` với `pay_no` mới và trong kho; thêm/xoá phòng → `room_count` đổi; `GET /api/houses/LVC/rooms` giống nhau giữa hai backend (so JSON); chuyển `it.todo` 503 của Task 3 thành test thật: `setStorage(1,'migrating')` → `PATCH /api/houses/LVC` trả 503 `TENANT_MIGRATING`, `GET /api/houses/LVC` vẫn 200.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `refactor(worker): houses and rooms through tenant routing`

### Task 7: Cư dân, staff, chủ trọ

**Files:** Create `cloudflare/src/routes/people.ts`; Test `cloudflare/test/people.test.ts`

**Phạm vi route:** `POST /api/houses/:houseId/residents`, `GET|POST /api/staff`, `PATCH /api/staff/:id`, `GET|POST /api/dev/landlords`, `PATCH /api/dev/landlords/:id`, `POST /api/dev/landlords/:id/reset-password|delete`.

**Interfaces:** Consumes `reserveResident`, `releaseResident`, `updateResidentIndex`, `phoneTaken`, `setHouseCounts`, `newOwnerBackend`, `setStorage`. Tạo cư dân: `reserveResident` → `INSERT INTO residents (id, …)` với id đó → lỗi thì `releaseResident`. Danh sách chủ trọ đọc `house_directory` (bộ đếm), không gọi kho. Tạo chủ trọ: chèn dòng `tenant_storage` với `newOwnerBackend(DB)` — sau khi đưa lên xong (Task 16) chủ trọ mới vào thẳng kho riêng, không cần chuyển, không cần deploy.

- [ ] **Step 1: Viết test** (cả hai backend):

```ts
it('tạo cư dân: id từ resident_index, có trong kho', ...)
it('kho lỗi thì không để lại dòng resident_index', ...)       // INSERT trùng phòng/ràng buộc → resident_index không có số đó
it('số điện thoại của staff không tạo được cư dân', ...)      // Review Focus 5 → 400 PHONE_TAKEN
it('số của cư dân (đã sang kho) không tạo được chủ trọ', ...) // Review Focus 5 → 400 PHONE_TAKEN
it('danh sách chủ trọ có room_count/resident_count đúng', ...)
it('new_owner_backend=do: chủ trọ mới tạo căn → dữ liệu chỉ nằm trong kho owner:<id>, D1 không có dòng', ...)
```

- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `refactor(worker): residents, staff and landlords through tenant routing`

### Task 8: Tiền trọ, hoá đơn, cổng thanh toán

**Files:** Create `cloudflare/src/routes/rent.ts`, `cloudflare/src/central/deferred.ts`; Modify `cloudflare/src/sheetSync.ts`, `src/components/AdminPortal.tsx`; Test `cloudflare/test/rent.test.ts`

**Phạm vi route:** `GET /api/houses/:houseId/invoices`, `GET /api/houses/:houseId/payments`, `GET /api/payment/status`, `POST /api/payment/mark-paid`, `GET /api/payment/gate`, `GET /api/admin/months|dashboard|billing|payment-gate`, `POST /api/admin/payment-status|payment-gate`.

**Interfaces:**
- Produces (`central/deferred.ts`):
  - `type InvoiceStatus = 'unpaid' | 'pending' | 'paid' | 'cash'`
  - `deferredByRoom(db: D1Database, houseId: string, month: string): Promise<Map<string, number>>` — tên phòng → tổng `sepay_events.amount` có `status='deferred' AND kind='rent'`; thường là Map rỗng
  - `effectiveStatus(status: InvoiceStatus, total: number, bankReceived: number, deferred: number): InvoiceStatus` — `paid|cash` giữ nguyên; `bankReceived + deferred >= total` → `'paid'`; còn lại giữ nguyên
- 4 API trạng thái (Global Constraints) luôn gọi `deferredByRoom`; chỉ phòng có `deferred > 0` mới đọc thêm tổng `payments` (`method='bank'`) để tính `bankReceived`.
- `sheetSync.ts`: `syncMonthFromSheet(central: D1Database, tenant: TenantDb, month: string): Promise<SyncResult>`; `ensureMonthFresh(central: D1Database, tenant: TenantDb, month: string, maxAgeMs?: number): Promise<SyncResult | null>` — `isReadOnly(tenant)` thì trả `null` ngay, không tải Sheet. `invoiceOrSync(tenant, central, roomId, month)` theo đó.
- Tiền về thiếu: cả hai phía thấy "Chưa đóng" như hôm nay (API hiện không trả số đã nhận; hiện "còn thiếu bao nhiêu" cần đổi giao diện, ngoài phạm vi spec §1).
- `AdminPortal.tsx`: vòng `setInterval` 8 giây hiện có gọi thêm `loadTabContent` lặng lẽ (không bật `isLoading`, không xoá lỗi) khi đang ở tab `billing` hoặc `dashboard`, để chủ trọ thấy "Đã đóng" mà không phải tải lại trang.

- [ ] **Step 1: Viết test** (cả hai backend + một nhóm `migrating`):

```ts
it('effectiveStatus', () => { expect(effectiveStatus('unpaid', 3_500_000, 0, 3_500_000)).toBe('paid'); expect(effectiveStatus('unpaid', 3_500_000, 1_500_000, 2_000_000)).toBe('paid'); expect(effectiveStatus('unpaid', 3_500_000, 0, 2_000)).toBe('unpaid'); expect(effectiveStatus('cash', 1, 0, 0)).toBe('cash'); });
it('deferred đủ tiền: cư dân và chủ trọ đều thấy Đã đóng', ...) // ở d1, migrating, do: chèn sepay_events deferred 3.500.000 cho LVC/101/2026-11 → /api/payment/status (cư dân LVC) paymentStatus 'paid'; /api/admin/billing, /api/admin/dashboard, /api/houses/LVC/invoices (chủ trọ và quản lý) phòng 101 'paid'
it('deferred thiếu: cả hai thấy chưa đóng', ...)
it('migrating: API đọc trả 200, không tải Sheet, không ghi', ...) // fetchMock không có lời gọi CSV; /api/admin/dashboard và /api/admin/billing 200
it('JSON hoá đơn giống nhau giữa hai backend', ...)
```

- [ ] **Step 2: Chạy test, thấy FAIL.**
- [ ] **Step 3: Viết code** theo Interfaces (Worker và `AdminPortal.tsx`).
- [ ] **Step 4: `npm test` PASS; `npx tsc --noEmit` ở gốc repo sạch; chạy local (`npm run dev:local`), mở tab Thu tiền, gửi một webhook giả đủ tiền vào Worker local → phòng đổi "Đã đóng" trong ≤ 8 giây mà không tải lại trang.**
- [ ] **Step 5: Commit** `refactor(worker): rent and payment status through tenant routing`

### Task 9: SePay webhook, khoản tiền chưa gắn, phí dịch vụ

**Files:** Create `cloudflare/src/routes/sepay.ts`, `cloudflare/src/routes/billing.ts`, `cloudflare/src/payments/settle.ts`; Test `cloudflare/test/sepay.test.ts`

**Phạm vi route:** `POST /api/sepay/webhook`, `POST /api/sepay/service-webhook`, `GET /api/payments/unassigned`, mọi `/api/dev/billing*`, `/api/dev/sepay*`, `/api/dev/landlords/:id/sepay/*`, `GET /api/sepay/oauth/callback`, `GET /qr.png`.

**Interfaces:**
- `findPayCode(env: Env, text: string, ownerId: number | null): Promise<{ houseId: string; ownerId: number; room: string; month: string } | null>` — `XXX` tra `house_directory.pay_no`, `PPP` tra `rooms.pay_no` trong kho của chủ trọ đó.
- `payments/settle.ts`:
  - `settleRent(env: Env, ownerId: number, houseId: string, room: string, month: string, t: SepayTransfer, sepayId: string)` — thân hàm như hiện tại, đổi `env.DB` thành `tenantOfOwner`; chống cộng trùng nhờ `payments.reference UNIQUE` + `INSERT OR IGNORE` (đã có).
  - `deferRent(env: Env, ownerId: number, houseId: string, room: string, month: string, sepayId: string): Promise<void>` — đặt `sepay_events.status='deferred'`; nếu `bankReceived` (đọc D1, chỉ đọc) + `deferredByRoom` ≥ tổng hoá đơn thì vẫn `paintSheetPayment(…, true, …)` (Sheet không thuộc D1 hay kho), để trang admin đọc Sheet qua Express cũng thấy "Đã đóng".
  - `replayDeferred(env: Env, ownerId: number): Promise<number>` — mỗi sự kiện `deferred` của chủ trọ: `settleRent` rồi đặt `status='done'`; trả số sự kiện đã xử lý.
  - `replayPendingDeferred(env: Env): Promise<number>` — gọi `replayDeferred` cho mọi chủ trọ có sự kiện `deferred` mà `getStorage` không còn là `migrating`.
- Webhook: `getStorage` là `migrating` → `deferRent`; ngược lại → `settleRent`.
- Không xác định được chủ trọ → `unassigned_payments`. `GET /api/payments/unassigned` = `unassigned_payments` khớp tài khoản ngân hàng của căn thuộc chủ trọ + `payments` có `house_id IS NULL` trong kho của chủ trọ.
- Tạo hoá đơn phí dịch vụ: số phòng hỏi từng kho tại thời điểm tạo.

- [ ] **Step 1: Viết test** (cả hai backend + `migrating`):

```ts
it('tiền đủ → hoá đơn paid, ghi payments trong đúng kho', ...)
it('migrating → sepay_events deferred, kho/D1 chưa ghi payments', ...)
it('migrating + đủ tiền → Sheet được tô "đã trả" đúng 1 lần', ...)  // SHEET_WRITES bật trong test này, fetchMock chặn URL Apps Script
it('webhook đủ tiền → cư dân và chủ trọ đều thấy Đã đóng ngay', ...) // describe.each(['d1','migrating','do']): POST /api/sepay/webhook (key Developer) nội dung mã LVC/101/11-2026 3.500.000 → /api/payment/status (cư dân), /api/admin/billing, /api/admin/dashboard, /api/houses/LVC/invoices đều 'paid'
it('webhook thiếu tiền → cả hai thấy chưa đóng', ...)              // cùng ba trạng thái
it('mã căn không tồn tại → unassigned_payments', ...)
it('webhook chủ trọ A không cộng được vào căn của chủ trọ B', ...) // key thủ công của chủ trọ 4 + mã căn LVC → không đổi hoá đơn LVC
it('phí dịch vụ: số phòng lấy từ kho', ...)
```

- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `refactor(worker): SePay and service billing through tenant routing`

### Task 10: Thông báo và lịch chạy

**Files:** Create `cloudflare/src/routes/notifications.ts`, `cloudflare/src/cron.ts`; Test `cloudflare/test/cron.test.ts`

**Interfaces:**
- Consumes: `syncMonthFromSheet`, `ensureMonthFresh` (đổi chữ ký ở Task 8), `replayPendingDeferred` (Task 9).
- `cron.ts`: `syncLegacySheets(env: Env, onlyOwner?: number): Promise<void>` — bỏ qua chủ trọ đang `migrating`; `onlyOwner` dùng ở Task 13 để chép lại một chủ trọ; `purgeDeletedHouses(env: Env): Promise<string[]>` — xoá trong kho trước, rồi `DELETE FROM resident_index WHERE house_id = ?`, rồi `removeHouseDir`; bước sau lỗi thì ghi `audit_log` cảnh báo (spec §6.2); `reconcile(env: Env): Promise<{ countsFixed: number; indexMismatches: { residentId: number; problem: string }[] }>` — tính lại bộ đếm từ từng kho, so `resident_index` với cư dân trong kho, không tự xoá, lưu kết quả vào `settings.last_reconcile` (JSON).
- `scheduled`: `*/10 * * * *` → `syncLegacySheets` + `replayPendingDeferred`; `0 19 * * *` → `purgeDeletedHouses` + `reconcile`.

- [ ] **Step 1: Viết test** (cả hai backend): thông báo tạo/đọc giống nhau; `syncLegacySheets` với chủ trọ `migrating` không ghi gì (giả lập `fetch` CSV bằng `fetchMock` của vitest-plugin); `purgeDeletedHouses` xoá cả dòng `resident_index` của căn; `reconcile` sửa `room_count` sai và báo cư dân có trong index mà không có trong kho.
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `refactor(worker): notifications and cron through tenant routing`

### Task 11: Bộ test chạy trên cả hai backend

**Files:** Modify `cloudflare/test/isolation.test.ts`, `cloudflare/src/index.ts`; Create `cloudflare/test/no-direct-tenant-access.test.ts`

- [ ] **Step 1:** `isolation.test.ts` chuyển sang `describe.each(BACKENDS)`.
- [ ] **Step 2:** Test tĩnh: đọc mã nguồn `src/**/*.ts` (trừ `tenant/`, `migrate/`, `central/deferred.ts`) và khẳng định không có `env.DB` / `c.env.DB` đi cùng tên một trong 9 bảng kho trong cùng câu SQL.

```ts
it('không còn truy cập trực tiếp bảng kho qua env.DB', () => { expect(findDirectTenantSql(sources)).toEqual([]); });
```

- [ ] **Step 3:** `index.ts` chỉ còn khởi tạo và đăng ký; `wc -l src/index.ts` < 150.
- [ ] **Step 4: `npm test` PASS** (toàn bộ, hai backend). **Step 5: Commit** `test(worker): full suite on d1 and do backends`

---

## GIAI ĐOẠN 3 — Chuyển dữ liệu

### Task 12: Băm, xuất, nhập dữ liệu kho

**Files:** Create `cloudflare/src/migrate/digest.ts`; Modify `cloudflare/src/tenant/store.ts` (hoàn thiện `digest`); Test `cloudflare/test/digest.test.ts`

**Interfaces:**
- `digestRows(rows: Record<string, SqlValue>[], pk: string[]): Promise<string>` — xếp theo `pk`, mỗi dòng JSON với khoá xếp chữ cái, nối bằng `\n`, SHA-256 hex.
- `ownerRowsFromD1(env: Env, ownerId: number, table: TenantTable, offset: number, limit: number): Promise<Record<string, SqlValue>[]>` — `houses WHERE owner_id=?`; các bảng khác `WHERE house_id IN (căn của chủ trọ)`; `payments` thêm dòng `house_id IS NULL AND account_no IN (tài khoản ngân hàng các căn của chủ trọ)`.

- [ ] **Step 1: Viết test:** cùng tập dòng khác thứ tự → cùng băm; đổi một ô → khác băm; `null` và chuỗi rỗng khác băm; `digest()` của kho = `digestRows` của cùng dữ liệu trong D1; `ownerRowsFromD1` không trả dòng của chủ trọ khác; sau `importRows` giữ id, một `INSERT` không ghi id vào bảng đó nhận id = id lớn nhất + 1 (bộ đếm AUTOINCREMENT, spec §7.1 bước 2).
- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): row digests and per-owner export/import`

### Task 13: Chạy thử, chuyển, quay lại

**Files:** Create `cloudflare/src/migrate/tenant.ts`, `cloudflare/src/routes/storage.ts`, `cloudflare/scripts/migrate-tenant.mts`; Test `cloudflare/test/migrate.test.ts`

**Interfaces:**
- `interface TableReport { table: string; d1Count: number; doCount: number; d1Sha: string; doSha: string; ok: boolean }`
- `interface MonthReport { month: string; d1Total: number; doTotal: number; d1Paid: number; doPaid: number; ok: boolean }`
- `interface MigrationReport { ownerId: number; mode: 'dry-run' | 'migrate' | 'rollback'; ok: boolean; tables: TableReport[]; months: MonthReport[]; deferredReplayed: number; lockedMs: number; error?: string }`
- `migrateOwner(env: Env, ownerId: number, opts?: { dryRun?: boolean }): Promise<MigrationReport>` — các bước spec §7.1:
  - `dryRun`: dùng `tenantStub(…, { dryRun: true })`, `reset()` kho thử trước, không đổi công tắc, không khoá.
  - Thật: `setStorage(…,'migrating',{ expect: 'd1', lockMinutes: 10 })`; trả `false` → 409 `MIGRATION_RUNNING`.
  - Kho đích có dữ liệu: `info().migratedFrom === null` (sót lại từ lần chạy hỏng hoặc khoá hết hạn) → `reset()`; ngược lại → huỷ, về `d1`, lỗi 409 `STORE_NOT_EMPTY`.
  - Chép theo `TENANT_TABLES` 200 dòng/lần, đối chiếu. Sai → `reset()` + `setStorage(…,'d1')`.
  - Đúng → `setMeta('migrated_from','d1')`, `setMeta('migrated_at', String(Date.now()))`, `setStorage(…,'do',{ expect: 'migrating' })`, `replayDeferred`, `syncLegacySheets(env, ownerId)`.
- `rollbackOwner(env: Env, ownerId: number): Promise<MigrationReport>` — `info().lastWriteAt <= info().migratedAt` → `setStorage(…,'d1')`; ngược lại khoá, xoá dòng của chủ trọ trong D1, chép từ kho về, đối chiếu, `d1`. Cả hai nhánh: D1 đã khớp thì `reset()` kho (PITR vẫn khôi phục được nếu cần), để lần chuyển sau bắt đầu từ kho trống.
- `POST …/unlock`: `setStorage(…,'d1',{ expect: 'migrating' })` rồi `replayDeferred`. Khoá hết hạn tự nhiên: `getStorage` trả `d1`, cron 10 phút gọi `replayPendingDeferred`; trong lúc chờ, 4 API trạng thái vẫn cộng `deferred` (Task 8).
- API (Developer): `GET /api/dev/storage`, `POST /api/dev/storage/:ownerId/dry-run|migrate|rollback|unlock`.
- CLI: `npx tsx cloudflare/scripts/migrate-tenant.mts <dry-run|migrate|rollback> <ownerId> --base <url>`:
  - Đọc token Developer từ biến `TROHUB_DEV_TOKEN`.
  - Với `migrate`/`rollback`: chụp JSON `GET /api/houses`, `/api/houses/:id/rooms`, `/api/houses/:id/invoices?month=<tháng này>`, `/api/admin/payment-gate?houseId=<id>` cho mọi căn của chủ trọ trước và sau, rồi so (spec §7.1 bước 6).
  - In bảng `TableReport`/`MonthReport` và phần khác nhau; thoát mã 1 nếu `ok=false` hoặc JSON khác nhau, kèm lệnh `rollback` gợi ý.

- [ ] **Step 1: Viết test:**

```ts
it('dry-run khớp, công tắc vẫn d1', ...)
it('migrate khớp, công tắc do, API trước/sau giống nhau', ...)  // chụp JSON 4 API đọc trước, so sau
it('cố tình lệch một dòng → ok=false, reset kho, về d1', ...)    // chèn thêm 1 dòng vào kho giữa chép và đối chiếu bằng hook test
it('gọi migrate lần hai khi đang chạy → 409', ...)               // Review Focus 3
it('tiền về khi migrating được cộng đúng một lần sau khi bật', ...)
it('SePay gửi lại giao dịch đã deferred sau khi bật → bỏ qua', ...) // Review Focus 4
it('khoá hết hạn: về d1, cả hai phía vẫn thấy Đã đóng, cron cộng vào D1 một lần', ...) // Review Focus 2: lock_expires_at trong quá khứ + deferred đủ tiền → 4 API 'paid' trước replay; replayPendingDeferred → 1 dòng payments, status 'done'; gọi lại → vẫn 1 dòng
it('kho sót dữ liệu từ lần hỏng (migrated_from null) → tự reset rồi chuyển', ...)
it('rollback khi chưa ghi gì: chỉ đổi công tắc, kho được reset', ...)
it('rollback sau khi có ghi mới: D1 có dữ liệu mới, đối chiếu khớp', ...)
it('rollback rồi migrate lại: thành công', ...)
it('chủ trọ không phải Developer gọi API storage → 403', ...)
```

- [ ] **Step 2–4: FAIL → code → PASS. Step 5: Commit** `feat(worker): per-owner dry-run, migrate and rollback`

### Task 14: Diễn tập trên bản sao lưu dữ liệu thật (local)

**Files:** Create `cloudflare/scripts/rehearse-migration.sh`; Modify `docs/cloudflare-per-landlord-runbook.md` (mục Diễn tập)

- [ ] **Step 1:** Script: xoá `.wrangler/state` của một thư mục `--persist-to` riêng, nạp bản sao lưu D1 (đường dẫn truyền vào, không commit file sao lưu), chạy `migrations apply --local` (0016–0019), chạy `wrangler dev` với `--persist-to`, chụp JSON các API đọc chính cho chủ trọ 1 và 4, chạy `migrate-tenant.mts migrate 4` rồi `1`, chụp lại, `diff` hai bộ JSON.
- [ ] **Step 2:** Chạy với bản sao lưu ngày 18/11. Kỳ vọng: cả hai `MigrationReport.ok = true`, `diff` rỗng, 13 khoản tiền chưa gắn vào kho chủ trọ 1 (đuôi tài khoản 1800).
- [ ] **Step 3: Commit** `chore(worker): migration rehearsal on a production backup`

---

## GIAI ĐOẠN 4 — Vận hành

### Task 15: Tab Lưu trữ trên trang Developer

**Files:** Modify `cloudflare/src/routes/storage.ts`, `src/components/DeveloperPortal.tsx`; Test `cloudflare/test/storage.test.ts`

**Interfaces:**
- `GET /api/dev/storage` trả `{ owners: { ownerId: number; name: string; backend: Backend; lockExpiresAt: number | null; migratedAt: string | null; sizeBytes: number | null; rowsWrittenToday: number | null; houses: number }[]; totalBytes: number; rowsWrittenToday: number; freeLimits: { perStoreBytes: 1073741824; totalBytes: 5368709120; rowsWrittenPerDay: 100000 }; warnings: string[]; lastReconcile: unknown }` — gọi `info()` chỉ cho chủ trọ ở `do`; cảnh báo khi một kho ≥ 70% `perStoreBytes`, tổng dung lượng ≥ 70% `totalBytes`, hoặc tổng dòng ghi hôm nay ≥ 70% `rowsWrittenPerDay`; `lastReconcile` từ `settings.last_reconcile`.
- `GET /api/dev/storage/:ownerId/export` → JSON `{ ownerId, exportedAt, tables: { [table]: rows[] } }`, header `Content-Disposition: attachment`.
- Giao diện: tab thứ ba "Lưu trữ" cạnh "Chủ trọ", "Thu phí": mỗi chủ trọ một dòng (nhãn `D1` / `Đang chuyển` / `Kho riêng`, dung lượng), nút "Chạy thử", "Chuyển" (xác nhận hai bước), "Quay lại", "Mở khoá", "Xuất dữ liệu"; khung cảnh báo mức sử dụng.

- [ ] **Step 1: Viết test API:** chỉ Developer gọi được; `warnings` xuất hiện khi giả lập `sizeBytes` hoặc `rowsWrittenToday` vượt 70%; export không chứa dữ liệu chủ trọ khác.
- [ ] **Step 2–4: FAIL → code → PASS;** `npx tsc --noEmit` ở gốc repo sạch; chụp màn hình tab ở bản local (điện thoại 390px và máy tính).
- [ ] **Step 5: Commit** `feat: storage tab for per-landlord stores`

### Task 16: Review và đưa lên

**Files:** Create `docs/cloudflare-per-landlord-runbook.md`

Mỗi bước dưới cần bạn đồng ý trước khi làm trên bản thật.

- [ ] **Step 1:** Review toàn nhánh bằng skill `code-review` mức **high**, riêng `src/tenant/`, `src/migrate/`, `src/payments/settle.ts` mức **xhigh**; sửa mọi phát hiện mức trung bình trở lên; `npm test` xanh.
- [ ] **Step 2:** `wrangler d1 export tro-hub --remote` (sao lưu) → `wrangler d1 migrations apply tro-hub --remote` (0019) → `wrangler deploy`. Kiểm tra: `GET /api/dev/storage` mọi chủ trọ `d1`; đăng nhập 4 vai trò trên bản thật.
- [ ] **Step 3:** Theo dõi 1 ngày: không lỗi 5xx mới trong log Worker.
- [ ] **Step 4:** Bạn đổi URL webhook trên my.sepay.vn sang `https://tro-hub-api.trohub.workers.dev/api/sepay/webhook` (Worker tự chuyển giao dịch giặt sấy sang Express). Chuyển khoản thật một khoản nhỏ có mã phòng: cư dân thấy "Đã đóng" trong ≤ 3 giây, chủ trọ thấy ở tab Phòng và tab Thu tiền trong ≤ 8 giây, không tải lại trang. Xong bước này mới tới bước 7.
- [ ] **Step 5:** `migrate-tenant.mts dry-run 4` và `dry-run 1` trên bản thật → `ok=true`.
- [ ] **Step 6:** `migrate-tenant.mts migrate 4` (ban đêm) → `ok=true`; đăng nhập chủ trọ 4, xem căn NTTD. Theo dõi 24–48 giờ, đo thời gian phản hồi.
- [ ] **Step 7:** `migrate-tenant.mts migrate 1` (ban đêm) → `ok=true`, `lockedMs` < 60.000; kiểm tra: cư dân xem hoá đơn, chủ trọ xem billing, danh sách `deferred` trống; lặp lại phép thử chuyển khoản ở bước 4.
- [ ] **Step 8:** Đặt `settings.new_owner_backend = 'do'` → chủ trọ mới từ đây vào thẳng kho riêng.
- [ ] **Step 9:** Ghi kết quả vào runbook, commit `docs: per-landlord storage go-live log`. Xoá bảng chủ trọ khỏi D1 sau 30 ngày là việc riêng, cần bạn duyệt riêng (spec §9.7).
