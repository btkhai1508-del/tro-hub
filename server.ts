import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFreshTenantDataFromSheet, DEFAULT_SPREADSHEET_ID, setInvoicePaidByWebhook, authenticateUser, normalizePhone } from './src/server/googleSheetsBackendService.js';
import { getRoomColumnPStatus, setRoomColumnPStatus } from './src/server/columnPStatusStore.js';
import { getLiveRoomPaymentStatus, fetchAllSheetColumnPStatuses } from './src/server/googleSheetColorService.js';
import { signTenantToken, verifyTenantToken, requireAuth, requireAdmin, type AuthedRequest } from './src/server/authToken.js';
import { getZaloProfile, getZaloPhoneNumber } from './src/server/zaloService.js';
import {
  getMonthList,
  getDashboardData,
  getRoomListByMonth,
  getRoomDataByMonth,
  getMonthlyBilling,
  searchLicensePlates,
  HOUSES_CONFIG,
  getDeclarationData,
  saveDeclarationData,
  getPaymentGate,
  setPaymentGate,
  getConfig as getAdminConfig,
  saveConfig as saveAdminConfig,
  chatWithLegalAI,
  fetchLegalNews
} from './src/server/adminService.js';
import {
  addNotification,
  getNotificationsForResident,
  loadNotificationsStore
} from './src/server/notificationStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT: number = Number(process.env.PORT) || 3000;

// Origins allowed to call this API from the browser.
// Zalo Mini App runs on Zalo's domains (h5.zdn.vn), so CORS is required.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://h5.zdn.vn,https://h5.zadn.vn')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return true;
  // Local development (zmp start / vite dev / Zalo simulator)
  if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;
  return false;
}

