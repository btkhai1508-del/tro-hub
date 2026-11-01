import { meterDetail, meterReading } from './meterDetail';
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
  const phone = String(row[2] || '').trim();
  const cccd = String(row[3] || '').trim();
  const email = String(row[4] || '').trim();
  const dob = String(row[5] || '').trim();
  const address = String(row[6] || '').trim();
  const plateNumber = String(row[7] || '').trim();
  const vehicleType = String(row[8] || '').trim();
  const roomNumber = String(row[9] || '').trim();
  const emergencyName = String(row[10] || '').trim();
  const emergencyRelationship = String(row[11] || '').trim();
  const emergencyPhone = String(row[12] || '').trim();
  const password = String(row[13] || '').trim();

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
 * A: Họ và Tên, B: Giới tính, C: SĐT, D: CCCD, E: Email, F: Ngày sinh, G: Địa chỉ thường trú,
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
    const phone = String(row[2] || '').trim();
    if (name || phone) {
      residents.push({
        name,
        phone: phone || '1',
        cccd: String(row[3] || '').trim(),
        email: String(row[4] || '').trim(),
        dob: String(row[5] || '').trim(),
        address: String(row[6] || '').trim(),
        plateNumber: String(row[7] || '').trim(),
        vehicleType: String(row[8] || '').trim() || 'Xe máy',
        roomNumber: String(row[9] || '').trim(),
        emergencyName: String(row[10] || '').trim(),
        emergencyRelation: String(row[11] || '').trim(),
        emergencyPhone: String(row[12] || '').trim(),
        password: String(row[13] || '').trim() || '180505',
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
          const trimmedName = (t.name || '').trim();
          const isNumericCount = /^\d+(\.\d+)?$/.test(trimmedName);
          const isHeader = /^họ\s*(?:và\s*)?tên/i.test(trimmedName);
          if (trimmedName && trimmedName !== '1' && !isNumericCount && !isHeader) {
            const cleanPhone = t.phone.replace(/[\s.-]/g, '');
            const existing = residents.find(res => {
              const resP = res.phone.replace(/[\s.-]/g, '');
              return (cleanPhone && cleanPhone !== '1' && resP === cleanPhone) ||
                     (res.name.toLowerCase() === trimmedName.toLowerCase());
            });

            if (existing) {
              if (!existing.roomNumber) existing.roomNumber = cleanRoom;
              if (!existing.cccd && t.cccd && !/^[0-9](\.0+)?$/.test(t.cccd)) existing.cccd = t.cccd;
              if (!existing.plateNumber && t.plateNumber && !/^\d+(\.\d+)?$/.test(t.plateNumber)) existing.plateNumber = t.plateNumber;
              if (roomRent > 0 && !existing.rentPrice) existing.rentPrice = roomRent;
              if (roomDeposit > 0 && !existing.depositAmount) existing.depositAmount = roomDeposit;
              if (roomTotal > 0 && !existing.totalMonthlyAmount) existing.totalMonthlyAmount = roomTotal;
            } else {
              const effectivePhone = t.phone && !/^[0-9](\.0+)?$/.test(t.phone) ? t.phone : '1';
              residents.push({
                name: trimmedName,
                phone: effectivePhone,
                cccd: t.cccd && !/^[0-9](\.0+)?$/.test(t.cccd) ? t.cccd : '',
                email: '',
                dob: '',
                address: '',
                plateNumber: t.plateNumber && !/^\d+(\.\d+)?$/.test(t.plateNumber) ? t.plateNumber : '',
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

  // Only the requested month: a month with no tab has no data yet.
  const candidateTabs = [tabName];

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
              const electricOld = meterReading(getCellVal(1));
              const electricNew = meterReading(getCellVal(2));
              const electricUsage = meterReading(getCellVal(3));

              const waterOld = meterReading(getCellVal(4));
              const waterNew = meterReading(getCellVal(5));
              const waterUsage = meterReading(getCellVal(6));

              const electricCost = parseSheetVNDAmount(getCellVal(7));
              const waterCost = parseSheetVNDAmount(getCellVal(8));
              const roomCost = parseSheetVNDAmount(getCellVal(9));
              const trashCost = parseSheetVNDAmount(getCellVal(10));
              const internetCost = parseSheetVNDAmount(getCellVal(11));
              const vehicleCost = parseSheetVNDAmount(getCellVal(12));
              const otherCost = parseSheetVNDAmount(getCellVal(13));
              const depositCost = parseSheetVNDAmount(getCellVal(14));
              const totalCost = parseSheetVNDAmount(getCellVal(15));

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
                { name: 'Tiền điện', amount: electricCost, type: 'electricity', metric: meterDetail(electricOld, electricNew, electricUsage, electricCost) },
                { name: 'Tiền nước sinh hoạt', amount: waterCost, type: 'water', metric: meterDetail(waterOld, waterNew, waterUsage, waterCost) },
                { name: 'Internet cáp quang', amount: internetCost, type: 'internet', note: 'Gói Wi-Fi phòng' },
                { name: 'Tiền rác & dịch vụ', amount: trashCost, type: 'service', note: 'Vệ sinh & thu gom rác' },
                { name: 'Phí giữ phương tiện', amount: vehicleCost, type: 'parking', note: 'Xe đã đăng ký' }
              ];
              if (otherCost !== 0) details.push({ name: 'Khoản khác / giảm trừ', amount: otherCost, type: 'service', note: 'Cột KHÁC trên Google Sheet' });
              if (depositCost > 0) details.push({ name: 'Tiền đặt cọc', amount: depositCost, type: 'service', note: 'Cọc hợp đồng' });

              return {
                id: `SHEET-${roomNumber.replace(/[^\w]/g, '')}-${invoiceMonth.replace(/[^\w]/g, '')}`,
                month: invoiceMonth,
                issueDate: `01/${invoiceMonth}`,
                dueDate: `05/${invoiceMonth}`,
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
        // gviz answers a tab that does not exist with the first sheet: that month simply has no bill yet.
        if (!rows[0] || rows[0].length < 20 || String(rows[0][0] || '').includes('Họ và Tên')) return null;

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
            const electricOld = meterReading(targetRow[1]);
            const electricNew = meterReading(targetRow[2]);
            const electricUsage = meterReading(targetRow[3]);

            const waterOld = meterReading(targetRow[4]);
            const waterNew = meterReading(targetRow[5]);
            const waterUsage = meterReading(targetRow[6]);

            const electricCost = parseSheetVNDAmount(targetRow[7]);
            const waterCost = parseSheetVNDAmount(targetRow[8]);
            const roomCost = parseSheetVNDAmount(targetRow[9]);
            const trashCost = parseSheetVNDAmount(targetRow[10]);
            const internetCost = parseSheetVNDAmount(targetRow[11]);
            const vehicleCost = parseSheetVNDAmount(targetRow[12]);
            const otherCost = parseSheetVNDAmount(targetRow[13]);
            const depositCost = parseSheetVNDAmount(targetRow[14]);
            const totalCost = parseSheetVNDAmount(targetRow[15]);

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
              { name: 'Tiền điện', amount: electricCost, type: 'electricity', metric: meterDetail(electricOld, electricNew, electricUsage, electricCost) },
              { name: 'Tiền nước sinh hoạt', amount: waterCost, type: 'water', metric: meterDetail(waterOld, waterNew, waterUsage, waterCost) },
              { name: 'Internet cáp quang', amount: internetCost, type: 'internet', note: 'Gói Wi-Fi phòng' },
              { name: 'Tiền rác & dịch vụ', amount: trashCost, type: 'service', note: 'Vệ sinh & thu gom rác' },
              { name: 'Phí giữ phương tiện', amount: vehicleCost, type: 'parking', note: 'Xe đã đăng ký' }
            ];
            if (otherCost !== 0) details.push({ name: 'Khoản khác / giảm trừ', amount: otherCost, type: 'service', note: 'Cột KHÁC trên Google Sheet' });
            if (depositCost > 0) details.push({ name: 'Tiền đặt cọc', amount: depositCost, type: 'service', note: 'Cọc hợp đồng' });

            return {
              id: `SHEET-${roomNumber.replace(/[^\w]/g, '')}-${invoiceMonth.replace(/[^\w]/g, '')}`,
              month: invoiceMonth,
              issueDate: `01/${invoiceMonth}`,
              dueDate: `05/${invoiceMonth}`,
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
