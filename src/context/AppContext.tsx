import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchMonthlyInvoicesFromSheet } from '../lib/googleSheetsService';
import { getAccessToken } from '../lib/googleAuth';
import { authService, PersonType, AuthErrorCode } from '../services/authService';
import { storage, STORAGE_KEYS } from '../lib/storage';
import { apiFetch, UNAUTHORIZED_EVENT } from '../lib/api';
import { isZaloMiniApp } from '../lib/platform';
import { events, EventName, closeLoading } from 'zmp-sdk/apis';
import { getCurrentMonthStr } from '../lib/utils';

export interface InvoiceDetailItem {
  name: string;
  amount: number;
  note?: string;
  type: 'room' | 'electricity' | 'water' | 'internet' | 'service' | 'parking';
  metric?: string;
}

export interface Invoice {
  id: string;
  month: string;           // "10/2026"
  issueDate: string;       // "01/10/2026"
  dueDate: string;         // "05/10/2026"
  total: number;
  status: 'unpaid' | 'paid' | 'pending';
  paidAt?: string;
  paymentMethod?: 'qr' | 'cash';
  transactionId?: string;
  details: InvoiceDetailItem[];
}

/**
 * Format transfer syntax based on room identifier:
 * - If room has 'LVC' -> LVC{room}-T{month}-{year}
 * - If room does NOT have 'LVC' -> {room}-T{month}-{year}
 */
export function getTransferContent(roomNumber: string = '203', month: string = '10/2026'): string {
  const rawRoom = (roomNumber || '203').trim();
  const isLVC = rawRoom.toUpperCase().includes('LVC');
  const cleanRoom = rawRoom.replace(/[^0-9A-Za-z]/g, '');
  const monthParts = month.split('/');
  const m = monthParts[0] || '10';
  const y = monthParts[1] || '2026';

  return isLVC ? `LVC${cleanRoom}-T${m}-${y}` : `${cleanRoom}-T${m}-${y}`;
}

/**
 * Building name mapping:
 * - Room containing 'LVC' -> 'Lê Văn Chí'
 * - Any other room -> 'Trung Kim'
 */
export function getBuildingName(roomNumber?: string): string {
  if (!roomNumber) return 'Trung Kim';
  return roomNumber.toUpperCase().includes('LVC') ? 'Lê Văn Chí' : 'Trung Kim';
}

export interface NotificationItem {
  id: string;
  title: string;
  desc: string;
  time: string;
  type: 'invoice' | 'alert' | 'success' | 'info';
  unread: boolean;
  link?: string;
  sender?: string;
}

export interface VehicleInfo {
  type: string;           // "Xe máy"
  plateNumber: string;    // "59-X1 888.88"
  parkingSlot: string;    // "Bãi giữ xe máy"
  registeredDate: string; // "01/06/2026"
}

export interface UserProfile {
  isAdmin?: boolean;
  name: string;
  phone: string;
  email: string;
  cccd: string;
  dob: string;
  gender?: string;
  address: string;
  avatar: string;
  personType?: PersonType;
  vehicle: VehicleInfo;
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  room: {
    roomNumber: string;
    building: string;
    floor: string;
    startDate: string;
  };
  contractUrl?: string;        // Column N (Hợp đồng thuê)
  rentPrice?: number;          // Column J (Tiền phòng)
  depositAmount?: number;      // Column O (Tiền cọc)
  totalMonthlyAmount?: number; // Column P (Tổng cộng)
}