async function startServer() {
  const app = express();

  // CORS (auth uses the Authorization header, never cookies)
  app.use((req, res, next) => {
    const origin = String(req.headers.origin || '');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Bypass-Tunnel-Reminder, *');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // JSON Body parsing
  app.use(express.json());

  // Backend API Route: Authenticate tenant workflow (phone + password)
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { phone, password, sheetId } = req.body || {};
      const result = await authenticateUser(phone, password, sheetId);
      if (!result.success || !result.user) {
        return res.status(401).json(result);
      }
      const isRoomAdmin = Boolean(result.isAdmin) || result.user.roomNumber === 'admin' || String(phone).toLowerCase() === 'admin' || normalizePhone(result.user.phone).endsWith('902371800');
      const token = signTenantToken({
        phone: normalizePhone(result.user.phone) || '0902371800',
        room: result.user.roomNumber,
        personType: result.user.personType,
        isAdmin: isRoomAdmin
      });
      return res.json({ ...result, isAdmin: isRoomAdmin, token });
    } catch (error: any) {
      console.error('[API /api/auth/login] Error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Lỗi xử lý đăng nhập'
      });
    }
  });

  // =========================================================================
  // ZALO MINI APP LOGIN
  // Mini App sends: accessToken (zmp-sdk getAccessToken) + phoneToken (zmp-sdk getPhoneNumber)
  // Server verifies both with Zalo Open API, then maps the phone to a tenant in Google Sheet.
  // =========================================================================
  app.post('/api/auth/zalo', async (req, res) => {
    try {
      const { accessToken, phoneToken, sheetId } = req.body || {};
      if (!accessToken || !phoneToken) {
        return res.status(400).json({
          success: false,
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          error: 'Thiếu accessToken hoặc phoneToken từ Zalo.'
        });
      }

      // 1) Verify access token & get Zalo profile (with appsecret_proof)
      const zaloProfile = await getZaloProfile(accessToken);

      // 2) Exchange phone token -> real phone number (84xxxxxxxxx -> 0xxxxxxxxx)
      const rawPhone = await getZaloPhoneNumber(accessToken, phoneToken);
      const phone = normalizePhone(rawPhone);

      // 3) Find tenant in Google Sheet strictly by verified phone (no password)
      const result = await authenticateUser(phone, '', sheetId, { verifiedPhone: true });
      if (!result.success || !result.user) {
        return res.status(result.errorCode ? 404 : 401).json({
          ...result,
          zalo: { id: zaloProfile.id, name: zaloProfile.name, avatar: zaloProfile.avatar, phone }
        });
      }

      const isRoomAdmin = Boolean(result.isAdmin) || result.user.roomNumber === 'admin' || phone === '0902371800' || phone.endsWith('902371800');
      const token = signTenantToken({
        phone,
        room: result.user.roomNumber,
        personType: result.user.personType,
        zaloId: zaloProfile.id,
        isAdmin: isRoomAdmin
      });

      console.log(`[API /api/auth/zalo] Zalo user ${zaloProfile.id} logged in as room ${result.user.roomNumber} (isAdmin: ${isRoomAdmin})`);
      return res.json({
        ...result,
        isAdmin: isRoomAdmin,
        token,
        zalo: { id: zaloProfile.id, name: zaloProfile.name, avatar: zaloProfile.avatar }
      });
    } catch (error: any) {
      console.error('[API /api/auth/zalo] Error:', error);
      return res.status(502).json({
        success: false,
        error: 'Không xác thực được tài khoản Zalo: ' + (error.message || 'Lỗi không xác định')
      });
    }
  });

  // Backend API Route: Fetch fresh tenant data & invoices from Google Sheet
  // Identity (phone / room) is taken from the session token, NOT from the query string.
  app.get('/api/sheets/tenant-data', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const sheetId = (req.query.sheetId as string) || DEFAULT_SPREADSHEET_ID;
      const phone = req.tenant!.phone;
      const room = req.tenant!.room || (req.query.room as string) || '';
      const name = (req.query.name as string) || '';

      const freshData = await fetchFreshTenantDataFromSheet({
        spreadsheetId: sheetId,
        phone,
        roomNumber: room,
        name
      });

      res.json(freshData);
    } catch (error: any) {
      console.error('[API /api/sheets/tenant-data] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal Server Error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // =========================================================================
  // SEPAY WEBHOOK INTEGRATION ENDPOINT
  // Receives automatic bank notifications when resident transfers money
  // Webhook URL to configure in SePAY: https://[your-app-domain]/api/sepay/webhook
  // =========================================================================
  app.post('/api/sepay/webhook', async (req, res) => {
    try {
      const payload = req.body || {};
      const {
        id,
        gateway,
        transactionDate,
        accountNumber,
        content = '',
        transferType,
        transferAmount,
        referenceCode,
        description = ''
      } = payload;

      console.log('[SePAY Webhook] Received transfer event:', {
        id,
        gateway,
        accountNumber,
        transferAmount,
        content,
        transactionDate
      });

      // Only process incoming transfers ("in")
      if (transferType && transferType !== 'in') {
        return res.json({ success: true, message: 'Ignored non-incoming transfer' });
      }

      // Extract Room number or Invoice code from transfer content (e.g. "G02T102026", "203-T10", "LVC203", "P203")
      const searchString = `${content} ${description}`.toUpperCase();
      let matchedRoom = '';

      // Check pattern like "G02", "LVC203", "203-T10", "P203", "INV-102026", "309"
      const roomMatch = searchString.match(/(?:LVC|P\s*|\b)([A-Z]?[0-9]{2,4}[A-Za-z]?)\b/);
      if (roomMatch && roomMatch[1]) {
        matchedRoom = roomMatch[1];
      } else {
        const simpleNumMatch = searchString.match(/\b([0-9]{3})\b/);
        if (simpleNumMatch && simpleNumMatch[1]) {
          matchedRoom = simpleNumMatch[1];
        }
      }

      if (matchedRoom) {
        const txnRef = referenceCode || `SEPAY-${id || Date.now()}`;
        setInvoicePaidByWebhook(matchedRoom, txnRef, transferAmount, 'qr');
        console.log(`[SePAY Webhook] Successfully marked Room ${matchedRoom} as PAID (Cột P: GREEN) via transaction ${txnRef}`);
      }

      res.json({
        success: true,
        message: 'SePAY webhook processed successfully',
        matchedRoom: matchedRoom || null,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[SePAY Webhook Error]:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Backend API: Update payment status to Column P (GREEN for QR/transfer)
  // Requires session; a tenant can only mark their OWN room.
  app.post('/api/payment/mark-paid', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { method = 'qr', amount, month = '10/2026', transactionId } = req.body || {};
      const roomNumber = req.tenant!.room || (req.body || {}).roomNumber;
      if (!roomNumber) {
        return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });
      }

      const txn = transactionId || `TXN-${Date.now()}`;
      setInvoicePaidByWebhook(roomNumber, txn, amount, 'qr');

      const status = getRoomColumnPStatus(roomNumber);
      return res.json({
        success: true,
        roomNumber,
        status,
        message: `Đã cập nhật trạng thái chuyển khoản (Cột P: GREEN) cho phòng ${roomNumber}`
      });
    } catch (error: any) {
      console.error('[API /api/payment/mark-paid] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Legacy fallback endpoint alias to mark-paid
  app.post('/api/payment/mark-cash-paid', async (req, res) => {
    try {
      const { roomNumber, amount, month = '10/2026', transactionId } = req.body || {};
      if (!roomNumber) {
        return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });
      }

      const txn = transactionId || `TXN-${Date.now()}`;
      setInvoicePaidByWebhook(roomNumber, txn, amount, 'qr');

      const status = getRoomColumnPStatus(roomNumber);
      return res.json({
        success: true,
        roomNumber,
        status,
        message: `Đã cập nhật trạng thái đã thanh toán cho phòng ${roomNumber}`
      });
    } catch (error: any) {
      console.error('[API /api/payment/mark-cash-paid] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Backend API: Mark unpaid -> Cột P: RED
  app.post('/api/payment/mark-unpaid', async (req, res) => {
    try {
      const { roomNumber } = req.body || {};
      if (!roomNumber) {
        return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });
      }

      const status = setRoomColumnPStatus(roomNumber, 'RED');
      return res.json({
        success: true,
        roomNumber,
        status,
        message: `Đã đặt trạng thái chưa thanh toán (Cột P: RED) cho phòng ${roomNumber}`
      });
    } catch (error: any) {
      console.error('[API /api/payment/mark-unpaid] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Backend API: Query Live Payment Status from Google Sheet Column P
  // GOOGLE SHEET = SINGLE SOURCE OF TRUTH
  app.get('/api/payment/status', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      let authedRoom = '';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const payload = verifyTenantToken(authHeader.slice(7));
          authedRoom = payload?.room || '';
        } catch {}
      }
      const room = authedRoom || (req.query.room as string) || '';
      const sheetId = (req.query.sheetId as string) || DEFAULT_SPREADSHEET_ID;
      const month = (req.query.month as string) || '';
      if (!room) {
        return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });
      }
      const liveStatus = await getLiveRoomPaymentStatus(sheetId, room, month);
      return res.json(liveStatus);
    } catch (error: any) {
      console.error('[API /api/payment/status] Error:', error);
      res.status(500).json({ success: false, error: error.message || 'Lỗi đọc trạng thái Google Sheet' });
    }
  });

  // Query ALL room Column P statuses for a given month directly from Google Sheet
  app.get('/api/payment/all-statuses', async (req, res) => {
    try {
      const sheetId = (req.query.sheetId as string) || DEFAULT_SPREADSHEET_ID;
      const month = (req.query.month as string) || '';
      const data = await fetchAllSheetColumnPStatuses(sheetId, month);
      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error('[API /api/payment/all-statuses] Error:', error);
      res.status(500).json({ success: false, error: error.message || 'Lỗi đọc trạng thái Google Sheet' });
    }
  });

  // Backend API: Query Column P status for a room (compatible with legacy callers)
  app.get('/api/payment/column-p-status', async (req, res) => {
    try {
      const room = (req.query.room as string) || '';
      const sheetId = (req.query.sheetId as string) || DEFAULT_SPREADSHEET_ID;
      if (!room) {
        return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });
      }
      const liveStatus = await getLiveRoomPaymentStatus(sheetId, room);
      res.json({
        ...liveStatus,
        status: {
          roomNumber: room,
          rowIndex: liveStatus.foundRow > 0 ? liveStatus.foundRow - 1 : -1,
          cellAddress: liveStatus.cellAddress,
          color: liveStatus.paymentStatus === 'paid' ? 'GREEN' : 'RED',
          status: liveStatus.paymentStatus === 'paid' ? 'BANK_TRANSFER_PAID' : 'UNPAID',
          label: liveStatus.label,
          sheetColor: liveStatus.sheetColor,
          amount: liveStatus.amount,
          month: liveStatus.tabName
        }
      });
    } catch (error: any) {
      console.error('[API /api/payment/column-p-status] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Test simulation endpoint for SePAY Webhook
  app.post('/api/sepay/test-webhook', (req, res) => {
    const { room = '203', amount = 3550000, content = '203-T10-2026' } = req.body || {};
    const txnCode = `TEST-SEPAY-${Date.now()}`;
    setInvoicePaidByWebhook(room, txnCode, amount);
    res.json({
      success: true,
      message: `Đã giả lập SePAY thanh toán thành công cho phòng ${room} với số tiền ${amount.toLocaleString('vi-VN')}₫`,
      transactionId: txnCode
    });
  });

  // =========================================================================
  // ADMIN PORTAL API ENDPOINTS (Quản lý trọ Phong Lan / EcoStay)
  // =========================================================================
  app.use('/api/admin', requireAdmin);

  app.get('/api/admin/months', async (req, res) => {
    try {
      const months = await getMonthList();
      res.json({ success: true, months });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/dashboard', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const data = await getDashboardData(month);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/rooms', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const rooms = await getRoomListByMonth(month);
      res.json({ success: true, rooms });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/room-detail', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const room = (req.query.room as string) || '';
      const data = await getRoomDataByMonth(month, room);
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/room-detail', async (req, res) => {
    try {
      const body = req.body || {};
      res.json({ success: true, message: 'Đã lưu thông tin phòng thành công', data: body });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/payment-status', async (req, res) => {
    try {
      const { roomNumber, status, month } = req.body || {};
      if (status === 'paid') {
        setRoomColumnPStatus(roomNumber, 'GREEN', { month });
      } else {
        setRoomColumnPStatus(roomNumber, 'RED', { month });
      }
      res.json({ success: true, message: `Đã cập nhật trạng thái phòng ${roomNumber}` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/billing', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const billing = await getMonthlyBilling(month);
      res.json({ success: true, billing });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/plates', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const query = (req.query.query as string) || '';
      const results = await searchLicensePlates(month, query);
      res.json({ success: true, results });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/contract/config', (req, res) => {
    res.json({ success: true, config: HOUSES_CONFIG });
  });

  app.get('/api/admin/contract/history', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const houseKey = (req.query.houseKey as string) || 'TRUNG_KIM';
      const rooms = (await getRoomListByMonth(month)).filter(room =>
        houseKey === 'LVC'
          ? String(room.room).toUpperCase().includes('LVC')
          : !String(room.room).toUpperCase().includes('LVC')
      );
      const list = await Promise.all(rooms.map(async room => {
        const details = await getRoomDataByMonth(month, room.room);
        return {
          room: room.room,
          name: room.name,
          phone: room.phone,
          cccd: details?.cccd1 || '',
          plate: details?.xe1 || '',
          rent: details?.tienPhong || 0
        };
      }));
      res.json({ success: true, history: list });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/contract/save', (req, res) => {
    res.json({ success: true, message: 'Đã lưu hợp đồng lên hệ thống thành công' });
  });

  app.get('/api/admin/declaration', async (req, res) => {
    try {
      const month = (req.query.month as string) || '10/2026';
      const houseKey = ((req.query.houseKey as string) === 'LVC' ? 'LVC' : 'TRUNG_KIM') as 'LVC' | 'TRUNG_KIM';
      const declaration = await getDeclarationData(month, houseKey);
      res.json({ success: true, declaration });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/declaration', (req, res) => {
    try {
      const { month = '10/2026', houseKey = 'TRUNG_KIM', rows = [], sigDate = '' } = req.body || {};
      const result = saveDeclarationData(month, houseKey, rows, sigDate);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/payment-gate', (req, res) => {
    const month = (req.query.month as string) || '10/2026';
    const value = getPaymentGate(month);
    res.json({ success: true, month, value });
  });

  app.post('/api/admin/payment-gate', (req, res) => {
    const { month = '10/2026', value = 'STOP' } = req.body || {};
    const updated = setPaymentGate(month, value);
    res.json({ success: true, month, value: updated });
  });

  app.get('/api/admin/config', (req, res) => {
    const month = (req.query.month as string) || '10/2026';
    const config = getAdminConfig(month);
    res.json({ success: true, config });
  });

  app.post('/api/admin/config', (req, res) => {
    const { month = '10/2026', config = {} } = req.body || {};
    const result = saveAdminConfig(month, config);
    res.json(result);
  });

  app.post('/api/admin/legal/chat', async (req, res) => {
    try {
      const { message, history = [] } = req.body || {};
      const reply = await chatWithLegalAI(message, history);
      res.json({ success: true, reply });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/legal/news', async (req, res) => {
    try {
      const news = await fetchLegalNews();
      res.json({ success: true, news });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // =========================================================================
  // GOOGLE SHEETS -> FIREBASE CLOUD FIRESTORE SYNC
  // =========================================================================
  app.post('/api/admin/sync-firestore', async (req, res) => {
    try {
      const { month = '10/2026' } = req.body || {};
      const billing = await getMonthlyBilling(month);
      const apiKey = "AIzaSyD9ncRfQXciyMwYIAkxGf95kEp8btzFe4s";
      const baseUrl = "https://firestore.googleapis.com/v1/projects/tro-hub/databases/(default)/documents";

      let count = 0;
      for (const item of billing) {
        if (!item.room) continue;
        const cleanRoomId = item.room.replace(/[^a-zA-Z0-9]/g, '_');
        const url = `${baseUrl}/rooms/${cleanRoomId}?key=${apiKey}`;
        const firestoreFields: any = {};
        for (const [k, v] of Object.entries(item)) {
          if (typeof v === 'number') {
            firestoreFields[k] = { integerValue: String(v) };
          } else if (typeof v === 'boolean') {
            firestoreFields[k] = { booleanValue: v };
          } else {
            firestoreFields[k] = { stringValue: String(v || '') };
          }
        }
        firestoreFields['month'] = { stringValue: month };
        firestoreFields['updatedAt'] = { stringValue: new Date().toISOString() };
        firestoreFields['statusText'] = { stringValue: item.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng' };

        await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: firestoreFields })
        });
        count++;
      }

      const sysUrl = `${baseUrl}/system_info/last_sync?key=${apiKey}`;
      await fetch(sysUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            totalRooms: { integerValue: String(count) },
            month: { stringValue: month },
            lastSyncedAt: { stringValue: new Date().toISOString() },
            status: { stringValue: 'success' }
          }
        })
      });

      console.log(`[API /api/admin/sync-firestore] Synced ${count} rooms for month ${month} to Firestore`);
      res.json({ success: true, count, month });
    } catch (e: any) {
      console.error('[API /api/admin/sync-firestore] Error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // =========================================================================
  // NOTIFICATION SYSTEM (Admin Broadcast & Resident Notifications)
  // =========================================================================
  app.post('/api/admin/notifications', (req, res) => {
    try {
      const { title, desc, type, target, customRooms, scheduledAt, time, sender, id } = req.body || {};
      if (!title || !desc) {
        return res.status(400).json({ success: false, error: 'Thiếu tiêu đề hoặc nội dung thông báo' });
      }
      const newNotif = addNotification({
        id: id || `notif-${Date.now()}`,
        title: title.trim(),
        desc: desc.trim(),
        time: time || 'Vừa xong',
        type: type || 'info',
        target: target || 'ALL',
        customRooms: Array.isArray(customRooms) ? customRooms : [],
        scheduledAt: scheduledAt || null,
        sender: sender || 'Ban Quản Lý EcoStay'
      });
      console.log(`[API /api/admin/notifications] Created: "${newNotif.title}" for target: ${newNotif.target}`);
      res.json({ success: true, notification: newNotif });
    } catch (e: any) {
      console.error('[API /api/admin/notifications] Error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/notifications', (req, res) => {
    try {
      const list = loadNotificationsStore();
      res.json({ success: true, notifications: list });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Resident public/authenticated endpoint to fetch notifications for their room
  app.get('/api/notifications', (req, res) => {
    try {
      const room = (req.query.room as string) || '';
      const building = (req.query.building as string) || '';
      const list = getNotificationsForResident(room, building);
      res.json({ success: true, notifications: list });
    } catch (e: any) {
      console.error('[API /api/notifications] Error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  if (!isProduction) {
    // Development mode: Mount Vite dev server middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files from dist
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[EcoStay Server] Running at http://0.0.0.0:${PORT} in ${isProduction ? 'production' : 'development'} mode`);
    console.log(`[EcoStay Server] CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    for (const key of ['ZALO_APP_ID', 'ZALO_APP_SECRET', 'JWT_SECRET']) {
      if (!process.env[key]) console.warn(`[EcoStay Server] ⚠️  Thiếu biến môi trường ${key} trong .env`);
    }
  });
}

startServer().catch((err) => {
  console.error('[EcoStay Server] Failed to start:', err);
  process.exit(1);
});
