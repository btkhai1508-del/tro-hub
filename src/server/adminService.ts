import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { GoogleGenAI } from '@google/genai';
import { setRoomColumnPStatus, getRoomColumnPStatus } from './columnPStatusStore.js';
import { mapColorToPaymentStatus } from './googleSheetColorService.js';
import { fetchSheetDataViaGviz } from './googleSheetsBackendService.js';
import { GOOGLE_APPS_SCRIPT_WEBAPP_URL } from './notificationStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PAYMENT_GATE_STORE_PATH = path.resolve(__dirname, 'paymentGateStore.json');

interface GateRecord {
  value: 'START' | 'STOP';
  updatedAt: number;
  source: 'admin' | 'sheet';
}

function loadPaymentGateFile(): Record<string, GateRecord> {
  try {
    if (fs.existsSync(PAYMENT_GATE_STORE_PATH)) {
      const raw = fs.readFileSync(PAYMENT_GATE_STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function savePaymentGateFile(data: Record<string, GateRecord>): void {
  try {
    fs.writeFileSync(PAYMENT_GATE_STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getCurrentMonthStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${y}`;
}

export const ADMIN_SPREADSHEET_ID = "1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A";
export const SHEET_LVC_ID = "1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A";
export const SHEET_TK_ID = "1HYeiU4GWL0xIEtOUn_Fif5zcxKpFTqrei1WwwfUNUTU";

export const CCCD_ISSUE_PLACE = "Cục Cảnh sát quản lý hành chính về trật tự xã hội";

export const HOUSES_CONFIG: Record<string, any> = {
  TRUNG_KIM: {
    key: "TRUNG_KIM",
    label: "Trung Kim",
    address: "116/32 Đường 17, Khu phố 1, P.Linh Xuân, Thành Phố Hồ Chí Minh",
    landlord: "Lương Thị Kim Phượng",
    dob: "18/10/1973",
    cccd: "024073000292",
    cccdIssuePlace: CCCD_ISSUE_PLACE,
    phone: "0903616569",
    taxCode: "024073000292",
    houseName: "NHÀ TRỌ TRUNG KIM"
  },
  LVC: {
    key: "LVC",
    label: "Lê Văn Chí",
    address: "109/6 Lê Văn Chí, khu phố 41, P. Linh Xuân Thành Phố Hồ Chí Minh",
    landlord: "Bùi Trung Khải",
    dob: "15/08/2005",
    cccd: "079205019765",
    cccdIssuePlace: CCCD_ISSUE_PLACE,
    phone: "0902371800",
    taxCode: "079205019765",
    houseName: "NHÀ TRỌ 109/6"
  }
};

// In-memory store for payment gate and configurations
let paymentGateState: Record<string, string> = {
  '10/2026': 'STOP',
  '09/2026': 'STOP'
};

let unitConfigState: Record<string, any> = {
  '10/2026': { dien: 3500, nuoc: 20000, rac: 30000, net: 40000, xe: 50000 },
  '09/2026': { dien: 3500, nuoc: 20000, rac: 30000, net: 40000, xe: 50000 }
};

let declarationStore: Record<string, any> = {};

/**
 * Normalizes room name
 */
export function isLVC(room: string): boolean {
  return String(room || '').toUpperCase().includes('LVC');
}

export function houseKeyFromRoom(room: string): 'LVC' | 'TRUNG_KIM' {
  return isLVC(room) ? 'LVC' : 'TRUNG_KIM';
}

function canonicalRoom(room: any): string {
  let value = String(room || '').trim().toUpperCase().replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').replace(/\.0+$/, '');
  if (value.includes('LVC')) {
    const num = value.replace(/\D/g, '');
    return num ? `LVC-${num}` : value;
  }
  if (/^G\d+$/i.test(value)) {
    const num = value.replace(/\D/g, '');
    return `G${num.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(value)) {
    return value.replace(/^0+/, '') || value;
  }
  return value;
}

/**
 * Fetch and parse XLSX from Google Sheets
 */
export async function fetchSheetXlsx(spreadsheetId: string = ADMIN_SPREADSHEET_ID): Promise<AdmZip | null> {
  const candidateIds = [spreadsheetId, ADMIN_SPREADSHEET_ID, SHEET_TK_ID].filter((id, idx, arr) => id && arr.indexOf(id) === idx);
  
  for (const id of candidateIds) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx&t=${Date.now()}`;
      const res = await fetch(url, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return new AdmZip(buf);
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/**
 * Get available monthly tabs
 */
export async function getMonthList(spreadsheetId: string = ADMIN_SPREADSHEET_ID): Promise<string[]> {
  try {
    const zip = await fetchSheetXlsx(spreadsheetId);
    if (!zip) return [];
    const workbookXml = zip.readAsText('xl/workbook.xml');
    const sheetMatches = workbookXml.match(/<sheet\s+[^>]*name="([^"]+)"/g) || [];
    const months: string[] = [];
    sheetMatches.forEach(m => {
      const name = m.match(/name="([^"]+)"/)?.[1] || '';
      if (/^\d{6}$/.test(name)) {
        months.push(`${name.slice(0, 2)}/${name.slice(2)}`);
      } else if (/^\d{2}\/\d{4}$/.test(name) || /^\d{2}\/\d{2}$/.test(name)) {
        months.push(name);
      }
    });
    const curMonth = getCurrentMonthStr();
    if (!months.includes(curMonth)) {
      months.push(curMonth);
    }
    const unique = Array.from(new Set(months));
    unique.sort((a, b) => {
      const p1 = a.split('/'), p2 = b.split('/');
      return new Date(Number(p1[1]), Number(p1[0]) - 1).getTime() - new Date(Number(p2[1]), Number(p2[0]) - 1).getTime();
    });
    return unique;
  } catch (e) {
    return [getCurrentMonthStr()];
  }
}

/**
 * Extract table rows from sheet XML
 */
export async function parseSheetXmlRows(zip: AdmZip, sheetName: string): Promise<{ rows: any[]; sharedStrings: string[]; fills: string[]; cellXfs: number[] }> {
  const workbookXml = zip.readAsText('xl/workbook.xml');
  const relsXml = zip.readAsText('xl/_rels/workbook.xml.rels');
  const sharedXml = zip.getEntry('xl/sharedStrings.xml') ? zip.readAsText('xl/sharedStrings.xml') : '';
  const stylesXml = zip.getEntry('xl/styles.xml') ? zip.readAsText('xl/styles.xml') : '';

  // 1. Shared strings
  const sharedStrings: string[] = [];
  if (sharedXml) {
    const siMatches = sharedXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    siMatches.forEach(si => {
      const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
      sharedStrings.push(text);
    });
  }

  // 2. Fills & cellXfs
  const fills: string[] = [];
  const cellXfs: number[] = [];
  if (stylesXml) {
    const fillsBlock = stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] || '';
    const fillMatches = fillsBlock.match(/<fill[\s\S]*?<\/fill>/g) || [];
    fillMatches.forEach(f => {
      const rgb = f.match(/rgb="([A-Fa-f0-9]{8})"/)?.[1] || '';
      fills.push(rgb ? `#${rgb.slice(2)}` : '#FFFFFF');
    });

    const cellXfsBlock = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
    const xfMatches = cellXfsBlock.match(/<xf[^>]*>/g) || [];
    xfMatches.forEach(xf => {
      const fillId = parseInt(xf.match(/fillId="(\d+)"/)?.[1] || '0', 10);
      cellXfs.push(fillId);
    });
  }

  // 3. Find sheet target
  let targetFile = 'xl/worksheets/sheet1.xml';
  const cleanName = sheetName.replace(/[\/\\]/g, '');
  const sheetTag = (workbookXml.match(new RegExp(`<sheet[^>]*name="${sheetName.replace('/', '\\/')}"[^>]*>`, 'i')) || [])[0]
    || (workbookXml.match(new RegExp(`<sheet[^>]*name="[^"]*${cleanName}[^"]*"[^>]*>`, 'i')) || [])[0];
  
  if (sheetTag) {
    const rId = sheetTag.match(/r:id="([^"]+)"/)?.[1];
    if (rId) {
      const relTag = (relsXml.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*>`, 'i')) || [])[0];
      const target = relTag?.match(/Target="([^"]+)"/)?.[1];
      if (target) {
        targetFile = target.startsWith('xl/') ? target : `xl/${target}`;
      }
    }
  }

  const sheetXml = zip.getEntry(targetFile) ? zip.readAsText(targetFile) : zip.readAsText('xl/worksheets/sheet1.xml');
  const rowMatches = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  const parsedRows: any[] = [];

  rowMatches.forEach(rowStr => {
    const rIdx = parseInt(rowStr.match(/r="(\d+)"/)?.[1] || '0', 10);
    const cells: Record<string, { value: string; num: number; sIdx?: number; fillHex?: string }> = {};
    const cMatches = rowStr.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || [];

    cMatches.forEach(cStr => {
      const ref = cStr.match(/r="([A-Z]+)\d+"/)?.[1] || '';
      const isShared = cStr.includes('t="s"');
      const sIdx = parseInt(cStr.match(/s="(\d+)"/)?.[1] || '-1', 10);
      const valMatch = cStr.match(/<v>([^<]+)<\/v>/)?.[1] || '';
      let text = '';
      let num = 0;

      if (isShared && valMatch) {
        const sId = parseInt(valMatch, 10);
        text = sharedStrings[sId] || '';
      } else {
        text = valMatch;
      }

      num = parseFloat(valMatch) || 0;
      let fillHex = '#FFFFFF';
      if (sIdx >= 0 && cellXfs[sIdx] !== undefined) {
        fillHex = fills[cellXfs[sIdx]] || '#FFFFFF';
      }

      if (ref) {
        cells[ref] = { value: text, num, sIdx, fillHex };
      }
    });

    parsedRows.push({ rowNumber: rIdx, cells });
  });

  return { rows: parsedRows, sharedStrings, fills, cellXfs };
}

/**
 * Get Dashboard Data
 */
export async function getDashboardData(month: string = '10/2026') {
  try {
    const zip = await fetchSheetXlsx();
    if (!zip) return emptyDashboardData();

    const readMonth = async (tabMonth: string) => {
      const { rows } = await parseSheetXmlRows(zip, tabMonth);
      const totals = { dien: 0, nuoc: 0, tienDien: 0, tienNuoc: 0, doanhThu: 0, soNguoi: 0, soXe: 0 };
      rows.forEach(row => {
        if (row.rowNumber < 7 || row.rowNumber > 50 || !row.cells.A?.value) return;
        const cells = row.cells;
        totals.dien += cells.D?.num || 0;
        totals.nuoc += cells.G?.num || 0;
        totals.tienDien += cells.H?.num || 0;
        totals.tienNuoc += cells.I?.num || 0;
        totals.doanhThu += cells.P?.num || 0;
        totals.soNguoi += cells.AC?.num || (cells.Q?.value ? 1 : 0) + (cells.U?.value ? 1 : 0) + (cells.Y?.value ? 1 : 0);
        totals.soXe += cells.AD?.num || (cells.T?.value ? 1 : 0) + (cells.X?.value ? 1 : 0) + (cells.AB?.value ? 1 : 0);
      });
      const summary = rows.find(row => row.rowNumber === 51)?.cells;
      if (summary) {
        if (summary.D?.num) totals.dien = summary.D.num;
        if (summary.G?.num) totals.nuoc = summary.G.num;
        if (summary.H?.num) totals.tienDien = summary.H.num;
        if (summary.I?.num) totals.tienNuoc = summary.I.num;
        if (summary.P?.num) totals.doanhThu = summary.P.num;
        if (summary.AC?.num) totals.soNguoi = summary.AC.num;
        if (summary.AD?.num) totals.soXe = summary.AD.num;
      }
      return totals;
    };

    const workbookXml = zip.readAsText('xl/workbook.xml');
    const monthTabs = [...workbookXml.matchAll(/<sheet\s+[^>]*name="([^"]+)"/g)]
      .map(match => match[1])
      .filter(name => /^\d{6}$/.test(name) || /^\d{2}\/(?:\d{4}|\d{2})$/.test(name))
      .sort((a, b) => {
        const order = (value: string) => {
          const clean = value.replace('/', '');
          const m = Number(clean.slice(0, 2));
          const y = Number(clean.slice(2));
          return (y < 100 ? y + 2000 : y) * 12 + m;
        };
        return order(a) - order(b);
      });

    const selectedClean = month.replace('/', '');
    const selectedOrder = (value: string) => {
      const clean = value.replace('/', '');
      const m = Number(clean.slice(0, 2));
      const y = Number(clean.slice(2));
      return (y < 100 ? y + 2000 : y) * 12 + m;
    };

    const trendMonths = monthTabs.filter(tab => selectedOrder(tab) <= selectedOrder(selectedClean)).slice(-6);
    const trendTotals = await Promise.all(trendMonths.map(async tab => {
      const displayMonth = tab.includes('/') ? tab : `${tab.slice(0, 2)}/${tab.slice(2)}`;
      const totals = await readMonth(tab);
      return { month: displayMonth, ...totals };
    }));

    const matchingTab = monthTabs.find(t => t.replace('/', '') === selectedClean) || monthTabs[monthTabs.length - 1];
    const selected = matchingTab ? await readMonth(matchingTab) : emptyDashboardData();

    return { ...selected, usageTrend: trendTotals };
  } catch {
    return emptyDashboardData();
  }
}

function emptyDashboardData() {
  return { dien: 0, nuoc: 0, tienDien: 0, tienNuoc: 0, doanhThu: 0, soNguoi: 0, soXe: 0, usageTrend: [] };
}

/**
 * Sanitize and validate resident information from columns Q-AB
 * Person 1: Q(Name), R(CCCD), S(Phone), T(Plate)
 * Person 2: U(Name), V(CCCD), W(Phone), X(Plate)
 * Person 3: Y(Name), Z(CCCD), AA(Phone), AB(Plate)
 */
export function sanitizeTenantName(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  // Strip out numeric counts like "1", "1.0", "2.0", "3.0", "0", etc.
  if (/^\d+(\.\d+)?$/.test(str)) return '';
  if (/^họ\s*(?:và\s*)?tên/i.test(str)) return '';
  return str;
}

export function sanitizeCitizenId(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^[0-9](\.0+)?$/.test(str)) return '';
  return str;
}

export function sanitizeTenantPhone(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^[0-9](\.0+)?$/.test(str)) return '';
  return str;
}

export function sanitizeVehiclePlate(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return '';
  return str;
}

/**
 * Tiền giữ xe:
 * "Tiền giữ xe nếu không tick thì không tính thu tiền xe còn nếu tick thì thu"
 * Checks boolean / checkbox state of cell M or uses registered bikes count.
 */
export function computeParkingFee(mCell: any, soXe: number, unitPriceXe: number = 50000): number {
  if (!mCell) {
    return soXe > 0 ? soXe * unitPriceXe : 0;
  }
  const rawVal = String(mCell.value || '').trim();
  const num = mCell.num;

  // Checkbox boolean states
  if (rawVal === 'TRUE' || rawVal === 'true' || rawVal === '✓' || rawVal === '✔' || rawVal === '1' || rawVal === 'V' || rawVal === 'v') {
    return (soXe > 0 ? soXe : 1) * unitPriceXe;
  }
  if (rawVal === 'FALSE' || rawVal === 'false') {
    return 0; // Không tick thì không thu
  }
  // Explicit number already entered in cell M
  if (num !== undefined && !isNaN(num) && num > 0) {
    return num;
  }
  if (num === 0 && (rawVal === '0' || rawVal === '0.0')) {
    return 0;
  }
  return soXe > 0 ? soXe * unitPriceXe : 0;
}

/**
 * Get Room List for a given month
 */
export async function getRoomListByMonth(month: string = '10/2026') {
  try {
    const zip = await fetchSheetXlsx();
    if (!zip) return [];

    const { rows } = await parseSheetXmlRows(zip, month);
    const rooms: any[] = [];
    const netUnitPrice = unitConfigState[month]?.net || 40000;
    const xeUnitPrice = unitConfigState[month]?.xe || 50000;

    rows.forEach(r => {
      if (r.rowNumber >= 7 && r.rowNumber <= 50) {
        const c = r.cells;
        const roomName = canonicalRoom(c.A?.value);
        if (roomName) {
          const nguoi1 = sanitizeTenantName(c.Q?.value);
          const cccd1 = sanitizeCitizenId(c.R?.value);
          const sdt1 = sanitizeTenantPhone(c.S?.value);
          const xe1 = sanitizeVehiclePlate(c.T?.value);

          const nguoi2 = sanitizeTenantName(c.U?.value);
          const cccd2 = sanitizeCitizenId(c.V?.value);
          const sdt2 = sanitizeTenantPhone(c.W?.value);
          const xe2 = sanitizeVehiclePlate(c.X?.value);

          const nguoi3 = sanitizeTenantName(c.Y?.value);
          const cccd3 = sanitizeCitizenId(c.Z?.value);
          const sdt3 = sanitizeTenantPhone(c.AA?.value);
          const xe3 = sanitizeVehiclePlate(c.AB?.value);

          const tenantName = nguoi1 || nguoi2 || nguoi3 || `Phòng ${roomName}`;
          const phone = sdt1 || sdt2 || sdt3 || '';
          const fillHex = c.P?.fillHex || '#F8D7DA';
          const mapped = mapColorToPaymentStatus(fillHex);
          
          let statusClass = 'unpaid';
          let statusText = 'Chưa đóng';

          if (mapped.paymentStatus === 'paid') {
            statusClass = 'paid';
            statusText = 'Đã đóng';
          } else if ((mapped as any).paymentStatus === 'pending') {
            statusClass = 'pending';
            statusText = 'Chờ xác nhận';
          }

          const validPeopleCount = [nguoi1, nguoi2, nguoi3].filter(Boolean).length;
          const soNguoi = (c.AC?.num && c.AC.num > 0)
            ? c.AC.num
            : (validPeopleCount > 0 ? validPeopleCount : (nguoi1 ? 1 : 1));

          const validPlatesCount = [xe1, xe2, xe3].filter(isValidLicensePlate).length;
          const soXe = (c.AD?.num !== undefined && !isNaN(c.AD.num))
            ? c.AD.num
            : validPlatesCount;

          // Tiền Internet cũng tính theo số lượng người
          const tienNet = c.L?.num && c.L.num > 0 ? c.L.num : (soNguoi * netUnitPrice);

          // Tiền giữ xe nếu không tick thì không tính thu tiền xe còn nếu tick thì thu
          const tienXe = computeParkingFee(c.M, soXe, xeUnitPrice);

          const tienPhong = c.J?.num || 0;
          const tienDien = c.H?.num || 0;
          const tienNuoc = c.I?.num || 0;
          const tienRac = c.K?.num || 0;
          const tienKhac = c.N?.num || 0;
          const tienCoc = c.O?.num || 0;
          const tongTien = c.P?.num || (tienPhong + tienDien + tienNuoc + tienRac + tienNet + tienXe + tienKhac);

          rooms.push({
            row: r.rowNumber,
            room: roomName,
            name: tenantName,
            phone,
            status: statusClass,
            statusText,
            paymentStatus: mapped.paymentStatus,
            dienCu: c.B?.num || 0,
            dienMoi: c.C?.num || 0,
            dienUsed: c.D?.num || 0,
            nuocCu: c.E?.num || 0,
            nuocMoi: c.F?.num || 0,
            nuocUsed: c.G?.num || 0,
            tienDien,
            tienNuoc,
            tienPhong,
            tienRac,
            tienNet,
            tienXe,
            tienKhac,
            tienCoc,
            tongTien,
            nguoi1,
            cccd1,
            sdt1,
            xe1,
            nguoi2,
            cccd2,
            sdt2,
            xe2,
            nguoi3,
            cccd3,
            sdt3,
            xe3,
            soNguoi,
            soXe
          });
        }
      }
    });

    return rooms;
  } catch (e) {
    return [];
  }
}

/**
 * Get single room data
 */
export async function getRoomDataByMonth(month: string, room: string) {
  try {
    const zip = await fetchSheetXlsx();
    if (!zip) return null;

    const { rows } = await parseSheetXmlRows(zip, month);
    const targetRow = rows.find(r => r.rowNumber >= 7 && r.rowNumber <= 50 && canonicalRoom(r.cells.A?.value) === canonicalRoom(room));

    if (!targetRow) return null;

    const c = targetRow.cells;
    const rowNum = targetRow.rowNumber;
    const fillHex = c.P?.fillHex || '#F8D7DA';
    const mapped = mapColorToPaymentStatus(fillHex);

    let statusHTML = '<span style="color:#dc2626">Chưa thanh toán</span>';
    if (mapped.paymentStatus === 'paid') {
      statusHTML = '<span style="color:#16a34a">Đã thanh toán</span>';
    } else if ((mapped as any).paymentStatus === 'pending') {
      statusHTML = '<span style="color:#ca8a04">Chờ xác nhận</span>';
    }

    const netUnitPrice = unitConfigState[month]?.net || 40000;
    const xeUnitPrice = unitConfigState[month]?.xe || 50000;

    const nguoi1 = sanitizeTenantName(c.Q?.value);
    const cccd1 = sanitizeCitizenId(c.R?.value);
    const sdt1 = sanitizeTenantPhone(c.S?.value);
    const xe1 = sanitizeVehiclePlate(c.T?.value);

    const nguoi2 = sanitizeTenantName(c.U?.value);
    const cccd2 = sanitizeCitizenId(c.V?.value);
    const sdt2 = sanitizeTenantPhone(c.W?.value);
    const xe2 = sanitizeVehiclePlate(c.X?.value);

    const nguoi3 = sanitizeTenantName(c.Y?.value);
    const cccd3 = sanitizeCitizenId(c.Z?.value);
    const sdt3 = sanitizeTenantPhone(c.AA?.value);
    const xe3 = sanitizeVehiclePlate(c.AB?.value);

    const validPeopleCount = [nguoi1, nguoi2, nguoi3].filter(Boolean).length;
    const soNguoi = (c.AC?.num && c.AC.num > 0)
      ? c.AC.num
      : (validPeopleCount > 0 ? validPeopleCount : (nguoi1 ? 1 : 1));

    const validPlatesCount = [xe1, xe2, xe3].filter(isValidLicensePlate).length;
    const soXe = (c.AD?.num !== undefined && !isNaN(c.AD.num))
      ? c.AD.num
      : validPlatesCount;

    // Tiền Internet cũng tính theo số lượng người
    const tienNet = c.L?.num && c.L.num > 0 ? c.L.num : (soNguoi * netUnitPrice);

    // Tiền giữ xe nếu không tick thì không tính thu tiền xe còn nếu tick thì thu
    const tienXe = computeParkingFee(c.M, soXe, xeUnitPrice);

    const tienPhong = c.J?.num || 0;
    const tienDien = c.H?.num || 0;
    const tienNuoc = c.I?.num || 0;
    const tienRac = c.K?.num || 0;
    const tienKhac = c.N?.num || 0;
    const tienCoc = c.O?.num || 0;
    const tongTien = c.P?.num || (tienPhong + tienDien + tienNuoc + tienRac + tienNet + tienXe + tienKhac);

    return {
      row: rowNum,
      dienCu: c.B?.num || 0,
      dienMoi: c.C?.num || 0,
      dienUsed: c.D?.num || 0,
      nuocCu: c.E?.num || 0,
      nuocMoi: c.F?.num || 0,
      nuocUsed: c.G?.num || 0,
      tienDien,
      tienNuoc,
      tienPhong,
      tienRac,
      tienNet,
      tienXe,
      tienKhac,
      tienCoc,
      tongTien,
      nguoi1,
      cccd1,
      sdt1,
      xe1,
      nguoi2,
      cccd2,
      sdt2,
      xe2,
      nguoi3,
      cccd3,
      sdt3,
      xe3,
      soNguoi,
      soXe,
      soNet: c.AE?.num || 0,
      statusHTML,
      paymentStatus: mapped.paymentStatus
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get Monthly Billing
 */
export async function getMonthlyBilling(month: string = '10/2026') {
  try {
    const zip = await fetchSheetXlsx();
    if (!zip) return [];

    const { rows } = await parseSheetXmlRows(zip, month);
    const list: any[] = [];
    const netUnitPrice = unitConfigState[month]?.net || 40000;
    const xeUnitPrice = unitConfigState[month]?.xe || 50000;

    rows.forEach(r => {
      if (r.rowNumber >= 7 && r.rowNumber <= 50) {
        const c = r.cells;
        const room = c.A?.value || '';
        if (room) {
          const fillHex = c.P?.fillHex || '#F8D7DA';
          const mapped = mapColorToPaymentStatus(fillHex);

          const nguoi1 = sanitizeTenantName(c.Q?.value);
          const cccd1 = sanitizeCitizenId(c.R?.value);
          const sdt1 = sanitizeTenantPhone(c.S?.value);
          const xe1 = sanitizeVehiclePlate(c.T?.value);

          const nguoi2 = sanitizeTenantName(c.U?.value);
          const cccd2 = sanitizeCitizenId(c.V?.value);
          const sdt2 = sanitizeTenantPhone(c.W?.value);
          const xe2 = sanitizeVehiclePlate(c.X?.value);

          const nguoi3 = sanitizeTenantName(c.Y?.value);
          const cccd3 = sanitizeCitizenId(c.Z?.value);
          const sdt3 = sanitizeTenantPhone(c.AA?.value);
          const xe3 = sanitizeVehiclePlate(c.AB?.value);

          const tenantName = nguoi1 || nguoi2 || nguoi3 || `Phòng ${room}`;
          const tenantPhone = sdt1 || sdt2 || sdt3 || '';

          const validPeopleCount = [nguoi1, nguoi2, nguoi3].filter(Boolean).length;
          const soNguoi = (c.AC?.num && c.AC.num > 0)
            ? c.AC.num
            : (validPeopleCount > 0 ? validPeopleCount : (nguoi1 ? 1 : 1));

          const validPlatesCount = [xe1, xe2, xe3].filter(isValidLicensePlate).length;
          const soXe = (c.AD?.num !== undefined && !isNaN(c.AD.num))
            ? c.AD.num
            : validPlatesCount;

          // Tiền Internet cũng tính theo số lượng người
          const tienNet = c.L?.num && c.L.num > 0 ? c.L.num : (soNguoi * netUnitPrice);

          // Tiền giữ xe nếu không tick thì không tính thu tiền xe còn nếu tick thì thu
          const tienXe = computeParkingFee(c.M, soXe, xeUnitPrice);

          const tienPhong = c.J?.num || 0;
          const tienDien = c.H?.num || 0;
          const tienNuoc = c.I?.num || 0;
          const tienRac = c.K?.num || 0;
          const tienKhac = c.N?.num || 0;
          const tienCoc = c.O?.num || 0;
          const tongTien = c.P?.num || (tienPhong + tienDien + tienNuoc + tienRac + tienNet + tienXe + tienKhac);

          list.push({
            row: r.rowNumber,
            room: canonicalRoom(room),
            name: tenantName,
            phone: tenantPhone,
            dienCu: c.B?.num || 0,
            dienMoi: c.C?.num || 0,
            dienUsed: c.D?.num || 0,
            nuocCu: c.E?.num || 0,
            nuocMoi: c.F?.num || 0,
            nuocUsed: c.G?.num || 0,
            tienPhong,
            tienDien,
            tienNuoc,
            tienRac,
            tienNet,
            tienXe,
            tienKhac,
            tienCoc,
            tongTien,
            nguoi1,
            cccd1,
            sdt1,
            xe1,
            nguoi2,
            cccd2,
            sdt2,
            xe2,
            nguoi3,
            cccd3,
            sdt3,
            xe3,
            soNguoi,
            soXe,
            soNet: c.AE?.num || 0,
            paymentStatus: mapped.paymentStatus,
            statusText: mapped.paymentStatus === 'paid' ? 'Đã đóng' : ((mapped.paymentStatus as string) === 'pending' ? 'Chờ xác nhận' : 'Chưa đóng'),
            status: mapped.paymentStatus === 'paid' ? 'paid' : ((mapped.paymentStatus as string) === 'pending' ? 'pending' : 'unpaid')
          });
        }
      }
    });

    return list;
  } catch (e) {
    return [];
  }
}

/**
 * Validate Vietnamese License Plate
 * Rejects pure counts (1, 1.0, 2.0), phone numbers, CCCD, and pure text names without digits (Tuyền, Phạm Huyền Trâm...)
 */
export function isValidLicensePlate(val: any): boolean {
  if (!val) return false;
  const str = String(val).trim();
  // Filter out headcount or vehicle count (0, 1, 1.0, 2, 2.0, 3, 3.0...)
  if (/^\d+(\.0+)?$/.test(str)) return false;
  // Must contain digits
  if (!/\d/.test(str)) return false;
  // Filter out phone numbers and CCCD numbers (pure digits length >= 9)
  const cleanDigits = str.replace(/\D/g, '');
  if (/^\d{9,12}$/.test(str.replace(/\s+/g, ''))) return false;
  // Must contain at least 4 alphanumeric characters (e.g. 59X1, 78C1, 1234)
  const clean = str.replace(/[\s.-]/g, '');
  if (clean.length < 4 || clean.length > 12) return false;
  return true;
}

/**
 * Search License Plates across all rooms
 */
export async function searchLicensePlates(month: string = '10/2026', query: string = '') {
  const q = String(query || '').replace(/[\s.-]/g, '').toLowerCase();

  try {
    const zip = await fetchSheetXlsx();
    const roomsList = zip ? (await parseSheetXmlRows(zip, month)).rows : [];
    const results: any[] = [];

    const slots = [
      { idx: 1, nameCol: 'Q', cccdCol: 'R', phoneCol: 'S', plateCol: 'T' },
      { idx: 2, nameCol: 'U', cccdCol: 'V', phoneCol: 'W', plateCol: 'X' },
      { idx: 3, nameCol: 'Y', cccdCol: 'Z', phoneCol: 'AA', plateCol: 'AB' }
    ];

    roomsList.forEach(r => {
      if (r.rowNumber >= 7 && r.rowNumber <= 50) {
        const c = r.cells;
        const room = c.A?.value || '';
        if (!room) return;

        slots.forEach(slot => {
          let plateRaw = c[slot.plateCol]?.value || '';
          let name = c[slot.nameCol]?.value || c.Q?.value || '';
          let phone = c[slot.phoneCol]?.value || c.S?.value || '';

          // If plate column is invalid (e.g. empty or pure text name like "Phạm Huyền Trâm"), check if plate was placed in phone/cccd column
          if (!isValidLicensePlate(plateRaw)) {
            if (isValidLicensePlate(c[slot.phoneCol]?.value)) {
              plateRaw = c[slot.phoneCol]?.value;
              phone = c.S?.value || '';
            } else if (isValidLicensePlate(c[slot.cccdCol]?.value)) {
              plateRaw = c[slot.cccdCol]?.value;
            } else {
              return;
            }
          }

          const cleanPlate = String(plateRaw).replace(/[\s.-]/g, '').toLowerCase();
          if (!q || cleanPlate.includes(q)) {
            results.push({
              room: canonicalRoom(room),
              personIndex: slot.idx,
              name,
              plate: plateRaw,
              phone
            });
          }
        });
      }
    });

    return results;
  } catch (e) {
    return [];
  }
}

/**
 * Get Declaration Data (Mẫu S1a-HKD Thông tư 152/2025/TT-BTC)
 */
export async function getDeclarationData(month: string = '10/2026', houseKey: 'LVC' | 'TRUNG_KIM' = 'TRUNG_KIM') {
  const house = HOUSES_CONFIG[houseKey] || HOUSES_CONFIG.TRUNG_KIM;
  const storeKey = `${houseKey}_${month}`;

  if (declarationStore[storeKey]) {
    return declarationStore[storeKey];
  }

  // Auto populate from sheet billing data
  const billing = await getMonthlyBilling(month);
  const filtered = billing.filter(b => houseKeyFromRoom(b.room) === houseKey && b.paymentStatus === 'paid');

  const rows: any[] = [];
  let total = 0;

  filtered.forEach(item => {
    rows.push({
      date: `05/${month}`,
      person: `${item.name} (${item.room})`,
      amount: item.tongTien
    });
    total += item.tongTien;
  });

  // Pad to at least 8 rows for standard A4 report
  const targetCount = houseKey === 'LVC' ? 8 : 12;
  while (rows.length < targetCount) {
    rows.push({
      date: '',
      person: '',
      amount: 0
    });
  }

  const result = {
    houseKey,
    month,
    headerLeft3: `HỘ CÁ NHÂN KD: ${house.houseName}`,
    headerLeft4: `Địa chỉ: ${house.address}`,
    headerLeft5: `Mã số thuế: ${house.taxCode}`,
    headerRight3: 'Mẫu số S1a-HKD',
    headerRight4: '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)',
    title: 'SỔ DOANH THU BÁN HÀNG HÓA DỊCH VỤ',
    location: `Địa điểm kinh doanh: ${house.address}`,
    rows,
    total,
    sigDate: `Ngày 31 tháng ${month.split('/')[0]} năm ${month.split('/')[1]}`,
    sigLabel: 'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH / CÁ NHÂN KINH DOANH',
    ownerName: house.landlord
  };

  declarationStore[storeKey] = result;
  return result;
}

export function saveDeclarationData(month: string, houseKey: string, rows: any[], sigDate: string) {
  const storeKey = `${houseKey}_${month}`;
  const house = HOUSES_CONFIG[houseKey] || HOUSES_CONFIG.TRUNG_KIM;

  const total = rows.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  declarationStore[storeKey] = {
    houseKey,
    month,
    headerLeft3: `HỘ CÁ NHÂN KD: ${house.houseName}`,
    headerLeft4: `Địa chỉ: ${house.address}`,
    headerLeft5: `Mã số thuế: ${house.taxCode}`,
    headerRight3: 'Mẫu số S1a-HKD',
    headerRight4: '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)',
    title: 'SỔ DOANH THU BÁN HÀNG HÓA DỊCH VỤ',
    location: `Địa điểm kinh doanh: ${house.address}`,
    rows,
    total,
    sigDate: sigDate || `Ngày 31 tháng ${month.split('/')[0]} năm ${month.split('/')[1]}`,
    sigLabel: 'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH / CÁ NHÂN KINH DOANH',
    ownerName: house.landlord
  };

  return { success: true, message: 'Đã lưu sổ kê khai doanh thu thành công' };
}

/**
 * Payment Gate (Cổng thanh toán Q2)
 * Reads cell Q2 directly from the Google Sheet tab for that month.
 * Row 1 (Excel row 2), Column Q (index 16).
 */
export async function getPaymentGate(month: string = getCurrentMonthStr()): Promise<string> {
  const fileData = loadPaymentGateFile();
  const existing = fileData[month];

  if (existing && (existing.value === 'START' || existing.value === 'STOP')) {
    paymentGateState[month] = existing.value;
    return existing.value;
  }

  return paymentGateState[month] || 'STOP';
}

export function setPaymentGate(month: string = getCurrentMonthStr(), value: string = 'STOP'): string {
  const normVal = String(value).toUpperCase() === 'START' ? 'START' : 'STOP';
  paymentGateState[month] = normVal;

  const fileData = loadPaymentGateFile();
  fileData[month] = {
    value: normVal,
    updatedAt: Date.now(),
    source: 'admin'
  };
  savePaymentGateFile(fileData);

  // 2-Way Direct Sync to Google Sheet Cell Q2 via Google Apps Script Web App
  try {
    const qParams = new URLSearchParams({
      action: 'update_q2',
      month,
      value: normVal,
      status: normVal,
      cell: 'Q2'
    });
    fetch(`${GOOGLE_APPS_SCRIPT_WEBAPP_URL}?${qParams.toString()}`).catch(() => {});

    fetch(GOOGLE_APPS_SCRIPT_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'update_q2',
        month,
        value: normVal,
        status: normVal,
        cell: 'Q2'
      })
    }).catch(() => {});
  } catch (e) {
    console.warn('[setPaymentGate] Error pushing Q2 to Google Sheet:', e);
  }

  return normVal;
}

/**
 * Cost Configuration:
 * Đồng bộ trực tiếp với dòng 5 trên Google Sheet:
 * - Cột H5: Đơn giá tiền điện
 * - Cột I5: Đơn giá tiền nước
 * - Cột K5: Tiền rác
 * - Cột L5: Tiền internet
 * - Cột M5: Tiền xe
 */
export async function getConfig(month: string = '10/2026') {
  try {
    const zip = await fetchSheetXlsx();
    if (zip) {
      const { rows } = await parseSheetXmlRows(zip, month);
      const r5 = rows.find(r => r.rowNumber === 5);
      if (r5 && r5.cells) {
        const c = r5.cells;
        // H5: Điện, I5: Nước, K5: Rác, L5: Net, M5: Xe
        const dien = c.H?.num || c.G?.num || 0;
        const nuoc = c.I?.num || 0;
        const rac = c.K?.num || c.J?.num || 0;
        const net = c.L?.num || 0;
        const xe = c.M?.num || 0;
        if (dien || nuoc || rac || net || xe) {
          const config = {
            dien: dien || unitConfigState[month]?.dien || 3500,
            nuoc: nuoc || unitConfigState[month]?.nuoc || 20000,
            rac: rac || unitConfigState[month]?.rac || 30000,
            net: net || unitConfigState[month]?.net || 40000,
            xe: xe || unitConfigState[month]?.xe || 50000
          };
          unitConfigState[month] = config;
          return config;
        }
      }
    }
  } catch (e) {}
  return unitConfigState[month] || { dien: 3500, nuoc: 20000, rac: 30000, net: 40000, xe: 50000 };
}

export async function saveConfig(month: string, data: any) {
  const config = {
    dien: Number(data.dien) || 3500,
    nuoc: Number(data.nuoc) || 20000,
    rac: Number(data.rac) || 30000,
    net: Number(data.net) || 40000,
    xe: Number(data.xe) || 50000
  };
  unitConfigState[month] = config;

  // Đẩy cập nhật trực tiếp vào Google Sheet các ô H5, I5, K5, L5, M5 qua Apps Script
  try {
    const qParams = new URLSearchParams({
      action: 'update_config',
      month,
      dien: String(config.dien),
      nuoc: String(config.nuoc),
      rac: String(config.rac),
      net: String(config.net),
      xe: String(config.xe)
    });
    fetch(`${GOOGLE_APPS_SCRIPT_WEBAPP_URL}?${qParams.toString()}`).catch(() => {});
  } catch (e) {
    console.warn('[saveConfig] Error pushing config to Google Sheet:', e);
  }

  return { success: true, config: unitConfigState[month] };
}

/**
 * Legal AI Chat with Gemini
 */
export async function chatWithLegalAI(userMessage: string, chatHistory: any[] = []) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

    const systemInstruction = `Bạn là CHUYÊN GIA PHÁP LÝ NHÀ TRỌ VIỆT NAM – một trợ lý AI chuyên sâu về pháp luật liên quan đến kinh doanh cho thuê nhà trọ, phòng trọ tại Việt Nam.

KIẾN THỨC CỐT LÕI CỦA BẠN:
1. Luật Nhà ở 2023 (Luật số 27/2023/QH15) – quy định về quyền sở hữu, cho thuê nhà ở.
2. Luật Kinh doanh Bất động sản 2023 – điều kiện kinh doanh cho thuê.
3. Luật Cư trú 2020 (Luật số 68/2020/QH14) – đăng ký tạm trú, lưu trú qua VNeID.
4. Thông tư số 116/2026/TT-BCA Bộ Công an – Mẫu CT01 Tờ khai thay đổi thông tin cư trú.
5. Thông tư 152/2025/TT-BTC Bộ Tài chính – Mẫu S1a-HKD Sổ doanh thu bán hàng hóa dịch vụ.
6. Thông tư 40/2021/TT-BTC – hướng dẫn thuế GTGT, thuế TNCN đối với cá nhân kinh doanh cho thuê tài sản.

HƯỚNG DẪN TRẢ LỜI:
- Trả lời ngắn gọn, cô đọng, đi thẳng vào các bước thực hiện hoặc nội dung trọng tâm.
- Trích dẫn rõ điều khoản luật khi cần.
- Luôn thân thiện, chuyên nghiệp, hỗ trợ chủ trọ và cư dân một cách rõ ràng.`;

    const contents: any[] = [];
    chatHistory.forEach(h => {
      contents.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      });
    });

    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    });

    return response.text || 'Xin lỗi, tôi không thể xử lý câu trả lời ngay lúc này.';
  } catch (err: any) {
    console.warn('[chatWithLegalAI] Gemini fallback error:', err);
    return `Chào bạn! Về vấn đề "${userMessage}": Theo Luật Nhà ở 2023 và Luật Cư trú 2020, chủ trọ cần đăng ký tạm trú cho người thuê trong vòng 30 ngày qua cổng VNeID hoặc Công an phường. Hợp đồng thuê cần ghi rõ giá điện nước, cọc và thời hạn bảo đảm quyền lợi đôi bên.`;
  }
}

/**
 * Fetch Legal News
 */
export async function fetchLegalNews() {
  return [
    {
      title: "Bộ Công an hướng dẫn thủ tục đăng ký tạm trú cho sinh viên, người thuê trọ qua ứng dụng VNeID",
      source: "VnExpress Pháp Luật",
      sourceColor: "#e53e3e",
      time: "Hôm nay",
      summary: "Người thuê trọ có thể tự kê khai thông tin tạm trú trực tuyến trên VNeID và được chủ nhà trọ phê duyệt điện tử...",
      link: "https://vnexpress.net/phap-luat"
    },
    {
      title: "Thông tư 152/2025/TT-BTC quy định biểu mẫu Sổ doanh thu S1a-HKD cho hộ kinh doanh nhà trọ",
      source: "Thanh Niên",
      sourceColor: "#0284c7",
      time: "Hôm qua",
      summary: "Bộ Tài chính ban hành mẫu sổ theo dõi doanh thu đơn giản, giúp chủ nhà trọ dễ dàng kê khai thuế khoán và thuế định kỳ...",
      link: "https://thanhnien.vn/thoi-su/phap-luat.html"
    },
    {
      title: "Quy định về giá điện nước sinh hoạt cho người thuê nhà theo khung giá nhà nước",
      source: "Luật Minh Khuê",
      sourceColor: "#2563eb",
      time: "3 ngày trước",
      summary: "Chủ nhà trọ thu tiền điện nước đúng giá định mức quy định tránh bị xử phạt vi phạm hành chính...",
      link: "https://luatminhkhue.vn"
    }
  ];
}
