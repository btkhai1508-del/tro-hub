import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, 'columnPStatusStore.json');
// In-memory cache of room statuses
let statusCache = {};
// Clear all cache data
export function clearColumnPStatusStore() {
    statusCache = {};
    saveColumnPStatusStore();
}
// Load persisted status from file
export function loadColumnPStatusStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const data = fs.readFileSync(STORE_PATH, 'utf-8');
            statusCache = JSON.parse(data);
        }
    }
    catch (err) {
        console.warn('[columnPStatusStore] Error reading store file:', err);
    }
    return statusCache;
}
// Save status to file
export function saveColumnPStatusStore() {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(statusCache, null, 2), 'utf-8');
    }
    catch (err) {
        console.warn('[columnPStatusStore] Error writing store file:', err);
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
        status: 'UNPAID',
        label: 'Chưa thanh toán'
    },
    GREEN: {
        name: 'GREEN',
        hex: '#22C55E',
        rgb: { red: 0.133, green: 0.773, blue: 0.369 },
        status: 'BANK_TRANSFER_PAID',
        label: 'Đã thanh toán'
    }
};
/**
 * Get Column P status for a room
 */
export function getRoomColumnPStatus(roomNumber) {
    const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return statusCache[cleanRoom] || null;
}
/**
 * Get or initialize Column P status for a room (defaults to RED / UNPAID)
 */
export function getOrCreateRoomColumnPStatus(roomNumber, rowIndex) {
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
    const entry = {
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
export function setRoomColumnPStatus(roomNumber, color, details) {
    const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const config = COLUMN_P_COLORS[color];
    const rowIndex = details?.rowIndex !== undefined ? details.rowIndex : (statusCache[cleanRoom]?.rowIndex ?? -1);
    const cellAddress = rowIndex >= 0 ? `P${rowIndex + 1}` : 'P?';
    const now = new Date();
    const formattedPaidAt = details?.paidAt || `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const entry = {
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
export function syncFromLogsRows(logsRows, roomRowMap) {
    if (!logsRows || logsRows.length === 0)
        return;
    for (const logRow of logsRows) {
        if (String(logRow[0] || '').includes('Ngân hàng'))
            continue;
        const rawContent = String(logRow[5] || '').toUpperCase().trim();
        if (!rawContent || rawContent === 'NỘI DUNG THANH TOÁN')
            continue;
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
//# sourceMappingURL=columnPStatusStore.js.map