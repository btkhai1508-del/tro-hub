/**
 * Backend Google Sheets Service
 * Implements strict tenant authentication, room lookup, and occupant identification
 * based on Google Sheets.
 * 
 * Rules & Workflow:
 * 1. ĐĂNG NHẬP:
 *    - Tab "Thông tin cá nhân": Cột B = SĐT, Cột M = Mật khẩu
 *    - Phone is Primary Key.
 * 2. XÁC ĐỊNH PHÒNG:
 *    - Dò theo hàng ngang của người đó -> Cột I = Mã phòng (roomNumber).
 * 3. LIÊN KẾT TAB THÁNG HIỆN TẠI:
 *    - Tab tháng (e.g. 10/2026, 10, Tháng 10):
 *    - Cột A = Mã phòng (G01, 203, ...)
 * 4. XÁC ĐỊNH NGƯỜI SỐ 1 / 2 / 3 TRONG DÒNG PHÒNG ĐÓ:
 *    - Person 1: Q (Họ tên), R (CCCD), S (SĐT), T (Biển số xe)
 *    - Person 2: U (Họ tên), V (CCCD), W (SĐT), X (Biển số xe)
 *    - Person 3: Y (Họ tên), Z (CCCD), AA (SĐT), AB (Biển số xe)
 *    - If phone == S  -> Person 1 -> lấy Q/R/S/T
 *    - If phone == W  -> Person 2 -> lấy U/V/W/X
 *    - If phone == AA -> Person 3 -> lấy Y/Z/AA/AB
 * 5. TÌNH TRẠNG THANH TOÁN:
 *    - Cột P của tab tháng hiện tại (Màu highlight / text).
 * 6. TAB LOGS:
 *    - Chỉ dùng để auto-transition màn hình QR sang thông báo hoàn tất.
 */

export type PersonType = 'person1' | 'person2' | 'person3';

export interface PersonData {
  roomNumber: string;
  personType: PersonType;
  name: string;
  citizenId: string;
  phone: string;
  licensePlate: string;
}

export interface BackendTenantProfile {
  name: string;
  phone: string;
  cccd: string;
  email: string;
  dob: string;
  gender?: string;
  address: string;
  plateNumber: string;
  vehicleType: string;
  roomNumber: string;
  personType?: PersonType;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  password?: string;
  contractUrl?: string;
  rentPrice?: number;
  depositAmount?: number;
  totalMonthlyAmount?: number;
  isAdmin?: boolean;
}

export interface BackendInvoiceItem {
  id: string;
  month: string;
  issueDate: string;
  dueDate: string;
  total: number;
  status: 'unpaid' | 'paid' | 'pending';
  paidAt?: string;
  paymentMethod?: 'qr' | 'cash';
  transactionId?: string;
  details: {
    name: string;
    amount: number;
    type: 'room' | 'electricity' | 'water' | 'internet' | 'parking' | 'service';
    metric?: string;
    note?: string;
  }[];
}

export interface BackendTenantDataResponse {
  success: boolean;
  timestamp: string;
  profile: BackendTenantProfile | null;
  invoices: BackendInvoiceItem[];
  allResidentsCount: number;
  logsTransactionFound?: boolean;
  latestLogsTxn?: { date: string; code: string; content: string };
  error?: string;
}

export type AuthErrorCode =
  | 'AUTH_PENDING_APPROVAL'
  | 'AUTH_REJECTED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_NO_ROOM_FOUND'
  | 'AUTH_ROOM_NOT_IN_MONTHLY'
  | 'AUTH_TENANT_NOT_MAPPED'
  | 'AUTH_DATA_INCOMPLETE';

export interface AuthResult {
  message?: string;
  success: boolean;
  isAdmin?: boolean;
  errorCode?: AuthErrorCode;
  error?: string;
  user?: BackendTenantProfile;
  invoices?: BackendInvoiceItem[];
}

import { meterDetail, meterReading } from '../lib/meterDetail';
import {
  getRoomColumnPStatus,
  getOrCreateRoomColumnPStatus,
  setRoomColumnPStatus,
  syncFromLogsRows,
  ColumnPColor,
  PaymentStatusType,
  COLUMN_P_COLORS
} from './columnPStatusStore.js';
import { getLiveRoomPaymentStatus, ColumnPStatusResult, normalizeMonthFormat } from './googleSheetColorService.js';

export const DEFAULT_SPREADSHEET_ID = '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
export const DEFAULT_PROFILE_TAB = 'THÔNG TIN CÁ NHÂN';
/** Column Q of the profile tab, optional: "Giới tính". */
// Tab THÔNG TIN CÁ NHÂN: A Họ tên, B Giới tính, C SĐT, D CCCD, E Email, F Ngày sinh, G Địa chỉ,
// H Biển số, I Loại xe, J Phòng, K-M Liên hệ khẩn, N Password, O Ngày tham gia, P Tình trạng.
const PROFILE_GENDER_COLUMN = 1;
const PROFILE_STATUS_COLUMN = 15;
export const DEFAULT_MONTHLY_TAB = '10/2026';
export const DEFAULT_LOGS_TAB = 'Logs';

export function setInvoicePaidByWebhook(
  roomOrCode: string,
  transactionId: string,
  _amount?: number,
  method: 'qr' = 'qr'
) {
  const cleanKey = roomOrCode.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const color = 'GREEN';
  const now = new Date().toLocaleString('vi-VN');

  setRoomColumnPStatus(cleanKey, color, {
    amount: _amount,
    transactionId: transactionId || `TXN-${Date.now()}`,
    paidAt: now
  });
}

export function setInvoiceUnpaid(roomOrCode: string) {
  const cleanKey = roomOrCode.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  setRoomColumnPStatus(cleanKey, 'RED');
}

/**
 * Robust CSV parser for Google Sheet export text
 */
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) {
      lines.push(currentRow);
    }
  }
  return lines;
}

/**
 * Extract spreadsheet ID
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return DEFAULT_SPREADSHEET_ID;
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return input.trim() || DEFAULT_SPREADSHEET_ID;
}

/**
 * Normalize phone numbers to standard format (strip spaces, dots, dashes, leading +84 -> 0)
 */
export function normalizePhone(input: any): string {
  if (!input) return '';
  let str = String(input).trim().replace(/[\s.-]/g, '');
  if (str.startsWith('+84')) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('84') && str.length >= 11) {
    str = '0' + str.slice(2);
  } else if (str.length === 9 && !str.startsWith('0')) {
    // Leading 0 was stripped by Excel/Sheets numeric cell format
    str = '0' + str;
  }
  return str;
}

/**
 * Normalize room identifier (e.g. "P.203" -> "203", "P. G01" -> "G01", "P.LVC101" -> "LVC101", "LVC-101" -> "LVC101")
 */
export function normalizeRoom(input: any): string {
  if (!input) return '';
  let str = String(input).trim().toUpperCase();
  str = str.replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').trim();
  // Strip trailing float zeroes if any e.g. "101.0" -> "101"
  str = str.replace(/\.0+$/, '').trim();
  // Standardize LVC formats: LVC-101
  if (str.includes('LVC')) {
    const num = str.replace(/\D/g, '');
    return num ? `LVC-${num}` : str;
  }
  // Ground rooms: G01, G02, ...
  if (/^G\d+$/i.test(str)) {
    const num = str.replace(/\D/g, '');
    return `G${num.padStart(2, '0')}`;
  }
  // Numeric rooms: strip leading zero! e.g. "0101" -> "101", "0201" -> "201", "0309" -> "309"
  if (/^\d+$/.test(str)) {
    return str.replace(/^0+/, '') || str;
  }
  return str;
}

