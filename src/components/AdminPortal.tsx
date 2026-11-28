import { createPortal } from 'react-dom';
import * as LucideNav from 'lucide-react';
import { ChevronLeft as LineChevronLeft, ChevronRight as LineChevronRight, ChevronDown as LineChevronDown } from './LineIcons';
const NavIcons = { ...LucideNav, ChevronLeft: LineChevronLeft, ChevronRight: LineChevronRight, ChevronDown: LineChevronDown };
import '../styles/admin-tahoe.css';
import '../styles/resident-tahoe.css';
import React, { Fragment, useState, useEffect, useMemo, useRef } from 'react';
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
  Check,
  AlertTriangle,
  WashingMachine,
  Flame,
  Play,
  RotateCcw,
  CalendarClock,
  X,
  User,
  ArrowRight,
  ShieldAlert
} from './AppIcons';
import { useApp, RegisteredAccount } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { storage } from '../lib/storage';
import { cn, getCurrentMonthStr, isFutureMonth, DEFAULT_ROOM_NUMBERS } from '../lib/utils';
import { apiFetch, ensureSource, getSource, workerFetch } from '../lib/api';
import FeeSettings from './admin/FeeSettings';
import MonthBilling from './admin/MonthBilling';
import { meterMonthChoices } from '../lib/meterSheet';
import ConfirmSaveDialog from './admin/ConfirmSaveDialog';
import IssueInvoicesBar from './admin/IssueInvoicesBar';
import { HOUSES, houseFromRoom } from '../lib/houses';
import { buildContract, buildCt01, Person } from '../lib/documents/legalForms';
import { buildDeclaration } from '../lib/documents/stateFormat';
import { roomInvoice } from '../lib/documents/fromProfile';
import { fetchPublicLink, useMonthLinks, usePaymentBlock } from '../lib/invoicePayment';
import { InvoiceQrThumb } from './admin/InvoiceQrThumb';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';
import { canonicalRoomId, pushUpdateToGoogleSheet } from '../services/googleSheetSyncService';
import { UsageBarCharts } from './UsageBarCharts';
import { Background } from './Background';
import { useSidebarLabels } from '../lib/useSidebarLabels';
import { AccountDeleteDialog, AccountDeleteMode } from './AccountDeleteDialog';
import { PaymentPortalSettings } from './PaymentPortalSettings';
import { ManagerAccounts } from './ManagerAccounts';
import { ADMIN_ROOM, createAccountOnWorker, useAccountTargets, useEnabledModules } from '../lib/workerAccounts';
import { useWorkerViewer } from '../lib/paymentPortal';
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
import { createWriteGuard } from '../lib/writeGuard';
import { createHouseIdCache, registerAdminRefresh, refreshRooms, refreshBilling, refreshDashboard } from '../lib/adminRefresh';
import { normalizeVnPhone, phoneProblem, PHONE_PROBLEM_MESSAGE } from '../lib/phone';
import { PhoneHint } from './PhoneHint';
import { STORAGE_KEYS } from '../lib/storage';
import { soundFx } from '../lib/soundFx';
import { OfflineBanner } from './OfflineBanner';
import { matchesRoomFilters, occupiedSlots, roomCapacity, ROOM_SLOTS, sanitizeRoomRow } from '../lib/roomRow';

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
// Houses of the signed-in admin do not change inside a session: read once per Worker session token.
const workerHouseIds = createHouseIdCache();
const ROOMS_FRESH_MS = 30000;
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

/** Each room has three resident slots (Người 1–3, columns Q:AB of the month tab). */
const MAX_ROOM_OCCUPANTS = 3;