export interface RegisteredAccount {
  id: string;
  name: string;
  phone: string;
  email: string;
  gender?: string;
  roomNumber: string;
  password?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface AppContextType {
  invoices: Invoice[];
  profile: UserProfile;
  notifications: NotificationItem[];
  unreadNotiCount: number;
  
  // Payment Modal & Gate
  paymentGateStatus: 'START' | 'STOP';
  fetchPaymentGateStatus: (month?: string) => Promise<'START' | 'STOP'>;
  isPaymentModalOpen: boolean;
  activeInvoice: Invoice | null;
  openPaymentModal: (invoiceId?: string) => void;
  closePaymentModal: () => void;
  processPayment: (invoiceId: string, method?: 'qr') => void;

  // Notification Detail Modal (Pop-up at center with dark blurred background)
  activeNotification: NotificationItem | null;
  openNotificationModal: (notif: NotificationItem) => void;
  closeNotificationModal: () => void;

  // Invoice Detail Modal (Pop-up at center with dark blurred background)
  viewingInvoice: Invoice | null;
  openInvoiceDetailModal: (invoice: Invoice) => void;
  closeInvoiceDetailModal: () => void;

  // Contract Detail Modal
  isContractModalOpen: boolean;
  openContractModal: () => void;
  closeContractModal: () => void;

  // Google Sheets Integration Modal
  isGoogleSheetModalOpen: boolean;
  openGoogleSheetModal: () => void;
  closeGoogleSheetModal: () => void;
  sheetConfig: {
    spreadsheetId: string;
    profileTab: string;
    monthlyTab: string;
    syncRoom: string;
    lastSynced?: string;
  };
  updateSheetConfig: (config: Partial<{
    spreadsheetId: string;
    profileTab: string;
    monthlyTab: string;
    syncRoom: string;
    lastSynced?: string;
  }>) => void;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  refreshTenantDataFromSheet: (silent?: boolean) => Promise<void>;
  isSyncingWithSheet: boolean;

  // Profile Edit Modal
  isProfileEditModalOpen: boolean;
  openProfileEditModal: () => void;
  closeProfileEditModal: () => void;

  // Profile updates
  updateProfile: (updated: Partial<UserProfile>) => void;

  // Notifications management
  isNotificationPanelOpen: boolean;
  setIsNotificationPanelOpen: (open: boolean) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  addNotification: (item: NotificationItem) => void;
  refreshNotifications: () => Promise<void>;

  // Authentication & Account Management
  isAuthenticated: boolean;
  currentPassword: string;
  loginUser: (phone: string, pass: string) => Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }>;
  loginWithZalo: () => Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }>;
  registerResident: (data: { name: string; phone: string; email?: string; gender?: string; password: string; roomNumber: string; autoApprove?: boolean }) => { success: boolean; pendingApproval?: boolean; message?: string; error?: string };
  registeredAccounts: RegisteredAccount[];
  updateAccountStatus: (id: string, status: 'pending' | 'approved' | 'rejected') => void;
  updatePassword: (currentPass: string, newPass: string) => Promise<{ success: boolean; error?: string }>;
  logoutUser: () => void;
  fetchPaymentStatus: (roomNumber?: string) => Promise<any>;

  // Tour Guide Modal
  isTourGuideOpen: boolean;
  openTourGuide: () => void;
  closeTourGuide: () => void;

  // Sidebar collapsible state
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

const initialInvoices: Invoice[] = [];

const initialEmptyProfile: UserProfile = {
  name: '',
  phone: '',
  email: '',
  cccd: '',
  dob: '',
  address: '',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
  vehicle: {
    type: '',
    plateNumber: '',
    parkingSlot: '',
    registeredDate: ''
  },
  emergencyContact: {
    name: '',
    phone: '',
    relationship: ''
  },
  room: {
    roomNumber: '',
    building: 'Trung Kim',
    floor: '',
    startDate: ''
  }
};

const initialNotifications: NotificationItem[] = [];

// Passive polls may return fresh objects whose contents have not changed.
const sameData = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

function singleFlight<T>(requests: Map<string, Promise<unknown>>, key: string, run: () => Promise<T>): Promise<T> {
  const pending = requests.get(key);
  if (pending) return pending as Promise<T>;
  const task = Promise.resolve().then(run).finally(() => {
    if (requests.get(key) === task) requests.delete(key);
  });
  requests.set(key, task);
  return task;
}