/**
 * Compare two room identifiers robustly
 * CRITICAL: LVC rooms (e.g. LVC101) must NEVER match standard rooms (e.g. 101)
 */
export function matchRoom(roomA: any, roomB: any): boolean {
  const normA = normalizeRoom(roomA);
  const normB = normalizeRoom(roomB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // LVC rooms (e.g. LVC101) must NEVER match standard rooms (e.g. 101)
  const isLvcA = normA.includes('LVC');
  const isLvcB = normB.includes('LVC');
  if (isLvcA !== isLvcB) return false;

  // Ground rooms (e.g. G01) must NEVER match standard rooms (e.g. 101)
  const isGroundA = normA.startsWith('G');
  const isGroundB = normB.startsWith('G');
  if (isGroundA !== isGroundB) return false;

  const cleanA = normA.replace(/[^0-9A-Z]/g, '');
  const cleanB = normB.replace(/[^0-9A-Z]/g, '');
  if (cleanA === cleanB) return true;
  
  const digitsA = normA.replace(/[^\d]/g, '');
  const digitsB = normB.replace(/[^\d]/g, '');
  if (digitsA && digitsB && digitsA === digitsB) return true;
  return false;
}

/**
 * Parse numeric amounts from sheet values (e.g. 3500 -> 3,500,000 or 8100 -> 8,100,000)
 */
export function parseSheetVNDAmount(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  
  let str = String(val).trim().replace(/\s*đ/gi, '').replace(/\s*vnd/gi, '');
  if (!str) return 0;
  
  let num = 0;
  if (str.includes('.') && str.includes(',')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
    num = parseFloat(str.replace(/[^\d.-]/g, ''));
  } else if (str.includes('.')) {
    const parts = str.split('.');
    if (parts.length > 2) {
      num = parseFloat(str.replace(/\./g, ''));
    } else if (parts.length === 2 && parts[1].length === 3) {
      num = parseFloat(str.replace(/\./g, ''));
    } else {
      num = parseFloat(str.replace(/[^\d.-]/g, ''));
    }
  } else if (str.includes(',')) {
    const parts = str.split(',');
    if (parts.length > 2) {
      num = parseFloat(str.replace(/,/g, ''));
    } else if (parts.length === 2 && parts[1].length === 3) {
      num = parseFloat(str.replace(/,/g, ''));
    } else {
      num = parseFloat(str.replace(/,/g, '.'));
    }
  } else {
    num = parseFloat(str.replace(/[^\d.-]/g, ''));
  }
  
  if (isNaN(num)) return 0;
  
  // If amount was entered in thousands shorthand (e.g. 2733 or 3550 for 3.55M), scale with x 1000
  if (num > 0 && num < 10000) {
    return num * 1000;
  }
  return num;
}

/**
 * Fetch raw sheet data via Google Visualization API
 */
export async function fetchSheetDataViaGviz(sheetId: string, tabName: string, headerRows?: number): Promise<string[][]> {
  const cleanId = extractSpreadsheetId(sheetId);
  // Without headerRows, gviz may merge the top data rows into one header cell.
  const headers = headerRows === undefined ? '' : `&headers=${headerRows}`;
  const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}${headers}&t=${Date.now()}`;
  
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet tab "${tabName}" (HTTP ${response.status})`);
  }

  const text = await response.text();
  return parseCSV(text);
}

/**
 * Reads the personal tab one sheet row per array, columns A to P.
 * Gviz is only the fallback: it merges the top rows into its header and blanks
 * text rooms like "G01" or "Admin" because the column is mostly numbers.
 */
export async function fetchProfileRows(spreadsheetId: string): Promise<string[][]> {
  try {
    const { fetchSheetXlsx, parseSheetXmlRows } = await import('./adminService.js');
    const zip = await fetchSheetXlsx(spreadsheetId);
    if (zip) {
      const { rows } = await parseSheetXmlRows(zip, DEFAULT_PROFILE_TAB);
      if (rows.length > 0) {
        return rows.map((row: any) => 'ABCDEFGHIJKLMNOP'.split('').map(col => String(row.cells[col]?.value ?? '')));
      }
    }
  } catch (e) {
    console.warn('[fetchProfileRows] XLSX read failed, falling back to gviz:', e);
  }
  try {
    return await fetchSheetDataViaGviz(spreadsheetId, DEFAULT_PROFILE_TAB, 1);
  } catch {
    return [];
  }
}

/**
 * Helper to compute transfer description according to room type:
 * - If room contains 'LVC' -> LVC{room}-T{month}-{year}
 * - If room does NOT contain 'LVC' -> {room}-T{month}-{year}
 */
export function generateTransferContent(roomNumber: string, month: string = '10/2026'): string {
  const rawRoom = (roomNumber || '203').trim();
  const isLVC = rawRoom.toUpperCase().includes('LVC');
  const cleanRoom = rawRoom.replace(/[^0-9A-Za-z]/g, '');
  const monthParts = month.split('/');
  const m = monthParts[0] || '10';
  const y = monthParts[1] || '2026';
  
  return isLVC ? `LVC${cleanRoom}-T${m}-${y}` : `${cleanRoom}-T${m}-${y}`;
}

// =========================================================================
// PHẦN 2, 3, 4, 5, 6: CORE MODULAR FUNCTIONS SPECIFIED IN USER REQUEST
// =========================================================================

/**
 * PHẦN 2: Dò theo hàng ngang của người đăng nhập trong tab "Thông tin cá nhân"
 * Cột B (index 1) = Số điện thoại
 * Cột I (index 8) = Mã phòng
 */
export function findUserRoom(phone: string, profileRows: string[][]): { roomNumber: string; userRow: string[] | null } {
  const cleanTargetPhone = normalizePhone(phone);
  const targetDigits = cleanTargetPhone.replace(/\D/g, '');
  if (!cleanTargetPhone && !targetDigits) return { roomNumber: '', userRow: null };

  for (const row of profileRows) {
    const rowPhone = normalizePhone(row[2]);
    const rowDigits = rowPhone.replace(/\D/g, '');
    const isMatch = Boolean(
      (rowPhone && rowPhone === cleanTargetPhone) ||
      (targetDigits.length >= 9 && rowDigits.length >= 9 && (rowDigits === targetDigits || rowDigits.endsWith(targetDigits.slice(-9)) || targetDigits.endsWith(rowDigits.slice(-9))))
    );

    if (isMatch) {
      const rawRoom = String(row[9] || '').trim();
      const cleanRoom = normalizeRoom(rawRoom);
      return { roomNumber: cleanRoom || rawRoom, userRow: row };
    }
  }

  return { roomNumber: '', userRow: null };
}

/**
 * PHẦN 3: Tự động xác định TAB THÁNG HIỆN TẠI
 */
const monthTabCandidates = (date: Date) => {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  const mm = String(m).padStart(2, '0');
  return Array.from(new Set([`${m}/${y}`, `${mm}/${y}`, `${mm}${y}`, `${m}, ${y}`, `Tháng ${m}/${y}`, `Tháng ${m}, ${y}`, `T${m}/${y}`, `${m}-${y}`]));
};

async function readMonthTab(spreadsheetId: string, date: Date): Promise<{ tabName: string; rows: string[][] } | null> {
  for (const tab of monthTabCandidates(date)) {
    try {
      const rows = await fetchSheetDataViaGviz(spreadsheetId, tab);
      // gviz answers an unknown tab with the first sheet, so check this really is a billing tab.
      const isInvoiceTab = rows?.[0]?.length >= 20 && !String(rows[0][0] || '').includes('Họ và Tên');
      if (isInvoiceTab) return { tabName: tab, rows };
    } catch {}
  }
  return null;
}

