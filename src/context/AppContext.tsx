import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

  // Authentication
  isAuthenticated: boolean;
  currentPassword: string;
  loginUser: (phone: string, pass: string) => Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }>;
  loginWithZalo: () => Promise<{ success: boolean; isAdmin?: boolean; roomNumber?: string; errorCode?: AuthErrorCode; error?: string }>;
  registerResident: (data: { name: string; phone: string; email?: string; password: string; roomNumber: string }) => { success: boolean; pendingApproval?: boolean; message?: string; error?: string };
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

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    // Clear any stale cached invoice data so fresh Google Sheet data is always used
    try {
      storage.removeItem(STORAGE_KEYS.INVOICES);
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
    // Clear old mock notification cache so only live Google Sheet notifications appear
    try {
      const saved = storage.getItem('ecostay_notifications');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0 && String(parsed[0]?.id || '').startsWith('notif-')) {
          storage.removeItem('ecostay_notifications');
          return [];
        }
        return Array.isArray(parsed) ? parsed : [];
      }
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

  const updateSheetConfig = (updated: Partial<typeof sheetConfig>) => {
    setSheetConfig((prev: any) => {
      const next = { ...prev, ...updated };
      storage.setItem('ecostay_sheet_config', JSON.stringify(next));
      return next;
    });
  };

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
        if (data.success) {
          // 1. Live Profile Update (Only if user is not currently editing in modal)
          if (data.profile && !isProfileEditModalOpen) {
            setProfile(prev => {
              const updated = {
                ...prev,
                name: data.profile.name || prev.name,
                phone: data.profile.phone || prev.phone,
                cccd: data.profile.cccd !== undefined ? data.profile.cccd : prev.cccd,
                email: data.profile.email !== undefined ? data.profile.email : prev.email,
                dob: data.profile.dob !== undefined ? data.profile.dob : prev.dob,
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
              storage.setItem(STORAGE_KEYS.PROFILE_SYNCED, JSON.stringify(updated));
              return updated;
            });
          }

          // 2. Live Invoice Status & Breakdown Update
          if (data.invoices && data.invoices.length > 0) {
            setInvoices(prevInvoices => {
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

              // CRITICAL: Do not downgrade an invoice already confirmed 'paid' by Google Sheet Column P
              const updatedInvoices = data.invoices.map((freshInv: Invoice) => {
                const existing = prevInvoices.find(i => i.id === freshInv.id || i.month === freshInv.month);
                if (existing && existing.status === 'paid' && freshInv.status === 'unpaid') {
                  return { ...freshInv, status: 'paid' as const, paidAt: existing.paidAt };
                }
                return freshInv;
              });

              storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(updatedInvoices));
              return updatedInvoices;
            });
          }

          updateSheetConfig({ lastSynced: new Date().toLocaleTimeString('vi-VN') });
        }
      }
    } catch (err) {
      // Direct Sheet fallback for static Firebase Hosting
      try {
        const sheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
        const cleanRoom = profile.room?.roomNumber || '';
        const cleanName = profile.name || '';
        if (cleanRoom && !profile.isAdmin) {
          const directInvoice = await fetchMonthlyInvoicesFromSheet(sheetId, sheetConfig.monthlyTab || '10/2026', null, cleanRoom, profile.phone || cleanName);
          if (directInvoice) {
            setInvoices(prevInvoices => {
              const currentFirst = prevInvoices[0];
              const mergedInv = (currentFirst && currentFirst.status === 'paid' && directInvoice.status === 'unpaid')
                ? { ...directInvoice, status: 'paid' as const, paidAt: currentFirst.paidAt }
                : directInvoice;
              const others = prevInvoices.filter(i => i.month !== mergedInv.month && i.id !== mergedInv.id);
              const result = [mergedInv, ...others];
              storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(result));
              return result;
            });
          }
        }
      } catch {}
    } finally {
      if (!silent) setIsSyncingWithSheet(false);
    }
  }, [sheetConfig.spreadsheetId, sheetConfig.monthlyTab, profile.phone, profile.room?.roomNumber, profile.name, profile.isAdmin, isProfileEditModalOpen]);

  // Live Payment Status from Google Sheet Column P (Source of Truth)
  const fetchPaymentStatus = useCallback(async (targetRoom?: string, targetMonth?: string) => {
    const room = targetRoom || profile.room?.roomNumber;
    if (!room) return null;
    const currentSheetId = sheetConfig.spreadsheetId || '1KDnhL94V8-HZwsGiFA3HQ5sBYPoBT9QbEaIIOnNsl0A';
    const month = targetMonth || sheetConfig.monthlyTab || '10/2026';
    try {
      const res = await apiFetch(`/api/payment/status?room=${encodeURIComponent(room)}&sheetId=${encodeURIComponent(currentSheetId)}&month=${encodeURIComponent(month)}&t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          // Sync invoice in local state to ensure UI consistency after refresh
          setInvoices(prev => {
            if (!prev || prev.length === 0) return prev;
            return prev.map((inv, idx) => {
              if (idx === 0) {
                return {
                  ...inv,
                  status: data.paymentStatus,
                  paymentMethod: data.paymentMethod === 'cash' ? ('cash' as const) : (data.paymentStatus === 'paid' ? ('qr' as const) : inv.paymentMethod),
                  paidAt: data.paymentStatus === 'paid' ? (inv.paidAt || data.label) : undefined
                };
              }
              return inv;
            });
          });
          return data;
        }
      }
    } catch (err) {
      console.warn('[AppContext] fetchPaymentStatus error:', err);
    }
    return null;
  }, [profile.room?.roomNumber, sheetConfig.spreadsheetId, sheetConfig.monthlyTab]);

  // Live Payment Gate State from server (Admin controls this gate directly)
  const [paymentGateStatus, setPaymentGateStatus] = useState<'START' | 'STOP'>('STOP');

  const fetchPaymentGateStatus = useCallback(async (targetMonth?: string): Promise<'START' | 'STOP'> => {
    try {
      const month = targetMonth || sheetConfig.monthlyTab || getCurrentMonthStr();
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
  }, [sheetConfig.monthlyTab]);

  // Real-time Background Auto-Sync Loop (Every 5 seconds & on tab visibility)
  useEffect(() => {
    // Initial fetch on mount: fetch tenant data & live payment status & payment gate
    refreshTenantDataFromSheet(true);
    fetchPaymentStatus();
    fetchPaymentGateStatus();

    // Continuous polling every 5 seconds for real-time sheet reflection
    const interval = setInterval(() => {
      refreshTenantDataFromSheet(true);
      fetchPaymentStatus();
      fetchPaymentGateStatus();
    }, 5000);

    // Window focus / visibility change listeners
    const handleFocus = () => {
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

  const openGoogleSheetModal = () => setIsGoogleSheetModalOpen(true);
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
        storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(res.invoices));
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
        storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(res.invoices));
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

  const registerResident = (data: { name: string; phone: string; email?: string; password: string; roomNumber: string }): { success: boolean; pendingApproval?: boolean; message?: string; error?: string } => {
    const cleanPhone = data.phone.replace(/[\s.-]/g, '').trim();
    if (!data.name.trim() || !cleanPhone || !data.password.trim()) {
      return { success: false, error: 'Vui lòng điền đầy đủ họ tên, số điện thoại và mật khẩu' };
    }
    if (data.password.length < 6) {
      return { success: false, error: 'Mật khẩu phải có ít nhất 6 ký tự' };
    }

    const storedUsers = JSON.parse(storage.getItem('ecostay_registered_users') || '[]');
    const exists = storedUsers.some((u: any) => u.phone?.replace(/[\s.-]/g, '') === cleanPhone);
    if (exists) {
      return { success: false, error: 'Số điện thoại này đã gửi yêu cầu đăng ký' };
    }

    // New accounts require landlord approval ('pending')
    const newUser = {
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email?.trim() || '',
      roomNumber: data.roomNumber.trim(),
      password: data.password.trim(),
      status: 'pending', // Cần chủ trọ xác nhận
      createdAt: new Date().toLocaleDateString('vi-VN')
    };

    storedUsers.push(newUser);
    storage.setItem('ecostay_registered_users', JSON.stringify(storedUsers));

    return { 
      success: true, 
      pendingApproval: true, 
      message: 'Đăng ký thành công! Yêu cầu của bạn đã được gửi và đang chờ Chủ trọ / Ban quản lý xác nhận duyệt phòng trước khi có thể đăng nhập.' 
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
    storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
  }, [invoices]);

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
            const currentFirst = prev[0];
            const effectiveInv = (currentFirst && currentFirst.status === 'paid' && liveInv.status === 'unpaid')
              ? { ...liveInv, status: 'paid' as const, paidAt: currentFirst.paidAt }
              : liveInv;
            const others = prev.filter(i => i.month !== effectiveInv.month && i.id !== effectiveInv.id);
            return [effectiveInv, ...others];
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
    storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(updatedInvoices));

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

  const addNotification = useCallback((item: NotificationItem) => {
    setNotifications(prev => [item, ...prev.filter(n => n.id !== item.id)]);
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const room = profile.room?.roomNumber || '';
      const building = profile.room?.building || '';
      const res = await apiFetch(`/api/notifications?room=${encodeURIComponent(room)}&building=${encodeURIComponent(building)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.notifications)) {
        setNotifications(prev => {
          const serverNotifs: NotificationItem[] = data.notifications;
          const serverIds = new Set(serverNotifs.map(n => n.id));
          const localOnly = prev.filter(n => !serverIds.has(n.id));
          
          const mergedServer = serverNotifs.map(sn => {
            const localMatch = prev.find(p => p.id === sn.id);
            return {
              ...sn,
              unread: localMatch !== undefined ? localMatch.unread : true
            };
          });

          const combined = [...mergedServer, ...localOnly];
          storage.setItem('ecostay_notifications', JSON.stringify(combined));
          return combined;
        });
      }
    } catch (e) {
      // silent fallback
    }
  }, [profile.room?.roomNumber, profile.room?.building]);

  // Periodic notification polling (every 8s)
  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 8000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  // Default to launching tour guide every time for residents as requested
  useEffect(() => {
    if (profile.isAdmin) {
      setIsTourGuideOpen(false);
      return;
    }
    if (isAuthenticated && !profile.isAdmin && profile.phone) {
      const timer = setTimeout(() => {
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
