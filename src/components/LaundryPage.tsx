import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  ChevronLeft,
  WashingMachine, 
  Timer, 
  Clock, 
  Copy, 
  Check, 
  CalendarClock, 
  BookOpen, 
  RefreshCw, 
  Zap, 
  Power, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles, 
  PhoneCall, 
  Info,
  ImageDown,
  Home
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { soundFx } from '../lib/soundFx';
import { saveQrToDevice } from '../lib/qrHelper';
import { 
  IconLaundry3D, 
  IconDryer3D
} from './Icons3D';

interface Machine {
  machineId: string;
  name: string;
  type: 'WASHER' | 'DRYER';
  status: 'AVAILABLE' | 'RUNNING' | 'MAINTENANCE';
  price: number;
  cycleMinutes: number;
  expectedEndTime: string;
  currentSessionId?: string;
  plugState: 'ON' | 'OFF';
  remainingSeconds?: number;
}

interface Booking {
  bookingId: string;
  machineId: string;
  roomNumber: string;
  tenantName: string;
  tenantPhone: string;
  bookingTime: string;
  bookingDate: string;
  depositAmount: number;
  depositStatus: 'PENDING' | 'PAID';
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
}

export function LaundryPage() {
  const navigate = useNavigate();
  const { profile } = useApp();

  const [machines, setMachines] = useState<Machine[]>([
    { machineId: 'MG01', name: 'Máy Giặt 01 (Cửa trước 9kg)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MG02', name: 'Máy Giặt 02 (Cửa trước 9kg)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MS01', name: 'Máy Sấy 01 (Thông hơi 8kg)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MS02', name: 'Máy Sấy 02 (Thông hơi 8kg)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', plugState: 'OFF' },
  ]);

  // View state: 'list' | 'activate' | 'success' | 'timer'
  const [viewMode, setViewMode] = useState<'list' | 'activate' | 'success' | 'timer'>('list');
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);

  const [activeTab, setActiveTab] = useState<'machines' | 'booking' | 'rules'>('machines');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'WASHER' | 'DRYER'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSavingQR, setIsSavingQR] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Booking form state
  const [bookingMachineId, setBookingMachineId] = useState('MG01');
  const [bookingTime, setBookingTime] = useState('08:00');
  const [bookingDate, setBookingDate] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  });
  const [bookingMsg, setBookingMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);

  // Keep latest refs to avoid stale closure in polling
  const selectedMachineRef = useRef<Machine | null>(null);
  selectedMachineRef.current = selectedMachine;
  const viewModeRef = useRef<'list' | 'activate' | 'success' | 'timer'>('list');
  viewModeRef.current = viewMode;

  const recipientName = 'Bùi Trung Khải';
  const bankName = 'MB Bank (Ngân hàng Quân Đội)';
  const accountNumber = '0902371800';

  // Fetch live laundry status from backend Express server
  const fetchLaundryData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiFetch('/api/laundry/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (Array.isArray(data.machines)) {
            setMachines(data.machines);
            const curSelected = selectedMachineRef.current;
            const curMode = viewModeRef.current;
            
            if (curSelected) {
              const updated = data.machines.find((m: Machine) => m.machineId === curSelected.machineId);
              if (updated) {
                // If in QR activation mode and machine starts running -> trigger success transition!
                if (curMode === 'activate' && updated.status === 'RUNNING') {
                  soundFx.success();
                  setViewMode('success');
                }
                setSelectedMachine(updated);
              }
            }
          }
          if (Array.isArray(data.bookings)) setBookings(data.bookings);
        }
      }
    } catch (err) {
      console.warn('[LaundryPage] Error fetching status:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLaundryData();
    const interval = setInterval(fetchLaundryData, 2500);
    return () => clearInterval(interval);
  }, [fetchLaundryData]);

  // Local seconds ticker for countdown animation
  const [, setTicker] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTicker(prev => prev + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const getRemainingSeconds = (m: Machine | null): number => {
    if (!m || m.status !== 'RUNNING' || !m.expectedEndTime) return 0;
    const endMs = new Date(m.expectedEndTime).getTime();
    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  };

  const formatCurrency = (val: number) => {
    return (val || 0).toLocaleString('vi-VN');
  };

  const formatMoney = (amount: number) => {
    return formatCurrency(amount) + ' đ';
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleCopy = (text: string, key: string) => {
    soundFx.click();
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleOpenMachine = (m: Machine) => {
    setSelectedMachine(m);
    if (m.status === 'RUNNING') {
      soundFx.modalOpen();
      setViewMode('timer');
    } else {
      soundFx.click();
      setViewMode('activate');
      apiFetch('/api/laundry/intent', {
        method: 'POST',
        body: JSON.stringify({ machineId: m.machineId })
      }).catch(() => {});
    }
  };

  // Build clean VietQR URL matching PaymentPage (straight QR without cluttered templates)
  const qrUrl = selectedMachine 
    ? `https://img.vietqr.io/image/mbbank-0902371800-qr_only.png?amount=${selectedMachine.price}&addInfo=${encodeURIComponent(selectedMachine.machineId)}&accountName=${encodeURIComponent(recipientName)}`
    : '';

  const handleSaveQR = async () => {
    if (isSavingQR || !qrUrl || !selectedMachine) return;
    setIsSavingQR(true);
    try {
      await saveQrToDevice(qrUrl, `VietQR_GiatSay_${selectedMachine.machineId}.png`);
    } finally {
      setIsSavingQR(false);
    }
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.click();
    setIsSubmittingBooking(true);
    setBookingMsg(null);
    try {
      const res = await apiFetch('/api/laundry/booking', {
        method: 'POST',
        body: JSON.stringify({
          machineId: bookingMachineId,
          bookingTime,
          bookingDate,
          tenantName: profile?.name || 'Cư dân',
        })
      });
      const data = await res.json();
      if (data.success) {
        soundFx.success();
        setBookingMsg({ text: data.message || 'Đặt chỗ thành công!' });
        fetchLaundryData();
      } else {
        soundFx.alert();
        setBookingMsg({ text: data.message || 'Không thể tạo đặt chỗ', isError: true });
      }
    } catch {
      soundFx.alert();
      setBookingMsg({ text: 'Lỗi kết nối máy chủ', isError: true });
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const filteredMachines = machines.filter(m => {
    if (activeFilter === 'ALL') return true;
    return m.type === activeFilter;
  });

  const availableCount = machines.filter(m => m.status === 'AVAILABLE').length;
  const runningCount = machines.filter(m => m.status === 'RUNNING').length;
  const washerCount = machines.filter(m => m.type === 'WASHER').length;
  const dryerCount = machines.filter(m => m.type === 'DRYER').length;

  return (
    <div className="w-full flex flex-col items-center pb-6">
      
      <AnimatePresence mode="wait">
        
        {/* =========================================================================
            SCREEN 1: ACTIVATION SUCCESS (Exact match to PaymentPage success mode)
           ========================================================================= */}
        {viewMode === 'success' && selectedMachine ? (
          <motion.div
            key="laundry-success-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-4"
          >
            <main className="liquid-panel w-full max-w-[500px] p-6 sm:p-10 flex flex-col items-center relative transition-colors">
              
              {/* Success Badge Icon */}
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-white mb-5 shadow-lg bg-emerald-500 shadow-emerald-500/25">
                <Check size={40} strokeWidth={3.5} />
              </div>

              {/* Title */}
              <div className="text-center mb-6">
                <h1 className="text-[28px] sm:text-[32px] leading-tight font-bold text-neutral-900 dark:text-white tracking-tight">
                  Kích Hoạt Thành Công!
                </h1>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Máy đã được đóng nguồn điện tự động và bắt đầu chu kỳ hoạt động.
                </p>
              </div>

              {/* Amount Display Centerpiece */}
              <div className="w-full py-4 px-6 flex flex-col items-center justify-center mb-6 bg-neutral-50 dark:bg-neutral-900/60 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-neutral-400 font-semibold mb-1.5">
                  SỐ TIỀN ĐÃ THANH TOÁN
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[36px] sm:text-[42px] leading-none font-bold tracking-tight font-num text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(selectedMachine.price)}
                  </span>
                  <span className="text-sm uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">
                    VNĐ
                  </span>
                </div>
              </div>

              {/* Transaction Details Table */}
              <div className="w-full divide-y divide-gray-100 dark:divide-neutral-800 mb-6 text-[14px]">
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-neutral-400">Thiết bị</span>
                  <span className="font-bold text-neutral-900 dark:text-white">{selectedMachine.name}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-neutral-400">Mã thiết bị</span>
                  <span className="font-bold font-mono text-neutral-600 dark:text-neutral-400">{selectedMachine.machineId}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-neutral-400">Cư dân kích hoạt</span>
                  <span className="font-bold text-neutral-900 dark:text-white">{profile.name} (P.{profile.room?.roomNumber})</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-neutral-400">Thời gian chu kỳ</span>
                  <span className="font-semibold text-neutral-900 dark:text-white font-num">{selectedMachine.cycleMinutes} phút</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-neutral-400">Trạng thái</span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={16} />
                    <span>Đã cấp điện nguồn</span>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row items-center gap-3">
                <button 
                  type="button"
                  onClick={() => {
                    soundFx.click();
                    setViewMode('timer');
                  }}
                  className="w-full sm:flex-1 h-12 rounded-xl bg-neutral-900 hover:bg-black dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-black font-semibold text-[14px] flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99] cursor-pointer"
                >
                  <Timer size={18} />
                  <span>Xem đồng hồ đếm ngược</span>
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    soundFx.click();
                    setViewMode('list');
                  }}
                  className="w-full sm:flex-1 h-12 rounded-xl bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white border border-gray-200 dark:border-neutral-700 font-semibold text-[14px] flex items-center justify-center gap-2 transition-colors active:scale-[0.99] cursor-pointer"
                >
                  <Home size={18} />
                  <span>Danh sách máy</span>
                </button>
              </div>

            </main>
          </motion.div>

        /* =========================================================================
            SCREEN 2: QR PAYMENT ACTIVATION (Exact match to PaymentPage.tsx layout)
           ========================================================================= */
        ) : viewMode === 'activate' && selectedMachine ? (
          <motion.div
            key="laundry-qr-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-2"
          >
            {/* 1. DESKTOP / LAPTOP VIEW (lg and above): 2-Column Container */}
            <main className="liquid-panel hidden lg:block w-full max-w-5xl p-8 lg:p-10 relative">
              
              {/* Top Bar: Back button to return to machine list */}
              <div className="mb-4 flex items-center justify-between">
                <button 
                  type="button"
                  aria-label="Quay lại" 
                  onClick={() => {
                    soundFx.click();
                    setViewMode('list');
                  }}
                  className="soft-button w-11 h-11 flex items-center justify-center text-neutral-600 dark:text-neutral-400 active:scale-95 transition-all cursor-pointer"
                >
                  <ChevronLeft size={26} strokeWidth={2.2} />
                </button>

                <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400">
                  <span>Phòng {profile.room?.roomNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedMachine.name}</span>
                </div>
              </div>

              {/* 2-Column Grid Layout */}
              <div className="grid grid-cols-12 gap-8 items-center pt-1">
                {/* Left Column: Title, Subtitles, Straight Square Pure QR Code */}
                <div className="col-span-6 flex flex-col items-center text-center">
                  <div className="mb-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white leading-tight">
                      QR Kích hoạt {selectedMachine.type === 'WASHER' ? 'máy giặt' : 'máy sấy'}
                    </h1>
                    <p className="text-[14px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-relaxed">
                      Quét mã để kích hoạt tự động · Máy {selectedMachine.machineId}
                    </p>
                  </div>

                  {/* Sharp Straight Square Pure QR Container */}
                  <div className="bg-white p-3.5 rounded-2xl shadow-sm inline-block">
                    {qrUrl ? (
                      <img 
                        src={qrUrl} 
                        alt="VietQR Matrix"
                        className="w-[280px] h-[280px] object-contain rounded-none select-none"
                      />
                    ) : (
                      <div className="w-[280px] h-[280px] flex items-center justify-center text-xs text-neutral-500">
                        Đang tạo mã QR...
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-[285px] flex flex-col gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleSaveQR}
                      disabled={isSavingQR}
                      className="primary-button min-h-11 w-full py-3 px-4 text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ImageDown size={15} />
                      <span>{isSavingQR ? 'Đang lưu ảnh...' : 'Lưu ảnh QR'}</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Transaction Details, Total Amount */}
                <div className="col-span-6 flex flex-col justify-center pl-6 border-l border-[#ebebed] dark:border-neutral-800 space-y-4">
                  <div>
                    <h2 className="text-[16px] font-semibold text-black dark:text-white tracking-tight mb-3">
                      Chi tiết giao dịch
                    </h2>
                    <div className="liquid-panel-subtle p-4 sm:p-5 space-y-4">
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Thiết bị</span>
                        <span className="font-bold text-black dark:text-white">
                          {selectedMachine.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Người nhận</span>
                        <span 
                          onClick={() => handleCopy(recipientName, 'd-recipient')}
                          className="font-bold text-black dark:text-white cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {recipientName}
                          {copiedKey === 'd-recipient' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Ngân hàng</span>
                        <span 
                          onClick={() => handleCopy(bankName, 'd-bank')}
                          className="font-medium text-black dark:text-white cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {bankName}
                          {copiedKey === 'd-bank' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Số tài khoản</span>
                        <span 
                          onClick={() => handleCopy(accountNumber, 'd-acc')}
                          className="font-bold text-black dark:text-white tracking-wider font-mono cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {accountNumber}
                          {copiedKey === 'd-acc' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Nội dung CK</span>
                        <span 
                          onClick={() => handleCopy(selectedMachine.machineId, 'd-content')}
                          className="font-bold text-neutral-600 dark:text-neutral-400 font-mono text-xs cursor-pointer hover:underline flex items-center gap-1"
                          title="Bắt buộc giữ nguyên mã máy"
                        >
                          {selectedMachine.machineId}
                          {copiedKey === 'd-content' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-neutral-400 font-normal">Thời lượng chu kỳ</span>
                        <span className="font-semibold text-black dark:text-white font-num">
                          {selectedMachine.cycleMinutes} phút / lần
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Subtle Divider */}
                  <hr className="border-t border-[#ebebed] dark:border-neutral-800 w-full" />

                  {/* Total Amount */}
                  <div className="flex items-baseline justify-between py-1">
                    <span className="text-[15px] font-medium text-neutral-500 dark:text-neutral-400">Tổng tiền</span>
                    <span className="text-[32px] font-bold text-black dark:text-white tracking-tight leading-none font-num">
                      {formatCurrency(selectedMachine.price)} ₫
                    </span>
                  </div>

                  {/* Live sync notice box */}
                  <div className="p-3 bg-neutral-50 dark:bg-neutral-950/30 rounded-xl text-center text-xs text-neutral-700 dark:text-neutral-300 font-medium flex items-center justify-center gap-2 border border-neutral-100 dark:border-neutral-900/40">
                    <RefreshCw size={13} className="animate-spin shrink-0" />
                    <span>Hệ thống tự động kích hoạt sau khi nhận được tiền (3–5 giây)...</span>
                  </div>
                </div>
              </div>
            </main>

            {/* 2. MOBILE VIEW (under lg): Compact, Straight Pure QR Code */}
            <div className="liquid-panel lg:hidden w-full max-w-[420px] flex flex-col justify-between px-5 pt-4 pb-5 relative">
              {/* Mobile Top Navigation */}
              <header className="w-full flex items-center justify-between mb-1.5">
                <button 
                  type="button"
                  aria-label="Quay lại" 
                  onClick={() => {
                    soundFx.click();
                    setViewMode('list');
                  }}
                  className="soft-button w-11 h-11 flex items-center justify-center text-neutral-600 dark:text-neutral-400 active:opacity-60 transition-opacity cursor-pointer"
                >
                  <ChevronLeft size={22} strokeWidth={2.2} />
                </button>
                
                <div className="text-center">
                  <h1 className="text-[17px] font-bold text-black dark:text-white leading-tight">
                    QR Kích hoạt ({selectedMachine.machineId})
                  </h1>
                </div>

                <div className="w-8" />
              </header>

              {/* Mobile Straight Pure QR Code Section */}
              <section aria-label="Mã QR thanh toán" className="flex flex-col items-center justify-center my-1">
                <div className="bg-white p-3 rounded-2xl shadow-sm inline-block">
                  {qrUrl ? (
                    <img 
                      src={qrUrl} 
                      alt="VietQR Matrix"
                      className="w-[240px] h-[240px] object-contain rounded-none select-none"
                    />
                  ) : (
                    <div className="w-[240px] h-[240px] flex items-center justify-center text-xs text-neutral-500">
                      Đang tạo mã QR...
                    </div>
                  )}
                </div>

                <div className="w-full max-w-[260px] flex flex-col gap-2 mt-1 mb-2">
                  <button
                    type="button"
                    onClick={handleSaveQR}
                    disabled={isSavingQR}
                    className="primary-button min-h-11 w-full py-3 px-4 text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ImageDown size={14} />
                    <span>{isSavingQR ? 'Đang lưu...' : 'Lưu ảnh QR'}</span>
                  </button>
                </div>
              </section>

              {/* Mobile Payment Details */}
              <section aria-label="Thông tin thanh toán" className="w-full flex flex-col space-y-3 my-2 text-sm">
                <div className="liquid-panel-subtle p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Thiết bị</span>
                    <span className="font-bold text-black dark:text-white truncate max-w-[200px]">
                      {selectedMachine.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Người nhận</span>
                    <span 
                      onClick={() => handleCopy(recipientName, 'm-rec')}
                      className="font-bold text-black dark:text-white tracking-tight cursor-pointer"
                    >
                      {recipientName}
                      {copiedKey === 'm-rec' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Ngân hàng</span>
                    <span 
                      onClick={() => handleCopy(bankName, 'm-bank')}
                      className="font-medium text-black dark:text-white truncate max-w-[200px] text-right cursor-pointer"
                    >
                      {bankName}
                      {copiedKey === 'm-bank' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Số TK</span>
                    <span 
                      onClick={() => handleCopy(accountNumber, 'm-acc')}
                      className="font-bold text-black dark:text-white font-mono cursor-pointer"
                    >
                      {accountNumber}
                      {copiedKey === 'm-acc' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Nội dung CK</span>
                    <span 
                      onClick={() => handleCopy(selectedMachine.machineId, 'm-content')}
                      className="font-bold text-neutral-600 dark:text-neutral-400 font-mono text-[11px] cursor-pointer"
                    >
                      {selectedMachine.machineId}
                      {copiedKey === 'm-content' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                </div>

                {/* Total Line */}
                <div className="flex items-center justify-between px-1 pt-1 border-t border-neutral-100 dark:border-neutral-800">
                  <span className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">Tổng tiền</span>
                  <span className="text-2xl font-semibold text-neutral-900 dark:text-white tracking-tight font-num">
                    {formatCurrency(selectedMachine.price)} ₫
                  </span>
                </div>
              </section>

              {/* Status footer */}
              <div className="mt-1 p-2 bg-neutral-50 dark:bg-neutral-950/30 rounded-xl text-center text-[11px] text-neutral-700 dark:text-neutral-300 font-medium flex items-center justify-center gap-1.5">
                <RefreshCw size={12} className="animate-spin shrink-0" />
                <span>Hệ thống tự động kích hoạt sau khi nhận được tiền...</span>
              </div>
            </div>
          </motion.div>

        /* =========================================================================
            SCREEN 3: LIVE CIRCULAR COUNTDOWN TIMER
           ========================================================================= */
        ) : viewMode === 'timer' && selectedMachine ? (
          <motion.div
            key="laundry-timer-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-4"
          >
            <main className="w-full max-w-[500px] bg-white dark:bg-[#101726] rounded-[28px] border border-neutral-200/90 dark:border-neutral-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-6 sm:p-8 flex flex-col items-center relative transition-colors">
              
              {/* Header with back button */}
              <div className="w-full flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.click();
                    setViewMode('list');
                  }}
                  className="w-10 h-10 flex items-center justify-center text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 rounded-full transition-all cursor-pointer -ml-2"
                  title="Quay lại danh sách"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} />
                </button>

                <div className="text-center">
                  <h3 className="type-h3 font-bold text-neutral-900 dark:text-white leading-tight">
                    {selectedMachine.name}
                  </h3>
                  <span className="text-xs text-neutral-400">Đang hoạt động · Mã {selectedMachine.machineId}</span>
                </div>

                <div className="w-10" />
              </div>

              {/* Circular Apple Clock */}
              {(() => {
                const rem = getRemainingSeconds(selectedMachine);
                const totalSec = (selectedMachine.cycleMinutes || 45) * 60;
                const ratio = Math.min(1, Math.max(0, rem / totalSec));
                const circ = 2 * Math.PI * 45;
                const strokeOffset = circ * (1 - ratio);
                const isWasher = selectedMachine.type === 'WASHER';
                const isRunning = rem > 0;

                const completionTime = selectedMachine.expectedEndTime
                  ? new Date(selectedMachine.expectedEndTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                  : '--:--';

                return (
                  <div className="w-full flex flex-col items-center justify-center space-y-6 py-4">
                    <div className="relative w-64 h-64 flex items-center justify-center select-none">
                      
                      {/* Outer Rim */}
                      <div className="absolute inset-0 rounded-full bg-neutral-100 dark:bg-neutral-900/60 shadow-[inset_0_4px_10px_rgba(0,0,0,0.06),0_10px_30px_rgba(0,0,0,0.08)] border border-neutral-200/70 dark:border-neutral-800" />

                      {/* SVG Progress Ring */}
                      <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] -rotate-90 z-10 pointer-events-none" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          className="text-neutral-200/70 dark:text-neutral-800/80"
                          strokeWidth="4"
                          stroke="currentColor"
                          fill="transparent"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          strokeWidth="5"
                          strokeDasharray={circ}
                          strokeDashoffset={strokeOffset}
                          strokeLinecap="round"
                          stroke={isWasher ? '#0284c7' : '#ea580c'}
                          fill="transparent"
                          className="transition-all duration-1000 ease-linear"
                          style={{
                            filter: isWasher
                              ? 'drop-shadow(0 0 8px rgba(2, 132, 199, 0.45))'
                              : 'drop-shadow(0 0 8px rgba(234, 88, 12, 0.45))'
                          }}
                        />
                      </svg>

                      {/* Center Display */}
                      <div className="relative z-20 flex flex-col items-center justify-center text-center p-4">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1">
                          Thời gian còn lại
                        </span>

                        <span className="text-4xl sm:text-5xl font-black font-num tracking-tight text-neutral-900 dark:text-white block leading-none my-1">
                          {formatSeconds(rem)}
                        </span>

                        {isRunning ? (
                          <div className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold mt-2",
                            isWasher
                              ? "bg-neutral-50 text-neutral-700 dark:bg-neutral-950/60 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800/60"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60"
                          )}>
                            <span className={cn(
                              "w-2 h-2 rounded-full animate-ping",
                              isWasher ? "bg-neutral-500" : "bg-amber-500"
                            )} />
                            <span>{isWasher ? "Đang giặt đồ" : "Đang sấy đồ"}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 mt-2">
                            <CheckCircle2 size={12} />
                            <span>Đã hoàn tất chu kỳ</span>
                          </div>
                        )}
                      </div>

                    </div>

                    {/* Summary Info Cards */}
                    <div className="w-full p-4 bg-neutral-50 dark:bg-neutral-900/60 rounded-2xl border border-neutral-100 dark:border-neutral-800/80 flex items-center justify-around text-xs font-semibold">
                      <div className="text-center">
                        <span className="text-neutral-400 dark:text-neutral-500 block text-[10px] uppercase font-bold tracking-wider mb-0.5">
                          Dự kiến hoàn thành
                        </span>
                        <span className="font-bold font-num text-neutral-900 dark:text-white text-base">
                          {completionTime}
                        </span>
                      </div>
                      <div className="w-px h-8 bg-neutral-200 dark:bg-neutral-700/60" />
                      <div className="text-center">
                        <span className="text-neutral-400 dark:text-neutral-500 block text-[10px] uppercase font-bold tracking-wider mb-0.5">
                          Trạng thái ổ điện
                        </span>
                        <span className={cn(
                          "font-bold text-xs flex items-center justify-center gap-1",
                          selectedMachine.plugState === 'ON' || isRunning
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-neutral-400 dark:text-neutral-500"
                        )}>
                          <Power size={13} />
                          {selectedMachine.plugState === 'ON' || isRunning ? 'BẬT NGUỒN' : 'TẮT NGUỒN'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        soundFx.click();
                        setViewMode('list');
                      }}
                      className="w-full soft-button py-3 text-xs font-semibold cursor-pointer"
                    >
                      Quay lại danh sách máy
                    </button>
                  </div>
                );
              })()}

            </main>
          </motion.div>

        /* =========================================================================
            SCREEN 4: MAIN LAUNDRY DASHBOARD (When viewMode === 'list')
           ========================================================================= */
        ) : (
          <motion.div
            key="laundry-list-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full space-y-6"
          >
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <button type="button" onClick={() => { soundFx.click(); navigate(-1); }} aria-label="Quay lại" className="soft-button flex h-9 w-9 items-center justify-center text-neutral-600 dark:text-neutral-400"><ArrowLeft size={16} /></button>
                  <span className="liquid-eyebrow">DỊCH VỤ CƯ DÂN</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-4xl">Giặt sấy, thật nhẹ nhàng.</h1>
                <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">Chọn máy, quét mã và dành thời gian cho điều bạn thích.</p>
              </div>
              <div className="liquid-chip inline-flex items-center gap-2 self-start px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
                <Home size={14} className="text-neutral-500" /><span>{profile.room.roomNumber || 'Phòng của bạn'}</span><span aria-hidden="true" className="text-neutral-300 dark:text-neutral-600">/</span><span>Tự phục vụ 24/7</span>
              </div>
            </header>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
              <div className="liquid-panel-subtle p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden group">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-800/40">
                  <CheckCircle2 size={24} className="stroke-[2.5]" />
                </div>
                <div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium block">
                    Máy sẵn sàng
                  </span>
                  <span className="text-xl sm:text-2xl font-bold font-num text-neutral-900 dark:text-white block mt-0.5">
                    {availableCount} <span className="text-sm font-normal text-neutral-500">máy</span>
                  </span>
                </div>
              </div>

              <div className="liquid-panel-subtle p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden group">
                <div className="w-12 h-12 rounded-2xl bg-neutral-50 dark:bg-neutral-950/40 text-neutral-600 dark:text-neutral-400 flex items-center justify-center shrink-0 border border-neutral-100 dark:border-neutral-800/40">
                  <Clock size={23} strokeWidth={1.7} />
                </div>
                <div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium block">
                    Đang hoạt động
                  </span>
                  <span className="text-xl sm:text-2xl font-bold font-num text-neutral-600 dark:text-neutral-400 block mt-0.5">
                    {runningCount} <span className="text-sm font-normal text-neutral-500">máy</span>
                  </span>
                </div>
              </div>

              <div className="liquid-panel-subtle p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden group">
                <div className="w-12 h-12 rounded-2xl bg-neutral-50/70 dark:bg-neutral-950/30 flex items-center justify-center shrink-0 border border-neutral-100/60 dark:border-neutral-800/30">
                  <WashingMachine size={23} strokeWidth={1.7} className="text-neutral-500" />
                </div>
                <div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium block">
                    Máy giặt cửa trước
                  </span>
                  <span className="text-xl sm:text-2xl font-bold font-num text-neutral-900 dark:text-white block mt-0.5">
                    {washerCount} <span className="text-sm font-normal text-neutral-500">máy</span>
                  </span>
                </div>
              </div>

              <div className="liquid-panel-subtle p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden group">
                <div className="w-12 h-12 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 flex items-center justify-center shrink-0 border border-amber-100/60 dark:border-amber-800/30">
                  <Sparkles size={23} strokeWidth={1.7} className="text-amber-500" />
                </div>
                <div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium block">
                    Máy sấy thông hơi
                  </span>
                  <span className="text-xl sm:text-2xl font-bold font-num text-neutral-900 dark:text-white block mt-0.5">
                    {dryerCount} <span className="text-sm font-normal text-neutral-500">máy</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Apple Segmented Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="flex w-full sm:w-fit items-center gap-1 rounded-[20px] border border-neutral-200/50 dark:border-white/5 bg-neutral-200/40 dark:bg-black/20 p-1">
                {[
                  { key: 'machines', label: 'Chọn máy', icon: WashingMachine },
                  { key: 'booking', label: 'Đặt lịch', icon: CalendarClock },
                  { key: 'rules', label: 'Bảng giá', icon: BookOpen }
                ].map(t => {
                  const Icon = t.icon;
                  const isActive = activeTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        soundFx.tab();
                        setActiveTab(t.key as any);
                      }}
                      className={cn(
                        "min-h-11 flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-2xl text-xs sm:text-sm font-medium flex justify-center items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap",
                        isActive
                          ? "bg-white dark:bg-neutral-700/80 text-neutral-600 dark:text-neutral-300 shadow-sm"
                          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                      )}
                    >
                      <Icon size={15} />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  soundFx.click();
                  fetchLaundryData();
                }}
                disabled={isLoading}
                className="soft-button px-3.5 py-2 flex items-center gap-2 cursor-pointer text-xs font-semibold text-neutral-600 dark:text-neutral-300 self-end sm:self-auto"
                title="Cập nhật trạng thái"
              >
                <RefreshCw size={13} className={cn(isLoading && "animate-spin text-neutral-600")} />
                <span>Làm mới trạng thái</span>
              </button>
            </div>

            {/* Tab 1: Machine Grid */}
            {activeTab === 'machines' && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {[
                      { key: 'ALL', label: 'Tất cả máy' },
                      { key: 'WASHER', label: 'Máy giặt' },
                      { key: 'DRYER', label: 'Máy sấy' }
                    ].map(f => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={activeFilter === f.key}
                        onClick={() => {
                          soundFx.click();
                          setActiveFilter(f.key as any);
                        }}
                        className={cn(
                          "min-h-10 px-3.5 py-2 rounded-full text-xs font-medium cursor-pointer transition-all",
                          activeFilter === f.key
                            ? "bg-neutral-600 text-white dark:bg-neutral-500 shadow-sm shadow-neutral-500/20"
                            : "soft-button text-neutral-600 dark:text-neutral-400"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-400">
                    <Info size={14} />
                    <span>Chạm vào thẻ máy để mở màn hình quét mã VietQR</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  {filteredMachines.map(m => {
                    const isWasher = m.type === 'WASHER';
                    const remaining = getRemainingSeconds(m);
                    const isRunning = m.status === 'RUNNING' || remaining > 0;
                    const minsLeft = Math.max(1, Math.ceil(remaining / 60));

                    return (
                      <div
                        key={m.machineId}
                        onClick={() => handleOpenMachine(m)}
                        className={cn(
                          "soft-surface group relative flex flex-col justify-between p-6 sm:p-7 rounded-[28px] hover:-translate-y-1 active:translate-y-0 transition-all duration-300 cursor-pointer overflow-hidden border",
                          isRunning 
                            ? "border-neutral-300/80 dark:border-neutral-800/60 shadow-md ring-2 ring-neutral-100 dark:ring-neutral-950/40"
                            : "border-white/80 dark:border-white/10"
                        )}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />

                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-4">
                            {/* Simplified 3D Icon */}
                            <div className="relative shrink-0 group-hover:scale-105 transition-transform duration-300">
                              {isWasher ? <IconLaundry3D size={56} /> : <IconDryer3D size={56} />}
                              
                              {isRunning && (
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-neutral-500 text-white flex items-center justify-center shadow-md ring-2 ring-white dark:ring-neutral-900">
                                  <RefreshCw size={11} className="animate-spin" />
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="flex items-center gap-2 text-xs text-neutral-400">
                                <span className="font-bold font-num text-neutral-900 dark:text-neutral-100">
                                  {m.machineId}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{isWasher ? 'Cửa trước 9kg' : 'Thông hơi 8kg'}</span>
                                <span aria-hidden="true">·</span>
                                <span>Tầng trệt</span>
                              </div>

                              <h3 className="type-h3 text-neutral-900 dark:text-white font-bold mt-1 group-hover:text-neutral-600 dark:group-hover:text-neutral-400 transition-colors">
                                {m.name}
                              </h3>
                            </div>
                          </div>

                          <div>
                            {isRunning ? (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-neutral-50 text-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800">
                                <span className="w-2 h-2 rounded-full bg-neutral-500 animate-ping" />
                                <span className="font-num">Còn {minsLeft} phút</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Sẵn sàng</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {isRunning && (
                          <div className="my-4 p-3.5 rounded-2xl bg-neutral-50/70 dark:bg-neutral-950/30 border border-neutral-100 dark:border-neutral-900/40 space-y-2">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                                <Clock size={13} />
                                <span>Đang thực hiện chu kỳ</span>
                              </span>
                              <span className="font-num text-neutral-800 dark:text-neutral-200 font-bold">
                                {formatSeconds(remaining)}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-neutral-200/60 dark:bg-neutral-900/60 overflow-hidden">
                              <div 
                                className="h-full bg-neutral-600 rounded-full transition-all duration-1000 ease-linear"
                                style={{
                                  width: `${Math.min(100, Math.max(0, (1 - remaining / ((m.cycleMinutes || 45) * 60)) * 100))}%`
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-neutral-900/5 dark:border-white/10 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-neutral-400 uppercase font-semibold block tracking-wider">
                              Giá cước
                            </span>
                            <div className="flex items-baseline gap-1 mt-0.5">
                              <span className="text-xl font-bold font-num text-neutral-900 dark:text-neutral-100">
                                {formatMoney(m.price)}
                              </span>
                              <span className="text-xs text-neutral-400">/ {m.cycleMinutes}p</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={cn(
                                "py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all",
                                isRunning
                                  ? "soft-button text-neutral-600 dark:text-neutral-400"
                                  : "primary-button shadow-xs"
                              )}
                            >
                              {isRunning ? (
                                <>
                                  <Timer size={14} />
                                  <span>Xem đồng hồ</span>
                                </>
                              ) : (
                                <>
                                  <Zap size={14} />
                                  <span>Quét VietQR</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: Booking Reservation */}
            {activeTab === 'booking' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  <div className="lg:col-span-6 soft-surface p-6 sm:p-7 rounded-[28px] border border-white/80 dark:border-white/10 space-y-5">
                    <div className="flex items-center gap-3 pb-3 border-b border-neutral-900/5 dark:border-white/10">
                      <div className="w-10 h-10 rounded-xl bg-neutral-50 dark:bg-neutral-950/40 text-neutral-600 dark:text-neutral-400 flex items-center justify-center shrink-0">
                        <CalendarClock size={22} />
                      </div>
                      <div>
                        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">
                          Đặt lịch giặt sấy trước
                        </h3>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          Chủ động chọn khung giờ thuận tiện mà không lo hết máy trống.
                        </p>
                      </div>
                    </div>

                    {bookingMsg && (
                      <div className={cn(
                        "p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 animate-in fade-in",
                        bookingMsg.isError
                          ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                          : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      )}>
                        {bookingMsg.isError ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
                        <span>{bookingMsg.text}</span>
                      </div>
                    )}

                    <form onSubmit={handleCreateBooking} className="space-y-4">
                      <div>
                        <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 block mb-1.5">
                          1. Chọn máy giặt / sấy:
                        </label>
                        <select
                          value={bookingMachineId}
                          onChange={e => setBookingMachineId(e.target.value)}
                          className="w-full p-3 rounded-xl text-xs font-bold text-neutral-900 dark:text-white bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 outline-none focus:ring-2 focus:ring-neutral-500 cursor-pointer"
                        >
                          {machines.map(m => (
                            <option key={m.machineId} value={m.machineId}>
                              {m.name} ({m.machineId}) · {formatMoney(m.price)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5">
                        <div>
                          <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 block mb-1.5">
                            2. Giờ giặt:
                          </label>
                          <input
                            type="time"
                            value={bookingTime}
                            onChange={e => setBookingTime(e.target.value)}
                            required
                            className="w-full p-2.5 rounded-xl text-xs font-bold text-neutral-900 dark:text-white bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 outline-none focus:ring-2 focus:ring-neutral-500"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 block mb-1.5">
                            3. Ngày giặt:
                          </label>
                          <input
                            type="text"
                            value={bookingDate}
                            onChange={e => setBookingDate(e.target.value)}
                            placeholder="DD/MM/YYYY"
                            className="w-full p-2.5 rounded-xl text-xs font-bold text-neutral-900 dark:text-white bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 outline-none focus:ring-2 focus:ring-neutral-500"
                          />
                        </div>
                      </div>

                      <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900/60 rounded-2xl space-y-2 text-xs border border-neutral-100 dark:border-neutral-800">
                        <div className="flex justify-between items-center">
                          <span className="text-neutral-400">Cư dân đăng ký:</span>
                          <span className="font-bold text-neutral-900 dark:text-white">{profile.name}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-neutral-400">Phòng ở:</span>
                          <span className="font-bold text-neutral-900 dark:text-white font-num">{profile.room.roomNumber}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-neutral-400">Phí giữ chỗ ưu tiên:</span>
                          <span className="font-bold font-num text-neutral-600 dark:text-neutral-400">5.000 đ</span>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmittingBooking}
                        className="w-full primary-button py-3 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                      >
                        {isSubmittingBooking ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                        <span>Xác nhận đặt giữ chỗ ưu tiên</span>
                      </button>
                    </form>
                  </div>

                  <div className="lg:col-span-6 space-y-3.5">
                    <h4 className="type-h4 font-bold text-neutral-900 dark:text-white">
                      Lịch hẹn đặt máy gần đây
                    </h4>

                    {bookings.length === 0 ? (
                      <div className="soft-card p-8 text-center text-xs text-neutral-400">
                        Chưa có lượt đặt trước nào trong ngày hôm nay.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {bookings.map(b => (
                          <div key={b.bookingId} className="soft-card p-4 flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold font-num text-xs px-2 py-0.5 rounded bg-neutral-50 text-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-300">
                                  {b.machineId}
                                </span>
                                <span className="text-xs font-bold text-neutral-900 dark:text-white font-num">
                                  Hẹn lúc {b.bookingTime} ({b.bookingDate})
                                </span>
                              </div>
                              <p className="text-[11px] text-neutral-400 mt-1">
                                Cư dân: <b>{b.tenantName}</b> {b.roomNumber ? `(P.${b.roomNumber})` : ''}
                              </p>
                            </div>

                            <span className={cn(
                              "text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase",
                              b.depositStatus === 'PAID'
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200"
                            )}>
                              {b.depositStatus === 'PAID' ? 'Đã Cọc' : 'Chờ Cọc'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Rules & Pricing */}
            {activeTab === 'rules' && (
              <div className="space-y-4 max-w-3xl animate-in fade-in duration-200">
                <div className="soft-surface p-6 rounded-[28px] border border-white/80 dark:border-white/10 space-y-3">
                  <h4 className="type-h3 font-bold text-neutral-900 dark:text-white flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 text-xs flex items-center justify-center font-bold">1</span>
                    <span>Thời gian hoạt động & Kích hoạt qua VietQR</span>
                  </h4>
                  <ul className="text-xs text-neutral-600 dark:text-neutral-300 space-y-2.5 pl-3">
                    <li>• Máy hoạt động liên tục 24/7 tại khu vực giặt sấy tầng trệt.</li>
                    <li>• Thanh toán hoàn toàn tự động bằng cách mở bất kỳ ứng dụng ngân hàng nào và quét mã <b>VietQR</b>.</li>
                    <li>• <b>Quan trọng:</b> Giữ nguyên mã nội dung chuyển khoản (VD: <b>MG01</b>, <b>MS01</b>) để hệ thống tự động nhận diện và đóng điện nguồn trong vòng 3–5 giây.</li>
                  </ul>
                </div>

                <div className="soft-surface p-6 rounded-[28px] border border-white/80 dark:border-white/10 space-y-3">
                  <h4 className="type-h3 font-bold text-neutral-900 dark:text-white flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs flex items-center justify-center font-bold">2</span>
                    <span>Quy định nếp sống văn minh</span>
                  </h4>
                  <ul className="text-xs text-neutral-600 dark:text-neutral-300 space-y-2.5 pl-3">
                    <li>• Không giặt quá tải trọng: Máy giặt tối đa 9kg đồ khô, máy sấy tối đa 8kg.</li>
                    <li>• <b>Nghiêm cấm:</b> Giặt giày dép đế kim loại nặng, thảm chùi chân dính bùn đất cát hoặc vật liệu dính hóa chất dễ cháy.</li>
                    <li>• Vui lòng lấy quần áo ra khỏi máy trong vòng <b>15–30 phút</b> sau khi máy báo xong để nhường lượt cho cư dân kế tiếp.</li>
                  </ul>
                </div>

                <div className="soft-surface p-6 rounded-[28px] border border-white/80 dark:border-white/10 space-y-3">
                  <h4 className="type-h3 font-bold text-neutral-900 dark:text-white flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200 text-xs flex items-center justify-center font-bold">3</span>
                    <span>Hỗ trợ sự cố & Hotline kỹ thuật</span>
                  </h4>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Trường hợp chuyển khoản thành công nhưng máy chưa vào điện hoặc gặp sự cố kỹ thuật, quý cư dân liên hệ ngay Ban Quản Lý:
                  </p>
                  <div className="pt-2">
                    <a
                      href="https://zalo.me/0902371800"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-50 text-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-300 font-bold text-xs hover:underline"
                    >
                      <PhoneCall size={15} />
                      <span>Hotline / Zalo: 0902371800 (Bùi Trung Khải)</span>
                    </a>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>

    </div>
  );
}