/** The current month only. No tab yet means no data: rows stays empty and no bill is shown. */
export async function getCurrentMonthSheet(spreadsheetId: string): Promise<{ tabName: string; rows: string[][] }> {
  const now = new Date();
  const found = await readMonthTab(spreadsheetId, now);
  return found || { tabName: `${now.getMonth() + 1}/${now.getFullYear()}`, rows: [] };
}

/** gviz blanks text rooms (G01, LVC-101) in the personal tab, so a past tab can still say whose room it is. */
async function getLatestMonthRows(spreadsheetId: string): Promise<string[][]> {
  const now = new Date();
  for (let back = 1; back <= 12; back += 1) {
    const found = await readMonthTab(spreadsheetId, new Date(now.getFullYear(), now.getMonth() - back, 1));
    if (found) return found.rows;
  }
  return [];
}

/**
 * PHẦN 3: DÙNG CỘT A ĐỂ TÌM PHÒNG TRONG TAB THÁNG HIỆN TẠI
 * CỘT A XÁC ĐỊNH ĐÚNG DÒNG CỦA PHÒNG.
 * Hỗ trợ G01-G07 (dòng 5-11) và LVC101-LVC204 (dòng 41-48).
 */
export function findRoomRow(
  monthlyRows: string[][],
  roomNumber: string,
  targetPhone?: string,
  targetName?: string
): { rowIndex: number; rowData: string[]; detectedRoom: string } | null {
  if (!monthlyRows || monthlyRows.length === 0) return null;
  
  const cleanTargetRoom = normalizeRoom(roomNumber);
  const cleanPhone = normalizePhone(targetPhone);
  const cleanName = (targetName || '').toLowerCase().trim();

  // 1. QUAN TRỌNG NHẤT: DÙNG CỘT A (INDEX 0) ĐỂ TÌM PHÒNG
  if (cleanTargetRoom) {
    // 1a. Tìm chính xác tại CỘT A (index 0)
    for (let i = 0; i < monthlyRows.length; i++) {
      const row = monthlyRows[i];
      const colA = String(row[0] || '').trim();
      if (colA && matchRoom(colA, cleanTargetRoom)) {
        return { rowIndex: i, rowData: row, detectedRoom: cleanTargetRoom };
      }
    }

    // 1b. Hỗ trợ các phòng tầng trệt G01-G07 nếu mẫu bảng tính để trống Cột A tại các dòng 5-11
    const groundMap: Record<number, string> = { 
      5: 'G01', 6: 'G02', 7: 'G03', 8: 'G04', 9: 'G05', 10: 'G06', 11: 'G07' 
    };
    for (const [rIdx, gRoom] of Object.entries(groundMap)) {
      const idx = parseInt(rIdx, 10);
      if (matchRoom(gRoom, cleanTargetRoom) && monthlyRows[idx]) {
        return { rowIndex: idx, rowData: monthlyRows[idx], detectedRoom: gRoom };
      }
    }

    // 1c. Hỗ trợ các phòng LVC (LVC101-LVC204) nếu Cột A để trống tại các dòng 41-48
    const lvcMap: Record<number, string> = { 
      41: 'LVC101', 42: 'LVC102', 43: 'LVC103', 44: 'LVC104',
      45: 'LVC201', 46: 'LVC202', 47: 'LVC203', 48: 'LVC204'
    };
    for (const [rIdx, lvcRoom] of Object.entries(lvcMap)) {
      const idx = parseInt(rIdx, 10);
      if (matchRoom(lvcRoom, cleanTargetRoom) && monthlyRows[idx]) {
        return { rowIndex: idx, rowData: monthlyRows[idx], detectedRoom: lvcRoom };
      }
    }
  }

  // 2. Dò theo SĐT người thuê trong các cột Q..AB (S=18, W=22, AA=26)
  if (cleanPhone) {
    for (let i = 0; i < monthlyRows.length; i++) {
      const row = monthlyRows[i];
      const p1 = normalizePhone(row[18]);
      const p2 = normalizePhone(row[22]);
      const p3 = normalizePhone(row[26]);
      if (p1 === cleanPhone || p2 === cleanPhone || p3 === cleanPhone) {
        let detected = normalizeRoom(row[0]);
        if (!detected && i >= 5 && i <= 11) detected = `G0${i - 4}`;
        if (!detected && i >= 41 && i <= 44) detected = `LVC10${i - 40}`;
        if (!detected && i >= 45 && i <= 48) detected = `LVC20${i - 44}`;
        return { rowIndex: i, rowData: row, detectedRoom: detected || cleanTargetRoom };
      }
    }
  }

  // 3. Dò theo Họ tên người thuê trong các cột Q..AB (Q=16, U=20, Y=24)
  if (cleanName) {
    for (let i = 0; i < monthlyRows.length; i++) {
      const row = monthlyRows[i];
      const n1 = String(row[16] || '').toLowerCase().trim();
      const n2 = String(row[20] || '').toLowerCase().trim();
      const n3 = String(row[24] || '').toLowerCase().trim();
      if (
        (n1 && (n1.includes(cleanName) || cleanName.includes(n1))) ||
        (n2 && (n2.includes(cleanName) || cleanName.includes(n2))) ||
        (n3 && (n3.includes(cleanName) || cleanName.includes(n3)))
      ) {
        let detected = normalizeRoom(row[0]);
        if (!detected && i >= 5 && i <= 11) detected = `G0${i - 4}`;
        if (!detected && i >= 41 && i <= 44) detected = `LVC10${i - 40}`;
        if (!detected && i >= 45 && i <= 48) detected = `LVC20${i - 44}`;
        return { rowIndex: i, rowData: row, detectedRoom: detected || cleanTargetRoom };
      }
    }
  }

  return null;
}

/**
 * Helper to sanitize tenant name from columns Q, U, Y
 * Filters out numeric values like "1", "1.0", "2.0", "3.0"
 */
function sanitizeTenantName(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return '';
  if (/^họ\s*(?:và\s*)?tên/i.test(s)) return '';
  return s;
}

function sanitizeCitizenId(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^[0-9](\.0+)?$/.test(s)) return '';
  return s;
}

function sanitizeTenantPhone(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^[0-9](\.0+)?$/.test(s)) return '';
  return s;
}

function sanitizeVehiclePlate(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return '';
  return s;
}

/**
 * PHẦN 4 & 5: Xác định người số 1 / 2 / 3 dựa trên số điện thoại, họ tên, hoặc CCCD
 * Person 1: Cột Q (16), R (17), S (18)
 * Person 2: Cột U (20), V (21), W (22)
 * Person 3: Cột Y (24), Z (25), AA (26)
 */
