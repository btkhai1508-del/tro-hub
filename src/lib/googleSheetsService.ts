import { Invoice, InvoiceDetailItem, UserProfile } from '../context/AppContext';
import { apiUrl } from './api';

export interface SheetResidentInfo {
  name: string;
  phone: string;
  cccd: string;
  email: string;
  dob: string;
  address: string;
  plateNumber: string;
  vehicleType: string;
  roomNumber: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

export interface SheetMonthlyInvoiceRow {
  roomNumber: string;
  electricOld: number;
  electricNew: number;
  electricUsage: number;
  waterOld: number;
  waterNew: number;
  waterUsage: number;
  electricCost: number;
  waterCost: number;
  roomCost: number;
  trashCost: number;
  internetCost: number;
  vehicleCost: number;
  otherCost: number;
  depositCost: number;
  totalCost: number;
  status: 'unpaid' | 'paid';
  rawStatusLabel: 'chưa thanh toán' | 'đang chờ xác nhận' | 'đã xác nhận';
  colorCode?: string;
  // Residents in this room
  tenant1: { name: string; cccd: string; phone: string; plateNumber: string };
  tenant2: { name: string; cccd: string; phone: string; plateNumber: string };
  tenant3: { name: string; cccd: string; phone: string; plateNumber: string };
  totalPeople: number;
  totalVehicles: number;
}

/**
 * Extracts spreadsheetId from full URL or returns raw ID
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return input.trim();
}

/**
 * Normalize room identifier (e.g. "P.203" -> "203", "P. G01" -> "G01", "P.LVC101" -> "LVC-101")
 */
export function normalizeRoomId(input: any): string {
  if (!input) return '';
  let str = String(input).trim().toUpperCase();
  str = str.replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').trim();
  str = str.replace(/\.0+$/, '').trim();
  if (str.includes('LVC')) {
    const num = str.replace(/\D/g, '');
    return num ? `LVC-${num}` : str;
  }
  if (/^G\d+$/i.test(str)) {
    const num = str.replace(/\D/g, '');
    return `G${num.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(str)) {
    return str.replace(/^0+/, '') || str;
  }
  return str;
}

/**
 * Checks whether two room strings match (exact, without prefix, or by room digits)
 * CRITICAL: LVC rooms (e.g. LVC101) must NEVER match standard rooms (e.g. 101)
 */
export function isSameRoom(roomA: string, roomB: string): boolean {
  const normA = normalizeRoomId(roomA);
  const normB = normalizeRoomId(roomB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const isLvcA = normA.includes('LVC');
  const isLvcB = normB.includes('LVC');
  if (isLvcA !== isLvcB) return false;

  const isGroundA = normA.startsWith('G');
  const isGroundB = normB.startsWith('G');
  if (isGroundA !== isGroundB) return false;

  const alnumA = normA.replace(/[^0-9A-Z]/g, '');
  const alnumB = normB.replace(/[^0-9A-Z]/g, '');
  if (alnumA && alnumB && alnumA === alnumB) return true;

  const numA = normA.replace(/[^\d]/g, '');
  const numB = normB.replace(/[^\d]/g, '');
  if (numA && numB && numA === numB) return true;

  return false;
}

/**
 * Clean numeric values like "120 kWh", "5 m3" into pure number without currency scaling
 */
export function parseSheetNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).trim().replace(/[^\d.,-]/g, '');
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes('.') && str.split('.').length > 2) {
    str = str.replace(/\./g, '');
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse VND currency amounts from sheet. Automatically appends 3 zeros if written in thousands or millions.
 * E.g. 2494 -> 2,494,000 | "2.494" -> 2,494,000 | 350 -> 350,000 | 100 -> 100,000 | 2494000 -> 2,494,000
 */
export function parseSheetVNDAmount(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  
  let num = 0;
  if (typeof val === 'number') {
    num = val;
  } else {
    let str = String(val).trim().replace(/\s*đ/gi, '').replace(/\s*vnd/gi, '');
    if (!str) return 0;
    
    // Normalize thousand separators
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
        str = str.replace(/\./g, '');
        num = parseFloat(str.replace(/[^\d.-]/g, ''));
      } else if (parts.length === 2) {
        if (parts[1].length === 3) {
          num = parseFloat(str.replace(/\./g, ''));
        } else {
          num = parseFloat(str.replace(/[^\d.-]/g, ''));
        }
      }
    } else if (str.includes(',')) {
      const parts = str.split(',');
      if (parts.length > 2) {
        str = str.replace(/,/g, '');
        num = parseFloat(str.replace(/[^\d.-]/g, ''));
      } else if (parts.length === 2 && parts[1].length === 3) {
        num = parseFloat(str.replace(/,/g, ''));
      } else {
        num = parseFloat(str.replace(/,/g, '.'));
      }
    } else {
      num = parseFloat(str.replace(/[^\d.-]/g, ''));
    }
  }

  if (isNaN(num) || num <= 0) return 0;

  // Scale up to realistic VND integer amounts:
  // If < 10 (e.g. 2.494, 3.5, 0.28): it represents millions -> * 1,000,000 (2.494 -> 2,494,000)
  if (num < 10) {
    return Math.round(num * 1000000);
  }
  // If 10 <= num < 10000 (e.g. 2494, 350, 100, 3000, 4500): it represents thousands -> * 1,000 (2494 -> 2,494,000)
  if (num < 10000) {
    return Math.round(num * 1000);
  }
  // Otherwise num is already in full VND (e.g. 2494000, 3000000, 280000)
  return Math.round(num);
}

/**
 * Helper to determine payment status from cell background color and string value
 * Green (#d4edda) / Blue -> Paid (Bank transfer)
 * Yellow (#fff3cd) -> Pending confirmation
 * Red / Any red shade / Default / White -> Unpaid ("Chưa thanh toán")
 */
function resolvePaymentStatus(
  cellBg?: { red?: number; green?: number; blue?: number },
  textValue?: string
): { status: 'unpaid' | 'paid'; label: 'chưa thanh toán' | 'đang chờ xác nhận' | 'đã thanh toán' } {
  // If no background format exists or undefined, check text
  if (!cellBg || (cellBg.red === undefined && cellBg.green === undefined && cellBg.blue === undefined)) {
    const text = (textValue || '').toLowerCase();
    if (text.includes('đã thanh toán') || text.includes('đã đóng') || text.includes('đã nhận') || text.includes('d4edda')) {
      return { status: 'paid', label: 'đã thanh toán' };
    }
    if (text.includes('chờ xác nhận') || text.includes('fff3cd') || text.includes('chờ duyệt')) {
      return { status: 'unpaid', label: 'đang chờ xác nhận' };
    }
    return { status: 'unpaid', label: 'chưa thanh toán' };
  }

  const r = cellBg.red ?? 0;
  const g = cellBg.green ?? 0;
  const b = cellBg.blue ?? 0;

  // 1. Green (#d4edda: r~0.83, g~0.93, b~0.85 -> g is strictly highest, or g > 0.75 and g > r and g > b) -> Paid via transfer
  if ((g > 0.7 && g > r && g > b) || (b > 0.85 && b > r && b > g)) {
    return { status: 'paid', label: 'đã thanh toán' };
  }

  // 2. Yellow (#fff3cd: r~1, g~0.95, b~0.8 -> r & g high, b lower) -> Pending
  if (r > 0.85 && g > 0.85 && b < 0.85) {
    return { status: 'unpaid', label: 'đang chờ xác nhận' };
  }

  // 3. Red / Any red shade (#f8d7da or #ff0000 or any red dominant color) -> Unpaid
  if (r > 0.75 && (r > g || r > b)) {
    return { status: 'unpaid', label: 'chưa thanh toán' };
  }

  // 4. Default/White background -> Unpaid
  return { status: 'unpaid', label: 'chưa thanh toán' };
}

/**
 * Fetches all sheet / tab metadata
 */
export async function getSpreadsheetDetails(
  spreadsheetId: string, 
  accessToken: string
): Promise<{ title: string; sheets: string[] }> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to access spreadsheet (${res.status})`);
  }

