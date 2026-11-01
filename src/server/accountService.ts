import { fetchSheetXlsx, parseSheetXmlRows, sheetDate } from './adminService.js';
import { normalizeRoom } from './googleSheetsBackendService.js';
import { GOOGLE_APPS_SCRIPT_WEBAPP_URL } from './notificationStore.js';

export type AccountStatus = 'pending' | 'approved' | 'rejected';

const cellText = (cell: any) => String(cell?.value ?? '').trim();
const statusFrom = (text: string): AccountStatus => {
  const upper = text.toUpperCase();
  return upper === 'CHỜ DUYỆT' ? 'pending' : upper === 'TỪ CHỐI' ? 'rejected' : 'approved';
};

/** Every account in the personal tab. Passwords (column N) never leave the server. */
export async function listAccounts() {
  const zip = await fetchSheetXlsx();
  if (!zip) throw new Error('Không đọc được Google Sheet');
  const { rows } = await parseSheetXmlRows(zip, 'THÔNG TIN CÁ NHÂN');
  return rows
    .filter((row: any) => row.rowNumber >= 2 && cellText(row.cells.A))
    .map((row: any) => {
      const rawRoom = cellText(row.cells.J);
      return {
        id: `sheet-${row.rowNumber}`,
        name: cellText(row.cells.A),
        gender: cellText(row.cells.B),
        phone: cellText(row.cells.C),
        email: cellText(row.cells.E),
        roomNumber: normalizeRoom(rawRoom) || '',
        createdAt: sheetDate(row.cells.O),
        status: statusFrom(cellText(row.cells.P)),
        isAdmin: rawRoom.toUpperCase() === 'ADMIN',
      };
    });
}

/** Runs an account action in Apps Script and reports whether the sheet really changed. */
export async function callAccountScript(action: string, params: Record<string, unknown>) {
  const res = await fetch(GOOGLE_APPS_SCRIPT_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(25000),
  });
  const data: any = await res.json().catch(() => null);
  if (!data) throw new Error('Apps Script không trả về dữ liệu hợp lệ. Vui lòng thử lại.');
  // Lock timeouts and script errors also come back without the action name, so check failure first.
  if (!data.success) throw new Error(data.error || 'Chưa ghi được vào Google Sheet.');
  // A script deployed before this action existed answers success without naming it.
  if (data.action !== action) throw new Error('Apps Script chưa có bản mới. Vui lòng triển khai lại script.');
  return data;
}
