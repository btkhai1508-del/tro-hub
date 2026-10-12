import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, 'notificationsStore.json');
let notificationsCache = [];
export function loadNotificationsStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const data = fs.readFileSync(STORE_PATH, 'utf-8');
            notificationsCache = JSON.parse(data);
        }
        else {
            // Default initial notifications if file doesn't exist
            notificationsCache = [
                {
                    id: 'notif-welcome-sys',
                    title: 'Chào mừng bạn đến với Trọ-Hub (EcoStay)',
                    desc: 'Ứng dụng quản lý phòng trọ số hóa: theo dõi hợp đồng, tra cứu hóa đơn minh bạch và thanh toán tự động qua VietQR.',
                    time: 'Hôm nay',
                    createdAt: new Date().toISOString(),
                    type: 'success',
                    target: 'ALL',
                    sender: 'Ban Quản Lý EcoStay'
                }
            ];
            saveNotificationsStore();
        }
    }
    catch (err) {
        console.warn('[notificationStore] Error reading store file:', err);
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
export function addNotification(item) {
    const notif = {
        ...item,
        createdAt: item.createdAt || new Date().toISOString()
    };
    notificationsCache = [notif, ...notificationsCache];
    saveNotificationsStore();
    return notif;
}
export function getNotificationsForResident(roomNumber, building) {
    loadNotificationsStore();
    const now = Date.now();
    const room = (roomNumber || '').trim().toUpperCase();
    const bld = (building || '').trim().toUpperCase();
    return notificationsCache.filter(item => {
        // If scheduled, only show if scheduled time has arrived
        if (item.scheduledAt) {
            const schedTime = new Date(item.scheduledAt).getTime();
            if (!isNaN(schedTime) && schedTime > now) {
                return false;
            }
        }
        // Target matching
        if (item.target === 'ALL') {
            return true;
        }
        if (item.target === 'LVC') {
            return room.includes('LVC') || bld.includes('LÊ VĂN CHÍ') || bld.includes('LVC');
        }
        if (item.target === 'TRUNG_KIM') {
            return bld.includes('TRUNG KIM') || (!room.includes('LVC') && !bld.includes('LVC') && !bld.includes('LÊ VĂN CHÍ'));
        }
        if (item.target === 'CUSTOM') {
            if (!Array.isArray(item.customRooms) || item.customRooms.length === 0)
                return true;
            return item.customRooms.some(r => {
                const cleanR = r.trim().toUpperCase();
                return cleanR === room || room.includes(cleanR) || cleanR.includes(room);
            });
        }
        return true;
    });
}
// Initialize on module load
loadNotificationsStore();
//# sourceMappingURL=notificationStore.js.map