  const data = await res.json();
  const sheets = (data.sheets || []).map((s: any) => s.properties?.title || '').filter(Boolean);
  return {
    title: data.properties?.title || 'Bảng tính Nhà Trọ Phong Lan',
    sheets
  };
}

/**
 * Reads Profile Tab according to user's exact specification:
 * Header: Họ và Tên (A), SĐT (B), CCCD (C), Email Liên Hệ (D), Ngày sinh (E), Địa chỉ thường trú (F), Biển soó xe (G), Loại xe dòng xe (H), Phòng số (I), Người liên hệ (J), Mối quan hệ (K), Số điện thoại khẩn (L), Password/Mật khẩu (M)
 */
export async function fetchResidentProfileFromSheet(
  spreadsheetId: string,
  tabName: string,
  accessToken: string,
  targetRoomOrPhone?: string
): Promise<(UserProfile & { password?: string }) | null> {
  const range = `${tabName}!A2:M50`;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    throw new Error(`Cannot read resident profile tab "${tabName}"`);
  }

  const data = await res.json();
  const rows: any[][] = data.values || [];
  if (rows.length === 0) return null;

  // Find target row by phone or roomNumber or take first row
  let row = rows[0];
  if (targetRoomOrPhone) {
    const cleanTarget = targetRoomOrPhone.replace(/\s+/g, '').toLowerCase();
    const found = rows.find(r => {
      const nameVal = String(r[0] || '').trim().toLowerCase();
      const phoneVal = String(r[1] || '').replace(/\s+/g, '');
      const emailVal = String(r[3] || '').trim().toLowerCase();
      const roomVal = String(r[8] || '').trim().replace(/[^\d]/g, '');
      return (
        phoneVal === cleanTarget || 
        emailVal === cleanTarget ||
        nameVal.includes(cleanTarget) ||
        roomVal === cleanTarget.replace(/[^\d]/g, '')
      );
    });
    if (found) row = found;
  }

  const name = String(row[0] || '').trim();
  const phone = String(row[1] || '').trim();
  const cccd = String(row[2] || '').trim();
  const email = String(row[3] || '').trim();
  const dob = String(row[4] || '').trim();
  const address = String(row[5] || '').trim();
  const plateNumber = String(row[6] || '').trim();
  const vehicleType = String(row[7] || '').trim();
  const roomNumber = String(row[8] || '').trim();
  const emergencyName = String(row[9] || '').trim();
  const emergencyRelationship = String(row[10] || '').trim();
  const emergencyPhone = String(row[11] || '').trim();
  const password = String(row[12] || '').trim();

  return {
    name: name || 'Cư dân Nhà Trọ Phong Lan',
    phone: phone || '',
    email,
    cccd,
    dob,
    address,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
    vehicle: {
      type: vehicleType,
      plateNumber,
      parkingSlot: 'Bãi giữ xe máy',
      registeredDate: ''
    },
    emergencyContact: {
      name: emergencyName,
      phone: emergencyPhone,
      relationship: emergencyRelationship
    },
    room: {
      roomNumber: roomNumber ? (roomNumber.startsWith('P.') ? roomNumber : `P. ${roomNumber}`) : '',
      building: (roomNumber && roomNumber.toUpperCase().includes('LVC')) ? 'Lê Văn Chí' : 'Trung Kim',
      floor: '',
      startDate: ''
    },
    password
  };
}

