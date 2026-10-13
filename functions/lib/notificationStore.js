import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchSheetDataViaGviz, DEFAULT_SPREADSHEET_ID, normalizeRoom, matchRoom } from './googleSheetsBackendService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, 'notificationsStore.json');
export const GOOGLE_APPS_SCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzQXCBcLJIE969ciS6YFlgZ37vkb-ec3w81Yr9uXXuWZAifVBa_2ewoeQUtk6rsYv62/exec";
let notificationsCache = [];
/**
 * Load local fallback cache
 */
export function loadNotificationsStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const data = fs.readFileSync(STORE_PATH, 'utf-8');
            notificationsCache = JSON.parse(data);
        }
        else {
            notificationsCache = [];
            saveNotificationsStore();
        }
    }
    catch (err) {
        console.warn('[notificationStore] Error reading store file:', err);
        notificationsCache = [];
    }
    return notificationsCache;
}
export function saveNotificationsStore() {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(notificationsCache, null, 2), 'utf-8');
    }
    catch (err) {
        console.warn('[notificationStore] Error writing store file:', err);
    }
}
/**
 * Fetch live notifications directly from Google Sheet tab "Notifications"
 * Columns:
 * A: Date
 * B: Phòng
 * C: Loại thông báo
 * D: Nội dung
 * Từ row 2 trở đi
 */
export async function fetchNotificationsFromGoogleSheet(sheetId = DEFAULT_SPREADSHEET_ID) {
    try {
        const rows = await fetchSheetDataViaGviz(sheetId, 'Notifications');
        if (!rows || rows.length <= 1) {
            return [];
        }
        const items = [];
        // Row 0 is header [Date, Phòng, Loại, Nội dung], start from Row 1 (row 2 in spreadsheet)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = String(row[0] || '').trim();
            const rawRoom = String(row[1] || '').trim();
            const rawType = String(row[2] || '').trim().toLowerCase();
            const rawContent = String(row[3] || '').trim();
            if (!rawDate && !rawRoom && !rawContent)
                continue;
            // Extract title and description from content: e.g. "[Tiêu đề] Nội dung..."
            let title = '';
            let desc = rawContent;
            const titleMatch = rawContent.match(/^\[(.*?)\]\s*([\s\S]*)$/);
            if (titleMatch) {
                title = titleMatch[1].trim();
                desc = titleMatch[2].trim();
            }
            else {
                const firstLineBreak = rawContent.indexOf('\n');
                if (firstLineBreak > 0 && firstLineBreak < 80) {
                    title = rawContent.slice(0, firstLineBreak).trim();
                    desc = rawContent.slice(firstLineBreak + 1).trim();
                }
                else {
                    title = rawContent.slice(0, 50);
                }
            }
            // Map notification type
            let type = 'info';
            if (rawType.includes('thanh toán') || rawType.includes('tiền') || rawType.includes('invoice')) {
                type = 'invoice';
            }
            else if (rawType.includes('nhắc nhở') || rawType.includes('cảnh báo') || rawType.includes('alert')) {
                type = 'alert';
            }
            else if (rawType.includes('thành công') || rawType.includes('success')) {
                type = 'success';
            }
            // Map target and target rooms
            const upperRoom = rawRoom.toUpperCase();
            let target = 'CUSTOM';
            let customRooms = [];
            if (!rawRoom || upperRoom === 'TẤT CẢ' || upperRoom === 'ALL' || upperRoom === 'TOÀN BỘ') {
                target = 'ALL';
            }
            else if (upperRoom === 'LVC' || upperRoom.includes('LÊ VĂN CHÍ')) {
                target = 'LVC';
            }
            else if (upperRoom === 'TRUNG KIM' || upperRoom === 'TK') {
                target = 'TRUNG_KIM';
            }
            else {
                target = 'CUSTOM';
                customRooms = rawRoom
                    .split(/[,;\s]+/)
                    .map(r => r.trim())
                    .filter(Boolean);
            }
            items.push({
                id: `sheet-notif-${i}-${Date.now()}`,
                title: title || 'Thông báo từ Ban Quản Lý',
                desc: desc || rawContent,
                time: rawDate || 'Gần đây',
                createdAt: new Date().toISOString(),
                type,
                target,
                customRooms,
                sender: target === 'ALL' ? 'Ban Quản Lý Nhà Trọ Phong Lan' : `Ban Quản Lý (${rawRoom})`,
                unread: true
            });
        }
        // Newest notifications first
        return items.reverse();
    }
    catch (err) {
        console.warn('[notificationStore] Error fetching Notifications tab from Google Sheet:', err);
        return [];
    }
}
/**
 * Add a notification and sync directly to Google Sheet tab "Notifications"
 */
