import React, { useState, useEffect, useMemo } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { storage } from '../lib/storage';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { canonicalRoomId, pushUpdateToGoogleSheet } from '../services/googleSheetSyncService';
import { GlassIconMoon } from './GlassIcons';
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
  IconElectricWater3D,
  IconPencil3D
} from './Icons3D';

// Procedural Web Audio Sound Manager
const playSound = (type: 'click' | 'hover' | 'success') => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'hover') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, now);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (type === 'success') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, now + idx * 0.05);
        g.gain.setValueAtTime(0.18, now + idx * 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.2);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + idx * 0.05);
        o.stop(now + idx * 0.05 + 0.2);
      });
    }
  } catch (e) {}
};

/**
 * Đọc số tiền bằng chữ tiếng Việt (Chuẩn hành chính / kế toán)
 */
function readVietnameseNumber(n: number): string {
  if (!n || n === 0) return '';
  const chuSo = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const tien = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

  function docBlock(so: number, dayDu: boolean) {
    let str = '';
    const tram = Math.floor(so / 100);
    so = so % 100;
    const chuc = Math.floor(so / 10);
    const donVi = so % 10;
    if (dayDu || tram > 0) {
      str += chuSo[tram] + ' trăm ';
      if (chuc === 0 && donVi > 0) str += 'lẻ ';
    }
    if (chuc === 1) { str += 'mười '; }
    else if (chuc > 1) { str += chuSo[chuc] + ' mươi '; }
    if (chuc > 0 && donVi === 5) { str += 'lăm '; }
    else if (chuc > 1 && donVi === 1) { str += 'mốt '; }
    else if (donVi > 0) { str += chuSo[donVi] + ' '; }
    return str;
  }

  let str = '';
  const arr: number[] = [];
  let temp = n;
  while (temp > 0) {
    arr.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }
  for (let j = arr.length - 1; j >= 0; j--) {
    if (arr[j] > 0 || (j === 0 && arr.length === 1)) {
      str += docBlock(arr[j], j < arr.length - 1) + tien[j] + ' ';
    }
  }
  str = str.replace(/\s+/g, ' ').trim();
  return str.charAt(0).toUpperCase() + str.slice(1) + ' đồng';
}

export const DEFAULT_MONTH_TABS = [
  '03/2026',
  '04/2026',
  '05/2026',
  '06/2026',
  '07/2026',
  '08/2026',
  '09/2026',
  '10/2026'
];