/**
 * Robust CSV parser for Google Sheet export
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

export interface SheetResidentAccount {
  name: string;
  phone: string;
  cccd: string;
  email: string;
  dob: string;
  address: string;
  plateNumber: string;
  vehicleType: string;
  roomNumber: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  password: string;
  contractUrl?: string;        // Column N (14th column): Hợp đồng thuê
  rentPrice?: number;          // Column J (Tiền phòng)
  depositAmount?: number;      // Column O (Tiền cọc)
  totalMonthlyAmount?: number; // Column P (Tổng cộng)
  rowIndex: number;
}

export const DEFAULT_SPREADSHEET_ID = '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
export const DEFAULT_PROFILE_TAB = 'THÔNG TIN CÁ NHÂN';
export const DEFAULT_MONTHLY_TAB = '10/2026';

export interface RoomOccupant {
  name: string;
  cccd: string;
  phone: string;
  plateNumber: string;
}

export interface SheetRoomInfo {
  roomNumber: string;
  cleanRoomNumber: string;
  electricOld: number;
  electricNew: number;
  electricUsage: number;
  waterOld: number;
  waterNew: number;
  waterUsage: number;
  electricCost: number;
  waterCost: number;
  roomCost: number;
  trashCost: number;
  internetCost: number;
  vehicleCost: number;
  otherCost: number;
  depositCost: number;
  totalCost: number;
  status: 'unpaid' | 'paid';
  tenants: RoomOccupant[];
  totalPeople: number;
  totalVehicles: number;
}

/**
 * Reads all residents by synchronizing both THÔNG TIN CÁ NHÂN and monthly tab 10/2026
 * Columns in THÔNG TIN CÁ NHÂN (A-M):
 * A: Họ và Tên, B: SĐT, C: CCCD, D: Email, E: Ngày sinh, F: Địa chỉ thường trú,
 * G: Biển số xe, H: Loại xe, I: Phòng số, J: Người liên hệ, K: Mối quan hệ, L: SĐT khẩn, M: Password
 *
 * Columns in 10/2026 (A-AD):
 * A: Phòng, B..P: Tiền điện/nước/dịch vụ,
 * Q-T: Người 1 (Tên, CCCD, SĐT, Biển số xe),
 * U-X: Người 2 (Tên, CCCD, SĐT, Biển số xe),
 * Y-AB: Người 3 (Tên, CCCD, SĐT, Biển số xe),
 * AC: Tổng người, AD: Tổng xe
 */
