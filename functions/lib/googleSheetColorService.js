import AdmZip from 'adm-zip';
import { setRoomColumnPStatus, getRoomColumnPStatus } from './columnPStatusStore.js';
/**
 * Normalizes tab or month string to MM/YYYY format
 * E.g. "102026" -> "10/2026", "10, 2026" -> "10/2026", "10-2026" -> "10/2026"
 */
export function normalizeMonthFormat(tabOrMonth) {
    if (!tabOrMonth)
        return '10/2026';
    const clean = tabOrMonth.trim();
    // 6 digits like "102026" or "092026"
    const sixDigits = clean.match(/^(\d{2})(\d{4})$/);
    if (sixDigits) {
        return `${sixDigits[1]}/${sixDigits[2]}`;
    }
    // Separated like "10/2026", "10, 2026", "Tháng 10/2026", "T10/2026"
    const mMatch = clean.match(/(\d{1,2})[\/,\s-]+(\d{4})/);
    if (mMatch) {
        return `${mMatch[1].padStart(2, '0')}/${mMatch[2]}`;
    }
    return clean;
}
/**
 * Normalizes room identifier for comparison:
 * "P.203" -> "203", "P. G02" -> "G02", "phòng 101" -> "101"
 */
export function normalizeRoomId(input) {
    if (!input)
        return '';
    return String(input)
        .trim()
        .toUpperCase()
        .replace(/^(P\.|P\s+|PHÒNG\s+)/i, '')
        .trim();
}
/**
 * Checks whether two room strings match (exact, without prefix, or by room digits)
 * CRITICAL: LVC rooms (e.g. LVC101) must NEVER match standard rooms (e.g. 101)
 */
export function isSameRoom(roomA, roomB) {
    const normA = normalizeRoomId(roomA);
    const normB = normalizeRoomId(roomB);
    if (!normA || !normB)
        return false;
    if (normA === normB)
        return true;
    // LVC rooms must NEVER match non-LVC rooms
    const isLvcA = normA.includes('LVC');
    const isLvcB = normB.includes('LVC');
    if (isLvcA !== isLvcB)
        return false;
    // Ground rooms must NEVER match non-ground rooms
    const isGroundA = normA.startsWith('G');
    const isGroundB = normB.startsWith('G');
    if (isGroundA !== isGroundB)
        return false;
    // Compare alphanumeric only (e.g. "G02" vs "G-02", "LVC-101" vs "LVC101")
    const alnumA = normA.replace(/[^0-9A-Z]/g, '');
    const alnumB = normB.replace(/[^0-9A-Z]/g, '');
    if (alnumA && alnumB && alnumA === alnumB)
        return true;
    // Compare numeric digits if purely numeric (e.g. "203" vs "203.0")
    const numA = normA.replace(/[^\d]/g, '');
    const numB = normB.replace(/[^\d]/g, '');
    if (numA && numB && numA === numB) {
        return true;
    }
    return false;
}
/**
 * Maps background color hex to official payment status:
 *
 * RED PASTEL: #F7D1D5 (and related red shades #F8D7DA, #EA9999, #F4CCCC, or default)
 *   -> paymentStatus = "unpaid", paymentMethod = null, label = "Chưa thanh toán"
 *
 * GREEN / BLUE PASTEL: #CEEAD5 / #D4EDDA / #CCE5FF
 *   -> paymentStatus = "paid", paymentMethod = "bank_transfer", label = "Đã thanh toán"
 */
