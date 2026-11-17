/**
 * Chạy một lần lúc chuyển nhóm 2 (tiền phòng) sang D1: chép trạng thái Đã đóng / Chưa đóng (màu cột P)
 * của các tháng gần đây từ Google Sheet cũ vào D1. Số tiền không động tới: Worker tự đọc lại từ Sheet.
 * Không xoá gì; hoá đơn đã được Worker/SePay/quản lý đổi trạng thái (status_by có giá trị) được giữ nguyên.
 *
 *   npx tsx cloudflare/scripts/import-statuses.mts 10/2026 11/2026 > cloudflare/.wrangler/statuses.sql
 *   cd cloudflare && npx wrangler d1 execute tro-hub --remote --file .wrangler/statuses.sql
 *
 * Không ghi tháng nào thì lấy tháng này và tháng trước. Phải chạy sau khi Worker đã đọc số tiền của các
 * tháng đó (hoá đơn phải có trên D1), ví dụ bằng cách mở trang Thu tiền của tháng đó một lần.
 */
import { ADMIN_SPREADSHEET_ID, getCurrentMonthStr } from '../../src/server/adminService.ts';
import { fetchAllSheetColumnPStatuses } from '../../src/server/googleSheetColorService.ts';

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

function roomOf(raw: string): { house: string; room: string } | null {
  const upper = raw.toUpperCase().replace(/\.0+$/, '').trim();
  if (!upper || !/\d/.test(upper)) return null;
  if (upper.includes('LVC')) return { house: 'LVC', room: upper.replace(/\D/g, '') };
  return { house: 'TRUNG_KIM', room: /^G\d+$/.test(upper) ? `G${upper.slice(1).padStart(2, '0')}` : upper };
}

const previous = (label: string) => {
  const [m, y] = label.split('/').map(Number);
  return m === 1 ? `12/${y - 1}` : `${String(m - 1).padStart(2, '0')}/${y}`;
};
const now = getCurrentMonthStr();
const labels = process.argv.slice(2).length ? process.argv.slice(2) : [previous(now), now];

const sql: string[] = [];
const report: Record<string, string> = {};
for (const label of labels) {
  const [mm, yyyy] = label.split('/');
  const month = `${yyyy}-${mm.padStart(2, '0')}`;
  const { roomStatuses } = await fetchAllSheetColumnPStatuses(ADMIN_SPREADSHEET_ID, label);
  let paid = 0, unpaid = 0;
  for (const [code, s] of Object.entries(roomStatuses)) {
    const place = roomOf(code);
    if (!place) continue;
    const isPaid = s.paymentStatus === 'paid';
    isPaid ? paid++ : unpaid++;
    sql.push(
      `UPDATE invoices SET status = ${q(isPaid ? 'paid' : 'unpaid')}, paid_at = ${isPaid ? "COALESCE(paid_at, datetime('now'))" : 'NULL'}
        WHERE month = ${q(month)} AND status_by IS NULL
          AND room_id = (SELECT id FROM rooms WHERE house_id = ${q(place.house)} AND name = ${q(place.room)});`
    );
  }
  report[label] = `${paid} đã đóng, ${unpaid} chưa đóng`;
}
console.log(sql.join('\n'));
console.error(JSON.stringify(report, null, 1));