export async function fetchAllResidentsFromSheet(
  spreadsheetId: string = DEFAULT_SPREADSHEET_ID,
  tabName: string = DEFAULT_PROFILE_TAB,
  accessToken?: string | null
): Promise<SheetResidentAccount[]> {
  const cleanId = extractSpreadsheetId(spreadsheetId) || DEFAULT_SPREADSHEET_ID;
  if (!cleanId) return [];

  const residents: SheetResidentAccount[] = [];

  // 1. Fetch from THÔNG TIN CÁ NHÂN
  const candidateTabs = Array.from(new Set([
    tabName,
    'THÔNG TIN CÁ NHÂN',
    'Thông tin cá nhân',
    'THONG TIN CA NHAN'
  ]));

  let profileRows: string[][] = [];

  for (const currentTab of candidateTabs) {
    if (accessToken) {
      try {
        const range = `${currentTab}!A2:M100`;
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(range)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.values && data.values.length > 0) {
            profileRows = data.values;
            break;
          }
        }
      } catch (e) {
        console.warn('API fetch failed, trying public export:', e);
      }
    }

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(currentTab)}`;
      const res = await fetch(csvUrl);
      if (res.ok) {
        const csvText = await res.text();
        const parsed = parseCSV(csvText);
        if (parsed.length > 0) {
          if (String(parsed[0][0] || '').toLowerCase().includes('họ')) {
            profileRows = parsed.slice(1);
          } else {
            profileRows = parsed;
          }
          if (profileRows.length > 0) break;
        }
      }
    } catch (e) {
      console.warn(`CSV export fetch failed for tab ${currentTab}:`, e);
    }
  }

  // Populate from profile tab
  profileRows.forEach((row, idx) => {
    const name = String(row[0] || '').trim();
    const phone = String(row[1] || '').trim();
    if (name || phone) {
      residents.push({
        name,
        phone: phone || '1',
        cccd: String(row[2] || '').trim(),
        email: String(row[3] || '').trim(),
        dob: String(row[4] || '').trim(),
        address: String(row[5] || '').trim(),
        plateNumber: String(row[6] || '').trim(),
        vehicleType: String(row[7] || '').trim() || 'Xe máy',
        roomNumber: String(row[8] || '').trim(),
        emergencyName: String(row[9] || '').trim(),
        emergencyRelation: String(row[10] || '').trim(),
        emergencyPhone: String(row[11] || '').trim(),
        password: String(row[12] || '').trim() || '180505',
        contractUrl: String(row[13] || '').trim(), // Column N: Hợp đồng thuê
        rowIndex: idx + 2
      });
    }
  });

  // 2. Fetch from Monthly tab (10/2026) to extract and link all occupants & room numbers
  try {
    const monthTabs = ['10/2026', 'T10/2026', '10', 'Tháng 10'];
    let monthRows: string[][] = [];

    for (const mTab of monthTabs) {
      try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(mTab)}`;
        const res = await fetch(csvUrl);
        if (res.ok) {
          const csvText = await res.text();
          const parsed = parseCSV(csvText);
          if (parsed.length > 10) {
            monthRows = parsed;
            break;
          }
        }
      } catch {}
    }

    if (monthRows.length > 5) {
      // Room rows start at index 5 through 48
      monthRows.slice(5, 49).forEach((r, rowIdx) => {
        let room = r[0] ? r[0].trim() : '';
        if (!room) {
          if (rowIdx < 7) room = `G0${rowIdx + 1}`;
          else room = `40${rowIdx - 35}`;
        }
        const cleanRoom = room.startsWith('P.') ? room : `P. ${room}`;

        // Costs from columns J, O, P (VND with 3 zeros added if in thousands)
        const roomRent = parseSheetVNDAmount(r[9]);       // Col J: Tiền phòng
        const roomDeposit = parseSheetVNDAmount(r[14]);    // Col O: Tiền cọc
        const roomTotal = parseSheetVNDAmount(r[15]);      // Col P: Tổng cộng

        const tenants = [
          { name: String(r[16] || '').trim(), cccd: String(r[17] || '').trim(), phone: String(r[18] || '').trim(), plateNumber: String(r[19] || '').trim() },
          { name: String(r[20] || '').trim(), cccd: String(r[21] || '').trim(), phone: String(r[22] || '').trim(), plateNumber: String(r[23] || '').trim() },
          { name: String(r[24] || '').trim(), cccd: String(r[25] || '').trim(), phone: String(r[26] || '').trim(), plateNumber: String(r[27] || '').trim() }
        ];

        tenants.forEach((t) => {
          if (t.name && t.name !== '1') {
            const cleanPhone = t.phone.replace(/[\s.-]/g, '');
            const existing = residents.find(res => {
              const resP = res.phone.replace(/[\s.-]/g, '');
              return (cleanPhone && cleanPhone !== '1' && resP === cleanPhone) ||
                     (res.name.toLowerCase() === t.name.toLowerCase());
            });

            if (existing) {
              if (!existing.roomNumber) existing.roomNumber = cleanRoom;
              if (!existing.cccd && t.cccd) existing.cccd = t.cccd;
              if (!existing.plateNumber && t.plateNumber) existing.plateNumber = t.plateNumber;
              if (roomRent > 0 && !existing.rentPrice) existing.rentPrice = roomRent;
              if (roomDeposit > 0 && !existing.depositAmount) existing.depositAmount = roomDeposit;
              if (roomTotal > 0 && !existing.totalMonthlyAmount) existing.totalMonthlyAmount = roomTotal;
            } else {
              const effectivePhone = t.phone || '1';
              residents.push({
                name: t.name,
                phone: effectivePhone,
                cccd: t.cccd || '',
                email: '',
                dob: '',
                address: '',
                plateNumber: t.plateNumber || '',
                vehicleType: 'Xe máy',
                roomNumber: cleanRoom,
                emergencyName: '',
                emergencyRelation: '',
                emergencyPhone: '',
                password: effectivePhone && effectivePhone !== '1' ? effectivePhone.slice(-6) : '180505',
                rentPrice: roomRent,
                depositAmount: roomDeposit,
                totalMonthlyAmount: roomTotal,
                rowIndex: rowIdx + 6
              });
            }
          }
        });
      });
    }
  } catch (err) {
    console.warn('Could not sync occupants from monthly tab:', err);
  }

  return residents;
}

/**
 * Updates or writes Resident Profile back to Google Sheet immediately
 * Row format: A: Họ và Tên, B: SĐT, C: CCCD, D: Email, E: Ngày sinh, F: Địa chỉ thường trú,
 * G: Biển số xe, H: Loại xe dòng xe, I: Phòng số, J: Người liên hệ, K: Mối quan hệ, L: Số điện thoại khẩn, M: Password
 */
