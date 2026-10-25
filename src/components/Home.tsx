import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, CheckCircle2, ChevronRight, Clock3, CreditCard, LockKeyhole, Sparkles } from 'lucide-react';
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
    <div className="kit-page">
      <header data-tutorial="resident-welcome" className="kit-page-header">
        <div className="min-w-0">
          <p className="kit-page-kicker">Trang chủ</p>
          <h1 className="kit-page-title apple-large-title apple-strong">
            Xin chào{firstName ? `, ${firstName}` : ''}<span className="text-neutral-950 dark:text-white">.</span>
          </h1>
          <p className="kit-page-description apple-body kit-text-secondary">Thông tin phòng, hóa đơn và tiện ích của bạn.</p>
        </div>
        <div className="kit-inset hidden sm:flex items-center gap-3 px-3.5 py-2.5 rounded-[20px] shrink-0">
          <span className="glass-icon h-10 w-10 rounded-2xl text-neutral-700 dark:text-neutral-300"><IconHome3D size={44} /></span>
          <div>
            <span className="block apple-callout font-medium kit-text-secondary">Phòng của bạn</span>
            <span className="apple-headline kit-text-primary">{room}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div data-tutorial="billing-card" className="liquid-panel relative overflow-hidden p-5 sm:p-7 lg:col-span-8">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="glass-icon h-11 w-11 rounded-[16px] text-neutral-700 dark:text-neutral-300"><IconWallet3D size={48} /></span>
                <div>
                  <h2 className="kit-card-heading apple-title2 apple-strong">Chi phí phòng thuê</h2>
                  <p className="mt-0.5 apple-callout kit-text-secondary">{currentInvoice ? `Kỳ tháng ${currentInvoice.month}` : 'Hóa đơn của bạn'}</p>
                </div>
              </div>
              {currentInvoice && <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 apple-callout font-medium', isPaid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : isPending ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-neutral-500/10 text-neutral-700 dark:text-neutral-300')}>
                {isPaid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                {isPaid ? 'Đã thanh toán' : isPending ? 'Chờ xác nhận' : 'Chưa thanh toán'}
              </span>}
            </div>

            <div className="py-7 sm:py-9">
              <p className="apple-body kit-text-secondary mb-2">{!currentInvoice ? 'Chưa có hóa đơn' : isPaid ? 'Số tiền đã thanh toán' : isPending ? 'Số tiền chờ xác nhận' : 'Số tiền cần thanh toán'}</p>
              {currentInvoice ? <div className="flex items-baseline gap-2 text-neutral-950 dark:text-white">
                <span className="apple-amount font-num">{currentInvoice.total.toLocaleString('vi-VN')}</span>
                <span className="apple-title2 font-normal kit-text-secondary">₫</span>
              </div> : <h3 className="apple-title1 apple-strong kit-text-primary">Một nơi để theo dõi<br />mọi khoản phí.</h3>}
              <p className="mt-4 flex items-center gap-1.5 apple-callout kit-text-secondary">
                {currentInvoice ? <><Clock3 size={13} /> Hạn thanh toán: <span className="font-medium text-neutral-700 dark:text-neutral-200">{currentInvoice.dueDate || 'Chưa cập nhật'}</span></> : 'Hóa đơn sẽ xuất hiện tại đây khi được phát hành.'}
              </p>
            </div>

            <div data-tutorial="billing-pay-btn" className="flex flex-wrap items-center gap-3 border-t border-neutral-900/[0.06] dark:border-white/[0.08] pt-5">
              {isUnpaid && <button type="button" onClick={() => navigate(`/payment?invoiceId=${currentInvoice.id}`)} className="primary-button min-h-11 px-5 flex items-center justify-center gap-2 text-sm">
                {paymentGateStatus === 'STOP' ? <LockKeyhole size={16} /> : <CreditCard size={16} />}
                {paymentGateStatus === 'STOP' ? 'Thông tin thanh toán' : 'Thanh toán ngay'}
                <ArrowUpRight size={16} />
              </button>}
              <button type="button" onClick={() => currentInvoice ? openInvoiceDetailModal(currentInvoice) : navigate('/invoices')} className="soft-button min-h-11 px-5 inline-flex items-center justify-center gap-2 apple-control kit-text-primary">
                {currentInvoice ? 'Xem hóa đơn' : 'Đến mục hóa đơn'}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 liquid-panel p-5 sm:p-6 flex flex-col justify-between gap-5 relative overflow-hidden">
          <div className="relative flex items-center justify-between">
            <h2 className="kit-card-heading apple-title2 apple-strong">Phòng của bạn</h2>
            <span className="glass-icon h-9 w-9 rounded-full text-neutral-700 dark:text-neutral-300"><IconHome3D size={44} /></span>
          </div>
          <div className="relative">
            <p className="apple-body kit-text-secondary">{profile.room.building || 'Thông tin phòng'}</p>
            <p className="mt-1 apple-large-title apple-strong kit-text-primary">{room}</p>
            <p className="mt-2 apple-callout kit-text-secondary">{profile.room.floor || 'Không gian sống của bạn'}</p>
          </div>
          <div className="relative divide-y divide-black/[0.07] dark:divide-white/10 border-t border-neutral-900/[0.06] dark:border-white/[0.08] pt-1">
            <NavLink to="/profile" className="flex items-center gap-3 rounded-2xl py-3 apple-body group">
              <IconVehicle3D size={32} />
              <span className="text-neutral-700 dark:text-neutral-200">Biển số xe</span>
              <span className="ml-auto font-medium text-neutral-800 dark:text-neutral-200 text-right">{profile.vehicle.plateNumber || 'Chưa cập nhật'}</span>
              <ChevronRight size={15} className="text-neutral-600 group-hover:translate-x-0.5 transition-transform dark:text-neutral-300" />
            </NavLink>
            <button type="button" onClick={openContractModal} className="w-full flex items-center gap-3 rounded-2xl py-3 text-left apple-body group">
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
          <h2 id="quick-actions-title" className="liquid-section-title apple-title2 apple-strong">Dành cho bạn</h2>
          <NavLink to="/utilities" className="apple-callout font-medium kit-text-secondary inline-flex items-center gap-1">Tất cả tiện ích <ChevronRight size={14} /></NavLink>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {quickActions.map(({ label, subtitle, Icon, onClick, color }) => <button key={label} type="button" onClick={onClick} className="kit-inset kit-quick-action rounded-[20px] p-3.5 sm:p-4 text-left group flex items-center gap-3 transition-colors">
            <span className={cn('h-11 w-11 shrink-0 flex items-center justify-center', color)}><Icon size={48} /></span>
            <span className="min-w-0 flex-1"><span className="block apple-headline kit-text-primary">{label}</span><span className="block apple-callout mt-1 kit-text-secondary">{subtitle}</span></span>
            <ChevronRight size={14} className="hidden sm:block shrink-0 text-neutral-600 dark:text-neutral-300" />
          </button>)}
        </div>
      </section>

      <section className="liquid-panel p-5 sm:p-7" aria-labelledby="notifications-title">
        <div className="flex items-center gap-3 mb-5">
          <span className="glass-icon h-10 w-10 rounded-[15px] text-neutral-700 dark:text-neutral-300"><IconNotification3D size={44} /></span>
          <div><h2 id="notifications-title" className="liquid-section-title apple-title2 apple-strong">Thông báo mới nhất</h2><p className="apple-callout kit-text-secondary mt-0.5">Cập nhật từ ban quản lý</p></div>
          {notifications.some(item => item.unread) && <span className="ml-auto h-2 w-2 rounded-full bg-neutral-500" aria-label="Có thông báo chưa đọc" />}
        </div>
        {notifications.length ? <div className="grid md:grid-cols-2 gap-3">
          {notifications.slice(0, 2).map(item => <button type="button" key={item.id} onClick={() => openNotificationModal(item)} className="kit-inset rounded-[20px] p-4 text-left flex items-start gap-3 group">
            <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', item.unread ? 'bg-neutral-500' : 'bg-neutral-300 dark:bg-neutral-600')} />
            <span className="min-w-0 flex-1"><span className="block apple-headline kit-text-primary line-clamp-2">{item.title}</span><span className="block mt-1.5 apple-callout kit-text-secondary line-clamp-2">{item.desc}</span><span className="block mt-3 apple-subheadline kit-text-secondary">{item.time}</span></span>
            <ChevronRight size={16} className="mt-1 text-neutral-600 shrink-0 dark:text-neutral-300" />
          </button>)}
        </div> : <div className="kit-inset rounded-[20px] px-5 py-6 flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
          <Sparkles size={23} strokeWidth={1.5} className="text-neutral-600 dark:text-neutral-300" />
          <div><p className="apple-body font-medium kit-text-primary">Bạn đã cập nhật mọi thứ.</p><p className="apple-callout kit-text-secondary mt-1">Thông báo mới từ ban quản lý sẽ xuất hiện tại đây.</p></div>
        </div>}
      </section>
    </div>
  );
}