export function identifyPersonByPhone(
  roomRow: string[],
  phone?: string,
  name?: string,
  cccd?: string
): PersonType | null {
  if (!roomRow) return null;
  const target = normalizePhone(phone);
  const targetDigits = target.replace(/\D/g, '');
  const cleanName = (name || '').toLowerCase().trim();
  const cleanCccd = (cccd || '').replace(/\D/g, '');

  // 1. Check Phone
  if (target) {
    const phoneS = normalizePhone(sanitizeTenantPhone(roomRow[18]));
    if (phoneS && (phoneS === target || (targetDigits.length >= 9 && phoneS.endsWith(targetDigits.slice(-9))))) return 'person1';

    const phoneW = normalizePhone(sanitizeTenantPhone(roomRow[22]));
    if (phoneW && (phoneW === target || (targetDigits.length >= 9 && phoneW.endsWith(targetDigits.slice(-9))))) return 'person2';

    const phoneAA = normalizePhone(sanitizeTenantPhone(roomRow[26]));
    if (phoneAA && (phoneAA === target || (targetDigits.length >= 9 && phoneAA.endsWith(targetDigits.slice(-9))))) return 'person3';
  }

  // 2. Check Name (Only compare against sanitized non-numeric names)
  if (cleanName && cleanName.length >= 2) {
    const n1 = sanitizeTenantName(roomRow[16]).toLowerCase().trim();
    const n2 = sanitizeTenantName(roomRow[20]).toLowerCase().trim();
    const n3 = sanitizeTenantName(roomRow[24]).toLowerCase().trim();

    if (n1 && (n1.includes(cleanName) || cleanName.includes(n1))) return 'person1';
    if (n2 && (n2.includes(cleanName) || cleanName.includes(n2))) return 'person2';
    if (n3 && (n3.includes(cleanName) || cleanName.includes(n3))) return 'person3';
  }

  // 3. Check CCCD
  if (cleanCccd) {
    const c1 = sanitizeCitizenId(roomRow[17]).replace(/\D/g, '');
    const c2 = sanitizeCitizenId(roomRow[21]).replace(/\D/g, '');
    const c3 = sanitizeCitizenId(roomRow[25]).replace(/\D/g, '');

    if (c1 && c1 === cleanCccd) return 'person1';
    if (c2 && c2 === cleanCccd) return 'person2';
    if (c3 && c3 === cleanCccd) return 'person3';
  }

  // Default safely to person1 if the room has an occupant
  if (sanitizeTenantName(roomRow[16])) return 'person1';
  return 'person1';
}

/**
 * PHẦN 6: Lấy đúng 4 trường dữ liệu của personType đó
 * Person 1: Q (16: Name), R (17: CCCD), S (18: SĐT), T (19: Biển số xe)
 * Person 2: U (20: Name), V (21: CCCD), W (22: SĐT), X (23: Biển số xe)
 * Person 3: Y (24: Name), Z (25: CCCD), AA (26: SĐT), AB (27: Biển số xe)
 */
export function getPersonData(roomRow: string[], personType: PersonType, fallbackRoom: string = ''): PersonData {
  const roomNumber = normalizeRoom(roomRow[0]) || fallbackRoom;

  if (personType === 'person1') {
    return {
      roomNumber,
      personType: 'person1',
      name: sanitizeTenantName(roomRow[16]),
      citizenId: sanitizeCitizenId(roomRow[17]),
      phone: normalizePhone(sanitizeTenantPhone(roomRow[18])),
      licensePlate: sanitizeVehiclePlate(roomRow[19])
    };
  }

  if (personType === 'person2') {
    return {
      roomNumber,
      personType: 'person2',
      name: sanitizeTenantName(roomRow[20]),
      citizenId: sanitizeCitizenId(roomRow[21]),
      phone: normalizePhone(sanitizeTenantPhone(roomRow[22])),
      licensePlate: sanitizeVehiclePlate(roomRow[23])
    };
  }

  // person3
  return {
    roomNumber,
    personType: 'person3',
    name: sanitizeTenantName(roomRow[24]),
    citizenId: sanitizeCitizenId(roomRow[25]),
    phone: normalizePhone(sanitizeTenantPhone(roomRow[26])),
    licensePlate: sanitizeVehiclePlate(roomRow[27])
  };
}

/**
 * Helper to parse room invoice from monthly row
 */
function parseInvoiceFromRoomRow(
  row: string[],
  roomNumber: string,
  month: string = '10/2026',
  rowIndex?: number,
  liveStatus?: ColumnPStatusResult
): BackendInvoiceItem {
  // Every figure already has its formula in the sheet, so read the cells and calculate nothing here.
  const electricOld = meterReading(row[1]);
  const electricNew = meterReading(row[2]);
  const electricUsage = meterReading(row[3]);
  const electricCost = parseSheetVNDAmount(row[7]);

  const waterOld = meterReading(row[4]);
  const waterNew = meterReading(row[5]);
  const waterUsage = meterReading(row[6]);
  const waterCost = parseSheetVNDAmount(row[8]);

  const roomRent = parseSheetVNDAmount(row[9]);
  const trashCost = parseSheetVNDAmount(row[10]);
  const internetCost = parseSheetVNDAmount(row[11]);
  const parkingCost = parseSheetVNDAmount(row[12]);
  const otherCost = parseSheetVNDAmount(row[13]);
  const depositCost = parseSheetVNDAmount(row[14]);
  const totalCost = parseSheetVNDAmount(row[15]);

  const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let status: 'unpaid' | 'paid' | 'pending' = 'unpaid';
  let paymentMethod: 'qr' | undefined = undefined;
  let paidAt: string | undefined = undefined;
  let transactionId: string | undefined = undefined;

  // Source of truth: the background color of column P on the room's row.
  if (liveStatus && liveStatus.success) {
    status = liveStatus.paymentStatus;
    if (liveStatus.paymentStatus === 'paid') {
      paymentMethod = 'qr';
      paidAt = liveStatus.label;
      transactionId = `SHEET-${cleanRoom}-${liveStatus.cellAddress}`;
    }
  }

  const formattedMonth = normalizeMonthFormat(month);
  return {
    id: `INV-${formattedMonth.replace(/[\/, -]/g, '')}`,
    month: formattedMonth,
    issueDate: `01/${formattedMonth}`,
    dueDate: `05/${formattedMonth}`,
    total: totalCost,
    status,
    paidAt,
    paymentMethod,
    transactionId,
    details: [
      { name: 'Tiền thuê phòng', amount: roomRent, type: 'room' },
      { name: 'Tiền điện', amount: electricCost, type: 'electricity', metric: meterDetail(electricOld, electricNew, electricUsage, electricCost) },
      { name: 'Tiền nước sinh hoạt', amount: waterCost, type: 'water', metric: meterDetail(waterOld, waterNew, waterUsage, waterCost) },
      { name: 'Internet cáp quang', amount: internetCost, type: 'internet' },
      { name: 'Phí dịch vụ & rác', amount: trashCost, type: 'service' },
      { name: 'Phí giữ xe máy', amount: parkingCost, type: 'parking' },
      { name: 'Khoản khác / giảm trừ', amount: otherCost, type: 'service' },
      { name: 'Tiền đặt cọc', amount: depositCost, type: 'service' }
    ]
  };
}

/**
 * PHẦN 1, 7, 8: Complete Authenticate Workflow
 * Quét toàn diện tab "THÔNG TIN CÁ NHÂN" và tab Tháng
 * Cho phép đăng nhập qua: SĐT, Số phòng (102, LVC101, G01...), CCCD, hoặc Họ tên
 */