export async function updateResidentProfileToSheet(
  spreadsheetId: string,
  tabName: string,
  accessToken: string,
  profileData: {
    name: string;
    phone: string;
    cccd?: string;
    email?: string;
    dob?: string;
    address?: string;
    plateNumber?: string;
    vehicleType?: string;
    roomNumber?: string;
    emergencyName?: string;
    emergencyRelation?: string;
    emergencyPhone?: string;
    password?: string;
    contractUrl?: string;
  }
): Promise<{ success: boolean; rowIndex: number; sheetName: string }> {
  if (!spreadsheetId || !accessToken) {
    throw new Error('Chưa có thông tin bảng tính Google Sheet hoặc phiên đăng nhập Google');
  }

  const cleanId = extractSpreadsheetId(spreadsheetId);

  // 1. Auto-detect exact tab title from spreadsheet metadata
  let effectiveTab = tabName || DEFAULT_PROFILE_TAB;
  try {
    const meta = await getSpreadsheetDetails(cleanId, accessToken);
    const foundTab = (meta.sheets || []).find((s: string) => 
      s.toLowerCase().includes('cá nhân') || 
      s.toLowerCase().includes('ca nhan') ||
      s.toLowerCase().includes('thông tin') ||
      s.toLowerCase() === tabName.toLowerCase()
    );
    if (foundTab) {
      effectiveTab = foundTab;
    }
  } catch (metaErr) {
    console.warn('Could not read sheet metadata, using default tab name:', metaErr);
  }

  // 2. Locate the resident row index by matching phone, room, CCCD or name
  let targetRow = 2;
  const getRange = `${effectiveTab}!A2:I50`;
  const getRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(getRange)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (getRes.ok) {
    const data = await getRes.json();
    const rows: string[][] = data.values || [];
    const cleanPhone = profileData.phone.replace(/[\s.-]/g, '');
    const cleanName = profileData.name.trim().toLowerCase();
    const cleanRoom = (profileData.roomNumber || '').replace(/[^\d]/g, '');
    const cleanCccd = (profileData.cccd || '').trim();

    const foundIdx = rows.findIndex((r) => {
      const rPhone = String(r[1] || '').replace(/[\s.-]/g, '');
      const rName = String(r[0] || '').trim().toLowerCase();
      const rCccd = String(r[2] || '').trim();
      const rRoom = String(r[8] || '').replace(/[^\d]/g, '');

      return (
        (cleanPhone && rPhone === cleanPhone) ||
        (cleanCccd && rCccd === cleanCccd) ||
        (cleanRoom && rRoom === cleanRoom) ||
        (cleanName && rName.includes(cleanName))
      );
    });

    if (foundIdx !== -1) {
      targetRow = foundIdx + 2; // Rows start at 2
    } else if (rows.length > 0) {
      targetRow = rows.length + 2;
    }
  }

  // Clean room representation (strip 'P.' prefix if needed or store clean)
  const cleanRoom = (profileData.roomNumber || '').replace(/^P\.\s*/i, '').trim();

  // 3. Prepare 14 columns (A through N)
  const rowValues = [
    profileData.name || '',
    profileData.phone || '',
    profileData.cccd || '',
    profileData.email || '',
    profileData.dob || '',
    profileData.address || '',
    profileData.plateNumber || '',
    profileData.vehicleType || 'Xe máy',
    cleanRoom ? `P. ${cleanRoom}` : '',
    profileData.emergencyName || '',
    profileData.emergencyRelation || '',
    profileData.emergencyPhone || '',
    profileData.password || '180505',
    profileData.contractUrl || (cleanRoom ? `HĐ-${cleanRoom.replace(/[^\w]/g, '')}` : '')
  ];

  const updateRange = `${effectiveTab}!A${targetRow}:N${targetRow}`;
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        range: updateRange,
        majorDimension: 'ROWS',
        values: [rowValues]
      })
    }
  );

  if (!updateRes.ok) {
    const errData = await updateRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Lỗi cập nhật Google Sheet (${updateRes.status})`);
  }

  return { success: true, rowIndex: targetRow, sheetName: effectiveTab };
}

/**
 * Copies and synchronizes all occupants from monthly tab (Q to AB) into THÔNG TIN CÁ NHÂN (Columns A through N)
 */
export async function syncAllOccupantsToProfileTabInGoogleSheet(
  spreadsheetId: string,
  accessToken: string,
  monthlyTab: string = DEFAULT_MONTHLY_TAB,
  profileTab: string = DEFAULT_PROFILE_TAB
): Promise<{ success: boolean; totalRows: number }> {
  if (!spreadsheetId || !accessToken) {
    throw new Error('Cần cấp quyền truy cập Google để chỉnh sửa Google Sheet trực tiếp.');
  }

  // 1. Fetch monthly tab data
  const range = `${monthlyTab}!A6:AB50`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Không thể đọc dữ liệu từ tab ${monthlyTab}`);
  }

  const data = await res.json();
  const rows: string[][] = data.values || [];

  const rowsToWrite: string[][] = [];

  rows.forEach((r, idx) => {
    let room = r[0] ? r[0].trim() : '';
    if (!room) {
      if (idx < 7) room = `G0${idx + 1}`;
      else room = `40${idx - 35}`;
    }
    const cleanRoom = room.startsWith('P.') ? room : `P. ${room}`;

    const tenants = [
      { name: String(r[16] || '').trim(), cccd: String(r[17] || '').trim(), phone: String(r[18] || '').trim(), plateNumber: String(r[19] || '').trim() },
      { name: String(r[20] || '').trim(), cccd: String(r[21] || '').trim(), phone: String(r[22] || '').trim(), plateNumber: String(r[23] || '').trim() },
      { name: String(r[24] || '').trim(), cccd: String(r[25] || '').trim(), phone: String(r[26] || '').trim(), plateNumber: String(r[27] || '').trim() }
    ];

    tenants.forEach(t => {
      if (t.name && t.name !== '1') {
        const effPhone = t.phone || '1';
        const password = effPhone !== '1' ? effPhone.slice(-6) : '180505';
        rowsToWrite.push([
          t.name,               // A: Họ và Tên
          effPhone,             // B: SĐT
          t.cccd || '',         // C: CCCD
          '',                   // D: Email Liên Hệ
          '',                   // E: Ngày sinh
          '',                   // F: Địa chỉ thường trú
          t.plateNumber || '',  // G: Biển số xe
          'Xe máy',             // H: Loại xe dòng xe
          cleanRoom,            // I: Phòng số
          '',                   // J: Người liên hệ
          '',                   // K: Mối quan hệ
          '',                   // L: Số điện thoại khẩn
          password,             // M: Password
          `HĐ-${cleanRoom.replace(/[^\w]/g, '')}` // N: Hợp đồng thuê
        ]);
      }
    });
  });

  if (rowsToWrite.length === 0) {
    return { success: true, totalRows: 0 };
  }

  // 2. Write to THÔNG TIN CÁ NHÂN starting at row 2
  const writeRange = `${profileTab}!A2:N${rowsToWrite.length + 1}`;
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        range: writeRange,
        majorDimension: 'ROWS',
        values: rowsToWrite
      })
    }
  );

  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Không thể ghi vào tab THÔNG TIN CÁ NHÂN');
  }

  return { success: true, totalRows: rowsToWrite.length };
}

