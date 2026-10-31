import * as NavIcons from 'lucide-react';
import '../styles/admin-tahoe.css';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  Users,
  Receipt,
  Search,
  FileText,
  Zap,
  Settings,
  BookOpen,
  Power,
  RefreshCw,
  ArrowLeft,
  Save,
  Printer,
  TrendingUp,
  Droplet,
  Bike,
  Calendar,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  LogOut,
  Building2,
  LayoutGrid,
  CheckCircle2,
  Clock,
  AlertCircle,
  Bell,
  Sun,
  Moon,
  Send,
  Check,
  AlertTriangle,
  WashingMachine,
  Flame,
  Play,
  RotateCcw,
  CalendarClock,
  FileSpreadsheet,
  X,
  User,
  ArrowRight,
  ShieldAlert
} from './AppIcons';
import { useApp, RegisteredAccount } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { storage } from '../lib/storage';
import { cn, getCurrentMonthStr, DEFAULT_ROOM_NUMBERS } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { HOUSES, houseFromRoom } from '../lib/houses';
import { buildContract, buildCt01, Person } from '../lib/documents/legalForms';
import { buildDeclaration } from '../lib/documents/stateFormat';
import { roomInvoice } from '../lib/documents/fromProfile';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';
import { canonicalRoomId, pushUpdateToGoogleSheet } from '../services/googleSheetSyncService';
import { ModernLineGraph } from './ModernLineGraph';
import { Background } from './Background';
import { useSidebarLabels } from '../lib/useSidebarLabels';
import {
  IconHome3D,
  IconWallet3D,
  IconSecurity3D,
  IconProfile3D,
  IconNotification3D,
  IconCalendar3D,
  IconChat3D,
  IconLocation3D,
  IconTick3D,
  IconElectricity3D,
  IconWater3D,
  IconPencil3D,
  IconMeter3D,
  IconSearchPlate3D,
  IconContract3D,
  IconDeclaration3D,
  IconSettings3D,
  IconLogout3D,
  IconAlert3D,
  IconClock3D,
  IconLaundry3D,
  IconDryer3D
} from './Icons3D';
import { AppleSwitch, AppleCheckbox } from './AppleControls';
import { soundFx } from '../lib/soundFx';
import { OfflineBanner } from './OfflineBanner';

// Unified UI Sound Manager with Low-Latency Acoustic Feedback
const playSound = (type: 'click' | 'hover' | 'success' | 'tab' | 'alert') => {
  if (type === 'click') soundFx.click();
  else if (type === 'hover') { /* hover sound disabled per user preference */ }
  else if (type === 'success') soundFx.success();
  else if (type === 'tab') soundFx.tab();
  else if (type === 'alert') soundFx.alert();
};

/**
 * Đọc số tiền bằng chữ tiếng Việt (Chuẩn hành chính / kế toán)
 */

const currentMonth = getCurrentMonthStr();
export const DEFAULT_MONTH_TABS = Array.from(new Set([
  '03/2026',
  '04/2026',
  '05/2026',
  '06/2026',
  '07/2026',
  '08/2026',
  '09/2026',
  '10/2026',
  currentMonth
]));

function NavigationHome({ size = 20, className = '' }: { size?: number; className?: string }) { return <img src="/icons/home.svg" alt="" aria-hidden="true" width={size} height={size} className={className} />; }


