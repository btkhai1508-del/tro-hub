import { doc, getDoc, getDocs, setDoc, collection, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { parseSheetVNDAmount } from '../lib/googleSheetsService';
import { apiFetch } from '../lib/api';

export const ADMIN_SPREADSHEET_ID = "1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A";

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
 * Automatically synchronizes Google Sheet 31 columns into Firebase Firestore
 * Runs in background by default without requiring user intervention.
 */
export async function syncGoogleSheetToFirestore(month: string = '10/2026'): Promise<{
  success: boolean;
  count: number;
  rooms: SyncedRoomData[];
  error?: string;
}> {
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${ADMIN_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(month)}&t=${Date.now()}`;
    const res = await fetch(csvUrl, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

    if (!res.ok) {
      throw new Error(`Google Sheet GViz fetch returned status ${res.status}`);
    }

    const csvText = await res.text();
    const rows = parseCSV(csvText);

    if (rows.length < 10) {
      throw new Error(`Dữ liệu Google Sheet không hợp lệ (${rows.length} hàng)`);
    }

    // 1. Parse payment gate status from Row 2 (index 1)
    const gateVal = String(rows[1]?.[16] || '').trim().toUpperCase();
    if (gateVal === 'START' || gateVal === 'STOP') {
      try {
        await setDoc(doc(db, 'system_info', 'payment_gate'), {
          month,
          value: gateVal,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.warn('[Sync] Could not save payment_gate to Firestore:', e);
      }
    }

    // 2. Parse unit configuration from Row 5 (index 4)
    const unitDien = parseSheetVNDAmount(rows[4]?.[7]) || 2750;
    const unitNuoc = parseSheetVNDAmount(rows[4]?.[8]) || 20000;
    const unitRac = parseSheetVNDAmount(rows[4]?.[10]) || 30000;
    const unitNet = parseSheetVNDAmount(rows[4]?.[11]) || 40000;
    const unitXe = parseSheetVNDAmount(rows[4]?.[12]) || 50000;

    try {
      await setDoc(doc(db, 'system_info', 'unit_config'), {
        month,
        dien: unitDien,
        nuoc: unitNuoc,
        rac: unitRac,
        net: unitNet,
        xe: unitXe,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn('[Sync] Could not save unit_config to Firestore:', e);
    }

    // 3. Read existing rooms in Firestore & fetch live Column P colors from Google Sheet
    const existingStatusMap: Record<string, { paymentStatus: string; statusText: string }> = {};
    try {
      const snap = await getDocs(collection(db, 'rooms'));
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.paymentStatus) {
          existingStatusMap[canonicalRoomId(d.id)] = {
            paymentStatus: data.paymentStatus,
            statusText: data.statusText || (data.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng')
          };
        }
      });
    } catch (e) {
      console.warn('[Sync] Could not read existing rooms snapshot:', e);
    }

    // Fetch live Column P payment status from Google Sheet for accurate paid/unpaid mapping
    const liveStatusesMap: Record<string, any> = {};
    try {
      const liveRes = await apiFetch(`/api/payment/all-statuses?month=${encodeURIComponent(month)}`).catch(() => null);
      if (liveRes && liveRes.ok) {
        const liveData = await liveRes.json().catch(() => null);
        if (liveData?.roomStatuses) {
          Object.assign(liveStatusesMap, liveData.roomStatuses);
        }
      }
    } catch (liveErr) {
      console.warn('[Sync] Could not fetch live payment statuses from API:', liveErr);
    }

    // 4. Parse all 44 rooms from rows 5 to 48 (0-indexed)
    const syncedRooms: SyncedRoomData[] = [];

    for (let r = 5; r <= 48 && r < rows.length; r++) {
      const row = rows[r];
      let rawRoom = row[0] ? row[0].replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').trim() : '';

      // Google Sheet merged cells mapping
      if (!rawRoom) {
        if (r <= 11) {
          rawRoom = `G${String(r - 4).padStart(2, '0')}`;
        } else if (r >= 41 && r <= 44) {
          rawRoom = `LVC-10${r - 40}`;
        } else if (r >= 45 && r <= 48) {
          rawRoom = `LVC-20${r - 44}`;
        }
      }

      const room = canonicalRoomId(rawRoom);
      if (!room) continue;

      const dienCu = parseMeterNumber(row[1]);
      const dienMoi = parseMeterNumber(row[2]);
      const dienUsed = parseMeterNumber(row[3]) || (dienMoi > dienCu ? dienMoi - dienCu : 0);

      const nuocCu = parseMeterNumber(row[4]);
      const nuocMoi = parseMeterNumber(row[5]);
      const nuocUsed = parseMeterNumber(row[6]) || (nuocMoi > nuocCu ? nuocMoi - nuocCu : 0);

      const tienDien = parseSheetVNDAmount(row[7]);
      const tienNuoc = parseSheetVNDAmount(row[8]);
      const tienPhong = parseSheetVNDAmount(row[9]);
      const tienRac = parseSheetVNDAmount(row[10]);
      const tienNet = parseSheetVNDAmount(row[11]);
      const tienXe = parseSheetVNDAmount(row[12]);
      // Dynamic column detection: Check if month uses format 03/2026 (26 cols, Name at 14) or 04-10/2026 (30 cols, Name at 16)
      const isOldFormat = /[a-zA-ZÀ-ỹ]{2,}/.test(String(row[14] || '')) && !String(row[14] || '').includes('đ');
      let tienKhac = 0;
      let tienCoc = 0;
      let tongTien = 0;
      let nguoi1 = '', cccd1 = '', sdt1 = '', xe1 = '';
      let nguoi2 = '', cccd2 = '', sdt2 = '', xe2 = '';
      let nguoi3 = '', cccd3 = '', sdt3 = '', xe3 = '';
      let soNguoi = 1, soXe = 1;

      if (isOldFormat) {
        // Format tháng 03/2026 (26 cột)
        tongTien = parseSheetVNDAmount(row[13]) || (tienPhong + tienDien + tienNuoc + tienRac + tienNet + tienXe);
        nguoi1 = String(row[14] || '').trim();
        cccd1 = String(row[15] || '').trim();
        sdt1 = String(row[16] || '').trim();
        xe1 = String(row[17] || '').trim();
        nguoi2 = String(row[18] || '').trim();
        cccd2 = String(row[19] || '').trim();
        sdt2 = String(row[20] || '').trim();
        xe2 = String(row[21] || '').trim();
        nguoi3 = String(row[22] || '').trim();
        cccd3 = String(row[23] || '').trim();
        sdt3 = String(row[24] || '').trim();
        xe3 = String(row[25] || '').trim();
        soNguoi = parseInt(row[26], 10) || [nguoi1, nguoi2, nguoi3].filter(n => n && n !== '1' && n !== '2.0').length || 1;
        soXe = parseInt(row[27], 10) || [xe1, xe2, xe3].filter(x => x && x !== '1' && x !== '2.0' && x !== '3.0').length || 1;
      } else {
        // Format tháng 04/2026 đến 10/2026 (30 cột)
        tienKhac = parseSheetVNDAmount(row[13]);
        tienCoc = parseSheetVNDAmount(row[14]);
        tongTien = parseSheetVNDAmount(row[15]) || (tienPhong + tienDien + tienNuoc + tienRac + tienNet + tienXe + tienKhac);
        nguoi1 = String(row[16] || '').trim();
        cccd1 = String(row[17] || '').trim();
        sdt1 = String(row[18] || '').trim();
        xe1 = String(row[19] || '').trim();
        nguoi2 = String(row[20] || '').trim();
        cccd2 = String(row[21] || '').trim();
        sdt2 = String(row[22] || '').trim();
        xe2 = String(row[23] || '').trim();
        nguoi3 = String(row[24] || '').trim();
        cccd3 = String(row[25] || '').trim();
        sdt3 = String(row[26] || '').trim();
        xe3 = String(row[27] || '').trim();
        soNguoi = parseInt(row[28], 10) || [nguoi1, nguoi2, nguoi3].filter(n => n && n !== '1' && n !== '2.0').length || 1;
        soXe = parseInt(row[29], 10) || [xe1, xe2, xe3].filter(x => x && x !== '1' && x !== '2.0' && x !== '3.0').length || 1;
      }

      const tenantName = nguoi1 || `Phòng ${room}`;
      const tenantPhone = sdt1 || sdt2 || sdt3 || '';

      // Determine accurate payment status: Google Sheet Column P is Primary Source of Truth
      const liveRoomStatus = liveStatusesMap[room] || liveStatusesMap[canonicalRoomId(room)];
      let paymentStatus: 'paid' | 'unpaid' | 'pending';
      let statusText: string;

      if (liveRoomStatus) {
        paymentStatus = liveRoomStatus.paymentStatus;
        statusText = liveRoomStatus.label || (paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng');
      } else {
        // Check existing payment status from Firestore
        // Historical months (03/2026 -> 09/2026) were already collected and are marked paid
        const isPastMonth = month !== '10/2026' && month !== '11/2026' && month !== '12/2026';
        const existingStatus = existingStatusMap[room];
        paymentStatus = isPastMonth
          ? 'paid'
          : ((existingStatus?.paymentStatus as any) || 'unpaid');
        statusText = isPastMonth
          ? 'Đã đóng'
          : (existingStatus?.statusText || (paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng'));
      }

      const roomObj: SyncedRoomData = {
        room,
        name: tenantName,
        phone: tenantPhone,
        status: paymentStatus,
        statusText,
        paymentStatus,
        statusHTML: paymentStatus === 'paid'
          ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
          : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>',
        dienCu,
        dienMoi,
        dienUsed,
        nuocCu,
        nuocMoi,
        nuocUsed,
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
        month,
        row: r + 2,
        updatedAt: new Date().toISOString()
      };

      syncedRooms.push(roomObj);
    }

    // Write all rooms atomically in a single batch to avoid 44 re-render storms
    try {
      const batch = writeBatch(db);
      const monthKey = month.replace(/[\/,\s-]/g, '_');
      const isCurrentActiveMonth = month === '10/2026';

      for (const roomObj of syncedRooms) {
        // Isolate monthly historical record
        batch.set(doc(db, 'monthly_records', `${roomObj.room}_${monthKey}`), roomObj, { merge: true });

        // Only update global /rooms if this is the current active month, preserving current month state
        if (isCurrentActiveMonth) {
          batch.set(doc(db, 'rooms', roomObj.room), roomObj, { merge: true });
          if (roomObj.room.includes('LVC-')) {
            const underscoreId = roomObj.room.replace('-', '_');
            batch.set(doc(db, 'rooms', underscoreId), roomObj, { merge: true });
          }
        }
      }
      await batch.commit();
    } catch (batchErr) {
      console.warn('[Sync] Batch commit error:', batchErr);
    }

    // Save timestamp of last successful sync
    try {
      await setDoc(doc(db, 'system_info', 'last_sync'), {
        timestamp: new Date().toISOString(),
        month,
        totalRooms: syncedRooms.length
      }, { merge: true });
    } catch {}

    return {
      success: true,
      count: syncedRooms.length,
      rooms: syncedRooms
    };
  } catch (error: any) {
    console.error('[GoogleSheetSync] Error syncing to Firestore:', error);
    return {
      success: false,
      count: 0,
      rooms: [],
      error: error?.message || 'Lỗi đồng bộ Google Sheet'
    };
  }
}

export const GOOGLE_APPS_SCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzQXCBcLJIE969ciS6YFlgZ37vkb-ec3w81Yr9uXXuWZAifVBa_2ewoeQUtk6rsYv62/exec";

/**
 * Pushes updates from Web/Firebase directly into Google Sheet via Google Apps Script Web App
 */
export async function pushUpdateToGoogleSheet(params: {
  action?: string;
  room: string;
  status?: 'paid' | 'unpaid';
  month?: string;
  dienMoi?: number;
  nuocMoi?: number;
}): Promise<void> {
  if (!GOOGLE_APPS_SCRIPT_WEBAPP_URL) return;
  const cleanRoom = canonicalRoomId(params.room);
  const qParams = new URLSearchParams({
    action: params.action || 'update_payment',
    room: cleanRoom,
    status: params.status || '',
    month: params.month || '10/2026',
    dienMoi: params.dienMoi ? String(params.dienMoi) : '',
    nuocMoi: params.nuocMoi ? String(params.nuocMoi) : ''
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
        nuocMoi: params.nuocMoi
      })
    }).catch(() => {});
  } catch {}
}