/**
 * Reads Monthly Tab with Row 7 onwards and Columns A through AD:
 * A: Phòng, B: Điện cũ, C: Điện mới, D: Điện TT, E: Nước cũ, F: Nước mới, G: Nước TT
 * H: Tiền điện, I: Tiền nước, J: Tiền phòng, K: Tiền rác, L: Internet, M: Tiền xe, N: Tiền khác, O: Cọc, P: Tổng cộng (Color: red=unpaid, yellow=pending, green=paid)
 * Q, R, S, T: Người 1 (Tên, CCCD, SĐT, Biển số xe)
 * U, V, W, X: Người 2 (Tên, CCCD, SĐT, Biển số xe)
 * Y, Z, AA, AB: Người 3 (Tên, CCCD, SĐT, Biển số xe)
 * AC: Tổng người, AD: Tổng xe
 */
export async function fetchMonthlyInvoicesFromSheet(
  spreadsheetId: string = DEFAULT_SPREADSHEET_ID,
  tabName: string = DEFAULT_MONTHLY_TAB,
  accessTokenOrRoom?: string | null,
  targetRoomNumber?: string,
  targetPhone?: string
): Promise<Invoice | null> {
  const cleanId = extractSpreadsheetId(spreadsheetId) || DEFAULT_SPREADSHEET_ID;
  if (!cleanId) return null;

  let accessToken: string | null = null;
  let effectiveRoom = targetRoomNumber;
  let effectivePhone = targetPhone;

  // Flexible argument handling: If 3rd param is not an OAuth Bearer token, it's the room number
  if (accessTokenOrRoom && typeof accessTokenOrRoom === 'string') {
    if (accessTokenOrRoom.startsWith('ya29.') || accessTokenOrRoom.length > 40) {
      accessToken = accessTokenOrRoom;
    } else {
      effectiveRoom = accessTokenOrRoom;
      effectivePhone = targetRoomNumber || targetPhone;
      accessToken = null;
    }
  }

  const cleanTargetRoom = normalizeRoomId(effectiveRoom || '203');
  const cleanTargetPhone = (effectivePhone || '').replace(/[^\d]/g, '');

  const candidateTabs = Array.from(new Set([
    tabName,
    '10/2026',
    'T10/2026',
    '10',
    'Tháng 10',
    'Tháng 10/2026'
  ]));

  // 1. Try Google Sheets API v4 if accessToken provided
  if (accessToken) {
    for (const curTab of candidateTabs) {
      try {
        const range = `${curTab}!A1:AD60`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=sheets.data.rowData.values(effectiveValue,formattedValue,userEnteredFormat.backgroundColor,effectiveFormat.backgroundColor)`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (res.ok) {
          const responseJson = await res.json();
          const rowData: any[] = responseJson.sheets?.[0]?.data?.[0]?.rowData || [];

          if (rowData.length > 0) {
            let targetRowIndex = -1;
            
            // Search rows
            for (let i = 0; i < rowData.length; i++) {
              const cells = rowData[i]?.values || [];
              let roomVal = String(cells[0]?.formattedValue || cells[0]?.effectiveValue?.stringValue || '').trim();
              if (!roomVal && i >= 5 && i <= 11) roomVal = `G0${i - 4}`;
              else if (!roomVal && i >= 41 && i <= 44) roomVal = `LVC-10${i - 40}`;
              else if (!roomVal && i >= 45 && i <= 48) roomVal = `LVC-20${i - 44}`;

              const p1 = String(cells[18]?.formattedValue || cells[18]?.effectiveValue?.stringValue || '').replace(/[^\d]/g, '');
              const p2 = String(cells[22]?.formattedValue || cells[22]?.effectiveValue?.stringValue || '').replace(/[^\d]/g, '');
              const p3 = String(cells[26]?.formattedValue || cells[26]?.effectiveValue?.stringValue || '').replace(/[^\d]/g, '');

              // Check phone match first
              if (cleanTargetPhone && cleanTargetPhone.length >= 9 && (p1.endsWith(cleanTargetPhone.slice(-9)) || p2.endsWith(cleanTargetPhone.slice(-9)) || p3.endsWith(cleanTargetPhone.slice(-9)))) {
                targetRowIndex = i;
                break;
              }

              // Or room match
              if (cleanTargetRoom && roomVal && isSameRoom(roomVal, cleanTargetRoom)) {
                targetRowIndex = i;
                break;
              }
            }

            // Fallback to row 43 if row 43-50
            if (targetRowIndex === -1 && rowData.length >= 43) {
              for (let i = 42; i < Math.min(51, rowData.length); i++) {
                const cells = rowData[i]?.values || [];
                const roomVal = String(cells[0]?.formattedValue || cells[0]?.effectiveValue?.stringValue || '').trim();
                if (roomVal) {
                  targetRowIndex = i;
                  break;
                }
              }
            }

            if (targetRowIndex !== -1) {
              const cells = rowData[targetRowIndex]?.values || [];
              const getCellVal = (idx: number) => {
                const c = cells[idx];
                return c?.formattedValue || c?.effectiveValue?.numberValue || c?.effectiveValue?.stringValue || '';
              };

              const roomNumber = String(getCellVal(0)).trim() || cleanTargetRoom || '203';
              const electricOld = parseSheetNumber(getCellVal(1));
              const electricNew = parseSheetNumber(getCellVal(2));
              const electricUsage = parseSheetNumber(getCellVal(3)) || (electricNew > electricOld ? electricNew - electricOld : 0);

              const waterOld = parseSheetNumber(getCellVal(4));
              const waterNew = parseSheetNumber(getCellVal(5));
              const waterUsage = parseSheetNumber(getCellVal(6)) || (waterNew > waterOld ? waterNew - waterOld : 0);

              const electricCost = parseSheetVNDAmount(getCellVal(7));
              const waterCost = parseSheetVNDAmount(getCellVal(8));
              const roomCost = parseSheetVNDAmount(getCellVal(9));
              const trashCost = parseSheetVNDAmount(getCellVal(10));
              const internetCost = parseSheetVNDAmount(getCellVal(11));
              const vehicleCost = parseSheetVNDAmount(getCellVal(12));
              const otherCost = parseSheetVNDAmount(getCellVal(13));
              const depositCost = parseSheetVNDAmount(getCellVal(14));
              const totalCost = parseSheetVNDAmount(getCellVal(15)) || (roomCost + electricCost + waterCost + trashCost + internetCost + vehicleCost + otherCost);

              const totalCell = cells[15];
              const bgColor = totalCell?.userEnteredFormat?.backgroundColor || totalCell?.effectiveFormat?.backgroundColor;
              const statusInfo = resolvePaymentStatus(bgColor, String(getCellVal(15)));

              let invoiceMonth = curTab.trim();
              if (!invoiceMonth.includes('/')) invoiceMonth = `${invoiceMonth}/2026`;

              let effectiveStatus = statusInfo.status;
              let effectivePaidLabel = statusInfo.status === 'paid' ? 'Đã xác nhận trong Google Sheet' : undefined;

              // Direct check with Google Sheet Column P live status
              try {
                const queryRoom = normalizeRoomId(cleanTargetRoom || roomNumber);
                const statusUrl = apiUrl(`/api/payment/status?room=${encodeURIComponent(queryRoom)}&sheetId=${encodeURIComponent(cleanId)}&month=${encodeURIComponent(invoiceMonth)}`);
                const statusRes = await fetch(statusUrl);
                if (statusRes.ok) {
                  const statusData = await statusRes.json();
                  if (statusData && statusData.success) {
                    effectiveStatus = statusData.paymentStatus;
                    effectivePaidLabel = statusData.paymentStatus === 'paid' ? (statusData.label || 'Đã thanh toán (Google Sheet Cột P)') : undefined;
                  }
                }
              } catch {}

              const details: InvoiceDetailItem[] = [
                { name: 'Tiền thuê phòng', amount: roomCost, type: 'room', note: `Phòng ${roomNumber}` },
                { name: 'Tiền điện', amount: electricCost, type: 'electricity', metric: `${electricUsage} kWh (${electricOld} - ${electricNew})`, note: 'Chỉ số đo công tơ' },
                { name: 'Tiền nước sinh hoạt', amount: waterCost, type: 'water', metric: `${waterUsage} m³ (${waterOld} - ${waterNew})`, note: 'Chỉ số đồng hồ nước' },
                { name: 'Internet cáp quang', amount: internetCost, type: 'internet', note: 'Gói Wi-Fi phòng' },
                { name: 'Tiền rác & dịch vụ', amount: trashCost, type: 'service', note: 'Vệ sinh & thu gom rác' },
                { name: 'Phí giữ phương tiện', amount: vehicleCost, type: 'parking', note: 'Xe đã đăng ký' }
              ];
              if (otherCost > 0) details.push({ name: 'Chi phí khác', amount: otherCost, type: 'service', note: 'Phụ thu phát sinh' });
              if (depositCost > 0) details.push({ name: 'Tiền đặt cọc', amount: depositCost, type: 'service', note: 'Cọc hợp đồng' });

              return {
                id: `SHEET-${roomNumber.replace(/[^\w]/g, '')}-${invoiceMonth.replace(/[^\w]/g, '')}`,
                month: invoiceMonth,
                issueDate: '01/10/2026',
                dueDate: '05/10/2026',
                total: totalCost,
                status: effectiveStatus,
                paidAt: effectivePaidLabel,
                paymentMethod: 'qr',
                transactionId: `GSHEET-${roomNumber.replace(/[^\w]/g, '')}`,
                details
              };
            }
          }
        }
      } catch (e) {
        console.warn(`API monthly invoice fetch failed for tab ${curTab}:`, e);
      }
    }
  }

  // 2. GViz CSV Fallback (Works directly without OAuth for shared link)
  for (const curTab of candidateTabs) {
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(curTab)}`;
      const res = await fetch(csvUrl);
      if (res.ok) {
        const csvText = await res.text();
        const rows = parseCSV(csvText);

        if (rows.length > 0) {
          let targetRow: string[] | null = null;

          // Check rows for phone or room match
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            let roomVal = String(r[0] || '').trim();
            if (!roomVal && i >= 5 && i <= 11) roomVal = `G0${i - 4}`;
            else if (!roomVal && i >= 41 && i <= 44) roomVal = `LVC-10${i - 40}`;
            else if (!roomVal && i >= 45 && i <= 48) roomVal = `LVC-20${i - 44}`;

            const p1 = String(r[18] || '').replace(/[^\d]/g, '');
            const p2 = String(r[22] || '').replace(/[^\d]/g, '');
            const p3 = String(r[26] || '').replace(/[^\d]/g, '');

            if (cleanTargetPhone && cleanTargetPhone.length >= 9 && (p1.endsWith(cleanTargetPhone.slice(-9)) || p2.endsWith(cleanTargetPhone.slice(-9)) || p3.endsWith(cleanTargetPhone.slice(-9)))) {
              targetRow = r;
              break;
            }

            if (cleanTargetRoom && roomVal && isSameRoom(roomVal, cleanTargetRoom)) {
              targetRow = r;
              break;
            }
          }

          // Check rows 43-50
          if (!targetRow && rows.length >= 43) {
            for (let i = 42; i < Math.min(51, rows.length); i++) {
              if (rows[i] && rows[i][0]) {
                targetRow = rows[i];
                break;
              }
            }
          }

          if (!targetRow && rows.length > 6) {
            targetRow = rows[6];
          }

          if (targetRow) {
            const roomNumber = targetRow[0] || cleanTargetRoom || '203';
            const electricOld = parseSheetNumber(targetRow[1]);
            const electricNew = parseSheetNumber(targetRow[2]);
            const electricUsage = parseSheetNumber(targetRow[3]) || (electricNew > electricOld ? electricNew - electricOld : 0);

            const waterOld = parseSheetNumber(targetRow[4]);
            const waterNew = parseSheetNumber(targetRow[5]);
            const waterUsage = parseSheetNumber(targetRow[6]) || (waterNew > waterOld ? waterNew - waterOld : 0);

            const electricCost = parseSheetVNDAmount(targetRow[7]);
            const waterCost = parseSheetVNDAmount(targetRow[8]);
            const roomCost = parseSheetVNDAmount(targetRow[9]);
            const trashCost = parseSheetVNDAmount(targetRow[10]);
            const internetCost = parseSheetVNDAmount(targetRow[11]);
            const vehicleCost = parseSheetVNDAmount(targetRow[12]);
            const otherCost = parseSheetVNDAmount(targetRow[13]);
            const depositCost = parseSheetVNDAmount(targetRow[14]);
            const totalCost = parseSheetVNDAmount(targetRow[15]) || (roomCost + electricCost + waterCost + trashCost + internetCost + vehicleCost + otherCost);

            const statusInfo = resolvePaymentStatus(undefined, String(targetRow[15]));
            let invoiceMonth = curTab.trim();
            if (!invoiceMonth.includes('/')) invoiceMonth = `${invoiceMonth}/2026`;

            let effectivePaymentStatus: 'paid' | 'unpaid' = statusInfo.status;
            let effectivePaidAt = statusInfo.status === 'paid' ? 'Đã xác nhận trong Google Sheet' : undefined;

            // Direct check with Google Sheet Column P live status (AUTHORITATIVE SOURCE OF TRUTH)
            try {
              const queryRoom = normalizeRoomId(cleanTargetRoom || roomNumber);
              const statusUrl = apiUrl(`/api/payment/status?room=${encodeURIComponent(queryRoom)}&sheetId=${encodeURIComponent(cleanId)}&month=${encodeURIComponent(invoiceMonth)}`);
              const statusRes = await fetch(statusUrl);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData && statusData.success) {
                  effectivePaymentStatus = statusData.paymentStatus;
                  effectivePaidAt = statusData.paymentStatus === 'paid' ? (statusData.label || 'Đã thanh toán (Google Sheet Cột P)') : undefined;
                }
              }
            } catch {}

            const details: InvoiceDetailItem[] = [
              { name: 'Tiền thuê phòng', amount: roomCost, type: 'room', note: `Phòng ${roomNumber}` },
              { name: 'Tiền điện', amount: electricCost, type: 'electricity', metric: `${electricUsage} kWh (${electricOld} - ${electricNew})`, note: 'Chỉ số đo công tơ' },
              { name: 'Tiền nước sinh hoạt', amount: waterCost, type: 'water', metric: `${waterUsage} m³ (${waterOld} - ${waterNew})`, note: 'Chỉ số đồng hồ nước' },
              { name: 'Internet cáp quang', amount: internetCost, type: 'internet', note: 'Gói Wi-Fi phòng' },
              { name: 'Tiền rác & dịch vụ', amount: trashCost, type: 'service', note: 'Vệ sinh & thu gom rác' },
              { name: 'Phí giữ phương tiện', amount: vehicleCost, type: 'parking', note: 'Xe đã đăng ký' }
            ];
            if (otherCost > 0) details.push({ name: 'Chi phí khác', amount: otherCost, type: 'service', note: 'Phụ thu phát sinh' });
            if (depositCost > 0) details.push({ name: 'Tiền đặt cọc', amount: depositCost, type: 'service', note: 'Cọc hợp đồng' });

            return {
              id: `SHEET-${roomNumber.replace(/[^\w]/g, '')}-${invoiceMonth.replace(/[^\w]/g, '')}`,
              month: invoiceMonth,
              issueDate: '01/10/2026',
              dueDate: '05/10/2026',
              total: totalCost,
              status: effectivePaymentStatus,
              paidAt: effectivePaidAt,
              paymentMethod: 'qr',
              transactionId: `GSHEET-${roomNumber.replace(/[^\w]/g, '')}`,
              details
            };
          }
        }
      }
    } catch (err) {
      console.warn(`Could not read monthly invoice from CSV for tab ${curTab}:`, err);
    }
  }

  return null;
}
