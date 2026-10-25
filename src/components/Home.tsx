import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, Bell, CarFront, CheckCircle2, ChevronRight, Clock3, CreditCard, FileText, House, LockKeyhole, ReceiptText, Sparkles, UserRound, WashingMachine } from 'lucide-react';
import { IconHome3D, IconWallet3D, IconLaundry3D, IconContract3D, IconProfile3D, IconVehicle3D, IconNotification3D } from './Icons3D';
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
    { label: 'Hóa đơn', subtitle: 'Chi phí mỗi tháng', Icon: IconWallet3D, onClick: () => navigate('/invoices'), color: '' },
    { label: 'Giặt sấy', subtitle: 'Chọn máy & đặt lịch', Icon: IconLaundry3D, onClick: () => navigate('/laundry'), color: '' },
    { label: 'Hợp đồng', subtitle: 'Hồ sơ lưu trú', Icon: IconContract3D, onClick: openContractModal, color: '' },
    { label: 'Cá nhân', subtitle: 'Thông tin của bạn', Icon: IconProfile3D, onClick: () => navigate('/profile'), color: '' },
  ];

  return (
    <div className="space-y-7 sm:space-y-9">
      <header data-tutorial="resident-welcome" className="flex items-center justify-between gap-4 pt-2">
        <div className="min-w-0">
          <p className="liquid-eyebrow mb-2">KHÔNG GIAN CƯ DÂN</p>
          <h1 className="text-[29px] leading-tight sm:text-[36px] font-semibold tracking-[-0.045em] text-neutral-950 dark:text-white">
            Xin chào{firstName ? `, ${firstName}` : ''}<span className="text-neutral-950 dark:text-white">.</span>
          </h1>
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-200">Mọi điều về ngôi nhà, ngay trong tầm tay.</p>
        </div>
        <div className="liquid-panel-subtle hidden sm:flex items-center gap-3 px-4 py-3 rounded-[22px] shrink-0">
          <span className="glass-icon h-10 w-10 rounded-2xl text-neutral-700 dark:text-neutral-300"><IconHome3D size={44} /></span>
          <div>
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-200">Phòng của bạn</span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-white">{room}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div data-tutorial="billing-card" className="liquid-panel relative overflow-hidden p-6 sm:p-8 lg:col-span-8">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="glass-icon h-11 w-11 rounded-[16px] text-neutral-700 dark:text-neutral-300"><IconWallet3D size={48} /></span>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Chi phí phòng thuê</h2>
                  <p className="mt-0.5 text-xs text-neutral-700 dark:text-neutral-200">{currentInvoice ? `Kỳ tháng ${currentInvoice.month}` : 'Hóa đơn của bạn'}</p>
                </div>
              </div>
              {currentInvoice && <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', isPaid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : isPending ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-neutral-500/10 text-neutral-700 dark:text-neutral-300')}>
                {isPaid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                {isPaid ? 'Đã thanh toán' : isPending ? 'Chờ xác nhận' : 'Chưa thanh toán'}
              </span>}
            </div>

            <div className="py-8 sm:py-10">
              <p className="text-sm text-neutral-700 dark:text-neutral-200 mb-2">{!currentInvoice ? 'Chưa có hóa đơn' : isPaid ? 'Số tiền đã thanh toán' : isPending ? 'Số tiền chờ xác nhận' : 'Số tiền cần thanh toán'}</p>
              {currentInvoice ? <div className="flex items-baseline gap-2 text-neutral-950 dark:text-white">
                <span className="text-[42px] sm:text-[58px] leading-none font-semibold tracking-[-0.055em] font-num">{currentInvoice.total.toLocaleString('vi-VN')}</span>
                <span className="text-2xl font-normal text-neutral-600 dark:text-neutral-300">₫</span>
              </div> : <h3 className="text-[26px] sm:text-[32px] leading-tight tracking-[-0.035em] font-semibold text-neutral-900 dark:text-white">Một nơi để theo dõi<br />mọi khoản phí.</h3>}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-200">
                {currentInvoice ? <><Clock3 size={13} /> Hạn thanh toán: <span className="font-medium text-neutral-700 dark:text-neutral-200">{currentInvoice.dueDate || 'Chưa cập nhật'}</span></> : 'Hóa đơn sẽ xuất hiện tại đây khi được phát hành.'}
              </p>
            </div>

            <div data-tutorial="billing-pay-btn" className="flex flex-wrap items-center gap-3 border-t border-neutral-900/[0.06] dark:border-white/[0.08] pt-5">
              {isUnpaid && <button type="button" onClick={() => navigate(`/payment?invoiceId=${currentInvoice.id}`)} className="primary-button min-h-11 px-5 flex items-center justify-center gap-2 text-sm">
                {paymentGateStatus === 'STOP' ? <LockKeyhole size={16} /> : <CreditCard size={16} />}
                {paymentGateStatus === 'STOP' ? 'Thông tin thanh toán' : 'Thanh toán ngay'}
                <ArrowUpRight size={16} />
              </button>}
              <button type="button" onClick={() => currentInvoice ? openInvoiceDetailModal(currentInvoice) : navigate('/invoices')} className="soft-button min-h-11 px-5 inline-flex items-center justify-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                {currentInvoice ? 'Xem hóa đơn' : 'Đến mục hóa đơn'}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 liquid-panel p-6 sm:p-7 flex flex-col justify-between gap-6 relative overflow-hidden">
          <div className="relative flex items-center justify-between">
            <span className="liquid-eyebrow">GÓC NHỎ CỦA BẠN</span>
            <span className="glass-icon h-9 w-9 rounded-full text-neutral-700 dark:text-neutral-300"><IconHome3D size={44} /></span>
          </div>
          <div className="relative">
            <p className="text-sm text-neutral-700 dark:text-neutral-200">{profile.room.building || 'Thông tin phòng'}</p>
            <h2 className="mt-1 text-[32px] font-semibold tracking-[-0.045em] text-neutral-900 dark:text-white">{room}</h2>
            <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-200">{profile.room.floor || 'Không gian sống của bạn'}</p>
          </div>
          <div className="relative space-y-1 border-t border-neutral-900/[0.06] dark:border-white/[0.08] pt-3">
            <NavLink to="/profile" className="flex items-center gap-3 rounded-2xl py-3 text-sm group">
              <IconVehicle3D size={32} />
              <span className="text-neutral-700 dark:text-neutral-200">Biển số xe</span>
              <span className="ml-auto font-medium text-neutral-800 dark:text-neutral-200 text-right">{profile.vehicle.plateNumber || 'Chưa cập nhật'}</span>
              <ChevronRight size={15} className="text-neutral-600 group-hover:translate-x-0.5 transition-transform dark:text-neutral-300" />
            </NavLink>
            <button type="button" onClick={openContractModal} className="w-full flex items-center gap-3 rounded-2xl py-3 text-left text-sm group">
              <IconContract3D size={32} />
              <span className="text-neutral-700 dark:text-neutral-200">Hợp đồng thuê</span>
              <span className="ml-auto font-medium text-neutral-700 dark:text-neutral-300">Xem chi tiết</span>
              <ChevronRight size={15} className="text-neutral-600 group-hover:translate-x-0.5 transition-transform dark:text-neutral-300" />
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 id="quick-actions-title" className="liquid-section-title">Dành cho bạn</h2>
          <NavLink to="/utilities" className="text-xs font-medium text-neutral-700 dark:text-neutral-300 inline-flex items-center gap-1">Tất cả tiện ích <ChevronRight size={14} /></NavLink>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {quickActions.map(({ label, subtitle, Icon, onClick, color }) => <button key={label} type="button" onClick={onClick} className="liquid-panel-subtle p-4 sm:p-5 rounded-[24px] text-left group transition-transform duration-200 hover:-translate-y-1 active:scale-[0.98]">
            <div className="flex items-center justify-between mb-4"><span className={cn('h-14 w-14 flex items-center justify-center', color)}><Icon size={56} /></span><ArrowUpRight size={16} className="text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-neutral-300" /></div>
            <span className="block font-semibold text-sm text-neutral-900 dark:text-white">{label}</span>
            <span className="block text-xs mt-1 text-neutral-700 dark:text-neutral-200">{subtitle}</span>
          </button>)}
        </div>
      </section>

      <section className="liquid-panel p-5 sm:p-7" aria-labelledby="notifications-title">
        <div className="flex items-center gap-3 mb-5">
          <span className="glass-icon h-10 w-10 rounded-[15px] text-neutral-700 dark:text-neutral-300"><IconNotification3D size={44} /></span>
          <div><h2 id="notifications-title" className="liquid-section-title">Thông báo mới nhất</h2><p className="text-xs text-neutral-700 dark:text-neutral-200 mt-0.5">Cập nhật từ ban quản lý</p></div>
          {notifications.some(item => item.unread) && <span className="ml-auto h-2 w-2 rounded-full bg-neutral-500" aria-label="Có thông báo chưa đọc" />}
        </div>
        {notifications.length ? <div className="grid md:grid-cols-2 gap-3">
          {notifications.slice(0, 2).map(item => <button type="button" key={item.id} onClick={() => openNotificationModal(item)} className="liquid-panel-subtle rounded-[20px] p-4 text-left flex items-start gap-3 group">
            <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', item.unread ? 'bg-neutral-500' : 'bg-neutral-300 dark:bg-neutral-600')} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-800 dark:text-neutral-100 group-hover:text-neutral-900 dark:group-hover:text-neutral-300 line-clamp-2 dark:hover:text-white">{item.title}</span><span className="block mt-1.5 text-xs leading-relaxed text-neutral-700 dark:text-neutral-200 line-clamp-2">{item.desc}</span><span className="block mt-3 text-xs text-neutral-600 dark:text-neutral-300">{item.time}</span></span>
            <ChevronRight size={16} className="mt-1 text-neutral-600 shrink-0 dark:text-neutral-300" />
          </button>)}
        </div> : <div className="liquid-panel-subtle rounded-[22px] px-5 py-7 flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
          <Sparkles size={23} strokeWidth={1.5} className="text-neutral-600 dark:text-neutral-300" />
          <div><p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Bạn đã cập nhật mọi thứ.</p><p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1">Thông báo mới từ ban quản lý sẽ xuất hiện tại đây.</p></div>
        </div>}
      </section>
    </div>
  );
}
