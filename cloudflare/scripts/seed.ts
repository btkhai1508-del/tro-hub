/**
 * Prints test data as SQL for the local D1: the two current houses, a few rooms,
 * one owner, one manager and three residents. Every password is "1" while testing.
 *   npm run db:seed:local
 */
import { hashPassword } from '../src/password.ts';

const q = (value: string | number | null) =>
  value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
const row = (...values: (string | number | null)[]) => `(${values.map(q).join(', ')})`;
const pw = await hashPassword('1');

const sql = [
  'DELETE FROM audit_log; DELETE FROM staff_houses; DELETE FROM staff; DELETE FROM residents; DELETE FROM rooms; DELETE FROM houses;',
  `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES
    ${row('TRUNG_KIM', 'NHÀ TRỌ TRUNG KIM', 'NTTK', '116/32 Đường 17', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Lương Thị Kim Phượng', '0903616569')},
    ${row('LVC', 'NHÀ TRỌ 109/6', 'NT1096', '109/6 Lê Văn Chí', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Bùi Trung Khải', '0902371800')};`,
  `INSERT INTO rooms (id, house_id, name, price) VALUES
    ${row(1, 'TRUNG_KIM', '101', 3000000)}, ${row(2, 'TRUNG_KIM', '102', 3000000)},
    ${row(3, 'LVC', '101', 3500000)}, ${row(4, 'LVC', '102', 3500000)};`,
  `INSERT INTO staff (id, full_name, phone, password_hash, role) VALUES
    ${row(1, 'Bùi Trung Khải', '0902371800', pw, 'owner')},
    ${row(2, 'Quản lý Trung Kim (test)', '0900000001', pw, 'manager')};`,
  `INSERT INTO staff_houses (staff_id, house_id) VALUES ${row(2, 'TRUNG_KIM')};`,
  `INSERT INTO residents (house_id, room_id, full_name, phone, password_hash, status) VALUES
    ${row('TRUNG_KIM', 1, 'Cư dân Trung Kim (test)', '0900000101', pw, 'approved')},
    ${row('LVC', 3, 'Cư dân LVC (test)', '0900000201', pw, 'approved')},
    ${row('LVC', null, 'Cư dân chờ duyệt (test)', '0900000202', pw, 'pending')};`,
];

console.log(sql.join('\n'));
