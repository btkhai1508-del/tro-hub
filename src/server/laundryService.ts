import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addNotification } from './notificationStore.js';
import { fetchSheetDataViaGviz, DEFAULT_SPREADSHEET_ID } from './googleSheetsBackendService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, 'laundryStore.json');

export const GOOGLE_APPS_SCRIPT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzQXCBcLJIE969ciS6YFlgZ37vkb-ec3w81Yr9uXXuWZAifVBa_2ewoeQUtk6rsYv62/exec";

export type MachineType = 'WASHER' | 'DRYER';
export type MachineStatus = 'AVAILABLE' | 'RUNNING' | 'MAINTENANCE';
export type PlugState = 'ON' | 'OFF';

export interface LaundryMachine {
  machineId: string;
  name: string;
  type: MachineType;
  status: MachineStatus;
  price: number;
  cycleMinutes: number;
  expectedEndTime: string;
  currentSessionId?: string;
  plugState: PlugState;
  plugOnUrl?: string;
  plugOffUrl?: string;
  remainingSeconds?: number;
}

export interface LaundrySession {
  sessionId: string;
  machineId: string;
  roomNumber?: string;
  tenantPhone?: string;
  tenantName?: string;
  startTime: string;
  expectedEndTime: string;
  actualEndTime?: string;
  amount: number;
  transactionId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

export interface LaundryBooking {
  bookingId: string;
  machineId: string;
  roomNumber: string;
  tenantName: string;
  tenantPhone: string;
  bookingTime: string;
  bookingDate: string;
  depositAmount: number;
  depositStatus: 'PENDING' | 'PAID';
  transactionId?: string;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
}

export interface LaundryTransaction {
  id: string;
  machineId: string;
  amount: number;
  content: string;
  referenceCode: string;
  gateway?: string;
  accountNumber?: string;
  transactionDate?: string;
  timestamp: string;
  type: 'DIRECT_PAYMENT' | 'BOOKING_DEPOSIT';
}

interface LaundryStoreData {
  machines: LaundryMachine[];
  sessions: LaundrySession[];
  bookings: LaundryBooking[];
  transactions: LaundryTransaction[];
}

let storeData: LaundryStoreData = {
  machines: [
    { machineId: 'MG01', name: 'Máy Giặt 01 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MG02', name: 'Máy Giặt 02 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MG03', name: 'Máy Giặt 03 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MG04', name: 'Máy Giặt 04 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MS01', name: 'Máy Sấy 01 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MS02', name: 'Máy Sấy 02 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MS03', name: 'Máy Sấy 03 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
    { machineId: 'MS04', name: 'Máy Sấy 04 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', currentSessionId: '', plugState: 'OFF', plugOnUrl: '', plugOffUrl: '' },
  ],
  sessions: [],
  bookings: [],
  transactions: []
};

function loadStore(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.machines)) {
        storeData = parsed;
      }
    } else {
      saveStore();
    }
  } catch (err) {
    console.warn('[LaundryService] Error reading store, using defaults:', err);
  }
}

function saveStore(): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeData, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[LaundryService] Error saving store:', err);
  }
}

// Initial load
loadStore();

async function triggerSmartPlug(url: string | undefined, powerState: 'ON' | 'OFF', machineId: string): Promise<boolean> {
  if (!url || !url.startsWith('http')) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ power: powerState, machineId, timestamp: new Date().toISOString() }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return resp.ok;
  } catch (err) {
    console.warn(`[LaundryService] Smart plug webhook failed for ${machineId} (${powerState}):`, err);
    return false;
  }
}

function pushToGoogleSheetAsync(params: Record<string, string | number>): void {
  try {
    const qParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => qParams.append(k, String(v)));
    fetch(`${GOOGLE_APPS_SCRIPT_WEBAPP_URL}?${qParams.toString()}`)
      .then(r => r.json())
      .then(d => console.log('[LaundryService] Google Sheet sync response:', d))
      .catch(e => console.warn('[LaundryService] Google Sheet sync network error:', e));
  } catch (e) {
    console.warn('[LaundryService] Google Sheet sync invocation error:', e);
  }
}