function PersonGlyph({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" data-person={filled ? 'filled' : 'free'} className={filled ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}>
      <circle cx="12" cy="7.5" r="4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.6} />
      <path d="M4 20.5c0-4.1 3.6-7 8-7s8 2.9 8 7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** Who lives in a room at a glance: one solid figure per resident, an outlined one per free place (as many as the room's capacity). */
function RoomOccupancy({ count, capacity }: { count: number; capacity: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${count} trên ${capacity} người đang ở`}>
      <span className="flex flex-wrap items-center gap-0.5">
        {Array.from({ length: capacity }, (_, i) => <PersonGlyph key={i} filled={i < count} />)}
      </span>
      <span aria-hidden="true" className="font-num text-xs font-semibold text-neutral-600 dark:text-neutral-300 whitespace-nowrap">{count}/{capacity}</span>
    </div>
  );
}

/** A draft invoice (worker mode): not issued yet, residents do not see it until "Tạo hoá đơn". */
function DraftBadge({ className = '' }: { className?: string }) {
  return <span data-testid="draft-badge" title="Hoá đơn nháp: cư dân chưa thấy" className={cn('inline-block shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-bold text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100', className)}>Nháp</span>;
}

function AdminEmptyState({ filtered, title }: { filtered: boolean; title: string }) {
  return <div className="kit-data-surface rounded-[20px] px-5 py-8 text-center" role="status">
    <Search size={32} className="mx-auto mb-3" />
    <h2 className="apple-title2 kit-text-primary font-semibold">{filtered ? 'Không có kết quả phù hợp' : title}</h2>
    <p className="apple-callout kit-text-secondary mt-2">{filtered ? 'Thử tên, số phòng hoặc trạng thái khác.' : 'Bạn có thể đổi kỳ tháng hoặc làm mới dữ liệu.'}</p>
  </div>;
}

interface NotifRoom { houseId: string; room: string }

/** Worker mode: notice recipients come from /api/houses; custom rooms are picked per house and sent as { houseId, room }. */
function WorkerNotifTargets({ houses, target, onTarget, picked, onPicked }: {
  houses: { id: string; name: string }[];
  target: string;
  onTarget: (t: string) => void;
  picked: NotifRoom[];
  onPicked: (next: NotifRoom[]) => void;
}) {
  const [roomsByHouse, setRoomsByHouse] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (target !== 'CUSTOM') return;
    let live = true;
    houses.forEach((h) => {
      workerFetch(`/api/houses/${encodeURIComponent(h.id)}/rooms`)
        .then((res) => res.json())
        .then((data) => { if (live && Array.isArray(data?.rooms)) setRoomsByHouse((prev) => ({ ...prev, [h.id]: data.rooms.map((r: { name: string }) => String(r.name)) })); })
        .catch(() => {});
    });
    return () => { live = false; };
  }, [target, houses]);
  const option = (id: string, label: string, hint: string) => (
    <button
      key={id}
      type="button"
      onClick={() => { playSound('click'); onTarget(id); }}
      className={cn(
        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2",
        target === id
          ? "bg-neutral-100 dark:bg-neutral-800/90 border-neutral-900 dark:border-white text-neutral-950 dark:text-white font-bold shadow-xs"
          : "bg-white dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold">{label}</span>
        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", target === id ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white" : "border-neutral-300 dark:border-neutral-600")}>
          {target === id && <div className="w-1.5 h-1.5 bg-white dark:bg-neutral-900 rounded-full" />}
        </div>
      </div>
      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 leading-tight">{hint}</span>
    </button>
  );
  const has = (houseId: string, room: string) => picked.some((p) => p.houseId === houseId && p.room === room);
  const toggle = (houseId: string, room: string) =>
    onPicked(has(houseId, room) ? picked.filter((p) => !(p.houseId === houseId && p.room === room)) : [...picked, { houseId, room }]);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {option('ALL', 'Tất cả', houses.length > 1 ? `Toàn bộ cư dân ${houses.length} căn` : 'Toàn bộ cư dân')}
        {houses.map((h, i) => option(h.id, `${i + 2}. ${h.name}`, 'Toàn bộ cư dân căn này'))}
        {option('CUSTOM', `${houses.length + 2}. Phòng tùy chọn`, picked.length > 0 ? `Đã chọn ${picked.length} phòng` : 'Chọn danh sách có sẵn')}
      </div>
      {target === 'CUSTOM' && (
        <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-4 duration-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">Bấm chọn các phòng cần gửi thông báo:</span>
            <button type="button" onClick={() => onPicked([])} className="text-[11px] font-bold text-neutral-600 hover:text-neutral-600 cursor-pointer dark:text-neutral-300">Bỏ chọn</button>
          </div>
          {houses.map((h) => (
            <div key={h.id} className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">{h.name}</span>
                <button
                  type="button"
                  onClick={() => onPicked([...picked.filter((p) => p.houseId !== h.id), ...(roomsByHouse[h.id] ?? []).map((room) => ({ houseId: h.id, room }))])}
                  className="text-[11px] font-bold text-neutral-900 dark:text-white hover:underline cursor-pointer"
                >
                  Chọn cả căn
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(roomsByHouse[h.id] ?? []).map((room) => (
                  <button
                    key={room}
                    type="button"
                    onClick={() => { playSound('click'); toggle(h.id, room); }}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 font-num",
                      has(h.id, room)
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
                        : "bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400"
                    )}
                  >
                    {has(h.id, room) && <Check size={12} className="stroke-[3]" />}
                    <span>{room}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Module-level: the prep popup shows once per app open, whatever menu or month the admin moves to. */
let prepNoticeShownThisOpen = false;

export function AdminPortal() {
  const navigate = useNavigate();
  const { logoutUser, addNotification, registerResident, registeredAccounts, updateAccountStatus, forgetRegisteredAccount } = useApp();
  const { mode, isDark, toggleTheme } = useTheme();

  // Active Menu
  // Worker mode: fee settings and meter entry are served by the Worker; sheet mode keeps the old screens.
  const [workerMode, setWorkerMode] = useState(() => getSource() === 'worker');
  // "Đang chuẩn bị hoá đơn tháng …": a popup once per app open (not on every menu change).
  const [prepNotice, setPrepNotice] = useState<string | null>(null);
  // Staff with a Worker token: until /api/source answers we do not know which screens apply, so nothing old is drawn meanwhile.
  const [sourceReady, setSourceReady] = useState(() => getSource() === 'worker' || !storage.getItem(STORAGE_KEYS.WORKER_TOKEN));
  useEffect(() => {
    let live = true;
    ensureSource().then((src) => { if (!live) return; setWorkerMode(src === 'worker'); setSourceReady(true); });
    return () => { live = false; };
  }, []);
  const [activeMenu, setActiveMenu] = useState<
    'dashboard' | 'rooms' | 'roomDetail' | 'billing' | 'contract' | 'invoices' | 'meter' | 'config' | 'declaration' | 'utilities' | 'createNotification' | 'laundry' | 'accountManagement' | 'paymentPortal'
  >('dashboard');
  // Chủ trọ sets each house's bank account in "Thông tin thanh toán" and creates Ban Quản Lý Trọ.
  const workerViewer = useWorkerViewer();
  const isAdminTong = workerViewer?.role === 'owner';
  // Accounts made from "Tạo tài khoản mới" go to the Worker: pick a house, then a room or "Admin".
  const isWorkerStaff = workerViewer?.kind === 'staff';
  const accountTargets = useAccountTargets(isWorkerStaff);
  // Tiện ích the Developer turned on for this admin's houses; unknown (null) shows them all.
  const enabledModules = useEnabledModules(isWorkerStaff);

  // Account Management (Quản lý tài khoản) state
  const [accountSubTab, setAccountSubTab] = useState<'approval' | 'create' | 'managers'>('approval');
  const [viewingAccount, setViewingAccount] = useState<RegisteredAccount | null>(null);
  const [sheetAccounts, setSheetAccounts] = useState<(RegisteredAccount & { isAdmin?: boolean })[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountDeletion, setAccountDeletion] = useState<{ account: RegisteredAccount; mode: AccountDeleteMode } | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
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
  const [notifTarget, setNotifTarget] = useState<string>('ALL');
  const [selectedCustomRooms, setSelectedCustomRooms] = useState<string[]>([]);
  // Worker mode: custom rooms are { houseId, room } so equal room names in two houses stay apart.
  const [pickedRooms, setPickedRooms] = useState<NotifRoom[]>([]);
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
    const workerNotif = workerMode && isWorkerStaff && accountTargets.houses.length > 0;
    if (notifTarget === 'CUSTOM' && (workerNotif ? pickedRooms.length : selectedCustomRooms.length) === 0) {
      showPortalToast('Vui lòng chọn ít nhất một phòng cần gửi thông báo', 'error');
      return;
    }

    setIsSendingNotif(true);

    let targetDesc = 'Tất cả các phòng';
    if (notifTarget === 'LVC') targetDesc = 'Các phòng bên Lê Văn Chí';
    else if (notifTarget === 'TRUNG_KIM') targetDesc = 'Các phòng bên Trung Kim';
    else if (notifTarget === 'CUSTOM') targetDesc = `Phòng: ${(workerNotif ? pickedRooms.map((p) => (accountTargets.houses.length > 1 ? `${p.room} (${accountTargets.houses.find((h) => h.id === p.houseId)?.name ?? p.houseId})` : p.room)) : selectedCustomRooms).join(', ')}`;
    else if (workerNotif && notifTarget !== 'ALL') targetDesc = `Căn ${accountTargets.houses.find((h) => h.id === notifTarget)?.name ?? notifTarget}`;

    const newNotifItem = {
      id: `notif-${Date.now()}`,
      title: notifTitle.trim(),
      desc: notifContent.trim(),
      time: notifScheduleMode === 'scheduled' ? `Hẹn lúc: ${notifScheduledDate || 'theo lịch'}` : 'Vừa xong',
      type: notifType === 'thanh_toan' ? 'invoice' as const : notifType === 'nhac_nho' ? 'alert' as const : 'info' as const,
      unread: true,
      sender: `BQL Phong Lan (${targetDesc})`
    };

    // Admin -> Cloudflare D1 -> resident; success only once the notice is stored.
    apiFetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newNotifItem,
        target: notifTarget,
        customRooms: workerNotif ? pickedRooms : selectedCustomRooms,
        scheduledAt: notifScheduleMode === 'scheduled' ? notifScheduledDate : null
      })
    })
      .then(res => res.json())
      .then(data => {
        if (!data?.success) throw new Error(data?.error);
        playSound('success');
        setNotifSuccessMsg(`Đã gửi đến: ${targetDesc}.`);
      })
      .catch(err => showPortalToast(err?.message || 'Chưa gửi được thông báo. Vui lòng thử lại.', 'error'))
      .finally(() => setIsSendingNotif(false));
  };

  // Months
  const [months, setMonths] = useState<string[]>(DEFAULT_MONTH_TABS);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthStr());
  const monthPickedByHand = useRef(false); // the server default month applies once, never over a hand pick
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;
  const lastLoadedMonthRef = useRef(selectedMonth);
  const [roomsLoadedMonth, setRoomsLoadedMonth] = useState('');
  const roomsFetchedRef = useRef({ month: '', at: 0 });

  // Sidebar Collapse
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { collapsedLayout: sidebarCollapsedLayout, labelPhase: sidebarLabelPhase } = useSidebarLabels(isSidebarCollapsed);

  // Loading
  const [isLoading, setIsLoading] = useState(false);
  const [adminLoadError, setAdminLoadError] = useState('');


  // Payment Gate state
  const [paymentGate, setPaymentGate] = useState<'START' | 'STOP'>('STOP');
  const lastGateToggleTimeRef = useRef<number>(0);
  const [gateMixed, setGateMixed] = useState(false);
  const gateGuardRef = useRef(createWriteGuard());

  // Data States
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [roomsList, setRoomsList] = useState<any[]>([]);
  const [currentRoomData, setCurrentRoomData] = useState<any>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  // Worker mode: the house of the open room (the same room name can exist in two houses), the row as the server last
  // returned it (to send only what changed), the month's real prices for the live estimate, and the Save state.
  const [selectedHouseId, setSelectedHouseId] = useState<string>('');
  const roomBaselineRef = useRef<any>(null);
  const detailRequestRef = useRef(0);
  const savingRoomRef = useRef(false);
  const payingRef = useRef<Set<string>>(new Set());
  const [roomConfig, setRoomConfig] = useState<{ electricPrice: number; waterPrice: number; services: { id: number; name: string; price: number; per: string }[] } | null>(null);
  const [savingServices, setSavingServices] = useState(false);
  const [confirmRoomSave, setConfirmRoomSave] = useState(false);
  const [isSavingRoom, setIsSavingRoom] = useState(false);
  const [roomMoneyNote, setRoomMoneyNote] = useState('');
  const [roomFieldErrors, setRoomFieldErrors] = useState<Record<string, string>>({});
  // Reads of the room and billing lists lose against a save that started or finished after they began.
  const roomsGuardRef = useRef(createWriteGuard());
  const billingGuardRef = useRef(createWriteGuard());
  // Empty resident slots the admin opened in this room, kept open while their fields are edited.
  const [openedSlots, setOpenedSlots] = useState<number[]>([]);
  useEffect(() => setOpenedSlots([]), [selectedRoomId]);
  const [billingList, setBillingList] = useState<any[]>([]);
  // Worker mode, Hoá đơn tab: rooms ticked in the list (key = house|room).
  const [pickedBilling, setPickedBilling] = useState<Set<string>>(new Set());
  const billingKey = (item: any) => `${item.houseId || ''}|${item.room}`;
  const [adminSearch, setAdminSearch] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [houseFilter, setHouseFilter] = useState('all');

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
  const [invoiceHouse, setInvoiceHouse] = useState('');
  const [invoiceFromBilling, setInvoiceFromBilling] = useState(false);
  const billingScrollRef = useRef<number | null>(null);

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

  // Batch Meters State
  const [batchMeters, setBatchMeters] = useState<Record<string, { dienCu?: number; dienMoi?: number; nuocCu?: number; nuocMoi?: number }>>({});
  const [isSavingBatchMeters, setIsSavingBatchMeters] = useState(false);

  // Format currency
  const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');
  const parseCurrency = (s: any) => parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0;
  // Prices behind the live estimate on the room screen. Worker mode: the month's real prices (loaded below), not the old defaults.
  // A service this room is opted out of is not in its estimate.
  const roomUnit = (per: string) => (roomConfig?.services || [])
    .filter(svc => svc.per === per && !(Array.isArray(currentRoomData?.optOut) && currentRoomData.optOut.includes(svc.id)))
    .reduce((total, svc) => total + Number(svc.price || 0), 0);
  const units = workerMode && roomConfig
    ? { dien: roomConfig.electricPrice, nuoc: roomConfig.waterPrice, net: roomUnit('person'), xe: roomUnit('vehicle') }
    : { dien: unitConfig.dien || 3500, nuoc: unitConfig.nuoc || 20000, net: unitConfig.net || 40000, xe: unitConfig.xe || 50000 };
  useEffect(() => {
    if (activeMenu !== 'roomDetail' || !workerMode || !selectedHouseId) return;
    let live = true;
    setRoomConfig(null);
    workerFetch(`/api/admin/config?houseId=${encodeURIComponent(selectedHouseId)}&month=${encodeURIComponent(selectedMonth)}`)
      .then(res => res.json())
      .then(d => {
        if (!live || !d?.success) return;
        const services: any[] = (d.config?.services || []).filter((svc: any) => svc.active);
        setRoomConfig({
          electricPrice: Number(d.config?.electricPrice || 0),
          waterPrice: Number(d.config?.waterPrice || 0),
          services: services.map(svc => ({ id: Number(svc.id), name: String(svc.name || ''), price: Number(svc.price || 0), per: String(svc.per || 'room') })),
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [activeMenu, workerMode, selectedHouseId, selectedMonth]);

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
        if (getSource() === 'worker' && typeof data.defaultMonth === 'string' && /^\d{4}-\d{2}$/.test(data.defaultMonth) && !monthPickedByHand.current) {
          const dm = `${data.defaultMonth.slice(5, 7)}/${data.defaultMonth.slice(0, 4)}`;
          setMonths(prev => prev.includes(dm) ? prev : [...prev, dm].sort((a, b) => (a.slice(3) + a.slice(0, 2)).localeCompare(b.slice(3) + b.slice(0, 2))));
          setSelectedMonth(dm);
        }
      })
      .catch(() => {
        // Fallback: Preserves all 8 default monthly tabs from Google Sheet
        setMonths(DEFAULT_MONTH_TABS);
      });

    loadPaymentGateStatus(selectedMonth);
  }, []);

  /** A month picked on a screen (Điện nước): kept in the month list so the header arrows still move from it. */
  const pickMonthByHand = (m: string) => {
    monthPickedByHand.current = true;
    setMonths(prev => prev.includes(m) ? prev : [...prev, m].sort((a, b) => (a.slice(3) + a.slice(0, 2)).localeCompare(b.slice(3) + b.slice(0, 2))));
    setSelectedMonth(m);
    playSound('click');
  };

  const handlePrevMonth = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentIndex = months.indexOf(selectedMonth);
    if (currentIndex > 0) {
      monthPickedByHand.current = true;
        setSelectedMonth(months[currentIndex - 1]);
      playSound('click');
    }
  };

  const handleNextMonth = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentIndex = months.indexOf(selectedMonth);
    if (currentIndex < months.length - 1) {
      monthPickedByHand.current = true;
      setSelectedMonth(months[currentIndex + 1]);
      playSound('click');
    }
  };

  useEffect(() => {
    if (prepNoticeShownThisOpen || !workerMode || !isFutureMonth(selectedMonth)) return;
    prepNoticeShownThisOpen = true;
    setPrepNotice(selectedMonth);
  }, [workerMode, selectedMonth]);

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
    // Staff with a Worker token: nothing is read until /api/source says which store answers (no read goes to the wrong one).
    if (!sourceReady) return;
    // Skimming through months loads only the one the admin stops on.
    const monthChanged = lastLoadedMonthRef.current !== selectedMonth;
    lastLoadedMonthRef.current = selectedMonth;
    const loadTimer = window.setTimeout(() => {
      loadTabContent(activeMenu, selectedMonth);
      if (!workerMode) loadPaymentGateStatus(selectedMonth);
    }, monthChanged ? 120 : 0);

    // Periodic auto-polling for Google Sheet updates (every 8 seconds)
    const interval = setInterval(() => {
      // Worker mode: nothing to refresh while the tab is in the background.
      if (workerMode && document.visibilityState === 'hidden') return;
      if (activeMenu === 'dashboard' || activeMenu === 'billing') {
        // Money that arrives while the page is open shows as "Đã đóng" without a reload.
        loadTabContent(activeMenu, selectedMonth, true);
      } else if (activeMenu === 'rooms') {
        fetchRooms(selectedMonth, true);
      }
      if (!workerMode) loadPaymentGateStatus(selectedMonth);
    }, 8000);

    return () => {
      clearTimeout(loadTimer);
      clearInterval(interval);
    };
  }, [selectedMonth, activeMenu, workerMode, sourceReady]);

  // Worker mode: the gate is read when the month changes and on its own 8-second round, not on every tab switch.
  useEffect(() => {
    if (!workerMode) return;
    const timer = window.setTimeout(() => loadPaymentGateStatus(selectedMonth), 0);
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadPaymentGateStatus(selectedMonth);
    }, 8000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [selectedMonth, workerMode]);

  // Save buttons call refreshRooms / refreshBilling / refreshDashboard / refreshGate (src/lib/adminRefresh.ts).
  // Each reloads one resource, silently, and only for the month on screen.
  useEffect(() => registerAdminRefresh({
    rooms: (m) => { if (m === selectedMonthRef.current) fetchRooms(m, true); },
    billing: (m) => { if (m === selectedMonthRef.current) fetchBilling(m, true); },
    dashboard: (m) => { if (m === selectedMonthRef.current) fetchDashboard(m, true); },
    gate: (m) => { if (m === selectedMonthRef.current) loadPaymentGateStatus(m); },
  }), []);

  const loadAccounts = () => {
    apiFetch('/api/admin/accounts')
      .then(res => res.json())
      .then(data => {
        if (data?.success) setSheetAccounts(data.accounts);
        else setAdminLoadError(data?.error || 'Chưa tải được danh sách tài khoản.');
      })
      .catch(() => setAdminLoadError('Chưa tải được danh sách tài khoản.'));
  };

  useEffect(() => {
    if (activeMenu === 'accountManagement') loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu]);

  // The sheet is the source of truth, newest requests first; accounts only on this device follow it.
  const allAccounts = useMemo(() => {
    const digits = (phone: string) => phone.replace(/\D/g, '').slice(-9);
    const known = new Set(sheetAccounts.map(acc => digits(acc.phone)));
    const order = { pending: 0, rejected: 1, approved: 2 };
    return [...sheetAccounts, ...registeredAccounts.filter(acc => !known.has(digits(acc.phone)))]
      .sort((a, b) => order[a.status] - order[b.status]);
  }, [sheetAccounts, registeredAccounts]);
  const shownAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return query ? allAccounts.filter(acc => [acc.name, acc.phone, acc.roomNumber].some(value => String(value || '').toLowerCase().includes(query))) : allAccounts;
  }, [allAccounts, accountSearch]);
  const pendingAccountCount = allAccounts.filter(acc => acc.status === 'pending').length;

  const setAccountStatus = async (account: RegisteredAccount, status: RegisteredAccount['status'], message: string) => {
    updateAccountStatus(account.id, status);
    setSheetAccounts(prev => prev.map(acc => (acc.id === account.id ? { ...acc, status } : acc)));
    if (!account.id.startsWith('sheet-')) {
      showPortalToast(message, 'success');
      return;
    }
    try {
      const res = await apiFetch('/api/admin/accounts/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: account.phone, name: account.name, room: account.roomNumber, status })
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error);
      showPortalToast(message, 'success');
    } catch (err: any) {
      showPortalToast(err?.message || 'Chưa cập nhật được trạng thái.', 'error');
      setViewingAccount(prev => (prev?.id === account.id ? { ...prev, status: account.status } : prev));
      loadAccounts();
    }
  };

  const confirmAccountDeletion = async () => {
    if (!accountDeletion) return;
    const { account, mode } = accountDeletion;
    setIsDeletingAccount(true);
    try {
      if (account.id.startsWith('sheet-')) {
        const res = await apiFetch('/api/admin/accounts/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: account.phone, name: account.name, room: account.roomNumber, mode })
        });
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error);
      }
      if (mode === 'account') forgetRegisteredAccount(account.phone);
      showPortalToast(mode === 'account' ? `Đã xoá tài khoản ${account.name}` : `Đã xoá ${account.name} khỏi phòng`, 'success');
      setAccountDeletion(null);
      setViewingAccount(null);
      loadAccounts();
      fetchRooms(selectedMonth, true);
    } catch (err: any) {
      showPortalToast(err?.message || 'Chưa xoá được. Vui lòng thử lại.', 'error');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const loadPaymentGateStatus = (m: string) => {
    if (getSource() === 'worker') {
      const guard = gateGuardRef.current;
      const ticket = guard.beginRead();
      apiFetch(`/api/admin/payment-gate?month=${m}`)
        .then(res => res.json())
        .then(data => {
          if (m !== selectedMonthRef.current || !guard.acceptRead(ticket)) return;
          if (data?.success && data.value) {
            setPaymentGate(data.value);
            setGateMixed(!!data.mixed);
          }
        })
        .catch(() => {});
      return;
    }
    // If Admin clicked toggle within last 20 seconds, ignore background polling so UI doesn't flicker or flip back
    if (Date.now() - lastGateToggleTimeRef.current < 20000) return;

    apiFetch(`/api/admin/payment-gate?month=${m}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(data => {
        if (m !== selectedMonthRef.current || Date.now() - lastGateToggleTimeRef.current < 20000) return;
        if (data.success && data.value) setPaymentGate(data.value);
      })
      .catch(() => {});
  };

  const togglePaymentGate = async () => {
    playSound('click');
    if (getSource() === 'worker') {
      const month = selectedMonth;
      // Mixed: one tap sets every house to the same value (opening is the safer reading of "some are open").
      const nextVal = gateMixed ? 'START' : (paymentGate === 'START' ? 'STOP' : 'START');
      if (gateMixed && !window.confirm('Một số căn đang mở thu, một số căn đang đóng. Mở thu tiền cho tất cả các căn?')) return;
      const guard = gateGuardRef.current;
      guard.beginWrite();
      try {
        const res = await apiFetch('/api/admin/payment-gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, value: nextVal })
        });
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error);
        if (month === selectedMonthRef.current) {
          setPaymentGate(data.value);
          setGateMixed(!!data.mixed);
        }
        playSound('success');
      } catch (e: any) {
        console.warn('Payment gate toggle error:', e);
        alert(e?.message || 'Chưa lưu được cổng thanh toán. Vui lòng thử lại.');
      } finally {
        guard.endWrite();
      }
      return;
    }
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
      if (!data?.success) throw new Error(data?.error);
      setPaymentGate(data.value);
      playSound('success');
    } catch (e: any) {
      console.warn('Payment gate toggle error:', e);
      lastGateToggleTimeRef.current = 0;
      setPaymentGate(nextVal === 'START' ? 'STOP' : 'START');
      alert(e?.message || 'Chưa lưu được cổng thanh toán. Vui lòng thử lại.');
    }
  };

  const fetchDashboard = (month: string, background = false) => {
    if (!background) setIsLoading(true);
    apiFetch(`/api/admin/dashboard?month=${month}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        // A slower answer for a month the admin already left must not repaint the screen.
        if (month !== selectedMonthRef.current) return;
        if (!background) setIsLoading(false);
        if (d.success && d.data) {
          setDashboardData((prev: any) => ({
            ...prev,
            ...d.data
          }));
        }
      })
      .catch(() => { if (background) return; setIsLoading(false); setAdminLoadError('Chưa tải được tổng quan. Vui lòng thử lại.'); });
  };

  const fetchBilling = (month: string, background = false) => {
    const worker = getSource() === 'worker';
    const ticket = worker ? billingGuardRef.current.beginRead() : 0;
    apiFetch(`/api/admin/billing?month=${month}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        // A slower answer for a month the admin already left must not repaint the screen.
        if (month !== selectedMonthRef.current) return;
        if (worker && !billingGuardRef.current.acceptRead(ticket)) return; // a save began or ended after this read started
        if (d.success && Array.isArray(d.billing)) setBillingList(d.billing);
        else if (d.success === false && !background) setAdminLoadError('Chưa tải được danh sách thu tiền. Vui lòng thử lại.');
      })
      .catch(() => { if (!background) setAdminLoadError('Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.'); });
  };

  // background: the 8-second refresh. No spinner, error banners stay as they are, and a failed refresh is silent.
  const loadTabContent = async (menuKey: string, month: string, background = false) => {
    if (!background) setAdminLoadError('');
    if (menuKey === 'dashboard') {
      fetchDashboard(month, background);
      // The dashboard numbers come from /api/admin/dashboard; the room list only fills in gaps, so in
      // worker mode it is not read again when it was loaded a moment ago (and never on the 8 s round).
      const fresh = roomsFetchedRef.current.month === month && Date.now() - roomsFetchedRef.current.at < ROOMS_FRESH_MS;
      if (!(getSource() === 'worker' && (background || fresh))) fetchRooms(month, background);
    } else if (menuKey === 'rooms') {
      fetchRooms(month);
    } else if (menuKey === 'billing') {
      fetchBilling(month, background);
    } else if (menuKey === 'declaration') {
      loadDeclaration(month, declarationHouse);
    } else if (menuKey === 'config') {
      // Worker mode: FeeSettings loads its own per-house config.
      if (getSource() === 'worker') return;
      apiFetch(`/api/admin/config?month=${month}`)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not JSON');
          return res.json();
        })
        .then(d => {
          // A slower answer for a month the admin already left must not repaint the screen.
          if (month !== selectedMonthRef.current) return;
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
          // A slower answer for a month the admin already left must not repaint the screen.
          if (month !== selectedMonthRef.current) return;
          if (d.success) setContractHistory(d.history || []);
          else setAdminLoadError(d.error || 'Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.');
        })
        .catch(() => setAdminLoadError('Chưa tải được dữ liệu cho mục này. Vui lòng thử lại.'));
    }
  };

  // Worker mode: the room list is per house, so ask for each house the admin manages and merge the answers.
  const fetchWorkerRooms = async (month: string): Promise<any> => {
    const token = storage.getItem(STORAGE_KEYS.WORKER_TOKEN);
    const readHouses = async (): Promise<string[] | null> => {
      const hr = await workerFetch('/api/houses');
      const hd = await hr.json().catch(() => null);
      if (!hr.ok || !hd?.success) return null;
      const list: string[] = (hd.houses || []).map((h: any) => h.id).filter(Boolean);
      workerHouseIds.set(token, list);
      return list;
    };
    // Every house at once: one round trip however many houses there are.
    const readRooms = (ids: string[]) => Promise.all(ids.map(async (id) => {
      const r = await workerFetch(`/api/admin/rooms?month=${encodeURIComponent(month)}&houseId=${encodeURIComponent(id)}`);
      return r.json().catch(() => ({ success: false }));
    }));
    const cached = workerHouseIds.get(token);
    let ids = cached || await readHouses();
    if (!ids) return { success: false };
    let parts = await readRooms(ids);
    if (cached && parts.some((d) => !d?.success)) {
      // A remembered house may be gone: read the list again once before giving up.
      workerHouseIds.clear();
      ids = await readHouses();
      if (!ids) return { success: false };
      parts = await readRooms(ids);
    }
    if (parts.some((d) => !d?.success)) return { success: false };
    return { success: true, rooms: parts.flatMap((d) => d.rooms || []) };
  };

  const fetchRooms = (month: string, background = false) => {
    if (!background) setIsLoading(true);
    const worker = getSource() === 'worker';
    const roomsTicket = worker ? roomsGuardRef.current.beginRead() : 0;
    const billingTicket = worker ? billingGuardRef.current.beginRead() : 0;
    (getSource() === 'worker' ? fetchWorkerRooms(month) : apiFetch(`/api/admin/rooms?month=${month}`)
      .then((res: any) => {
        if (!(res instanceof Response)) return res;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      }))
      .then(d => {
        if (month !== selectedMonthRef.current) return;
        setIsLoading(false);
        if (d.success && Array.isArray(d.rooms)) {
          // Worker mode: each list takes the answer only if no save began or ended since the read started.
          const takeRooms = !worker || roomsGuardRef.current.acceptRead(roomsTicket);
          const takeBilling = !worker || billingGuardRef.current.acceptRead(billingTicket);
          if (takeRooms) {
            setRoomsLoadedMonth(month);
            roomsFetchedRef.current = { month, at: Date.now() };
            setRoomsList(d.rooms);
            updateDashboardStats(d.rooms, month);
          }
          if (takeBilling) setBillingList(d.rooms);
        } else if (d.success === false) setAdminLoadError('Chưa tải được danh sách phòng. Vui lòng thử lại.');
      })
      .catch(() => {
        setIsLoading(false);
        setAdminLoadError('Chưa tải được danh sách phòng. Vui lòng thử lại.');
      });
  };

  const openRoomDetail = (room: string, houseId?: string) => {
    playSound('click');
    // Worker mode: the room is told apart by its house (the same name can exist in two houses), so the row's own code is kept.
    const byHouse = getSource() === 'worker' && !!houseId;
    const cleanId = byHouse ? String(room) : canonicalRoomId(room);
    setSelectedRoomId(cleanId);
    setSelectedHouseId(byHouse ? houseId! : '');
    roomBaselineRef.current = null;
    const token = ++detailRequestRef.current;
    setRoomMoneyNote('');
    setRoomFieldErrors({});
    setActiveMenu('roomDetail');
    setCurrentRoomData(null);
    setIsLoading(true);

    // 1. Immediately find from local roomsList
    const localFound = byHouse
      ? roomsList.find(r => r.houseId === houseId && String(r.room) === cleanId)
      : roomsList.find(r => canonicalRoomId(r.room) === cleanId) || roomsList.find(r => r.room === room);
    if (localFound) {
      const cleaned = sanitizeRoomRow(localFound);
      if (byHouse) roomBaselineRef.current = cleaned;
      setCurrentRoomData({
        ...cleaned,
        statusHTML: localFound.paymentStatus === 'paid'
          ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
          : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>'
      });
      setIsLoading(false);
    }

    // 2. Fetch fresh document from backend
    apiFetch(`/api/admin/room-detail?month=${selectedMonth}&room=${encodeURIComponent(cleanId)}${byHouse ? `&houseId=${encodeURIComponent(houseId!)}` : ''}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
        // A slower answer for a room the admin already left must not replace the room on screen (or its Save baseline).
        if (token !== detailRequestRef.current) return;
        setIsLoading(false);
        if (d.success && d.data) {
          const fresh = sanitizeRoomRow(d.data);
          if (byHouse) roomBaselineRef.current = fresh;
          setCurrentRoomData((prev: any) => ({ ...prev, ...fresh }));
        }
      })
      .catch(() => { if (token === detailRequestRef.current) setIsLoading(false); });
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
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        playSound('success');
        setConfigSaveMsg('✅ Đã lưu cấu hình đơn giá thành công!');
        setTimeout(() => setConfigSaveMsg(''), 3000);
      } else {
        setConfigSaveMsg(`Chưa lưu được đơn giá: ${data?.error || 'máy chủ không nhận thay đổi. Vui lòng thử lại.'}`);
        setTimeout(() => setConfigSaveMsg(''), 6000);
      }
    } catch (e) {
      setConfigSaveMsg('Chưa lưu được đơn giá. Kiểm tra mạng rồi thử lại.');
      setTimeout(() => setConfigSaveMsg(''), 6000);
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
    const saved: string[] = [];
    try {
      for (const [room, meters] of entries) {
        const res = await apiFetch('/api/admin/room-detail', {
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
        const reply = await res.json().catch(() => null);
        if (!res.ok || reply?.success === false) throw new Error(reply?.error || `Chưa lưu được chỉ số phòng ${room}.`);
        saved.push(room);
      }
      playSound('success');
      showPortalToast('Đã lưu và đồng bộ chỉ số điện nước lên Google Sheets thành công!', 'success');
      fetchRooms(selectedMonth);
      setBatchMeters({});
    } catch (err: any) {
      showPortalToast('Lỗi lưu chỉ số: ' + (err.message || 'Vui lòng thử lại'), 'error');
      if (saved.length > 0) {
        // Rooms saved before the failure are kept; only the rest stay to be saved again.
        setBatchMeters(prev => Object.fromEntries(Object.entries(prev).filter(([room]) => !saved.includes(room))));
        fetchRooms(selectedMonth);
      }
    } finally {
      setIsSavingBatchMeters(false);
    }
  };

  // ── Worker mode: one room's Save and the paid / unpaid switch ───────────────

  const sameRoomRow = (a: any, b: any) => !!a && !!b && a.houseId === b.houseId && String(a.room) === String(b.room);

  /** The room and billing lists are being written: a read that started earlier cannot overwrite the result. Returns the function that ends it. */
  const beginListsWrite = () => {
    roomsGuardRef.current.beginWrite();
    billingGuardRef.current.beginWrite();
    return () => {
      roomsGuardRef.current.endWrite();
      billingGuardRef.current.endWrite();
    };
  };

  /** One Worker call: ok only for a 2xx answer with success !== false; otherwise `error` is the server's own sentence. */
  const callWorker = async (path: string, init: RequestInit = {}): Promise<{ ok: boolean; data: any; error: string }> => {
    try {
      const res = await workerFetch(path, init);
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success !== false) return { ok: true, data, error: '' };
      return { ok: false, data, error: data?.error || 'Chưa lưu được. Vui lòng thử lại.' };
    } catch {
      return { ok: false, data: null, error: 'Chưa kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' };
    }
  };

  /**
   * A server row of one room replaces what the screen shows for it: the open room (all of it, or only `fields`),
   * its line in the room list (Phòng & Khách) and in the billing list (Thu tiền). Rooms match by house + room code.
   */
  const applyRoomUpdate = (rawRow: any, fields?: string[]) => {
    if (!rawRow) return;
    const row = sanitizeRoomRow(rawRow); // the form and the Save baseline are cleaned the same way
    const subset = fields ? Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]])) : row;
    setRoomsList(prev => {
      const next = prev.map(r => (sameRoomRow(r, row) ? { ...r, ...row } : r));
      updateDashboardStats(next, selectedMonth);
      return next;
    });
    // The billing list shows the full CCCD, which the room row never carries: keep it.
    const { cccd1: _c1, cccd2: _c2, cccd3: _c3, ...forBilling } = row;
    setBillingList(prev => prev.map(r => (sameRoomRow(r, row) ? { ...r, ...forBilling } : r)));
    setCurrentRoomData((prev: any) => (sameRoomRow(prev, row) ? { ...prev, ...subset } : prev));
    if (sameRoomRow(roomBaselineRef.current, row)) roomBaselineRef.current = { ...roomBaselineRef.current, ...subset };
  };

  const METER_FIELDS = ['dienCu', 'dienMoi', 'nuocCu', 'nuocMoi'] as const;
  const MONEY_MAX = 100_000_000;
  const ESTIMATE_FIELDS = ['tienDien', 'tienNuoc', 'tienNet', 'tienXe', 'tongTien', 'dienUsed', 'nuocUsed', 'soNguoi', 'soXe'];

  /** Save in worker mode: meters, then each changed resident, then rent / deposit; each step waits for the server. */
  const saveRoomWorker = async () => {
    const draft = currentRoomData;
    const base = roomBaselineRef.current;
    if (savingRoomRef.current || isSavingRoom) return;
    if (!draft || !base || !sameRoomRow(draft, base)) {
      showPortalToast('Chưa tải xong dữ liệu phòng. Vui lòng đợi một chút rồi lưu lại.', 'error');
      return;
    }
    const month = selectedMonth;
    // Every write names the room of the baseline (the one on screen), never a separate "selected" state.
    const houseId: string = base.houseId;
    const room: string = base.room;
    const roomId = base.roomId;

    // What changed, compared with the row the server last returned.
    const meters: Record<string, number> = {};
    for (const k of METER_FIELDS) if (Number(draft[k] || 0) !== Number(base[k] || 0)) meters[k] = Number(draft[k] || 0);

    const residents: { slot: number; residentId: number; body: Record<string, string> }[] = [];
    const problems: Record<string, string> = {};
    for (const slot of ROOM_SLOTS) {
      const occupant = base.occupants?.[slot - 1];
      if (!occupant) continue;
      const body: Record<string, string> = {};
      const name = String(draft[`nguoi${slot}`] || '').trim();
      const baseName = String(base[`nguoi${slot}`] || '').trim();
      if (name !== baseName) {
        if (!name) problems[`slot${slot}`] = 'Họ tên không được để trống.';
        else body.fullName = name;
      }
      const phone = String(draft[`sdt${slot}`] || '').trim();
      if (normalizeVnPhone(phone) !== normalizeVnPhone(String(base[`sdt${slot}`] || ''))) {
        const problem = phoneProblem(phone);
        if (problem) problems[`slot${slot}`] = problems[`slot${slot}`] || problem;
        else body.phone = phone;
      }
      const plate = String(draft[`xe${slot}`] || '').trim();
      if (plate !== String(base[`xe${slot}`] || '').trim()) body.plateNumber = plate;
      const cccd = String(draft[`cccd${slot}`] || '').trim();
      if (cccd) body.cccd = cccd;
      if (Object.keys(body).length > 0) residents.push({ slot, residentId: occupant.residentId, body });
    }

    const money: Record<string, number> = {};
    for (const [field, key] of [['roomPrice', 'price'], ['roomDeposit', 'deposit']] as const) {
      const value = Number(draft[field] || 0);
      if (value === Number(base[field] || 0)) continue;
      if (!Number.isInteger(value) || value < 0 || value > MONEY_MAX) {
        problems.money = `${key === 'price' ? 'Tiền phòng' : 'Tiền cọc'} phải từ 0 đến ${fmt(MONEY_MAX)} đ.`;
      } else money[key] = value;
    }

    if (Object.keys(problems).length > 0) {
      setRoomFieldErrors(problems);
      showPortalToast(Object.values(problems)[0], 'error');
      return;
    }
    if (Object.keys(meters).length === 0 && residents.length === 0 && Object.keys(money).length === 0) {
      showPortalToast('Chưa có thay đổi nào để lưu.', 'info');
      return;
    }

    type Step = { key: string; kind: 'meters' | 'resident' | 'money'; run: () => Promise<{ ok: boolean; data: any; error: string }> };
    const steps: Step[] = [];
    if (Object.keys(meters).length > 0) {
      steps.push({ key: 'meters', kind: 'meters', run: () => callWorker('/api/admin/room-detail', { method: 'POST', body: JSON.stringify({ month, houseId, room, data: meters }) }) });
    }
    for (const r of residents) {
      steps.push({ key: `slot${r.slot}`, kind: 'resident', run: () => callWorker(`/api/admin/residents/${encodeURIComponent(String(r.residentId))}`, { method: 'PATCH', body: JSON.stringify({ houseId, ...r.body }) }) });
    }
    if (Object.keys(money).length > 0) {
      steps.push({ key: 'money', kind: 'money', run: () => callWorker(`/api/admin/rooms/${encodeURIComponent(String(roomId))}`, { method: 'PATCH', body: JSON.stringify({ houseId, month, ...money }) }) });
    }

    playSound('click');
    savingRoomRef.current = true;
    setIsSavingRoom(true);
    setRoomFieldErrors({});
    setRoomMoneyNote('');
    const endWrite = beginListsWrite();
    let latest: any = null; // the newest row of the selected month the server returned
    let latestIsCurrent = true; // false once a resident step succeeded after it (that answer is for the current month)
    let anySaved = false;
    let note = '';
    let failure: { index: number; step: Step; error: string } | null = null;
    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i].run();
      if (!result.ok) {
        failure = { index: i, step: steps[i], error: result.error };
        break;
      }
      anySaved = true;
      if (steps[i].kind === 'resident') latestIsCurrent = false;
      else if (result.data?.data) {
        latest = result.data.data;
        latestIsCurrent = true;
      }
      if (steps[i].kind === 'money' && result.data?.appliesFrom === 'next_month') note = String(result.data.message || '');
    }
    // A resident answer describes the current month: read the selected month's row again.
    if (anySaved && !latestIsCurrent) {
      const fresh = await callWorker(`/api/admin/room-detail?month=${encodeURIComponent(month)}&room=${encodeURIComponent(room)}&houseId=${encodeURIComponent(houseId)}`);
      if (fresh.ok && fresh.data?.data) latest = fresh.data.data;
    }
    endWrite();
    savingRoomRef.current = false;
    setIsSavingRoom(false);
    if (month !== selectedMonthRef.current) { // the admin moved to another month meanwhile: nothing of this one belongs on screen
      if (failure) showPortalToast(failure.error, 'error');
      else if (anySaved) showPortalToast('Đã lưu', 'success');
      return;
    }

    // The screen: the server's row, so a failed part goes back to the saved value; parts not tried yet keep what was typed.
    if (latest) latest = sanitizeRoomRow(latest);
    if (latest) applyRoomUpdate(latest);
    const server = latest || base;
    const untried = failure ? steps.slice(failure.index + 1) : [];
    const kept: Record<string, any> = {};
    for (const step of untried) {
      if (step.kind === 'meters') METER_FIELDS.forEach(k => { kept[k] = draft[k]; });
      else if (step.kind === 'resident') {
        const slot = Number(step.key.slice(4));
        ['nguoi', 'cccd', 'sdt', 'xe'].forEach(f => { kept[`${f}${slot}`] = draft[`${f}${slot}`]; });
      } else ['roomPrice', 'roomDeposit', 'tienCoc'].forEach(k => { kept[k] = draft[k]; });
    }
    if (Object.keys(kept).length > 0) ESTIMATE_FIELDS.forEach(k => { kept[k] = draft[k]; });
    setCurrentRoomData((prev: any) => (prev && sameRoomRow(prev, server) ? { ...prev, ...server, ...kept } : prev));

    if (anySaved) {
      refreshRooms(month);
      refreshBilling(month);
      refreshDashboard(month);
    }
    if (failure) {
      setRoomFieldErrors({ [failure.step.key]: failure.error });
      showPortalToast(anySaved ? `${failure.error} (Phần đã lưu trước đó được giữ lại.)` : failure.error, 'error');
      return;
    }
    playSound('success');
    setRoomMoneyNote(note);
    showPortalToast(note ? `Đã lưu. ${note}` : 'Đã lưu', 'success');
  };

  /** What the confirmation lists before a room save (worker mode compares with the row last read; sheet mode saves the whole row). */
  const roomSaveSummary = (draft: any, base: any): string[] => {
    if (!draft) return [];
    if (!workerMode || !base) return ['Chỉ số điện nước, người ở và các khoản tiền đang hiện trên màn hình.'];
    const out: string[] = [];
    if (METER_FIELDS.some(k => Number(draft[k] || 0) !== Number(base[k] || 0))) out.push(`Chỉ số: điện ${draft.dienCu || 0} → ${draft.dienMoi || 0}, nước ${draft.nuocCu || 0} → ${draft.nuocMoi || 0}`);
    for (const slot of ROOM_SLOTS) {
      const changed = ['nguoi', 'sdt', 'xe'].some(f => String(draft[`${f}${slot}`] || '').trim() !== String(base[`${f}${slot}`] || '').trim()) || String(draft[`cccd${slot}`] || '').trim() !== '';
      if (changed && base.occupants?.[slot - 1]) out.push(`Thông tin ${String(draft[`nguoi${slot}`] || '').trim() || `người ${slot}`}`);
    }
    if (Number(draft.roomPrice || 0) !== Number(base.roomPrice || 0)) out.push(`Tiền phòng: ${fmt(draft.roomPrice)} đ`);
    if (Number(draft.roomDeposit || 0) !== Number(base.roomDeposit || 0)) out.push(`Tiền cọc: ${fmt(draft.roomDeposit)} đ`);
    return out;
  };

  /** The live estimate of the room screen: the month's lines added up (the server's total replaces it after saving). */
  const roomParts = (o: any) => (o.tienPhong || 0) + (o.tienDien || 0) + (o.tienNuoc || 0) + (o.tienRac || 0) + (o.tienNet || 0) + (o.tienXe || 0) + (o.tienKhac || 0);
  const withRoomTotal = (o: any) => {
    // Worker mode: the server's total holds lines the old columns do not (services without a sheet column), so the
    // estimate is that total moved by what was edited on screen.
    const base = roomBaselineRef.current;
    if (workerMode && base && sameRoomRow(base, o) && typeof base.tongTien === 'number') {
      return { ...o, tongTien: base.tongTien + roomParts(o) - roomParts(base) };
    }
    return { ...o, tongTien: roomParts(o) };
  };

  /** One service on / off for the open room (worker mode): saves the room's opt-out list at once, then reads the room again. */
  const toggleRoomService = async (serviceId: number, on: boolean) => {
    const base = roomBaselineRef.current;
    if (savingServices || savingRoomRef.current || isSavingRoom) return;
    if (!base?.roomId || !sameRoomRow(currentRoomData, base)) {
      showPortalToast('Chưa tải xong dữ liệu phòng. Vui lòng đợi một chút rồi thử lại.', 'error');
      return;
    }
    const month = selectedMonth;
    const current: number[] = Array.isArray(currentRoomData?.optOut) ? currentRoomData.optOut : [];
    const optOut = on ? current.filter(id => id !== serviceId) : [...new Set([...current, serviceId])];
    setSavingServices(true);
    setRoomFieldErrors(prev => { const { services: _s, ...rest } = prev; return rest; });
    const endWrite = beginListsWrite();
    const result = await callWorker(`/api/admin/rooms/${encodeURIComponent(String(base.roomId))}/services`, {
      method: 'PUT',
      body: JSON.stringify({ houseId: base.houseId, month, optOut })
    });
    let fresh: any = null;
    if (result.ok) {
      const read = await callWorker(`/api/admin/room-detail?month=${encodeURIComponent(month)}&room=${encodeURIComponent(base.room)}&houseId=${encodeURIComponent(base.houseId)}`);
      if (read.ok) fresh = read.data?.data;
    }
    endWrite();
    setSavingServices(false);
    if (!result.ok) {
      setRoomFieldErrors(prev => ({ ...prev, services: result.error }));
      showPortalToast(result.error, 'error');
      return;
    }
    if (month !== selectedMonthRef.current) return;
    const saved: number[] = Array.isArray(result.data?.optOut) ? result.data.optOut : optOut;
    // Only what the switch changes: the opt-outs and the invoice lines; anything typed and not saved yet stays.
    const fields = ['optOut', 'lines', 'feeLines', 'tienRac', 'tienNet', 'tienXe', 'tienKhac', 'tongTien', 'soNet', 'status', 'paymentStatus', 'statusText', 'draft', 'surplus'];
    if (fresh) applyRoomUpdate({ ...fresh, optOut: saved }, fields);
    else {
      const total = result.data?.invoice?.total;
      applyRoomUpdate({ ...base, optOut: saved, ...(typeof total === 'number' ? { tongTien: total } : {}) }, ['optOut', 'tongTien']);
    }
    refreshRooms(month);
    refreshBilling(month);
    refreshDashboard(month);
    playSound('success');
    showPortalToast(on ? 'Đã bật dịch vụ cho phòng này' : 'Đã tắt dịch vụ cho phòng này', 'success');
  };

  /** Paid / unpaid in worker mode: the switch flips at once, the server answers, a refusal puts it back with the server's reason. */
  const setPaymentStatusWorker = async (roomNumber: string, status: 'paid' | 'unpaid', houseIdGiven?: string) => {
    const month = selectedMonth;
    const known = roomsList.find(r => sameRoomRow(r, { houseId: houseIdGiven, room: roomNumber }))
      || billingList.find(r => sameRoomRow(r, { houseId: houseIdGiven, room: roomNumber }))
      || roomsList.find(r => canonicalRoomId(r.room) === canonicalRoomId(roomNumber));
    const houseId = houseIdGiven || known?.houseId || '';
    const code = known?.room ?? roomNumber;
    const lockKey = `${houseId}|${code}`;
    if (payingRef.current.has(lockKey)) return; // this room's switch is still waiting for the server
    const hit = (r: any) => (houseId ? sameRoomRow(r, { houseId, room: code }) : canonicalRoomId(r?.room) === canonicalRoomId(code));
    const patchStatus = (fields: Record<string, any>) => {
      setRoomsList(prev => {
        const next = prev.map(r => (hit(r) ? { ...r, ...fields } : r));
        updateDashboardStats(next, month);
        return next;
      });
      setBillingList(prev => prev.map(r => (hit(r) ? { ...r, ...fields } : r)));
      setCurrentRoomData((prev: any) => (prev && hit(prev) ? { ...prev, ...fields } : prev));
    };
    const before = { status: known?.status, paymentStatus: known?.paymentStatus, statusText: known?.statusText, statusHTML: known?.statusHTML };
    patchStatus({
      status,
      paymentStatus: status,
      statusText: status === 'paid' ? 'Đã đóng' : 'Chưa đóng',
      statusHTML: status === 'paid'
        ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
        : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>'
    });
    payingRef.current.add(lockKey);
    const endWrite = beginListsWrite();
    const result = await callWorker('/api/admin/payment-status', {
      method: 'POST',
      body: JSON.stringify({ roomNumber: code, status, month, houseId })
    });
    endWrite();
    payingRef.current.delete(lockKey);
    if (!result.ok) {
      patchStatus(before);
      showPortalToast(result.error, 'error');
      return;
    }
    playSound('success');
    refreshRooms(month);
    refreshBilling(month);
    refreshDashboard(month);
  };

  const updateRoomPaymentStatus = async (roomNumber: string, status: 'paid' | 'unpaid', row?: number, houseId?: string) => {
    playSound('click');
    if (getSource() === 'worker') {
      await setPaymentStatusWorker(roomNumber, status, houseId);
      return;
    }
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
    billing: { title: 'Hoá đơn', description: 'Hoá đơn từng phòng trong tháng: bấm vào phòng để xem chi tiết.' },
    utilities: { title: 'Công cụ quản lý', description: 'Chọn công việc bạn cần thực hiện.' },
    meter: { title: 'Chỉ số điện nước', description: 'Nhập chỉ số từng phòng theo kỳ tháng.' },
    contract: { title: 'Hồ sơ cư trú', description: 'Tờ khai CT01 và hợp đồng thuê phòng.' },
    invoices: { title: 'Hoá đơn phòng', description: 'Xem, in hoặc lưu PDF hoá đơn của từng phòng theo kỳ tháng.' },
    declaration: { title: 'Kê khai doanh thu', description: 'Sổ doanh thu theo hộ kinh doanh và kỳ tháng.' },
    config: { title: 'Đơn giá dịch vụ', description: 'Điều chỉnh đơn giá đang áp dụng trong tháng.' },
    createNotification: { title: 'Thông báo cư dân', description: 'Soạn nội dung và chọn người nhận.' },
    laundry: { title: 'Quản lý giặt sấy', description: 'Kiểm tra máy, giá dịch vụ và lịch đặt chỗ.' },
    accountManagement: { title: 'Quản lý tài khoản', description: 'Xét duyệt yêu cầu đăng ký và tạo tài khoản mới cho cư dân.' },
    paymentPortal: { title: 'Thông tin thanh toán', description: 'Ngân hàng và số tài khoản nhận tiền phòng của từng nhà.' }
  };
  const roomDetailTitle = (() => {
    const name = currentRoomData?.roomName || selectedRoomId;
    if (!name) return 'Chi tiết phòng';
    const house = accountTargets.houses.length > 1 ? accountTargets.houses.find(h => h.id === (currentRoomData?.houseId || selectedHouseId)) : undefined;
    return `Chi tiết phòng ${name}${house ? ` · ${house.abbreviation || house.name}` : ''}`;
  })();
  const currentAdminPage = activeMenu === 'roomDetail'
    ? { ...adminPageTitles.roomDetail, title: roomDetailTitle }
    : adminPageTitles[activeMenu] || adminPageTitles.dashboard;
  const normalizeAdminSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const filterAdminRows = (row: any) => {
    const searchableFields = [
      row.room,
      row.roomName,
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
    const query = compactSearch(adminSearch);
    // A plate or phone typed without its dots, dashes or spaces ("59x188888") still finds "59-X1 888.88".
    const matchesSearch = normalizeAdminSearch(searchableFields.filter(Boolean).join(' ')).includes(normalizeAdminSearch(adminSearch))
      || (query.length >= 3 && searchableFields.some(field => compactSearch(field).includes(query)));
    return matchesSearch && matchesRoomFilters(row, workerMode ? houseFilter : 'all', collectionFilter);
  };
  const compactSearch = (value: unknown) => normalizeAdminSearch(value).replace(/[^a-z0-9]/g, '');
  const matchingPlates = (row: any) => {
    const query = compactSearch(adminSearch);
    if (query.length < 3) return [];
    return [row.xe1, row.xe2, row.xe3].filter(plate => plate && compactSearch(plate).includes(query));
  };
  const visibleRooms = roomsList.filter(filterAdminRows);
  const visibleBilling = billingList.filter(filterAdminRows);
  const selectionOn = workerMode && isWorkerStaff;
  useEffect(() => { setPickedBilling(new Set()); }, [selectedMonth, houseFilter]);
  const pickedRows = visibleBilling.filter(item => pickedBilling.has(billingKey(item)));
  const allPicked = visibleBilling.length > 0 && pickedRows.length === visibleBilling.length;
  const togglePicked = (item: any) => setPickedBilling(prev => { const next = new Set(prev); const k = billingKey(item); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const toggleAllPicked = () => setPickedBilling(allPicked ? new Set() : new Set(visibleBilling.map(billingKey)));

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

  const selectedInvoiceRoom: any = roomsList.find((r: any) => r.room === invoiceRoom && (!invoiceHouse || r.houseId === invoiceHouse))
    || roomsList.find((r: any) => r.room === invoiceRoom) || roomsList[0];
  /** Hoá đơn list → one room's invoice (the same view as before); Back returns to the list where it was. */
  const openBillingInvoice = (item: any) => {
    playSound('click');
    billingScrollRef.current = window.scrollY;
    setInvoiceRoom(item.room);
    setInvoiceHouse(item.houseId || '');
    setInvoiceFromBilling(true);
    setActiveMenu('invoices');
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (activeMenu !== 'billing' || billingScrollRef.current === null) return;
    const y = billingScrollRef.current;
    billingScrollRef.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }, [activeMenu]);
  // Worker mode, Hoá đơn list: a small QR per issued invoice; tapping it copies that room's payment link.
  const monthLinks = useMonthLinks(workerMode && activeMenu === 'billing', selectedMonth, billingList.map((r: any) => String(r.houseId || '')).filter(Boolean), billingList.filter((r: any) => r.invoiceId != null && !r.draft).length);
  const linkOf = (item: any) => (item.invoiceId != null && !item.draft ? monthLinks[`${item.houseId}|${item.invoiceId}`] : undefined);
  const copiedLinkToast = (message: string, ok: boolean) => showPortalToast(message, ok ? 'success' : 'error');
  // Worker mode: the printed invoice carries a QR linking to that room's public payment page (unpaid only).
  const invoiceLinkTarget = workerMode && selectedInvoiceRoom?.invoiceId != null && !selectedInvoiceRoom?.draft
    ? { houseId: String(selectedInvoiceRoom.houseId || ''), invoiceId: Number(selectedInvoiceRoom.invoiceId) } : null;
  const invoicePayment = usePaymentBlock({
    houseId: invoiceLinkTarget?.houseId ?? null,
    invoiceId: invoiceLinkTarget?.invoiceId ?? null,
    paid: (selectedInvoiceRoom?.paymentStatus || selectedInvoiceRoom?.status) === 'paid',
  });
  const { doc: invoiceDoc } = useBuiltDocument(
    m => roomInvoice(m, selectedInvoiceRoom || { room: '' }, selectedMonth, invoicePayment),
    `${selectedMonth}|${JSON.stringify(selectedInvoiceRoom || null)}|${invoicePayment ? invoicePayment.qrPng.length + String(invoicePayment.payCode) : String(invoicePayment)}`,
    invoicePayment !== undefined
  );
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const copyInvoiceLink = async () => {
    if (!invoiceLinkTarget || linkBusy) return;
    setLinkBusy(true);
    setLinkMessage(null);
    try {
      const link = await fetchPublicLink(invoiceLinkTarget.houseId, invoiceLinkTarget.invoiceId);
      await navigator.clipboard.writeText(link.url).then(
        () => setLinkMessage({ ok: true, text: 'Đã sao chép link thanh toán.' }),
        () => setLinkMessage({ ok: true, text: link.url }),
      );
    } catch (err: any) {
      setLinkMessage({ ok: false, text: err?.message || 'Chưa lấy được link thanh toán. Vui lòng thử lại.' });
    } finally {
      setLinkBusy(false);
    }
  };


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
    <div className="admin-portal-root min-h-screen relative isolate text-neutral-800 dark:text-neutral-100 flex flex-col lg:flex-row antialiased">
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
                    <span data-brand-title className="apple-title2 kit-text-primary block truncate whitespace-nowrap font-semibold">Trọ-Hub</span>
                    <span className="admin-role-badge px-1.5 py-0.2 text-[10px] font-bold rounded-md font-num border uppercase">
                      Admin
                    </span>
                  </div>
                  <p data-brand-subtitle className="text-[11px] text-neutral-600 font-medium truncate dark:text-neutral-300">
                    {accountTargets.houses.length === 1 ? accountTargets.houses[0].name : 'Quản lý chủ trọ'}
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
                { key: 'billing', label: 'Hoá đơn', icon: NavIcons.Receipt },
                { key: 'utilities', label: 'Tiện ích', icon: NavIcons.LayoutGrid }
              ].map(item => {
                const Icon = item.icon;
                const isActive = activeMenu === item.key ||
                  (item.key === 'rooms' && activeMenu === 'roomDetail') || (item.key === 'billing' && activeMenu === 'invoices') ||
                  (item.key === 'utilities' && ['meter', 'contract', 'declaration', 'config', 'createNotification', 'laundry', 'accountManagement', 'paymentPortal'].includes(activeMenu));
                return (

                  <button
                    key={item.key}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      playSound('click');
                      setActiveMenu(item.key as any);
                    }}
                    className={cn(
                      "kit-nav-item group relative flex min-h-11 items-center gap-3 rounded-xl px-3 apple-body select-none cursor-pointer",
                      sidebarCollapsedLayout ? "mx-auto w-11 justify-center px-0" : "w-full",
                      isActive && "kit-nav-active"
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
                          monthPickedByHand.current = true;
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
                    title={`Chế độ màn hình: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động'}`}
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

                {/* 3. Cổng thanh toán (Sheet mode only: on the Worker, "Tạo hoá đơn" on the Hoá đơn tab opens payments) */}
                {!workerMode && <div className="soft-surface p-3 rounded-2xl relative overflow-hidden flex items-center justify-between">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
                  <div>
                    <p className="text-[10px] text-neutral-600 dark:text-neutral-200 font-bold uppercase tracking-wider">Cổng thanh toán</p>
                    <p className={cn("text-xs font-black uppercase font-num mt-0.5", gateMixed ? "text-amber-600 dark:text-amber-400" : paymentGate === 'START' ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {gateMixed ? 'Một số căn đang mở thu' : (paymentGate === 'START' ? 'Mở' : 'Tắt')}
                    </p>
                  </div>
                  <AppleSwitch
                    checked={paymentGate === 'START'}
                    onChange={togglePaymentGate}
                    color="emerald"
                    size="md"
                    ariaLabel="Bật tắt Cổng thanh toán"
                  />
                </div>}

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
                  title={`Chế độ màn hình: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động (Theo giờ)'}`}
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

                {/* Payment Gate in Collapsed Mode (Sheet mode only) */}
                {!workerMode && <button
                  type="button"
                  onClick={togglePaymentGate}
                  className={cn(
                    "w-11 h-11 rounded-2xl flex items-center justify-center text-white cursor-pointer shadow-xs  transition-all",
                    paymentGate === 'START' ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600"
                  )}
                  title={`Cổng thanh toán: ${paymentGate}`}
                >
                  <NavIcons.Power size={18} />
                </button>}

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
                {isAdminTong ? 'Chủ trọ' : workerViewer?.role === 'manager' ? 'Ban Quản Lý Trọ' : 'Admin'}
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
                    monthPickedByHand.current = true;
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
              title={`Chế độ màn hình: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động (Theo giờ)'}`}
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

          </div>
        </header>
        {!adminLoadError && roomsLoadedMonth === selectedMonth && roomsList.length === 0 && (
          <p role="status" className="soft-card mb-5 p-4 apple-body kit-text-secondary">Chưa có dữ liệu tháng {selectedMonth}.</p>
        )}

        {adminLoadError && <div role="alert" className="admin-load-error kit-data-surface rounded-[18px] p-4 mb-4"><div><p className="apple-headline kit-text-primary">Không thể cập nhật dữ liệu</p><p className="apple-callout kit-text-secondary mt-1">{adminLoadError}</p></div><button type="button" className="soft-button min-h-11 px-4" onClick={() => { setAdminLoadError(''); loadTabContent(activeMenu, selectedMonth); }}><RefreshCw size={18} />Thử lại</button></div>}
        {(activeMenu === 'rooms' || activeMenu === 'billing') && <div className="admin-list-toolbar kit-data-surface rounded-[20px] p-3 mb-4">
          <label className="admin-search-field"><Search size={21} /><input type="search" data-stage-filter="admin-room-results" value={adminSearch} onChange={event => setAdminSearch(event.target.value)} placeholder="Tìm phòng, tên, số điện thoại hoặc biển số xe" aria-label="Tìm phòng, tên, số điện thoại hoặc biển số xe" /></label>
          <div className="admin-list-filters">
            {workerMode && accountTargets.houses.length > 0 && (
              <label className="admin-status-filter"><span className="sr-only">Căn</span><select data-stage-filter="admin-room-results" value={houseFilter} onChange={event => setHouseFilter(event.target.value)} aria-label="Lọc theo căn"><option value="all">Tất cả căn</option>{accountTargets.houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
            )}
            <label className="admin-status-filter"><span className="sr-only">Trạng thái</span><select data-stage-filter="admin-room-results" value={collectionFilter} onChange={event => setCollectionFilter(event.target.value)} aria-label="Lọc trạng thái"><option value="all">Tất cả</option><option value="vacant">Còn trống</option><option value="occupied">Đã ở</option><option value="unpaid">Chưa đóng</option><option value="pending">Chờ xác nhận</option><option value="paid">Đã đóng</option></select></label>
          </div>
          <p role="status" className="admin-result-count apple-callout kit-text-secondary">{activeMenu === 'rooms' ? visibleRooms.length : visibleBilling.length} kết quả</p>
        </div>}

        {activeMenu === 'utilities' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 mb-6">
            {[
              { key: 'accountManagement', label: 'Quản lý tài khoản', icon: IconProfile3D },
              { key: 'createNotification', label: 'Tạo thông báo', icon: IconNotification3D },
              { key: 'meter', label: 'Điện nước', icon: IconMeter3D },
              { key: 'contract', label: 'Hợp đồng & CT01', icon: IconContract3D },
              { key: 'declaration', label: 'Kỳ kê khai', icon: IconCalendar3D },
              { key: 'config', label: 'Đơn giá dịch vụ', icon: IconSettings3D },
              { key: 'laundry', label: 'Giặt Sấy 24/7', icon: IconLaundry3D }
            ].filter(item => !enabledModules || enabledModules.has(item.key)).map(item => {
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

        {prepNotice && createPortal(
          <div className="tahoe-dialog-overlay fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={() => setPrepNotice(null)}>
            <div role="dialog" aria-modal="true" aria-labelledby="prep-notice-title" data-testid="prep-banner" onClick={(e) => e.stopPropagation()}
              className="tahoe-dialog w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
              <h2 id="prep-notice-title" className="apple-title3 font-semibold kit-text-primary">Đang chuẩn bị hoá đơn tháng {prepNotice}</h2>
              <p className="mt-2 apple-body kit-text-secondary">Cư dân chưa thấy hoá đơn tháng này cho tới khi bạn bấm Tạo hoá đơn ở mục Hoá đơn.</p>
              <button type="button" autoFocus onClick={() => setPrepNotice(null)} className="primary-button mt-5 min-h-11 w-full px-4">Đã hiểu</button>
            </div>
          </div>,
          document.body,
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
                      Tổng tiền đã hạch toán
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
                    <span className="whitespace-nowrap tabular-nums text-xs font-bold text-neutral-900 dark:text-white font-num">{fmt(dashboardData?.tienDien ?? 0)} đ</span>
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
                    <span className="whitespace-nowrap tabular-nums text-xs font-bold text-neutral-900 dark:text-white font-num">{fmt(dashboardData?.tienNuoc ?? 0)} đ</span>
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
                <UsageBarCharts
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
            {!isLoading && !adminLoadError && visibleRooms.length === 0 && <AdminEmptyState filtered={Boolean(adminSearch || collectionFilter !== 'all' || (workerMode && houseFilter !== 'all'))} title="Chưa có thông tin phòng" />}
            <div id="admin-room-results" data-stage="list" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {visibleRooms.map(r => {
                const isPaid = (r.paymentStatus || r.status) === 'paid';
                const isPending = (r.paymentStatus || r.status) === 'pending';
                const residents = occupiedSlots(r);
                return (
                  <div
                    key={r.room}
                    className="admin-room-card soft-card p-5 flex flex-col gap-4 hover:border-neutral-500 transition-all cursor-pointer group"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openRoomDetail(r.room, r.houseId)}
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
                          onChange={() => updateRoomPaymentStatus(r.room, isPaid ? 'unpaid' : 'paid', r.row, r.houseId)}
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

                    {workerMode && accountTargets.houses.length > 1 && (() => {
                      const house = accountTargets.houses.find(h => h.id === r.houseId);
                      return house ? <p className="-mt-2 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 truncate">{house.abbreviation || house.name}</p> : null;
                    })()}
                    <RoomOccupancy count={residents.length} capacity={roomCapacity(r)} />

                    {/* A plate search shows which plate brought this room up. */}
                    {matchingPlates(r).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {matchingPlates(r).map(plate => (
                          <span key={plate} className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 font-mono text-xs font-bold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white">{plate}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!sourceReady && ['roomDetail', 'meter', 'config'].includes(activeMenu) && (
          <p role="status" className="soft-card p-5 apple-body kit-text-secondary">Đang tải…</p>
        )}

        {/* Room Detail Editor: compact, the key numbers fit a laptop screen without scrolling */}
        {sourceReady && activeMenu === 'roomDetail' && currentRoomData && (() => {
          const room = currentRoomData;
          const inputCls = 'w-full min-w-0 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-100/70 dark:disabled:bg-neutral-800/50';
          const labelCls = 'text-[10px] font-bold text-neutral-600 dark:text-neutral-300 uppercase block mb-0.5';
          const setMeter = (kind: 'dien' | 'nuoc', which: 'Cu' | 'Moi', value: string) => {
            const next = { ...room, [`${kind}${which}`]: Number(value) || 0 };
            const used = Math.max(0, (Number(next[`${kind}Moi`]) || 0) - (Number(next[`${kind}Cu`]) || 0));
            const money = used * (kind === 'dien' ? units.dien : units.nuoc);
            setCurrentRoomData(withRoomTotal({ ...next, [`${kind}Used`]: used, [kind === 'dien' ? 'tienDien' : 'tienNuoc']: money }));
          };
          const moneyInput = (value: number, onValue: (n: number) => void, label: string, disabled = false) => (
            <span className="relative block w-32 shrink-0">
              <input type="text" inputMode="numeric" aria-label={label} value={value ? fmt(value) : ''} placeholder="0" disabled={disabled} readOnly={disabled}
                onChange={e => onValue(parseCurrency(e.target.value))}
                className={cn(inputCls, 'pr-6 text-right font-mono tabular-nums')} />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-600 dark:text-neutral-300 pointer-events-none">đ</span>
            </span>
          );
          const line = (label: string, amount: number | null | undefined, note?: string) => (
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-neutral-700 dark:text-neutral-200">{label}{note && <span className="ml-1 text-[11px] text-neutral-500 dark:text-neutral-400">{note}</span>}</span>
              <span className="whitespace-nowrap tabular-nums text-xs font-bold text-neutral-900 dark:text-white">{fmt(amount ?? 0)} đ</span>
            </div>
          );
          const sheetFee = (field: 'tienRac' | 'tienNet' | 'tienXe', label: string) => workerMode ? line(label, room[field]) : (
            <div className="flex items-center justify-between gap-3 py-0.5">
              <span className="text-xs text-neutral-700 dark:text-neutral-200">{label}</span>
              {moneyInput(room[field], n => setCurrentRoomData(withRoomTotal({ ...room, [field]: n })), label)}
            </div>
          );
          // Worker mode: the saved invoice's service lines (every service, by its own name); the old three columns otherwise.
          const serviceLines: any[] | null = workerMode && room.invoiceId != null && Array.isArray(room.lines) ? room.lines.filter((l: any) => l.kind === 'service') : null;
          const optOut: number[] = Array.isArray(room.optOut) ? room.optOut : [];
          // Worker mode: the saved amount moved by the change in count (the server's columns are the reference); sheet mode: count × price.
          const estimateFromBase = (field: 'tienXe' | 'tienNet', prefix: 'xe' | 'nguoi', count: number, unit: number) => {
            const base = roomBaselineRef.current;
            if (!workerMode || !base || !sameRoomRow(base, room)) return count * unit;
            const baseCount = ROOM_SLOTS.filter(slot => String(base[`${prefix}${slot}`] || '').trim()).length;
            return Number(base[field] || 0) + (count - (prefix === 'nguoi' ? Math.max(baseCount, 1) : baseCount)) * unit; // only the total uses it in worker mode
          };
          const services = workerMode ? (roomConfig?.services || []) : [];
          const shownSlots = ROOM_SLOTS.filter(slot => occupiedSlots(room).includes(slot) || openedSlots.includes(slot));
          const freeSlot = ROOM_SLOTS.find(slot => !shownSlots.includes(slot));
          const estimate = workerMode && roomBaselineRef.current && room.tongTien !== roomBaselineRef.current.tongTien;
          return (
          <div className="admin-room-detail space-y-3 pb-28 sm:pb-24">
            <div className="admin-section-toolbar soft-card px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => {
                  playSound('click');
                  setActiveMenu('rooms');
                }}
                className="soft-button min-h-11 py-1.5 px-3 text-xs flex items-center gap-2 cursor-pointer font-bold"
              >
                <ArrowLeft size={16} />
                <span>Danh sách phòng</span>
              </button>
              <div className="flex items-center gap-2">
                <AppleSwitch
                  checked={room.paymentStatus === 'paid'}
                  onChange={() => updateRoomPaymentStatus(selectedRoomId, room.paymentStatus === 'paid' ? 'unpaid' : 'paid', room.row, selectedHouseId || undefined)}
                  color="emerald"
                  size="md"
                  ariaLabel="Trạng thái thu tiền phòng"
                />
                <span className={cn("text-xs font-bold min-w-16 transition-colors", room.paymentStatus === 'paid' ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-300")}>
                  {room.paymentStatus === 'paid' ? 'Đã đóng' : 'Chưa đóng'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-3 items-start">
              <div className="space-y-3 min-w-0">
                {/* Residents: one dense row per person */}
                <section className="soft-card p-3 sm:p-4" aria-label="Người ở">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h4 className="font-bold text-neutral-900 dark:text-white text-sm">Người ở</h4>
                    <RoomOccupancy count={occupiedSlots(room).length} capacity={roomCapacity(room)} />
                  </div>
                  {shownSlots.length === 0 && <p className="text-xs text-neutral-600 dark:text-neutral-300">Phòng đang trống.</p>}
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {shownSlots.map(slot => (
                      <div key={slot} data-slot={slot} onChangeCapture={() => setOpenedSlots(prev => prev.includes(slot) ? prev : [...prev, slot])} className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 first:pt-0 last:pb-0">
                        <label className="min-w-0">
                          <span className={labelCls}>Người {slot}</span>
                          <input
                            type="text"
                            value={room[`nguoi${slot}`] || ''}
                            onChange={e => {
                              const val = e.target.value;
                              const nextRoom = { ...room, [`nguoi${slot}`]: val };
                              const validOccupants = [nextRoom.nguoi1, nextRoom.nguoi2, nextRoom.nguoi3].filter(n => n && !/^\d+(\.\d+)?$/.test(String(n).trim())).length;
                              const soNguoi = validOccupants > 0 ? validOccupants : 1;
                              nextRoom.soNguoi = soNguoi;
                              nextRoom.tienNet = estimateFromBase('tienNet', 'nguoi', soNguoi, units.net);
                              setCurrentRoomData(withRoomTotal(nextRoom));
                            }}
                            placeholder="Họ tên"
                            className={inputCls}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className={labelCls}>Điện thoại</span>
                          <input
                            type="text"
                            inputMode="tel"
                            value={room[`sdt${slot}`] || ''}
                            onChange={e => setCurrentRoomData({ ...room, [`sdt${slot}`]: e.target.value })}
                            placeholder="SĐT"
                            className={cn(inputCls, 'font-mono')}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className={labelCls}>CCCD</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={room[`cccd${slot}`] || ''}
                            onChange={e => setCurrentRoomData({ ...room, [`cccd${slot}`]: e.target.value })}
                            placeholder={workerMode && room.occupants?.[slot - 1]?.cccdLast4 ? `…${room.occupants[slot - 1].cccdLast4} (nhập để đổi)` : '12 số'}
                            className={cn(inputCls, 'font-mono')}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className={labelCls}>Biển số xe</span>
                          <input
                            type="text"
                            value={room[`xe${slot}`] || ''}
                            onChange={e => {
                              const val = e.target.value;
                              const nextRoom = { ...room, [`xe${slot}`]: val };
                              // Worker mode counts every stored plate (as the server does); the sheet skips junk cells.
                              const validPlates = [nextRoom.xe1, nextRoom.xe2, nextRoom.xe3].filter(v => (workerMode ? String(v || '').trim().length > 0 : isValidLicensePlate(v))).length;
                              nextRoom.soXe = validPlates;
                              nextRoom.tienXe = estimateFromBase('tienXe', 'xe', validPlates, units.xe);
                              setCurrentRoomData(withRoomTotal(nextRoom));
                            }}
                            placeholder="Biển số"
                            className={cn(inputCls, 'uppercase font-mono')}
                          />
                        </label>
                        {workerMode && (() => {
                          // The number as it will be stored (same rule as the server); a number that cannot be stored is refused before sending.
                          const typed = String(room[`sdt${slot}`] || '').trim();
                          if (!typed) return null;
                          const problem = phoneProblem(typed);
                          if (problem) return <p role="alert" className="col-span-2 sm:col-span-4 text-[11px] font-bold text-rose-600 dark:text-rose-400">{problem}</p>;
                          const stored = normalizeVnPhone(typed);
                          return stored !== typed ? <p className="col-span-2 sm:col-span-4 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">Số sẽ lưu: <span className="font-mono">{stored}</span></p> : null;
                        })()}
                        {roomFieldErrors[`slot${slot}`] && <p role="alert" className="col-span-2 sm:col-span-4 text-xs font-bold text-rose-600 dark:text-rose-400">{roomFieldErrors[`slot${slot}`]}</p>}
                      </div>
                    ))}
                  </div>
                  {workerMode ? (
                    <p className="mt-2 text-[11px] text-neutral-600 dark:text-neutral-300">Thêm hoặc bớt người ở trong Quản lý tài khoản.</p>
                  ) : freeSlot !== undefined ? (
                    <button type="button" onClick={() => setOpenedSlots(prev => [...prev, freeSlot])} className="soft-button mt-2 min-h-11 w-full px-4 text-xs font-bold">
                      + Thêm người ở ({shownSlots.length}/{MAX_ROOM_OCCUPANTS})
                    </button>
                  ) : null}
                </section>

                {/* Meters: old / new / used / money, one row per meter */}
                <section className="soft-card p-3 sm:p-4" aria-label="Chỉ số điện nước">
                  <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(3.5rem,auto)] items-center gap-x-2 gap-y-1.5">
                    <span />
                    <span className={labelCls}>Cũ</span>
                    <span className={labelCls}>Mới</span>
                    <span className={cn(labelCls, 'text-right')}>Dùng</span>
                    {([
                      { kind: 'dien' as const, label: 'Điện', unit: 'kW', price: units.dien },
                      { kind: 'nuoc' as const, label: 'Nước', unit: 'm³', price: units.nuoc }
                    ]).map(m => (
                      <Fragment key={m.kind}>
                        <span className="min-w-0 leading-tight">
                          <span className="block text-xs font-bold text-neutral-900 dark:text-white">{m.label}</span>
                          <span className="block whitespace-nowrap tabular-nums text-[10px] text-neutral-500 dark:text-neutral-400">{fmt(m.price)}/{m.unit}</span>
                        </span>
                        <input type="number" inputMode="numeric" aria-label={`${m.label} cũ`} value={room[`${m.kind}Cu`] || ''} onChange={e => setMeter(m.kind, 'Cu', e.target.value)} className={cn(inputCls, 'tabular-nums')} />
                        <input type="number" inputMode="numeric" aria-label={`${m.label} mới`} value={room[`${m.kind}Moi`] || ''} onChange={e => setMeter(m.kind, 'Moi', e.target.value)} className={cn(inputCls, 'tabular-nums')} />
                        <span className="text-right whitespace-nowrap tabular-nums text-xs font-bold text-neutral-900 dark:text-white">{Math.max(0, (room[`${m.kind}Moi`] || 0) - (room[`${m.kind}Cu`] || 0))} {m.unit}</span>
                      </Fragment>
                    ))}
                  </div>
                </section>
              </div>

              {/* Money: the month's lines, the total, then the room's rent / deposit and services */}
              <section className="soft-card p-3 sm:p-4 min-w-0" aria-label="Tiền phòng tháng">
                <div className="flex items-baseline justify-between gap-3 pb-2 mb-1 border-b border-neutral-100 dark:border-neutral-800">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">Tổng tháng {selectedMonth}{estimate ? ' (ước tính)' : ''}</span>
                  <span data-testid="room-detail-total" className="whitespace-nowrap tabular-nums text-2xl font-black font-num text-neutral-900 dark:text-white">{fmt(room.tongTien)} đ</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-0.5">
                  <span className="text-xs text-neutral-700 dark:text-neutral-200">Tiền phòng</span>
                  {moneyInput(workerMode ? room.roomPrice : room.tienPhong, tienPhong => {
                    if (workerMode) {
                      // A paid invoice keeps its amount: the new rent counts from the next invoice.
                      const locked = room.paymentStatus === 'paid';
                      setCurrentRoomData(locked ? { ...room, roomPrice: tienPhong } : withRoomTotal({ ...room, roomPrice: tienPhong, tienPhong }));
                      return;
                    }
                    setCurrentRoomData(withRoomTotal({ ...room, tienPhong }));
                  }, 'Tiền phòng')}
                </div>
                {line('Tiền điện', room.tienDien)}
                {line('Tiền nước', room.tienNuoc)}
                {serviceLines
                  ? serviceLines.map((l: any, i: number) => <Fragment key={`${l.name}-${i}`}>{line(l.name, l.amount, Number(l.qty) > 1 ? `${l.qty} × ${fmt(l.unitPrice)}` : undefined)}</Fragment>)
                  : <>
                    {sheetFee('tienRac', 'Rác')}
                    {sheetFee('tienNet', 'Internet')}
                    {sheetFee('tienXe', 'Giữ xe')}
                  </>}
                {line('Chi phí khác', room.tienKhac)}
                <div className="flex items-center justify-between gap-3 pt-1.5 mt-1 border-t border-neutral-100 dark:border-neutral-800">
                  <span className="text-xs text-neutral-700 dark:text-neutral-200">Tiền cọc <span className="text-[11px] text-neutral-500 dark:text-neutral-400">(không cộng vào tổng)</span></span>
                  {moneyInput(workerMode ? room.roomDeposit : room.tienCoc, n => setCurrentRoomData(workerMode ? { ...room, roomDeposit: n, tienCoc: n } : { ...room, tienCoc: n }), 'Tiền cọc')}
                </div>

                {services.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <p className={labelCls}>Dịch vụ của phòng</p>
                    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {services.map(svc => {
                        const on = !optOut.includes(svc.id);
                        return (
                          <li key={svc.id} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="min-w-0 text-xs text-neutral-800 dark:text-neutral-100 truncate">
                              {svc.name} <span className="whitespace-nowrap tabular-nums text-[11px] text-neutral-500 dark:text-neutral-400">{fmt(svc.price)} đ/{svc.per === 'person' ? 'người' : svc.per === 'vehicle' ? 'xe' : 'phòng'}</span>
                            </span>
                            <AppleSwitch checked={on} disabled={savingServices || isSavingRoom} onChange={() => toggleRoomService(svc.id, !on)} size="sm" color="emerald" ariaLabel={`${on ? 'Tắt' : 'Bật'} ${svc.name} cho phòng này`} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {(roomMoneyNote || roomFieldErrors.money || roomFieldErrors.services) && (
                  <div className="mt-2 space-y-1 text-xs">
                    {roomMoneyNote && <p role="status" className="font-bold text-emerald-700 dark:text-emerald-400">{roomMoneyNote}</p>}
                    {roomFieldErrors.money && <p role="alert" className="font-bold text-rose-600 dark:text-rose-400">{roomFieldErrors.money}</p>}
                    {roomFieldErrors.services && <p role="alert" className="font-bold text-rose-600 dark:text-rose-400">{roomFieldErrors.services}</p>}
                  </div>
                )}

                <button
                  type="button"
                  disabled={workerMode && isSavingRoom}
                  onClick={() => {
                    if (workerMode && (isSavingRoom || savingRoomRef.current)) return;
                    // Nothing changed: no dialog, the save step itself says so.
                    if (workerMode && roomSaveSummary(room, roomBaselineRef.current).length === 0) { saveRoomWorker(); return; }
                    setConfirmRoomSave(true);
                  }}
                  className="primary-button mt-3 min-h-11 py-2.5 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Save size={18} />
                  <span>{workerMode && isSavingRoom ? 'Đang lưu…' : 'Lưu thay đổi'}</span>
                </button>
                <ConfirmSaveDialog
                  open={confirmRoomSave}
                  title={`Lưu hoá đơn phòng ${room.roomName || selectedRoomId} tháng ${selectedMonth}: tổng ${estimate ? 'khoảng ' : ''}${fmt(room.tongTien)} đ?`}
                  lines={roomSaveSummary(room, roomBaselineRef.current)}
                  onCancel={() => setConfirmRoomSave(false)}
                  onConfirm={async () => {
                    setConfirmRoomSave(false);
                    if (workerMode) {
                      await saveRoomWorker();
                      return;
                    }
                    playSound('click');
                    try {
                      setIsLoading(true);
                      const res = await apiFetch('/api/admin/room-detail', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          month: selectedMonth,
                          room: selectedRoomId,
                          data: room,
                          dienCu: room.dienCu,
                          dienMoi: room.dienMoi,
                          nuocCu: room.nuocCu,
                          nuocMoi: room.nuocMoi,
                          status: room.status || room.paymentStatus || 'unpaid',
                          row: room.row
                        })
                      });
                      // Highlight the total cell of the room on the Google Sheet.
                      pushUpdateToGoogleSheet({
                        action: 'update_payment',
                        room: selectedRoomId,
                        status: room.paymentStatus === 'paid' ? 'paid' : 'unpaid',
                        month: selectedMonth,
                        row: room.row
                      });
                      setIsLoading(false);
                      if (res.ok) {
                        playSound('success');
                        showPortalToast('Đã lưu cập nhật thông tin phòng và đồng bộ Google Sheet thành công!', 'success');
                      }
                    } catch (e) {
                      setIsLoading(false);
                    }
                  }}
                />
              </section>
            </div>
          </div>
          );
        })()}

        {/* =========================================================================
            3. BILLING TAB (THU TIỀN THÁNG)
           ========================================================================= */}
        {activeMenu === 'billing' && (
          <div className="font-apple space-y-4 sm:space-y-6">
            {workerMode && isWorkerStaff && <IssueInvoicesBar month={selectedMonth} rows={billingList} houses={accountTargets.houses} houseFilter={houseFilter} onToast={showPortalToast}
              selected={pickedRows} />}
            {visibleBilling.length === 0 && !isLoading && !adminLoadError && <AdminEmptyState filtered={Boolean(adminSearch || collectionFilter !== 'all' || (workerMode && houseFilter !== 'all'))} title="Chưa có khoản thu trong kỳ" />}
            {/* Mobile View: No Horizontal Scrolling, Touch-Friendly Cards */}
            <div className="block md:hidden space-y-3.5 font-apple">
              {selectionOn && visibleBilling.length > 0 && (
                <label className="soft-card flex min-h-11 cursor-pointer items-center gap-2 px-4 text-xs font-semibold"><input type="checkbox" checked={allPicked} onChange={toggleAllPicked} aria-label="Chọn tất cả phòng" className="h-5 w-5 cursor-pointer" /><span>Tất cả</span></label>
              )}
              {visibleBilling.map(item => {
                const isPaid = item.paymentStatus === 'paid';
                return (
                  <div key={`${item.houseId || ''}|${item.room}`} className="soft-card p-4 space-y-3.5 font-apple">
                    {/* Header: Room, AppleSwitch */}
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-2.5 font-apple">
                      {selectionOn && <input type="checkbox" checked={pickedBilling.has(billingKey(item))} onChange={() => togglePicked(item)} aria-label={`Chọn phòng ${item.room}`} className="h-5 w-5 shrink-0 cursor-pointer" />}
                      <button type="button" onClick={() => openBillingInvoice(item)} aria-label={`Xem hoá đơn phòng ${item.roomName || item.room}`} className="flex items-center gap-2.5 min-w-0 min-h-11 text-left cursor-pointer font-apple">
                        <span className="px-2.5 py-1 rounded-xl bg-neutral-900 dark:bg-neutral-600 text-white font-semibold text-xs shrink-0 font-apple">
                          {item.room}
                        </span>
                        {workerMode && item.draft && <DraftBadge />}
                        <ChevronRight size={16} className="shrink-0 text-neutral-500" />
                      </button>
                      <div className="flex items-center gap-2 shrink-0 font-apple">
                        {workerMode && <InvoiceQrThumb url={linkOf(item)} room={item.room} onCopied={copiedLinkToast} />}
                        <AppleSwitch
                          checked={isPaid}
                          onChange={() => updateRoomPaymentStatus(item.room, isPaid ? 'unpaid' : 'paid', item.row, item.houseId)}
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
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienPhong)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Điện</span>
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienDien)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Nước</span>
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienNuoc)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Rác</span>
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienRac)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Net</span>
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienNet)} đ</span>
                      </div>
                      <div className="font-apple">
                        <span className="text-[10px] text-neutral-600 uppercase font-semibold block font-apple dark:text-neutral-300">Xe</span>
                        <span className="whitespace-nowrap tabular-nums font-apple font-semibold text-neutral-700 dark:text-neutral-300">{fmt(item.tienXe)} đ</span>
                      </div>
                    </div></details>

                    {/* Total Row */}
                    <div className="flex items-center justify-between pt-0.5 font-apple">
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 font-apple">Tổng cộng:</span>
                      <span className="whitespace-nowrap tabular-nums text-sm font-semibold font-apple text-neutral-900 dark:text-white">
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
                    <tr className="whitespace-nowrap bg-neutral-50 dark:bg-neutral-800/80 border-b border-neutral-100 dark:border-neutral-800 text-[11px] font-semibold text-neutral-600 dark:text-neutral-200 uppercase tracking-wider font-apple">
                      {selectionOn && <th className="p-4"><label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={allPicked} onChange={toggleAllPicked} aria-label="Chọn tất cả phòng" className="h-4 w-4 cursor-pointer" /><span>Tất cả</span></label></th>}
                      <th className="p-4 font-semibold font-apple">Phòng</th>
                      {workerMode && <th className="p-4 font-semibold font-apple"><span className="sr-only">Mã QR thanh toán</span>QR</th>}
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
                        <tr key={`${item.houseId || ''}|${item.room}`} onClick={() => openBillingInvoice(item)} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors font-apple cursor-pointer">
                          {selectionOn && <td className="p-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={pickedBilling.has(billingKey(item))} onChange={() => togglePicked(item)} aria-label={`Chọn phòng ${item.room}`} className="h-4 w-4 cursor-pointer" /></td>}
                          <td className="p-4 font-semibold text-neutral-900 dark:text-white font-apple whitespace-nowrap"><button type="button" onClick={(e) => { e.stopPropagation(); openBillingInvoice(item); }} aria-label={`Xem hoá đơn phòng ${item.roomName || item.room}`} className="underline-offset-2 hover:underline cursor-pointer">{item.room}</button>{workerMode && item.draft && <DraftBadge className="ml-2" />}</td>
                          {workerMode && <td className="p-2 font-apple" onClick={(e) => e.stopPropagation()}><InvoiceQrThumb url={linkOf(item)} room={item.room} onCopied={copiedLinkToast} /></td>}
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold">{fmt(item.tienPhong)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienDien)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold text-neutral-800 dark:text-neutral-200">{fmt(item.tienNuoc)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold">{fmt(item.tienRac)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold">{fmt(item.tienNet)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-apple font-semibold">{fmt(item.tienXe)} đ</td>
                          <td className="whitespace-nowrap tabular-nums p-4 font-semibold text-sm text-neutral-900 dark:text-white font-apple">
                            {fmt(item.tongTien)} đ
                          </td>
                          <td className="p-4 font-apple" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-2.5 font-apple">
                              <AppleSwitch
                                checked={isPaid}
                                onChange={() => updateRoomPaymentStatus(item.room, isPaid ? 'unpaid' : 'paid', item.row, item.houseId)}
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

            {/* Options beside the document, as on the resident contract page */}
            <div className="resident-document-workspace">
            <aside className="resident-document-options soft-card p-4 space-y-4">
              <div role="group" aria-label="Loại tài liệu" className="resident-document-types kit-segmented flex w-full items-stretch gap-1">
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

              <div className="admin-document-actions flex flex-col gap-3">
                <select
                  value={contractHouse}
                  onChange={e => { setContractHouse(e.target.value as any); setContractRoom(''); }}
                  className="w-full bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  <option value="TRUNG_KIM" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Nhà trọ Trung Kim (116/32)</option>
                  <option value="LVC" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Nhà trọ 109/6 (Lê Văn Chí)</option>
                </select>
                <select
                  aria-label="Chọn phòng để điền tài liệu"
                  value={contractRoom}
                  onChange={e => setContractRoom(e.target.value)}
                  className="w-full bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  <option value="">Mẫu trống</option>
                  {contractRooms.map((r: any) => <option key={r.room} value={r.room}>Phòng {r.room}{r.nguoi1 ? ` – ${r.nguoi1}` : ''}</option>)}
                </select>
                <DocumentActions doc={adminDoc} />
              </div>
            </aside>

            <div className="resident-document-scroll min-w-0 overflow-x-auto">
              <div className="resident-document-sheet">
                <DocumentSheet doc={adminDoc} />
              </div>
            </div>
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
                  setInvoiceFromBilling(false);
                  setActiveMenu(invoiceFromBilling ? 'billing' : 'utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                <ArrowLeft size={16} />
                <span>{invoiceFromBilling ? 'Quay lại Hoá đơn' : 'Quay lại Tiện ích'}</span>
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
                  value={selectedInvoiceRoom ? `${selectedInvoiceRoom.houseId || ''}|${selectedInvoiceRoom.room}` : ''}
                  onChange={e => { const [h, ...rest] = e.target.value.split('|'); setInvoiceHouse(h); setInvoiceRoom(rest.join('|')); }}
                  className="bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-neutral-700 outline-none cursor-pointer"
                >
                  {roomsList.map((r: any) => <option key={`${r.houseId || ''}|${r.room}`} value={`${r.houseId || ''}|${r.room}`} className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Phòng {r.room}{r.nguoi1 ? ` – ${r.nguoi1}` : ''}</option>)}
                </select>
                {monthSelect}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {invoiceLinkTarget && (
                  <button type="button" onClick={copyInvoiceLink} disabled={linkBusy}
                    className="soft-button min-h-11 px-4 py-2.5">Sao chép link thanh toán</button>
                )}
                <DocumentActions doc={selectedInvoiceRoom ? invoiceDoc : null} downloadLabel="Lưu PDF" />
              </div>
              {linkMessage && <p role={linkMessage.ok ? 'status' : 'alert'} className={`w-full text-xs ${linkMessage.ok ? 'text-neutral-600 dark:text-neutral-300' : 'text-red-700 dark:text-red-300'} break-all`}>{linkMessage.text}</p>}
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

              {!workerMode && (
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                <Zap size={15} className="text-neutral-900 dark:text-white" />
                <span>Nhập chỉ số điện nước</span>
              </div>
              )}
            </div>

            {workerMode && <MonthBilling month={selectedMonth} months={meterMonthChoices(months)} onMonthChange={pickMonthByHand} />}
            {sourceReady && !workerMode && (
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
            )}
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
                <span>Đơn giá dịch vụ</span>
              </div>
            </div>

            {workerMode && <FeeSettings initialMonth={selectedMonth} />}
            {sourceReady && !workerMode && (
            <div className="soft-card kit-form-surface p-4 sm:p-8 space-y-6">
              <div>
                <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Đơn giá dịch vụ tháng {selectedMonth}</h3>
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
            )}
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
                    <td className="whitespace-nowrap tabular-nums border border-neutral-800 p-2.5 text-right font-bold text-sm font-num">
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

                  {workerMode && isWorkerStaff && accountTargets.houses.length > 0 ? (
                    <WorkerNotifTargets houses={accountTargets.houses} target={notifTarget} onTarget={setNotifTarget} picked={pickedRooms} onPicked={setPickedRooms} />
                  ) : (
                  <>
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
                  </>
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
                          <NavIcons.Bell size={20} strokeWidth={1.8} />
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
                          <NavIcons.AlertTriangle size={20} strokeWidth={1.8} />
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
                          <NavIcons.Wallet size={20} strokeWidth={1.8} />
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
                      <NavIcons.Wallet size={20} strokeWidth={1.8} className="shrink-0" />
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
                      <NavIcons.Send size={15} strokeWidth={2} />
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
        {activeMenu === 'paymentPortal' && (
          <PaymentPortalSettings
            onBack={() => {
              playSound('click');
              setActiveMenu('utilities');
            }}
          />
        )}

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
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Chọn chức năng quản lý tài khoản">
                <div className="kit-segmented p-1">
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
                  <span>Quản lý tài khoản</span>
                  {pendingAccountCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold font-num text-amber-700 dark:text-amber-300">
                      {pendingAccountCount}
                    </span>
                  )}
                </button>
                </div>
                <div className="kit-segmented p-1">
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
                {isAdminTong && (
                  <div className="kit-segmented p-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={accountSubTab === 'managers'}
                    aria-pressed={accountSubTab === 'managers'}
                    onClick={() => {
                      playSound('tab');
                      setAccountSubTab('managers');
                    }}
                    className={cn("kit-segment min-h-11 px-3 apple-body font-medium", accountSubTab === 'managers' && "kit-segment-active")}
                  >
                    <span>Quản lý toà nhà</span>
                  </button>
                  </div>
                )}
              </div>

              {/* Sub-tab 3: Ban Quản Lý Trọ (Chủ trọ only) */}
              {accountSubTab === 'managers' && isAdminTong && <ManagerAccounts />}

              {/* Sub-tab 1: Xét duyệt tài khoản */}
              {accountSubTab === 'approval' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="apple-callout kit-text-secondary">
                      Bấm vào từng tài khoản để xem thông tin chi tiết trước khi xét duyệt. Sử dụng nút dấu tích (✓) để duyệt hoặc dấu (✕) để từ chối / hủy duyệt.
                    </p>
                    <span className="apple-callout font-medium kit-text-secondary font-num">
                      Tổng cộng: {allAccounts.length} tài khoản
                    </span>
                  </div>

                  <input type="search" value={accountSearch} onChange={e => setAccountSearch(e.target.value)} placeholder="Tìm theo tên, số điện thoại hoặc phòng" aria-label="Tìm tài khoản" className="kit-field px-3" />

                  {shownAccounts.length === 0 ? (
                    <div className="kit-data-surface rounded-2xl p-6 text-center">
                      <p className="apple-headline kit-text-primary">Chưa có yêu cầu tài khoản nào</p>
                      <p className="mt-1 apple-callout kit-text-secondary">Các tài khoản đăng ký mới sẽ hiển thị tại đây để bạn xét duyệt.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {shownAccounts.map((acc) => {
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
                            className={cn("kit-data-surface rounded-[20px] p-4 flex items-center justify-between gap-3 hover:border-neutral-400/80 transition-all cursor-pointer group", acc.status === 'pending' && shownAccounts.filter(a => a.status === 'pending').slice(-1)[0]?.id === acc.id && shownAccounts.some(a => a.status !== 'pending') && "mb-4 border-b-2 border-amber-400/60")}
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              <div className="shrink-0">
                                <IconProfile3D size={42} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2.5 py-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs font-num">
                                    {acc.houseName ? `${acc.houseName} · ` : ''}Phòng {acc.roomNumber}
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
                                  <span className="font-num">· Ngày tham gia: {acc.createdAt || 'Chưa có'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Right side Tick & X action buttons */}
                            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  playSound('success');
                                  setAccountStatus(acc, 'approved', `Đã duyệt tài khoản ${acc.name} (Phòng ${acc.roomNumber})`);
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
                                  setAccountStatus(acc, 'rejected', `Đã đánh dấu chưa duyệt tài khoản ${acc.name}`);
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
                              {!(acc as any).isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setAccountDeletion({ account: acc, mode: 'resident' })}
                                    disabled={!acc.roomNumber}
                                    aria-label={`Xoá người ở ${acc.name}`}
                                    title="Xoá người ở khỏi phòng"
                                    className="h-10 w-10 rounded-xl flex items-center justify-center border bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700 disabled:opacity-40 cursor-pointer"
                                  >
                                    <NavIcons.UserMinus size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAccountDeletion({ account: acc, mode: 'account' })}
                                    aria-label={`Xoá tài khoản ${acc.name}`}
                                    title="Xoá tài khoản"
                                    className="h-10 w-10 rounded-xl flex items-center justify-center border bg-white dark:bg-neutral-800 text-rose-600 dark:text-rose-400 border-neutral-200 dark:border-neutral-700 cursor-pointer"
                                  >
                                    <NavIcons.Trash2 size={18} />
                                  </button>
                                </>
                              )}
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
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setAdminRegError('');
                      setAdminRegSuccess('');

                      if (!adminRegRoom) {
                        setAdminRegError('Vui lòng chọn số phòng thuê');
                        return;
                      }
                      if (isWorkerStaff && phoneProblem(adminRegPhone)) {
                        setAdminRegError(PHONE_PROBLEM_MESSAGE);
                        return;
                      }
                      if (adminRegPassword !== adminRegConfirmPass) {
                        setAdminRegError('Mật khẩu xác nhận không khớp');
                        return;
                      }

                      const res = isWorkerStaff
                        ? await createAccountOnWorker({
                            houseId: accountTargets.houseId,
                            room: adminRegRoom,
                            fullName: adminRegName,
                            phone: adminRegPhone,
                            password: adminRegPassword,
                            email: adminRegEmail
                          })
                        : await registerResident({
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
                        showPortalToast(isWorkerStaff ? (res.message || 'Đã tạo tài khoản') : `Đã tạo tài khoản cho phòng ${adminRegRoom}`, 'success');
                        setAdminRegName('');
                        setAdminRegPhone('');
                        setAdminRegRoom('');
                        setAdminRegEmail('');
                        setAdminRegPassword('');
                        setAdminRegConfirmPass('');
                        loadAccounts();
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

                    {isWorkerStaff && accountTargets.houses.length > 1 && (
                      <div>
                        <label htmlFor="admin-register-house" className="mb-2 block apple-headline kit-text-primary">Căn hộ / nhà trọ</label>
                        <select
                          id="admin-register-house"
                          value={accountTargets.houseId}
                          onChange={(e) => {
                            accountTargets.setHouseId(e.target.value);
                            setAdminRegRoom('');
                          }}
                          className="kit-field min-h-12 w-full px-3.5 cursor-pointer"
                        >
                          {accountTargets.houses.map(h => (
                            <option key={h.id} value={h.id} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">{h.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

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
                        {isWorkerStaff && <PhoneHint value={adminRegPhone} />}
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
                          {isWorkerStaff ? (
                            <>
                              {isAdminTong && (
                                <option value={ADMIN_ROOM} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">Admin (Ban Quản Lý Trọ)</option>
                              )}
                              {accountTargets.rooms.map(r => (
                                <option key={r.id} value={String(r.id)} disabled={r.occupants >= r.capacity} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">
                                  Phòng {r.name}{r.occupants >= r.capacity ? ' (đủ người)' : ''}
                                </option>
                              ))}
                            </>
                          ) : (availableRoomNumbers.length > 0 ? availableRoomNumbers : DEFAULT_ROOM_NUMBERS).map(rNum => (
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
                      <span>{adminRegRoom === ADMIN_ROOM ? 'Tạo Ban Quản Lý Trọ' : 'Tạo tài khoản cư dân'}</span>
                      <ArrowRight aria-hidden="true" size={17} className="shrink-0" />
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Modal xem chi tiết thông tin tài khoản trước khi xét duyệt */}
            {accountDeletion && (
              <AccountDeleteDialog
                name={accountDeletion.account.name}
                room={accountDeletion.account.roomNumber}
                mode={accountDeletion.mode}
                busy={isDeletingAccount}
                onCancel={() => setAccountDeletion(null)}
                onConfirm={confirmAccountDeletion}
              />
            )}
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
                        setViewingAccount({ ...viewingAccount, status: 'rejected' });
                        setAccountStatus(viewingAccount, 'rejected', `Đã đánh dấu chưa duyệt tài khoản ${viewingAccount.name}`);
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
                        setViewingAccount({ ...viewingAccount, status: 'approved' });
                        setAccountStatus(viewingAccount, 'approved', `Đã duyệt tài khoản ${viewingAccount.name} (Phòng ${viewingAccount.roomNumber})`);
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
            { key: 'billing', icon: NavIcons.Receipt, label: 'Hoá đơn' },
            { key: 'utilities', icon: NavIcons.LayoutGrid, label: 'Tiện ích' }
          ].map(({ key, icon: Icon, label }) => {
            const isActive = activeMenu === key || (key === 'rooms' && activeMenu === 'roomDetail') || (key === 'billing' && activeMenu === 'invoices') || (key === 'utilities' && ['meter', 'contract', 'declaration', 'config', 'createNotification', 'laundry', 'accountManagement', 'paymentPortal'].includes(activeMenu));
            return <button type="button" key={key} aria-current={isActive ? 'page' : undefined} onClick={() => { playSound('click'); setActiveMenu(key as any); }} className={cn('kit-nav-item kit-admin-dock-item', isActive && 'kit-nav-active')}>
              <Icon size={21} /><span>{label}</span>
            </button>;
          })}
          {!workerMode && <span className="kit-admin-dock-divider" aria-hidden="true" />}
          {!workerMode && <button type="button" onClick={togglePaymentGate} aria-label={'Cổng thanh toán: ' + (paymentGate === 'START' ? 'đang mở. Nhấn để đóng cổng' : 'đang đóng. Nhấn để mở cổng')} aria-pressed={paymentGate === 'START'} className="kit-nav-item kit-admin-dock-item kit-admin-gate">
            <span className="relative"><NavIcons.Power size={21} /><span aria-hidden="true" className={cn('kit-gate-dot', paymentGate === 'START' ? 'bg-emerald-500' : 'bg-rose-500')} /></span>
            <span>{gateMixed ? 'Một số căn mở' : (paymentGate === 'START' ? 'Đang mở' : 'Đã đóng')}</span>
          </button>}
        </nav>
      </div>

    </div>
  );
}
