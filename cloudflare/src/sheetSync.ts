/**
 * Nhóm 2 (tiền phòng) đã nằm trên D1, nhưng số tiền mỗi tháng vẫn do chủ trọ nhập trên Google Sheet
 * cũ cho tới khi điện nước chuyển sang D1 (nhóm 4). Ở đây Worker:
 *   - đọc tab tháng ("11/2026") của Sheet cũ và cập nhật số tiền, chỉ số điện nước vào D1. Trạng thái
 *     thanh toán không bao giờ lấy từ Sheet nữa: D1 là nơi quyết định;
 *   - tô lại ô cột P và lưu cổng thanh toán qua Apps Script, để phần còn chạy trên Express (đăng nhập
 *     Zalo, danh sách phòng) vẫn thấy cùng trạng thái.
 * Sheet được mở công khai ở chế độ xem, nên đọc bằng bản xuất CSV, không cần đăng nhập Google.
 */

export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzQXCBcLJIE969ciS6YFlgZ37vkb-ec3w81Yr9uXXuWZAifVBa_2ewoeQUtk6rsYv62/exec';

/** "LVC-101" → LVC / 101; "101", "P.101", "101.0" → TRUNG_KIM / 101; "g2" → TRUNG_KIM / G02. */
export function parseLegacyRoom(code: string): { houseId: string; room: string } | null {
  let text = String(code ?? '').trim().toUpperCase().replace(/^(P\.|P\s+|PHÒNG\s+)/, '').replace(/\.0+$/, '');
  if (!text) return null;
  if (text.includes('LVC')) return { houseId: 'LVC', room: text.replace(/\D/g, '') };
  if (/^G\d+$/.test(text)) text = `G${text.slice(1).padStart(2, '0')}`;
  return { houseId: 'TRUNG_KIM', room: text };
}

export const legacyRoomCode = (houseId: string, room: string) => (houseId === 'LVC' ? `LVC-${room}` : room);