export const LaundryService = {
  getAllMachines(): LaundryMachine[] {
    const now = Date.now();
    return storeData.machines.map(m => {
      let remainingSeconds = 0;
      if (m.status === 'RUNNING' && m.expectedEndTime) {
        const endMs = new Date(m.expectedEndTime).getTime();
        remainingSeconds = Math.max(0, Math.floor((endMs - now) / 1000));
      }
      return {
        ...m,
        remainingSeconds
      };
    });
  },

  getMachine(machineId: string): LaundryMachine | null {
    const m = storeData.machines.find(x => x.machineId.toUpperCase() === machineId.toUpperCase());
    if (!m) return null;
    let remainingSeconds = 0;
    if (m.status === 'RUNNING' && m.expectedEndTime) {
      const endMs = new Date(m.expectedEndTime).getTime();
      remainingSeconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
    }
    return { ...m, remainingSeconds };
  },

  async processDirectPayment(params: {
    machineId: string;
    amount: number;
    content: string;
    referenceCode: string;
    gateway?: string;
    accountNumber?: string;
    transactionDate?: string;
    roomNumber?: string;
    tenantName?: string;
    tenantPhone?: string;
  }) {
    const { machineId, amount, content, referenceCode, gateway, accountNumber, transactionDate, roomNumber, tenantName, tenantPhone } = params;
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);

    if (!machine) {
      return { success: false, message: `Không tìm thấy máy ${cleanId} trong hệ thống` };
    }

    if (amount < machine.price) {
      return { success: false, message: `Số tiền chuyển (${amount.toLocaleString('vi-VN')}₫) thấp hơn giá chu kỳ (${machine.price.toLocaleString('vi-VN')}₫)` };
    }

    const sessionId = `SES_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    const now = new Date();
    const cycleMin = machine.cycleMinutes || 45;
    const expectedEnd = new Date(now.getTime() + cycleMin * 60000);

    // Turn ON smart plug
    machine.plugState = 'ON';
    if (machine.plugOnUrl) {
      triggerSmartPlug(machine.plugOnUrl, 'ON', machine.machineId);
    }

    // Update machine status
    machine.status = 'RUNNING';
    machine.expectedEndTime = expectedEnd.toISOString();
    machine.currentSessionId = sessionId;

    // Create session
    const session: LaundrySession = {
      sessionId,
      machineId: machine.machineId,
      roomNumber,
      tenantPhone,
      tenantName,
      startTime: now.toISOString(),
      expectedEndTime: expectedEnd.toISOString(),
      amount,
      transactionId: referenceCode,
      status: 'IN_PROGRESS'
    };
    storeData.sessions.unshift(session);

    // Save transaction
    storeData.transactions.unshift({
      id: referenceCode,
      machineId: machine.machineId,
      amount,
      content,
      referenceCode,
      gateway,
      accountNumber,
      transactionDate,
      timestamp: now.toISOString(),
      type: 'DIRECT_PAYMENT'
    });

    saveStore();

    // Notify resident/app
    addNotification({
      id: `notif-laundry-start-${Date.now()}`,
      title: `⚡ Máy ${machine.name} (${machine.machineId}) đã được kích hoạt!`,
      desc: `Thời gian chạy: ${cycleMin} phút. Dự kiến hoàn tất lúc ${expectedEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`,
      time: 'Vừa xong',
      type: 'success',
      target: 'ALL',
      sender: 'LaundryFlow 24/7'
    });

    // Background sync to Google Sheets
    pushToGoogleSheetAsync({
      action: 'laundry_add_session',
      sessionId,
      machineId: machine.machineId,
      room: roomNumber || '',
      name: tenantName || '',
      phone: tenantPhone || '',
      startTime: now.toLocaleString('vi-VN'),
      expectedEndTime: expectedEnd.toLocaleString('vi-VN'),
      amount,
      transactionId: referenceCode,
      status: 'IN_PROGRESS'
    });

    pushToGoogleSheetAsync({
      action: 'laundry_sync_machine',
      machineId: machine.machineId,
      name: machine.name,
      type: machine.type,
      status: 'RUNNING',
      price: machine.price,
      cycleMinutes: machine.cycleMinutes,
      expectedEndTime: expectedEnd.toISOString(),
      plugState: 'ON'
    });

    return {
      success: true,
      message: `Đã kích hoạt máy ${machine.name} thành công (${cycleMin} phút)!`,
      sessionId,
      expectedEndTime: expectedEnd.toISOString()
    };
  },

  async confirmBookingDeposit(params: {
    machineId: string;
    amount: number;
    content: string;
    referenceCode: string;
    gateway?: string;
    accountNumber?: string;
    transactionDate?: string;
  }) {
    const { machineId, amount, content, referenceCode, gateway, accountNumber, transactionDate } = params;
    const cleanId = machineId.trim().toUpperCase();

    // Look for pending booking matching this machine
    const matchedBooking = storeData.bookings.find(b => 
      b.machineId.toUpperCase() === cleanId && (b.status === 'ACTIVE' || b.depositStatus === 'PENDING')
    );

    const now = new Date();

    if (matchedBooking) {
      matchedBooking.depositStatus = 'PAID';
      matchedBooking.status = 'ACTIVE';
      matchedBooking.transactionId = referenceCode;
    } else {
      // Create new booking record
      storeData.bookings.unshift({
        bookingId: `BK_${Date.now()}`,
        machineId: cleanId,
        roomNumber: 'Khách',
        tenantName: 'Khách hàng',
        tenantPhone: '',
        bookingTime: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        bookingDate: now.toLocaleDateString('vi-VN'),
        depositAmount: amount,
        depositStatus: 'PAID',
        transactionId: referenceCode,
        status: 'ACTIVE',
        createdAt: now.toISOString()
      });
    }

    storeData.transactions.unshift({
      id: referenceCode,
      machineId: cleanId,
      amount,
      content,
      referenceCode,
      gateway,
      accountNumber,
      transactionDate,
      timestamp: now.toISOString(),
      type: 'BOOKING_DEPOSIT'
    });

    saveStore();

    addNotification({
      id: `notif-booking-confirmed-${Date.now()}`,
      title: `📅 Xác nhận đặt cọc giữ chỗ máy ${cleanId} thành công!`,
      desc: `Số tiền cọc: ${amount.toLocaleString('vi-VN')}₫ qua GD ${referenceCode}.`,
      time: 'Vừa xong',
      type: 'success',
      target: 'ALL',
      sender: 'LaundryFlow 24/7'
    });

    // Sync booking deposit confirmation to Google Sheet tab Laundry_Bookings
    pushToGoogleSheetAsync({
      action: 'laundry_confirm_deposit',
      bookingId: matchedBooking ? matchedBooking.bookingId : '',
      machineId: cleanId,
      transactionId: referenceCode,
      depositAmount: amount,
      depositStatus: 'PAID'
    });

    return {
      success: true,
      message: `Đã xác nhận đặt cọc giữ chỗ máy ${cleanId} (${amount.toLocaleString('vi-VN')}₫)!`,
      booking: matchedBooking || storeData.bookings[0]
    };
  },

  createBooking(params: {
    machineId: string;
    roomNumber: string;
    tenantName: string;
    tenantPhone: string;
    bookingTime: string;
    bookingDate?: string;
  }) {
    const { machineId, roomNumber, tenantName, tenantPhone, bookingTime, bookingDate } = params;
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);

    if (!machine) {
      return { success: false, message: `Máy ${cleanId} không tồn tại` };
    }

    const booking: LaundryBooking = {
      bookingId: `BK_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`,
      machineId: cleanId,
      roomNumber: roomNumber || 'N/A',
      tenantName: tenantName || 'Cư dân',
      tenantPhone: tenantPhone || '',
      bookingTime,
      bookingDate: bookingDate || new Date().toLocaleDateString('vi-VN'),
      depositAmount: 5000,
      depositStatus: 'PENDING',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };

    storeData.bookings.unshift(booking);
    saveStore();

    // Sync new booking to Google Sheet tab Laundry_Bookings
    pushToGoogleSheetAsync({
      action: 'laundry_add_booking',
      bookingId: booking.bookingId,
      machineId: booking.machineId,
      room: booking.roomNumber,
      name: booking.tenantName,
      phone: booking.tenantPhone,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      depositAmount: booking.depositAmount,
      depositStatus: booking.depositStatus,
      transactionId: '',
      status: booking.status,
      createdAt: booking.createdAt
    });

    return {
      success: true,
      message: `Đã tạo yêu cầu giữ chỗ máy ${cleanId} lúc ${bookingTime}. Vui lòng chuyển cọc 5.000đ để hoàn tất!`,
      booking
    };
  },

  getBookings(): LaundryBooking[] {
    return storeData.bookings.slice(0, 50);
  },

  manualForceStart(machineId: string, cycleMinutes?: number) {
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);
    if (!machine) return { success: false, message: `Máy ${cleanId} không tồn tại` };

    const cycle = cycleMinutes || machine.cycleMinutes || 45;
    const now = new Date();
    const expectedEnd = new Date(now.getTime() + cycle * 60000);
    const sessionId = `MANUAL_${Date.now()}`;

    machine.status = 'RUNNING';
    machine.plugState = 'ON';
    machine.expectedEndTime = expectedEnd.toISOString();
    machine.currentSessionId = sessionId;

    if (machine.plugOnUrl) {
      triggerSmartPlug(machine.plugOnUrl, 'ON', machine.machineId);
    }

    storeData.sessions.unshift({
      sessionId,
      machineId: machine.machineId,
      startTime: now.toISOString(),
      expectedEndTime: expectedEnd.toISOString(),
      amount: machine.price,
      transactionId: `ADMIN-MANUAL-${Date.now()}`,
      status: 'IN_PROGRESS'
    });

    saveStore();

    pushToGoogleSheetAsync({
      action: 'laundry_sync_machine',
      machineId: machine.machineId,
      name: machine.name,
      type: machine.type,
      status: 'RUNNING',
      price: machine.price,
      cycleMinutes: cycle,
      expectedEndTime: expectedEnd.toISOString(),
      plugState: 'ON'
    });

    return {
      success: true,
      message: `Quản trị viên đã kích hoạt cưỡng bức máy ${machine.name} (${cycle} phút)!`,
      expectedEndTime: expectedEnd.toISOString()
    };
  },

  manualReset(machineId: string) {
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);
    if (!machine) return { success: false, message: `Máy ${cleanId} không tồn tại` };

    machine.status = 'AVAILABLE';
    machine.plugState = 'OFF';
    machine.expectedEndTime = '';
    machine.currentSessionId = '';

    if (machine.plugOffUrl) {
      triggerSmartPlug(machine.plugOffUrl, 'OFF', machine.machineId);
    }

    saveStore();

    pushToGoogleSheetAsync({
      action: 'laundry_sync_machine',
      machineId: machine.machineId,
      name: machine.name,
      type: machine.type,
      status: 'AVAILABLE',
      price: machine.price,
      cycleMinutes: machine.cycleMinutes,
      expectedEndTime: '',
      plugState: 'OFF'
    });

    return {
      success: true,
      message: `Đã reset máy ${cleanId} về trạng thái SẴN SÀNG và tắt nguồn ổ điện!`
    };
  },

  togglePlug(machineId: string) {
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);
    if (!machine) return { success: false, message: `Máy ${cleanId} không tồn tại` };

    const nextState: PlugState = machine.plugState === 'ON' ? 'OFF' : 'ON';
    machine.plugState = nextState;

    const url = nextState === 'ON' ? machine.plugOnUrl : machine.plugOffUrl;
    if (url) {
      triggerSmartPlug(url, nextState, machine.machineId);
    }

    saveStore();

    return {
      success: true,
      plugState: nextState,
      message: `Đã chuyển ổ điện máy ${cleanId} sang ${nextState}`
    };
  },

  updateConfig(machineId: string, updates: Partial<LaundryMachine>) {
    const cleanId = machineId.trim().toUpperCase();
    const machine = storeData.machines.find(m => m.machineId.toUpperCase() === cleanId);
    if (!machine) return { success: false, message: `Máy ${cleanId} không tồn tại` };

    if (updates.name !== undefined) machine.name = updates.name;
    if (updates.price !== undefined) machine.price = Number(updates.price);
    if (updates.cycleMinutes !== undefined) machine.cycleMinutes = Number(updates.cycleMinutes);
    if (updates.plugOnUrl !== undefined) machine.plugOnUrl = updates.plugOnUrl;
    if (updates.plugOffUrl !== undefined) machine.plugOffUrl = updates.plugOffUrl;

    saveStore();
    return { success: true, message: `Đã cập nhật cấu hình máy ${cleanId}`, machine };
  },

  getStats() {
    const todayStr = new Date().toLocaleDateString('vi-VN');
    let todayRevenue = 0;
    let totalRevenue = 0;
    let todaySessions = 0;
    const totalSessions = storeData.sessions.length;

    storeData.transactions.forEach(t => {
      totalRevenue += (t.amount || 0);
      const tDate = new Date(t.timestamp).toLocaleDateString('vi-VN');
      if (tDate === todayStr) {
        todayRevenue += (t.amount || 0);
      }
    });

    storeData.sessions.forEach(s => {
      const sDate = new Date(s.startTime).toLocaleDateString('vi-VN');
      if (sDate === todayStr) {
        todaySessions += 1;
      }
    });

    return {
      todayRevenue,
      totalRevenue,
      todaySessions,
      totalSessions,
      activeBookings: storeData.bookings.filter(b => b.status === 'ACTIVE').length
    };
  },

  /**
   * Sync machine list and prices directly from Google Sheet tab "Machines"
   */
  async syncFromGoogleSheet(sheetId: string = DEFAULT_SPREADSHEET_ID) {
    try {
      console.log(`[LaundryService] 🔄 Đang quét cấu hình máy từ Google Sheet (${sheetId})...`);
      const rows = await fetchSheetDataViaGviz(sheetId, 'Machines');
      if (!rows || rows.length <= 1) {
        return { success: false, updatedCount: 0, message: 'Tab "Machines" chưa có dữ liệu trên Google Sheet' };
      }

      let updatedCount = 0;
      // Row 0 is header: machine_id, name, type, status, price, cycle_minutes, expected_end_time, plug_state
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const mId = String(row[0] || '').trim().toUpperCase();
        if (!mId) continue;

        const mName = String(row[1] || '').trim();
        const rawType = String(row[2] || '').trim().toUpperCase();
        const mType: MachineType = (rawType.includes('DRYER') || rawType.includes('SẤY')) ? 'DRYER' : 'WASHER';
        const mPrice = Number(String(row[4] || '').replace(/[^0-9]/g, ''));
        const mCycle = Number(String(row[5] || '').replace(/[^0-9]/g, ''));

        const existing = storeData.machines.find(m => m.machineId.toUpperCase() === mId);
        if (existing) {
          if (mName) existing.name = mName;
          existing.type = mType;
          if (!isNaN(mPrice) && mPrice > 0) existing.price = mPrice;
          if (!isNaN(mCycle) && mCycle > 0) existing.cycleMinutes = mCycle;
          updatedCount++;
        } else {
          storeData.machines.push({
            machineId: mId,
            name: mName || `Máy ${mId}`,
            type: mType,
            status: 'AVAILABLE',
            price: !isNaN(mPrice) && mPrice > 0 ? mPrice : 15000,
            cycleMinutes: !isNaN(mCycle) && mCycle > 0 ? mCycle : 45,
            expectedEndTime: '',
            plugState: 'OFF',
            plugOnUrl: '',
            plugOffUrl: ''
          });
          updatedCount++;
        }
      }

      saveStore();
      console.log(`[LaundryService] ✅ Đã đồng bộ thành công ${updatedCount} máy từ Google Sheet tab Machines.`);
      return { success: true, updatedCount, message: `Đã đồng bộ ${updatedCount} máy từ Google Sheet` };
    } catch (err: any) {
      console.warn(`[LaundryService] ⚠️ Không thể quét tab Machines từ Google Sheet:`, err.message);
      return { success: false, updatedCount: 0, message: err.message };
    }
  }
};

/**
 * Background Worker: Checks RUNNING machines every 3s
 * Automatically turns off smart plug and resets status when expectedEndTime is reached
 */
export function startLaundryWorker(): NodeJS.Timeout {
  console.log('[LaundryService] 🚀 Background worker started (3s ticker)');

  // Initial sync from Google Sheet Machines tab if available
  LaundryService.syncFromGoogleSheet().catch(() => {});

  return setInterval(() => {
    try {
      const now = Date.now();
      let changed = false;

      for (const machine of storeData.machines) {
        if (machine.status === 'RUNNING' && machine.expectedEndTime) {
          const endMs = new Date(machine.expectedEndTime).getTime();
          if (now >= endMs) {
            console.log(`[LaundryService] ⏰ Máy ${machine.machineId} (${machine.name}) đã hoàn thành chu kỳ! Tự động tắt ổ điện.`);
            
            machine.status = 'AVAILABLE';
            machine.plugState = 'OFF';
            machine.expectedEndTime = '';

            // Turn off plug
            if (machine.plugOffUrl) {
              triggerSmartPlug(machine.plugOffUrl, 'OFF', machine.machineId);
            }

            // Complete session
            if (machine.currentSessionId) {
              const sess = storeData.sessions.find(s => s.sessionId === machine.currentSessionId);
              if (sess) {
                sess.status = 'COMPLETED';
                sess.actualEndTime = new Date().toISOString();
              }
              machine.currentSessionId = '';
            }

            // Add notification to resident portal
            addNotification({
              id: `notif-laundry-done-${Date.now()}`,
              title: `✅ Chu kỳ ${machine.type === 'DRYER' ? 'sấy' : 'giặt'} tại ${machine.machineId} đã xong!`,
              desc: `${machine.name} đã hoàn tất. Quý cư dân vui lòng lấy quần áo ra khỏi máy để nhường chỗ cho người tiếp theo.`,
              time: 'Vừa xong',
              type: 'info',
              target: 'ALL',
              sender: 'LaundryFlow 24/7'
            });

            // Google Sheets sync
            pushToGoogleSheetAsync({
              action: 'laundry_sync_machine',
              machineId: machine.machineId,
              name: machine.name,
              type: machine.type,
              status: 'AVAILABLE',
              price: machine.price,
              cycleMinutes: machine.cycleMinutes,
              expectedEndTime: '',
              plugState: 'OFF'
            });

            changed = true;
          }
        }
      }

      if (changed) {
        saveStore();
      }
    } catch (err) {
      console.warn('[LaundryService] Worker tick error:', err);
    }
  }, 3000);
}
