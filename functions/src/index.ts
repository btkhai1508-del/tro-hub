import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import * as admin from "firebase-admin";

import {
  authenticateUser,
  fetchFreshTenantDataFromSheet,
  DEFAULT_SPREADSHEET_ID,
  normalizePhone,
  setInvoicePaidByWebhook
} from './googleSheetsBackendService.js';
import {
  getZaloProfile,
  getZaloPhoneNumber
} from './zaloService.js';
import {
  signTenantToken,
  verifyTenantToken,
  requireAuth,
  requireAdmin,
  AuthedRequest
} from './authToken.js';
import {
  getRoomColumnPStatus,
  setRoomColumnPStatus
} from './columnPStatusStore.js';
import {
  getLiveRoomPaymentStatus,
  fetchAllSheetColumnPStatuses
} from './googleSheetColorService.js';
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
} from './adminService.js';
import {
  addNotification,
  getNotificationsForResident,
  loadNotificationsStore
} from './notificationStore.js';

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestoreDb = admin.firestore();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// =========================================================================
// AUTHENTICATION ROUTES
// =========================================================================
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

    const zaloProfile = await getZaloProfile(accessToken);
    const rawPhone = await getZaloPhoneNumber(accessToken, phoneToken);
    const phone = normalizePhone(rawPhone);

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
// SEPAY WEBHOOK ENDPOINT (RECEIVES BANK TRANSFERS 24/7)
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
      id, gateway, accountNumber, transferAmount, content, transactionDate
    });

    if (transferType && transferType !== 'in') {
      return res.json({ success: true, message: 'Ignored non-incoming transfer' });
    }

    const searchString = `${content} ${description}`.toUpperCase();
    let matchedRoom = '';

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

      // Update Firestore directly
      try {
        await firestoreDb.collection('rooms').doc(matchedRoom).set({
          paymentStatus: 'paid',
          status: 'paid',
          statusText: 'Đã đóng',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (fsErr) {
        console.warn('[SePAY] Could not update Firestore room:', fsErr);
      }

      console.log(`[SePAY Webhook] Room ${matchedRoom} marked as PAID via ${txnRef}`);
    }

    return res.json({
      success: true,
      message: 'SePAY webhook processed successfully',
      matchedRoom: matchedRoom || null,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[SePAY Webhook Error]:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// PAYMENT API
// =========================================================================
app.post('/api/payment/mark-paid', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { method = 'qr', amount, month = '10/2026', transactionId } = req.body || {};
    const roomNumber = req.tenant!.room || (req.body || {}).roomNumber;
    if (!roomNumber) return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });

    const txn = transactionId || `TXN-${Date.now()}`;
    setInvoicePaidByWebhook(roomNumber, txn, amount, 'qr');

    try {
      await firestoreDb.collection('rooms').doc(roomNumber).set({
        paymentStatus: 'paid',
        status: 'paid',
        statusText: 'Đã đóng',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}

    const status = getRoomColumnPStatus(roomNumber);
    return res.json({
      success: true,
      roomNumber,
      status,
      message: `Đã cập nhật trạng thái đã đóng cho phòng ${roomNumber}`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/payment/mark-unpaid', async (req, res) => {
  try {
    const { roomNumber } = req.body || {};
    if (!roomNumber) return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });

    const status = setRoomColumnPStatus(roomNumber, 'RED');
    try {
      await firestoreDb.collection('rooms').doc(roomNumber).set({
        paymentStatus: 'unpaid',
        status: 'unpaid',
        statusText: 'Chưa đóng',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}

    return res.json({
      success: true,
      roomNumber,
      status,
      message: `Đã đặt trạng thái chưa thanh toán cho phòng ${roomNumber}`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

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
    if (!room) return res.status(400).json({ success: false, error: 'Thiếu mã phòng' });

    const liveStatus = await getLiveRoomPaymentStatus(sheetId, room, month);
    return res.json(liveStatus);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/payment/all-statuses', async (req, res) => {
  try {
    const sheetId = (req.query.sheetId as string) || DEFAULT_SPREADSHEET_ID;
    const month = (req.query.month as string) || '';
    const data = await fetchAllSheetColumnPStatuses(sheetId, month);
    res.json({ success: true, ...data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// ADMIN PORTAL API
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
    const { roomNumber, status } = req.body || {};
    setRoomColumnPStatus(roomNumber, status === 'paid' ? 'GREEN' : 'RED');

    try {
      await firestoreDb.collection('rooms').doc(roomNumber).set({
        paymentStatus: status,
        status,
        statusText: status === 'paid' ? 'Đã đóng' : 'Chưa đóng',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}

    res.json({ success: true, roomNumber, status });
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
// NOTIFICATION SYSTEM
// =========================================================================
app.post('/api/admin/notifications', (req, res) => {
  try {
    const { title, desc, type, target, customRooms, scheduledAt, time, sender, id } = req.body || {};
    if (!title || !desc) {
      return res.status(400).json({ success: false, error: 'Thiếu tiêu đề hoặc nội dung thông báo' });
    }
    const newNotif = addNotification({
      id: id || `notif_${Date.now()}`,
      title: title.trim(),
      desc: desc.trim(),
      time: time || 'Vừa xong',
      type: type || 'general',
      target: target || 'ALL',
      customRooms: Array.isArray(customRooms) ? customRooms : [],
      scheduledAt: scheduledAt || null,
      sender: sender || 'Ban Quản Lý EcoStay'
    });
    res.json({ success: true, notification: newNotif });
  } catch (e: any) {
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

app.get('/api/notifications', (req, res) => {
  try {
    const room = (req.query.room as string) || '';
    const building = (req.query.building as string) || '';
    const list = getNotificationsForResident(room, building);
    res.json({ success: true, notifications: list });
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
    let count = 0;

    for (const item of billing) {
      if (!item.room) continue;
      const cleanRoomId = item.room.replace(/[^a-zA-Z0-9]/g, '_');
      await firestoreDb.collection('rooms').doc(cleanRoomId).set({
        ...item,
        month,
        updatedAt: new Date().toISOString(),
        statusText: item.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng'
      }, { merge: true });
      count++;
    }

    return res.json({ success: true, count, month });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'tro-hub-cloud-functions', timestamp: new Date().toISOString() });
});

// Export Cloud Function (2nd Gen, with cors enabled)
export const api = onRequest({ cors: true, memory: "512MiB", timeoutSeconds: 60 }, app);
