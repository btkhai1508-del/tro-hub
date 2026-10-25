import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, Bell, CarFront, CheckCircle2, ChevronRight, Clock3, CreditCard, FileText, House, LockKeyhole, ReceiptText, Sparkles, UserRound, WashingMachine } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

export function Home() {
  const navigate = useNavigate();
  const { profile, invoices, openInvoiceDetailModal, openNotificationModal, openContractModal, notifications, paymentGateStatus } = useApp();
  const currentInvoice = invoices[0];
  const isPaid = currentInvoice?.status === 'paid';
  const isPending = currentInvoice?.status === 'pending';
  const isUnpaid = currentInvoice?.status === 'unpaid';
  const room = profile.room.roomNumber || 'Chưa cập nhật';
  const firstName = profile.name.trim().split(/\s+/).pop();
  const quickActions = [
    { label: 'Hóa đơn', subtitle: 'Chi phí mỗi tháng', Icon: ReceiptText, onClick: () => navigate('/invoices'), color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
    { label: 'Giặt sấy', subtitle: 'Chọn máy & đặt lịch', Icon: WashingMachine, onClick: () => navigate('/laundry'), color: 'text-cyan-700 dark:text-cyan-300 bg-cyan-500/10' },
    { label: 'Hợp đồng', subtitle: 'Hồ sơ lưu trú', Icon: FileText, onClick: openContractModal, color: 'text-violet-600 dark:text-violet-300 bg-violet-500/10' },
    { label: 'Cá nhân', subtitle: 'Thông tin của bạn', Icon: UserRound, onClick: () => navigate('/profile'), color: 'text-orange-600 dark:text-orange-300 bg-orange-500/10' },
  ];

  return (
    <div className="space-y-7 sm:space-y-9">
      <header data-tutorial="resident-welcome" className="flex items-center justify-between gap-4 pt-2">
        <div className="min-w-0">
          <p className="liquid-eyebrow mb-2">KHÔNG GIAN CƯ DÂN</p>
          <h1 className="text-[29px] leading-tight sm:text-[36px] font-semibold tracking-[-0.045em] text-slate-950 dark:text-white">
            Xin chào{firstName ? `, ${firstName}` : ''}<span className="text-blue-500">.</span>
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Mọi điều về ngôi nhà, ngay trong tầm tay.</p>
        </div>
        <div className="liquid-panel-subtle hidden sm:flex items-center gap-3 px-4 py-3 rounded-[22px] shrink-0">
          <span className="glass-icon h-10 w-10 rounded-2xl text-blue-600 dark:text-blue-300"><House size={20} strokeWidth={1.7} /></span>
          <div>
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Phòng của bạn</span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{room}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div data-tutorial="billing-card" className="liquid-panel relative overflow-hidden p-6 sm:p-8 lg:col-span-8">
          <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-300/20 blur-3xl dark:bg-blue-500/10 pointer-events-none" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="glass-icon h-11 w-11 rounded-[16px] text-blue-600 dark:text-blue-300"><ReceiptText size={22} strokeWidth={1.6} /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Chi phí phòng thuê</h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{currentInvoice ? `Kỳ tháng ${currentInvoice.month}` : 'Hóa đơn của bạn'}</p>
                </div>
              </div>
              {currentInvoice && <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', isPaid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : isPending ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300')}>
                {isPaid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                {isPaid ? 'Đã thanh toán' : isPending ? 'Chờ xác nhận' : 'Chưa thanh toán'}
              </span>}
            </div>

            <div className="py-8 sm:py-10">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{!currentInvoice ? 'Chưa có hóa đơn' : isPaid ? 'Số tiền đã thanh toán' : isPending ? 'Số tiền chờ xác nhận' : 'Số tiền cần thanh toán'}</p>
              {currentInvoice ? <div className="flex items-baseline gap-2 text-slate-950 dark:text-white">
                <span className="text-[42px] sm:text-[58px] leading-none font-semibold tracking-[-0.055em] font-num">{currentInvoice.total.toLocaleString('vi-VN')}</span>
                <span className="text-2xl font-normal text-slate-400">₫</span>
              </div> : <h3 className="text-[26px] sm:text-[32px] leading-tight tracking-[-0.035em] font-semibold text-slate-900 dark:text-white">Một nơi để theo dõi<br />mọi khoản phí.</h3>}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {currentInvoice ? <><Clock3 size={13} /> Hạn thanh toán: <span className="font-medium text-slate-700 dark:text-slate-200">{currentInvoice.dueDate || 'Chưa cập nhật'}</span></> : 'Hóa đơn sẽ xuất hiện tại đây khi được phát hành.'}
              </p>
            </div>

            <div data-tutorial="billing-pay-btn" className="flex flex-wrap items-center gap-3 border-t border-slate-900/[0.06] dark:border-white/[0.08] pt-5">
              {isUnpaid && <button type="button" onClick={() => navigate(`/payment?invoiceId=${currentInvoice.id}`)} className="primary-button min-h-11 px-5 flex items-center justify-center gap-2 text-sm">
                {paymentGateStatus === 'STOP' ? <LockKeyhole size={16} /> : <CreditCard size={16} />}
                {paymentGateStatus === 'STOP' ? 'Thông tin thanh toán' : 'Thanh toán ngay'}
                <ArrowUpRight size={16} />
              </button>}
              <button type="button" onClick={() => currentInvoice ? openInvoiceDetailModal(currentInvoice) : navigate('/invoices')} className="soft-button min-h-11 px-5 inline-flex items-center justify-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                {currentInvoice ? 'Xem hóa đơn' : 'Đến mục hóa đơn'}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 liquid-panel p-6 sm:p-7 flex flex-col justify-between gap-6 relative overflow-hidden">
          <div aria-hidden="true" className="absolute -bottom-24 -right-20 h-56 w-56 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-500/10 pointer-events-none" />
          <div className="relative flex items-center justify-between">
            <span className="liquid-eyebrow">GÓC NHỎ CỦA BẠN</span>
            <span className="glass-icon h-9 w-9 rounded-full text-slate-500 dark:text-slate-300"><House size={17} strokeWidth={1.6} /></span>
          </div>
          <div className="relative">
            <p className="text-sm text-slate-500 dark:text-slate-400">{profile.room.building || 'Thông tin phòng'}</p>
            <h2 className="mt-1 text-[32px] font-semibold tracking-[-0.045em] text-slate-900 dark:text-white">{room}</h2>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{profile.room.floor || 'Không gian sống của bạn'}</p>
          </div>
          <div className="relative space-y-1 border-t border-slate-900/[0.06] dark:border-white/[0.08] pt-3">
            <NavLink to="/profile" className="flex items-center gap-3 rounded-2xl py-3 text-sm group">
              <CarFront size={18} strokeWidth={1.6} className="text-slate-400" />
              <span className="text-slate-500 dark:text-slate-400">Biển số xe</span>
              <span className="ml-auto font-medium text-slate-800 dark:text-slate-200 text-right">{profile.vehicle.plateNumber || 'Chưa cập nhật'}</span>
              <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </NavLink>
            <button type="button" onClick={openContractModal} className="w-full flex items-center gap-3 rounded-2xl py-3 text-left text-sm group">
              <FileText size={18} strokeWidth={1.6} className="text-slate-400" />
              <span className="text-slate-500 dark:text-slate-400">Hợp đồng thuê</span>
              <span className="ml-auto font-medium text-blue-600 dark:text-blue-300">Xem chi tiết</span>
              <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 id="quick-actions-title" className="liquid-section-title">Dành cho bạn</h2>
          <NavLink to="/utilities" className="text-xs font-medium text-blue-600 dark:text-blue-300 inline-flex items-center gap-1">Tất cả tiện ích <ChevronRight size={14} /></NavLink>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {quickActions.map(({ label, subtitle, Icon, onClick, color }) => <button key={label} type="button" onClick={onClick} className="liquid-panel-subtle p-4 sm:p-5 rounded-[24px] text-left group transition-transform duration-200 hover:-translate-y-1 active:scale-[0.98]">
            <div className="flex items-center justify-between mb-4"><span className={cn('h-11 w-11 rounded-[16px] flex items-center justify-center', color)}><Icon size={22} strokeWidth={1.65} /></span><ArrowUpRight size={16} className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></div>
            <span className="block font-semibold text-sm text-slate-900 dark:text-white">{label}</span>
            <span className="block text-xs mt-1 text-slate-500 dark:text-slate-400">{subtitle}</span>
          </button>)}
        </div>
      </section>

      <section className="liquid-panel p-5 sm:p-7" aria-labelledby="notifications-title">
        <div className="flex items-center gap-3 mb-5">
          <span className="glass-icon h-10 w-10 rounded-[15px] text-blue-600 dark:text-blue-300"><Bell size={19} strokeWidth={1.7} /></span>
          <div><h2 id="notifications-title" className="liquid-section-title">Thông báo mới nhất</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Cập nhật từ ban quản lý</p></div>
          {notifications.some(item => item.unread) && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" aria-label="Có thông báo chưa đọc" />}
        </div>
        {notifications.length ? <div className="grid md:grid-cols-2 gap-3">
          {notifications.slice(0, 2).map(item => <button type="button" key={item.id} onClick={() => openNotificationModal(item)} className="liquid-panel-subtle rounded-[20px] p-4 text-left flex items-start gap-3 group">
            <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', item.unread ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600')} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-300 line-clamp-2">{item.title}</span><span className="block mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">{item.desc}</span><span className="block mt-3 text-[11px] text-slate-400 dark:text-slate-500">{item.time}</span></span>
            <ChevronRight size={16} className="mt-1 text-slate-400 shrink-0" />
          </button>)}
        </div> : <div className="liquid-panel-subtle rounded-[22px] px-5 py-7 flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
          <Sparkles size={23} strokeWidth={1.5} className="text-slate-400" />
          <div><p className="text-sm font-medium text-slate-700 dark:text-slate-200">Bạn đã cập nhật mọi thứ.</p><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Thông báo mới từ ban quản lý sẽ xuất hiện tại đây.</p></div>
        </div>}
      </section>
    </div>
  );
}