/** 'YYYY-MM' ↔ 'MM/YYYY' (tên tab và dạng tháng app cũ dùng). */
export const toSheetMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
export function fromSheetMonth(label: string | undefined | null): string | null {
  const m = String(label ?? '').match(/^(\d{1,2})\/(\d{4})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `${m[2]}-${m[1].padStart(2, '0')}`;
}

/** Tháng hiện tại theo giờ Việt Nam, 'YYYY-MM'. */
export const currentMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
export function previousMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export interface LegacySheet { sheetId: string; houses: string[] }

export async function legacySheet(db: D1Database): Promise<LegacySheet | null> {
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`)
    .all<{ key: string; value: string }>();
  const get = (k: string) => results.find((r) => r.key === k)?.value ?? '';
  const sheetId = get('legacy_sheet_id').trim();
  const houses = get('legacy_sheet_houses').split(',').map((h) => h.trim()).filter(Boolean);
  return sheetId && houses.length ? { sheetId, houses } : null;
}

/** Số kiểu Việt Nam trong CSV: "2.000.000 đ", "6.542", "-200 đ", "1,5". */
export function vnNumber(text: string | undefined): number {
  const clean = String(text ?? '').replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Chỉ số công tơ: chỉ lấy chữ số, bỏ phần ".0" ở cuối. Giống meterReading() phía app. */
export function meterReading(text: string | undefined): number {
  const digits = String(text ?? '').trim().replace(/[.,]0+$/, '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/** CSV theo RFC 4180: ô trong dấu ngoặc kép có thể chứa dấu phẩy, xuống dòng và "" thay cho ". */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Tên tab → gid. Trang htmlview công khai liệt kê các tab; giữ 10 phút trong isolate. */
const gidCache = new Map<string, { at: number; gids: Map<string, string> }>();

export async function sheetTabs(sheetId: string, fresh = false): Promise<Map<string, string>> {
  const hit = gidCache.get(sheetId);
  if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.gids;
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  if (!res.ok) throw new Error(`Không đọc được danh sách tab Google Sheet (${res.status}).`);
  const html = await res.text();
  const gids = new Map<string, string>();
  for (const m of html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*?gid=(\d+)/g)) gids.set(m[1].replace(/\\\//g, '/').replace(/\\(.)/g, '$1'), m[2]);
  gidCache.set(sheetId, { at: Date.now(), gids });
  return gids;
}

/** Các tháng có tab trên Sheet cũ, 'YYYY-MM'. */
export async function sheetMonths(sheetId: string): Promise<string[]> {
  const tabs = await sheetTabs(sheetId);
  return [...tabs.keys()].map(fromSheetMonth).filter((m): m is string => Boolean(m));
}

// Cột A–P của tab tháng: A phòng, B/C điện cũ/mới, E/F nước cũ/mới, H điện, I nước, J phòng, K rác,
// L internet, M xe, N khác, O cọc, P tổng.
const COL = { room: 0, eOld: 1, eNew: 2, wOld: 4, wNew: 5, electricity: 7, water: 8, rent: 9, trash: 10, internet: 11, parking: 12, other: 13, deposit: 14, total: 15 };

export interface SyncResult { month: string; tab: boolean; invoices: number; skippedRooms: string[] }

/**
 * Đọc một tháng từ Sheet cũ và ghi số tiền, chỉ số vào D1. Hoá đơn mới vào với trạng thái 'unpaid';
 * hoá đơn đã có giữ nguyên trạng thái. Dòng bị xoá trên Sheet không xoá hoá đơn trên D1.
 */
export async function syncMonthFromSheet(db: D1Database, month: string): Promise<SyncResult> {
  const result: SyncResult = { month, tab: false, invoices: 0, skippedRooms: [] };
  const legacy = await legacySheet(db);
  if (!legacy) return result;
  const tabs = await sheetTabs(legacy.sheetId);
  const gid = tabs.get(toSheetMonth(month)) ?? (await sheetTabs(legacy.sheetId, true)).get(toSheetMonth(month));
  if (!gid) return result;
  result.tab = true;

  const res = await fetch(`https://docs.google.com/spreadsheets/d/${legacy.sheetId}/export?format=csv&gid=${gid}`);
  if (!res.ok) throw new Error(`Không đọc được tab ${toSheetMonth(month)} (${res.status}).`);
  const rows = parseCsv(await res.text());
  const header = rows.findIndex((r) => (r[0] ?? '').trim() === 'Số phòng');
  if (header < 0) return result;

  const { results: rooms } = await db
    .prepare(`SELECT id, house_id, name FROM rooms WHERE deleted_at IS NULL AND house_id IN (${legacy.houses.map(() => '?').join(',')})`)
    .bind(...legacy.houses)
    .all<{ id: number; house_id: string; name: string }>();
  const roomId = new Map(rooms.map((r) => [`${r.house_id}/${r.name}`, r.id]));

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (let i = header + 2; i < rows.length; i++) {
    const r = rows[i];
    const place = parseLegacyRoom(r[COL.room] ?? '');
    if (!place || !/\d/.test(place.room) || !legacy.houses.includes(place.houseId)) continue;
    const meters = [r[COL.eOld], r[COL.eNew], r[COL.wOld], r[COL.wNew]].map(meterReading);
    const amount = (k: keyof typeof COL) => vnNumber(r[COL[k]]);
    if (!amount('total') && !meters.some(Boolean)) continue;
    const id = roomId.get(`${place.houseId}/${place.room}`);
    if (!id) { result.skippedRooms.push(legacyRoomCode(place.houseId, place.room)); continue; }

    statements.push(
      db.prepare(
        `INSERT INTO invoices (house_id, room_id, month, room_rent, electricity, water, trash, internet, parking, other, deposit, total, sheet_row, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (room_id, month) DO UPDATE SET
           room_rent = excluded.room_rent, electricity = excluded.electricity, water = excluded.water, trash = excluded.trash,
           internet = excluded.internet, parking = excluded.parking, other = excluded.other, deposit = excluded.deposit,
           total = excluded.total, sheet_row = excluded.sheet_row, synced_at = excluded.synced_at`
      ).bind(place.houseId, id, month, amount('rent'), amount('electricity'), amount('water'), amount('trash'), amount('internet'),
        amount('parking'), amount('other'), amount('deposit'), amount('total'), i + 1, now)
    );
    if (meters.some(Boolean)) {
      statements.push(
        db.prepare(
          `INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (room_id, month) DO UPDATE SET electric_old = excluded.electric_old, electric_new = excluded.electric_new,
             water_old = excluded.water_old, water_new = excluded.water_new`
        ).bind(place.houseId, id, month, ...meters)
      );
    }
    result.invoices++;
  }
  statements.push(
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(`legacy_sync:${month}`, now)
  );
  await db.batch(statements);
  return result;
}

const syncing = new Map<string, Promise<SyncResult | null>>();

/**
 * Đọc lại tháng nếu lần đọc trước đã quá maxAgeMs. Lỗi đọc Sheet không chặn trang: dữ liệu D1 sẵn có vẫn
 * được trả về. Nhiều yêu cầu cùng lúc trong một isolate dùng chung một lần đọc.
 */
export async function ensureMonthFresh(db: D1Database, month: string, maxAgeMs = 60_000): Promise<SyncResult | null> {
  const last = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(`legacy_sync:${month}`).first<{ value: string }>();
  if (last && Date.now() - Date.parse(last.value) < maxAgeMs) return null;
  let job = syncing.get(month);
  if (!job) {
    job = syncMonthFromSheet(db, month)
      .catch((err) => { console.warn('[sheetSync]', month, err); return null; })
      .finally(() => syncing.delete(month));
    syncing.set(month, job);
  }
  return job;
}

/** Tô ô cột P (xanh: đã đóng, đỏ: chưa) cho phòng của nhà còn dùng Sheet cũ. Không chờ, không báo lỗi. */
export interface SheetEnv { DB: D1Database; SHEET_WRITES?: string }

export async function paintSheetPayment(env: SheetEnv, houseId: string, room: string, paid: boolean, month: string, row: number | null) {
  if (env.SHEET_WRITES === 'off') return;
  const legacy = await legacySheet(env.DB);
  if (!legacy?.houses.includes(houseId)) return;
  const params = new URLSearchParams({
    action: 'update_payment',
    room: legacyRoomCode(houseId, room),
    status: paid ? 'paid' : 'unpaid',
    month: toSheetMonth(month),
    row: row ? String(row) : '',
  });
  await fetch(`${APPS_SCRIPT_URL}?${params}`).catch((err) => console.warn('[sheetSync] paint', err));
}

interface ScriptGate { value: string; updatedAt?: number }

/** Cổng thanh toán Express đang lưu trong Apps Script ('MM/YYYY' → START/STOP). */
export async function scriptGates(): Promise<Record<string, ScriptGate> | null> {
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'get_payment_gates' }) }).catch(() => null);
  const data = res?.ok ? await res.json<{ success?: boolean; action?: string; gates?: Record<string, ScriptGate> }>().catch(() => null) : null;
  return data?.success && data.action === 'get_payment_gates' ? data.gates ?? {} : null;
}

/** Ghi cổng thanh toán sang Apps Script để Express (phiên đăng nhập Zalo) thấy cùng giá trị. */
export async function saveScriptGate(env: SheetEnv, month: string, value: 'START' | 'STOP') {
  if (env.SHEET_WRITES === 'off') return;
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'set_payment_gate', month: toSheetMonth(month), value, updatedAt: Date.now() }),
  }).catch((err) => console.warn('[sheetSync] gate', err));
}