export async function authenticateUser(
  phoneInput: string,
  passwordInput: string,
  spreadsheetIdInput?: string,
  options: { verifiedPhone?: boolean } = {}
): Promise<AuthResult> {
  // verifiedPhone = true: phone number was verified by Zalo (getPhoneNumber),
  // so no password is required, but matching is STRICTLY by phone number only.
  const verifiedPhone = Boolean(options.verifiedPhone);
  const rawInput = String(phoneInput || '').trim();
  const cleanPhone = normalizePhone(rawInput);
  const cleanPassword = (passwordInput || '').trim();
  const cleanDigits = rawInput.replace(/\D/g, '');
  const cleanRoomQuery = verifiedPhone ? '' : normalizeRoom(rawInput);
  const lowerQuery = verifiedPhone ? '' : rawInput.toLowerCase();

  if (!rawInput || (!verifiedPhone && !cleanPassword)) {
    return { success: false, error: 'Số điện thoại hoặc mật khẩu không chính xác.' };
  }
  if (verifiedPhone && cleanDigits.length < 9) {
    return { success: false, errorCode: 'AUTH_TENANT_NOT_MAPPED', error: 'Số điện thoại Zalo không hợp lệ.' };
  }

  const spreadsheetId = extractSpreadsheetId(spreadsheetIdInput || DEFAULT_SPREADSHEET_ID);

  try {
    // 0. BÙI TRUNG KHẢI / ADMIN CHECK:
    // SĐT 0902371800, CCCD 079205019765 hoặc tên Bùi Trung Khải luôn là Admin, không phải phòng 309
    const isLandlordAdminLogin = cleanPhone === '0902371800' ||
      cleanDigits === '0902371800' ||
      cleanDigits.endsWith('902371800') ||
      cleanDigits === '079205019765' ||
      cleanDigits === '79205019765' ||
      cleanDigits.endsWith('079205019765') ||
      cleanDigits === '54202001366' ||
      cleanDigits.endsWith('54202001366') ||
      rawInput.toLowerCase() === 'admin' ||
      rawInput.toLowerCase().startsWith('admin') ||
      lowerQuery === 'admin' ||
      lowerQuery.startsWith('admin') ||
      lowerQuery.includes('bùi trung khải') ||
      lowerQuery.includes('buitrungkha');

    if (isLandlordAdminLogin) {
      const isPassOk = verifiedPhone || cleanPassword === '180505' || cleanPassword === '1' || cleanPassword === 'admin' || !cleanPassword;
      if (!isPassOk) {
        return { success: false, error: 'Mật khẩu quản trị viên không chính xác.' };
      }
      const adminProfile: BackendTenantProfile = {
        name: 'Bùi Trung Khải',
        phone: '0902371800',
        cccd: '079205019765',
        email: 'btkhai1508@gmail.com',
        dob: '15/08/2005',
        address: '109/6 Lê Văn Chí, P. Linh Xuân, TP. Thủ Đức',
        plateNumber: '',
        vehicleType: 'Xe máy',
        roomNumber: 'admin',
        personType: 'person1',
        emergencyName: '',
        emergencyRelation: '',
        emergencyPhone: '',
        rentPrice: 0,
        depositAmount: 0,
        totalMonthlyAmount: 0,
        isAdmin: true
      };
      return {
        success: true,
        isAdmin: true,
        user: adminProfile,
        invoices: []
      };
    }

    // 1. Fetch tab "Thông tin cá nhân" and monthly tab
    const profileRows = await fetchProfileRows(spreadsheetId);

    const { tabName: currentMonthTab, rows: monthlyRows } = await getCurrentMonthSheet(spreadsheetId);
    const lookupRows = monthlyRows.length > 0 ? monthlyRows : await getLatestMonthRows(spreadsheetId);

    let matchedUserRow: string[] | null = null;
    let matchedPassword = '';
    let matchedRoom = '';
    let matchedName = '';
    let matchedPlate = '';
    let matchedCccd = '';

    // QUÉT TOÀN BỘ 70 DÒNG TAB "THÔNG TIN CÁ NHÂN"
    for (let rIdx = 0; rIdx < profileRows.length; rIdx++) {
      const row = profileRows[rIdx];
      const phoneCell = String(row[2] || '').trim();
      const cellDigits = phoneCell.replace(/\D/g, '');
      const rowName = String(row[0] || '').trim();
      const rowCccd = String(row[3] || '').trim();
      const rowRoom = normalizeRoom(row[9]);

      // Check Phone match
      const phones = phoneCell.match(/(?:0|\+?84)[0-9]{8,11}/g) || [];
      const cleanPhones = phones.map(p => normalizePhone(p));
      const phoneIdx = cleanPhones.findIndex(p => p === cleanPhone || (cleanDigits.length >= 9 && p.endsWith(cleanDigits.slice(-9))));
      
      const isSinglePhoneMatch = Boolean(
        // A short cell like "1" would otherwise match every phone ending in that digit.
        cellDigits.length >= 9 &&
        cleanDigits.length >= 9 &&
        (cellDigits === cleanDigits ||
          cellDigits.endsWith(cleanDigits.slice(-9)) ||
          cleanDigits.endsWith(cellDigits.slice(-9)))
      );

      // Check Room match (e.g. user entered "102" or "LVC101" or "G01")
      const isRoomMatch = Boolean(
        cleanRoomQuery && (
          (rowRoom && matchRoom(rowRoom, cleanRoomQuery))
        )
      );

      // Check CCCD match
      const isCccdMatch = Boolean(cleanDigits && cleanDigits.length >= 9 && rowCccd.replace(/\D/g, '') === cleanDigits);

      // Check Name match
      const isNameMatch = Boolean(
        lowerQuery.length >= 3 &&
        rowName &&
        !rowName.startsWith('Họ và Tên') &&
        (rowName.toLowerCase().includes(lowerQuery) || lowerQuery.includes(rowName.toLowerCase()))
      );

      const isMatched = verifiedPhone
        ? (isSinglePhoneMatch || phoneIdx !== -1)
        : (isSinglePhoneMatch || isRoomMatch || isCccdMatch || isNameMatch || phoneIdx !== -1);

      if (isMatched) {
        matchedUserRow = row;
        matchedPassword = String(row[13] || '').replace(/^(Password|Mật khẩu|Pass)\s*/i, '').trim();
        
        // One person per row: every field comes from the row that holds this phone.
        matchedName = rowName;
        matchedPlate = String(row[7] || '').trim();
        matchedCccd = rowCccd;

        // Room comes from column J
        let r = rowRoom;

        // If Column J is empty (common for G01-G07 and LVC101-LVC204), resolve room from monthly rows
        if (!r && lookupRows && lookupRows.length > 0) {
          const targetPhoneClean = normalizePhone(row[2]) || cleanPhone;
          const targetNameClean = (row[0] || '').toLowerCase().trim();
          for (let mIdx = 0; mIdx < lookupRows.length; mIdx++) {
            const mRow = lookupRows[mIdx];
            const p1 = normalizePhone(mRow[18]);
            const p2 = normalizePhone(mRow[22]);
            const p3 = normalizePhone(mRow[26]);
            const n1 = String(mRow[16] || '').toLowerCase().trim();
            const n2 = String(mRow[20] || '').toLowerCase().trim();
            const n3 = String(mRow[24] || '').toLowerCase().trim();

            let rDetect = normalizeRoom(mRow[0]);
            if (!rDetect && mIdx >= 5 && mIdx <= 11) rDetect = `G0${mIdx - 4}`;
            if (!rDetect && mIdx >= 41 && mIdx <= 44) rDetect = `LVC10${mIdx - 40}`;
            if (!rDetect && mIdx >= 45 && mIdx <= 48) rDetect = `LVC20${mIdx - 44}`;

            if (rDetect) {
              const phoneMatches = Boolean(
                targetPhoneClean &&
                (p1 === targetPhoneClean || p2 === targetPhoneClean || p3 === targetPhoneClean ||
                  (targetPhoneClean.length >= 9 && (p1.endsWith(targetPhoneClean.slice(-9)) || p2.endsWith(targetPhoneClean.slice(-9)) || p3.endsWith(targetPhoneClean.slice(-9)))))
              );
              const nameMatches = Boolean(
                targetNameClean && targetNameClean.length >= 3 &&
                // An empty slot must not count: every name "includes" an empty string.
                ((n1 && (n1.includes(targetNameClean) || targetNameClean.includes(n1))) ||
                 (n2 && (n2.includes(targetNameClean) || targetNameClean.includes(n2))) ||
                 (n3 && (n3.includes(targetNameClean) || targetNameClean.includes(n3))))
              );

              if (phoneMatches || nameMatches) {
                r = rDetect;
                break;
              }
            }
          }
        }

        matchedRoom = r;
        break;
      }
    }

    // Fallback 1: Dò tìm trong MONTHLY SHEET nếu chưa tìm thấy trong profileRows
    // Only when the personal tab could not be read: a deleted account must not sign in from a month tab.
    if (!matchedUserRow && profileRows.length === 0 && lookupRows && lookupRows.length > 0) {
      for (let mIdx = 0; mIdx < lookupRows.length; mIdx++) {
        const mRow = lookupRows[mIdx];
        const p1Phone = String(mRow[18] || '').replace(/\D/g, '');
        const p2Phone = String(mRow[22] || '').replace(/\D/g, '');
        const p3Phone = String(mRow[26] || '').replace(/\D/g, '');

        const n1 = String(mRow[16] || '').toLowerCase().trim();
        const n2 = String(mRow[20] || '').toLowerCase().trim();
        const n3 = String(mRow[24] || '').toLowerCase().trim();

        const colA = normalizeRoom(mRow[0]);
        let rFromRow = colA;
        if (!rFromRow && mIdx >= 5 && mIdx <= 11) rFromRow = `G0${mIdx - 4}`;
        if (!rFromRow && mIdx >= 41 && mIdx <= 44) rFromRow = `LVC10${mIdx - 40}`;
        if (!rFromRow && mIdx >= 45 && mIdx <= 48) rFromRow = `LVC20${mIdx - 44}`;

        let matchSlot = 0;
        if (cleanDigits && cleanDigits.length >= 9) {
          if (p1Phone && (p1Phone === cleanDigits || p1Phone.endsWith(cleanDigits.slice(-9)))) matchSlot = 1;
          else if (p2Phone && (p2Phone === cleanDigits || p2Phone.endsWith(cleanDigits.slice(-9)))) matchSlot = 2;
          else if (p3Phone && (p3Phone === cleanDigits || p3Phone.endsWith(cleanDigits.slice(-9)))) matchSlot = 3;
        } else if (cleanRoomQuery && rFromRow && matchRoom(rFromRow, cleanRoomQuery)) {
          matchSlot = 1;
        } else if (lowerQuery.length >= 3) {
          if (n1 && (n1.includes(lowerQuery) || lowerQuery.includes(n1))) matchSlot = 1;
          else if (n2 && (n2.includes(lowerQuery) || lowerQuery.includes(n2))) matchSlot = 2;
          else if (n3 && (n3.includes(lowerQuery) || lowerQuery.includes(n3))) matchSlot = 3;
        }

        if (matchSlot > 0) {
          matchedRoom = rFromRow;
          if (matchSlot === 1) {
            matchedName = String(mRow[16] || '').trim();
            matchedCccd = String(mRow[17] || '').trim();
            matchedPlate = String(mRow[19] || '').trim();
          } else if (matchSlot === 2) {
            matchedName = String(mRow[20] || '').trim();
            matchedCccd = String(mRow[21] || '').trim();
            matchedPlate = String(mRow[23] || '').trim();
          } else {
            matchedName = String(mRow[24] || '').trim();
            matchedCccd = String(mRow[25] || '').trim();
            matchedPlate = String(mRow[27] || '').trim();
          }
          matchedPassword = '1';
          matchedUserRow = [matchedName, '', cleanPhone || '1', matchedCccd, '', '', '', matchedPlate, 'Xe máy', matchedRoom, '', '', '', '1', `HĐ-P${matchedRoom}`];
          break;
        }
      }
    }

    // Fallback 2: Khớp phòng qua Họ tên cư dân nếu matchedRoom chưa có
    if (matchedUserRow && !matchedRoom && lookupRows && lookupRows.length > 0) {
      const uName = (matchedName || '').toLowerCase().trim();
      for (let mIdx = 0; mIdx < lookupRows.length; mIdx++) {
        const mRow = lookupRows[mIdx];
        const colA = normalizeRoom(mRow[0]);
        let rDetect = colA;
        if (!rDetect && mIdx >= 5 && mIdx <= 11) rDetect = `G0${mIdx - 4}`;
        if (!rDetect && mIdx >= 41 && mIdx <= 44) rDetect = `LVC10${mIdx - 40}`;
        if (!rDetect && mIdx >= 45 && mIdx <= 48) rDetect = `LVC20${mIdx - 44}`;

        const n1 = String(mRow[16] || '').toLowerCase().trim();
        const n2 = String(mRow[20] || '').toLowerCase().trim();
        const n3 = String(mRow[24] || '').toLowerCase().trim();
        if (rDetect && uName && ((n1 && (n1.includes(uName) || uName.includes(n1))) || (n2 && (n2.includes(uName) || uName.includes(n2))) || (n3 && (n3.includes(uName) || uName.includes(n3))))) {
          matchedRoom = rDetect;
          break;
        }
      }
    }

    // Password validation: match exact or default '1' / '180505'
    // (skipped when the phone number was verified by Zalo)
    const isPassCorrect = Boolean(matchedUserRow) && (
      verifiedPhone ||
      (matchedPassword && matchedPassword === cleanPassword) ||
      (!matchedPassword && (cleanPassword === '1' || cleanPassword === '180505')) ||
      (matchedPassword === '180505' && cleanPassword === '180505')
    );

    if (verifiedPhone && !matchedUserRow) {
      return {
        success: false,
        errorCode: 'AUTH_TENANT_NOT_MAPPED',
        error: `Số điện thoại Zalo ${cleanPhone} chưa được đăng ký với phòng nào. Vui lòng liên hệ Chủ trọ để cập nhật SĐT.`
      };
    }

    // 1) Scenario 1: Incorrect credentials
    if (!matchedUserRow || !isPassCorrect) {
      return {
        success: false,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        error: 'Số điện thoại hoặc mật khẩu không chính xác.'
      };
    }

    // Column P: an account waiting for approval or rejected cannot sign in.
    const accountStatus = String(matchedUserRow[PROFILE_STATUS_COLUMN] || '').trim().toUpperCase();
    const isRejected = accountStatus === 'TẠM NGƯNG' || accountStatus === 'TỪ CHỐI';
    if (isRejected || accountStatus === 'ĐANG CHỜ DUYỆT' || accountStatus === 'CHỜ DUYỆT') {
      return {
        success: false,
        errorCode: isRejected ? 'AUTH_REJECTED' : 'AUTH_PENDING_APPROVAL',
        error: isRejected ? 'Tài khoản tạm khoá. Vui lòng liên hệ Ban quản lý.' : 'Tài khoản của bạn đang chờ chủ trọ xét duyệt.'
      };
    }

    // 0) CHECK CỘT J (index 9) TAB "THÔNG TIN CÁ NHÂN":
    // Column J may be a Sheets checkbox (TRUE/1) or an explicit admin marker.
    const effectiveRoomCheck = (matchedRoom || String(matchedUserRow[9] || '')).trim().toLowerCase();
    const isColumnIAdmin = ['true', '1', 'yes', '✓', '✔'].includes(effectiveRoomCheck) || effectiveRoomCheck.includes('admin') || cleanPhone === '0902371800';

    if (isColumnIAdmin) {
      const adminName = matchedName || String(matchedUserRow[0] || '').replace(/^(Họ và Tên|Họ tên)\s*/i, '').trim() || 'Quản Lý Chủ Trọ';
      const adminPhone = cleanPhone;
      const adminCccd = matchedCccd || String(matchedUserRow[3] || '').trim();
      const adminPlate = matchedPlate || String(matchedUserRow[7] || '').trim();

      const adminProfile: BackendTenantProfile = {
        name: adminName,
        phone: adminPhone,
        cccd: adminCccd,
        email: String(matchedUserRow[4] || '').trim(),
        dob: String(matchedUserRow[5] || '').trim(),
        address: String(matchedUserRow[6] || '').trim(),
        plateNumber: adminPlate,
        vehicleType: String(matchedUserRow[8] || '').trim(),
        roomNumber: 'admin',
        personType: 'person1',
        emergencyName: String(matchedUserRow[10] || '').trim(),
        emergencyRelation: String(matchedUserRow[11] || '').trim(),
        emergencyPhone: String(matchedUserRow[12] || '').trim(),
        rentPrice: 0,
        depositAmount: 0,
        totalMonthlyAmount: 0,
        isAdmin: true
      };

      return {
        success: true,
        isAdmin: true,
        user: adminProfile,
        invoices: []
      };
    }

    // 2) Scenario 2: No room found
    const rawRoom = matchedRoom || String(matchedUserRow[9] || '').trim();
    let roomNumber = normalizeRoom(rawRoom);
    if (!roomNumber) {
      return {
        success: false,
        errorCode: 'AUTH_NO_ROOM_FOUND',
        error: 'Không tìm thấy thông tin phòng của tài khoản này.'
      };
    }

    // 3) Scenario 3: the current month's tab does not exist yet, so log in with no bill.
    const hasMonthTab = monthlyRows.length > 0;

    // Dò dòng của phòng trong tab tháng hiện tại
    const roomMatch = findRoomRow(lookupRows, roomNumber, cleanPhone, matchedName)
      || (hasMonthTab ? null : { rowIndex: -1, rowData: [] as string[], detectedRoom: roomNumber });
    if (!roomMatch) {
      return {
        success: false,
        errorCode: 'AUTH_ROOM_NOT_IN_MONTHLY',
        error: 'Không tìm thấy dữ liệu phòng trong tháng hiện tại.'
      };
    }

    if (roomMatch.detectedRoom) {
      roomNumber = roomMatch.detectedRoom;
    }

    // 4) Xác định slot người thuê (Person 1, 2, or 3)
    const personType = identifyPersonByPhone(roomMatch.rowData, cleanPhone, matchedName, matchedCccd) || 'person1';

    // 5) Construct profile
    const personData = getPersonData(roomMatch.rowData, personType, roomNumber);
    const resolvedName = matchedName || String(matchedUserRow[0] || '').trim() || personData.name;

    if (!resolvedName) {
      return {
        success: false,
        errorCode: 'AUTH_DATA_INCOMPLETE',
        error: 'Dữ liệu người thuê chưa đầy đủ trong hệ thống (thiếu thông tin bắt buộc).'
      };
    }

    // The personal tab is the source of truth; a month tab only fills what it leaves blank.
    const effectiveLicensePlate = matchedPlate || String(matchedUserRow[7] || '').trim() || personData.licensePlate;

    // Construct final user profile
    const userProfile: BackendTenantProfile = {
      name: matchedName || String(matchedUserRow[0] || '').trim() || personData.name,
      phone: cleanPhone || normalizePhone(matchedUserRow[2]) || personData.phone || '0902371800',
      cccd: matchedCccd || String(matchedUserRow[3] || '').trim() || personData.citizenId,
      plateNumber: effectiveLicensePlate,
      roomNumber,
      personType,
      email: String(matchedUserRow[4] || '').replace(/^(Email Liên Hệ|Email)\s*/i, '').trim(),
      dob: String(matchedUserRow[5] || '').replace(/^(Ngày sinh)\s*/i, '').trim(),
      gender: String(matchedUserRow[PROFILE_GENDER_COLUMN] || '').trim(),
      address: String(matchedUserRow[6] || '').replace(/^(Địa chỉ thường trú|Địa chỉ)\s*/i, '').trim(),
      vehicleType: String(matchedUserRow[8] || '').includes('Xe máy') ? 'Xe máy' : (String(matchedUserRow[8] || '').trim() || 'Xe máy'),
      emergencyName: String(matchedUserRow[10] || '').replace(/^(Người liên hệ)\s*/i, '').trim(),
      emergencyRelation: String(matchedUserRow[11] || '').replace(/^(Mối quan hệ)\s*/i, '').trim(),
      emergencyPhone: String(matchedUserRow[12] || '').replace(/^(Số điện thoại khẩn)\s*/i, '').trim(),
      contractUrl: `HĐ-P${roomNumber.replace(/[^\w]/g, '')}`,
      rentPrice: parseSheetVNDAmount(roomMatch.rowData[9]) || 0,
      depositAmount: parseSheetVNDAmount(roomMatch.rowData[14]) || 0,
      totalMonthlyAmount: hasMonthTab ? parseSheetVNDAmount(roomMatch.rowData[15]) || 0 : 0
    };

    // Parse active room invoice strictly from Google Sheet Column P
    if (!hasMonthTab) {
      return { success: true, user: userProfile, invoices: [], message: 'Chưa có dữ liệu tháng này' };
    }
    const liveStatus = await getLiveRoomPaymentStatus(spreadsheetId, roomNumber);
    const invoice = parseInvoiceFromRoomRow(roomMatch.rowData, roomNumber, currentMonthTab, roomMatch.rowIndex, liveStatus);

    return {
      success: true,
      user: userProfile,
      invoices: [invoice]
    };
  } catch (error: any) {
    console.error('[authenticateUser] Error:', error);
    return { success: false, error: error.message || 'Lỗi xử lý xác thực từ Google Sheet' };
  }
}