export function mapColorToPaymentStatus(hexColor) {
    const hex = (hexColor || '#FFFFFF').toUpperCase();
    const r = parseInt(hex.slice(1, 3), 16) || 255;
    const g = parseInt(hex.slice(3, 5), 16) || 255;
    const b = parseInt(hex.slice(5, 7), 16) || 255;
    // 1. GREEN / BLUE / PAID PASTEL -> Bank transfer paid
    if (hex === '#CEEAD5' ||
        hex === '#D4EDDA' ||
        hex === '#B6D7A8' ||
        hex === '#A8D08D' ||
        hex === '#C5E1FF' ||
        hex === '#CCE5FF' ||
        hex === '#CFE2F3' ||
        hex === '#9FC5E8' ||
        hex === '#D2E3FC' ||
        (g > 200 && g > r && g > b) ||
        (b > 200 && b > r + 15 && b > g + 10)) {
        return {
            paymentStatus: 'paid',
            paymentMethod: 'bank_transfer',
            label: 'Đã thanh toán',
            normalizedColor: '#CEEAD5'
        };
    }
    // 2. RED PASTEL (#F7D1D5 / #F8D7DA / #EA9999 / #F4CCCC / default white) -> Unpaid
    return {
        paymentStatus: 'unpaid',
        paymentMethod: null,
        label: 'Chưa thanh toán',
        normalizedColor: '#F7D1D5'
    };
}
/**
 * Fetch real-time rows from tab "Logs" via GViz
 */