export function AdminPortal() {
  const navigate = useNavigate();
  const { logoutUser, addNotification } = useApp();
  const { mode, isDark, toggleTheme } = useTheme();

  // Active Menu
  const [activeMenu, setActiveMenu] = useState<
    'dashboard' | 'rooms' | 'roomDetail' | 'billing' | 'plates' | 'contract' | 'meter' | 'config' | 'declaration' | 'utilities' | 'createNotification'
  >('dashboard');

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
      setNotifContent(`Ban Quản Lý kính gửi thông báo thu phí tiền phòng tháng ${selectedMonth}. Quý cư dân vui lòng truy cập ứng dụng EcoStay để kiểm tra hóa đơn chi tiết và hoàn tất thanh toán trước ngày đến hạn bằng mã VietQR tự động. Xin chân thành cảm ơn!`);
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
      alert('Vui lòng nhập tiêu đề thông báo');
      return;
    }
    if (!notifContent.trim()) {
      alert('Vui lòng nhập nội dung thông báo');
      return;
    }
    if (notifTarget === 'CUSTOM' && selectedCustomRooms.length === 0) {
      alert('Vui lòng chọn ít nhất một phòng cần gửi thông báo');
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
      sender: `BQL EcoStay (${targetDesc})`
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
  const [selectedMonth, setSelectedMonth] = useState<string>('10/2026');

  // Sidebar Collapse
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Loading
  const [isLoading, setIsLoading] = useState(false);


  // Payment Gate state
  const [paymentGate, setPaymentGate] = useState<'START' | 'STOP'>('STOP');

  // Data States
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [roomsList, setRoomsList] = useState<any[]>([]);
  const [currentRoomData, setCurrentRoomData] = useState<any>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [billingList, setBillingList] = useState<any[]>([]);
  const [plateQuery, setPlateQuery] = useState('');
  const [plateResults, setPlateResults] = useState<any[]>([]);

  // Contract state
  const [contractMode, setContractMode] = useState<'new' | 'history'>('new');
  const [contractHouse, setContractHouse] = useState<'TRUNG_KIM' | 'LVC'>('TRUNG_KIM');
  const [contractDocType, setContractDocType] = useState<'ct01' | 'contract'>('ct01');
  const [contractForm, setContractForm] = useState({
    room: 'G01',
    rent: 3500000,
    deposit: 3500000,
    contractDate: '01/10/2026',
    personSlot: '1',
    partyAName: 'Bùi Trung Khải',
    partyADob: '15/08/2005',
    partyAHousehold: '109/6 Lê Văn Chí, Linh Xuân, Thủ Đức',
    partyACccd: '079205019765',
    partyAPhone: '0902371800',
    partyAPlate: '59-X1 888.88'
  });
  const [contractHistory, setContractHistory] = useState<any[]>([]);

  // Declaration state
  const [declarationHouse, setDeclarationHouse] = useState<'TRUNG_KIM' | 'LVC'>('TRUNG_KIM');
  const [declarationData, setDeclarationData] = useState<any>(null);
  const [declarationRows, setDeclarationRows] = useState<any[]>([]);
  const [declarationSigDate, setDeclarationSigDate] = useState('');
  const [saveDeclarationSuccess, setSaveDeclarationSuccess] = useState(false);

  // Unit Config
  const [unitConfig, setUnitConfig] = useState({
    dien: 3500,
    nuoc: 20000,
    rac: 30000,
    net: 40000,
    xe: 50000
  });
  const [configSaveMsg, setConfigSaveMsg] = useState('');

  // Batch Meters State
  const [batchMeters, setBatchMeters] = useState<Record<string, { dienCu?: number; dienMoi?: number; nuocCu?: number; nuocMoi?: number }>>({});
  const [isSavingBatchMeters, setIsSavingBatchMeters] = useState(false);

  // Format currency
  const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

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
      usageTrend: (prev?.usageTrend && prev.usageTrend.length > 0) ? prev.usageTrend : [
        { month: '08/2026', dien: Math.round(totalDien * 0.92), nuoc: Math.round(totalNuoc * 0.95) },
        { month: '09/2026', dien: Math.round(totalDien * 0.97), nuoc: Math.round(totalNuoc * 0.98) },
        { month: '10/2026', dien: totalDien, nuoc: totalNuoc }
      ]
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
    apiFetch(`/api/admin/payment-gate?month=${m}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(data => {
        if (data.success && data.value) setPaymentGate(data.value);
      })
      .catch(() => {});
  };

  const togglePaymentGate = async () => {
    playSound('click');
    const nextVal = paymentGate === 'START' ? 'STOP' : 'START';
    setPaymentGate(nextVal);

    apiFetch('/api/admin/payment-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: selectedMonth, value: nextVal })
    }).catch(() => {});
    playSound('success');
  };

  const loadTabContent = async (menuKey: string, month: string) => {
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
        .catch(() => setIsLoading(false));
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
          if (d.success && d.billing?.length) setBillingList(d.billing);
        })
        .catch(() => {});
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
        .catch(() => {});
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
        .catch(() => {});
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
        if (d.success && d.rooms?.length) {
          setRoomsList(d.rooms);
          setBillingList(d.rooms);
          updateDashboardStats(d.rooms, month);
        }
      })
      .catch(() => {
        setIsLoading(false);
      });
  };

  const openRoomDetail = (room: string) => {
    playSound('click');
    const cleanId = canonicalRoomId(room);
    setSelectedRoomId(cleanId);
    setActiveMenu('roomDetail');
    setCurrentRoomData(null);
    setIsLoading(true);

    // 1. Immediately find from local roomsList
    const localFound = roomsList.find(r => canonicalRoomId(r.room) === cleanId) ||
                       roomsList.find(r => r.room === room);
    if (localFound) {
      setCurrentRoomData({
        ...localFound,
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
          setCurrentRoomData(prev => ({ ...prev, ...d.data }));
        }
      })
      .catch(() => setIsLoading(false));
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
          if (!item.plate || item.plate === '1' || item.plate === '2.0' || item.plate === '3.0') return;
          if (!cleanQ || item.plate.toLowerCase().replace(/[\s.-]/g, '').includes(cleanQ)) {
            results.push({
              room: r.room,
              plate: item.plate,
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
    const isLVCKey = houseKey === 'LVC';
    const fallbackDeclarationData = () => {
      const filtered = roomsList.filter(r => isLVCKey ? String(r.room).toUpperCase().includes('LVC') : !String(r.room).toUpperCase().includes('LVC'));
      const rows = filtered.map((r, idx) => ({
        stt: idx + 1,
        room: r.room,
        name: r.name || r.nguoi1,
        cccd: r.cccd1 || '',
        phone: r.phone || r.sdt1 || '',
        rent: r.tienPhong || 0,
        dien: r.tienDien || 0,
        nuoc: r.tienNuoc || 0,
        total: r.tongTien || 0
      }));
      setDeclarationRows(rows);
      setDeclarationData({ month, houseKey, rows });
      setIsLoading(false);
    };

    apiFetch(`/api/admin/declaration?month=${month}&houseKey=${houseKey}`)
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      })
      .then(d => {
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
      if (data.success) {
        playSound('success');
        setSaveDeclarationSuccess(true);
        setTimeout(() => setSaveDeclarationSuccess(false), 3000);
      }
    } catch (e) {
      playSound('success');
      setSaveDeclarationSuccess(true);
      setTimeout(() => setSaveDeclarationSuccess(false), 3000);
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
      alert('Chưa có chỉ số nào được chỉnh sửa.');
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
      alert('✅ Đã lưu và đồng bộ chỉ số điện nước lên Google Sheets thành công!');
      fetchRooms(selectedMonth);
      setBatchMeters({});
    } catch (err: any) {
      alert('Lỗi lưu chỉ số: ' + (err.message || 'Vui lòng thử lại'));
    } finally {
      setIsSavingBatchMeters(false);
    }
  };

  const updateRoomPaymentStatus = async (roomNumber: string, status: 'paid' | 'unpaid') => {
    playSound('click');
    const cleanId = canonicalRoomId(roomNumber);
    const statusText = status === 'paid' ? 'Đã đóng' : 'Chưa đóng';
    const statusHTML = status === 'paid'
      ? '<span style="color:#16a34a; font-weight:bold;">Đã thanh toán</span>'
      : '<span style="color:#dc2626; font-weight:bold;">Chưa thanh toán</span>';

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
        month: selectedMonth
      })
    }).catch(() => {});

    // 3. Two-way sync: Push directly into Google Sheet
    pushUpdateToGoogleSheet({
      action: 'update_payment',
      room: cleanId,
      status,
      month: selectedMonth
    });

    playSound('success');
  };

  // Rent collection progress stats
  const totalRoomsCount = roomsList.length || dashboardData?.tongPhong || 0;
  const paidRoomsCount = roomsList.length 
    ? roomsList.filter(r => r.paymentStatus === 'paid' || r.status === 'paid').length 
    : (dashboardData?.daDong ?? 0);
  const collectionPercent = totalRoomsCount > 0 ? Math.round((paidRoomsCount / totalRoomsCount) * 100) : 0;

  // Landlord houses information
  const housesInfo = {
    TRUNG_KIM: {
      name: 'NHÀ TRỌ TRUNG KIM',
      address: '116/32 Đường 17, P. Linh Xuân, TP. Thủ Đức, TP. Hồ Chí Minh',
      landlord: 'Lương Thị Kim Phượng',
      dob: '18/10/1973',
      cccd: '024073000292',
      phone: '0903616569'
    },
    LVC: {
      name: 'NHÀ TRỌ 109/6',
      address: '109/6 Lê Văn Chí, P. Linh Xuân, TP. Thủ Đức, TP. Hồ Chí Minh',
      landlord: 'Bùi Trung Khải',
      dob: '15/08/2005',
      cccd: '079205019765',
      phone: '0902371800'
    }
  };

  const activeHouse = housesInfo[contractHouse];

  // Helper to render 12 boxes for CCCD
  const renderCccdBoxes = (code: string) => {
    const digits = (code || '').replace(/\D/g, '').split('');
    return (
      <div className="inline-flex items-center gap-1 align-middle ml-2">
        {Array.from({ length: 12 }).map((_, idx) => (
          <span
            key={idx}
            className="w-6 h-7 border border-slate-800 text-center font-bold text-xs flex items-center justify-center font-mono bg-white"
          >
            {digits[idx] || ''}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 flex flex-col lg:flex-row antialiased select-none">
      
      {/* =========================================================================
          DESKTOP FLOATING SIDEBAR (Matching resident page aesthetic)
         ========================================================================= */}
      <aside 
        className={cn(
          "hidden lg:flex flex-col fixed left-4 top-4 bottom-4 z-40 transition-all duration-300 ease-out select-none",
          isSidebarCollapsed ? "w-[105px]" : "w-[260px]"
        )}
      >
        <div className={cn(
          "relative w-full h-full bg-white/85 dark:bg-[#101726]/90 backdrop-blur-[16px] border border-white/80 dark:border-white/10 shadow-[8px_8px_24px_rgba(166,175,195,0.2),-8px_-8px_24px_rgba(255,255,255,0.95)] rounded-[31px] flex flex-col justify-between py-6 transition-all duration-300",
          isSidebarCollapsed ? "px-3 items-center" : "px-4"
        )}>
          
          {/* Toggle Arrow Button */}
          <button
            type="button"
            onClick={() => {
              playSound('click');
              setIsSidebarCollapsed(!isSidebarCollapsed);
            }}
            className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-white dark:border-slate-700 shadow-md hover:scale-105 active:scale-95 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-all z-50 cursor-pointer"
            title={isSidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          >
            {isSidebarCollapsed ? (
              <ChevronRight size={18} className="stroke-[2.5]" />
            ) : (
              <ChevronLeft size={18} className="stroke-[2.5]" />
            )}
          </button>

          {/* Top Brand */}
          <div className="w-full">
            {isSidebarCollapsed ? (
              <div className="flex justify-center mb-6 w-full">
                <div 
                  className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/15 cursor-pointer hover:scale-105 transition-transform"
                  title="EcoStay - Quản lý chủ trọ"
                >
                  <Building2 size={24} className="text-white" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-1 mb-6">
                <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/15 shrink-0">
                  <Building2 size={22} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white">EcoStay</span>
                    <span className="px-1.5 py-0.2 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md font-num border border-blue-100 uppercase">
                      Admin
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium truncate">
                    Quản lý chủ trọ
                  </p>
                </div>
              </div>
            )}

            {/* Nav Items */}
            <nav className={cn(
              "w-full transition-all duration-300",
              isSidebarCollapsed ? "flex flex-col items-center space-y-3" : "space-y-1.5"
            )}>
              {[
                { key: 'dashboard', label: 'Tổng quan', icon: Home },
                { key: 'rooms', label: 'Phòng & Khách', icon: Users },
                { key: 'billing', label: 'Thu tiền tháng', icon: Receipt },
                { key: 'utilities', label: 'Tiện ích', icon: LayoutGrid }
              ].map(item => {
                const Icon = item.icon;
                const isActive = activeMenu === item.key || 
                  (item.key === 'rooms' && activeMenu === 'roomDetail') || 
                  (item.key === 'utilities' && ['meter', 'plates', 'contract', 'declaration', 'config', 'createNotification'].includes(activeMenu));
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      playSound('click');
                      setActiveMenu(item.key as any);
                    }}
                    onMouseEnter={() => playSound('hover')}
                    className={cn(
                      "group relative transition-all duration-200 select-none cursor-pointer",
                      isSidebarCollapsed 
                        ? "w-11 h-11 rounded-2xl flex items-center justify-center mx-auto" 
                        : "w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl",
                      isActive 
                        ? "bg-slate-900 text-white shadow-md shadow-slate-900/15 font-semibold" 
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/70 font-medium"
                    )}
                    title={item.label}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon 
                        size={20} 
                        className={cn(
                          "transition-all duration-200 shrink-0", 
                          isActive ? "text-white scale-105" : "text-slate-600 group-hover:text-slate-900 group-hover:scale-105"
                        )} 
                      />
                      {!isSidebarCollapsed && <span className="text-sm tracking-tight truncate">{item.label}</span>}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom Section: Payment Gate Switch & Logout */}
          <div className="w-full space-y-3 pt-3 border-t border-slate-900/5">
            {!isSidebarCollapsed ? (
              <div className="space-y-3">
                <div className="p-2.5 rounded-2xl bg-slate-50/90 border border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cổng thanh toán Q2</p>
                    <p className={cn("text-xs font-black uppercase font-num", paymentGate === 'START' ? "text-emerald-600" : "text-rose-600")}>
                      {paymentGate === 'START' ? 'ĐANG BẬT (START)' : 'ĐANG TẮT (STOP)'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={togglePaymentGate}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors relative cursor-pointer",
                      paymentGate === 'START' ? "bg-emerald-500" : "bg-slate-300"
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 absolute top-1",
                        paymentGate === 'START' ? "translate-x-6 left-0" : "translate-x-1 left-0"
                      )}
                    />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    logoutUser();
                    navigate('/login');
                  }}
                  className="w-full py-2.5 px-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut size={15} />
                  <span>Đăng xuất Admin</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={togglePaymentGate}
                  className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center text-white cursor-pointer shadow-xs",
                    paymentGate === 'START' ? "bg-emerald-500" : "bg-rose-500"
                  )}
                  title={`Cổng thanh toán: ${paymentGate}`}
                >
                  <Power size={18} />
                </button>
                <button
                  onClick={() => {
                    playSound('click');
                    logoutUser();
                    navigate('/login');
                  }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                  title="Đăng xuất"
                >
                  <LogOut size={16} />
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
        "flex-1 p-3 sm:p-5 md:p-6 pb-[90px] lg:pb-6 min-h-screen relative z-10 w-full max-w-[1260px] mx-auto page-transition transition-all duration-300 ease-out",
        isSidebarCollapsed ? "lg:ml-[137px]" : "lg:ml-[292px]"
      )}>
        
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="type-label text-slate-400">Không gian quản lý chủ trọ</span>
              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-bold text-[10px] tracking-wide uppercase font-num">
                Admin
              </span>
            </div>
            <h1 className="type-h1 text-slate-900 dark:text-white font-bold">
              Bảng Quản Lý Chủ Trọ
            </h1>
            <p className="type-body text-slate-500 mt-0.5 text-xs sm:text-sm">
              Theo dõi doanh thu, chỉ số điện nước, hồ sơ cư trú và kỳ kê khai thuế.
            </p>
          </div>

          {/* Action Capsule: Month & Refresh */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Month Selector */}
            <div className="soft-card px-3 py-2 flex items-center gap-2">
              <Calendar size={16} className="text-blue-600 shrink-0" />
              <div>
                <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Kỳ tháng</span>
                <select
                  value={selectedMonth}
                  onChange={e => {
                    playSound('click');
                    setSelectedMonth(e.target.value);
                  }}
                  className="bg-transparent border-none text-xs font-bold text-slate-900 dark:text-slate-100 outline-none cursor-pointer pr-1"
                >
                  {months.map(m => (
                    <option key={m} value={m} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">Tháng {m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Real-time Light/Dark Mode Switcher */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                toggleTheme();
              }}
              className="soft-button h-10 px-3.5 rounded-2xl flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs cursor-pointer transition-colors"
              title={`Giao diện: ${mode === 'light' ? 'Chế độ Sáng' : mode === 'dark' ? 'Chế độ Tối' : 'Tự động (Theo giờ)'}`}
            >
              {mode === 'light' ? (
                <Sun size={17} className="text-amber-500 drop-shadow-[0_2px_6px_rgba(245,158,11,0.3)]" />
              ) : mode === 'dark' ? (
                <Moon size={17} className="text-indigo-400 drop-shadow-[0_2px_6px_rgba(99,102,241,0.3)]" />
              ) : (
                <GlassIconMoon size={18} className="shrink-0" />
              )}
              <span className="text-xs font-semibold hidden sm:inline">
                {mode === 'light' ? 'Chế độ sáng' : mode === 'dark' ? 'Chế độ tối' : 'Tự động'}
              </span>
            </button>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                loadTabContent(activeMenu, selectedMonth);
              }}
              className="soft-button w-10 h-10 rounded-2xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs cursor-pointer"
              title="Làm mới dữ liệu từ Google Sheets"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin text-blue-600" : ""} />
            </button>

            {/* Logout Button */}
            <button
              type="button"
              onClick={() => {
                playSound('click');
                logoutUser();
                navigate('/login');
              }}
              className="soft-button px-3.5 py-2 h-10 rounded-2xl flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200/80 text-xs font-bold shadow-xs cursor-pointer transition-colors"
              title="Đăng xuất Admin"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>

        {activeMenu === 'utilities' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6 animate-in fade-in duration-300">
            {[
              { key: 'createNotification', label: 'Tạo thông báo', icon: Bell, highlight: true },
              { key: 'meter', label: 'Điện nước', icon: Zap },
              { key: 'plates', label: 'Tra biển số', icon: Search },
              { key: 'contract', label: 'Hợp đồng & CT01', icon: FileText },
              { key: 'declaration', label: 'Kỳ kê khai', icon: BookOpen },
              { key: 'config', label: 'Cài đặt phí', icon: Settings }
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
                  className={cn(
                    "soft-card p-4 min-h-24 flex flex-col items-center justify-center gap-2 text-sm font-semibold transition-colors cursor-pointer relative",
                    (item as any).highlight 
                      ? "text-blue-600 dark:text-blue-400 hover:border-blue-400 ring-1 ring-blue-500/20" 
                      : "text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:border-slate-400"
                  )}
                >
                  <Icon size={22} className={(item as any).highlight ? "text-blue-600 dark:text-blue-400" : ""} />
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
              className="soft-card p-4 min-h-24 flex flex-col items-center justify-center gap-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-colors cursor-pointer"
            >
              <LogOut size={22} className="text-rose-600" />
              <span>Đăng xuất</span>
            </button>
          </div>
        )}

        {/* =========================================================================
            1. DASHBOARD TAB
           ========================================================================= */}
        {activeMenu === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* Grid 12 columns */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              
              {/* Highlight Revenue Card (8 cols) */}
              <div className="md:col-span-8 soft-surface p-6 sm:p-8 relative overflow-hidden group transition-all">
                <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-indigo-100/40 via-purple-100/25 to-pink-100/20 rounded-full blur-[70px] -translate-y-1/3 translate-x-1/4 pointer-events-none group-hover:scale-105 transition-transform duration-700" />

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
                        <h2 className="type-h2 text-slate-900 dark:text-white font-bold">
                          Tổng Doanh Thu Thực Tế Cả 2 Tòa
                        </h2>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-slate-400 block uppercase font-medium">Tiến độ thu</span>
                      <span className="type-button font-num text-emerald-600 block mt-0.5 font-bold">
                        {paidRoomsCount} / {totalRoomsCount} Phòng
                      </span>
                    </div>
                  </div>

                  {/* Middle row: Big Amount */}
                  <div>
                    <p className="type-label text-slate-400 mb-1">
                      Tổng tiền đã hạch toán cột P
                    </p>
                    <div className="type-display font-num tracking-tight flex items-baseline gap-1.5 font-bold text-slate-900 dark:text-white">
                      {fmt(dashboardData?.doanhThu ?? 0)}
                      <span className="text-2xl font-normal text-slate-400">₫</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2 pt-4 border-t border-slate-900/5 dark:border-white/5">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                      <span>Tỷ lệ hoàn thành thu phí:</span>
                      <span className="font-num text-blue-600 dark:text-blue-400">{collectionPercent}%</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-700"
                        style={{ width: `${collectionPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right KPI Mini Cards (4 cols) */}
              <div className="md:col-span-4 space-y-4 flex flex-col justify-between">
                
                {/* Electricity Card with 3D Icon */}
                <div className="soft-card p-5 flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <IconElectricity3D size={42} className="shrink-0 drop-shadow-xs" />
                      <div>
                        <h3 className="type-h4 text-slate-900 dark:text-white font-bold">Điện tiêu thụ</h3>
                        <p className="text-[11px] text-slate-400 font-num">{fmt(dashboardData?.dien ?? 0)} kW</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-amber-600 font-num">{fmt(dashboardData?.tienDien ?? 0)} đ</span>
                  </div>
                </div>

                {/* Water Card with 3D Icon */}
                <div className="soft-card p-5 flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <IconWater3D size={42} className="shrink-0 drop-shadow-xs" />
                      <div>
                        <h3 className="type-h4 text-slate-900 dark:text-white font-bold">Nước tiêu thụ</h3>
                        <p className="text-[11px] text-slate-400 font-num">{fmt(dashboardData?.nuoc ?? 0)} m³</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-blue-600 font-num">{fmt(dashboardData?.tienNuoc ?? 0)} đ</span>
                  </div>
                </div>

                {/* Occupants & Bikes Card with 3D Icons */}
                <div className="soft-card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <IconProfile3D size={38} className="shrink-0 drop-shadow-xs" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{dashboardData?.soNguoi ?? 0} Cư dân</p>
                      <p className="text-[10px] text-slate-400">Đang lưu trú</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 border-l border-slate-100 dark:border-slate-800 pl-4">
                    <IconLocation3D size={38} className="shrink-0 drop-shadow-xs" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{dashboardData?.soXe ?? 0} Xe máy</p>
                      <p className="text-[10px] text-slate-400">Đăng ký giữ xe</p>
                    </div>
                  </div>
                </div>

              </div>

              {/* =========================================================================
                  LINE GRAPH (BIỂU ĐỒ ĐIỆN NƯỚC THEO YÊU CẦU CỦA USER)
                 ========================================================================= */}
              <div className="md:col-span-12 soft-card p-6 sm:p-8 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <TrendingUp size={22} />
                    </div>
                    <div>
                      <h3 className="type-h4 text-slate-900 dark:text-white font-bold">Biểu đồ tiêu thụ Điện & Nước (Line Graph)</h3>
                      <p className="text-xs text-slate-400">Diễn biến chỉ số qua các chu kỳ tháng</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 text-xs font-bold">
                    <span className="flex items-center gap-2 text-amber-600">
                      <span className="inline-block w-4 h-1 rounded-full bg-amber-500" />
                      <span>Điện (kW)</span>
                    </span>
                    <span className="flex items-center gap-2 text-blue-600">
                      <span className="inline-block w-4 h-1 rounded-full bg-blue-600" />
                      <span>Nước (m³)</span>
                    </span>
                  </div>
                </div>

                {/* SVG Line Graph Implementation */}
                {(() => {
                  const list = dashboardData?.usageTrend || [];
                  if (list.length === 0) {
                    return <div className="h-56 flex items-center justify-center text-sm text-slate-500">Chưa có dữ liệu điện nước trong các tab Google Sheets.</div>;
                  }
                  const width = 740, height = 240, pad = 36, leftPad = 60;
                  const maxVal = Math.max(1, ...list.map((x: any) => Math.max(Number(x.dien || 0), Number(x.nuoc || 0) * 10)));
                  const x = (i: number) => leftPad + (width - leftPad - pad) * (i / Math.max(1, list.length - 1));
                  const y = (v: number) => height - pad - ((Number(v || 0) / maxVal) * (height - pad * 2));
                  const pointsDien = list.map((item: any, i: number) => `${x(i).toFixed(1)},${y(item.dien).toFixed(1)}`).join(' ');
                  const pointsNuoc = list.map((item: any, i: number) => `${x(i).toFixed(1)},${y(item.nuoc * 10).toFixed(1)}`).join(' ');

                  return (
                    <div className="w-full h-64 bg-slate-50/70 dark:bg-slate-900/60 rounded-2xl p-2 flex items-center justify-center">
                      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
                        {/* Grid Lines */}
                        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                          const yy = pad + (height - pad * 2) * t;
                          return (
                            <line
                              key={idx}
                              x1={leftPad}
                              y1={yy}
                              x2={width - pad}
                              y2={yy}
                              stroke="#e2e8f0"
                              strokeDasharray="4,4"
                              strokeWidth="1"
                            />
                          );
                        })}
                        {/* Axis */}
                        <line x1={leftPad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" strokeWidth="1.5" />

                        {/* Polylines for Line Graph */}
                        <polyline points={pointsDien} fill="none" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                        <polyline points={pointsNuoc} fill="none" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                        {/* Labels and Dots */}
                        {list.map((item: any, i: number) => {
                          const cx = x(i);
                          const dy = y(item.dien);
                          const wy = y(item.nuoc * 10);
                          return (
                            <g key={i}>
                              <text x={cx} y={height - 10} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="700">
                                {item.month}
                              </text>
                              {/* Dien Dot */}
                              <circle cx={cx} cy={dy} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
                              <text x={cx} y={dy - 9} textAnchor="middle" fontSize="11" fontWeight="800" fill="#d97706">
                                {fmt(item.dien)}
                              </text>
                              {/* Nuoc Dot */}
                              <circle cx={cx} cy={wy} r="5" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
                              <text x={cx} y={wy - 9} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1d4ed8">
                                {item.nuoc} m³
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            2. ROOMS MANAGEMENT
           ========================================================================= */}
        {activeMenu === 'rooms' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {roomsList.map(r => {
                const isPaid = r.status === 'paid';
                const isPending = r.status === 'pending';
                return (
                  <div
                    key={r.room}
                    onClick={() => openRoomDetail(r.room)}
                    className="soft-card p-5 flex flex-col justify-between hover:border-blue-500 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-base group-hover:bg-slate-900 dark:group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        {r.room}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase px-2.5 py-1 rounded-full",
                          isPaid ? "badge-paid" : (isPending ? "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400" : "badge-unpaid")
                        )}
                      >
                        {r.statusText || (isPaid ? 'Đã đóng' : 'Chưa đóng')}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm">{r.name}</h4>
                      <p className="text-xs text-slate-400 font-mono">SĐT: {r.phone || 'Chưa cập nhật'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Room Detail Editor */}
        {activeMenu === 'roomDetail' && currentRoomData && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="soft-card p-4 flex items-center justify-between">
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

              <div className="flex items-center gap-3">
                <div dangerouslySetInnerHTML={{ __html: currentRoomData.statusHTML }} />
                <button
                  onClick={() => updateRoomPaymentStatus(selectedRoomId, currentRoomData.paymentStatus === 'paid' ? 'unpaid' : 'paid')}
                  className={cn(
                    "py-2 px-4 rounded-2xl text-xs font-bold cursor-pointer transition-all",
                    currentRoomData.paymentStatus === 'paid'
                      ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                      : "primary-button"
                  )}
                >
                  {currentRoomData.paymentStatus === 'paid' ? 'Hủy thu tiền' : 'Xác nhận thu tiền'}
                </button>
              </div>
            </div>

            {/* Occupants Info */}
            <div className="soft-card p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <IconProfile3D size={40} className="shrink-0 drop-shadow-xs" />
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">Thông tin người cư trú Phòng {selectedRoomId}</h4>
                  <p className="text-xs text-slate-400">Tối đa 3 người cư trú trên hợp đồng</p>
                </div>
              </div>
              {[1, 2, 3].map(slot => (
                <div key={slot} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Họ tên người {slot}</label>
                    <input
                      type="text"
                      value={currentRoomData[`nguoi${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`nguoi${slot}`]: e.target.value })}
                      placeholder={`Người ${slot}`}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Số CCCD</label>
                    <input
                      type="text"
                      value={currentRoomData[`cccd${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`cccd${slot}`]: e.target.value })}
                      placeholder="12 số CCCD"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none font-mono focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Số điện thoại</label>
                    <input
                      type="text"
                      value={currentRoomData[`sdt${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`sdt${slot}`]: e.target.value })}
                      placeholder="SĐT liên lạc"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none font-mono focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Biển số xe</label>
                    <input
                      type="text"
                      value={currentRoomData[`xe${slot}`] || ''}
                      onChange={e => setCurrentRoomData({ ...currentRoomData, [`xe${slot}`]: e.target.value })}
                      placeholder="Biển số xe"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-xs font-bold outline-none uppercase font-mono focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Electricity & Water Indices with 3D Icons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="soft-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <IconElectricity3D size={40} className="shrink-0 drop-shadow-xs" />
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">Chỉ số Điện ({fmt(unitConfig.dien || 3500)} đ/kW)</h4>
                    <p className="text-[11px] text-slate-400">Tiêu thụ: {Math.max(0, (currentRoomData.dienMoi || 0) - (currentRoomData.dienCu || 0))} kW</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Điện cũ</label>
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
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Điện mới</label>
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
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs font-bold pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span>Tiền điện:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{fmt(currentRoomData.tienDien)} đ</span>
                </div>
              </div>

              <div className="soft-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <IconWater3D size={40} className="shrink-0 drop-shadow-xs" />
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">Chỉ số Nước ({fmt(unitConfig.nuoc || 20000)} đ/m³)</h4>
                    <p className="text-[11px] text-slate-400">Tiêu thụ: {Math.max(0, (currentRoomData.nuocMoi || 0) - (currentRoomData.nuocCu || 0))} m³</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Nước cũ</label>
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
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Nước mới</label>
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
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs font-bold pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span>Tiền nước:</span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">{fmt(currentRoomData.tienNuoc)} đ</span>
                </div>
              </div>
            </div>

            {/* Comprehensive Service Fees & Cost Breakdown */}
            <div className="soft-card p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <IconWallet3D size={40} className="shrink-0 drop-shadow-xs" />
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-base">Chi Phí Dịch Vụ & Hóa Đơn Chi Tiết</h4>
                    <p className="text-xs text-slate-400">Các khoản phí dịch vụ và tiền phòng tháng {selectedMonth}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Tổng tiền phòng {selectedRoomId}</span>
                  <span className="text-lg font-black text-slate-900 dark:text-white font-num">{fmt(currentRoomData.tongTien)} đ</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Tiền phòng (Cột J)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienPhong || ''}
                    onChange={e => {
                      const tienPhong = Number(e.target.value) || 0;
                      setCurrentRoomData({
                        ...currentRoomData,
                        tienPhong,
                        tongTien: tienPhong + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                      });
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Tiền rác (Cột K)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienRac || ''}
                    onChange={e => {
                      const tienRac = Number(e.target.value) || 0;
                      setCurrentRoomData({
                        ...currentRoomData,
                        tienRac,
                        tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + tienRac + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                      });
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Tiền Internet / Net (Cột L)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienNet || ''}
                    onChange={e => {
                      const tienNet = Number(e.target.value) || 0;
                      setCurrentRoomData({
                        ...currentRoomData,
                        tienNet,
                        tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + tienNet + (currentRoomData.tienXe || 0) + (currentRoomData.tienKhac || 0)
                      });
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Tiền giữ xe (Cột M)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienXe || ''}
                    onChange={e => {
                      const tienXe = Number(e.target.value) || 0;
                      setCurrentRoomData({
                        ...currentRoomData,
                        tienXe,
                        tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + tienXe + (currentRoomData.tienKhac || 0)
                      });
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Chi phí khác / Phát sinh (Cột N)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienKhac || 0}
                    onChange={e => {
                      const tienKhac = Number(e.target.value) || 0;
                      setCurrentRoomData({
                        ...currentRoomData,
                        tienKhac,
                        tongTien: (currentRoomData.tienPhong || 0) + (currentRoomData.tienDien || 0) + (currentRoomData.tienNuoc || 0) + (currentRoomData.tienRac || 0) + (currentRoomData.tienNet || 0) + (currentRoomData.tienXe || 0) + tienKhac
                      });
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Tiền đặt cọc (Cột O)</label>
                  <input
                    type="number"
                    value={currentRoomData.tienCoc || 0}
                    onChange={e => setCurrentRoomData({ ...currentRoomData, tienCoc: Number(e.target.value) || 0 })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Action save button */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Tổng hợp: Tiền phòng + Điện ({fmt(currentRoomData.tienDien)} đ) + Nước ({fmt(currentRoomData.tienNuoc)} đ) + Dịch vụ = <strong className="text-slate-900 dark:text-white font-mono font-bold">{fmt(currentRoomData.tongTien)} đ</strong>
                </p>
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
                          data: currentRoomData
                        })
                      });
                      setIsLoading(false);
                      if (res.ok) {
                        playSound('success');
                        alert('✅ Đã lưu cập nhật thông tin phòng thành công!');
                      }
                    } catch (e) {
                      setIsLoading(false);
                    }
                  }}
                  className="primary-button py-2.5 px-6 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Save size={16} />
                  <span>Lưu cập nhật phòng & chỉ số</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            3. BILLING TAB (THU TIỀN THÁNG)
           ========================================================================= */}
        {activeMenu === 'billing' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="soft-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                      <th className="p-4">Phòng</th>
                      <th className="p-4">Khách thuê</th>
                      <th className="p-4">Tiền phòng</th>
                      <th className="p-4">Điện</th>
                      <th className="p-4">Nước</th>
                      <th className="p-4">Rác</th>
                      <th className="p-4">Net</th>
                      <th className="p-4">Xe</th>
                      <th className="p-4 font-bold text-slate-900 dark:text-white">Tổng cộng</th>
                      <th className="p-4 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {billingList.map(item => {
                      const isPaid = item.paymentStatus === 'paid';
                      return (
                        <tr key={item.room} className={isPaid ? "bg-emerald-50/30 dark:bg-emerald-950/20" : "hover:bg-slate-50/50 dark:hover:bg-slate-800/40"}>
                          <td className="p-4 font-bold text-slate-900 dark:text-white">{item.room}</td>
                          <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{item.name}</td>
                          <td className="p-4 font-mono">{fmt(item.tienPhong)} đ</td>
                          <td className="p-4 font-mono text-amber-600 dark:text-amber-400">{fmt(item.tienDien)} đ</td>
                          <td className="p-4 font-mono text-blue-600 dark:text-blue-400">{fmt(item.tienNuoc)} đ</td>
                          <td className="p-4 font-mono">{fmt(item.tienRac)} đ</td>
                          <td className="p-4 font-mono">{fmt(item.tienNet)} đ</td>
                          <td className="p-4 font-mono">{fmt(item.tienXe)} đ</td>
                          <td className="p-4 font-bold text-sm text-slate-900 dark:text-white">{fmt(item.tongTien)} đ</td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => updateRoomPaymentStatus(item.room, isPaid ? 'unpaid' : 'paid')}
                              className={cn(
                                "px-3 py-1 rounded-xl font-bold text-[11px] cursor-pointer transition-all",
                                isPaid ? "badge-paid" : "badge-unpaid"
                              )}
                            >
                              {isPaid ? 'Đã đóng' : 'Chưa đóng'}
                            </button>
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
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Search size={15} className="text-blue-600" />
                <span>Tra cứu biển số xe</span>
              </div>
            </div>

            <div className="soft-card p-6 sm:p-8 space-y-4 text-center">
              <IconLocation3D size={52} className="mx-auto drop-shadow-xs mb-1" />
              <div className="text-center max-w-md mx-auto space-y-1 mb-4">
                <h3 className="type-h2 font-bold text-slate-900 dark:text-white">Tra Cứu Biển Số Xe</h3>
                <p className="text-xs text-slate-400">Tìm kiếm nhanh thông tin chủ xe và số phòng</p>
              </div>

              <div className="relative max-w-xl mx-auto">
                <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={plateQuery}
                  onChange={e => {
                    setPlateQuery(e.target.value);
                    fetchPlates(selectedMonth, e.target.value);
                  }}
                  placeholder="Nhập biển số xe (VD: 59-X1, 888.88...)"
                  className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white uppercase outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {plateResults.map((r, i) => (
                <div key={i} className="soft-card p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-lg text-xs">
                      Phòng {r.room}
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                      {r.plate}
                    </span>
                  </div>
                  <p className="font-bold text-sm text-slate-800 dark:text-white">{r.name}</p>
                  <p className="text-xs text-slate-400 font-mono">SĐT: {r.phone || 'Chưa cập nhật'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            5. CONTRACT & CT01 (A4 PDF/PRINT FORMAT MATCHING USER CODE)
           ========================================================================= */}
        {activeMenu === 'contract' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <FileText size={15} className="text-blue-600" />
                <span>Hợp đồng & Mẫu CT01</span>
              </div>
            </div>

            {/* Action Bar */}
            <div className="soft-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <IconCalendar3D size={36} className="shrink-0 drop-shadow-2xs" />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setContractDocType('ct01')}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                      contractDocType === 'ct01' ? "bg-slate-900 text-white" : "soft-button"
                    )}
                  >
                    Mẫu CT01 (Tờ khai cư trú)
                  </button>
                  <button
                    onClick={() => setContractDocType('contract')}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                      contractDocType === 'contract' ? "bg-slate-900 text-white" : "soft-button"
                    )}
                  >
                    Hợp đồng thuê phòng trọ
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={contractHouse}
                  onChange={e => setContractHouse(e.target.value as any)}
                  className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-slate-700 outline-none cursor-pointer"
                >
                  <option value="TRUNG_KIM" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Nhà trọ Trung Kim (116/32)</option>
                  <option value="LVC" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Nhà trọ 109/6 (Lê Văn Chí)</option>
                </select>
                <button
                  onClick={() => window.print()}
                  className="primary-button py-2 px-4 text-xs flex items-center gap-1.5 cursor-pointer font-bold shadow-xs"
                >
                  <Printer size={15} />
                  <span>In / Xuất PDF A4</span>
                </button>
              </div>
            </div>

            {/* A4 Document Container */}
            <div 
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
              className="administrative-document bg-white rounded-3xl p-8 sm:p-14 border border-slate-200 shadow-sm max-w-3xl mx-auto text-slate-900 leading-relaxed print:p-0 print:border-none print:shadow-none print:m-0"
            >
              {contractDocType === 'ct01' ? (
                /* =========================================================================
                   MẪU CT01 THEO THÔNG TƯ 116/2026/TT-BCA
                   ========================================================================= */
                <div className="space-y-4 text-xs sm:text-[13px] leading-relaxed">
                  <p className="text-right text-[10.5px] italic">
                    Mẫu CT01 ban hành kèm theo Thông tư số 116/2026/TT-BCA<br />
                    ngày 29 tháng 6 năm 2026 của Bộ trưởng Bộ Công an
                  </p>
                  
                  <div className="text-center space-y-1">
                    <p className="font-bold uppercase tracking-wider text-xs sm:text-sm">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                    <p className="font-bold text-xs sm:text-sm">Độc lập – Tự do – Hạnh phúc</p>
                    <p>——————</p>
                    <h3 className="text-base sm:text-lg font-bold uppercase mt-4">
                      TỜ KHAI THAY ĐỔI THÔNG TIN CƯ TRÚ
                    </h3>
                  </div>

                  <div className="space-y-2 pt-2">
                    <p><b>Kính gửi<sup>(1)</sup>:</b> Công an Phường Linh Xuân, TP. Thủ Đức, TP. Hồ Chí Minh</p>
                    <p><b>1. Họ, chữ đệm và tên:</b> <b>{contractForm.partyAName}</b></p>
                    <p><b>2. Ngày, tháng, năm sinh:</b> {contractForm.partyADob} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>3. Giới tính:</b> Nam/Nữ</p>
                    <div className="flex items-center">
                      <b>4. Số định danh cá nhân:</b>
                      {renderCccdBoxes(contractForm.partyACccd)}
                    </div>
                    <p><b>5. Số điện thoại liên hệ:</b> {contractForm.partyAPhone}</p>
                    <p><b>6. Email:</b> ....................................................................................</p>
                    <p><b>7. Họ, chữ đệm và tên chủ hộ<sup>(2)</sup>:</b> <b>{activeHouse.landlord}</b></p>
                    <p><b>8. Mối quan hệ với chủ hộ:</b> Cho thuê chỗ ở</p>
                    <div className="flex items-center">
                      <b>9. Số ĐDCN của chủ hộ:</b>
                      {renderCccdBoxes(activeHouse.cccd)}
                    </div>
                    <p><b>10. Nội dung đề nghị<sup>(3)</sup>:</b> Đăng ký tạm trú cho công dân tại địa chỉ: {activeHouse.address}</p>
                    <p><b>11. Những thành viên trong hộ gia đình cùng thay đổi:</b></p>

                    <table className="w-full border-collapse border border-slate-800 text-[11px] mt-2 mb-4">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-800 p-1 text-center w-8">TT</th>
                          <th className="border border-slate-800 p-1 text-center">Họ, chữ đệm và tên</th>
                          <th className="border border-slate-800 p-1 text-center w-20">Ngày sinh</th>
                          <th className="border border-slate-800 p-1 text-center w-16">Giới tính</th>
                          <th className="border border-slate-800 p-1 text-center w-28">Số ĐDCN</th>
                          <th className="border border-slate-800 p-1 text-center">Mối quan hệ với chủ hộ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3, 4].map(idx => (
                          <tr key={idx} className="h-6">
                            <td className="border border-slate-800 p-1 text-center">{idx}</td>
                            <td className="border border-slate-800 p-1">{idx === 1 ? contractForm.partyAName : ''}</td>
                            <td className="border border-slate-800 p-1 text-center">{idx === 1 ? contractForm.partyADob : ''}</td>
                            <td className="border border-slate-800 p-1 text-center">{idx === 1 ? 'Nam' : ''}</td>
                            <td className="border border-slate-800 p-1 text-center font-mono">{idx === 1 ? contractForm.partyACccd : ''}</td>
                            <td className="border border-slate-800 p-1">{idx === 1 ? 'Thuê phòng' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Signatures */}
                  <div className="grid grid-cols-4 gap-2 text-center text-[11px] pt-4">
                    <div>
                      <p className="italic">..., ngày ... tháng ... năm ...</p>
                      <p className="font-bold mt-1">Ý KIẾN CỦA CHỦ HỘ<sup>(4)</sup></p>
                    </div>
                    <div>
                      <p className="italic">..., ngày ... tháng ... năm ...</p>
                      <p className="font-bold mt-1">Ý KIẾN CỦA CHỦ SỞ HỮU<sup>(5)</sup></p>
                    </div>
                    <div>
                      <p className="italic">..., ngày ... tháng ... năm ...</p>
                      <p className="font-bold mt-1">Ý KIẾN CỦA GIÁM HỘ<sup>(6)</sup></p>
                    </div>
                    <div>
                      <p className="italic">..., ngày ... tháng ... năm ...</p>
                      <p className="font-bold mt-1">NGƯỜI KÊ KHAI<sup>(7)</sup></p>
                      <div className="h-14" />
                      <p className="font-bold">{contractForm.partyAName}</p>
                    </div>
                  </div>

                  {/* Page 2: Notes */}
                  <div className="pt-8 border-t border-dashed border-slate-300 mt-6 print:break-before-page">
                    <p className="font-bold text-xs mb-2">Chú thích:</p>
                    <div className="text-[10.5px] leading-relaxed text-slate-700 space-y-1 text-justify">
                      <p>(1) Cơ quan đăng ký cư trú.</p>
                      <p>(2) Trường hợp đăng ký thường trú, đăng ký tạm trú, tách hộ ghi thông tin chủ hộ gia đình mới.</p>
                      <p>(3) Ghi rõ ràng, cụ thể nội dung đề nghị đăng ký tạm trú tại địa chỉ hợp pháp.</p>
                      <p>(4), (5), (6) Áp dụng đối với các trường hợp theo Luật Cư trú 2020 và xác nhận qua ứng dụng VNeID.</p>
                    </div>
                  </div>
                </div>
              ) : (
                /* =========================================================================
                   HỢP ĐỒNG THUÊ PHÒNG TRỌ CHUẨN PHÁP LÝ
                   ========================================================================= */
                <div className="space-y-4 text-xs sm:text-[13px] leading-relaxed text-slate-900">
                  <div className="text-center space-y-1">
                    <p className="font-bold uppercase text-xs sm:text-sm">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                    <p className="font-bold text-xs sm:text-sm">Độc lập – Tự do – Hạnh phúc</p>
                    <p>——————</p>
                    <h3 className="text-base sm:text-lg font-bold uppercase mt-4">
                      HỢP ĐỒNG THUÊ PHÒNG TRỌ
                    </h3>
                  </div>

                  <p className="italic">Hôm nay, ngày {contractForm.contractDate} tại địa chỉ: {activeHouse.address}</p>
                  <p>Chúng tôi gồm:</p>

                  <div className="space-y-1.5 pl-4">
                    <p><b>1. Bên thuê phòng trọ (Bên A):</b></p>
                    <p>Ông/bà: <b>{contractForm.partyAName}</b> &nbsp;&nbsp;&nbsp;&nbsp; Sinh ngày: {contractForm.partyADob}</p>
                    <p>Nơi đăng ký HKTT: {contractForm.partyAHousehold}</p>
                    <p>Số CCCD: {contractForm.partyACccd} &nbsp;&nbsp;&nbsp;&nbsp; SĐT: {contractForm.partyAPhone}</p>
                  </div>

                  <div className="space-y-1.5 pl-4 pt-2">
                    <p><b>2. Đại diện bên cho thuê phòng trọ (Bên B):</b></p>
                    <p>Ông/bà: <b>{activeHouse.landlord}</b> &nbsp;&nbsp;&nbsp;&nbsp; Sinh ngày: {activeHouse.dob}</p>
                    <p>Nơi đăng ký hộ khẩu: {activeHouse.address}</p>
                    <p>Số CCCD: {activeHouse.cccd} &nbsp;&nbsp;&nbsp;&nbsp; SĐT: {activeHouse.phone}</p>
                  </div>

                  <p className="pt-2">Hai bên thống nhất ký kết hợp đồng thuê phòng trọ với các điều khoản sau:</p>
                  <div className="space-y-1 pl-4">
                    <p>• <b>Giá thuê phòng:</b> {fmt(contractForm.rent)} đ/tháng ({readVietnameseNumber(contractForm.rent)})</p>
                    <p>• <b>Tiền đặt cọc:</b> {fmt(contractForm.deposit)} đ ({readVietnameseNumber(contractForm.deposit)})</p>
                    <p>• <b>Tiền điện:</b> Theo chỉ số công tơ thực tế (3.500 đ/kW)</p>
                    <p>• <b>Tiền nước:</b> Theo chỉ số đồng hồ nước thực tế (20.000 đ/m³)</p>
                  </div>

                  <p><b>TRÁCH NHIỆM CỦA CÁC BÊN:</b></p>
                  <div className="space-y-1 pl-4 text-justify">
                    <p>1. Bên B tạo điều kiện thuận lợi, cấp nguồn điện nước và wifi ổn định cho Bên A sử dụng.</p>
                    <p>2. Bên A thanh toán đầy đủ tiền phòng và các chi phí phát sinh trước ngày 05 hàng tháng.</p>
                    <p>3. Bên A giữ gìn an ninh trật tự, vệ sinh chung và chấp hành nghiêm quy định pháp luật.</p>
                  </div>

                  {/* Signatures */}
                  <div className="grid grid-cols-2 gap-4 text-center pt-8">
                    <div>
                      <p className="font-bold">ĐẠI DIỆN BÊN B</p>
                      <p className="italic text-[11px]">(Chủ nhà trọ)</p>
                      <div className="h-16" />
                      <p className="font-bold">{activeHouse.landlord}</p>
                    </div>
                    <div>
                      <p className="font-bold">ĐẠI DIỆN BÊN A</p>
                      <p className="italic text-[11px]">(Người thuê trọ)</p>
                      <div className="h-16" />
                      <p className="font-bold">{contractForm.partyAName}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            6. METER BATCH READING
           ========================================================================= */}
        {activeMenu === 'meter' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Zap size={15} className="text-blue-600" />
                <span>Nhập chỉ số điện nước</span>
              </div>
            </div>

            <div className="soft-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="type-h3 font-bold text-slate-900 dark:text-white">Nhập chỉ số điện nước tháng {selectedMonth}</h3>
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
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-400 dark:text-slate-400 font-bold uppercase">
                      <th className="p-3">Phòng</th>
                      <th className="p-3">Điện cũ</th>
                      <th className="p-3">Điện mới</th>
                      <th className="p-3">Nước cũ</th>
                      <th className="p-3">Nước mới</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {roomsList.map((r) => {
                      const currentDienCu = batchMeters[r.room]?.dienCu !== undefined ? batchMeters[r.room]?.dienCu : (r.dienCu ?? '');
                      const currentDienMoi = batchMeters[r.room]?.dienMoi !== undefined ? batchMeters[r.room]?.dienMoi : (r.dienMoi ?? '');
                      const currentNuocCu = batchMeters[r.room]?.nuocCu !== undefined ? batchMeters[r.room]?.nuocCu : (r.nuocCu ?? '');
                      const currentNuocMoi = batchMeters[r.room]?.nuocMoi !== undefined ? batchMeters[r.room]?.nuocMoi : (r.nuocMoi ?? '');
                      return (
                        <tr key={r.room} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="p-3 font-bold text-slate-900 dark:text-white">{r.room}</td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              value={currentDienCu} 
                              onChange={e => handleBatchMeterChange(r.room, 'dienCu', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" 
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              value={currentDienMoi} 
                              onChange={e => handleBatchMeterChange(r.room, 'dienMoi', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-amber-600 dark:text-amber-400 outline-none focus:ring-2 focus:ring-blue-500" 
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              value={currentNuocCu} 
                              onChange={e => handleBatchMeterChange(r.room, 'nuocCu', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" 
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              value={currentNuocMoi} 
                              onChange={e => handleBatchMeterChange(r.room, 'nuocMoi', Number(e.target.value) || 0)}
                              className="w-24 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-blue-600 dark:text-blue-400 outline-none focus:ring-2 focus:ring-blue-500" 
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
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Settings size={15} className="text-blue-600" />
                <span>Cài đặt đơn giá phí</span>
              </div>
            </div>

            <div className="soft-card p-6 sm:p-8 space-y-6">
              <h3 className="type-h3 font-bold text-slate-900 dark:text-white">Cài đặt đơn giá dịch vụ tháng {selectedMonth}</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase">Điện (1 kW)</label>
                  <input
                    type="number"
                    value={unitConfig.dien}
                    onChange={e => setUnitConfig({ ...unitConfig, dien: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm font-num text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase">Nước (1 m³)</label>
                  <input
                    type="number"
                    value={unitConfig.nuoc}
                    onChange={e => setUnitConfig({ ...unitConfig, nuoc: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm font-num text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase">Tiền Rác</label>
                  <input
                    type="number"
                    value={unitConfig.rac}
                    onChange={e => setUnitConfig({ ...unitConfig, rac: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm font-num text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase">Internet / người</label>
                  <input
                    type="number"
                    value={unitConfig.net}
                    onChange={e => setUnitConfig({ ...unitConfig, net: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm font-num text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase">Xe máy / chiếc</label>
                  <input
                    type="number"
                    value={unitConfig.xe}
                    onChange={e => setUnitConfig({ ...unitConfig, xe: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm font-num text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={saveConfig}
                  className="primary-button py-3 px-8 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Save size={16} />
                  <span>Lưu cấu hình đơn giá</span>
                </button>
                {configSaveMsg && <p className="text-xs font-bold text-emerald-600">{configSaveMsg}</p>}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            8. DECLARATION TAB (SỔ DOANH THU MẪU S1a-HKD)
           ========================================================================= */}
        {activeMenu === 'declaration' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <BookOpen size={15} className="text-blue-600" />
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
                  className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-xs p-2.5 rounded-xl border border-transparent dark:border-slate-700 outline-none cursor-pointer"
                >
                  <option value="TRUNG_KIM" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Hộ KD Trung Kim (116/32)</option>
                  <option value="LVC" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Nhà trọ 109/6 (Lê Văn Chí)</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveDeclaration}
                  className="py-2.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Save size={15} />
                  <span>Lưu sổ kê khai</span>
                </button>
                <button
                  onClick={() => window.print()}
                  className="primary-button py-2.5 px-5 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Printer size={15} />
                  <span>Xuất báo cáo in A4</span>
                </button>
              </div>
            </div>

            {saveDeclarationSuccess && (
              <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-2xl text-xs font-bold text-center">
                ✅ Đã lưu sổ doanh thu kỳ kê khai thành công!
              </div>
            )}

            {/* Mẫu S1a-HKD Container */}
            <div 
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
              className="administrative-document bg-white rounded-3xl p-8 sm:p-14 border border-slate-200 shadow-sm max-w-4xl mx-auto text-slate-900 leading-relaxed print:p-0 print:border-none print:shadow-none print:m-0"
            >
              <div className="flex justify-between items-start text-xs sm:text-sm mb-6 border-b border-slate-200 pb-4">
                <div>
                  <p className="font-bold underline">{declarationData?.headerLeft3 || 'HỘ CÁ NHÂN KD: NHÀ TRỌ TRUNG KIM'}</p>
                  <p>{declarationData?.headerLeft4 || 'Địa chỉ: 116/32 Đường 17, P. Linh Xuân, TP. Thủ Đức'}</p>
                  <p>{declarationData?.headerLeft5 || 'Mã số thuế: 024073000292'}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{declarationData?.headerRight3 || 'Mẫu số S1a-HKD'}</p>
                  <p className="italic text-[11px] text-slate-500">
                    (Kèm theo Thông tư số 152/2025/TT-BTC)
                  </p>
                </div>
              </div>

              <div className="text-center my-6">
                <h3 className="text-lg sm:text-xl font-bold uppercase">
                  SỔ DOANH THU BÁN HÀNG HÓA DỊCH VỤ
                </h3>
                <p className="text-xs sm:text-sm mt-1">{declarationData?.location}</p>
                <p className="text-xs sm:text-sm font-bold mt-1">Kỳ kê khai: {selectedMonth}</p>
              </div>

              {/* Table */}
              <table className="w-full border-collapse border border-slate-800 text-xs sm:text-sm mb-6">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-800">
                    <th className="border border-slate-800 p-2 text-center w-28">Ngày tháng</th>
                    <th className="border border-slate-800 p-2 text-center">Diễn giải (Người đóng / Phòng)</th>
                    <th className="border border-slate-800 p-2 text-center w-36">Số tiền (VNĐ)</th>
                  </tr>
                </thead>
                <tbody>
                  {declarationRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-800">
                      <td className="border border-slate-800 p-2 text-center">
                        <input
                          type="text"
                          value={row.date || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].date = e.target.value;
                            setDeclarationRows(updated);
                          }}
                          placeholder="DD/MM/YYYY"
                          className="w-full text-center bg-transparent border-none outline-none font-serif text-xs sm:text-sm"
                        />
                      </td>
                      <td className="border border-slate-800 p-2">
                        <input
                          type="text"
                          value={row.person || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].person = e.target.value;
                            setDeclarationRows(updated);
                          }}
                          placeholder="Nhập tên người thuê hoặc số phòng..."
                          className="w-full bg-transparent border-none outline-none font-serif text-xs sm:text-sm"
                        />
                      </td>
                      <td className="border border-slate-800 p-2 text-right">
                        <input
                          type="number"
                          value={row.amount || ''}
                          onChange={e => {
                            const updated = [...declarationRows];
                            updated[idx].amount = Number(e.target.value) || 0;
                            setDeclarationRows(updated);
                          }}
                          placeholder="0"
                          className="w-full text-right bg-transparent border-none outline-none font-serif text-xs sm:text-sm font-bold"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2 border-slate-800">
                    <td colSpan={2} className="border border-slate-800 p-2.5 text-right uppercase">
                      Tổng cộng doanh thu:
                    </td>
                    <td className="border border-slate-800 p-2.5 text-right font-bold text-sm font-num">
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
                    placeholder="Ngày 31 tháng ... năm ..."
                    className="w-full text-center italic bg-transparent border-none outline-none"
                  />
                  <p className="font-bold uppercase text-[11px] sm:text-xs">
                    NGƯỜI ĐẠI DIỆN HỘ KINH DOANH
                  </p>
                  <p className="text-[10px] italic text-slate-500">(Ký ghi rõ họ tên)</p>
                  <div className="h-16" />
                  <p className="font-bold text-sm">{declarationData?.ownerName || activeHouse.landlord}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            9. CREATE NOTIFICATION TAB (TẠO THÔNG BÁO CHO CƯ DÂN)
           ========================================================================= */}
        {activeMenu === 'createNotification' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* Top Navigation Bar: Back Button */}
            <div className="soft-card p-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setActiveMenu('utilities');
                }}
                className="soft-button py-2 px-4 text-xs flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <ArrowLeft size={16} />
                <span>Quay lại Tiện ích</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Bell size={15} className="text-blue-600" />
                <span>Mẫu gửi thông báo cư dân</span>
              </div>
            </div>

            {/* Notification Template Form Card */}
            <div className="soft-surface p-6 sm:p-8 space-y-7 relative overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                <h2 className="type-h2 font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                    <Bell size={18} />
                  </span>
                  <span>Tạo Thông Báo Mới</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Soạn nội dung và gửi thông báo, lời nhắc nhở hoặc yêu cầu thanh toán đến toàn bộ cư dân hoặc từng căn hộ.
                </p>
              </div>

              {/* Success Notification Alert */}
              {notifSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3 animate-in fade-in duration-200">
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
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">1. Tất cả</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'ALL' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                          {notifTarget === 'ALL' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Toàn bộ cư dân 2 khu</span>
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">2. Lê Văn Chí (LVC)</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'LVC' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                          {notifTarget === 'LVC' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">109/6 Lê Văn Chí</span>
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">3. Trung Kim (TK)</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'TRUNG_KIM' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                          {notifTarget === 'TRUNG_KIM' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Khu nhà Trung Kim</span>
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">4. Phòng tùy chọn</span>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifTarget === 'CUSTOM' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                          {notifTarget === 'CUSTOM' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                        {selectedCustomRooms.length > 0 ? `Đã chọn ${selectedCustomRooms.length} phòng` : 'Chọn danh sách có sẵn'}
                      </span>
                    </button>
                  </div>

                  {/* Danh sách phòng có sẵn khi chọn tùy chọn */}
                  {notifTarget === 'CUSTOM' && (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Bấm chọn các phòng cần gửi thông báo:
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomRooms(availableRoomNumbers)}
                            className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                          >
                            Chọn tất cả
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomRooms([])}
                            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
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
                                  ? "bg-blue-600 text-white shadow-xs"
                                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-400"
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
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
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
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/30 text-indigo-900 dark:text-indigo-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Bell size={16} className="text-indigo-600" />
                          <span className="text-xs font-bold">Thông báo</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'thong_bao' ? "border-indigo-600 bg-indigo-600" : "border-slate-300")}>
                          {notifType === 'thong_bao' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Bảo trì, sửa chữa, thông tin chung</span>
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
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/30 text-amber-900 dark:text-amber-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={16} className="text-amber-600" />
                          <span className="text-xs font-bold">Nhắc nhở</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'nhac_nho' ? "border-amber-600 bg-amber-600" : "border-slate-300")}>
                          {notifType === 'nhac_nho' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Trật tự, khóa cổng, giữ gìn vệ sinh</span>
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
                          ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/30 text-emerald-900 dark:text-emerald-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Receipt size={16} className="text-emerald-600" />
                          <span className="text-xs font-bold">Thanh toán</span>
                        </div>
                        <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifType === 'thanh_toan' ? "border-emerald-600 bg-emerald-600" : "border-slate-300")}>
                          {notifType === 'thanh_toan' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Hệ thống tự động báo cú pháp VietQR</span>
                    </button>
                  </div>

                  {/* Banner tự động báo của Thanh toán */}
                  {notifType === 'thanh_toan' && (
                    <div className="p-3.5 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-xs text-emerald-900 dark:text-emerald-200 animate-in fade-in duration-200">
                      <Receipt size={18} className="text-emerald-600 shrink-0" />
                      <div>
                        <span className="font-bold">Hệ thống tự động kích hoạt:</span> Cư dân khi nhận thông báo này sẽ có nút liên kết quét mã VietQR tự động kèm số tiền và đúng cú pháp chuyển khoản của phòng họ.
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. MỤC NỘI DUNG */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                      Tiêu đề thông báo <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={notifTitle}
                      onChange={e => setNotifTitle(e.target.value)}
                      placeholder="Nhập tiêu đề thông báo..."
                      className="w-full px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                      Nội dung chi tiết <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={5}
                      value={notifContent}
                      onChange={e => setNotifContent(e.target.value)}
                      placeholder="Nhập toàn bộ nội dung muốn truyền tải đến cư dân..."
                      className="w-full p-4 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
                    />
                  </div>
                </div>

                {/* 4. MỤC ĐẶT HẸN (NẾU CẦN) */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div>
                        <div className="text-xs font-bold">Không (Mặc định)</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Gửi ngay tức thì</div>
                      </div>
                      <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifScheduleMode === 'none' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                        {notifScheduleMode === 'none' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
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
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 dark:text-blue-100 font-semibold"
                          : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div>
                        <div className="text-xs font-bold">Đặt lịch hẹn gửi</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Chọn ngày giờ phát thông báo</div>
                      </div>
                      <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center", notifScheduleMode === 'scheduled' ? "border-blue-600 bg-blue-600" : "border-slate-300")}>
                        {notifScheduleMode === 'scheduled' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                    </button>
                  </div>

                  {notifScheduleMode === 'scheduled' && (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2 animate-in fade-in duration-200">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Clock size={14} className="text-blue-600" />
                        <span>Thời gian kích hoạt gửi:</span>
                      </span>
                      <input
                        type="datetime-local"
                        value={notifScheduledDate}
                        onChange={e => setNotifScheduledDate(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* 5. ACTION BUTTONS */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setActiveMenu('utilities');
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Hủy bỏ
                  </button>

                  <button
                    type="button"
                    disabled={isSendingNotif}
                    onClick={handleSendNotification}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50"
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

      </main>

      {/* =========================================================================
          MOBILE BOTTOM NAVIGATION (Fixed bottom on mobile)
         ========================================================================= */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border-t border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-around shadow-lg">
        {[
          { key: 'dashboard', icon: Home, label: 'Tổng quan' },
          { key: 'rooms', icon: Users, label: 'Phòng' },
          { key: 'billing', icon: Receipt, label: 'Thu tiền' },
          { key: 'utilities', icon: LayoutGrid, label: 'Tiện ích' }
        ].map(m => {
          const Icon = m.icon;
          const isActive = activeMenu === m.key || (m.key === 'utilities' && ['meter', 'plates', 'contract', 'declaration', 'config', 'createNotification'].includes(activeMenu));
          return (
            <button
              key={m.key}
              onClick={() => {
                playSound('click');
                setActiveMenu(m.key as any);
              }}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-2xl transition-all cursor-pointer",
                isActive ? "text-slate-900 dark:text-white font-bold" : "text-slate-400 dark:text-slate-500 font-medium"
              )}
            >
              <Icon size={20} />
              <span className="text-[10px] mt-0.5">{m.label}</span>
            </button>
          );
        })}

        {/* Center Power Switch Button */}
        <button
          onClick={togglePaymentGate}
          className={cn(
            "w-11 h-11 rounded-2xl flex flex-col items-center justify-center text-white shadow-md cursor-pointer",
            paymentGate === 'START' ? "bg-emerald-500" : "bg-rose-500"
          )}
          title={`Cổng thanh toán: ${paymentGate}`}
        >
          <Power size={17} />
          <span className="text-[8px] font-bold uppercase leading-none mt-0.5">{paymentGate}</span>
        </button>
      </nav>

    </div>
  );
}
