import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getStorePath(): string {
  const defaultPath = path.resolve(__dirname, 'columnPStatusStore.json');
  try {
    const dir = path.dirname(defaultPath);
    if (fs.existsSync(dir)) {
      fs.accessSync(dir, fs.constants.W_OK);
      return defaultPath;
    }
  } catch {}
  return '/tmp/columnPStatusStore.json';
}
const STORE_PATH = getStorePath();

export type ColumnPColor = 'RED' | 'GREEN';
export type PaymentStatusType = 'UNPAID' | 'BANK_TRANSFER_PAID';

export interface RoomColumnPStatus {
  roomNumber: string;
  rowIndex: number; // 0-indexed row in monthly sheet
  cellAddress: string; // e.g. "P6", "P15", "P23"
  color: ColumnPColor;
  status: PaymentStatusType;
  label: string; // "Chưa thanh toán" | "Đã thanh toán"
  updatedAt: string;
  amount?: number;
  transactionId?: string;
  paidAt?: string;
  month?: string;
  paymentMethod?: 'qr';
}

// In-memory cache of room statuses
let statusCache: Record<string, RoomColumnPStatus> = {};

// Clear all cache data
export function clearColumnPStatusStore(): void {
  statusCache = {};
  saveColumnPStatusStore();
}

// Load persisted status from file
export function loadColumnPStatusStore(): Record<string, RoomColumnPStatus> {
  const candidates = [STORE_PATH, path.resolve(__dirname, 'columnPStatusStore.json'), '/tmp/columnPStatusStore.json'];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const data = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          statusCache = { ...statusCache, ...parsed };
        }
      }
    } catch {}
  }
  return statusCache;
}

// Save status to file
export function saveColumnPStatusStore(): void {
  const candidates = [STORE_PATH, '/tmp/columnPStatusStore.json'];
  for (const p of candidates) {
    try {
      fs.writeFileSync(p, JSON.stringify(statusCache, null, 2), 'utf-8');
      break;
    } catch (err) {
      console.warn('[columnPStatusStore] Error writing to candidate path ' + p + ':', err);
    }
  }
}

// Initialize on module load
loadColumnPStatusStore();

/**
 * Standard colors for Column P
 */
export const COLUMN_P_COLORS = {
  RED: {
    name: 'RED',
    hex: '#EF4444',
    rgb: { red: 0.937, green: 0.267, blue: 0.267 },
    status: 'UNPAID' as PaymentStatusType,
    label: 'Chưa thanh toán'
  },
  GREEN: {
    name: 'GREEN',
    hex: '#22C55E',
    rgb: { red: 0.133, green: 0.773, blue: 0.369 },
    status: 'BANK_TRANSFER_PAID' as PaymentStatusType,
    label: 'Đã thanh toán'
  }
};

/**
 * Get Column P status for a room
 */
export function getRoomColumnPStatus(roomNumber: string): RoomColumnPStatus | null {
  const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return statusCache[cleanRoom] || null;
}

/**
 * Get or initialize Column P status for a room (defaults to RED / UNPAID)
 */
export function getOrCreateRoomColumnPStatus(roomNumber: string, rowIndex?: number): RoomColumnPStatus {
  const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const existing = statusCache[cleanRoom];
  if (existing) {
    if (rowIndex !== undefined && (existing.rowIndex === -1 || existing.rowIndex === undefined)) {
      existing.rowIndex = rowIndex;
      existing.cellAddress = `P${rowIndex + 1}`;
      saveColumnPStatusStore();
    }
    return existing;
  }

  const rIdx = rowIndex !== undefined ? rowIndex : -1;
  const entry: RoomColumnPStatus = {
    roomNumber: cleanRoom,
    rowIndex: rIdx,
    cellAddress: rIdx >= 0 ? `P${rIdx + 1}` : 'P?',
    color: 'RED',
    status: 'UNPAID',
    label: 'Chưa thanh toán',
    updatedAt: new Date().toISOString(),
    month: '10/2026'
  };
  statusCache[cleanRoom] = entry;
  saveColumnPStatusStore();
  return entry;
}

/**
 * Set Column P status for a room:
 * - Updates Column P ONLY
 * - Does NOT modify Column A
 */
export function setRoomColumnPStatus(
  roomNumber: string,
  color: ColumnPColor,
  details?: {
    rowIndex?: number;
    amount?: number;
    transactionId?: string;
    paidAt?: string;
    month?: string;
  }
): RoomColumnPStatus {
  const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const config = COLUMN_P_COLORS[color];
  const rowIndex = details?.rowIndex !== undefined ? details.rowIndex : (statusCache[cleanRoom]?.rowIndex ?? -1);
  const cellAddress = rowIndex >= 0 ? `P${rowIndex + 1}` : 'P?';
  const now = new Date();
  const formattedPaidAt = details?.paidAt || `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const entry: RoomColumnPStatus = {
    roomNumber: cleanRoom,
    rowIndex,
    cellAddress,
    color,
    status: config.status,
    label: config.label,
    updatedAt: new Date().toISOString(),
    amount: details?.amount || statusCache[cleanRoom]?.amount,
    transactionId: details?.transactionId || statusCache[cleanRoom]?.transactionId || (color !== 'RED' ? `TXN-${Date.now()}` : undefined),
    paidAt: color !== 'RED' ? formattedPaidAt : undefined,
    month: details?.month || statusCache[cleanRoom]?.month || '10/2026',
    paymentMethod: color === 'GREEN' ? 'qr' : undefined
  };

  statusCache[cleanRoom] = entry;
  saveColumnPStatusStore();
  console.log(`[columnPStatusStore] Room ${cleanRoom} (${cellAddress}) set to ${color} (${config.label})`);
  return entry;
}

/**
 * Sync status from Tab "Logs" rows
 * When a transaction like "G02T102026" or "203-T10-2026" is found in Logs,
 * mark that room's Column P as GREEN (BANK_TRANSFER_PAID)
 */
export function syncFromLogsRows(logsRows: string[][], roomRowMap: Record<string, number>): void {
  if (!logsRows || logsRows.length === 0) return;

  for (const logRow of logsRows) {
    if (String(logRow[0] || '').includes('Ngân hàng')) continue;
    const rawContent = String(logRow[5] || '').toUpperCase().trim();
    if (!rawContent || rawContent === 'NỘI DUNG THANH TOÁN') continue;

    const amountStr = String(logRow[7] || '').replace(/[^\d]/g, '');
    const amount = parseInt(amountStr, 10) || 0;
    const dateStr = String(logRow[1] || '').trim();
    const txnCode = String(logRow[8] || logRow[2] || '').trim();

    // Extract exact room from transfer description (e.g. "G02T102026", "203-T10", "LVC203-T10-2026")
    const match = rawContent.match(/(?:LVC|P|^|\s)([A-Z]?\d{2,4})(?:T|-|\s|$)/);
    if (match && match[1]) {
      const detectedRoom = match[1].toUpperCase();
      const rIdx = roomRowMap[detectedRoom];
      if (rIdx !== undefined) {
        const current = getRoomColumnPStatus(detectedRoom);
        if (!current || current.color === 'RED') {
          setRoomColumnPStatus(detectedRoom, 'GREEN', {
            rowIndex: rIdx,
            amount: amount || undefined,
            transactionId: txnCode || `LOGS-${Date.now()}`,
            paidAt: dateStr || undefined,
            month: '10/2026'
          });
        }
      }
    }
  }
}
