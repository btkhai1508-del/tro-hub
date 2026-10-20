import React, { useState, useEffect, useCallback, useTransition, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  WashingMachine, 
  Flame, 
  Timer, 
  Clock, 
  Copy, 
  Check, 
  ChevronRight, 
  CalendarClock, 
  BookOpen, 
  RefreshCw, 
  Zap, 
  Power, 
  X,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { soundFx } from '../lib/soundFx';
import { IconLaundry3D, IconDryer3D, IconWallet3D, IconClock3D } from './Icons3D';

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
    { machineId: 'MG01', name: 'Máy Giặt 01 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MG02', name: 'Máy Giặt 02 (Cửa trước)', type: 'WASHER', status: 'AVAILABLE', price: 15000, cycleMinutes: 45, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MS01', name: 'Máy Sấy 01 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', plugState: 'OFF' },
    { machineId: 'MS02', name: 'Máy Sấy 02 (Thông hơi)', type: 'DRYER', status: 'AVAILABLE', price: 20000, cycleMinutes: 60, expectedEndTime: '', plugState: 'OFF' },
  ]);

  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [activeTab, setActiveTab] = useState<'machines' | 'booking' | 'rules'>('machines');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'WASHER' | 'DRYER'>('ALL');
  const [activeModal, setActiveModal] = useState<'none' | 'payment' | 'timer'>('none');
  const [isLoading, setIsLoading] = useState(false);
  const [hasCopiedMemo, setHasCopiedMemo] = useState(false);
  const [stats, setStats] = useState({ todayRevenue: 0, totalRevenue: 0, todaySessions: 0, totalSessions: 0 });
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Booking form state
  const [bookingMachineId, setBookingMachineId] = useState('MG01');
  const [bookingTime, setBookingTime] = useState('08:00');
  const [bookingDate, setBookingDate] = useState(new Date().toLocaleDateString('vi-VN'));
  const [bookingMsg, setBookingMsg] = useState('');
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);

  // Keep latest refs to avoid stale closure in polling
  const selectedMachineRef = useRef<Machine | null>(null);
  selectedMachineRef.current = selectedMachine;
  const activeModalRef = useRef<'none' | 'payment' | 'timer'>('none');
  activeModalRef.current = activeModal;

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
            const curModal = activeModalRef.current;
            
            // If viewing a machine in modal, keep it updated
            if (curSelected) {
              const updated = data.machines.find((m: Machine) => m.machineId === curSelected.machineId);
              if (updated) {
                // If payment modal is open and machine just started running -> auto transition to timer view!
                if (curModal === 'payment' && updated.status === 'RUNNING') {
                  soundFx.success();
                  setActiveModal('timer');
                }
                setSelectedMachine(updated);
              }
            }
          }
          if (data.stats) setStats(data.stats);
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

  // Local seconds ticker for smooth countdown animation
  const [ticker, setTicker] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTicker(prev => prev + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const getRemainingSeconds = (m: Machine | null): number => {
    if (!m || m.status !== 'RUNNING' || !m.expectedEndTime) return 0;
    const endMs = new Date(m.expectedEndTime).getTime();
    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  };

  const formatMoney = (amount: number) => {
    return (amount || 0).toLocaleString('vi-VN') + ' đ';
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleOpenMachine = (m: Machine) => {
    soundFx.modalOpen();
    setSelectedMachine(m);
    if (m.status === 'RUNNING') {
      setActiveModal('timer');
    } else {
      setActiveModal('payment');
      // Record payment intent with backend so it can link resident profile to the transaction
      apiFetch('/api/laundry/intent', {
        method: 'POST',
        body: JSON.stringify({ machineId: m.machineId })
      }).catch(() => {});
    }
  };

  const handleCloseModal = () => {
    soundFx.modalClose();
    setActiveModal('none');
  };

  const handleCopyMemo = (memo: string) => {
    soundFx.click();
    navigator.clipboard.writeText(memo);
    setHasCopiedMemo(true);
    setTimeout(() => setHasCopiedMemo(false), 2000);
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.click();
    setIsSubmittingBooking(true);
    setBookingMsg('');
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
        setBookingMsg(data.message || 'Đặt chỗ thành công!');
        fetchLaundryData();
      } else {
        soundFx.alert();
        setBookingMsg(data.message || 'Không thể tạo đặt chỗ');
      }
    } catch (err: any) {
      soundFx.alert();
      setBookingMsg('Lỗi kết nối máy chủ');
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  // Filtered machines
  const filteredMachines = machines.filter(m => {
    if (activeFilter === 'ALL') return true;
    return m.type === activeFilter;
  });

  const availableCount = machines.filter(m => m.status === 'AVAILABLE').length;
  const runningCount = machines.filter(m => m.status === 'RUNNING').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-16">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              soundFx.click();
              navigate(-1);
            }}
            className="soft-button p-2.5 cursor-pointer text-slate-700 dark:text-slate-200 hover:text-slate-900"
            title="Quay lại"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="type-label text-slate-400">Dịch vụ tiện ích 24/7</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>TỰ ĐỘNG</span>
              </span>
            </div>
            <h1 className="type-h1 text-slate-900 dark:text-white font-bold mt-0.5">
              Giặt Sấy Thông Minh
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              soundFx.click();
              fetchLaundryData();
            }}
            disabled={isLoading}
            className="soft-button px-3.5 py-2 flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            <RefreshCw size={14} className={cn(isLoading && "animate-spin text-sky-600")} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex gap-2 p-1.5 soft-card rounded-2xl w-fit overflow-x-auto max-w-full">
        {[
          { key: 'machines', label: 'Trạng thái máy', icon: WashingMachine },
          { key: 'booking', label: 'Đặt lịch trước', icon: CalendarClock },
          { key: 'rules', label: 'Nội quy & Hướng dẫn', icon: BookOpen }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                soundFx.tab();
                setActiveTab(t.key as any);
              }}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap",
                isActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <Icon size={16} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: MACHINES LIST VIEW
         ========================================================================= */}
      {activeTab === 'machines' && (
        <div className="space-y-6">
          
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="soft-card p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 size={22} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Sẵn sàng</span>
                <span className="text-xl font-bold font-num text-slate-900 dark:text-white">{availableCount} máy</span>
              </div>
            </div>

            <div className="soft-card p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Clock size={22} className={runningCount > 0 ? "animate-spin" : ""} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Đang chạy</span>
                <span className="text-xl font-bold font-num text-rose-600 dark:text-rose-400">{runningCount} máy</span>
              </div>
            </div>

            <div className="soft-card p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <WashingMachine size={22} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Máy giặt</span>
                <span className="text-xl font-bold font-num text-slate-900 dark:text-white">
                  {machines.filter(m => m.type === 'WASHER').length} máy
                </span>
              </div>
            </div>

            <div className="soft-card p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Flame size={22} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Máy sấy</span>
                <span className="text-xl font-bold font-num text-slate-900 dark:text-white">
                  {machines.filter(m => m.type === 'DRYER').length} máy
                </span>
              </div>
            </div>
          </div>

          {/* Machine Filter Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {[
                { key: 'ALL', label: 'Tất cả' },
                { key: 'WASHER', label: 'Máy giặt' },
                { key: 'DRYER', label: 'Máy sấy' }
              ].map(f => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    soundFx.click();
                    setActiveFilter(f.key as any);
                  }}
                  className={cn(
                    "px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all",
                    activeFilter === f.key
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "soft-button text-slate-600 dark:text-slate-400"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-slate-400 font-medium hidden sm:inline">
              Chạm vào máy để quét QR thanh toán hoặc xem thời gian
            </span>
          </div>

          {/* Machines Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5">
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
                    "soft-card p-5 cursor-pointer relative overflow-hidden group transition-all flex flex-col justify-between gap-4 border",
                    isRunning
                      ? "border-rose-200/80 dark:border-rose-900/40 bg-gradient-to-br from-rose-50/30 to-transparent dark:from-rose-950/10"
                      : isWasher
                      ? "border-sky-200/80 dark:border-sky-900/40 bg-gradient-to-br from-sky-50/40 to-transparent dark:from-sky-950/15"
                      : "border-amber-200/80 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/15"
                  )}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      <div className="shrink-0 group-hover:scale-105 transition-transform relative">
                        {isWasher ? <IconLaundry3D size={48} /> : <IconDryer3D size={48} />}
                        {isRunning && (
                          <span className={cn(
                            "absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full shadow-sm ring-2 ring-white dark:ring-slate-900",
                            isWasher ? "bg-sky-500" : "bg-amber-500"
                          )}>
                            <RefreshCw size={10} className="animate-spin text-white" />
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold font-num uppercase tracking-wider",
                            isWasher
                              ? "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          )}>
                            {m.machineId}
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium">
                            {isWasher ? 'Cửa trước 9kg' : 'Thông hơi 8kg'}
                          </span>
                        </div>
                        <h3 className="type-h3 font-bold text-slate-900 dark:text-white mt-1">
                          {m.name}
                        </h3>
                      </div>
                    </div>

                    {/* Status Badge */}
                    {isRunning ? (
                      <span className="badge-unpaid text-xs py-1 px-3">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                        <span>Đang chạy ({minsLeft}p)</span>
                      </span>
                    ) : (
                      <span className="badge-paid text-xs py-1 px-3">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>Sẵn sàng</span>
                      </span>
                    )}
                  </div>

                  {/* Bottom row */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Đơn giá</span>
                      <span className={cn(
                        "text-lg font-bold font-num",
                        isWasher ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400"
                      )}>
                        {formatMoney(m.price)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block">Chu kỳ</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-num">
                        {m.cycleMinutes} phút / lần
                      </span>
                    </div>

                    <button
                      type="button"
                      className={cn(
                        "px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm",
                        isRunning
                          ? "soft-button text-rose-600 dark:text-rose-400"
                          : "primary-button"
                      )}
                    >
                      {isRunning ? (
                        <>
                          <Timer size={14} />
                          <span>Xem giờ</span>
                        </>
                      ) : (
                        <>
                          <Zap size={14} />
                          <span>Bắt đầu</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: BOOKING VIEW
         ========================================================================= */}
      {activeTab === 'booking' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            
            {/* Form */}
            <div className="md:col-span-6 soft-card p-6 space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <CalendarClock size={24} className="text-sky-600" />
                <div>
                  <h3 className="type-h3 font-bold text-slate-900 dark:text-white">Đặt trước slot giặt sấy</h3>
                  <p className="text-xs text-slate-400">Giữ chỗ trước để không phải đợi khi đến giờ giặt</p>
                </div>
              </div>

              {bookingMsg && (
                <div className={cn(
                  "p-3 rounded-xl text-xs font-semibold flex items-center gap-2",
                  bookingMsg.includes('thành công')
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200"
                )}>
                  {bookingMsg.includes('thành công') ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{bookingMsg}</span>
                </div>
              )}

              <form onSubmit={handleCreateBooking} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    1. Chọn máy muốn đặt trước:
                  </label>
                  <select
                    value={bookingMachineId}
                    onChange={e => setBookingMachineId(e.target.value)}
                    className="w-full soft-input p-3 rounded-xl text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {machines.map(m => (
                      <option key={m.machineId} value={m.machineId}>
                        {m.name} ({m.machineId}) - {formatMoney(m.price)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                      2. Giờ hẹn giặt:
                    </label>
                    <input
                      type="time"
                      value={bookingTime}
                      onChange={e => setBookingTime(e.target.value)}
                      required
                      className="w-full soft-input p-2.5 rounded-xl text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                      3. Ngày hẹn:
                    </label>
                    <input
                      type="text"
                      value={bookingDate}
                      onChange={e => setBookingDate(e.target.value)}
                      placeholder="DD/MM/YYYY"
                      className="w-full soft-input p-2.5 rounded-xl text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                {/* Auto tenant info */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cư dân:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{profile?.name || 'Cư dân'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Phòng:</span>
                    <span className="font-semibold text-slate-900 dark:text-white font-num">{profile?.room?.roomNumber || '203'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Số tiền cọc:</span>
                    <span className="font-bold text-sky-600 dark:text-sky-400 font-num">5.000 đ</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingBooking}
                  className="w-full primary-button py-3 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmittingBooking ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  <span>Xác nhận đặt giữ chỗ</span>
                </button>
              </form>
            </div>

            {/* Bookings List */}
            <div className="md:col-span-6 space-y-3">
              <h4 className="type-h4 font-bold text-slate-900 dark:text-white">
                Các lượt đặt chỗ gần đây
              </h4>

              {bookings.length === 0 ? (
                <div className="soft-card p-6 text-center text-xs text-slate-400">
                  Chưa có lượt đặt trước nào trong hệ thống.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {bookings.map(b => (
                    <div key={b.bookingId} className="soft-card p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold font-num bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                            {b.machineId}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white font-num">
                            Hẹn lúc {b.bookingTime} ({b.bookingDate})
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Cư dân: <b>{b.tenantName}</b> {b.roomNumber ? `(P.${b.roomNumber})` : ''}
                        </p>
                      </div>

                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
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

      {/* =========================================================================
          TAB 3: RULES & GUIDES VIEW
         ========================================================================= */}
      {activeTab === 'rules' && (
        <div className="space-y-4 max-w-3xl">
          
          <div className="soft-card p-5 space-y-3">
            <h4 className="type-h4 font-bold text-sky-600 dark:text-sky-400 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 text-xs flex items-center justify-center font-bold">1</span>
              <span>Thời gian hoạt động & Thanh toán</span>
            </h4>
            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 pl-2">
              <li>• Máy hoạt động 24/7 phục vụ toàn thể cư dân.</li>
              <li>• Thanh toán hoàn toàn tự động bằng cách quét mã <b>VietQR</b> hoặc chuyển khoản ngân hàng.</li>
              <li>• <b>Bắt buộc:</b> Giữ nguyên nội dung chuyển khoản là mã máy (VD: <b>MG01</b>, <b>MS01</b>) để hệ thống tự động kích hoạt cấp điện trong vòng 3–5 giây.</li>
            </ul>
          </div>

          <div className="soft-card p-5 space-y-3">
            <h4 className="type-h4 font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs flex items-center justify-center font-bold">2</span>
              <span>Quy định sử dụng máy</span>
            </h4>
            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 pl-2">
              <li>• Không giặt quá tải: Máy giặt tối đa 9kg đồ khô, máy sấy tối đa 8kg.</li>
              <li>• <b>Nghiêm cấm:</b> Giặt giày dép đế cứng, thảm chùi chân dính bùn đất, quần áo dính hóa chất dễ cháy.</li>
              <li>• Lấy quần áo ra khỏi máy trong vòng <b>15–30 phút</b> sau khi hoàn thành để nhường chỗ cho người tiếp theo.</li>
            </ul>
          </div>

          <div className="soft-card p-5 space-y-3">
            <h4 className="type-h4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-800 text-xs flex items-center justify-center font-bold">3</span>
              <span>Hỗ trợ sự cố khẩn cấp</span>
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nếu đã chuyển khoản thành công nhưng máy không chạy, quý cư dân vui lòng liên hệ ngay Zalo Quản Lý:
            </p>
            <a
              href="https://zalo.me/0902371800"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-bold text-xs hover:underline"
            >
              <span>Hotline / Zalo: 0902371800</span>
            </a>
          </div>

        </div>
      )}

      {/* =========================================================================
          MODAL: PAYMENT (VietQR Quick Modal)
         ========================================================================= */}
      {activeModal === 'payment' && selectedMachine && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md soft-surface p-6 rounded-3xl space-y-5 relative overflow-hidden shadow-2xl">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                {selectedMachine.type === 'WASHER' ? <IconLaundry3D size={32} /> : <IconDryer3D size={32} />}
                <div>
                  <h3 className="type-h3 font-bold text-slate-900 dark:text-white">
                    {selectedMachine.name}
                  </h3>
                  <span className="text-xs text-slate-400">Mã máy: <b>{selectedMachine.machineId}</b></span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="soft-button p-2 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* QR Code Container */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
                <span>Quét mã VietQR để kích hoạt máy</span>
              </div>

              <div className="bg-white p-3 rounded-2xl mx-auto max-w-[240px] shadow-sm border border-slate-100">
                <img
                  src={`https://img.vietqr.io/image/MB-0902371800-compact2.png?amount=${selectedMachine.price}&addInfo=${encodeURIComponent(selectedMachine.machineId)}&accountName=BUI%20TRUNG%20KHAI`}
                  alt="VietQR"
                  className="w-full h-auto rounded-lg"
                />
              </div>
            </div>

            {/* Transfer Memo Box */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl flex items-center justify-between border border-slate-200/60 dark:border-slate-700/60">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Nội dung chuyển khoản (Bắt buộc)
                </span>
                <span className="text-lg font-black font-num text-sky-600 dark:text-sky-400">
                  {selectedMachine.machineId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyMemo(selectedMachine.machineId)}
                className="soft-button px-3 py-2 flex items-center gap-1.5 text-xs font-bold cursor-pointer"
              >
                {hasCopiedMemo ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                <span>{hasCopiedMemo ? 'Đã copy' : 'Sao chép'}</span>
              </button>
            </div>

            {/* Price & Bank Details */}
            <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-2">
              <div className="flex justify-between">
                <span>Số tiền thanh toán:</span>
                <span className="font-bold text-slate-900 dark:text-white font-num text-base text-sky-600">
                  {formatMoney(selectedMachine.price)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Ngân hàng thụ hưởng:</span>
                <span className="font-semibold text-slate-900 dark:text-white">MBBank</span>
              </div>
              <div className="flex justify-between">
                <span>Số tài khoản:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">0902371800</span>
              </div>
              <div className="flex justify-between">
                <span>Chủ tài khoản:</span>
                <span className="font-semibold text-slate-900 dark:text-white">BUI TRUNG KHAI</span>
              </div>
            </div>

            {/* Waiting Notice */}
            <div className="p-3 bg-sky-50 dark:bg-sky-950/30 rounded-xl text-center text-xs text-sky-700 dark:text-sky-300 font-medium flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin shrink-0" />
              <span>Đang chờ nhận tiền... Hệ thống sẽ tự kích hoạt sau 3–5 giây</span>
            </div>

          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: LIVE COUNTDOWN TIMER
         ========================================================================= */}
      {activeModal === 'timer' && selectedMachine && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md soft-surface p-6 rounded-3xl space-y-6 relative overflow-hidden shadow-2xl">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                {selectedMachine.type === 'WASHER' ? <IconLaundry3D size={32} /> : <IconDryer3D size={32} />}
                <div>
                  <h3 className="type-h3 font-bold text-slate-900 dark:text-white">
                    {selectedMachine.name}
                  </h3>
                  <span className="text-xs text-slate-400">Đang hoạt động • {selectedMachine.machineId}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="soft-button p-2 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Animated Washing Machine / Dryer Porthole Drum Timer */}
            {(() => {
              const rem = getRemainingSeconds(selectedMachine);
              const totalSec = (selectedMachine.cycleMinutes || 45) * 60;
              const ratio = Math.min(1, Math.max(0, rem / totalSec));
              const circ = 2 * Math.PI * 47; // radius 47
              const strokeOffset = circ * (1 - ratio);
              const isWasher = selectedMachine.type === 'WASHER';
              const isRunning = rem > 0;

              const completionTime = selectedMachine.expectedEndTime
                ? new Date(selectedMachine.expectedEndTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                : '--:--';

              return (
                <div className="flex flex-col items-center justify-center space-y-5">
                  {/* Outer Frame with machine shake vibration when actively running */}
                  <div className={cn(
                    "relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center select-none transition-transform",
                    isRunning && "animate-laundry-shake"
                  )}>
                    
                    {/* SVG Circular Progress Ring */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90 z-20 pointer-events-none" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="47"
                        className="text-slate-200/60 dark:text-slate-800/60"
                        strokeWidth="3.5"
                        stroke="currentColor"
                        fill="transparent"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="47"
                        strokeWidth="4"
                        strokeDasharray={circ}
                        strokeDashoffset={strokeOffset}
                        strokeLinecap="round"
                        stroke={isWasher ? '#0ea5e9' : '#f97316'}
                        fill="transparent"
                        className="transition-all duration-1000 ease-linear"
                        style={{
                          filter: isWasher
                            ? 'drop-shadow(0 0 6px rgba(14, 165, 233, 0.6))'
                            : 'drop-shadow(0 0 6px rgba(249, 115, 22, 0.6))'
                        }}
                      />
                    </svg>

                    {/* Machine Door Outer Metallic Bezel */}
                    <div className="absolute inset-3 rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900 p-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.25),inset_0_2px_4px_rgba(255,255,255,0.8)] border border-white/60 dark:border-slate-600/60 flex items-center justify-center">
                      
                      {/* Door Latch Detail */}
                      <div className="absolute right-1 w-2.5 h-8 rounded-r-md bg-slate-400 dark:bg-slate-600 border border-slate-500/50 shadow-sm" />

                      {/* Inner Glass Porthole Window */}
                      <div className="relative w-full h-full rounded-full overflow-hidden bg-slate-950 shadow-[inset_0_10px_25px_rgba(0,0,0,0.9)] flex items-center justify-center">
                        
                        {/* 1. ROTATING STAINLESS STEEL DRUM */}
                        <div className={cn(
                          "absolute inset-0 rounded-full overflow-hidden bg-[radial-gradient(circle_at_center,_#334155_0%,_#1e293b_60%,_#090d16_100%)]",
                          isRunning && (isWasher ? "animate-laundry-spin" : "animate-laundry-spin-fast")
                        )}>
                          
                          {/* Stainless steel drum perforations (concentric dashed lines) */}
                          <div className="absolute inset-2 rounded-full border-2 border-dashed border-slate-500/30 opacity-70" />
                          <div className="absolute inset-7 rounded-full border border-dotted border-slate-400/25 opacity-60" />

                          {/* 3 Internal Drum Baffles / Fins (3 gờ inox đảo đồ góc 120 độ) */}
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-3.5 h-12 bg-gradient-to-b from-slate-300 to-slate-600 rounded-b-md opacity-80 shadow-md" />
                          <div className="absolute bottom-6 left-5 w-3.5 h-12 bg-gradient-to-b from-slate-300 to-slate-600 rounded-b-md opacity-80 shadow-md rotate-[120deg]" />
                          <div className="absolute bottom-6 right-5 w-3.5 h-12 bg-gradient-to-b from-slate-300 to-slate-600 rounded-b-md opacity-80 shadow-md -rotate-[120deg]" />

                          {/* Tumbling Clothes Inside Drum (Quần áo xoay đảo nhịp nhàng) */}
                          {/* Clothes 1: Coral Red T-shirt */}
                          <div className="absolute top-7 left-9 w-11 h-7 rounded-2xl bg-gradient-to-br from-rose-400 to-rose-600 shadow-md rotate-12 opacity-95 flex items-center justify-center">
                            <span className="w-5 h-1 bg-rose-200/50 rounded-full" />
                          </div>

                          {/* Clothes 2: Sky Blue Denim */}
                          <div className="absolute bottom-8 right-8 w-12 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-md -rotate-45 opacity-90" />

                          {/* Clothes 3: Warm Amber Towel */}
                          <div className="absolute top-12 right-7 w-9 h-9 rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 shadow-md rotate-35 opacity-90" />

                          {/* Clothes 4: Crisp White Shirt */}
                          <div className="absolute bottom-7 left-10 w-10 h-7 rounded-xl bg-gradient-to-br from-white to-slate-200 shadow-md -rotate-15 opacity-95" />

                          {/* Clothes 5: Indigo Fabric */}
                          <div className="absolute top-1/2 right-12 w-7 h-5 rounded-md bg-indigo-500 shadow-sm rotate-90 opacity-80" />
                        </div>

                        {/* 2. WASHER WATER & FOAM or DRYER HEAT SHIMMER */}
                        {isWasher ? (
                          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-sky-500/40 via-blue-500/20 to-transparent rounded-b-full pointer-events-none animate-laundry-water">
                            {/* Animated Bubbles / Suds */}
                            {isRunning && (
                              <>
                                <span className="absolute bottom-8 left-12 w-2.5 h-2.5 rounded-full bg-white/70 animate-ping" />
                                <span className="absolute bottom-5 right-14 w-3.5 h-3.5 rounded-full bg-white/60 animate-pulse" />
                                <span className="absolute bottom-11 right-20 w-2 h-2 rounded-full bg-white/80 animate-ping" style={{ animationDelay: '0.6s' }} />
                                <span className="absolute bottom-4 left-20 w-2 h-2 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: '1.2s' }} />
                              </>
                            )}
                          </div>
                        ) : (
                          /* Dryer Warm Air Vortex & Glow */
                          <div className="absolute inset-0 bg-gradient-to-t from-amber-500/35 via-orange-500/15 to-transparent rounded-full pointer-events-none animate-pulse">
                            {isRunning && (
                              <div className="absolute inset-x-6 bottom-4 h-10 rounded-full bg-orange-400/20 blur-md animate-pulse" />
                            )}
                          </div>
                        )}

                        {/* 3. CONVEX OPTICAL GLASS CURVE REFLECTION */}
                        <div className="absolute top-1 inset-x-5 h-24 rounded-t-full bg-gradient-to-b from-white/30 via-white/10 to-transparent pointer-events-none blur-[0.5px]" />
                        <div className="absolute bottom-2 inset-x-14 h-5 rounded-b-full bg-gradient-to-t from-white/15 to-transparent pointer-events-none" />

                        {/* 4. CENTER FLOATING DIGITAL HUD DISPLAY */}
                        <div className="relative z-30 pointer-events-none flex flex-col items-center justify-center text-center">
                          <div className="backdrop-blur-md bg-slate-950/70 dark:bg-black/75 border border-white/20 rounded-2xl px-5 py-3 shadow-[0_10px_35px_rgba(0,0,0,0.6)]">
                            <span className="text-3xl sm:text-4xl font-black font-num text-white tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] block leading-none">
                              {formatSeconds(rem)}
                            </span>
                            
                            {isRunning ? (
                              <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-bold tracking-wider mt-1.5">
                                <span className={cn(
                                  "w-2 h-2 rounded-full animate-ping",
                                  isWasher ? "bg-sky-400" : "bg-amber-400"
                                )} />
                                <span className={isWasher ? "text-sky-300" : "text-amber-300"}>
                                  {isWasher ? "Đang giặt đảo" : "Đang sấy nhiệt"}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1 text-[10px] uppercase font-bold text-emerald-400 tracking-wider mt-1.5">
                                <CheckCircle2 size={12} />
                                <span>Đã hoàn thành</span>
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>

                  </div>

                  <div className="w-full p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl flex items-center justify-around text-xs font-semibold">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Dự kiến xong lúc</span>
                      <span className="font-bold font-num text-slate-900 dark:text-white text-sm">
                        {completionTime}
                      </span>
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700"></div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Trạng thái ổ điện</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-1">
                        <Power size={12} /> BẬT NGUỒN
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full soft-button py-2.5 text-xs font-semibold cursor-pointer"
            >
              Thu nhỏ đồng hồ
            </button>

          </div>
        </div>
      )}

    </div>
  );
}