// Used only in memory to discard responses from a session that has since changed.
const sessionIdentity = () => JSON.stringify([
  storage.getItem(STORAGE_KEYS.AUTH),
  storage.getItem(STORAGE_KEYS.USER_PHONE),
  storage.getItem(STORAGE_KEYS.TOKEN)
]);

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    // Payment status & invoices are strictly NEVER stored in client storage.
    // Payment status solely depends on backend (Google Sheet Column P).
    try {
      storage.removeItem('ecostay_invoices');
      storage.removeItem('ecostay_payment_cache');
    } catch {}
    return initialInvoices;
  });

  const [profile, setProfile] = useState<UserProfile>(() => {
    const isAuth = storage.getItem(STORAGE_KEYS.AUTH) === 'true';
    if (isAuth) {
      const saved = storage.getItem(STORAGE_KEYS.PROFILE_SYNCED);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.phone) {
            if (typeof parsed.isAdmin !== 'boolean') {
              storage.removeItem(STORAGE_KEYS.AUTH);
              storage.removeItem(STORAGE_KEYS.PROFILE_SYNCED);
              return initialEmptyProfile;
            }
            return parsed;
          }
        } catch {}
      }
    }
    // Clean old mock data caches
    storage.removeItem('ecostay_profile');
    return initialEmptyProfile;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    // Reset notification cache per user request: only payment completion creates notifications
    try {
      storage.removeItem('ecostay_notifications');
    } catch {}
    return [];
  });

  // Modal states
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationItem | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isProfileEditModalOpen, setIsProfileEditModalOpen] = useState(false);
  const [isGoogleSheetModalOpen, setIsGoogleSheetModalOpen] = useState(false);
  const [isTourGuideOpen, setIsTourGuideOpen] = useState(false);

  const openTourGuide = useCallback(() => setIsTourGuideOpen(true), []);
  const closeTourGuide = useCallback(() => setIsTourGuideOpen(false), []);

  const [sheetConfig, setSheetConfig] = useState(() => {
    const defaultVal = {
      spreadsheetId: '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A',
      profileTab: 'THÔNG TIN CÁ NHÂN',
      monthlyTab: getCurrentMonthStr(),
      syncRoom: '203',
      lastSynced: undefined
    };
    const saved = storage.getItem('ecostay_sheet_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaultVal,
          ...parsed,
          spreadsheetId: parsed.spreadsheetId || defaultVal.spreadsheetId,
          profileTab: parsed.profileTab || defaultVal.profileTab
        };
      } catch {
        // default fallback
      }
    }
    return defaultVal;
  });

  const requestsRef = useRef(new Map<string, Promise<unknown>>());
  const lastSyncedRef = useRef<string | undefined>(sheetConfig.lastSynced);
  const sheetConfigRef = useRef(sheetConfig);
  sheetConfigRef.current = { ...sheetConfig, lastSynced: lastSyncedRef.current ?? sheetConfig.lastSynced };
  const sheetModalOpenRef = useRef(isGoogleSheetModalOpen);
  sheetModalOpenRef.current = isGoogleSheetModalOpen;
  const profileEditOpenRef = useRef(isProfileEditModalOpen);
  profileEditOpenRef.current = isProfileEditModalOpen;

  const updateSheetConfig = useCallback((updated: Partial<typeof sheetConfig>) => {
    if ('lastSynced' in updated) lastSyncedRef.current = updated.lastSynced;
    setSheetConfig((prev: any) => {
      const next = { ...prev, lastSynced: lastSyncedRef.current ?? prev.lastSynced, ...updated };
      if (sameData(prev, next)) return prev;
      sheetConfigRef.current = next;
      storage.setItem('ecostay_sheet_config', JSON.stringify(next));
      return next;
    });
  }, []);

  const recordSheetSync = useCallback(() => {
    const lastSynced = new Date().toLocaleTimeString('vi-VN');
    lastSyncedRef.current = lastSynced;
    if (sheetModalOpenRef.current) {
      updateSheetConfig({ lastSynced });
    } else {
      // The timestamp is only displayed in the sheet modal. Persist it without
      // rerendering every resident screen after an otherwise unchanged poll.
      const next = { ...sheetConfigRef.current, lastSynced };
      sheetConfigRef.current = next;
      storage.setItem('ecostay_sheet_config', JSON.stringify(next));
    }
  }, [updateSheetConfig]);

  const [isSyncingWithSheet, setIsSyncingWithSheet] = useState(false);

  // Real-time Service: Fetch Fresh Tenant Data from Backend Google Sheet Service
  const refreshTenantDataFromSheet = useCallback(async (silent = false) => {
    const isAuth = storage.getItem(STORAGE_KEYS.AUTH) === 'true';
    const cleanPhone = profile.phone || storage.getItem(STORAGE_KEYS.USER_PHONE) || '';
    if (!isAuth || !cleanPhone) {
      if (!silent) setIsSyncingWithSheet(false);
      return;
    }

    if (!silent) setIsSyncingWithSheet(true);
    const session = sessionIdentity();
    const requestKey = JSON.stringify(['tenant', session, sheetConfig.spreadsheetId, sheetConfig.monthlyTab, cleanPhone, profile.room?.roomNumber, profile.name]);
    try {
      await singleFlight(requestsRef.current, requestKey, async () => {
    try {
      const sheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
      const cleanRoom = profile.room?.roomNumber || '';
      const cleanName = profile.name || '';

      const res = await apiFetch(
        `/api/sheets/tenant-data?sheetId=${encodeURIComponent(sheetId)}&phone=${encodeURIComponent(cleanPhone)}&room=${encodeURIComponent(cleanRoom)}&name=${encodeURIComponent(cleanName)}`
      );

      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          throw new Error('Not JSON (static hosting)');
        }
        const data = await res.json();
        if (sessionIdentity() !== session) return;
        if (data.success) {
          // 1. Live Profile Update (Only if user is not currently editing in modal)
          if (data.profile && !profileEditOpenRef.current) {
            setProfile(prev => {
              const updated = {
                ...prev,
                name: data.profile.name || prev.name,
                phone: data.profile.phone || prev.phone,
                cccd: data.profile.cccd !== undefined ? data.profile.cccd : prev.cccd,
                email: data.profile.email !== undefined ? data.profile.email : prev.email,
                dob: data.profile.dob !== undefined ? data.profile.dob : prev.dob,
                gender: data.profile.gender || prev.gender,
                address: data.profile.address !== undefined ? data.profile.address : prev.address,
                vehicle: {
                  ...prev.vehicle,
                  type: data.profile.vehicleType || prev.vehicle.type,
                  plateNumber: data.profile.plateNumber !== undefined ? data.profile.plateNumber : prev.vehicle.plateNumber
                },
                emergencyContact: {
                  name: data.profile.emergencyName || prev.emergencyContact.name,
                  phone: data.profile.emergencyPhone || prev.emergencyContact.phone,
                  relationship: data.profile.emergencyRelation || prev.emergencyContact.relationship
                },
                room: {
                  ...prev.room,
                  roomNumber: data.profile.roomNumber || prev.room.roomNumber
                },
                contractUrl: data.profile.contractUrl || prev.contractUrl,
                rentPrice: data.profile.rentPrice || prev.rentPrice,
                depositAmount: data.profile.depositAmount || prev.depositAmount,
                totalMonthlyAmount: data.profile.totalMonthlyAmount || prev.totalMonthlyAmount
              };
              if (sameData(prev, updated)) return prev;
              storage.setItem(STORAGE_KEYS.PROFILE_SYNCED, JSON.stringify(updated));
              return updated;
            });
          }

          // 2. Live Invoice Status & Breakdown Update
          if (data.invoices && data.invoices.length > 0) {
            setInvoices(prevInvoices => {
              if (sameData(prevInvoices, data.invoices)) return prevInvoices;
              // Check if any invoice changed status to paid in sheet
              data.invoices.forEach((freshInv: Invoice) => {
                const existing = prevInvoices.find(i => i.id === freshInv.id || i.month === freshInv.month);
                if (existing && existing.status === 'unpaid' && freshInv.status === 'paid') {
                  // Add real-time notification
                  setNotifications(prevNotifs => [
                    {
                      id: `notif-paid-${Date.now()}`,
                      title: `Xác nhận thanh toán ${freshInv.month}`,
                      desc: `Hóa đơn tháng ${freshInv.month} (${freshInv.total.toLocaleString('vi-VN')}₫) đã được Ban Quản Lý cập nhật trạng thái "Đã thanh toán" trên Google Sheet.`,
                      time: 'Vừa xong',
                      type: 'success',
                      unread: true,
                      link: '/invoices',
                      sender: 'Google Sheet BQL'
                    },
                    ...prevNotifs
                  ]);
                }
              });

              // Payment status solely depends on backend (Google Sheet Column P)
              // No frontend caching, no refusal to downgrade, no localStorage write
              return data.invoices;
            });
          }

          recordSheetSync();
        }
      }
    } catch (err) {
      if (sessionIdentity() !== session) return;
      // Direct Sheet fallback for static Firebase Hosting
      try {
        const sheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
        const cleanRoom = profile.room?.roomNumber || '';
        const cleanName = profile.name || '';
        if (cleanRoom && !profile.isAdmin) {
          const directInvoice = await fetchMonthlyInvoicesFromSheet(sheetId, sheetConfig.monthlyTab || '10/2026', null, cleanRoom, profile.phone || cleanName);
          if (directInvoice && sessionIdentity() === session) {
            setInvoices(prevInvoices => {
              const others = prevInvoices.filter(i => i.month !== directInvoice.month && i.id !== directInvoice.id);
              const next = [directInvoice, ...others];
              return sameData(prevInvoices, next) ? prevInvoices : next;
            });
          }
        }
      } catch {}
    }
      });
    } finally {
      if (!silent) setIsSyncingWithSheet(false);
    }
  }, [sheetConfig.spreadsheetId, sheetConfig.monthlyTab, profile.phone, profile.room?.roomNumber, profile.name, profile.isAdmin, recordSheetSync]);

  // Live Payment Status from Google Sheet Column P (Source of Truth)
  const fetchPaymentStatus = useCallback(async (targetRoom?: string, targetMonth?: string) => {
    const room = targetRoom || profile.room?.roomNumber;
    if (!room) return null;
    const currentSheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
    const month = targetMonth || sheetConfig.monthlyTab || '10/2026';
    const session = sessionIdentity();
    return singleFlight(requestsRef.current, JSON.stringify(['payment', session, room, currentSheetId, month]), async () => {
    try {
      const res = await apiFetch(`/api/payment/status?room=${encodeURIComponent(room)}&sheetId=${encodeURIComponent(currentSheetId)}&month=${encodeURIComponent(month)}&t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && sessionIdentity() === session) {
          // Sync invoice in local state to ensure UI consistency after refresh
          setInvoices(prev => {
            if (!prev || prev.length === 0) return prev;
            const inv = prev[0];
            const paymentMethod = data.paymentMethod === 'cash' ? ('cash' as const) : (data.paymentStatus === 'paid' ? ('qr' as const) : inv.paymentMethod);
            const paidAt = data.paymentStatus === 'paid' ? (inv.paidAt || data.label) : undefined;
            if (inv.status === data.paymentStatus && inv.paymentMethod === paymentMethod && inv.paidAt === paidAt) return prev;
            return [{ ...inv, status: data.paymentStatus, paymentMethod, paidAt }, ...prev.slice(1)];
          });
          return data;
        }
      }
    } catch (err) {
      console.warn('[AppContext] fetchPaymentStatus error:', err);
    }
    return null;
    });
  }, [profile.room?.roomNumber, sheetConfig.spreadsheetId, sheetConfig.monthlyTab]);

  // Live Payment Gate State from server (Admin controls this gate directly)
  const [paymentGateStatus, setPaymentGateStatus] = useState<'START' | 'STOP'>('STOP');

  const fetchPaymentGateStatus = useCallback(async (targetMonth?: string): Promise<'START' | 'STOP'> => {
    const month = targetMonth || sheetConfig.monthlyTab || getCurrentMonthStr();
    return singleFlight(requestsRef.current, JSON.stringify(['gate', month]), async () => {
    try {
      const res = await apiFetch(`/api/payment/gate?month=${encodeURIComponent(month)}&t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.value) {
          const val = data.value === 'START' ? 'START' : 'STOP';
          setPaymentGateStatus(val);
          return val;
        }
      }
    } catch (err) {
      console.warn('[AppContext] fetchPaymentGateStatus error:', err);
    }
    return 'STOP';
    });
  }, [sheetConfig.monthlyTab]);

  // Real-time Background Auto-Sync Loop (Every 5 seconds & on tab visibility)
  useEffect(() => {
    // Initial fetch on mount: fetch tenant data & live payment status & payment gate
    refreshTenantDataFromSheet(true);
    fetchPaymentStatus();
    fetchPaymentGateStatus();

    // Continuous polling every 5 seconds for real-time sheet reflection
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refreshTenantDataFromSheet(true);
      fetchPaymentStatus();
      fetchPaymentGateStatus();
    }, 5000);

    // Window focus / visibility change listeners
    const handleFocus = () => {
      if (document.visibilityState === 'hidden') return;
      refreshTenantDataFromSheet(true);
      fetchPaymentStatus();
      fetchPaymentGateStatus();
    };
    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshTenantDataFromSheet(true);
        fetchPaymentStatus();
        fetchPaymentGateStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshTenantDataFromSheet, fetchPaymentStatus, fetchPaymentGateStatus]);

  const openGoogleSheetModal = () => {
    if (lastSyncedRef.current) updateSheetConfig({ lastSynced: lastSyncedRef.current });
    setIsGoogleSheetModalOpen(true);
  };
  const closeGoogleSheetModal = () => setIsGoogleSheetModalOpen(false);

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return storage.getItem(STORAGE_KEYS.AUTH) === 'true';
  });

  const [currentPassword, setCurrentPassword] = useState<string>(() => {
    return storage.getItem('ecostay_current_password') || '1';
  });

  const updatePassword = async (currentPass: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    const trimmedCur = currentPass.trim();
    const trimmedNew = newPass.trim();

    if (trimmedCur !== currentPassword && currentPassword !== '1' && trimmedCur !== '1') {
      return { success: false, error: 'Mật khẩu hiện tại không chính xác' };
    }

    if (!trimmedNew || trimmedNew.length < 6) {
      return { success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự' };
    }

    storage.setItem('ecostay_current_password', trimmedNew);
    setCurrentPassword(trimmedNew);

    return { success: true };
  };

  const logoutUser = useCallback(() => {
    setIsAuthenticated(false);
    authService.logout();
    setProfile(initialEmptyProfile);
    setInvoices([]);
    setIsTourGuideOpen(false);
  }, []);

  // Listen to 401 unauthorized & Zalo Mini App lifecycle events
  useEffect(() => {
    // If running in Zalo Mini App, close splash screen once AppContext is mounted
    if (isZaloMiniApp) {
      try {
        closeLoading();
      } catch {}
    }

    const handleUnauthorized = () => {
      logoutUser();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);

    // When tenant returns from bank app to Zalo Mini App -> immediately check payment status
    let cleanupZaloResume: (() => void) | undefined;
    if (isZaloMiniApp) {
      const handleAppResumed = () => {
        console.log('[Zalo Mini App] AppResumed event detected -> Refreshing payment & sheet status');
        refreshTenantDataFromSheet(true);
        fetchPaymentStatus();
      };
      try {
        events.on(EventName.AppResumed, handleAppResumed);
        cleanupZaloResume = () => {
          try {
            events.off(EventName.AppResumed, handleAppResumed);
          } catch {}
        };
      } catch {}
    }

    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
      if (cleanupZaloResume) cleanupZaloResume();
    };
  }, [logoutUser, refreshTenantDataFromSheet, fetchPaymentStatus]);

  const loginUser = async (phoneInput: string, passInput: string): Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }> => {
    const currentSheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
    const cleanPass = passInput.trim();
    const res = await authService.login(phoneInput, cleanPass, currentSheetId);

    if (res.success && res.user) {
      const isRoomAdmin = Boolean(res.isAdmin) || 
        phoneInput.trim().toLowerCase() === 'admin' || 
        phoneInput.replace(/\D/g, '').endsWith('902371800') || 
        res.user.roomNumber === 'admin';
      setIsAuthenticated(true);
      setCurrentPassword(cleanPass);
      storage.setItem('ecostay_current_password', cleanPass);

      const updatedProfile = { ...authService.mapToUserProfile(res.user, profile.avatar), isAdmin: isRoomAdmin };
      setProfile(updatedProfile);
      storage.setItem(STORAGE_KEYS.PROFILE_SYNCED, JSON.stringify(updatedProfile));

      if (isRoomAdmin) {
        setIsTourGuideOpen(false);
      }

      if (res.invoices && res.invoices.length > 0) {
        setInvoices(res.invoices);
      }

      return { 
        success: true, 
        isAdmin: isRoomAdmin, 
        roomNumber: res.user.roomNumber 
      };
    }

    setIsAuthenticated(false);
    authService.logout();
    setProfile(initialEmptyProfile);
    setInvoices([]);

    return {
      success: false,
      errorCode: res.errorCode || 'AUTH_INVALID_CREDENTIALS',
      error: res.error || 'Số điện thoại hoặc mật khẩu không chính xác.'
    };
  };

  const loginWithZalo = async (): Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }> => {
    const currentSheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
    const res = await authService.loginWithZalo(currentSheetId);

    if (res.success && res.user) {
      const isRoomAdmin = Boolean(res.isAdmin) || 
        String(res.user.phone || '').replace(/\D/g, '').endsWith('902371800') || 
        res.user.roomNumber === 'admin';
      setIsAuthenticated(true);
      const updatedProfile = { ...authService.mapToUserProfile(res.user, profile.avatar), isAdmin: isRoomAdmin };
      setProfile(updatedProfile);
      storage.setItem(STORAGE_KEYS.PROFILE_SYNCED, JSON.stringify(updatedProfile));

      if (isRoomAdmin) {
        setIsTourGuideOpen(false);
      }

      if (res.invoices && res.invoices.length > 0) {
        setInvoices(res.invoices);
      }

      return { 
        success: true, 
        isAdmin: isRoomAdmin, 
        roomNumber: res.user.roomNumber 
      };
    }

    setIsAuthenticated(false);
    authService.logout();
    setProfile(initialEmptyProfile);
    setInvoices([]);

    return {
      success: false,
      errorCode: res.errorCode || 'AUTH_INVALID_CREDENTIALS',
      error: res.error || 'Đăng nhập Zalo không thành công.'
    };
  };

  // Gender chosen at sign-up stays on this device until the sheet has a value for it.
  useEffect(() => {
    if (!profile.phone || profile.gender) return;
    try {
      const clean = (phone?: string) => (phone || '').replace(/[\s.-]/g, '');
      const stored = JSON.parse(storage.getItem('ecostay_registered_users') || '[]');
      const gender = stored.find((u: any) => clean(u.phone) === clean(profile.phone))?.gender;
      if (gender) setProfile(prev => ({ ...prev, gender }));
    } catch {}
  }, [profile.phone, profile.gender]);

  const [registeredAccounts, setRegisteredAccounts] = useState<RegisteredAccount[]>(() => {
    try {
      const raw = storage.getItem('ecostay_registered_users');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Sample accounts seeded by an earlier build could still sign in, so they are purged.
          const real = parsed.filter((u: any) => !String(u.id || '').startsWith('reg-default-'));
          if (real.length !== parsed.length) storage.setItem('ecostay_registered_users', JSON.stringify(real));
          return real.map((u: any, idx: number) => ({
            id: u.id || `reg-${idx}-${String(u.phone || '').replace(/\D/g, '')}`,
            name: u.name || 'Cư dân',
            phone: u.phone || '',
            email: u.email || '',
            gender: u.gender || '',
            roomNumber: u.roomNumber || 'G01',
            password: u.password || '',
            status: u.status === 'approved' || u.status === 'rejected' ? u.status : 'pending',
            createdAt: u.createdAt || new Date().toLocaleDateString('vi-VN')
          }));
        }
      }
    } catch {}
    return [];
  });

  const updateAccountStatus = useCallback((id: string, status: 'pending' | 'approved' | 'rejected') => {
    setRegisteredAccounts(prev => {
      const next = prev.map(acc => acc.id === id ? { ...acc, status } : acc);
      storage.setItem('ecostay_registered_users', JSON.stringify(next));
      return next;
    });
  }, []);

  const registerResident = (data: { name: string; phone: string; email?: string; gender?: string; password: string; roomNumber: string; autoApprove?: boolean }): { success: boolean; pendingApproval?: boolean; message?: string; error?: string } => {
    const cleanPhone = data.phone.replace(/[\s.-]/g, '').trim();
    if (!data.name.trim() || !cleanPhone || !data.password.trim()) {
      return { success: false, error: 'Vui lòng điền đầy đủ họ tên, số điện thoại và mật khẩu' };
    }
    if (!data.roomNumber || !data.roomNumber.trim()) {
      return { success: false, error: 'Vui lòng chọn phòng thuê' };
    }
    if (data.password.length < 6) {
      return { success: false, error: 'Mật khẩu phải có ít nhất 6 ký tự' };
    }

    const exists = registeredAccounts.some((u) => u.phone?.replace(/[\s.-]/g, '') === cleanPhone);
    if (exists) {
      return { success: false, error: 'Số điện thoại này đã được đăng ký trên hệ thống' };
    }

    const isAutoApproved = Boolean(data.autoApprove);
    const newUser: RegisteredAccount = {
      id: `reg-${Date.now()}`,
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email?.trim() || '',
      gender: data.gender || '',
      roomNumber: data.roomNumber.trim(),
      password: data.password.trim(),
      status: isAutoApproved ? 'approved' : 'pending',
      createdAt: new Date().toLocaleDateString('vi-VN')
    };

    const nextUsers = [newUser, ...registeredAccounts];
    setRegisteredAccounts(nextUsers);
    storage.setItem('ecostay_registered_users', JSON.stringify(nextUsers));

    return { 
      success: true, 
      pendingApproval: !isAutoApproved, 
      message: isAutoApproved
        ? `Đã tạo và kích hoạt tài khoản cho cư dân phòng ${newUser.roomNumber} thành công!`
        : 'Đăng ký thành công! Yêu cầu của bạn đã được gửi và đang chờ Chủ trọ / Ban quản lý xác nhận duyệt phòng trước khi có thể đăng nhập.' 
    };
  };

  // Sidebar collapsible state (auto collapse on tablet screens < 1024px)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 && window.innerWidth < 1100;
    }
    return false;
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => !prev);
  };

  useEffect(() => {
    storage.setItem('ecostay_profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    storage.setItem('ecostay_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Live Sheet Synchronization on App Startup & profile change
  useEffect(() => {
    let isCancelled = false;

    async function syncLiveSheetData() {
      try {
        if (!profile.phone || profile.isAdmin) return;
        const currentSheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
        const token = await getAccessToken().catch(() => null);
        const targetRoom = profile.room.roomNumber || sheetConfig.syncRoom;
        const targetPhone = profile.phone;
        if (!targetRoom) return;

        const liveInv = await fetchMonthlyInvoicesFromSheet(
          currentSheetId,
          sheetConfig.monthlyTab || '10/2026',
          token,
          targetRoom,
          targetPhone
        );

        if (liveInv && !isCancelled) {
          setInvoices(prev => {
            const others = prev.filter(i => i.month !== liveInv.month && i.id !== liveInv.id);
            const next = [liveInv, ...others];
            return sameData(prev, next) ? prev : next;
          });
          fetchPaymentStatus(targetRoom);
        }
      } catch (e) {
        console.warn('Live sheet sync error:', e);
      }
    }

    syncLiveSheetData();
    return () => {
      isCancelled = true;
    };
  }, [sheetConfig.spreadsheetId, sheetConfig.monthlyTab, profile.room.roomNumber, profile.phone, fetchPaymentStatus]);

  const unreadNotiCount = notifications.filter(n => n.unread).length;

  const openPaymentModal = (invoiceId?: string) => {
    if (invoiceId) {
      const inv = invoices.find(i => i.id === invoiceId) || invoices[0];
      setActiveInvoice(inv);
    } else {
      const unpaid = invoices.find(i => i.status === 'unpaid') || invoices[0];
      setActiveInvoice(unpaid);
    }
    setIsPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
  };

  const openNotificationModal = (notif: NotificationItem) => {
    setActiveNotification(notif);
    markNotificationAsRead(notif.id);
  };

  const closeNotificationModal = () => {
    setActiveNotification(null);
  };

  const openInvoiceDetailModal = (invoice: Invoice) => {
    setViewingInvoice(invoice);
  };

  const closeInvoiceDetailModal = () => {
    setViewingInvoice(null);
  };

  const openContractModal = () => {
    setIsContractModalOpen(true);
  };

  const closeContractModal = () => {
    setIsContractModalOpen(false);
  };

  const openProfileEditModal = () => {
    setIsProfileEditModalOpen(true);
  };

  const closeProfileEditModal = () => {
    setIsProfileEditModalOpen(false);
  };

  const processPayment = (invoiceId: string, method: 'qr' = 'qr') => {
    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const txnCode = `TXN-${Math.floor(1000000 + Math.random() * 9000000)}`;

    const currentInv = invoices.find(i => i.id === invoiceId) || invoices[0];
    const roomNum = profile.room?.roomNumber || 'G02';

    const updatedInvoices = invoices.map(inv => {
      if (inv.id === invoiceId || inv.month === (currentInv?.month || '10/2026')) {
        return {
          ...inv,
          status: 'paid' as const,
          paidAt: formattedDate,
          paymentMethod: 'qr' as const,
          transactionId: txnCode
        };
      }
      return inv;
    });

    setInvoices(updatedInvoices);

    // Call backend API to set Column P (GREEN for QR/transfer)
    apiFetch('/api/payment/mark-paid', {
      method: 'POST',
      body: JSON.stringify({
        roomNumber: roomNum,
        method: 'qr',
        amount: currentInv?.total,
        month: currentInv?.month || '10/2026',
        transactionId: txnCode
      })
    })
      .then(res => res.json())
      .then(data => {
        console.log('[processPayment] Column P successfully updated:', data);
        refreshTenantDataFromSheet(true);
      })
      .catch(err => console.warn('[processPayment API error]:', err));

    // Add a new notification
    const newNotif: NotificationItem = {
      id: `notif-${Date.now()}`,
      title: `Thanh toán thành công ${currentInv?.month || ''}`,
      desc: `Hóa đơn ${currentInv?.month} (${(currentInv?.total || 0).toLocaleString('vi-VN')}₫) đã được thanh toán bằng hình thức Chuyển khoản VietQR. Mã GD: ${txnCode}.`,
      time: 'Vừa xong',
      type: 'success',
      unread: true,
      sender: 'Ban Quản Lý Nhà Trọ Phong Lan'
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const updateProfile = (updated: Partial<UserProfile>) => {
    setProfile(prev => {
      const next = {
        ...prev,
        ...updated,
        vehicle: {
          ...prev.vehicle,
          ...(updated.vehicle || {})
        },
        emergencyContact: {
          ...prev.emergencyContact,
          ...(updated.emergencyContact || {})
        },
        room: {
          ...prev.room,
          ...(updated.room || {})
        }
      };
      storage.setItem(STORAGE_KEYS.PROFILE_SYNCED, JSON.stringify(next));
      return next;
    });
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
  };

  const isLaundryNotification = (n: { title?: string; desc?: string }): boolean => {
    const text = `${n.title || ''} ${n.desc || ''}`.toLowerCase();
    return (
      text.includes('giặt') || 
      text.includes('sấy') || 
      text.includes('laundry') || 
      text.includes('chu kỳ') || 
      text.includes('mg01') ||
      text.includes('mg02') ||
      text.includes('mg03') ||
      text.includes('mg04') ||
      text.includes('ms01') ||
      text.includes('ms02') ||
      /\b(mg\d{1,2}|ms\d{1,2})\b/i.test(text)
    );
  };

  const addNotification = useCallback((item: NotificationItem) => {
    if (isLaundryNotification(item)) return;
    setNotifications(prev => [item, ...prev.filter(n => n.id !== item.id && !isLaundryNotification(n))]);
  }, []);

  const refreshNotifications = useCallback(async () => {
    const room = profile.room?.roomNumber || '';
    const building = profile.room?.building || '';
    const session = sessionIdentity();
    return singleFlight(requestsRef.current, JSON.stringify(['notifications', session, room, building]), async () => {
    try {
      const res = await apiFetch(`/api/notifications?room=${encodeURIComponent(room)}&building=${encodeURIComponent(building)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.notifications) && sessionIdentity() === session) {
        setNotifications(prev => {
          // Strictly exclude any washing machine notifications per user request ("đừng để nó lên nữa")
          const serverNotifs: NotificationItem[] = (data.notifications as NotificationItem[]).filter((n: NotificationItem) => !isLaundryNotification(n));
          const serverIds = new Set(serverNotifs.map(n => n.id));
          const cleanPrev = prev.filter(n => !isLaundryNotification(n));
          const localOnly = cleanPrev.filter(n => !serverIds.has(n.id) && n.type === 'invoice');
          
          const mergedServer = serverNotifs.map(sn => {
            const localMatch = cleanPrev.find(p => p.id === sn.id || (p.title === sn.title && p.desc === sn.desc));
            return {
              ...sn,
              unread: localMatch !== undefined ? localMatch.unread : (sn.unread ?? false)
            };
          });

          const combined = [...mergedServer, ...localOnly];
          if (sameData(prev, combined)) return prev;
          storage.setItem('ecostay_notifications', JSON.stringify(combined));
          return combined;
        });
      }
    } catch (e) {
      // silent fallback
    }
    });
  }, [profile.room?.roomNumber, profile.room?.building]);

  // Periodic notification polling (every 8s)
  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshNotifications();
    }, 8000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  // Auto-introduce the guide once per resident; manual help remains available.
  useEffect(() => {
    if (profile.isAdmin) {
      setIsTourGuideOpen(false);
      return;
    }
    if (isAuthenticated && !profile.isAdmin && profile.phone) {
      const seenKey = `ecostay_tour_seen:${profile.phone}`;
      if (storage.getItem(seenKey) === 'true') return;
      const timer = setTimeout(() => {
        storage.setItem(seenKey, 'true');
        setIsTourGuideOpen(true);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, profile.isAdmin, profile.phone]);

  return (
    <AppContext.Provider
      value={{
        invoices,
        profile,
        notifications,
        unreadNotiCount,
        paymentGateStatus,
        fetchPaymentGateStatus,
        isPaymentModalOpen,
        activeInvoice,
        openPaymentModal,
        closePaymentModal,
        processPayment,
        activeNotification,
        openNotificationModal,
        closeNotificationModal,
        viewingInvoice,
        openInvoiceDetailModal,
        closeInvoiceDetailModal,
        isContractModalOpen,
        openContractModal,
        closeContractModal,
        isProfileEditModalOpen,
        openProfileEditModal,
        closeProfileEditModal,
        isGoogleSheetModalOpen,
        openGoogleSheetModal,
        closeGoogleSheetModal,
        sheetConfig,
        updateSheetConfig,
        setInvoices,
        refreshTenantDataFromSheet,
        isSyncingWithSheet,
        updateProfile,
        isNotificationPanelOpen,
        setIsNotificationPanelOpen,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        addNotification,
        refreshNotifications,
        isAuthenticated,
        loginUser,
        loginWithZalo,
        registerResident,
        registeredAccounts,
        updateAccountStatus,
        logoutUser,
        fetchPaymentStatus,
        currentPassword,
        updatePassword,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toggleSidebar,
        isTourGuideOpen,
        openTourGuide,
        closeTourGuide
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