async function fetchLogsData(sheetId) {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Logs&t=${Date.now()}`;
        const res = await fetch(url, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        if (!res.ok)
            return [];
        const text = await res.text();
        return text.split('\n').map(line => {
            const parts = [];
            let cur = '';
            let inQ = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') {
                    inQ = !inQ;
                }
                else if (c === ',' && !inQ) {
                    parts.push(cur.trim().replace(/^"|"$/g, ''));
                    cur = '';
                }
                else {
                    cur += c;
                }
            }
            parts.push(cur.trim().replace(/^"|"$/g, ''));
            return parts;
        });
    }
    catch {
        return [];
    }
}
/**
 * Checks if a room has a confirmed incoming transfer in tab "Logs"
 */
export function checkRoomTransferInLogs(logsRows, roomNumber, targetMonth = '10/2026') {
    if (!logsRows || logsRows.length === 0)
        return { found: false };
    const cleanRoom = roomNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!cleanRoom || cleanRoom === '0')
        return { found: false };
    const monthParts = targetMonth.split('/');
    const mm = (monthParts[0] || '10').padStart(2, '0');
    const mmNum = parseInt(mm, 10);
    const yyyy = monthParts[1] || '2026';
    // Strict regex: room must be at beginning or preceded by prefix, followed by T{month} or delimiter
    // MUST NOT match "202" inside year "2026" or "0" inside "102"
    const roomPattern = new RegExp(`(?:^|[\\s_]|LVC|P[.\\s]*)` + cleanRoom + `(?:T${mm}|T${mmNum}|-T${mm}|-T${mmNum}|\\s*T${mm}|\\s*T${mmNum}|[\\s-]+|$)`, 'i');
    for (const row of logsRows) {
        const rowType = String(row[6] || '').trim();
        if (rowType && !rowType.toLowerCase().includes('vào') && !rowType.toLowerCase().includes('in')) {
            continue;
        }
        const content = String(row[5] || '').toUpperCase().trim();
        if (!content)
            continue;
        if (roomPattern.test(content)) {
            const amountStr = String(row[7] || '').replace(/[^\d]/g, '');
            const amount = parseInt(amountStr, 10) || 0;
            const date = String(row[1] || '').trim();
            const txnCode = String(row[8] || row[2] || '').trim();
            return { found: true, amount, txnCode, date };
        }
    }
    return { found: false };
}
/**
 * Downloads and parses Google Sheet XLSX to read all room statuses from Column P of the current month tab.
 * Also cross-checks real-time incoming transfers from tab "Logs".
 * Always formats month as MM/YYYY (e.g. "10/2026").
 */
export async function fetchAllSheetColumnPStatuses(spreadsheetId, targetMonth) {
    const cleanId = spreadsheetId.replace(/.*\/spreadsheets\/d\/([a-zA-Z0-9-_]+).*/, '$1');
    const exportUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=xlsx&t=${Date.now()}`;
    const [sheetRes, logsRows] = await Promise.all([
        fetch(exportUrl, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        }),
        fetchLogsData(cleanId)
    ]);
    if (!sheetRes.ok) {
        throw new Error(`Failed to export Google Sheet as XLSX (HTTP ${sheetRes.status})`);
    }
    const buf = Buffer.from(await sheetRes.arrayBuffer());
    const zip = new AdmZip(buf);
    // 1. Parse workbook.xml & rels to list tabs
    const workbookXml = zip.readAsText('xl/workbook.xml');
    const relsXml = zip.readAsText('xl/_rels/workbook.xml.rels');
    const sheetMatches = workbookXml.match(/<sheet[^>]+name=\"([^\"]+)\"[^>]+r:id=\"([^\"]+)\"/g) || [];
    const sheets = [];
    for (const s of sheetMatches) {
        const name = s.match(/name=\"([^\"]+)\"/)?.[1] || '';
        const rId = s.match(/r:id=\"([^\"]+)\"/)?.[1] || '';
        const relMatch = relsXml.match(new RegExp(`Id=\"${rId}\"[^>]+Target=\"([^\"]+)\"`));
        const target = relMatch ? relMatch[1] : '';
        const targetFile = target.startsWith('xl/') ? target : `xl/${target}`;
        sheets.push({ name, rId, targetFile });
    }
    // 2. Identify Target Month Sheet
    let currentMonthSheet;
    if (targetMonth) {
        const normReq = normalizeMonthFormat(targetMonth);
        const cleanReqDigits = normReq.replace(/\D/g, ''); // e.g. "102026"
        const [reqM, reqY] = normReq.split('/');
        currentMonthSheet = sheets.find(s => {
            const cleanName = s.name.replace(/\s+/g, '');
            const cleanDigits = s.name.replace(/\D/g, '');
            return (cleanDigits === cleanReqDigits ||
                cleanName === normReq ||
                cleanName.includes(normReq) ||
                (reqM && reqY && (cleanName.includes(`${reqM}/${reqY}`) || cleanName.includes(`${parseInt(reqM, 10)}/${reqY}`))));
        });
    }
    if (!currentMonthSheet) {
        const now = new Date();
        const m = now.getMonth() + 1; // 1-12
        const y = now.getFullYear(); // e.g. 2026
        const padM = m < 10 ? `0${m}` : `${m}`;
        currentMonthSheet = sheets.find(s => {
            const cleanName = s.name.replace(/\s+/g, '');
            return (cleanName.includes(`${padM}${y}`) ||
                cleanName.includes(`${m}${y}`) ||
                cleanName.includes(`${m}/${y}`) ||
                cleanName.includes(`${padM}/${y}`) ||
                cleanName.includes(`${m},${y}`) ||
                cleanName.includes(`${padM},${y}`));
        });
    }
    if (!currentMonthSheet) {
        const now = new Date();
        const m = now.getMonth() + 1;
        currentMonthSheet = sheets.find(s => {
            const lower = s.name.toLowerCase();
            return ((lower.includes(String(m)) || lower.includes(`tháng ${m}`)) &&
                !lower.includes('log') &&
                !lower.includes('thông tin') &&
                !lower.includes('profile'));
        });
    }
    if (!currentMonthSheet) {
        currentMonthSheet = sheets.find(s => /^\d{6}$/.test(s.name) || /^\d{2}\/\d{4}$/.test(s.name))
            || sheets[sheets.length - 2] || sheets[1] || sheets[0];
    }
    const rawTabName = currentMonthSheet.name;
    const formattedMonth = normalizeMonthFormat(targetMonth || rawTabName);
    // 3. Parse fills from xl/styles.xml
    const stylesXml = zip.readAsText('xl/styles.xml');
    const fills = [];
    const fillsBlock = stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] || '';
    const fillMatches = fillsBlock.match(/<fill[\s\S]*?<\/fill>/g) || [];
    for (const fill of fillMatches) {
        const rgbMatch = fill.match(/rgb=\"([A-Fa-f0-9]{6,8})\"/i);
        if (rgbMatch) {
            const rawHex = rgbMatch[1];
            fills.push('#' + (rawHex.length === 8 ? rawHex.slice(2) : rawHex).toUpperCase());
        }
        else {
            fills.push('#FFFFFF');
        }
    }
    // 4. Parse cellXfs from xl/styles.xml
    const cellXfs = [];
    const xfsBlock = stylesXml.split('<cellXfs')[1]?.split('</cellXfs>')[0] || '';
    const xfParts = xfsBlock.split('<xf ');
    for (let i = 1; i < xfParts.length; i++) {
        const fillMatch = xfParts[i].match(/fillId=\"(\d+)\"/);
        cellXfs.push(fillMatch ? parseInt(fillMatch[1], 10) : 0);
    }
    // 5. Parse sharedStrings.xml
    const stringsXml = zip.readAsText('xl/sharedStrings.xml') || '';
    const sharedStrings = [];
    const siMatches = stringsXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
        const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        sharedStrings.push(tMatches.map(t => t.replace(/<[^>]+>/g, '')).join(''));
    }
    // 6. Read Worksheet XML and extract Column A (Room) and Column P (Payment status color)
    const sheetXml = zip.readAsText(currentMonthSheet.targetFile);
    const rowChunks = sheetXml.split('<row ');
    const roomStatuses = {};
    for (let i = 1; i < rowChunks.length; i++) {
        const chunk = rowChunks[i];
        const rMatch = chunk.match(/^r=\"(\d+)\"/);
        if (!rMatch)
            continue;
        const rInt = parseInt(rMatch[1], 10);
        // Read Column A (Room number)
        const cellAPart = chunk.split(`<c r="A${rInt}"`)[1]?.split('</c>')[0] || '';
        let roomA = '';
        if (cellAPart) {
            const isString = cellAPart.includes('t="s"');
            const v = cellAPart.match(/<v>([^<]+)<\/v>/)?.[1];
            if (v !== undefined) {
                roomA = isString ? (sharedStrings[parseInt(v, 10)] || '') : v;
                roomA = roomA.replace(/\.0+$/, '').trim();
            }
        }
        if (!roomA && rInt >= 7 && rInt <= 13) {
            roomA = `G0${rInt - 6}`;
        }
        if (!roomA && rInt >= 43 && rInt <= 46) {
            roomA = `LVC10${rInt - 42}`;
        }
        if (!roomA && rInt >= 47 && rInt <= 50) {
            roomA = `LVC20${rInt - 46}`;
        }
        if (!roomA)
            continue;
        const cleanRoomKey = normalizeRoomId(roomA).replace(/[^0-9A-Z]/g, '');
        // Read Column P (Payment status cell)
        const cellPPart = chunk.split(`<c r="P${rInt}"`)[1]?.split('</c>')[0] || '';
        let pColorHex = '#FFFFFF';
        let pAmount = 0;
        if (cellPPart) {
            const sMatch = cellPPart.match(/s="(\d+)"/);
            if (sMatch) {
                const sIdx = parseInt(sMatch[1], 10);
                const fillId = cellXfs[sIdx];
                pColorHex = fills[fillId] || '#FFFFFF';
            }
            const valMatch = cellPPart.match(/<v>([^<]+)<\/v>/)?.[1];
            if (valMatch) {
                pAmount = parseFloat(valMatch) || 0;
            }
        }
        const mapped = mapColorToPaymentStatus(pColorHex);
        let finalPaymentStatus = mapped.paymentStatus;
        let finalPaymentMethod = mapped.paymentMethod;
        let finalLabel = mapped.label;
        let finalSheetColor = mapped.normalizedColor;
        let finalTxnId = undefined;
        let finalPaidAt = undefined;
        const cachedStatus = getRoomColumnPStatus(cleanRoomKey);
        if (cachedStatus && cachedStatus.color === 'GREEN') {
            finalPaymentStatus = 'paid';
            finalPaymentMethod = 'bank_transfer';
            finalSheetColor = '#CEEAD5';
            finalLabel = 'Đã thanh toán';
            finalTxnId = cachedStatus.transactionId;
            finalPaidAt = cachedStatus.paidAt;
        }
        else if (finalPaymentStatus !== 'paid') {
            // Cross-check real-time transfers in tab "Logs"
            // If Column P is not yet green on sheet but money was received in Logs:
            const transfer = checkRoomTransferInLogs(logsRows, roomA, formattedMonth);
            if (transfer.found) {
                finalPaymentStatus = 'paid';
                finalPaymentMethod = 'bank_transfer';
                finalSheetColor = '#CEEAD5'; // GREEN
                finalLabel = 'Đã thanh toán';
                finalTxnId = transfer.txnCode;
                finalPaidAt = transfer.date;
                // Persist to store so server components stay consistent
                setRoomColumnPStatus(cleanRoomKey, 'GREEN', {
                    rowIndex: rInt - 1,
                    amount: transfer.amount || pAmount,
                    transactionId: transfer.txnCode,
                    paidAt: transfer.date,
                    month: formattedMonth
                });
            }
        }
        const result = {
            success: true,
            roomNumber: roomA,
            foundRow: rInt,
            cellAddress: `P${rInt}`,
            tabName: formattedMonth, // Strictly MM/YYYY
            rawTabName,
            paymentStatus: finalPaymentStatus,
            paymentMethod: finalPaymentMethod,
            sheetColor: finalSheetColor,
            label: finalLabel,
            amount: pAmount,
            transactionId: finalTxnId,
            paidAt: finalPaidAt
        };
        roomStatuses[cleanRoomKey] = result;
        roomStatuses[roomA.toUpperCase()] = result;
    }
    return {
        tabName: formattedMonth,
        rawTabName,
        roomStatuses
    };
}
/**
 * Reads the payment status for a specific room directly from Google Sheet Column P
 * with real-time transfer cross-checking from tab "Logs".
 * Always formats month as MM/YYYY (e.g. "10/2026").
 */
export async function getLiveRoomPaymentStatus(spreadsheetId, targetRoom, targetMonth) {
    const normTarget = normalizeRoomId(targetRoom);
    if (!normTarget) {
        return {
            success: false,
            roomNumber: targetRoom,
            foundRow: -1,
            cellAddress: 'N/A',
            tabName: targetMonth || '10/2026',
            paymentStatus: 'unpaid',
            paymentMethod: null,
            sheetColor: '#F7D1D5',
            label: 'Chưa thanh toán',
            amount: 0,
            error: 'Thiếu mã phòng'
        };
    }
    try {
        const { tabName, rawTabName, roomStatuses } = await fetchAllSheetColumnPStatuses(spreadsheetId, targetMonth);
        // 1. Direct lookup
        let match = roomStatuses[normTarget] || roomStatuses[targetRoom.toUpperCase()];
        // 2. Fuzzy / fallback room matching
        if (!match) {
            for (const [k, v] of Object.entries(roomStatuses)) {
                if (isSameRoom(k, normTarget)) {
                    match = v;
                    break;
                }
            }
        }
        if (match) {
            return match;
        }
        // Room not found in sheet rows -> default unpaid
        return {
            success: true,
            roomNumber: targetRoom,
            foundRow: -1,
            cellAddress: 'N/A',
            tabName,
            rawTabName,
            paymentStatus: 'unpaid',
            paymentMethod: null,
            sheetColor: '#F7D1D5',
            label: 'Chưa thanh toán',
            amount: 0
        };
    }
    catch (err) {
        console.error('[getLiveRoomPaymentStatus] Error reading sheet:', err);
        return {
            success: false,
            roomNumber: targetRoom,
            foundRow: -1,
            cellAddress: 'N/A',
            tabName: '10/2026',
            paymentStatus: 'unpaid',
            paymentMethod: null,
            sheetColor: '#F7D1D5',
            label: 'Chưa thanh toán',
            amount: 0,
            error: err.message || 'Lỗi đọc Google Sheet'
        };
    }
}
//# sourceMappingURL=googleSheetColorService.js.map