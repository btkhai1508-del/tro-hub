import React, { useState } from 'react';
import '../styles/resident-tahoe.css';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, CheckCircle2, ChevronRight, Clock3, CreditCard, LockKeyhole } from './AppIcons';
import { IconHome3D, IconWallet3D, IconContract3D, IconVehicle3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

export function Home() {
  const navigate = useNavigate();
  const [isRoomOpen, setIsRoomOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const { profile, invoices, openInvoiceDetailModal, openContractModal, paymentGateStatus } = useApp();
  const currentInvoice = invoices[0];
  const isPaid = currentInvoice?.status === 'paid';
  const isPending = currentInvoice?.status === 'pending';
  const isUnpaid = currentInvoice?.status === 'unpaid';
  const room = profile.room.roomNumber || 'Chưa cập nhật';
  const firstName = profile.name.trim().split(/\s+/).pop();

  return (
    <div className="kit-page resident-home">
      <header data-tutorial="resident-welcome" className="kit-page-header">
        {/* On mobile: "Phòng của bạn" placed ABOVE the "Xin chào" card */}
        <div className="sm:hidden mb-2 flex items-center justify-start">
          <div className="kit-inset inline-flex items-center gap-2 px-3 py-1.5 rounded-full">
            <span className="glass-icon h-5 w-5 rounded-md text-neutral-700 dark:text-neutral-300 icon-plate flex items-center justify-center">
              <IconHome3D size={22} />
            </span>
            <span className="apple-caption font-medium kit-text-secondary">
              Phòng của bạn: <strong className="kit-text-primary font-bold ml-1">{room}</strong>
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="kit-page-kicker">Trang chủ</p>
          <h1 className="kit-page-title apple-large-title apple-strong">
            Xin chào{firstName ? `, ${firstName}` : ''}<span className="text-neutral-950 dark:text-white">.</span>
          </h1>
          <p className="kit-page-description apple-body kit-text-secondary">Thông tin phòng, hóa đơn và tiện ích của bạn.</p>
        </div>
        <div className="kit-inset hidden sm:flex items-center gap-3 px-3.5 py-2.5 rounded-[20px] shrink-0">
          <span className="glass-icon h-10 w-10 rounded-2xl text-neutral-700 dark:text-neutral-300 icon-plate"><IconHome3D size={44} /></span>
          <div>
            <span className="block apple-callout font-medium kit-text-secondary">Phòng của bạn</span>
            <span className="apple-headline kit-text-primary">{room}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div data-tutorial="billing-card" className="liquid-panel relative overflow-hidden p-4 sm:p-7 lg:col-span-8">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="glass-icon h-11 w-11 rounded-[16px] text-neutral-700 dark:text-neutral-300 icon-plate"><IconWallet3D size={48} /></span>
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

            <div className="py-5 sm:py-9">
              <p className="apple-body kit-text-secondary mb-2">{!currentInvoice ? 'Chưa có hóa đơn' : isPaid ? 'Số tiền đã thanh toán' : isPending ? 'Số tiền chờ xác nhận' : 'Số tiền cần thanh toán'}</p>
              {currentInvoice ? <div className="flex items-baseline gap-2 text-neutral-950 dark:text-white">
                <span className="apple-amount font-num">{currentInvoice.total.toLocaleString('vi-VN')}</span>
                <span className="apple-title2 font-normal kit-text-secondary">₫</span>
              </div> : <h3 className="apple-title1 apple-strong kit-text-primary">Một nơi để theo dõi<br />mọi khoản phí.</h3>}
              <p className="mt-3 flex flex-wrap items-center gap-1.5 apple-callout kit-text-secondary">
                {currentInvoice ? <><Clock3 size={13} /> Hạn thanh toán: <span className="font-medium text-neutral-700 dark:text-neutral-200">{currentInvoice.dueDate || 'Chưa cập nhật'}</span></> : 'Hóa đơn sẽ xuất hiện tại đây khi được phát hành.'}
              </p>
            </div>

            <div data-tutorial="billing-pay-btn" className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 border-t border-neutral-900/[0.06] dark:border-white/[0.08] pt-5">
              {isUnpaid && <button type="button" onClick={() => navigate(`/payment?invoiceId=${currentInvoice.id}`)} className="primary-button min-h-12 px-5 flex items-center justify-center gap-2 text-sm w-full sm:w-auto font-semibold cursor-pointer active:scale-98">
                {paymentGateStatus === 'STOP' ? <LockKeyhole size={16} /> : <CreditCard size={16} />}
                {paymentGateStatus === 'STOP' ? 'Thông tin thanh toán' : 'Thanh toán ngay'}
                <ArrowUpRight size={16} />
              </button>}
              <button type="button" onClick={() => currentInvoice ? openInvoiceDetailModal(currentInvoice) : navigate('/invoices')} className="soft-button min-h-12 px-5 inline-flex items-center justify-center gap-2 apple-control kit-text-primary w-full sm:w-auto font-semibold cursor-pointer active:scale-98">
                {currentInvoice ? 'Xem hóa đơn' : 'Đến mục hóa đơn'}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <details className="resident-disclosure resident-room-panel lg:col-span-4 liquid-panel p-4 sm:p-6" open={isRoomOpen} onToggle={event => setIsRoomOpen(event.currentTarget.open)}>
          <summary className="resident-disclosure-summary min-h-12 gap-3">
            <IconHome3D size={44} />
            <span className="min-w-0 flex-1"><span className="block apple-callout kit-text-secondary">Phòng của bạn</span><span className="block apple-title2 apple-strong kit-text-primary break-words">{room}</span></span>
            <ChevronRight size={20} className="resident-disclosure-chevron shrink-0" />
          </summary>
          <div className="resident-detail-body mt-4">
            <p className="apple-body kit-text-secondary break-words">{profile.room.building || 'Thông tin phòng'}{profile.room.floor ? ` · ${profile.room.floor}` : ''}</p>
            <div className="mt-4 divide-y divide-black/[0.07] dark:divide-white/10 border-t border-neutral-900/[0.06] dark:border-white/[0.08]">
              <NavLink to="/profile" className="flex min-h-14 items-center gap-3 rounded-2xl py-3 apple-body group">
                <IconVehicle3D size={32} />
                <span className="text-neutral-700 dark:text-neutral-200">Biển số xe</span>
                <span className="ml-auto min-w-0 break-words font-medium kit-text-primary text-right">{profile.vehicle.plateNumber || 'Chưa cập nhật'}</span>
                <ChevronRight size={15} className="shrink-0" />
              </NavLink>
              <button type="button" onClick={openContractModal} className="w-full flex min-h-14 items-center gap-3 rounded-2xl py-3 text-left apple-body group">
                <IconContract3D size={32} />
                <span className="flex-1 kit-text-primary">Hợp đồng thuê</span>
                <span className="apple-callout kit-text-secondary">Xem chi tiết</span>
                <ChevronRight size={15} className="shrink-0" />
              </button>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