/**
 * Main Service Function: Fetch Fresh Tenant Data & Invoices from Google Sheet
 */
export async function fetchFreshTenantDataFromSheet(params: {
  spreadsheetId?: string;
  phone?: string;
  roomNumber?: string;
  name?: string;
}): Promise<BackendTenantDataResponse> {
  const spreadsheetId = extractSpreadsheetId(params.spreadsheetId || DEFAULT_SPREADSHEET_ID);
  const targetPhone = normalizePhone(params.phone || '');
  const targetRoomInput = normalizeRoom(params.roomNumber || '');

  // If landlord admin queries fresh data, return admin profile
  if (targetPhone === '0902371800' || (params.name && params.name.toLowerCase().includes('bùi trung khải'))) {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      profile: {
        name: 'Bùi Trung Khải',
        phone: '0902371800',
        cccd: '079205019765',
        email: 'btkhai1508@gmail.com',
        dob: '15/08/2005',
        address: '109/6 Lê Văn Chí, P. Linh Xuân, TP. Thủ Đức',
        plateNumber: '',
        vehicleType: 'Xe máy',
        roomNumber: 'admin',
        personType: 'person1',
        emergencyName: '',
        emergencyRelation: '',
        emergencyPhone: '',
        password: '1',
        contractUrl: '',
        rentPrice: 0,
        depositAmount: 0,
        totalMonthlyAmount: 0
      },
      invoices: [],
      allResidentsCount: 70
    };
  }

  try {
    // 1. Fetch Profile Tab
    const profileRows = await fetchProfileRows(spreadsheetId);

    // Find the user's row by phone; one person per row.
    let userRoom = '';
    let userPlate = '';
    let userCccd = '';
    let userName = '';
    let userRow: string[] | null = null;

    if (targetPhone) {
      for (const row of profileRows) {
        const phoneCell = String(row[2] || '').trim();
        const phones = phoneCell.match(/(?:0|\+?84)[0-9]{8,11}/g) || [];
        const cleanPhones = phones.map(p => normalizePhone(p));
        const phoneIdx = cleanPhones.findIndex(p => p === targetPhone || (targetPhone.length >= 8 && p.endsWith(targetPhone.slice(-9))));
        if (phoneIdx !== -1) {
          userRow = row;
          userRoom = normalizeRoom(row[9]);
          userPlate = String(row[7] || '').trim();
          userCccd = String(row[3] || '').trim();
          userName = String(row[0] || '').trim();
          break;
        }
      }
    }

    let effectiveRoom = targetRoomInput || userRoom;

    // 2. Fetch Tab "Logs" (SePAY / Bank transfer logs)
    let logsRows: string[][] = [];
    const candidateLogsTabs = [DEFAULT_LOGS_TAB, 'Logs', 'logs', 'LOGS', 'Log', 'SePAY Logs', 'Giao dịch'];
    for (const tab of candidateLogsTabs) {
      try {
        const rows = await fetchSheetDataViaGviz(spreadsheetId, tab);
        if (rows && rows.length > 0) {
          logsRows = rows;
          break;
        }
      } catch {}
    }

    let isPaidInLogsTab = false;
    let logTxnDate = '';
    let logTxnCode = '';

    if (logsRows.length > 0) {
      for (const logRow of logsRows) {
        const colF = String(logRow[5] || '').toUpperCase().trim();
        const cleanColF = colF.replace(/[^0-9A-Z]/g, '');
        const roomClean = effectiveRoom.replace(/[^\d]/g, '') || '203';
        const currentMonthStr = '10';
        const currentYearStr = '2026';

        const p1 = `${roomClean}T${currentMonthStr}${currentYearStr}`;
        const p2 = `${roomClean}T${currentMonthStr}`;
        const p3 = `LVC${roomClean}T${currentMonthStr}${currentYearStr}`;
        const p4 = `LVC${roomClean}T${currentMonthStr}`;

        if (
          cleanColF.includes(p1) || cleanColF.includes(p2) ||
          cleanColF.includes(p3) || cleanColF.includes(p4) ||
          colF.includes(`${roomClean}-T${currentMonthStr}`) ||
          colF.includes(`LVC${roomClean}-T${currentMonthStr}`) ||
          colF.includes(`LVC${roomClean}`) ||
          colF.includes(roomClean)
        ) {
          isPaidInLogsTab = true;
          logTxnDate = String(logRow[0] || logRow[1] || '').trim();
          logTxnCode = String(logRow[2] || logRow[3] || 'SEPAY-LOG').trim();
          break;
        }
      }
    }

    // 3. Fetch Monthly Invoice Tab
    const { tabName: monthTabName, rows: monthlyRows } = await getCurrentMonthSheet(spreadsheetId);
    let activeInvoices: BackendInvoiceItem[] = [];
    let personData: PersonData | null = null;
    let roomRowData: string[] | null = null;

    if (monthlyRows.length === 0) {
      const lookupRows = await getLatestMonthRows(spreadsheetId);
      const lookup = findRoomRow(lookupRows, effectiveRoom, targetPhone, userName);
      if (lookup) {
        if (lookup.detectedRoom) effectiveRoom = lookup.detectedRoom;
        const personType = identifyPersonByPhone(lookup.rowData, targetPhone, userName, userCccd) || 'person1';
        personData = getPersonData(lookup.rowData, personType, effectiveRoom);
      }
    }

    if (monthlyRows.length > 0) {
      // Build room to row map from Column A
      const roomRowMap: Record<string, number> = {};
      for (let i = 0; i < monthlyRows.length; i++) {
        const colA = String(monthlyRows[i][0] || '').trim();
        const cleanR = normalizeRoom(colA);
        if (cleanR) roomRowMap[cleanR] = i;
        if (!colA && i >= 5 && i <= 11) {
          roomRowMap[`G0${i - 4}`] = i;
        }
        if (!colA && i >= 41 && i <= 44) {
          roomRowMap[`LVC10${i - 40}`] = i;
        }
        if (!colA && i >= 45 && i <= 48) {
          roomRowMap[`LVC20${i - 44}`] = i;
        }
      }

      const roomMatch = findRoomRow(monthlyRows, effectiveRoom, targetPhone);
      if (roomMatch) {
        roomRowData = roomMatch.rowData;
        if (roomMatch.detectedRoom) {
          effectiveRoom = roomMatch.detectedRoom;
        }
        // Identify person 1/2/3
        const personType = identifyPersonByPhone(roomRowData, targetPhone, userName, userCccd) || 'person1';
        personData = getPersonData(roomRowData, personType, effectiveRoom);

        // Live Column P status directly from Google Sheet (Google Sheet is Source of Truth)
        const liveStatus = await getLiveRoomPaymentStatus(spreadsheetId, effectiveRoom);

        // Parse room invoice (status strictly follows the color of Cột P)
        const currentInvoice = parseInvoiceFromRoomRow(roomRowData, effectiveRoom, liveStatus.tabName || monthTabName, roomMatch.rowIndex, liveStatus);
        activeInvoices.push(currentInvoice);
      }
    }

    // Build matched profile strictly for this user
    let matchedProfile: BackendTenantProfile | null = null;
    // The personal tab is the source of truth; a month tab only fills what it leaves blank.
    const effectivePlate = userPlate || (personData && personData.licensePlate) || '';

    matchedProfile = {
      name: userName || (personData && personData.name) || 'Cư dân Nhà Trọ Phong Lan',
      phone: targetPhone || (personData && personData.phone) || '',
      cccd: userCccd || (personData && personData.citizenId) || '',
      plateNumber: effectivePlate,
      roomNumber: effectiveRoom,
      personType: personData?.personType || 'person1',
      email: userRow ? String(userRow[4] || '').trim() : '',
      dob: userRow ? String(userRow[5] || '').trim() : '',
      gender: userRow ? String(userRow[PROFILE_GENDER_COLUMN] || '').trim() : '',
      address: userRow ? String(userRow[6] || '').trim() : '',
      vehicleType: userRow ? String(userRow[8] || '').trim() || 'Xe máy' : 'Xe máy',
      emergencyName: userRow ? String(userRow[10] || '').trim() : '',
      emergencyRelation: userRow ? String(userRow[11] || '').trim() : '',
      emergencyPhone: userRow ? String(userRow[12] || '').trim() : '',
      password: userRow ? String(userRow[13] || '').trim() || '180505' : '180505',
      contractUrl: '',
      rentPrice: roomRowData ? parseSheetVNDAmount(roomRowData[9]) : 0,
      depositAmount: roomRowData ? parseSheetVNDAmount(roomRowData[14]) : 0,
      totalMonthlyAmount: roomRowData ? parseSheetVNDAmount(roomRowData[15]) : 0
    };

    return {
      success: true,
      timestamp: new Date().toISOString(),
      profile: matchedProfile,
      invoices: activeInvoices,
      allResidentsCount: profileRows.length,
      logsTransactionFound: isPaidInLogsTab,
      latestLogsTxn: isPaidInLogsTab ? { date: logTxnDate, code: logTxnCode, content: `${effectiveRoom}-T10-2026` } : undefined
    };
  } catch (error: any) {
    console.error('[fetchFreshTenantDataFromSheet] Error:', error);
    return {
      success: false,
      timestamp: new Date().toISOString(),
      profile: null,
      invoices: [],
      allResidentsCount: 0,
      error: error.message || 'Lỗi đọc dữ liệu Google Sheet'
    };
  }
}
