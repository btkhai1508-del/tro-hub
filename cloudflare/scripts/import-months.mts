/**
 * One-time import of the month tabs (A–P), their paid/unpaid colour in column P and the Logs tab
 * into D1, printed as SQL. Run from the repo root after import-sheet.mts:
 *   npx tsx cloudflare/scripts/import-months.mts > cloudflare/.wrangler/months.sql
 * It wipes invoices, meter readings and payments first, so run it only before the app writes
 * them to D1. Names and CCCD in columns Q–AB are not imported: they belong to residents.
 */
import { fetchSheetXlsx, parseSheetXmlRows, ADMIN_SPREADSHEET_ID } from '../../src/server/adminService.ts';
import { fetchAllSheetColumnPStatuses } from '../../src/server/googleSheetColorService.ts';
import { normalizeRoom, parseSheetVNDAmount } from '../../src/server/googleSheetsBackendService.ts';
import { meterReading } from '../../src/lib/meterDetail.ts';

const BANK = { name: 'MB Bank', code: 'mbbank', accountNo: '0902371800', accountName: 'BUI TRUNG KHAI' };

type Value = string | number | null;
const q = (v: Value) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const text = (cell: any) => String(cell?.value ?? '').trim();
/** Number cells come from the xlsx as "3500.0", which the text parser reads as 3 500 000: use the cell's number. */
const money = (cell: any) => (typeof cell?.num === 'number' ? Math.round(cell.num) : parseSheetVNDAmount(text(cell)));

/** Same split as import-sheet.mts: "LVC-101" → LVC / 101, "101.0" → TRUNG_KIM / 101. */
function roomOf(raw: string): { house: string; room: string } | null {
  const upper = raw.toUpperCase().replace(/\.0+$/, '').trim();
  if (!upper || !/\d/.test(upper) || upper === '0') return null;
  if (upper.includes('LVC')) return { house: 'LVC', room: upper.replace(/\D/g, '') };
  return { house: 'TRUNG_KIM', room: upper };
}
const roomId = (p: { house: string; room: string }) => `(SELECT id FROM rooms WHERE house_id = ${q(p.house)} AND name = ${q(p.room)})`;

const zip = await fetchSheetXlsx(ADMIN_SPREADSHEET_ID);
if (!zip) throw new Error('Không đọc được Google Sheet');
const tabs = [...zip.readAsText('xl/workbook.xml').matchAll(/<sheet\s+[^>]*name="(\d{2})(\d{4})"/g)]
  .map((m) => ({ tab: `${m[1]}${m[2]}`, label: `${m[1]}/${m[2]}`, month: `${m[2]}-${m[1]}` }))
  .sort((a, b) => a.month.localeCompare(b.month));

const sql: string[] = ['DELETE FROM payments; DELETE FROM invoices; DELETE FROM meter_readings; DELETE FROM house_rates;'];
sql.push(`UPDATE houses SET bank_name = ${q(BANK.name)}, bank_code = ${q(BANK.code)}, bank_account_no = ${q(BANK.accountNo)}, bank_account_name = ${q(BANK.accountName)};`);
const report: Record<string, string> = {};
const latestRoom = new Map<string, { rent: number; deposit: number }>();
let rates: number[] = [];

for (const { tab, label, month } of tabs) {
  const { rows } = await parseSheetXmlRows(zip, tab);
  const header = rows.findIndex((r: any) => text(r.cells.A) === 'Số phòng');
  if (header < 0) { report[label] = 'không có dòng tiêu đề'; continue; }
  // Older tabs (03/2026) put the money in other columns; import only tabs laid out like today's.
  const titles = rows[header].cells;
  if (!/TIỀN PHÒNG/i.test(text(titles.J)) || !/TỔNG/i.test(text(titles.P))) { report[label] = 'bỏ qua: bố cục cột khác mẫu'; continue; }

  // The row under the header holds this month's unit prices (H điện, I nước, K rác, L internet, M xe).
  const priceRow = rows[header + 1]?.cells ?? {};
  const monthRates = ['H', 'I', 'K', 'L', 'M'].map((col) => money(priceRow[col]));
  if (monthRates.some((n) => n > 0)) rates = monthRates;

  const statuses = await fetchAllSheetColumnPStatuses(ADMIN_SPREADSHEET_ID, label).then((s) => s.roomStatuses).catch(() => ({}) as Record<string, any>);
  let invoices = 0, paid = 0;

  for (const r of rows.slice(header + 2)) {
    const place = roomOf(text(r.cells.A));
    if (!place) continue;
    const c = r.cells;
    const meters = ['B', 'C', 'E', 'F'].map((col) => meterReading(text(c[col])));
    const amounts = ['J', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P'].map((col) => money(c[col]));
    if (!amounts[8] && !meters.some(Boolean)) continue;

    sql.push(`INSERT OR IGNORE INTO rooms (house_id, name) VALUES (${q(place.house)}, ${q(place.room)});`);
    if (meters.some(Boolean)) {
      sql.push(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new)
        VALUES (${q(place.house)}, ${roomId(place)}, ${q(month)}, ${meters.join(', ')});`);
    }
    const key = normalizeRoom(text(c.A));
    const status = statuses[key] ?? statuses[key.replace('-', '')];
    const isPaid = status?.paymentStatus === 'paid';
    if (isPaid) paid++;
    sql.push(`INSERT INTO invoices (house_id, room_id, month, room_rent, electricity, water, trash, internet, parking, other, deposit, total, status)
      VALUES (${q(place.house)}, ${roomId(place)}, ${q(month)}, ${amounts.join(', ')}, ${q(isPaid ? 'paid' : 'unpaid')});`);
    invoices++;
    const prev = latestRoom.get(`${place.house}/${place.room}`);
    if (amounts[0] || amounts[7]) latestRoom.set(`${place.house}/${place.room}`, { rent: amounts[0] || prev?.rent || 0, deposit: amounts[7] || prev?.deposit || 0 });
  }
  report[label] = `${invoices} hoá đơn, ${paid} đã thanh toán`;
}

// Rent and deposit of each room from its latest month; the same unit prices apply to both houses today.
for (const [key, v] of latestRoom) {
  const [house, room] = key.split('/');
  sql.push(`UPDATE rooms SET price = ${v.rent}, deposit = ${v.deposit} WHERE house_id = ${q(house)} AND name = ${q(room)};`);
}
for (const house of ['TRUNG_KIM', 'LVC']) {
  sql.push(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3, trash, internet, parking) VALUES (${q(house)}, ${rates.join(', ')});`);
}

// Bank log: all to the one MB account, with nothing that says which house, so it waits for Admin Tổng.
const { rows: logs } = await parseSheetXmlRows(zip, 'Logs');
let payments = 0;
for (const r of logs.slice(1).filter((r: any) => text(r.cells.B) && money(r.cells.H) > 0)) {
  const c = r.cells;
  sql.push(`INSERT OR IGNORE INTO payments (house_id, amount, method, bank_name, account_no, reference, content, paid_at)
    VALUES (NULL, ${money(c.H)}, 'bank', ${q(text(c.A))}, ${q(text(c.C))}, ${q(text(c.I) || null)}, ${q(text(c.F))}, ${q(text(c.B))});`);
  payments++;
}
report.payments = `${payments} giao dịch chưa gắn nhà`;
report.rates = rates.join(' / ');

console.log(sql.join('\n'));
console.error(JSON.stringify(report, null, 1));