export function addNotification(item) {
    const notif = {
        ...item,
        createdAt: item.createdAt || new Date().toISOString()
    };
    // 1. Add to local cache immediately
    notificationsCache = [notif, ...notificationsCache];
    saveNotificationsStore();
    // 2. Push directly to Google Sheet tab "Notifications" via Google Apps Script Web App
    try {
        const roomStr = item.target === 'ALL'
            ? 'Tất cả'
            : item.target === 'LVC'
                ? 'LVC'
                : item.target === 'TRUNG_KIM'
                    ? 'Trung Kim'
                    : (Array.isArray(item.customRooms) && item.customRooms.length > 0 ? item.customRooms.join(', ') : 'Tùy chọn');
        const typeStr = item.type === 'alert'
            ? 'Nhắc nhở'
            : item.type === 'invoice'
                ? 'Thanh toán'
                : 'Thông báo';
        const fullContent = item.title ? `[${item.title}] ${item.desc}` : item.desc;
        const dateStr = item.time && item.time !== 'Vừa xong' ? item.time : new Date().toLocaleString('vi-VN');
        const qParams = new URLSearchParams({
            action: 'add_notification',
            date: dateStr,
            room: roomStr,
            type: typeStr,
            content: fullContent
        });
        fetch(`${GOOGLE_APPS_SCRIPT_WEBAPP_URL}?${qParams.toString()}`).catch((e) => {
            console.warn('[notificationStore] Apps Script fetch error:', e);
        });
        // Also try POST
        fetch(GOOGLE_APPS_SCRIPT_WEBAPP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'add_notification',
                date: dateStr,
                room: roomStr,
                type: typeStr,
                content: fullContent
            })
        }).catch(() => { });
    }
    catch (e) {
        console.warn('[notificationStore] Error pushing notification to Google Sheet:', e);
    }
    return notif;
}
/**
 * Filter notifications strictly for resident's room based on Google Sheet
 * "chỉ lại phòng đó mới được đọc cái phòng tin nhắn cái phòng đó thôi, dựa vào Google Sheet"
 */
export async function getNotificationsForResident(roomNumber, building) {
    // Fetch live notifications directly from Google Sheet tab Notifications
    const sheetNotifs = await fetchNotificationsFromGoogleSheet();
    const localList = loadNotificationsStore();
    // Merge unique items by content/desc
    const combined = [...sheetNotifs];
    for (const loc of localList) {
        const isDup = combined.some(s => s.desc === loc.desc || (s.title === loc.title && s.desc === loc.desc));
        if (!isDup)
            combined.push(loc);
    }
    const now = Date.now();
    const room = (roomNumber || '').trim().toUpperCase();
    const bld = (building || '').trim().toUpperCase();
    // If no room specified (admin or public without room), return all
    if (!room) {
        return combined;
    }
    // Filter so ONLY matching rooms can read their notifications
    return combined.filter(item => {
        // If scheduled, only show if scheduled time has arrived
        if (item.scheduledAt) {
            const schedTime = new Date(item.scheduledAt).getTime();
            if (!isNaN(schedTime) && schedTime > now) {
                return false;
            }
        }
        // 1. ALL residents can read broadcast notifications
        if (item.target === 'ALL') {
            return true;
        }
        // 2. LVC house
        if (item.target === 'LVC') {
            return room.includes('LVC') || bld.includes('LÊ VĂN CHÍ') || bld.includes('LVC');
        }
        // 3. Trung Kim house
        if (item.target === 'TRUNG_KIM') {
            return bld.includes('TRUNG KIM') || (!room.includes('LVC') && !bld.includes('LVC') && !bld.includes('LÊ VĂN CHÍ'));
        }
        // 4. Custom specific rooms: ONLY rooms in the list can read it!
        if (item.target === 'CUSTOM') {
            if (!Array.isArray(item.customRooms) || item.customRooms.length === 0) {
                return false;
            }
            return item.customRooms.some(r => {
                return matchRoom(r, room) || normalizeRoom(r) === normalizeRoom(room);
            });
        }
        return false;
    });
}
// Initialize on module load
loadNotificationsStore();
//# sourceMappingURL=notificationStore.js.map