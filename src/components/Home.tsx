import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  ArrowRight, 
  CreditCard, 
  CheckCircle2, 
  ChevronRight,
  Clock,
  Check,
  Lock
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { 
  IconHome3D, 
  IconWallet3D, 
  IconSecurity3D, 
  IconVehicle3D, 
  IconContract3D,
  IconNotification3D 
} from './Icons3D';

export function Home() {
  const navigate = useNavigate();
  const { 
    profile, 
    invoices, 
    openInvoiceDetailModal, 
    openNotificationModal,
    openContractModal,
    notifications,
    paymentGateStatus
  } = useApp();

  const currentInvoice = invoices[0];
  const isPaid = currentInvoice?.status === 'paid';
  const isPending = currentInvoice?.status === 'pending';
  const isUnpaid = currentInvoice?.status === 'unpaid';

  const formatCurrency = (val: number) => {
    return val.toLocaleString('vi-VN');
  };

  const handleGoToPayment = (invoiceId?: string) => {
    navigate(invoiceId ? `/payment?invoiceId=${invoiceId}` : '/payment');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Welcome Header */}
      <div data-tutorial="resident-welcome" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="type-label text-slate-400">Không gian cư dân</span>
          <h1 className="type-h1 text-slate-900 dark:text-white mt-1 font-bold">
            Xin chào, {profile.name}!
          </h1>
          <p className="type-body text-slate-500 dark:text-slate-400 mt-1">
            Tổng quan phòng thuê, hóa đơn cần thanh toán và thông báo quan trọng.
          </p>
        </div>

        {/* Quick Room Badge with 3D Home Icon */}
        <div className="flex items-center gap-3">
          <div className="soft-card px-4 py-2 flex items-center gap-3.5">
            <IconHome3D size={40} className="shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 uppercase tracking-wider block font-semibold">Phòng của tôi</span>
              <span className="type-h4 font-num text-slate-900 dark:text-slate-100 font-bold">{profile.room.roomNumber}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        
        {/* Main Payment & Billing Highlight Card (8 columns) */}
        <div data-tutorial="billing-card" className="md:col-span-8 soft-surface p-6 sm:p-8 relative overflow-hidden group transition-all">

          {/* Tick mark at the bottom-right corner of the card */}
          {isPaid && (
            <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-emerald-500 text-white shadow-md ring-4 ring-emerald-100 dark:ring-emerald-950/60 z-20 pointer-events-none transition-transform group-hover:scale-110">
              <Check size={18} className="stroke-[3]" />
            </div>
          )}

          <div className="relative z-10 flex flex-col justify-between h-full gap-6">
            
            {/* Top row */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex items-start gap-4">
                <IconWallet3D size={52} className="shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-num">
                      Kỳ thu phí Tháng {currentInvoice?.month}
                    </span>
                  </div>
                  <h2 className="type-h2 text-slate-900 dark:text-slate-100 font-bold">
                    {isPaid ? 'Chi phí tháng này đã hoàn tất' : (isPending ? 'Thanh toán đang chờ BQL xác nhận' : 'Thanh toán chi phí tháng này')}
                  </h2>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-[10px] text-slate-400 dark:text-slate-400 block uppercase font-medium">Hạn thanh toán</span>
                <span className="type-button font-num text-slate-900 dark:text-slate-100 block mt-0.5 font-bold">
                  {currentInvoice?.dueDate}
                </span>
              </div>
            </div>

            {/* Middle row: Big Amount */}
            <div>
              <p className="type-label text-slate-400 dark:text-slate-400 mb-1">
                {isUnpaid ? 'Số tiền cần thanh toán' : 'Tổng số tiền đã thanh toán'}
              </p>
              <div className={cn(
                "type-display font-num tracking-tight flex items-baseline gap-1.5 font-bold",
                isPaid ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100"
              )}>
                {formatCurrency(currentInvoice?.total || 0)}
                <span className={cn(
                  "text-2xl font-normal",
                  isPaid ? "text-emerald-500/70 dark:text-emerald-400/70" : "text-slate-400 dark:text-slate-500"
                )}>₫</span>
              </div>
            </div>

            {/* Bottom Actions */}
            <div data-tutorial="billing-pay-btn" className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-900/5 dark:border-white/10">
              {isUnpaid ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleGoToPayment(currentInvoice?.id)}
                    className="primary-button py-2.5 px-5 text-xs sm:text-sm flex items-center gap-2 shadow-xs cursor-pointer font-bold"
                  >
                    {paymentGateStatus === 'STOP' ? (
                      <>
                        <Lock size={15} className="text-amber-300" />
                        <span>Thanh toán (Cổng đóng)</span>
                      </>
                    ) : (
                      <>
                        <CreditCard size={16} />
                        <span>Thanh toán ngay</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openInvoiceDetailModal(currentInvoice)}
                    className="soft-button py-2.5 px-4 text-xs sm:text-sm flex items-center gap-1.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <span>Xem chi tiết hóa đơn</span>
                    <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openInvoiceDetailModal(currentInvoice)}
                  className="soft-button py-2.5 px-4 text-xs sm:text-sm flex items-center gap-2 cursor-pointer text-slate-800 dark:text-slate-200"
                >
                  <IconWallet3D size={24} />
                  <span>Xem chi tiết hóa đơn & biên lai</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>

          </div>
        </div>

        {/* Right Info Widgets (4 columns) */}
        <div className="md:col-span-4 space-y-4 flex flex-col justify-between">
          
          {/* Biển số xe Card (3D Glassmorphism, Chỉ giữ đúng biển số xe) */}
          <NavLink 
            to="/profile"
            className="soft-surface p-5 flex-1 flex flex-col justify-between rounded-[24px] hover:scale-[1.01] transition-all group select-none relative overflow-hidden"
          >
            {/* Top Sheen */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />

            {/* Header: Title & Navigate hint */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <IconVehicle3D size={42} className="shrink-0 group-hover:scale-105 transition-transform" />
                <div>
                  <h3 className="type-h4 text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors font-bold">
                    Biển số xe
                  </h3>
                </div>
              </div>
              <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </div>

            {/* Only License Plate Display */}
            <div className="w-full py-2.5 px-4 bg-white dark:bg-white text-slate-950 rounded-2xl border-2 border-slate-800 shadow-md flex items-center justify-center">
              <span className="font-mono text-sm sm:text-base font-extrabold tracking-widest text-slate-950">
                {profile.vehicle.plateNumber || '86AK-09320'}
              </span>
            </div>
          </NavLink>

          {/* Contract Status Mini card with 3D Contract Document Icon */}
          <div 
            onClick={openContractModal}
            className="soft-surface p-5 flex-1 flex flex-col justify-between rounded-[24px] hover:scale-[1.01] transition-all cursor-pointer group relative overflow-hidden"
          >
            {/* Top Sheen */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <IconContract3D size={42} className="shrink-0 group-hover:scale-105 transition-transform" />
                <div>
                  <h3 className="type-h4 text-slate-900 dark:text-slate-100 group-hover:text-slate-950 dark:group-hover:text-white transition-colors font-bold">Hợp đồng thuê</h3>
                  <p className="text-[11px] text-slate-400 dark:text-slate-400 font-num">#HD-2025-102</p>
                </div>
              </div>
              <span className="badge-paid text-[10px] py-0.5">Hiệu lực</span>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex justify-between items-center text-xs">
              <span className="text-slate-400 dark:text-slate-400">Thời hạn:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 font-num">01/06/2026 - 01/06/2027</span>
            </div>
          </div>

        </div>

        {/* Bottom Section: Recent Notifications with 3D Notification Bell */}
        <div className="md:col-span-12 soft-surface p-5 sm:p-6 rounded-[28px] relative overflow-hidden space-y-3">
          {/* Top Sheen */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3.5">
              <IconNotification3D size={38} className="shrink-0" />
              <div>
                <h3 className="type-h4 text-slate-900 dark:text-slate-100 font-bold">Thông báo mới nhất</h3>
                <span className="type-caption text-slate-400 dark:text-slate-400">
                  Bấm vào thông báo để xem nội dung chi tiết
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {notifications.slice(0, 2).map((item) => (
              <div 
                key={item.id}
                onClick={() => openNotificationModal(item)}
                className={cn(
                  "p-3.5 rounded-2xl border transition-all cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/80 dark:hover:bg-slate-800/80 flex items-start gap-3 group",
                  item.unread 
                    ? "bg-slate-100/90 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700" 
                    : "bg-white/50 dark:bg-slate-900/60 border-slate-200/60 dark:border-slate-800"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full mt-1.5 shrink-0",
                  item.unread ? "bg-rose-500" : "bg-transparent"
                )} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className={cn(
                      "text-xs leading-snug truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors",
                      item.unread ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300"
                    )}>
                      {item.title}
                    </p>
                    <span className="text-[10px] text-slate-400 dark:text-slate-400 font-num shrink-0">{item.time}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