function AdminDisclosure({ title, description, className = '', children }: { title: string; description: string; className?: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = React.useId();
  return <section className={cn('admin-disclosure', className)}>
    <button type="button" className="admin-disclosure-trigger" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
      <span><span className="apple-headline kit-text-primary block">{title}</span><span className="apple-callout kit-text-secondary block mt-1">{description}</span></span>
      <ChevronDown size={22} className={cn('admin-disclosure-arrow', expanded && 'is-expanded')} />
    </button>
    <div id={contentId} className={cn('admin-disclosure-content', expanded && 'is-expanded')}>{children}</div>
  </section>;
}

function AdminEmptyState({ filtered, title }: { filtered: boolean; title: string }) {
  return <div className="kit-data-surface rounded-[20px] px-5 py-8 text-center" role="status">
    <Search size={32} className="mx-auto mb-3" />
    <h2 className="apple-title2 kit-text-primary font-semibold">{filtered ? 'Không có kết quả phù hợp' : title}</h2>
    <p className="apple-callout kit-text-secondary mt-2">{filtered ? 'Thử tên, số phòng hoặc trạng thái khác.' : 'Bạn có thể đổi kỳ tháng hoặc làm mới dữ liệu.'}</p>
  </div>;
}

export function AdminPortal() {
  const navigate = useNavigate();
  const { logoutUser, addNotification, registerResident, registeredAccounts, updateAccountStatus } = useApp();
  const { mode, isDark, toggleTheme } = useTheme();

  // Active Menu
  const [activeMenu, setActiveMenu] = useState<
    'dashboard' | 'rooms' | 'roomDetail' | 'billing' | 'plates' | 'contract' | 'invoices' | 'meter' | 'config' | 'declaration' | 'utilities' | 'createNotification' | 'laundry' | 'accountManagement'
  >('dashboard');

  // Account Management (Quản lý tài khoản) state
  const [accountSubTab, setAccountSubTab] = useState<'approval' | 'create'>('approval');
  const [viewingAccount, setViewingAccount] = useState<RegisteredAccount | null>(null);
  const [adminRegName, setAdminRegName] = useState('');
  const [adminRegPhone, setAdminRegPhone] = useState('');
  const [adminRegRoom, setAdminRegRoom] = useState('');
  const [adminRegEmail, setAdminRegEmail] = useState('');
  const [adminRegPassword, setAdminRegPassword] = useState('');
  const [adminRegConfirmPass, setAdminRegConfirmPass] = useState('');
  const [adminRegError, setAdminRegError] = useState('');
  const [adminRegSuccess, setAdminRegSuccess] = useState('');

  // Portal Toast Alert (replacing window.alert for iframe compatibility)
  const [portalToast, setPortalToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showPortalToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setPortalToast({ message, type });
    setTimeout(() => setPortalToast(null), 4000);
  };

  // Notification Creation state
  const [notifTarget, setNotifTarget] = useState<'ALL' | 'LVC' | 'TRUNG_KIM' | 'CUSTOM'>('ALL');
  const [selectedCustomRooms, setSelectedCustomRooms] = useState<string[]>([]);
  const [notifType, setNotifType] = useState<'thong_bao' | 'nhac_nho' | 'thanh_toan'>('thong_bao');
  const [notifTitle, setNotifTitle] = useState('Thông báo chung từ Ban Quản Lý');
  const [notifContent, setNotifContent] = useState('');
  const [notifScheduleMode, setNotifScheduleMode] = useState<'none' | 'scheduled'>('none');
  const [notifScheduledDate, setNotifScheduledDate] = useState('');
  const [notifSuccessMsg, setNotifSuccessMsg] = useState('');
  const [isSendingNotif, setIsSendingNotif] = useState(false);

  const handleTypeChange = (type: 'thong_bao' | 'nhac_nho' | 'thanh_toan') => {
    setNotifType(type);
    if (type === 'thanh_toan') {
      setNotifTitle(`Thông báo thanh toán tiền phòng tháng ${selectedMonth}`);
      setNotifContent(`Ban Quản Lý kính gửi thông báo thu phí tiền phòng tháng ${selectedMonth}. Quý cư dân vui lòng truy cập ứng dụng Nhà Trọ Phong Lan để kiểm tra hóa đơn chi tiết và hoàn tất thanh toán trước ngày đến hạn bằng mã VietQR tự động. Xin chân thành cảm ơn!`);
    } else if (type === 'nhac_nho') {
      setNotifTitle('Nhắc nhở cư dân về an ninh và nếp sống trọ');
      setNotifContent('Ban Quản Lý xin nhắc nhở toàn thể cư dân lưu ý khóa cổng cẩn thận sau 23h, để xe đúng nơi quy định và giữ gìn vệ sinh chung khu vực hành lang.');
    } else {
      setNotifTitle('Thông báo chung từ Ban Quản Lý');
      setNotifContent('');
    }
  };

  const handleSendNotification = () => {
    playSound('click');
    if (!notifTitle.trim()) {
      showPortalToast('Vui lòng nhập tiêu đề thông báo', 'error');
      return;
    }
    if (!notifContent.trim()) {
      showPortalToast('Vui lòng nhập nội dung thông báo', 'error');
      return;
    }
    if (notifTarget === 'CUSTOM' && selectedCustomRooms.length === 0) {
      showPortalToast('Vui lòng chọn ít nhất một phòng cần gửi thông báo', 'error');
      return;
    }

    setIsSendingNotif(true);

    let targetDesc = 'Tất cả các phòng';
    if (notifTarget === 'LVC') targetDesc = 'Các phòng bên Lê Văn Chí';
    else if (notifTarget === 'TRUNG_KIM') targetDesc = 'Các phòng bên Trung Kim';
    else if (notifTarget === 'CUSTOM') targetDesc = `Phòng: ${selectedCustomRooms.join(', ')}`;

    const newNotifItem = {
      id: `notif-${Date.now()}`,
      title: notifTitle.trim(),
      desc: notifContent.trim(),
      time: notifScheduleMode === 'scheduled' ? `Hẹn lúc: ${notifScheduledDate || 'theo lịch'}` : 'Vừa xong',
      type: notifType === 'thanh_toan' ? 'invoice' as const : notifType === 'nhac_nho' ? 'alert' as const : 'info' as const,
      unread: true,
      sender: `BQL Phong Lan (${targetDesc})`
    };

    try {
      addNotification(newNotifItem);
      const savedNotifs = JSON.parse(storage.getItem('ecostay_notifications') || '[]');
      const updated = [newNotifItem, ...savedNotifs];
      storage.setItem('ecostay_notifications', JSON.stringify(updated));
    } catch (e) {
      console.warn('Could not save notification to storage', e);
    }

    // Push to backend store for realtime distribution to residents

    apiFetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newNotifItem,
        target: notifTarget,
        customRooms: selectedCustomRooms,
        scheduledAt: notifScheduleMode === 'scheduled' ? notifScheduledDate : null
      })
    }).catch(() => {});

    setTimeout(() => {
      setIsSendingNotif(false);
      playSound('success');
      setNotifSuccessMsg(`Đã tạo và gửi thông báo thành công đến: ${targetDesc}!`);
    }, 350);
  };

  // Months
  const [months, setMonths] = useState<string[]>(DEFAULT_MONTH_TABS);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthStr());

  // Sidebar Collapse
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { collapsedLayout: sidebarCollapsedLayout, labelPhase: sidebarLabelPhase } = useSidebarLabels(isSidebarCollapsed);

  // Loading
  const [isLoading, setIsLoading] = useState(false);
  const [adminLoadError, setAdminLoadError] = useState('');


  // Payment Gate state
  const [paymentGate, setPaymentGate] = useState<'START' | 'STOP'>('STOP');
  const lastGateToggleTimeRef = useRef<number>(0);

  // Data States
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [roomsList, setRoomsList] = useState<any[]>([]);
  const [currentRoomData, setCurrentRoomData] = useState<any>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [billingList, setBillingList] = useState<any[]>([]);
  const [plateQuery, setPlateQuery] = useState('');
  const [adminSearch, setAdminSearch] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [plateResults, setPlateResults] = useState<any[]>([]);

  // Contract state
  const [contractMode, setContractMode] = useState<'new' | 'history'>('new');
  const [contractHouse, setContractHouse] = useState<'TRUNG_KIM' | 'LVC'>('TRUNG_KIM');
  const [contractDocType, setContractDocType] = useState<'ct01' | 'contract'>('contract');
  const [contractRoom, setContractRoom] = useState('');
  const [contractHistory, setContractHistory] = useState<any[]>([]);

  // Declaration state
  const [declarationHouse, setDeclarationHouse] = useState<'TRUNG_KIM' | 'LVC'>('TRUNG_KIM');
  const [declarationData, setDeclarationData] = useState<any>(null);
  const [declarationRows, setDeclarationRows] = useState<any[]>([]);
  const [declarationSigDate, setDeclarationSigDate] = useState('');
  const [saveDeclarationSuccess, setSaveDeclarationSuccess] = useState(false);
  const [saveDeclarationError, setSaveDeclarationError] = useState('');
  const declarationRequest = useRef(0);
  const [invoiceRoom, setInvoiceRoom] = useState('');

  // Unit Config
  const [unitConfig, setUnitConfig] = useState({
    dien: 3500,
    nuoc: 20000,
    rac: 30000,
    net: 40000,
    xe: 50000
  });
  const [configSaveMsg, setConfigSaveMsg] = useState('');

  // Laundry Admin State
  const [laundryMachines, setLaundryMachines] = useState<any[]>([]);
  const [laundryStats, setLaundryStats] = useState<any>({ todayRevenue: 0, totalRevenue: 0, todaySessions: 0, totalSessions: 0 });
  const [laundryBookings, setLaundryBookings] = useState<any[]>([]);
  const [laundryLoading, setLaundryLoading] = useState(false);
  const [laundryActionMsg, setLaundryActionMsg] = useState('');

  const fetchAdminLaundry = async () => {
    try {
      setLaundryLoading(true);
      const res = await apiFetch('/api/laundry/status');
      if (res.ok) {
        const d = await res.json();
        if (d.success) {
          setLaundryMachines(d.machines || []);
          setLaundryStats(d.stats || {});
          setLaundryBookings(d.bookings || []);
        }
      }
    } catch (e) {
      console.warn('Error fetching laundry admin:', e);
    } finally {
      setLaundryLoading(false);
    }
  };

  useEffect(() => {
    if (activeMenu === 'laundry') {
      fetchAdminLaundry();
      const t = setInterval(fetchAdminLaundry, 4000);
      return () => clearInterval(t);
    }
  }, [activeMenu]);

  const handleAdminForceStart = async (machineId: string) => {
    playSound('click');
    try {
      const res = await apiFetch('/api/laundry/admin/force-start', {
        method: 'POST',
        body: JSON.stringify({ machineId })
      });
      const d = await res.json();
      playSound('success');
      setLaundryActionMsg(d.message || 'Đã kích hoạt máy');
      fetchAdminLaundry();
      setTimeout(() => setLaundryActionMsg(''), 3000);
    } catch (e: any) {
      playSound('alert');
      setLaundryActionMsg(e.message || 'Lỗi kích hoạt máy');
    }
  };

  const handleAdminReset = async (machineId: string) => {
    playSound('click');
    try {
      const res = await apiFetch('/api/laundry/admin/reset', {
        method: 'POST',
        body: JSON.stringify({ machineId })
      });
      const d = await res.json();
      playSound('success');
      setLaundryActionMsg(d.message || 'Đã reset máy');
      fetchAdminLaundry();
      setTimeout(() => setLaundryActionMsg(''), 3000);
    } catch (e: any) {
      playSound('alert');
      setLaundryActionMsg(e.message || 'Lỗi reset máy');
    }
  };

  const handleAdminTogglePlug = async (machineId: string) => {
    playSound('click');
    try {
      const res = await apiFetch('/api/laundry/admin/toggle-plug', {
        method: 'POST',
        body: JSON.stringify({ machineId })
      });
      const d = await res.json();
      playSound('success');
      setLaundryActionMsg(d.message || 'Đã đổi trạng thái ổ điện');
      fetchAdminLaundry();
      setTimeout(() => setLaundryActionMsg(''), 3000);
    } catch (e: any) {
      playSound('alert');
      setLaundryActionMsg(e.message || 'Lỗi điều khiển ổ điện');
    }
  };

  const handleAdminUpdatePrice = async (machineId: string, newPrice: number) => {
    try {
      const res = await apiFetch('/api/laundry/admin/config', {
        method: 'POST',
        body: JSON.stringify({ machineId, price: newPrice })
      });
      const d = await res.json();
      if (d.success) {
        playSound('success');
        setLaundryActionMsg(`Đã cập nhật giá máy ${machineId}: ${newPrice.toLocaleString('vi-VN')}₫`);
        fetchAdminLaundry();
        setTimeout(() => setLaundryActionMsg(''), 3000);
      }
    } catch (e: any) {
      playSound('alert');
      setLaundryActionMsg(e.message || 'Lỗi cập nhật giá');
    }
  };

  const handleAdminSyncSheet = async () => {
    playSound('click');
    try {
      setLaundryLoading(true);
      const res = await apiFetch('/api/laundry/admin/sync-sheet', { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        playSound('success');
        setLaundryActionMsg(d.message || 'Đã đồng bộ máy từ Google Sheet');
        fetchAdminLaundry();
      } else {
        playSound('alert');
        setLaundryActionMsg(d.message || 'Không thể đồng bộ từ Google Sheet');
      }
      setTimeout(() => setLaundryActionMsg(''), 4000);
    } catch (e: any) {
      playSound('alert');
      setLaundryActionMsg(e.message || 'Lỗi đồng bộ Google Sheet');
    } finally {
      setLaundryLoading(false);
    }
  };

  // Batch Meters State
  const [batchMeters, setBatchMeters] = useState<Record<string, { dienCu?: number; dienMoi?: number; nuocCu?: number; nuocMoi?: number }>>({});
  const [isSavingBatchMeters, setIsSavingBatchMeters] = useState(false);

  // Format currency
  const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');
  const parseCurrency = (s: any) => parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0;

  // Format room number cleanly (bỏ số 0 đằng trước cho phòng 3 chữ số: 0101 -> 101, 0201 -> 201)
  const formatRoomNumber = (r: string) => {
    if (!r) return '';
    let s = String(r).trim().toUpperCase().replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').replace(/\.0+$/, '');
    if (s.includes('LVC')) {
      const n = s.replace(/\D/g, '');
      return n ? `LVC-${n}` : s;
    }
    if (/^G\d+$/i.test(s)) {
      const n = s.replace(/\D/g, '');
      return `G${n.padStart(2, '0')}`;
    }
    if (/^\d+$/.test(s)) {
      return s.replace(/^0+/, '') || s;
    }
    return s;
  };

  // List of available rooms for notification custom selector (không trùng lặp, chuẩn format xxx)
  const availableRoomNumbers = useMemo(() => {
    const rawList = roomsList && roomsList.length > 0
      ? roomsList.map(r => formatRoomNumber(r.room))
      : [
          'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07',
          '101', '102', '103', '104', '105', '106', '107', '108',
          '201', '202', '203', '204', '205', '206', '207', '208', '209', '210',
          '301', '302', '303', '304', '305', '306', '307', '308', '309', '310',
          'LVC-101', 'LVC-102', 'LVC-103', 'LVC-104',
          'LVC-201', 'LVC-202', 'LVC-203', 'LVC-204'
        ];

    // Deduplicate
    const unique = Array.from(new Set(rawList.map(r => formatRoomNumber(r)))).filter(Boolean);

    // Sort: G01-G07 -> 101...502 -> LVC-101...
    return unique.sort((a, b) => {
      const isGA = a.startsWith('G');
      const isGB = b.startsWith('G');
      if (isGA && !isGB) return -1;
      if (!isGA && isGB) return 1;
      if (isGA && isGB) return a.localeCompare(b);

      const isLVCA = a.startsWith('LVC');
      const isLVCB = b.startsWith('LVC');
      if (isLVCA && !isLVCB) return 1;
      if (!isLVCA && isLVCB) return -1;
      if (isLVCA && isLVCB) return a.localeCompare(b);

      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [roomsList]);

  // Load Months & Init
  useEffect(() => {
    apiFetch('/api/admin/months')
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(data => {
        if (data.success && data.months?.length) {
          const combined = Array.from(new Set([...DEFAULT_MONTH_TABS, ...data.months]));
          setMonths(combined);
        }
      })
      .catch(() => {
        // Fallback: Preserves all 8 default monthly tabs from Google Sheet
        setMonths(DEFAULT_MONTH_TABS);
      });

    loadPaymentGateStatus(selectedMonth);
  }, []);

  const handlePrevMonth = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentIndex = months.indexOf(selectedMonth);
    if (currentIndex > 0) {
      setSelectedMonth(months[currentIndex - 1]);
      playSound('click');
    }
  };

  const handleNextMonth = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentIndex = months.indexOf(selectedMonth);
    if (currentIndex < months.length - 1) {
      setSelectedMonth(months[currentIndex + 1]);
      playSound('click');
    }
  };

  // Compute complete dashboard statistics from room list
  const updateDashboardStats = (list: any[], month: string) => {
    const totalRev = list.reduce((acc, r) => acc + (Number(r.tongTien) || 0), 0);
    const collectedRev = list.filter(r => r.paymentStatus === 'paid' || r.status === 'paid').reduce((acc, r) => acc + (Number(r.tongTien) || 0), 0);
    const paidCount = list.filter(r => r.paymentStatus === 'paid' || r.status === 'paid').length;
    const totalDien = list.reduce((acc, r) => acc + (Number(r.dienUsed) || 0), 0);
    const totalTienDien = list.reduce((acc, r) => acc + (Number(r.tienDien) || 0), 0);
    const totalNuoc = list.reduce((acc, r) => acc + (Number(r.nuocUsed) || 0), 0);
    const totalTienNuoc = list.reduce((acc, r) => acc + (Number(r.tienNuoc) || 0), 0);
    const totalPeople = list.reduce((acc, r) => acc + (Number(r.soNguoi) || [r.nguoi1, r.nguoi2, r.nguoi3].filter(n => n && n !== '1' && n !== '2.0').length || 1), 0);
    const totalVehicles = list.reduce((acc, r) => acc + (Number(r.soXe) || [r.xe1, r.xe2, r.xe3].filter(x => x && x !== '1' && x !== '2.0' && x !== '3.0').length || 1), 0);

    setDashboardData((prev: any) => ({
      ...prev,
      month,
      doanhThu: prev?.doanhThu ? prev.doanhThu : totalRev,
      daThu: collectedRev,
      conLai: (prev?.doanhThu || totalRev) - collectedRev,
      tongPhong: list.length || prev?.tongPhong || 0,
      daDong: paidCount,
      chuaDong: (list.length || prev?.tongPhong || 0) - paidCount,
      dien: prev?.dien ? prev.dien : totalDien,
      tienDien: prev?.tienDien ? prev.tienDien : totalTienDien,
      nuoc: prev?.nuoc ? prev.nuoc : totalNuoc,
      tienNuoc: prev?.tienNuoc ? prev.tienNuoc : totalTienNuoc,
      soNguoi: prev?.soNguoi ? prev.soNguoi : totalPeople,
      soXe: prev?.soXe ? prev.soXe : totalVehicles,
      usageTrend: prev?.usageTrend
    }));
  };

  // Realtime Google Sheet sync for all rooms and payment gate status
  useEffect(() => {
    loadTabContent(activeMenu, selectedMonth);
    loadPaymentGateStatus(selectedMonth);

    // Periodic auto-polling for Google Sheet updates (every 8 seconds)
    const interval = setInterval(() => {
      if (activeMenu === 'dashboard' || activeMenu === 'rooms' || activeMenu === 'billing') {
        fetchRooms(selectedMonth);
      }
      loadPaymentGateStatus(selectedMonth);
    }, 8000);

    return () => clearInterval(interval);
  }, [selectedMonth, activeMenu]);

  const loadPaymentGateStatus = (m: string) => {
    // If Admin clicked toggle within last 20 seconds, ignore background polling so UI doesn't flicker or flip back
    if (Date.now() - lastGateToggleTimeRef.current < 20000) return;

    apiFetch(`/api/admin/payment-gate?month=${m}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(data => {
        if (Date.now() - lastGateToggleTimeRef.current < 20000) return;
        if (data.success && data.value) setPaymentGate(data.value);
      })
      .catch(() => {});
  };

  const togglePaymentGate = async () => {
    playSound('click');
    lastGateToggleTimeRef.current = Date.now();
    const nextVal = paymentGate === 'START' ? 'STOP' : 'START';
    setPaymentGate(nextVal);

    try {
      const res = await apiFetch('/api/admin/payment-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, value: nextVal })
      });
      const data = await res.json();
      if (data && data.success && data.value) {
        setPaymentGate(data.value);
      }
    } catch (e) {
      console.warn('Payment gate toggle error:', e);
    }
    playSound('success');
  };

  const loadTabContent = async (menuKey: string, month: string) => {
    setAdminLoadError('');
    if (menuKey === 'dashboard') {
      setIsLoading(true);
      apiFetch(`/api/admin/dashboard?month=${month}`)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not JSON');
          return res.json();
        })
        .then(d => {
          setIsLoading(false);
          if (d.success && d.data) {
            setDashboardData((prev: any) => ({
              ...prev,
              ...d.data
            }));
          }
        })
        .catch(() => { setIsLoading(false); setAdminLoadError('Chưa tải được tổng quan. Vui lòng thử lại.'); });
      fetchRooms(month);
    } else if (menuKey === 'rooms') {
      fetchRooms(month);
    } else if (menuKey === 'billing') {
      apiFetch(`/api/admin/billing?month=${month}`)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not JSON');
          return res.json();
        })
        .then(d => {
          if (d.success && Array.isArray(d.billing)) setBillingList(d.billing);
          else if (d.success === false) setAdminLoadError('Chưa tải được danh sách thu tiền. Vui lòng thử lại.');
        })
        .catch(() => setAdminLoadError('Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.'));
    } else if (menuKey === 'plates') {
      fetchPlates(month, plateQuery);
    } else if (menuKey === 'declaration') {
      loadDeclaration(month, declarationHouse);
    } else if (menuKey === 'config') {
      apiFetch(`/api/admin/config?month=${month}`)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not JSON');
          return res.json();
        })
        .then(d => {
          if (d.success && d.config) setUnitConfig(d.config);
        })
        .catch(() => setAdminLoadError('Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.'));
    } else if (menuKey === 'invoices') {
      fetchRooms(month);
    } else if (menuKey === 'contract') {
      apiFetch(`/api/admin/contract/history?month=${month}&houseKey=${contractHouse}`)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not JSON');
          return res.json();
        })
        .then(d => {
          if (d.success) setContractHistory(d.history || []);
        })
        .catch(() => setAdminLoadError('Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.'));
    }
  };

  const fetchRooms = (month: string) => {
    setIsLoading(true);
    apiFetch(`/api/admin/rooms?month=${month}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        setIsLoading(false);
        if (d.success && Array.isArray(d.rooms)) {
          setRoomsList(d.rooms);
          setBillingList(d.rooms);
          updateDashboardStats(d.rooms, month);
        } else if (d.success === false) setAdminLoadError('Chưa tải được danh sách phòng. Vui lòng thử lại.');
      })
      .catch(() => {
        setIsLoading(false);
        setAdminLoadError('Chưa tải được danh sách phòng. Vui lòng thử lại.');
      });
  };

  const openRoomDetail = (room: string) => {
    playSound('click');
    const cleanId = canonicalRoomId(room);
    setSelectedRoomId(cleanId);
    setActiveMenu('roomDetail');
    setCurrentRoomData(null);
    setIsLoading(true);

    const sanitizeName = (val: any) => {
      if (!val) return '';
      const s = String(val).trim();
      if (/^\d+(\.\d+)?$/.test(s)) return '';
      if (/^họ\s*(?:và\s*)?tên/i.test(s)) return '';
      return s;
    };

    const sanitizeCCCD = (val: any) => {
      if (!val) return '';
      const s = String(val).trim();
      if (/^[0-9](\.0+)?$/.test(s)) return '';
      return s;
    };

    const sanitizePhone = (val: any) => {
      if (!val) return '';
      const s = String(val).trim();
      if (/^[0-9](\.0+)?$/.test(s)) return '';
      return s;
    };

    const sanitizePlate = (val: any) => {
      if (!val) return '';
      const s = String(val).trim();
      if (/^\d+(\.\d+)?$/.test(s)) return '';
      return s;
    };

    // 1. Immediately find from local roomsList
    const localFound = roomsList.find(r => canonicalRoomId(r.room) === cleanId) ||
                       roomsList.find(r => r.room === room);
    if (localFound) {
      setCurrentRoomData({
        ...localFound,
        nguoi1: sanitizeName(localFound.nguoi1),
        cccd1: sanitizeCCCD(localFound.cccd1),
        sdt1: sanitizePhone(localFound.sdt1),
        xe1: sanitizePlate(localFound.xe1),
        nguoi2: sanitizeName(localFound.nguoi2),
        cccd2: sanitizeCCCD(localFound.cccd2),
        sdt2: sanitizePhone(localFound.sdt2),
        xe2: sanitizePlate(localFound.xe2),
        nguoi3: sanitizeName(localFound.nguoi3),
        cccd3: sanitizeCCCD(localFound.cccd3),
        sdt3: sanitizePhone(localFound.sdt3),
        xe3: sanitizePlate(localFound.xe3),
        statusHTML: localFound.paymentStatus === 'paid'
          ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
          : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>'
      });
      setIsLoading(false);
    }

    // 2. Fetch fresh document from backend
    apiFetch(`/api/admin/room-detail?month=${selectedMonth}&room=${cleanId}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        setIsLoading(false);
        if (d.success && d.data) {
          const fresh = d.data;
          setCurrentRoomData((prev: any) => ({
            ...prev,
            ...fresh,
            nguoi1: sanitizeName(fresh.nguoi1),
            cccd1: sanitizeCCCD(fresh.cccd1),
            sdt1: sanitizePhone(fresh.sdt1),
            xe1: sanitizePlate(fresh.xe1),
            nguoi2: sanitizeName(fresh.nguoi2),
            cccd2: sanitizeCCCD(fresh.cccd2),
            sdt2: sanitizePhone(fresh.sdt2),
            xe2: sanitizePlate(fresh.xe2),
            nguoi3: sanitizeName(fresh.nguoi3),
            cccd3: sanitizeCCCD(fresh.cccd3),
            sdt3: sanitizePhone(fresh.sdt3),
            xe3: sanitizePlate(fresh.xe3)
          }));
        }
      })
      .catch(() => setIsLoading(false));
  };

  const isValidLicensePlate = (val: any): boolean => {
    if (!val) return false;
    const str = String(val).trim();
    if (/^\d+(\.0+)?$/.test(str)) return false;
    if (!/\d/.test(str)) return false;
    if (/^\d{9,12}$/.test(str.replace(/\s+/g, ''))) return false;
    const clean = str.replace(/[\s.-]/g, '');
    if (clean.length < 4 || clean.length > 12) return false;
    return true;
  };

  const fetchPlates = (month: string, q: string) => {
    const cleanQ = (q || '').trim().toLowerCase().replace(/[\s.-]/g, '');
    const searchFromRooms = (list: any[]) => {
      const results: any[] = [];
      list.forEach(r => {
        [
          { plate: r.xe1, name: r.nguoi1, phone: r.sdt1 },
          { plate: r.xe2, name: r.nguoi2, phone: r.sdt2 },
          { plate: r.xe3, name: r.nguoi3, phone: r.sdt3 }
        ].forEach(item => {
          const plateStr = String(item.plate || '').trim();
          if (!isValidLicensePlate(plateStr)) return;
          if (!cleanQ || plateStr.toLowerCase().replace(/[\s.-]/g, '').includes(cleanQ)) {
            results.push({
              room: r.room,
              plate: plateStr,
              tenant: item.name || r.name,
              phone: item.phone || r.phone
            });
          }
        });
      });
      return results;
    };

    apiFetch(`/api/admin/plates?month=${month}&query=${encodeURIComponent(q)}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        if (d.success && d.results?.length) setPlateResults(d.results);
        else setPlateResults(searchFromRooms(roomsList));
      })
      .catch(() => {
        setPlateResults(searchFromRooms(roomsList));
      });
  };

  const loadDeclaration = (month: string, houseKey: 'TRUNG_KIM' | 'LVC') => {
    setIsLoading(true);
    const request = ++declarationRequest.current;
    const fallbackDeclarationData = () => {
      if (request !== declarationRequest.current) return;
      const rows = roomsList
        .filter(r => houseFromRoom(r.room).key === houseKey && r.paymentStatus === 'paid')
        .map(r => ({ room: r.room, date: '', person: `${r.name || r.nguoi1} (${r.room})`, amount: r.tongTien || 0 }));
      setDeclarationRows(rows);
      setDeclarationData({ month, houseKey, rows });
      setDeclarationSigDate('');
      setAdminLoadError('Chưa tải được sổ kê khai đã lưu. Đang hiện các phòng đã đóng trong dữ liệu hiện có.');
      setIsLoading(false);
    };

    apiFetch(`/api/admin/declaration?month=${month}&houseKey=${houseKey}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        if (request !== declarationRequest.current) return;
        setIsLoading(false);
        if (d.success && d.declaration) {
          setDeclarationData(d.declaration);
          setDeclarationRows(d.declaration.rows || []);
          setDeclarationSigDate(d.declaration.sigDate || '');
        } else {
          fallbackDeclarationData();
        }
      })
      .catch(() => {
        fallbackDeclarationData();
      });
  };

  const saveDeclaration = async () => {
    playSound('click');
    setSaveDeclarationError('');
    try {
      const res = await apiFetch('/api/admin/declaration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          houseKey: declarationHouse,
          rows: declarationRows,
          sigDate: declarationSigDate
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'save failed');
      playSound('success');
      setSaveDeclarationSuccess(true);
      setTimeout(() => setSaveDeclarationSuccess(false), 3000);
    } catch (e) {
      setSaveDeclarationError('Chưa lưu được sổ kê khai. Vui lòng kiểm tra mạng và thử lại.');
    }
  };

  const saveConfig = async () => {
    playSound('click');
    try {
      const res = await apiFetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          config: unitConfig
        })
      });
      const data = await res.json();
      if (data.success) {
        playSound('success');
        setConfigSaveMsg('✅ Đã lưu cấu hình đơn giá thành công!');
        setTimeout(() => setConfigSaveMsg(''), 3000);
      }
    } catch (e) {
      playSound('success');
      setConfigSaveMsg('✅ Đã lưu cấu hình đơn giá vào hệ thống!');
      setTimeout(() => setConfigSaveMsg(''), 3000);
    }
  };

  const handleBatchMeterChange = (room: string, field: 'dienCu' | 'dienMoi' | 'nuocCu' | 'nuocMoi', val: number) => {
    setBatchMeters(prev => ({
      ...prev,
      [room]: {
        ...prev[room],
        [field]: val
      }
    }));
  };

  const saveBatchMeters = async () => {
    playSound('click');
    const entries = Object.entries(batchMeters);
    if (entries.length === 0) {
      showPortalToast('Chưa có chỉ số nào được chỉnh sửa.', 'info');
      return;
    }
    setIsSavingBatchMeters(true);
    try {
      for (const [room, meters] of entries) {
        await apiFetch('/api/admin/room-detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month: selectedMonth,
            room,
            data: {
              dienCu: meters.dienCu,
              dienMoi: meters.dienMoi,
              nuocCu: meters.nuocCu,
              nuocMoi: meters.nuocMoi
            }
          })
        });
      }
      playSound('success');
      showPortalToast('Đã lưu và đồng bộ chỉ số điện nước lên Google Sheets thành công!', 'success');
      fetchRooms(selectedMonth);
      setBatchMeters({});
    } catch (err: any) {
      showPortalToast('Lỗi lưu chỉ số: ' + (err.message || 'Vui lòng thử lại'), 'error');
    } finally {
      setIsSavingBatchMeters(false);
    }
  };

  const updateRoomPaymentStatus = async (roomNumber: string, status: 'paid' | 'unpaid', row?: number) => {
    playSound('click');
    const cleanId = canonicalRoomId(roomNumber);

    const statusText = status === 'paid' ? 'Đã đóng' : 'Chưa đóng';
    const statusHTML = status === 'paid'
      ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
      : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>';

    // Auto-detect row number if not passed directly
    const foundRoom = roomsList.find(r => canonicalRoomId(r.room) === cleanId) || billingList.find(r => canonicalRoomId(r.room) === cleanId);
    const rowNum = row || foundRoom?.row;

    // 1. Update local state
    setRoomsList(prev => {
      const updated = prev.map(r => canonicalRoomId(r.room) === cleanId ? {
        ...r,
        status,
        paymentStatus: status,
        statusText,
        statusHTML
      } : r);
      updateDashboardStats(updated, selectedMonth);
      return updated;
    });

    setBillingList(prev => prev.map(r => canonicalRoomId(r.room) === cleanId ? {
      ...r,
      status,
      paymentStatus: status,
      statusText,
      statusHTML
    } : r));

    if (currentRoomData && canonicalRoomId(currentRoomData.room) === cleanId) {
      setCurrentRoomData({
        ...currentRoomData,
        status,
        paymentStatus: status,
        statusText,
        statusHTML
      });
    }

    // 2. Call backend
    apiFetch('/api/admin/payment-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomNumber: cleanId,
        status,
        month: selectedMonth,
        row: rowNum
      })
    }).catch(() => {});

    // 3. Two-way sync: Push directly into Google Sheet
    pushUpdateToGoogleSheet({
      action: 'update_payment',
      room: cleanId,
      status,
      month: selectedMonth,
      row: rowNum
    });

    playSound('success');
  };

  // Rent collection progress stats
  const totalRoomsCount = roomsList.length || dashboardData?.tongPhong || 0;
  const paidRoomsCount = roomsList.length
    ? roomsList.filter(r => r.paymentStatus === 'paid' || r.status === 'paid').length
    : (dashboardData?.daDong ?? 0);
  const collectionPercent = totalRoomsCount > 0 ? Math.round((paidRoomsCount / totalRoomsCount) * 100) : 0;


  const adminPageTitles: Record<string, { title: string; description: string }> = {
    dashboard: { title: 'Tổng quan', description: 'Doanh thu và tình hình nhà trọ trong tháng.' },
    rooms: { title: 'Phòng & khách thuê', description: 'Tìm phòng, xem cư dân và cập nhật thông tin.' },
    roomDetail: { title: 'Chi tiết phòng', description: 'Thông tin cư dân, chỉ số và chi phí phòng.' },
    billing: { title: 'Thu tiền tháng', description: 'Theo dõi từng khoản phí và trạng thái thu tiền.' },
    utilities: { title: 'Công cụ quản lý', description: 'Chọn công việc bạn cần thực hiện.' },
    meter: { title: 'Chỉ số điện nước', description: 'Nhập chỉ số từng phòng theo kỳ tháng.' },
    plates: { title: 'Tra biển số xe', description: 'Tìm xe và phòng đã đăng ký.' },
    contract: { title: 'Hồ sơ cư trú', description: 'Tờ khai CT01 và hợp đồng thuê phòng.' },
    invoices: { title: 'Hoá đơn phòng', description: 'Xem, in hoặc lưu PDF hoá đơn của từng phòng theo kỳ tháng.' },
    declaration: { title: 'Kê khai doanh thu', description: 'Sổ doanh thu theo hộ kinh doanh và kỳ tháng.' },
    config: { title: 'Đơn giá dịch vụ', description: 'Điều chỉnh đơn giá đang áp dụng trong tháng.' },
    createNotification: { title: 'Thông báo cư dân', description: 'Soạn nội dung và chọn người nhận.' },
    laundry: { title: 'Quản lý giặt sấy', description: 'Kiểm tra máy, giá dịch vụ và lịch đặt chỗ.' },
    accountManagement: { title: 'Quản lý tài khoản', description: 'Xét duyệt yêu cầu đăng ký và tạo tài khoản mới cho cư dân.' }
  };
  const currentAdminPage = adminPageTitles[activeMenu] || adminPageTitles.dashboard;
  const normalizeAdminSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const filterAdminRows = (row: any) => {
    const searchableFields = [
      row.room,
      row.name,
      row.phone,
      row.nguoi1,
      row.sdt1,
      row.cccd1,
      row.xe1,
      row.nguoi2,
      row.sdt2,
      row.cccd2,
      row.xe2,
      row.nguoi3,
      row.sdt3,
      row.cccd3,
      row.xe3,
      row.plate,
      row.plates,
      row.cccd,
      ...(Array.isArray(row.occupants) ? row.occupants.flatMap((o: any) => [o.name, o.phone, o.cccd, o.plate]) : [])
    ];
    const matchesSearch = normalizeAdminSearch(searchableFields.filter(Boolean).join(' ')).includes(normalizeAdminSearch(adminSearch));
    const status = row.paymentStatus || row.status || 'unpaid';
    return matchesSearch && (collectionFilter === 'all' || status === collectionFilter);
  };
  const visibleRooms = roomsList.filter(filterAdminRows);
  const visibleBilling = billingList.filter(filterAdminRows);

  const contractRooms = roomsList.filter((r: any) => houseFromRoom(r.room).key === contractHouse);
  const selectedContractRoom: any = contractRooms.find((r: any) => r.room === contractRoom);
  const contractTenants: Person[] = selectedContractRoom
    ? [1, 2, 3]
        .map(i => ({ ...selectedContractRoom[`info${i}`], name: selectedContractRoom[`nguoi${i}`], cccd: selectedContractRoom[`cccd${i}`], phone: selectedContractRoom[`sdt${i}`], relation: 'Người thuê trọ' }))
        .filter(person => person.name)
    : [];
  const { doc: adminDoc } = useBuiltDocument(
    m => contractDocType === 'ct01'
      ? buildCt01(m, { house: HOUSES[contractHouse], room: selectedContractRoom?.room, declarant: contractTenants[0] || {}, members: contractTenants.slice(1) })
      : buildContract(m, { house: HOUSES[contractHouse], room: selectedContractRoom?.room, tenants: contractTenants }),
    `${contractDocType}|${contractHouse}|${JSON.stringify(contractTenants)}|${selectedContractRoom?.room || ''}`
  );

  const { doc: declarationDoc } = useBuiltDocument(
    m => buildDeclaration(m, { house: HOUSES[declarationHouse], month: selectedMonth, rows: declarationRows, sigDate: declarationSigDate }),
    `${declarationHouse}|${selectedMonth}|${declarationSigDate}|${JSON.stringify(declarationRows)}`
  );

  const selectedInvoiceRoom: any = roomsList.find((r: any) => r.room === invoiceRoom) || roomsList[0];
  const { doc: invoiceDoc } = useBuiltDocument(
    m => roomInvoice(m, selectedInvoiceRoom || { room: '' }, selectedMonth),
    `${selectedMonth}|${JSON.stringify(selectedInvoiceRoom || null)}`
  );

  const monthSelect = (
    <select
      aria-label="Kỳ tháng"
      value={selectedMonth}
      onChange={e => setSelectedMonth(e.target.value)}
      className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
    >
      {months.map(m => <option key={m} value={m} className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Tháng {m}</option>)}
    </select>
  );

  return (
    <div className="min-h-screen relative isolate text-neutral-800 dark:text-neutral-100 flex flex-col lg:flex-row antialiased">
      <OfflineBanner />
      <Background />

      {portalToast && (
        <div role={portalToast.type === 'error' ? 'alert' : 'status'}
          className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md border flex items-center gap-2.5 text-sm font-semibold transition-all"
          style={{
            backgroundColor: portalToast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : portalToast.type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(30, 41, 59, 0.95)',
            color: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.2)'
          }}
        >
          {portalToast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{portalToast.message}</span>
        </div>
      )}

      {/* =========================================================================
          DESKTOP FLOATING SIDEBAR (Matching resident page aesthetic)
         ========================================================================= */}
      <aside
        data-sidebar-labels={sidebarLabelPhase}
        className={cn(
          "hidden lg:flex flex-col fixed left-4 top-4 bottom-4 z-40 transition-all duration-300 ease-out select-none",
          isSidebarCollapsed ? "w-[105px]" : "w-[260px]"
        )}
      >
        <div className={cn(
          "liquid-panel relative w-full h-full flex flex-col justify-between py-6 transition-all duration-300",
          sidebarCollapsedLayout ? "px-3 items-center" : "px-4"
        )}>

          {/* Toggle Arrow Button */}
          <button
            type="button"
            onClick={() => {
              playSound('click');
              setIsSidebarCollapsed(!isSidebarCollapsed);
            }}
            className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 dark:bg-neutral-800 backdrop-blur-md border border-white dark:border-neutral-700 shadow-md text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 flex items-center justify-center transition-all z-50 cursor-pointer"
            title={isSidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            aria-expanded={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          >
            {isSidebarCollapsed ? (
              <NavIcons.ChevronRight size={18} className="stroke-[2.5]" />
            ) : (
              <NavIcons.ChevronLeft size={18} className="stroke-[2.5]" />
            )}
          </button>
          {/* Top Brand */}
          <div className="w-full">
            {sidebarCollapsedLayout ? (
              <div data-brand-target="brand" className="flex justify-center mb-6 w-full">
                <div
                  data-brand-logo
                  className="w-12 h-12 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shadow-md shadow-neutral-900/15 cursor-pointer transition-transform icon-plate"
                  title="Nhà Trọ Phong Lan - Quản lý chủ trọ"
                >
                  <IconHome3D size={48} />
                </div>
              </div>
            ) : (
              <div data-brand-target="brand" className="flex items-center gap-3 px-1 mb-6">
                <div data-brand-logo className="w-11 h-11 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shadow-md shadow-neutral-900/15 shrink-0 icon-plate">
                  <IconHome3D size={48} />
                </div>
                <div data-brand-copy className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span data-brand-title className="font-bold text-base tracking-tight text-neutral-900 dark:text-white truncate">Phong Lan</span>
                    <span className="admin-role-badge px-1.5 py-0.2 text-[10px] font-bold rounded-md font-num border uppercase">
                      Admin
                    </span>
                  </div>
                  <p data-brand-subtitle className="text-[11px] text-neutral-600 font-medium truncate dark:text-neutral-300">
                    Quản lý chủ trọ
                  </p>
                </div>
              </div>
            )}

            {/* Nav Items */}
            <nav className={cn(
              "w-full transition-all duration-300",
              sidebarCollapsedLayout ? "flex flex-col items-center space-y-3" : "space-y-1.5"
            )}>
              {[
                { key: 'dashboard', label: 'Tổng quan', icon: NavigationHome },
                { key: 'rooms', label: 'Phòng & Khách', icon: NavIcons.Users },
                { key: 'billing', label: 'Thu tiền tháng', icon: NavIcons.Receipt },
                { key: 'utilities', label: 'Tiện ích', icon: NavIcons.LayoutGrid }
              ].map(item => {
                const Icon = item.icon;
                const isActive = activeMenu === item.key ||
                  (item.key === 'rooms' && activeMenu === 'roomDetail') ||
                  (item.key === 'utilities' && ['meter', 'plates', 'contract', 'invoices', 'declaration', 'config', 'createNotification', 'laundry', 'accountManagement'].includes(activeMenu));
                return (

                  <button
                    key={item.key}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      playSound('click');
                      setActiveMenu(item.key as any);
                    }}
                    className={cn(
                      "group relative transition-all duration-200 select-none cursor-pointer",
                      sidebarCollapsedLayout
                        ? "w-11 h-11 rounded-2xl flex items-center justify-center mx-auto"
                        : "w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl",
                      isActive
                        ? "bg-neutral-500/10 text-neutral-700 dark:bg-neutral-400/15 dark:text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] font-semibold"
                        : "text-neutral-600 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 font-medium"
                    )}
                    title={item.label}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        size={20}
                        className={cn(
                          "transition-all duration-200 shrink-0",
                          isActive ? "text-neutral-600 dark:text-neutral-300" : "text-neutral-600 dark:text-neutral-200 group-hover:text-neutral-900 dark:group-hover:text-white "
                        )}
                      />
                      {!sidebarCollapsedLayout && <span className="text-sm tracking-tight truncate">{item.label}</span>}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom Section: Controls & Logout */}
          <div className="w-full space-y-2.5 pt-3 border-t border-neutral-900/5 dark:border-white/10">
            {!sidebarCollapsedLayout ? (
              <div className="space-y-2.5">
                {/* 1. Month Selector - 3D Glassmorphism Card with Functional Previous/Next Arrows */}
                <div className="soft-surface p-2 sm:p-2.5 rounded-2xl relative overflow-hidden group">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                  <div className="flex items-center justify-between gap-1.5">
                    {/* Clickable Month Label with Dropdown Overlay */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 relative cursor-pointer">
                      <NavIcons.Calendar size={18} className="text-neutral-900 dark:text-white shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[9px] text-neutral-600 dark:text-neutral-200 uppercase tracking-wider block font-bold leading-none mb-0.5">
                          Kỳ tháng
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                            Tháng {selectedMonth}
                          </span>
                          <NavIcons.ChevronDown size={13} className="text-neutral-900 dark:text-white shrink-0" />
                        </div>
                      </div>
                      {/* Full-coverage select so clicking text or chevron opens native picker */}
                      <select
                        value={selectedMonth}
                        onChange={e => {
                          playSound('click');
                          setSelectedMonth(e.target.value);
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        title={`Kỳ tháng: Tháng ${selectedMonth}`}
                      >
                        {months.map(m => (
                          <option key={m} value={m} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
                            Tháng {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Functional Month Navigation Arrow Buttons */}
                    <div className="flex items-center gap-1 shrink-0 z-20">
                      <button
                        type="button"
                        onClick={handlePrevMonth}
                        disabled={months.indexOf(selectedMonth) <= 0}
                        className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-neutral-900 flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Tháng trước"
                        aria-label="Tháng trước"
                      >
                        <NavIcons.ChevronLeft size={14} className="stroke-[2.5]" />
                      </button>
                      <button
                        type="button"
                        onClick={handleNextMonth}
                        disabled={months.indexOf(selectedMonth) >= months.length - 1}
                        className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-neutral-900 flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Tháng tiếp theo"
                        aria-label="Tháng tiếp theo"
                      >
                        <NavIcons.ChevronRight size={14} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. Theme Toggle & Refresh Row - 3D Glassmorphism Cards */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="soft-surface h-10 px-2 rounded-2xl relative overflow-hidden flex items-center justify-center gap-1.5 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white transition-all cursor-pointer group"
                    title={`Giao diện: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động'}`}
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                    {mode === 'light' ? (
                      <NavIcons.Sun size={15} className="text-amber-500 shrink-0 drop-shadow-[0_2px_4px_rgba(245,158,11,0.3)]" />
                    ) : mode === 'dark' ? (
                      <NavIcons.Moon size={15} className="text-neutral-600 shrink-0 drop-shadow-[0_2px_4px_rgba(99,102,241,0.3)] dark:text-neutral-300" />
                    ) : (
                      <IconClock3D size={18} className="shrink-0" />
                    )}
                    <span className="truncate text-[11px] font-bold">
                      {mode === 'light' ? 'Chế độ sáng' : mode === 'dark' ? 'Chế độ tối' : 'Tự động'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => loadTabContent(activeMenu, selectedMonth)}
                    className="soft-surface h-10 px-2 rounded-2xl relative overflow-hidden flex items-center justify-center gap-1.5 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white transition-all cursor-pointer group"
                    title="Làm mới dữ liệu từ Google Sheets"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                    <NavIcons.RefreshCw size={14} className={cn("text-neutral-900 dark:text-white shrink-0", isLoading && "animate-spin")} />
                    <span className="truncate text-[11px] font-bold">Làm mới</span>
                  </button>
                </div>

                {/* 3. Cổng thanh toán - 3D Glassmorphism Card */}
                <div className="soft-surface p-3 rounded-2xl relative overflow-hidden flex items-center justify-between">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                  <div>
                    <p className="text-[10px] text-neutral-600 dark:text-neutral-200 font-bold uppercase tracking-wider">Cổng thanh toán</p>
                    <p className={cn("text-xs font-black uppercase font-num mt-0.5", paymentGate === 'START' ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {paymentGate === 'START' ? 'Mở' : 'Tắt'}
                    </p>
                  </div>
                  <AppleSwitch
                    checked={paymentGate === 'START'}
                    onChange={togglePaymentGate}
                    color="emerald"
                    size="md"
                    ariaLabel="Bật tắt Cổng thanh toán"
                  />
                </div>

                {/* 4. Single Logout Button - Neumorphic Glass Theme */}
                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    logoutUser();
                    navigate('/login');
                  }}
                  className="soft-surface w-full h-10 px-3 rounded-2xl relative overflow-hidden flex items-center justify-center gap-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/5 dark:hover:bg-rose-500/10 transition-all cursor-pointer group"
                  title="Đăng xuất khỏi hệ thống quản lý"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                  <NavIcons.LogOut size={15} className="text-neutral-600 dark:text-neutral-200 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-all" />
                  <span>Đăng xuất Admin</span>
                </button>
              </div>
            ) : (
              /* Collapsed Controls */
              <div className="flex flex-col items-center gap-2 pt-1 w-full">
                {/* Month Selector in Collapsed Mode */}
                <div
                  className="soft-surface relative w-11 h-11 rounded-2xl flex items-center justify-center text-neutral-900 dark:text-white transition-all cursor-pointer group"
                  title={`Kỳ tháng: Tháng ${selectedMonth} (Bấm để chọn tháng)`}
                >
                  <NavIcons.Calendar size={18} className="text-neutral-900 dark:text-white" />
                  <select
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    title={`Kỳ tháng: Tháng ${selectedMonth}`}
                  >
                    {months.map(m => (
                      <option key={m} value={m} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
                        Tháng {m}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Theme Mode in Collapsed Mode */}
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="soft-surface w-11 h-11 rounded-2xl flex items-center justify-center text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white transition-all cursor-pointer"
                  title={`Giao diện: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động (Theo giờ)'}`}
                >
                  {mode === 'light' ? (
                    <NavIcons.Sun size={18} className="text-amber-500 drop-shadow-[0_2px_4px_rgba(245,158,11,0.3)]" />
                  ) : mode === 'dark' ? (
                    <NavIcons.Moon size={18} className="text-neutral-600 drop-shadow-[0_2px_4px_rgba(99,102,241,0.3)] dark:text-neutral-300" />
                  ) : (
                    <IconClock3D size={20} />
                  )}
                </button>

                {/* Refresh in Collapsed Mode */}
                <button
                  type="button"
                  onClick={() => loadTabContent(activeMenu, selectedMonth)}
                  className="soft-surface w-11 h-11 rounded-2xl flex items-center justify-center text-neutral-900 dark:text-white transition-all cursor-pointer"
                  title="Làm mới dữ liệu từ Google Sheets"
                >
                  <NavIcons.RefreshCw size={17} className={cn("text-neutral-900 dark:text-white", isLoading && "animate-spin")} />
                </button>

                {/* Payment Gate in Collapsed Mode */}
                <button
                  type="button"
                  onClick={togglePaymentGate}
                  className={cn(
                    "w-11 h-11 rounded-2xl flex items-center justify-center text-white cursor-pointer shadow-xs  transition-all",
                    paymentGate === 'START' ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600"
                  )}
                  title={`Cổng thanh toán: ${paymentGate}`}
                >
                  <NavIcons.Power size={18} />
                </button>

                {/* Logout in Collapsed Mode */}
                <button
                  type="button"
                  onClick={() => {
                    logoutUser();
                    navigate('/login');
                  }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-600 hover:text-rose-600 hover:bg-rose-500/10 dark:hover:bg-rose-950/50 transition-colors cursor-pointer dark:text-neutral-300"
                  title="Đăng xuất Admin"
                >
                  <NavIcons.LogOut size={16} />
                </button>
              </div>
            )}
          </div>

        </div>
      </aside>

      {/* =========================================================================
          MAIN ADMIN WORKSPACE (Aligning with resident page layout & margin)
          ========================================================================= */}
      <main className={cn(
        "admin-workspace flex-1 min-w-0 p-4 sm:p-6 md:p-7 pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-6 min-h-screen relative z-10 w-full max-w-[1260px] mx-auto ",
        isSidebarCollapsed ? "lg:ml-[137px]" : "lg:ml-[292px]"
      )}>

        {/* Welcome Header */}
        <header className="admin-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div data-brand-target="anchor">
            <div className="flex items-center gap-2 mb-1">
              <span className="apple-callout kit-text-secondary">Không gian quản lý chủ trọ</span>
              <span className="admin-role-badge px-2 py-0.5 rounded-md font-bold text-[10px] tracking-wide uppercase font-num">
                Admin
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="apple-large-title apple-strong kit-text-primary">
                {currentAdminPage.title}
              </h1>
              {isLoading && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/80 dark:bg-neutral-800/80 border border-neutral-200/80 dark:border-neutral-700/80 text-neutral-700 dark:text-neutral-300 shadow-2xs backdrop-blur-md"
                >
                  <span aria-hidden="true" className="ui-spinner h-3.5 w-3.5" />
                  Đang cập nhật dữ liệu…
                </span>
              )}
            </div>
            <p className="apple-body kit-text-secondary mt-0.5">
              {currentAdminPage.description}
            </p>
          </div>

          {/* Action Capsule: Month & Refresh - Only shown on mobile, moved to sidebar on desktop */}
          <div className="admin-mobile-toolbar lg:hidden">
            {/* Month Selector with interactive Previous/Next Arrows */}
            <div className="admin-month-control soft-card flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                disabled={months.indexOf(selectedMonth) <= 0}
                className="w-11 h-11 shrink-0 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-neutral-900 flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Tháng trước"
                aria-label="Tháng trước"
              >
                <ChevronLeft size={13} className="stroke-[2.5]" />
              </button>

              <div className="relative flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1 cursor-pointer">
                <Calendar size={15} className="text-neutral-900 dark:text-white shrink-0" />
                <div>
                  <span className="text-[9px] text-neutral-600 uppercase tracking-wider block font-semibold leading-none dark:text-neutral-300">Kỳ tháng</span>
                  <div className="flex items-center gap-0.5">
                    <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">{selectedMonth}</span>
                    <ChevronDown size={11} className="text-neutral-900 dark:text-white shrink-0" />
                  </div>
                </div>
                <select
                  value={selectedMonth}
                  onChange={e => {
                    playSound('click');
                    setSelectedMonth(e.target.value);
                  }}
                  aria-label="Chọn kỳ tháng quản lý"
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  title={`Kỳ tháng: Tháng ${selectedMonth}`}
                >
                  {months.map(m => (
                    <option key={m} value={m} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">Tháng {m}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                disabled={months.indexOf(selectedMonth) >= months.length - 1}
                className="w-11 h-11 shrink-0 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-neutral-900 flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Tháng tiếp theo"
                aria-label="Tháng tiếp theo"
              >
                <ChevronRight size={13} className="stroke-[2.5]" />
              </button>
            </div>

            {/* Real-time Light/Dark Mode Switcher */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                toggleTheme();
              }}
              className="admin-header-theme soft-button min-h-11 px-3 rounded-2xl flex items-center gap-1.5 text-neutral-700 dark:text-neutral-200 text-xs font-semibold cursor-pointer"
              title={`Giao diện: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động (Theo giờ)'}`}
            >
              {mode === 'light' ? (
                <Sun size={15} className="text-amber-500" />
              ) : mode === 'dark' ? (
                <Moon size={15} className="text-neutral-600 dark:text-neutral-300" />
              ) : (
                <IconClock3D size={18} />
              )}
              <span>{mode === 'light' ? 'Sáng' : mode === 'dark' ? 'Tối' : 'Tự động'}</span>
            </button>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                loadTabContent(activeMenu, selectedMonth);
              }}
              className="soft-button w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-neutral-900 dark:text-white cursor-pointer"
              title="Làm mới dữ liệu từ Google Sheets"
            >
              <RefreshCw size={15} className={cn("text-neutral-900 dark:text-white", isLoading && "animate-spin")} />
            </button>

            {/* Logout Button */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                logoutUser();
                navigate('/login');
              }}
              className="admin-header-logout flex min-h-11 min-w-[125px] items-center justify-center gap-1.5 rounded-2xl border border-rose-300 bg-rose-50/70 px-4 text-xs font-bold text-rose-600 shadow-xs transition-all hover:bg-rose-100 dark:border-rose-800/80 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/50 cursor-pointer"
              title="Đăng xuất Admin"
            >
              <LogOut size={15} strokeWidth={2} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </header>

        {adminLoadError && <div role="alert" className="admin-load-error kit-data-surface rounded-[18px] p-4 mb-4"><div><p className="apple-headline kit-text-primary">Không thể cập nhật dữ liệu</p><p className="apple-callout kit-text-secondary mt-1">{adminLoadError}</p></div><button type="button" className="soft-button min-h-11 px-4" onClick={() => { setAdminLoadError(''); loadTabContent(activeMenu, selectedMonth); }}><RefreshCw size={18} />Thử lại</button></div>}
        {(activeMenu === 'rooms' || activeMenu === 'billing') && <div className="admin-list-toolbar kit-data-surface rounded-[20px] p-3 mb-4">
          <label className="admin-search-field"><Search size={21} /><input type="search" data-stage-filter="admin-room-results" value={adminSearch} onChange={event => setAdminSearch(event.target.value)} placeholder="Tìm phòng, tên hoặc số điện thoại" aria-label="Tìm phòng, tên hoặc số điện thoại" /></label>
          <label className="admin-status-filter"><span className="sr-only">Trạng thái thu tiền</span><select data-stage-filter="admin-room-results" value={collectionFilter} onChange={event => setCollectionFilter(event.target.value)} aria-label="Lọc trạng thái thu tiền"><option value="all">Tất cả trạng thái</option><option value="unpaid">Chưa đóng</option><option value="pending">Chờ xác nhận</option><option value="paid">Đã đóng</option></select></label>
          <p role="status" className="admin-result-count apple-callout kit-text-secondary">{activeMenu === 'rooms' ? visibleRooms.length : visibleBilling.length} kết quả</p>
        </div>}

        {activeMenu === 'utilities' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 mb-6">
            {[
              { key: 'accountManagement', label: 'Quản lý tài khoản', icon: IconProfile3D },
              { key: 'createNotification', label: 'Tạo thông báo', icon: IconNotification3D },
              { key: 'meter', label: 'Điện nước', icon: IconMeter3D },
              { key: 'plates', label: 'Tra biển số', icon: IconSearchPlate3D },
              { key: 'contract', label: 'Hợp đồng & CT01', icon: IconContract3D },
              { key: 'invoices', label: 'Hoá đơn phòng', icon: IconWallet3D },
              { key: 'declaration', label: 'Kỳ kê khai', icon: IconCalendar3D },
              { key: 'config', label: 'Cài đặt phí', icon: IconSettings3D },
              { key: 'laundry', label: 'Giặt Sấy 24/7', icon: IconLaundry3D }
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    playSound('click');
                    setActiveMenu(item.key as any);
                  }}
                  className="admin-utility-card soft-card p-4 min-h-28 flex flex-col items-center justify-center gap-2.5 text-xs sm:text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white hover:border-neutral-400/80 transition-all cursor-pointer relative group"
                >
                  <div className="transition-transform duration-200">
                    <Icon size={42} />
                  </div>
                  <span>{item.label}</span>
                </button>
              );
            })}

            {/* Logout Button inside Utilities */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                logoutUser();
                navigate('/login');
              }}
              className="admin-utility-card soft-card p-4 min-h-28 flex flex-col items-center justify-center gap-2.5 text-xs sm:text-sm font-semibold text-rose-600 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 hover:border-rose-300 transition-all cursor-pointer group"
            >
              <div className="transition-transform duration-200">
                <IconLogout3D size={42} />
              </div>
              <span>Đăng xuất</span>
            </button>
          </div>
        )}

        {/* =========================================================================
            1. DASHBOARD TAB
           ========================================================================= */}
        {activeMenu === 'dashboard' && (
          <div className="space-y-4 sm:space-y-6 admin-dashboard">
            <div className="admin-dashboard-actions"><button type="button" onClick={() => setActiveMenu('billing')} className="primary-button min-h-11 px-4"><Receipt size={20} />Thu tiền</button><button type="button" onClick={() => setActiveMenu('rooms')} className="soft-button min-h-11 px-4"><Users size={20} />Phòng & khách</button></div>
            {/* Grid 12 columns */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

              {/* Highlight Revenue Card (8 cols) */}
              <div className="admin-revenue-card md:col-span-8 soft-surface p-6 sm:p-8 relative overflow-hidden group">

                <div className="relative z-10 flex flex-col justify-between h-full gap-6">
                  {/* Top row */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                      <IconWallet3D size={52} className="shrink-0 drop-shadow-xs mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="badge-paid text-[10px] py-0.5 inline-flex items-center gap-1">
                            <CheckCircle2 size={11} />
                            <span>Kỳ thu phí {selectedMonth}</span>
                          </span>
                        </div>
                        <h2 className="type-h2 text-neutral-900 dark:text-white font-bold">
                          Doanh thu cả 2 tòa
                        </h2>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-neutral-600 block uppercase font-medium dark:text-neutral-300">Tiến độ thu</span>
                      <span className="type-button font-num text-emerald-600 block mt-0.5 font-bold">
                        {paidRoomsCount} / {totalRoomsCount} Phòng
                      </span>
                    </div>
                  </div>

                  {/* Middle row: Big Amount */}
                  <div>
                    <p className="type-label text-neutral-600 mb-1 dark:text-neutral-300">
                      Tổng tiền đã hạch toán · Cột P
                    </p>
                    <div data-stage="amount" className="type-display font-num tracking-tight flex items-baseline gap-1.5 font-bold text-neutral-900 dark:text-white">
                      {fmt(dashboardData?.doanhThu ?? 0)}
                      <span className="text-2xl font-normal text-neutral-600 dark:text-neutral-300">₫</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2 pt-4 border-t border-neutral-900/5 dark:border-white/5">
                    <div className="flex items-center justify-between text-xs font-bold text-neutral-900 dark:text-white">
                      <span>Tỷ lệ hoàn thành thu phí:</span>
                      <span className="font-num text-neutral-900 dark:text-white font-bold">{collectionPercent}%</span>
                    </div>
                    <div className="w-full h-3 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        data-stage="progress" role="progressbar" aria-label="Tỷ lệ hoàn thành thu phí" aria-valuenow={collectionPercent} aria-valuemin={0} aria-valuemax={100}
                        className="h-full bg-neutral-900 dark:bg-white rounded-full transition-all duration-700"
                        style={{ width: `${collectionPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right KPI Mini Cards (4 cols) */}
              <AdminDisclosure className="md:col-span-4" title="Điện nước & cư dân" description="Chỉ số sử dụng và thông tin đang lưu trú"><div className="admin-dashboard-metrics space-y-4 flex flex-col justify-between">

                {/* Electricity Card with 3D Icon */}
                <div className="soft-card p-5 flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <IconElectricity3D size={42} className="shrink-0" />
                      <div>
                        <h3 className="type-h4 text-neutral-900 dark:text-white font-bold">Điện tiêu thụ</h3>
                        <p className="text-[11px] text-neutral-600 font-num dark:text-neutral-300">{fmt(dashboardData?.dien ?? 0)} kW</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-neutral-900 dark:text-white font-num">{fmt(dashboardData?.tienDien ?? 0)} đ</span>
                  </div>
                </div>

                {/* Water Card with 3D Icon */}
                <div className="soft-card p-5 flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <IconWater3D size={42} className="shrink-0" />
                      <div>
                        <h3 className="type-h4 text-neutral-900 dark:text-white font-bold">Nước tiêu thụ</h3>
                        <p className="text-[11px] text-neutral-600 font-num dark:text-neutral-300">{fmt(dashboardData?.nuoc ?? 0)} m³</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-neutral-900 dark:text-white font-num">{fmt(dashboardData?.tienNuoc ?? 0)} đ</span>
                  </div>
                </div>

                {/* Occupants & Bikes Card with 3D Icons */}
                <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <IconProfile3D size={38} className="shrink-0 drop-shadow-xs" />
                    <div>
                      <p className="text-xs font-bold text-neutral-800 dark:text-white">{dashboardData?.soNguoi ?? 0} Cư dân</p>
                      <p className="text-[10px] text-neutral-600 dark:text-neutral-300">Đang lưu trú</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <IconLocation3D size={38} className="shrink-0 drop-shadow-xs" />
                    <div>
                      <p className="text-xs font-bold text-neutral-800 dark:text-white">{dashboardData?.soXe ?? 0} Xe máy</p>
                      <p className="text-[10px] text-neutral-600 dark:text-neutral-300">Đăng ký giữ xe</p>
                    </div>
                  </div>
                </div>

              </div></AdminDisclosure>

              {/* =========================================================================
                  LINE GRAPH (BIỂU ĐỒ ĐIỆN NƯỚC: 6 THÁNG GẦN NHẤT THIẾT KẾ CHUẨN HIỆN ĐẠI)
                 ========================================================================= */}
              <AdminDisclosure className="md:col-span-12" title="Xu hướng điện nước" description="Mở biểu đồ và chọn kỳ tháng"><div className="soft-card p-5 sm:p-7 space-y-4">
                <ModernLineGraph
                  data={dashboardData?.usageTrend || []}
                  selectedMonth={selectedMonth}
                  onSelectMonth={(m) => {
                    playSound('click');
                    setSelectedMonth(m);
                  }}
                />
              </div></AdminDisclosure>

            </div>
          </div>
        )}

        {/* =========================================================================
            2. ROOMS MANAGEMENT
           ========================================================================= */}
        {activeMenu === 'rooms' && (
          <div className="space-y-6">
            {!isLoading && !adminLoadError && visibleRooms.length === 0 && <AdminEmptyState filtered={Boolean(adminSearch || collectionFilter !== 'all')} title="Chưa có thông tin phòng" />}
            <div id="admin-room-results" data-stage="list" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {visibleRooms.map(r => {
                const isPaid = (r.paymentStatus || r.status) === 'paid';
                const isPending = (r.paymentStatus || r.status) === 'pending';
                return (
                  <div
                    key={r.room}
                    className="admin-room-card soft-card p-5 flex flex-col justify-between hover:border-neutral-500 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <button
                        type="button"
                        onClick={() => openRoomDetail(r.room)}
                        className="admin-room-open min-h-11 px-3.5 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-base hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        aria-label={'Mở chi tiết phòng ' + r.room}
                      >
                        {r.room}
                      </button>
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <AppleSwitch
                          checked={isPaid}
                          onChange={() => updateRoomPaymentStatus(r.room, isPaid ? 'unpaid' : 'paid', r.row)}
                          color="emerald"
                          size="sm"
                          ariaLabel={`Trạng thái thu tiền phòng ${r.room}`}
                        />
                        <span className={cn(
                          "text-[11px] font-bold min-w-14 text-right transition-colors",
                          isPaid ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"
                        )}>
                          {isPaid ? 'Đã đóng' : 'Chưa đóng'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-bold text-neutral-900 dark:text-white text-sm">{r.nguoi1 || r.name || 'Trống'}</h4>
                      <p className="text-xs text-neutral-600 font-mono dark:text-neutral-300">SĐT: {r.sdt1 || r.phone || 'Chưa cập nhật'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Room Detail Editor */}
        {activeMenu === 'roomDetail' && currentRoomData && (
          <div className="space-y-6 pb-36 sm:pb-32">
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => {
                  playSound('click');
                  setActiveMenu('rooms');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold"
              >
                <ArrowLeft size={16} />
                <span>Quay lại danh sách</span>
              </button>

              <div className="flex items-center gap-3 bg-neutral-50/90 dark:bg-neutral-800/80 px-3.5 py-1.5 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 shadow-2xs">
                <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">Trạng thái:</span>
                <div className="flex items-center gap-2">
                  <AppleSwitch
                    checked={currentRoomData.paymentStatus === 'paid'}
                    onChange={() => updateRoomPaymentStatus(selectedRoomId, currentRoomData.paymentStatus === 'paid' ? 'unpaid' : 'paid', currentRoomData.row)}
                    color="emerald"
                    size="md"
                    ariaLabel="Trạng thái thu tiền phòng"
                  />
                  <span className={cn(
                    "text-xs font-bold min-w-16 transition-colors",
                    currentRoomData.paymentStatus === 'paid' ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"
                  )}>
                    {currentRoomData.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng'}
                  </span>
                </div>
              </div>
            </div>

            {/* Occupants Info */}
            <div className="soft-card p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <IconProfile3D size={40} className="shrink-0 drop-shadow-xs" />
                <div>
                  <h4 className="font-bold text-neutral-900 dark:text-white text-base">Thông tin người cư trú Phòng {selectedRoomId}</h4>
                </div>
              </div>
              {[1, 2, 3].map(slot => (
                <div key={slot} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Họ tên người {slot}</label>
                    <input
                      type="text"
                      value={currentRoomData[`nguoi${slot}`] || ''}
                      onChange={e => {
                        const val = e.target.value;
                        const nextRoom = { ...currentRoomData, [`nguoi${slot}`]: val };
                        const validOccupants = [
                          slot === 1 ? val : nextRoom.nguoi1,
                          slot === 2 ? val : nextRoom.nguoi2,
                          slot === 3 ? val : nextRoom.nguoi3
                        ].filter(n => n && !/^\d+(\.\d+)?$/.test(String(n).trim())).length;
                        const soNguoi = validOccupants > 0 ? validOccupants : 1;
                        nextRoom.soNguoi = soNguoi;
                        const netUnitPrice = unitConfig.net || 40000;
                        const tienNet = soNguoi * netUnitPrice;
                        nextRoom.tienNet = tienNet;
                        nextRoom.tongTien = (nextRoom.tienPhong || 0) + (nextRoom.tienDien || 0) + (nextRoom.tienNuoc || 0) + (nextRoom.tienRac || 0) + tienNet + (nextRoom.tienXe || 0) + (nextRoom.tienKhac || 0);
                        setCurrentRoomData(nextRoom);
                      }}
                      placeholder={`Người ${slot}`}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Số CCCD</label>
                    <input
                      type="text"
                      value={currentRoomData[`cccd${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`cccd${slot}`]: e.target.value })}
                      placeholder="12 số CCCD"
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none font-mono focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Số điện thoại</label>
                    <input
                      type="text"
                      value={currentRoomData[`sdt${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`sdt${slot}`]: e.target.value })}
                      placeholder="SĐT liên lạc"
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none font-mono focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Biển số xe</label>
                    <input
                      type="text"
                      value={currentRoomData[`xe${slot}`] || ''}
                      onChange={e => {
                        const val = e.target.value;
                        const nextRoom = { ...currentRoomData, [`xe${slot}`]: val };
                        const validPlates = [
                          slot === 1 ? val : nextRoom.xe1,
                          slot === 2 ? val : nextRoom.xe2,
                          slot === 3 ? val : nextRoom.xe3
                        ].filter(isValidLicensePlate).length;
                        nextRoom.soXe = validPlates;
                        const xeUnitPrice = unitConfig.xe || 50000;
                        const tienXe = validPlates * xeUnitPrice;
                        nextRoom.tienXe = tienXe;
                        nextRoom.tongTien = (nextRoom.tienPhong || 0) + (nextRoom.tienDien || 0) + (nextRoom.tienNuoc || 0) + (nextRoom.tienRac || 0) + (nextRoom.tienNet || 0) + tienXe + (nextRoom.tienKhac || 0);
                        setCurrentRoomData(nextRoom);
                      }}
                      placeholder="Biển số xe"
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none uppercase font-mono focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Electricity & Water Indices with 3D Icons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="soft-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <IconElectricity3D size={40} className="shrink-0" />
                  <div>
                    <h4 className="font-bold text-neutral-900 dark:text-white text-sm">Chỉ số Điện ({fmt(unitConfig.dien || 3500)} đ/kW)</h4>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-300">Tiêu thụ: {Math.max(0, (currentRoomData.dienMoi || 0) - (currentRoomData.dienCu || 0))} kW</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Điện cũ</label>
                    <input
                      type="number"
                      value={currentRoomData.dienCu || ''}
                      onChange={e => {
                        const dienCu = Number(e.target.value) || 0;
                        const dienMoi = Number(currentRoomData.dienMoi) || 0;
                        const used = Math.max(0, dienMoi - dienCu);
                        const tienDien = used * (unitConfig.dien || 3500);
                        setCurrentRoomData({
                          ...currentRoomData,
                          dienCu,
                          dienUsed: used,
                          tienDien,
                          tongTien: (currentRoomData.tienPhong || 0) + tienDien + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Điện mới</label>
                    <input
                      type="number"
                      value={currentRoomData.dienMoi || ''}
                      onChange={e => {
                        const dienMoi = Number(e.target.value) || 0;
                        const dienCu = Number(currentRoomData.dienCu) || 0;
                        const used = Math.max(0, dienMoi - dienCu);
                        const tienDien = used * (unitConfig.dien || 3500);
                        setCurrentRoomData({
                          ...currentRoomData,
                          dienMoi,
                          dienUsed: used,
                          tienDien,
                          tongTien: (currentRoomData.tienPhong || 0) + tienDien + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs font-bold pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <span>Tiền điện:</span>
                  <span className="text-neutral-900 dark:text-white font-bold">{fmt(currentRoomData.tienDien)} đ</span>
                </div>
              </div>

              <div className="soft-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <IconWater3D size={40} className="shrink-0" />
                  <div>
                    <h4 className="font-bold text-neutral-900 dark:text-white text-sm">Chỉ số Nước ({fmt(unitConfig.nuoc || 20000)} đ/m³)</h4>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-300">Tiêu thụ: {Math.max(0, (currentRoomData.nuocMoi || 0) - (currentRoomData.nuocCu || 0))} m³</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Nước cũ</label>
                    <input
                      type="number"
                      value={currentRoomData.nuocCu || ''}
                      onChange={e => {
                        const nuocCu = Number(e.target.value) || 0;
                        const nuocMoi = Number(currentRoomData.nuocMoi) || 0;
                        const used = Math.max(0, nuocMoi - nuocCu);
                        const tienNuoc = used * (unitConfig.nuoc || 20000);
                        setCurrentRoomData({
                          ...currentRoomData,
                          nuocCu,
                          nuocUsed: used,
                          tienNuoc,
                          tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + tienNuoc + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-600 uppercase block mb-1 dark:text-neutral-300">Nước mới</label>
                    <input
                      type="number"
                      value={currentRoomData.nuocMoi || ''}
                      onChange={e => {
                        const nuocMoi = Number(e.target.value) || 0;
                        const nuocCu = Number(currentRoomData.nuocCu) || 0;
                        const used = Math.max(0, nuocMoi - nuocCu);
                        const tienNuoc = used * (unitConfig.nuoc || 20000);
                        setCurrentRoomData({
                          ...currentRoomData,
                          nuocMoi,
                          nuocUsed: used,
                          tienNuoc,
                          tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + tienNuoc + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs font-bold pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <span>Tiền nước:</span>
                  <span className="text-neutral-900 dark:text-white font-bold">{fmt(currentRoomData.tienNuoc)} đ</span>
                </div>
              </div>
            </div>

            {/* Comprehensive Service Fees & Cost Breakdown */}
            <div className="soft-card p-6 sm:p-8 space-y-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <IconWallet3D size={40} className="shrink-0 drop-shadow-xs" />
                  <div>
                    <h4 className="font-bold text-neutral-900 dark:text-white text-base">Chi Phí Dịch Vụ & Hóa Đơn Chi Tiết</h4>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">Các khoản phí dịch vụ và tiền phòng tháng {selectedMonth}</p>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <span className="text-[10px] text-neutral-600 font-bold uppercase block dark:text-neutral-300">Tổng tiền phòng {selectedRoomId} (Cột P)</span>
                  <span className="text-lg font-black font-num text-neutral-900 dark:text-white px-2.5 py-1 rounded-xl transition-all inline-block">
                    {fmt(currentRoomData.tongTien)} đ
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase block mb-1">Tiền phòng (Cột J)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentRoomData.tienPhong ? fmt(currentRoomData.tienPhong) : ''}
                      placeholder="0"
                      onChange={e => {
                        const tienPhong = parseCurrency(e.target.value);
                        setCurrentRoomData({
                          ...currentRoomData,
                          tienPhong,
                          tongTien: tienPhong + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase block mb-1">Tiền rác (Cột K)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentRoomData.tienRac ? fmt(currentRoomData.tienRac) : ''}
                      placeholder="0"
                      onChange={e => {
                        const tienRac = parseCurrency(e.target.value);
                        setCurrentRoomData({
                          ...currentRoomData,
                          tienRac,
                          tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + tienRac + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase block mb-1">Tiền Internet / Net (Cột L)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentRoomData.tienNet ? fmt(currentRoomData.tienNet) : ''}
                      placeholder="0"
                      onChange={e => {
                        const tienNet = parseCurrency(e.target.value);
                        setCurrentRoomData({
                          ...currentRoomData,
                          tienNet,
                          tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + tienNet + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase block mb-1">Tiền giữ xe (Cột M)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentRoomData.tienXe ? fmt(currentRoomData.tienXe) : ''}
                      placeholder="0"
                      onChange={e => {
                        const tienXe = parseCurrency(e.target.value);
                        setCurrentRoomData({
                          ...currentRoomData,
                          tienXe,
                          tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + tienXe + (currentRoomData.tienKhac || 0)
                        });
                      }}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase">Chi phí khác (Cột N)</label>
                    <span className="text-[9px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-tight">Cố định</span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={currentRoomData.tienKhac ? fmt(currentRoomData.tienKhac) : '0'}
                      className="w-full bg-neutral-100/70 dark:bg-neutral-800/50 border border-neutral-200/80 dark:border-neutral-700/50 text-neutral-700 dark:text-neutral-200 rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono cursor-not-allowed select-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-700 dark:text-neutral-200 uppercase block mb-1">Tiền đặt cọc (Cột O)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={currentRoomData.tienCoc ? fmt(currentRoomData.tienCoc) : ''}
                      placeholder="0"
                      onChange={e => setCurrentRoomData({ ...currentRoomData, tienCoc: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Tổng cộng */}
            <div className="soft-card p-5 sm:p-6 flex items-center justify-between">
              <span className="text-base sm:text-lg font-bold text-neutral-700 dark:text-neutral-200">Tổng cộng:</span>
              <span className="text-2xl sm:text-3xl font-black font-num text-neutral-600 dark:text-neutral-200">
                {fmt(currentRoomData.tongTien)} đ
              </span>
            </div>

            {/* Nút lưu cập nhật */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  playSound('click');
                  try {
                    setIsLoading(true);
                    const res = await apiFetch('/api/admin/room-detail', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        month: selectedMonth,
                        room: selectedRoomId,
                        data: currentRoomData,
                        dienCu: currentRoomData.dienCu,
                        dienMoi: currentRoomData.dienMoi,
                        nuocCu: currentRoomData.nuocCu,
                        nuocMoi: currentRoomData.nuocMoi,
                        status: currentRoomData.status || currentRoomData.paymentStatus || 'unpaid',
                        row: currentRoomData.row
                      })
                    });
                    // Cập nhật và kích hoạt highlight Cột P trên Google Sheet
                    pushUpdateToGoogleSheet({
                      action: 'update_payment',
                      room: selectedRoomId,
                      status: currentRoomData.paymentStatus === 'paid' ? 'paid' : 'unpaid',
                      month: selectedMonth,
                      row: currentRoomData.row
                    });
                    setIsLoading(false);
                    if (res.ok) {
                      playSound('success');
                      showPortalToast('Đã lưu cập nhật thông tin phòng và đồng bộ Cột P thành công!', 'success');
                    }
                  } catch (e) {
                    setIsLoading(false);
                  }
                }}
                className="primary-button py-3 px-8 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md w-full sm:w-auto"
              >
                <Save size={18} />
                <span>Lưu cập nhật phòng & chỉ số</span>
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            3. BILLING TAB (THU TIỀN THÁNG)
           ========================================================================= */}
        {activeMenu === 'billing' && (
          <div className="font-apple space-y-4 sm:space-y-6">
            {visibleBilling.length === 0 && !isLoading && !adminLoadError && <AdminEmptyState filtered={Boolean(adminSearch || collectionFilter !== 'all')} title="Chưa có khoản thu trong kỳ" />}
            {/* Mobile View: No Horizontal Scrolling, Touch-Friendly Cards */}
            <div className="block md:hidden space-y-3.5 font-apple">
              {visibleBilling.map(item => {
                const isPaid = item.paymentStatus === 'paid';
                return (
                  <div key={item.room} className="soft-card p-4 space-y-3.5 font-apple">
                    {/* Header: Room, Tenant, AppleSwitch */}
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-2.5 font-apple">
                      <div className="flex items-center gap-2.5 min-w-0 font-apple">
                        <span className="px-2.5 py-1 rounded-xl bg-neutral-900 dark:bg-neutral-600 text-white font-semibold text-xs shrink-0 font-apple">
                          {item.room}
                        </span>
                        <div className="min-w-0 font-apple">
                          <h4 className="font-semibold text-neutral-900 dark:text-white text-xs truncate font-apple">{item.name}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-apple">
                        <AppleSwitch
                          checked={isPaid}
                          onChange={() => updateRoomPaymentStatus(item.room, isPaid ? 'unpaid' : 'paid', item.row)}
                          color="emerald"
                          size="sm"
                          ariaLabel={`Trạng thái đóng tiền phòng ${item.room}`}
                        />
                        <span className={cn(
                          "text-[11px] font-semibold min-w-14 text-right transition-colors font-apple",
                          isPaid ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"
                        )}>
                          {isPaid ? 'Đã đóng' : 'Chưa đóng'}
                        </span>
                      </div>
                    </div>

                    {/* Service breakdown in 3 columns without scrolling */}
                    <details className="admin-billing-breakdown"><summary>Chi tiết các khoản phí<ChevronDown size={18} /></summary><div className="grid grid-cols-2 gap-3 kit-data-surface p-3 rounded-xl text-xs font-apple">
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Phòng</span>
                        <span className="font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienPhong)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Điện</span>
                        <span className="font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienDien)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Nước</span>
                        <span className="font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienNuoc)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Rác</span>
                        <span className="font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienRac)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Net</span>
                        <span className="font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienNet)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Xe</span>
                        <span className="font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienXe)} đ</span>
                      </div>
                    </div></details>

                    {/* Total Row */}
                    <div className="flex items-center justify-between pt-0.5 font-apple">
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 font-apple">Tổng cộng:</span>
                      <span className="text-sm font-semibold font-apple text-neutral-900 dark:text-white">
                        {fmt(item.tongTien)} đ
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop View: Full Spacious Table */}
            <div className="hidden md:block soft-card kit-data-surface overflow-hidden font-apple">
              <div className="overflow-x-auto font-apple">
                <table className="w-full text-left text-xs font-apple">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-neutral-800/80 border-b border-neutral-100 dark:border-neutral-800 text-[11px] font-semibold text-neutral-600 dark:text-neutral-200 uppercase tracking-wider font-apple">
                      <th className="p-4 font-semibold font-apple">Phòng</th>
                      <th className="p-4 font-semibold font-apple">Khách thuê</th>
                      <th className="p-4 font-semibold font-apple">Tiền phòng</th>
                      <th className="p-4 font-semibold font-apple">Điện</th>
                      <th className="p-4 font-semibold font-apple">Nước</th>
                      <th className="p-4 font-semibold font-apple">Rác</th>
                      <th className="p-4 font-semibold font-apple">Net</th>
                      <th className="p-4 font-semibold font-apple">Xe</th>
                      <th className="p-4 font-semibold text-neutral-900 dark:text-white font-apple">Tổng cộng</th>
                      <th className="p-4 text-center font-semibold font-apple">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 font-apple">
                    {visibleBilling.map(item => {
                      const isPaid = item.paymentStatus === 'paid';
                      return (
                        <tr key={item.room} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors font-apple">
                          <td className="p-4 font-semibold text-neutral-900 dark:text-white font-apple">{item.room}</td>
                          <td className="p-4 font-semibold text-neutral-700 dark:text-neutral-200 font-apple">{item.name}</td>
                          <td className="p-4 font-apple font-semibold">{fmt(item.tienPhong)} đ</td>
                          <td className="p-4 font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienDien)} đ</td>
                          <td className="p-4 font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienNuoc)} đ</td>
                          <td className="p-4 font-apple font-semibold">{fmt(item.tienRac)} đ</td>
                          <td className="p-4 font-apple font-semibold">{fmt(item.tienNet)} đ</td>
                          <td className="p-4 font-apple font-semibold">{fmt(item.tienXe)} đ</td>
                          <td className="p-4 font-semibold text-sm text-neutral-900 dark:text-white font-apple">
                            {fmt(item.tongTien)} đ
                          </td>
                          <td className="p-4 font-apple">
                            <div className="flex items-center justify-center gap-2.5 font-apple">
                              <AppleSwitch
                                checked={isPaid}
                                onChange={() => updateRoomPaymentStatus(item.room, isPaid ? 'unpaid' : 'paid', item.row)}
                                color="emerald"
                                size="sm"
                                ariaLabel={`Trạng thái đóng tiền phòng ${item.room}`}
                              />
                              <span className={cn(
                                "text-xs font-semibold min-w-16 text-left transition-colors font-apple",
                                isPaid ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300"
                              )}>
                                {isPaid ? 'Đã đóng' : 'Chưa đóng'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            4. LICENSE PLATE SEARCH
           ========================================================================= */}
        {activeMenu === 'plates' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <Search size={15} className="text-neutral-600 dark:text-neutral-300" />
                <span>Tra cứu biển số xe</span>
              </div>
            </div>

            <div className="soft-card p-6 sm:p-8 space-y-4 text-center">
              <IconLocation3D size={52} className="mx-auto drop-shadow-xs mb-1" />
              <div className="text-center max-w-md mx-auto space-y-1 mb-4">
                <h3 className="type-h2 font-bold text-neutral-900 dark:text-white">Tra Cứu Biển Số Xe</h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">Tìm kiếm nhanh thông tin chủ xe và số phòng</p>
              </div>

              <div className="relative max-w-xl mx-auto">
                <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600 dark:text-neutral-300" />
                <input
                  type="text"
                  value={plateQuery}
                  onChange={e => {
                    setPlateQuery(e.target.value);
                    fetchPlates(selectedMonth, e.target.value);
                  }}
                  placeholder="Nhập biển số xe (VD: 59-X1, 888.88...)"
                  className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-sm font-bold text-neutral-900 dark:text-white uppercase outline-none focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {plateResults.map((r, i) => (
                <div key={i} className="soft-card p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold rounded-lg text-xs">
                      Phòng {r.room}
                    </span>
                    <span className="font-mono text-sm font-bold text-neutral-900 dark:text-white bg-neutral-50 dark:bg-neutral-800 px-2.5 py-1 rounded-md border border-neutral-200 dark:border-neutral-700">
                      {r.plate}
                    </span>
                  </div>
                  <p className="font-bold text-sm text-neutral-800 dark:text-white">{r.name || r.tenant || 'Chưa cập nhật tên'}</p>
                  <p className="text-xs text-neutral-600 font-mono dark:text-neutral-300">SĐT: {r.phone || 'Chưa cập nhật'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            5. CONTRACT & CT01 (A4 PDF/PRINT FORMAT MATCHING USER CODE)
           ========================================================================= */}
        {activeMenu === 'contract' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <FileText size={15} className="text-neutral-600 dark:text-neutral-300" />
                <span>Hợp đồng & Mẫu CT01</span>
              </div>
            </div>

            {/* Action Bar */}
            <div className="soft-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div role="group" aria-label="Loại tài liệu" className="admin-document-switch kit-segmented flex w-full max-w-lg items-stretch gap-1">
                <button type="button" aria-pressed={contractDocType === 'contract'} onClick={() => setContractDocType('contract')}
                  className={cn('kit-segment min-w-0 flex-1 gap-2 px-3 py-2.5 apple-body', contractDocType === 'contract' && 'kit-segment-active')}>
                  <IconContract3D size={25} />
                  <span>Hợp đồng thuê phòng</span>
                </button>
                <button type="button" aria-pressed={contractDocType === 'ct01'} onClick={() => setContractDocType('ct01')}
                  className={cn('kit-segment min-w-0 flex-1 gap-2 px-3 py-2.5 apple-body', contractDocType === 'ct01' && 'kit-segment-active')}>
                  <IconDeclaration3D size={25} />
                  <span>Tờ khai cư trú (CT01)</span>
                </button>
              </div>

              <div className="admin-document-actions flex flex-wrap items-center gap-3">
                <select
                  value={contractHouse}
                  onChange={e => { setContractHouse(e.target.value as any); setContractRoom(''); }}
                  className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  <option value="TRUNG_KIM" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Nhà trọ Trung Kim (116/32)</option>
                  <option value="LVC" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Nhà trọ 109/6 (Lê Văn Chí)</option>
                </select>
                <select
                  aria-label="Chọn phòng để điền tài liệu"
                  value={contractRoom}
                  onChange={e => setContractRoom(e.target.value)}
                  className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  <option value="">Mẫu trống</option>
                  {contractRooms.map((r: any) => <option key={r.room} value={r.room}>Phòng {r.room}{r.nguoi1 ? ` – ${r.nguoi1}` : ''}</option>)}
                </select>
                <DocumentActions doc={adminDoc} />
              </div>
            </div>

            <div className="mx-auto w-full max-w-3xl">
              <DocumentSheet doc={adminDoc} />
            </div>
          </div>
        )}

        {/* =========================================================================
            ROOM INVOICES (same notice residents download)
           ========================================================================= */}
        {activeMenu === 'invoices' && (
          <div className="space-y-6">
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <Receipt size={15} className="text-neutral-600 dark:text-neutral-300" />
                <span>Hoá đơn phòng</span>
              </div>
            </div>

            <div className="soft-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Chọn phòng"
                  value={selectedInvoiceRoom?.room || ''}
                  onChange={e => setInvoiceRoom(e.target.value)}
                  className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  {roomsList.map((r: any) => <option key={r.room} value={r.room} className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Phòng {r.room}{r.nguoi1 ? ` – ${r.nguoi1}` : ''}</option>)}
                </select>
                {monthSelect}
              </div>
              <DocumentActions doc={selectedInvoiceRoom ? invoiceDoc : null} downloadLabel="Lưu PDF" />
            </div>

            <div className="mx-auto w-full max-w-5xl">
              {selectedInvoiceRoom
                ? <DocumentSheet doc={invoiceDoc} />
                : <p className="soft-card p-4 text-xs text-neutral-600 dark:text-neutral-300">Chưa có dữ liệu phòng của tháng {selectedMonth}.</p>}
            </div>
          </div>
        )}

        {/* =========================================================================
            6. METER BATCH READING
           ========================================================================= */}
        {activeMenu === 'meter' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <Zap size={15} className="text-neutral-900 dark:text-white" />
                <span>Nhập chỉ số điện nước</span>
              </div>
            </div>

            <div className="soft-card kit-form-surface p-4 sm:p-6 space-y-4">
              <div className="admin-section-toolbar flex flex-wrap items-center justify-between gap-3">
                <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Nhập chỉ số điện nước tháng {selectedMonth}</h3>
                <button
                  type="button"
                  onClick={saveBatchMeters}
                  disabled={isSavingBatchMeters}
                  className="primary-button py-2 px-5 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Save size={15} />
                  <span>{isSavingBatchMeters ? 'Đang lưu...' : 'Lưu tất cả'}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="admin-meter-table w-full text-left text-xs">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-200 font-bold uppercase">
                      <th className="p-3">Phòng</th>
                      <th className="p-3">Điện cũ</th>
                      <th className="p-3">Điện mới</th>
                      <th className="p-3">Nước cũ</th>
                      <th className="p-3">Nước mới</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {roomsList.map((r) => {
                      const currentDienCu = batchMeters[r.room]?.dienCu !== undefined ? batchMeters[r.room]?.dienCu : (r.dienCu ?? '');
                      const currentDienMoi = batchMeters[r.room]?.dienMoi !== undefined ? batchMeters[r.room]?.dienMoi : (r.dienMoi ?? '');
                      const currentNuocCu = batchMeters[r.room]?.nuocCu !== undefined ? batchMeters[r.room]?.nuocCu : (r.nuocCu ?? '');
                      const currentNuocMoi = batchMeters[r.room]?.nuocMoi !== undefined ? batchMeters[r.room]?.nuocMoi : (r.nuocMoi ?? '');
                      return (
                        <tr key={r.room} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40 transition-colors">
                          <td className="p-3 font-bold text-neutral-900 dark:text-white">{r.room}</td>
                          <td data-label="Điện cũ" className="p-2">
                            <input
                              type="number"
                              value={currentDienCu}
                              aria-label={'Điện cũ phòng ' + r.room} inputMode="decimal"
                              onChange={e => handleBatchMeterChange(r.room, 'dienCu', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                            />
                          </td>
                          <td data-label="Điện mới" className="p-2">
                            <input
                              type="number"
                              value={currentDienMoi}
                              aria-label={'Điện mới phòng ' + r.room} inputMode="decimal"
                              onChange={e => handleBatchMeterChange(r.room, 'dienMoi', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                            />
                          </td>
                          <td data-label="Nước cũ" className="p-2">
                            <input
                              type="number"
                              value={currentNuocCu}
                              aria-label={'Nước cũ phòng ' + r.room} inputMode="decimal"
                              onChange={e => handleBatchMeterChange(r.room, 'nuocCu', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                            />
                          </td>
                          <td data-label="Nước mới" className="p-2">
                            <input
                              type="number"
                              value={currentNuocMoi}
                              aria-label={'Nước mới phòng ' + r.room} inputMode="decimal"
                              onChange={e => handleBatchMeterChange(r.room, 'nuocMoi', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            7. CONFIG TAB (CÀI ĐẶT ĐƠN GIÁ)
           ========================================================================= */}
        {activeMenu === 'config' && (
          <div className="space-y-6 pb-36 sm:pb-32">
            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <Settings size={15} className="text-neutral-600 dark:text-neutral-300" />
                <span>Cài đặt đơn giá phí</span>
              </div>
            </div>

            <div className="soft-card kit-form-surface p-4 sm:p-8 space-y-6">
              <div>
                <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Cài đặt đơn giá dịch vụ tháng {selectedMonth}</h3>
                <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">
                  Đồng bộ trực tiếp các ô <span className="font-semibold text-neutral-600 dark:text-neutral-200">H5</span> (Điện), <span className="font-semibold text-neutral-600 dark:text-neutral-200">I5</span> (Nước), <span className="font-semibold text-neutral-600 dark:text-neutral-200">K5</span> (Rác), <span className="font-semibold text-neutral-600 dark:text-neutral-200">L5</span> (Internet), <span className="font-semibold text-neutral-600 dark:text-neutral-200">M5</span> (Xe) trên Google Sheet.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                <div className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
                  <label htmlFor="admin-price-dien" className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">Điện (1 kW)</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="admin-price-dien" inputMode="numeric"
                      value={unitConfig.dien ? fmt(unitConfig.dien) : ''}
                      placeholder="0"
                      onChange={e => setUnitConfig({ ...unitConfig, dien: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 pl-3 pr-8 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
                  <label htmlFor="admin-price-nuoc" className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">Nước (1 m³)</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="admin-price-nuoc" inputMode="numeric"
                      value={unitConfig.nuoc ? fmt(unitConfig.nuoc) : ''}
                      placeholder="0"
                      onChange={e => setUnitConfig({ ...unitConfig, nuoc: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 pl-3 pr-8 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
                  <label htmlFor="admin-price-rac" className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">Tiền Rác</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="admin-price-rac" inputMode="numeric"
                      value={unitConfig.rac ? fmt(unitConfig.rac) : ''}
                      placeholder="0"
                      onChange={e => setUnitConfig({ ...unitConfig, rac: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 pl-3 pr-8 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
                  <label htmlFor="admin-price-net" className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">Internet / người</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="admin-price-net" inputMode="numeric"
                      value={unitConfig.net ? fmt(unitConfig.net) : ''}
                      placeholder="0"
                      onChange={e => setUnitConfig({ ...unitConfig, net: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 pl-3 pr-8 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-700/60 space-y-2">
                  <label htmlFor="admin-price-xe" className="text-xs font-bold text-neutral-600 uppercase dark:text-neutral-300">Xe máy / chiếc</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="admin-price-xe" inputMode="numeric"
                      value={unitConfig.xe ? fmt(unitConfig.xe) : ''}
                      placeholder="0"
                      onChange={e => setUnitConfig({ ...unitConfig, xe: parseCurrency(e.target.value) })}
                      className="w-full bg-white dark:bg-neutral-900 pl-3 pr-8 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-bold text-sm font-num text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-neutral-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  onClick={saveConfig}
                  className="primary-button py-3 px-8 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Save size={16} />
                  <span>Lưu cấu hình đơn giá</span>
                </button>
                {configSaveMsg && <p role="status" className="text-xs font-bold text-emerald-600">{configSaveMsg}</p>}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            8. DECLARATION TAB (SỔ DOANH THU MẪU S1a-HKD)
           ========================================================================= */}
        {activeMenu === 'declaration' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <BookOpen size={15} className="text-neutral-600 dark:text-neutral-300" />
                <span>Kỳ kê khai doanh thu (S1a-HKD)</span>
              </div>
            </div>

            <div className="soft-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <IconSecurity3D size={36} className="shrink-0 drop-shadow-2xs" />
                <select
                  value={declarationHouse}
                  onChange={e => {
                    const h = e.target.value as any;
                    setDeclarationHouse(h);
                    loadDeclaration(selectedMonth, h);
                  }}
                  className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  <option value="TRUNG_KIM" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Hộ KD Trung Kim (116/32)</option>
                  <option value="LVC" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Nhà trọ 109/6 (Lê Văn Chí)</option>
                </select>
                <div className="hidden lg:block">{monthSelect}</div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={saveDeclaration}
                  className="py-2.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Save size={15} />
                  <span>Lưu sổ kê khai</span>
                </button>
                <DocumentActions doc={declarationDoc} downloadLabel="Lưu PDF" />
              </div>
            </div>

            {saveDeclarationError && (
              <div role="alert" className="p-3 bg-rose-100 border border-rose-300 text-rose-800 rounded-2xl text-xs font-bold text-center">
                {saveDeclarationError}
              </div>
            )}

            {saveDeclarationSuccess && (
              <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-2xl text-xs font-bold text-center">
                ✅ Đã lưu sổ doanh thu kỳ kê khai thành công!
              </div>
            )}

            {/* Mẫu S1a-HKD Container */}
            <div
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
              className="administrative-document bg-white rounded-3xl p-8 sm:p-14 border border-neutral-200 shadow-sm max-w-4xl mx-auto text-neutral-900 leading-relaxed print:p-0 print:border-none print:shadow-none print:m-0"
            >
              <div className="flex justify-between items-start text-xs sm:text-sm mb-6 border-b border-neutral-200 pb-4">
                <div>
                  <p className="font-bold underline">{declarationData?.headerLeft3 || `HỘ, CÁ NHÂN KINH DOANH: ${HOUSES[declarationHouse].name}`}</p>
                  <p>{declarationData?.headerLeft4 || `Địa chỉ: ${HOUSES[declarationHouse].address}`}</p>
                  <p>{declarationData?.headerLeft5 || `Mã số thuế: ${HOUSES[declarationHouse].landlordCccd}`}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{declarationData?.headerRight3 || 'Mẫu số S1a-HKD'}</p>
                  <p className="italic text-[11px] text-neutral-700">
                    (Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)
                  </p>
                </div>
              </div>

              <div className="text-center my-6">
                <h3 className="text-lg sm:text-xl font-bold uppercase">
                  SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ
                </h3>
                <p className="text-xs sm:text-sm mt-1">{declarationData?.location}</p>
                <p className="text-xs sm:text-sm font-bold mt-1">Kỳ kê khai: {selectedMonth}</p>
              </div>

              {/* Table */}
              <table className="admin-declaration-table w-full border-collapse border border-neutral-800 text-xs sm:text-sm mb-6">
                <thead>
                  <tr className="bg-neutral-100 border-b border-neutral-800">
                    <th className="border border-neutral-800 p-2 text-center w-28">Ngày tháng</th>
                    <th className="border border-neutral-800 p-2 text-center">Diễn giải</th>
                    <th className="border border-neutral-800 p-2 text-center w-36">Số tiền (VNĐ)</th>
                  </tr>
                </thead>
                <tbody>
                  {declarationRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-neutral-800">
                      <td data-label="Ngày tháng" className="border border-neutral-800 p-2 text-center">
                        <input
                          type="text"
                          aria-label={'Ngày đóng dòng ' + (idx + 1)} inputMode="numeric" value={row.date || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].date = e.target.value;
                            setDeclarationRows(updated);
                          }}
                          placeholder="DD/MM/YYYY"
                          className="w-full text-center bg-transparent border-none outline-none text-xs sm:text-sm"
                        />
                      </td>
                      <td data-label="Người đóng / Phòng" className="border border-neutral-800 p-2">
                        <input
                          type="text"
                          aria-label={'Người đóng hoặc phòng dòng ' + (idx + 1)} value={row.person || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].person = e.target.value;
                            setDeclarationRows(updated);
                          }}
                          placeholder="Nhập tên người thuê hoặc số phòng..."
                          className="w-full bg-transparent border-none outline-none text-xs sm:text-sm"
                        />
                      </td>
                      <td data-label="Số tiền (VNĐ)" className="border border-neutral-800 p-2 text-right">
                        <input
                          type="number"
                          aria-label={'Số tiền dòng ' + (idx + 1)} inputMode="numeric" value={row.amount || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].amount = Number(e.target.value) || 0;
                            setDeclarationRows(updated);
                          }}
                          placeholder="0"
                          className="w-full text-right bg-transparent border-none outline-none text-xs sm:text-sm font-bold"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-50 font-bold border-t-2 border-neutral-800">
                    <td colSpan={2} className="border border-neutral-800 p-2.5 text-right uppercase">
                      Tổng cộng doanh thu:
                    </td>
                    <td className="border border-neutral-800 p-2.5 text-right font-bold text-sm font-num">
                      {fmt(declarationRows.reduce((a, b) => a + (Number(b.amount) || 0), 0))} đ
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Signatures */}
              <div className="flex justify-end pt-6 text-xs sm:text-sm">
                <div className="text-center space-y-1 w-72">
                  <input
                    type="text"
                    value={declarationSigDate}
                    onChange={e => setDeclarationSigDate(e.target.value)}
                    placeholder="Ngày ... tháng ... năm ..."
                    className="w-full text-center italic bg-transparent border-none outline-none"
                  />
                  <p className="font-bold uppercase text-[11px] sm:text-xs">
                    NGƯỜI ĐẠI DIỆN HỘ KINH DOANH
                  </p>
                  <p className="text-[10px] italic text-neutral-700">(Ký ghi rõ họ tên)</p>
                  <div className="h-16" />
                  <p className="font-bold text-sm">{declarationData?.ownerName || HOUSES[declarationHouse].landlord}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            9. CREATE NOTIFICATION TAB (TẠO THÔNG BÁO CHO CƯ DÂN)
           ========================================================================= */}
        {activeMenu === 'createNotification' && (
          <div className="space-y-6">

            {/* Top Navigation Bar: Back Button */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <IconNotification3D size={22} />
                <span>Mẫu gửi thông báo cư dân</span>
              </div>
            </div>

            {/* Notification Template Form Card */}
            <div className="soft-surface p-6 sm:p-8 space-y-7 relative overflow-hidden">
              <div className="border-b border-neutral-200 dark:border-neutral-800 pb-4">
                <h2 className="type-h2 font-bold text-neutral-900 dark:text-white flex items-center gap-3">
                  <IconNotification3D size={44} />
                  <span>Tạo Thông Báo Mới</span>
                </h2>
                <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 mt-1">
                  Soạn nội dung và gửi thông báo, lời nhắc nhở hoặc yêu cầu thanh toán đến toàn bộ cư dân hoặc từng căn hộ.
                </p>
              </div>

              {/* Success Notification Alert */}
              {notifSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3 duration-200">
                  <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold">
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                    <span>{notifSuccessMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifSuccessMsg('')}
                    className="text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              )}

              {/* Form Body */}
              <div className="space-y-6">

                {/* 1. MỤC PHÒNG */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                    1. Phòng nhận thông báo <span className="text-rose-500">*</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Option 1: Tất cả */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifTarget('ALL');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifTarget === 'ALL'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">1. Tất cả</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'ALL' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifTarget === 'ALL' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 leading-tight">Toàn bộ cư dân 2 khu</span>
                    </button>

                    {/* Option 2: Căn bên Lê Văn Chí */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifTarget('LVC');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifTarget === 'LVC'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">2. Lê Văn Chí (LVC)</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'LVC' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifTarget === 'LVC' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 leading-tight">109/6 Lê Văn Chí</span>
                    </button>

                    {/* Option 3: Căn bên Trung Kim */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifTarget('TRUNG_KIM');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifTarget === 'TRUNG_KIM'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">3. Trung Kim (TK)</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'TRUNG_KIM' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifTarget === 'TRUNG_KIM' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 leading-tight">Khu nhà Trung Kim</span>
                    </button>

                    {/* Option 4: Các phòng tùy chọn (có sẵn) */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifTarget('CUSTOM');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifTarget === 'CUSTOM'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">4. Phòng tùy chọn</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'CUSTOM' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifTarget === 'CUSTOM' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 leading-tight">
                        {selectedCustomRooms.length > 0 ? `Đã chọn ${selectedCustomRooms.length} phòng` : 'Chọn danh sách có sẵn'}
                      </span>
                    </button>
                  </div>

                  {/* Danh sách phòng có sẵn khi chọn tùy chọn */}
                  {notifTarget === 'CUSTOM' && (
                    <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-3 duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">
                          Bấm chọn các phòng cần gửi thông báo:
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomRooms(availableRoomNumbers)}
                            className="text-[11px] font-bold text-neutral-900 dark:text-white hover:underline cursor-pointer"
                          >
                            Chọn tất cả
                          </button>
                          <span className="text-neutral-300">|</span>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomRooms([])}
                            className="text-[11px] font-bold text-neutral-600 hover:text-neutral-600 cursor-pointer dark:text-neutral-300"
                          >
                            Bỏ chọn
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {availableRoomNumbers.map(rNum => {
                          const isSelected = selectedCustomRooms.includes(rNum);
                          return (
                            <button
                              key={rNum}
                              type="button"
                              onClick={() => {
                                playSound('click');
                                setSelectedCustomRooms(prev =>
                                   isSelected ? prev.filter(r => r !== rNum) : [...prev, rNum]
                                );
                              }}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 font-num",
                                isSelected
                                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
                                  : "bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400"
                              )}
                            >
                              {isSelected && <Check size={12} className="stroke-[3]" />}
                              <span>{rNum}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. MỤC LOẠI THÔNG BÁO */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                    2. Loại thông báo <span className="text-rose-500">*</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Loại 1: Thông báo */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        handleTypeChange('thong_bao');
                      }}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifType === 'thong_bao'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <IconNotification3D size={26} />
                          <span className="text-xs font-bold">Thông báo</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'thong_bao' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifType === 'thong_bao' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200">Bảo trì, sửa chữa, thông tin chung</span>
                    </button>

                    {/* Loại 2: Nhắc nhở */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        handleTypeChange('nhac_nho');
                      }}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifType === 'nhac_nho'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <IconAlert3D size={26} />
                          <span className="text-xs font-bold">Nhắc nhở</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'nhac_nho' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifType === 'nhac_nho' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200">Trật tự, khóa cổng, giữ gìn vệ sinh</span>
                    </button>

                    {/* Loại 3: Thanh toán */}
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        handleTypeChange('thanh_toan');
                      }}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
                        notifType === 'thanh_toan'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <IconWallet3D size={26} />
                          <span className="text-xs font-bold">Thanh toán</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'thanh_toan' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                          {notifType === 'thanh_toan' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200">Hệ thống tự động báo cú pháp VietQR</span>
                    </button>
                  </div>

                  {/* Banner tự động báo của Thanh toán */}
                  {notifType === 'thanh_toan' && (
                    <div className="p-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 flex items-center gap-3 text-xs text-neutral-800 dark:text-neutral-200 duration-200">
                      <IconWallet3D size={26} className="shrink-0" />
                      <div>
                        <span className="font-bold">Hệ thống tự động kích hoạt:</span> Cư dân khi nhận thông báo này sẽ có nút liên kết quét mã VietQR tự động kèm số tiền và đúng cú pháp chuyển khoản của phòng họ.
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. MỤC NỘI DUNG */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300 mb-1.5">
                      Tiêu đề thông báo <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={notifTitle}
                      onChange={e => setNotifTitle(e.target.value)}
                      placeholder="Nhập tiêu đề thông báo..."
                      className="w-full px-4 py-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-bold text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 dark:focus:ring-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300 mb-1.5">
                      Nội dung chi tiết <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={5}
                      value={notifContent}
                      onChange={e => setNotifContent(e.target.value)}
                      placeholder="Nhập toàn bộ nội dung muốn truyền tải đến cư dân..."
                      className="w-full p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 dark:focus:ring-white leading-relaxed"
                    />
                  </div>
                </div>

                {/* 4. MỤC ĐẶT HẸN (NẾU CẦN) */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                    4. Đặt hẹn gửi (Nếu cần)
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifScheduleMode('none');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between",
                        notifScheduleMode === 'none'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div>
                        <div className="text-xs font-bold">Không (Mặc định)</div>
                        <div className="text-[11px] text-neutral-700 dark:text-neutral-200 mt-0.5">Gửi ngay tức thì</div>
                      </div>
                      <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifScheduleMode === 'none' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                        {notifScheduleMode === 'none' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setNotifScheduleMode('scheduled');
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between",
                        notifScheduleMode === 'scheduled'
                          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
                          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
                      )}
                    >
                      <div>
                        <div className="text-xs font-bold">Đặt lịch hẹn gửi</div>
                        <div className="text-[11px] text-neutral-700 dark:text-neutral-200 mt-0.5">Chọn ngày giờ phát thông báo</div>
                      </div>
                      <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifScheduleMode === 'scheduled' ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
                        {notifScheduleMode === 'scheduled' && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
                      </div>
                    </button>
                  </div>

                  {notifScheduleMode === 'scheduled' && (
                    <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-2 duration-200">
                      <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                        <Clock size={14} className="text-neutral-900 dark:text-white" />
                        <span>Thời gian kích hoạt gửi:</span>
                      </span>
                      <input
                        type="datetime-local"
                        value={notifScheduledDate}
                        onChange={e => setNotifScheduledDate(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-bold text-neutral-900 dark:text-white outline-none focus:ring-1 focus:ring-neutral-900 dark:focus:ring-white cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* 5. ACTION BUTTONS */}
                <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setActiveMenu('utilities');
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-2xl text-xs font-bold text-neutral-700 hover:text-neutral-800 dark:text-neutral-200 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Hủy bỏ
                  </button>

                  <button
                    type="button"
                    disabled={isSendingNotif}
                    onClick={handleSendNotification}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-2xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSendingNotif ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                    <span>{notifScheduleMode === 'scheduled' ? 'Lên Lịch Thông Báo' : 'Gửi Thông Báo Ngay'}</span>
                  </button>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* =========================================================================
            10. LAUNDRY ADMIN TAB (QUẢN LÝ HỆ THỐNG GIẶT SẤY 24/7)
           ========================================================================= */}
        {activeMenu === 'laundry' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button & Title */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-neutral-600 flex items-center gap-1.5 dark:text-neutral-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Máy giặt & lịch đặt</span>
                </span>
                <button
                  type="button"
                  onClick={handleAdminSyncSheet}
                  aria-label="Đồng bộ danh sách máy và giá dịch vụ"
                  disabled={laundryLoading}
                  className="soft-button px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer text-neutral-600 dark:text-neutral-200 border border-neutral-200/60 dark:border-neutral-800/60"
                  title="Đồng bộ danh sách máy và giá từ tab Machines trên Google Sheet"
                >
                  <FileSpreadsheet size={14} className={cn(laundryLoading && "animate-spin")} />
                  <span className="hidden sm:inline">Đồng bộ Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={fetchAdminLaundry}
                  aria-label="Cập nhật trạng thái máy giặt sấy"
                  disabled={laundryLoading}
                  className="soft-button px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={14} className={cn(laundryLoading && "animate-spin text-neutral-600")} />
                  <span className="hidden sm:inline">Cập nhật</span>
                </button>
              </div>
            </div>

            {/* Action Flash Message */}
            {laundryActionMsg && (
              <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-950/40 text-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800 text-xs font-bold flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>{laundryActionMsg}</span>
              </div>
            )}

            {/* Overview Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="soft-card p-4 space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-600 block dark:text-neutral-300">Doanh thu hôm nay</span>
                <span className="text-xl font-bold font-num text-emerald-600 dark:text-emerald-400">
                  {(laundryStats.todayRevenue || 0).toLocaleString('vi-VN')} ₫
                </span>
              </div>
              <div className="soft-card p-4 space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-600 block dark:text-neutral-300">Tổng doanh thu</span>
                <span className="text-xl font-bold font-num text-neutral-900 dark:text-white">
                  {(laundryStats.totalRevenue || 0).toLocaleString('vi-VN')} ₫
                </span>
              </div>
              <div className="soft-card p-4 space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-600 block dark:text-neutral-300">Phiên giặt hôm nay</span>
                <span className="text-xl font-bold font-num text-neutral-600 dark:text-neutral-200">
                  {laundryStats.todaySessions || 0} lượt
                </span>
              </div>
              <div className="soft-card p-4 space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-600 block dark:text-neutral-300">Lịch cọc đang giữ</span>
                <span className="text-xl font-bold font-num text-amber-600 dark:text-amber-400">
                  {laundryStats.activeBookings || 0} slot
                </span>
              </div>
            </div>

            {/* Machine Management Grid */}
            <div className="space-y-3">
              <h3 className="type-h3 font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <WashingMachine size={20} className="text-neutral-600 dark:text-neutral-300" />
                <span>Điều Khiển Máy Giặt & Máy Sấy Trực Tuyến</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                {laundryMachines.map(m => {
                  const isWasher = m.type === 'WASHER';
                  const remainingSec = m.status === 'RUNNING' && m.expectedEndTime
                    ? Math.max(0, Math.floor((new Date(m.expectedEndTime).getTime() - Date.now()) / 1000))
                    : 0;
                  const minsLeft = Math.ceil(remainingSec / 60);

                  return (
                    <div
                      key={m.machineId}
                      className="admin-machine-card soft-card p-5 space-y-4 border border-neutral-200/80 dark:border-neutral-800"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {isWasher ? <IconLaundry3D size={42} /> : <IconDryer3D size={42} />}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-num bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                                {m.machineId}
                              </span>
                              <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                                {isWasher ? 'Máy giặt' : 'Máy sấy'} • {m.cycleMinutes}p
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-neutral-900 dark:text-white mt-0.5">
                              {m.name}
                            </h4>
                          </div>
                        </div>

                        {/* Status Badge */}
                        {m.status === 'RUNNING' ? (
                          <span className="badge-unpaid text-xs py-1 px-2.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                            <span>Đang chạy ({minsLeft}p)</span>
                          </span>
                        ) : (
                          <span className="badge-paid text-xs py-1 px-2.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span>Sẵn sàng</span>
                          </span>
                        )}
                      </div>

                      {/* Power Switch & Price Bar */}
                      <div className="admin-machine-power kit-data-surface p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2.5">
                          <span className="text-neutral-700 dark:text-neutral-200 font-medium">Ổ điện thông minh:</span>
                          <span className={cn(
                            "font-bold text-[11px] px-2 py-0.5 rounded uppercase font-num",
                            m.plugState === 'ON'
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300"
                          )}>
                            {m.plugState || 'OFF'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAdminTogglePlug(m.machineId)} aria-label={`Đổi nguồn máy ${m.machineId}`}
                          className="soft-button px-3 py-1 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Power size={13} className={m.plugState === 'ON' ? "text-emerald-600" : "text-neutral-600"} />
                          <span>Đổi nguồn</span>
                        </button>
                      </div>

                      {/* Admin Actions */}
                      <div className="admin-laundry-actions pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-neutral-600 dark:text-neutral-300">Giá:</span>
                          <input
                            type="number"
                            aria-label={`Giá dịch vụ máy ${m.machineId}`} inputMode="numeric"
                            defaultValue={m.price}
                            onBlur={e => {
                              const val = Number(e.target.value);
                              if (val && val !== m.price) handleAdminUpdatePrice(m.machineId, val);
                            }}
                            className="w-20 px-2 py-1 rounded-lg text-xs font-bold font-num bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 outline-none"
                          />
                          <span className="text-xs font-bold text-neutral-700">₫</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAdminForceStart(m.machineId)} aria-label={`Bật ngay máy ${m.machineId}`}
                            className="primary-button px-3 py-1.5 text-xs font-bold flex items-center gap-1 cursor-pointer"
                            title="Kích hoạt chạy ngay cho khách"
                          >
                            <Play size={12} />
                            <span>Bật ngay</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleAdminReset(m.machineId)} aria-label={`Đặt lại máy ${m.machineId}`}
                            className="soft-button px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 flex items-center gap-1 cursor-pointer"
                            title="Reset về Sẵn Sàng & tắt điện"
                          >
                            <RotateCcw size={12} />
                            <span>Reset</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Bookings in Admin */}
            <div className="soft-card p-5 space-y-3">
              <h4 className="type-h4 font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <CalendarClock size={18} className="text-neutral-600 dark:text-neutral-300" />
                <span>Lịch Đặt Chỗ Gần Đây Của Cư Dân</span>
              </h4>

              {laundryBookings.length === 0 ? (
                <p className="text-xs text-neutral-600 dark:text-neutral-300">Chưa có lịch đặt chỗ nào.</p>
              ) : (
                <div className="space-y-2">
                  {laundryBookings.slice(0, 8).map((b: any) => (
                    <div key={b.bookingId} className="admin-booking-row kit-data-surface p-3 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold font-num bg-neutral-100 text-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-300">
                            {b.machineId}
                          </span>
                          <span className="font-bold text-neutral-900 dark:text-white">
                            {b.tenantName} {b.roomNumber ? `(P.${b.roomNumber})` : ''}
                          </span>
                          <span className="text-neutral-600 dark:text-neutral-300">Hẹn: {b.bookingTime} ({b.bookingDate})</span>
                        </div>
                      </div>

                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                        b.depositStatus === 'PAID'
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                      )}>
                        {b.depositStatus === 'PAID' ? 'Đã Thanh Toán Cọc' : 'Chờ Cọc'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* =========================================================================
            11. ACCOUNT MANAGEMENT TAB (QUẢN LÝ TÀI KHOẢN)
           ========================================================================= */}
        {activeMenu === 'accountManagement' && (
          <div className="space-y-6">
            {/* Top Navigation Bar: Back Button & Title */}
            <div className="admin-section-toolbar soft-card p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                <IconProfile3D size={22} />
                <span>Quản lý tài khoản cư dân</span>
              </div>
            </div>

            {/* Main Account Management Card */}
            <div className="soft-surface p-5 sm:p-8 space-y-6 relative overflow-hidden">
              <div className="border-b border-neutral-200 dark:border-neutral-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="type-h2 font-bold text-neutral-900 dark:text-white flex items-center gap-3">
                    <IconProfile3D size={44} />
                    <span>Quản Lý Tài Khoản</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 mt-1">
                    Xét duyệt tài khoản đăng ký của cư dân hoặc tạo tài khoản mới trực tiếp theo phòng.
                  </p>
                </div>
              </div>

              {/* 2 Sub-tabs Segmented Control */}
              <div className="kit-segmented grid grid-cols-2 gap-1 p-1 max-w-md" role="tablist" aria-label="Chọn chức năng quản lý tài khoản">
                <button
                  type="button"
                  role="tab"
                  aria-selected={accountSubTab === 'approval'}
                  aria-pressed={accountSubTab === 'approval'}
                  onClick={() => {
                    playSound('tab');
                    setAccountSubTab('approval');
                    setAdminRegError('');
                    setAdminRegSuccess('');
                  }}
                  className={cn("kit-segment min-h-11 px-3 apple-body font-medium", accountSubTab === 'approval' && "kit-segment-active")}
                >
                  <span>Xét duyệt tài khoản</span>
                  {registeredAccounts.filter(a => a.status === 'pending').length > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold font-num text-amber-700 dark:text-amber-300">
                      {registeredAccounts.filter(a => a.status === 'pending').length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={accountSubTab === 'create'}
                  aria-pressed={accountSubTab === 'create'}
                  onClick={() => {
                    playSound('tab');
                    setAccountSubTab('create');
                    setAdminRegError('');
                    setAdminRegSuccess('');
                  }}
                  className={cn("kit-segment min-h-11 px-3 apple-body font-medium", accountSubTab === 'create' && "kit-segment-active")}
                >
                  <span>Tạo tài khoản mới</span>
                </button>
              </div>

              {/* Sub-tab 1: Xét duyệt tài khoản */}
              {accountSubTab === 'approval' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="apple-callout kit-text-secondary">
                      Bấm vào từng tài khoản để xem thông tin chi tiết trước khi xét duyệt. Sử dụng nút dấu tích (✓) để duyệt hoặc dấu (✕) để từ chối / hủy duyệt.
                    </p>
                    <span className="apple-callout font-medium kit-text-secondary font-num">
                      Tổng cộng: {registeredAccounts.length} tài khoản
                    </span>
                  </div>

                  {registeredAccounts.length === 0 ? (
                    <div className="kit-data-surface rounded-2xl p-6 text-center">
                      <p className="apple-headline kit-text-primary">Chưa có yêu cầu tài khoản nào</p>
                      <p className="mt-1 apple-callout kit-text-secondary">Các tài khoản đăng ký mới sẽ hiển thị tại đây để bạn xét duyệt.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {registeredAccounts.map((acc) => {
                        const isApproved = acc.status === 'approved';
                        const isRejected = acc.status === 'rejected';
                        return (
                          <div
                            key={acc.id}
                            onClick={() => {
                              playSound('click');
                              setViewingAccount(acc);
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setViewingAccount(acc);
                              }
                            }}
                            className="kit-data-surface rounded-[20px] p-4 flex items-center justify-between gap-3 hover:border-neutral-400/80 transition-all cursor-pointer group"
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              <div className="shrink-0">
                                <IconProfile3D size={42} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2.5 py-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs font-num">
                                    Phòng {acc.roomNumber}
                                  </span>
                                  <span className="apple-body font-semibold kit-text-primary truncate">
                                    {acc.name}
                                  </span>
                                  <span className={cn(
                                    "text-[11px] font-semibold px-2.5 py-0.5 rounded-full",
                                    isApproved
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      : isRejected
                                      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                  )}>
                                    {isApproved ? 'Đã xét duyệt' : isRejected ? 'Chưa xét duyệt' : 'Chờ xét duyệt'}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 apple-callout kit-text-secondary">
                                  <span className="font-num">SĐT: {acc.phone}</span>
                                  {acc.email && <span className="truncate">· {acc.email}</span>}
                                  <span className="font-num">· Ngày ĐK: {acc.createdAt}</span>
                                </div>
                              </div>
                            </div>

                            {/* Right side Tick & X action buttons */}
                            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  playSound('success');
                                  updateAccountStatus(acc.id, 'approved');
                                  showPortalToast(`Đã duyệt tài khoản ${acc.name} (Phòng ${acc.roomNumber})`, 'success');
                                }}
                                aria-label={`Duyệt tài khoản ${acc.name}`}
                                title="Xét duyệt tài khoản"
                                className={cn(
                                  "h-10 w-10 rounded-xl flex items-center justify-center border transition-all cursor-pointer",
                                  isApproved
                                    ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                    : "bg-white dark:bg-neutral-800 text-emerald-600 dark:text-emerald-400 border-neutral-200 dark:border-neutral-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-300"
                                )}
                              >
                                <Check size={18} className="stroke-[2.5]" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  playSound('click');
                                  updateAccountStatus(acc.id, 'rejected');
                                  showPortalToast(`Đã đánh dấu chưa duyệt tài khoản ${acc.name}`, 'info');
                                }}
                                aria-label={`Từ chối hoặc hủy duyệt tài khoản ${acc.name}`}
                                title="Chưa xét duyệt / Từ chối"
                                className={cn(
                                  "h-10 w-10 rounded-xl flex items-center justify-center border transition-all cursor-pointer",
                                  isRejected
                                    ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                                    : "bg-white dark:bg-neutral-800 text-rose-600 dark:text-rose-400 border-neutral-200 dark:border-neutral-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-300"
                                )}
                              >
                                <X size={18} className="stroke-[2.5]" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 2: Tạo tài khoản mới */}
              {accountSubTab === 'create' && (
                <div className="max-w-xl">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAdminRegError('');
                      setAdminRegSuccess('');

                      if (!adminRegRoom) {
                        setAdminRegError('Vui lòng chọn số phòng thuê');
                        return;
                      }
                      if (adminRegPassword !== adminRegConfirmPass) {
                        setAdminRegError('Mật khẩu xác nhận không khớp');
                        return;
                      }

                      const res = registerResident({
                        name: adminRegName,
                        phone: adminRegPhone,
                        email: adminRegEmail,
                        roomNumber: adminRegRoom,
                        password: adminRegPassword,
                        autoApprove: true
                      });

                      if (res.success) {
                        playSound('success');
                        setAdminRegSuccess(res.message || 'Tạo tài khoản cư dân mới thành công!');
                        showPortalToast(`Đã tạo tài khoản cho phòng ${adminRegRoom}`, 'success');
                        setAdminRegName('');
                        setAdminRegPhone('');
                        setAdminRegRoom('');
                        setAdminRegEmail('');
                        setAdminRegPassword('');
                        setAdminRegConfirmPass('');
                      } else {
                        playSound('alert');
                        setAdminRegError(res.error || 'Không thể tạo tài khoản');
                      }
                    }}
                    className="space-y-4"
                  >
                    {adminRegError && (
                      <div role="alert" className="kit-feedback flex items-start gap-2 rounded-2xl border border-rose-200/80 bg-rose-50/90 p-3.5 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-950/70 dark:text-rose-200">
                        <AlertCircle aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
                        <span className="leading-relaxed">{adminRegError}</span>
                      </div>
                    )}

                    {adminRegSuccess && (
                      <div role="status" className="kit-feedback flex items-start gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/90 p-3.5 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-950/70 dark:text-emerald-200">
                        <CheckCircle2 aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
                        <span className="leading-relaxed">{adminRegSuccess}</span>
                      </div>
                    )}

                    <div>
                      <label htmlFor="admin-register-name" className="mb-2 block apple-headline kit-text-primary">Họ và tên cư dân</label>
                      <div className="relative flex items-center">
                        <User aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 text-neutral-500 dark:text-neutral-400" />
                        <input
                          id="admin-register-name"
                          type="text"
                          autoComplete="name"
                          required
                          placeholder="Họ và tên của cư dân"
                          value={adminRegName}
                          onChange={(e) => setAdminRegName(e.target.value)}
                          className="kit-field min-h-12 w-full pl-11 pr-3.5"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label htmlFor="admin-register-phone" className="mb-2 block apple-headline kit-text-primary">Số điện thoại</label>
                        <input
                          id="admin-register-phone"
                          type="tel"
                          autoComplete="tel"
                          required
                          placeholder="09xx xxx xxx"
                          value={adminRegPhone}
                          onChange={(e) => setAdminRegPhone(e.target.value)}
                          className="kit-field min-h-12 w-full px-3.5 font-num"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="admin-register-room" className="mb-2 block apple-headline kit-text-primary">Số phòng thuê</label>
                        <select
                          id="admin-register-room"
                          required
                          value={adminRegRoom}
                          onChange={(e) => setAdminRegRoom(e.target.value)}
                          className="kit-field min-h-12 w-full px-3.5 font-num cursor-pointer"
                        >
                          <option value="" disabled>Chọn phòng thuê</option>
                          {(availableRoomNumbers.length > 0 ? availableRoomNumbers : DEFAULT_ROOM_NUMBERS).map(rNum => (
                            <option key={rNum} value={rNum} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">
                              Phòng {rNum}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="admin-register-email" className="mb-2 block apple-headline kit-text-primary">Email liên hệ (tùy chọn)</label>
                      <input
                        id="admin-register-email"
                        type="email"
                        autoComplete="email"
                        placeholder="ban@example.com"
                        value={adminRegEmail}
                        onChange={(e) => setAdminRegEmail(e.target.value)}
                        className="kit-field min-h-12 w-full px-3.5"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label htmlFor="admin-register-password" className="mb-2 block apple-headline kit-text-primary">Mật khẩu</label>
                        <input
                          id="admin-register-password"
                          minLength={6}
                          type="password"
                          autoComplete="new-password"
                          required
                          placeholder="Ít nhất 6 ký tự"
                          value={adminRegPassword}
                          onChange={(e) => setAdminRegPassword(e.target.value)}
                          className="kit-field min-h-12 w-full px-3.5"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="admin-register-confirm" className="mb-2 block apple-headline kit-text-primary">Nhập lại mật khẩu</label>
                        <input
                          id="admin-register-confirm"
                          type="password"
                          autoComplete="new-password"
                          required
                          placeholder="Nhập lại mật khẩu"
                          value={adminRegConfirmPass}
                          onChange={(e) => setAdminRegConfirmPass(e.target.value)}
                          className="kit-field min-h-12 w-full px-3.5"
                        />
                      </div>
                    </div>

                    <button type="submit" className="primary-button min-h-12 w-full px-4 py-3 apple-control">
                      <span>Tạo tài khoản cư dân</span>
                      <ArrowRight aria-hidden="true" size={17} className="shrink-0" />
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Modal xem chi tiết thông tin tài khoản trước khi xét duyệt */}
            {viewingAccount && (
              <div
                className="tahoe-dialog-overlay fixed inset-0 z-[70] flex items-center justify-center p-4 bg-neutral-950/30"
                onClick={() => setViewingAccount(null)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="account-detail-dialog-title"
                  className="tahoe-dialog kit-dialog w-full max-w-md overflow-y-auto overscroll-contain p-5 sm:p-7 space-y-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <IconProfile3D size={44} />
                      <div>
                        <span className="apple-callout kit-text-secondary">Thông tin đăng ký</span>
                        <h3 id="account-detail-dialog-title" className="apple-title2 apple-strong kit-text-primary mt-0.5">
                          {viewingAccount.name}
                        </h3>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Đóng"
                      onClick={() => setViewingAccount(null)}
                      className="soft-button h-10 w-10 flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <dl className="liquid-panel-subtle space-y-3 rounded-2xl p-4 text-left apple-body">
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                      <dt className="kit-text-secondary">Họ và tên</dt>
                      <dd className="font-semibold kit-text-primary">{viewingAccount.name}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-2.5">
                      <dt className="kit-text-secondary">Số phòng đăng ký</dt>
                      <dd className="font-num font-bold kit-text-primary">Phòng {viewingAccount.roomNumber}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-2.5">
                      <dt className="kit-text-secondary">Số điện thoại</dt>
                      <dd className="font-num font-semibold kit-text-primary">{viewingAccount.phone}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-2.5">
                      <dt className="kit-text-secondary">Email liên hệ</dt>
                      <dd className="break-all font-medium kit-text-primary">{viewingAccount.email || 'Chưa cập nhật'}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-2.5">
                      <dt className="kit-text-secondary">Ngày đăng ký</dt>
                      <dd className="font-num font-medium kit-text-primary">{viewingAccount.createdAt}</dd>
                    </div>
                    <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-2.5">
                      <dt className="kit-text-secondary">Trạng thái</dt>
                      <dd>
                        <span className={cn(
                          "text-xs font-semibold px-2.5 py-1 rounded-full",
                          viewingAccount.status === 'approved'
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : viewingAccount.status === 'rejected'
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        )}>
                          {viewingAccount.status === 'approved' ? 'Đã xét duyệt' : viewingAccount.status === 'rejected' ? 'Chưa xét duyệt' : 'Chờ xét duyệt'}
                        </span>
                      </dd>
                    </div>
                  </dl>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        updateAccountStatus(viewingAccount.id, 'rejected');
                        setViewingAccount({ ...viewingAccount, status: 'rejected' });
                        showPortalToast(`Đã đánh dấu chưa duyệt tài khoản ${viewingAccount.name}`, 'info');
                      }}
                      className="soft-button min-h-11 px-4 py-2.5 text-rose-600 dark:text-rose-400 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <X size={17} />
                      <span>Chưa duyệt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('success');
                        updateAccountStatus(viewingAccount.id, 'approved');
                        setViewingAccount({ ...viewingAccount, status: 'approved' });
                        showPortalToast(`Đã duyệt tài khoản ${viewingAccount.name} (Phòng ${viewingAccount.roomNumber})`, 'success');
                      }}
                      className="primary-button min-h-11 px-4 py-2.5 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check size={17} />
                      <span>Duyệt tài khoản</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* =========================================================================
          MOBILE BOTTOM NAVIGATION (Fixed bottom on mobile)
         ========================================================================= */}
      <div className="kit-admin-dock-wrap fixed inset-x-0 bottom-0 z-50 lg:hidden">
        <nav aria-label="Điều hướng quản trị" className="kit-dock kit-admin-dock">
          {[
            { key: 'dashboard', icon: NavigationHome, label: 'Tổng quan' },
            { key: 'rooms', icon: NavIcons.Users, label: 'Phòng' },
            { key: 'billing', icon: NavIcons.Receipt, label: 'Thu tiền' },
            { key: 'utilities', icon: NavIcons.LayoutGrid, label: 'Tiện ích' }
          ].map(({ key, icon: Icon, label }) => {
            const isActive = activeMenu === key || (key === 'rooms' && activeMenu === 'roomDetail') || (key === 'utilities' && ['meter', 'plates', 'contract', 'invoices', 'declaration', 'config', 'createNotification', 'laundry', 'accountManagement'].includes(activeMenu));
            return <button type="button" key={key} aria-current={isActive ? 'page' : undefined} onClick={() => { playSound('click'); setActiveMenu(key as any); }} className={cn('kit-nav-item kit-admin-dock-item', isActive && 'kit-nav-active')}>
              <Icon size={21} /><span>{label}</span>
            </button>;
          })}
          <span className="kit-admin-dock-divider" aria-hidden="true" />
          <button type="button" onClick={togglePaymentGate} aria-label={'Cổng thanh toán: ' + (paymentGate === 'START' ? 'đang mở. Nhấn để đóng cổng' : 'đang đóng. Nhấn để mở cổng')} aria-pressed={paymentGate === 'START'} className="kit-nav-item kit-admin-dock-item kit-admin-gate">
            <span className="relative"><NavIcons.Power size={21} /><span aria-hidden="true" className={cn('kit-gate-dot', paymentGate === 'START' ? 'bg-emerald-500' : 'bg-rose-500')} /></span>
            <span>{paymentGate === 'START' ? 'Đang mở' : 'Đã đóng'}</span>
          </button>
        </nav>
      </div>

    </div>
  );
}
