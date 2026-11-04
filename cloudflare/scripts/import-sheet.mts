/**
 * One-time import of the THÔNG TIN CÁ NHÂN tab into D1, printed as SQL.
 * Run from the repo root (it reuses the Express app's sheet reader):
 *   CCCD_KEY=... npx tsx cloudflare/scripts/import-sheet.mts > cloudflare/.wrangler/import.sql
 * It wipes houses, rooms, residents and staff first, so run it only before D1 becomes the
 * source of truth. The SQL holds personal data: delete it after applying.
 */
import { fetchSheetXlsx, parseSheetXmlRows, sheetDate } from '../../src/server/adminService.ts';
import { encryptText, hashCccd } from '../src/cccd.ts';
import { hashPassword, normalizePhone } from '../src/password.ts';

const key = process.env.CCCD_KEY;
if (!key) throw new Error('Thiếu CCCD_KEY');

const OWNER_PHONE = '0902371800';
const HOUSES = [
  ['TRUNG_KIM', 'NHÀ TRỌ TRUNG KIM', 'NTTK', '116/32 Đường 17', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Lương Thị Kim Phượng', '0903616569'],
  ['LVC', 'NHÀ TRỌ 109/6', 'NT1096', '109/6 Lê Văn Chí', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Bùi Trung Khải', '0902371800'],
];

type Value = string | number | null;
const q = (v: Value) => (v === null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const text = (cell: any) => String(cell?.value ?? '').trim();

/** "LVC-101" → LVC / 101, "101.0" → TRUNG_KIM / 101, "G02" stays G02. */
function roomOf(raw: string): { house: string; room: string } | null {
  const upper = raw.toUpperCase().replace(/\.0+$/, '').trim();
  if (!upper || upper === 'ADMIN') return null;
  if (upper.includes('LVC')) return { house: 'LVC', room: upper.replace(/\D/g, '') };
  return { house: 'TRUNG_KIM', room: upper };
}

/** The sheet stores CCCD as a number, so leading zeros are lost: 10–11 digits are padded back to 12. */
function cccdOf(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? digits.padStart(12, '0') : digits;
}

/** Only real 10-digit mobile numbers count; the sheet uses "1" for residents without their own phone. */
function phoneOf(raw: string): string | null {
  const phone = normalizePhone(raw);
  return /^0\d{9}$/.test(phone) ? phone : null;
}

const zip = await fetchSheetXlsx();
if (!zip) throw new Error('Không đọc được Google Sheet');
const { rows } = await parseSheetXmlRows(zip, 'THÔNG TIN CÁ NHÂN');
const data = rows.filter((r: any) => r.rowNumber >= 2 && text(r.cells.A));

const sql: string[] = [
  'DELETE FROM audit_log; DELETE FROM staff_houses; DELETE FROM staff; DELETE FROM residents; DELETE FROM rooms; DELETE FROM houses;',
];
for (const h of HOUSES) sql.push(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES (${h.map(q).join(', ')});`);

const report = { staff: 0, residents: 0, noPhone: 0, dupPhone: 0, dupCccd: 0, cccdPadded: 0, skippedOwnerRow: 0, rooms: 0 };
const rooms = new Map<string, number>();
const seenPhones = new Set<string>();
const seenCccd = new Set<string>();
const staffPhones = new Set<string>();

// Admin rows first, so a staff phone is never also imported as a resident.
// The owner becomes Admin Tổng; any other admin row manages Trung Kim.
for (const r of data.filter((r: any) => text(r.cells.J).toUpperCase() === 'ADMIN')) {
  const phone = phoneOf(text(r.cells.C));
  if (!phone) continue;
  staffPhones.add(phone);
  const role = phone === OWNER_PHONE ? 'owner' : 'manager';
  sql.push(`INSERT INTO staff (full_name, phone, password_hash, role) VALUES (${q(text(r.cells.A))}, ${q(phone)}, ${q(await hashPassword(text(r.cells.N) || '1'))}, '${role}');`);
  if (role === 'manager') sql.push(`INSERT INTO staff_houses (staff_id, house_id) SELECT id, 'TRUNG_KIM' FROM staff WHERE phone = ${q(phone)};`);
  report.staff++;
}
if (!staffPhones.has(OWNER_PHONE)) {
  sql.push(`INSERT INTO staff (full_name, phone, password_hash, role) VALUES ('Bùi Trung Khải', ${q(OWNER_PHONE)}, ${q(await hashPassword('1'))}, 'owner');`);
  staffPhones.add(OWNER_PHONE);
  report.staff++;
}

for (const r of data) {
  const place = roomOf(text(r.cells.J));
  if (!place) continue;

  let phone = phoneOf(text(r.cells.C));
  if (phone && staffPhones.has(phone)) { report.skippedOwnerRow++; continue; }
  if (!phone) report.noPhone++;
  if (phone && seenPhones.has(phone)) { report.dupPhone++; phone = null; }
  if (phone) seenPhones.add(phone);

  const roomKey = `${place.house}/${place.room}`;
  if (!rooms.has(roomKey)) {
    rooms.set(roomKey, rooms.size + 1);
    sql.push(`INSERT INTO rooms (id, house_id, name) VALUES (${rooms.get(roomKey)}, ${q(place.house)}, ${q(place.room)});`);
    report.rooms++;
  }

  const rawCccd = text(r.cells.D).replace(/\D/g, '');
  let cccd = cccdOf(rawCccd);
  if (cccd !== rawCccd) report.cccdPadded++;
  if (cccd && seenCccd.has(cccd)) { report.dupCccd++; cccd = ''; }
  if (cccd) seenCccd.add(cccd);

  const status = text(r.cells.P).toUpperCase();
  const values: Value[] = [
    place.house, rooms.get(roomKey)!, text(r.cells.A), text(r.cells.B), phone,
    await hashPassword(text(r.cells.N) || '1'),
    cccd ? await encryptText(cccd, key) : null, cccd ? cccd.slice(-4) : null, cccd ? await hashCccd(cccd, key) : null,
    text(r.cells.E), sheetDate(r.cells.F), text(r.cells.G), text(r.cells.H), text(r.cells.I),
    text(r.cells.K), text(r.cells.L), text(r.cells.M),
    status === 'TẠM NGƯNG' || status === 'TỪ CHỐI' ? 'rejected' : status.includes('CHỜ') ? 'pending' : 'approved',
    sheetDate(r.cells.O),
  ];
  sql.push(`INSERT INTO residents (house_id, room_id, full_name, gender, phone, password_hash, cccd_enc, cccd_last4, cccd_hash,
    email, dob, address_detail, plate_number, vehicle_type, emergency_name, emergency_relation, emergency_phone, status, move_in_date)
    VALUES (${values.map(q).join(', ')});`);
  report.residents++;
}

console.log(sql.join('\n'));
console.error(JSON.stringify(report));
