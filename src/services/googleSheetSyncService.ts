import { parseSheetVNDAmount } from '../lib/googleSheetsService';
import { apiFetch } from '../lib/api';

export const ADMIN_SPREADSHEET_ID = "1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A";
export const GOOGLE_APPS_SCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzQXCBcLJIE969ciS6YFlgZ37vkb-ec3w81Yr9uXXuWZAifVBa_2ewoeQUtk6rsYv62/exec";

export interface SyncedRoomData {
  room: string;
  name: string;
  phone: string;
  status: 'paid' | 'unpaid' | 'pending';
  statusText: string;
  paymentStatus: 'paid' | 'unpaid' | 'pending';
  statusHTML?: string;
  dienCu: number;
  dienMoi: number;
  dienUsed: number;
  nuocCu: number;
  nuocMoi: number;
  nuocUsed: number;
  tienPhong: number;
  tienDien: number;
  tienNuoc: number;
  tienRac: number;
  tienNet: number;
  tienXe: number;
  tienKhac: number;
  tienCoc: number;
  tongTien: number;
  nguoi1: string;
  cccd1: string;
  sdt1: string;
  xe1: string;
  nguoi2: string;
  cccd2: string;
  sdt2: string;
  xe2: string;
  nguoi3: string;
  cccd3: string;
  sdt3: string;
  xe3: string;
  soNguoi: number;
  soXe: number;
  soNet?: number;
  month: string;
  row?: number;
  updatedAt: string;
}

/**
 * Standardize room identifier
 */
export function canonicalRoomId(raw: any): string {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase().replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').replace(/\.0+$/, '');
  if (s.includes('LVC')) {
    const num = s.replace(/\D/g, '');
    return num ? `LVC-${num}` : s;
  }
  if (/^G\d+$/i.test(s)) {
    const num = s.replace(/\D/g, '');
    return `G${num.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+/, '') || s;
  }
  return s;
}

/**
 * Parse meter number (handles Vietnamese dot-as-thousand separator e.g. 6.432 -> 6432)
 */
export function parseMeterNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).trim().replace(/[^\d.,-]/g, '');
  if (!str) return 0;
  if (/^\d{1,3}\.\d{3}$/.test(str)) {
    return parseInt(str.replace('.', ''), 10);
  }
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(/,/g, '.');
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Robust CSV parser
 */
export function parseCSV(text: string): string[][] {
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
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c !== '')) {
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
    if (currentRow.some(c => c !== '')) {
      lines.push(currentRow);
    }
  }

  return lines;
}

/**
 * Pushes updates directly into Google Sheet via Google Apps Script Web App
 */
export async function pushUpdateToGoogleSheet(params: {
  action?: string;
  room: string;
  status?: 'paid' | 'unpaid';
  month?: string;
  dienMoi?: number;
  nuocMoi?: number;
  row?: number;
}): Promise<void> {
  if (!GOOGLE_APPS_SCRIPT_WEBAPP_URL) return;
  const cleanRoom = canonicalRoomId(params.room);
  const qParams = new URLSearchParams({
    action: params.action || 'update_payment',
    room: cleanRoom,
    status: params.status || '',
    month: params.month || '10/2026',
    dienMoi: params.dienMoi ? String(params.dienMoi) : '',
    nuocMoi: params.nuocMoi ? String(params.nuocMoi) : '',
    row: params.row ? String(params.row) : ''
  });

  // Try both GET and POST with no-cors fallback so it never blocks in browser
  try {
    fetch(`${GOOGLE_APPS_SCRIPT_WEBAPP_URL}?${qParams.toString()}`, {
      method: 'GET',
      mode: 'no-cors'
    }).catch(() => {});
  } catch {}

  try {
    fetch(GOOGLE_APPS_SCRIPT_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: params.action || 'update_payment',
        room: cleanRoom,
        status: params.status,
        month: params.month || '10/2026',
        dienMoi: params.dienMoi,
        nuocMoi: params.nuocMoi,
        row: params.row
      })
    }).catch(() => {});
  } catch {}
}

/**
 * Backward compatibility stub
 */
export async function syncGoogleSheetToFirestore(month: string = '10/2026'): Promise<{
  success: boolean;
  count: number;
  rooms: SyncedRoomData[];
  error?: string;
}> {
  return {
    success: true,
    count: 0,
    rooms: []
  };
}
