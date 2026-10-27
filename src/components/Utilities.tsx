import React, { useState } from 'react';
import '../styles/resident-tahoe.css';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Compass, FileText, House, KeyRound, ReceiptText, ShieldCheck, UserRound, WashingMachine, X } from './AppIcons';
import { IconWallet3D, IconContract3D, IconProfile3D, IconGuide3D, IconLaundry3D, IconHome3D, IconKey3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { UtilityDetailModal, UtilityModalType } from './UtilityDetailModal';
import { useDialogFocus } from '../lib/useDialogFocus';

export function Utilities() {
  const navigate = useNavigate();
  const { profile, invoices, openContractModal, openProfileEditModal, openTourGuide } = useApp();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isAccountGuideOpen, setIsAccountGuideOpen] = useState(false);
  const [activeModalType, setActiveModalType] = useState<UtilityModalType>(null);
  const accountGuideRef = useDialogFocus(isAccountGuideOpen, () => setIsAccountGuideOpen(false));
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  const utilitiesList = [
    { id: 'invoices', title: 'Hóa đơn & thanh toán', desc: unpaidCount > 0 ? `${unpaidCount} hóa đơn cần thanh toán` : 'Theo dõi chi phí và lịch sử thanh toán', Icon: IconWallet3D, color: 'bg-neutral-500/10 kit-text-secondary', action: () => navigate('/invoices') },
    { id: 'contract', title: 'Hợp đồng thuê phòng', desc: 'Văn bản và thông tin lưu trú', Icon: IconContract3D, color: 'bg-neutral-500/10 kit-text-secondary', action: openContractModal },
    { id: 'profile', title: 'Thông tin cá nhân', desc: 'Hồ sơ, phương tiện và liên hệ', Icon: IconProfile3D, color: 'bg-neutral-500/10 kit-text-secondary', action: openProfileEditModal },
    { id: 'account_guide', title: 'Tài khoản & trợ giúp', desc: 'Mật khẩu và hướng dẫn sử dụng', Icon: IconGuide3D, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300', action: () => setIsAccountGuideOpen(true) },
  ];

  return (
    <div className="kit-page">
      <header className="kit-page-header">
        <div>
          <p className="kit-page-kicker">Dành cho cư dân</p>
          <h1 className="kit-page-title">Tiện ích</h1>
          <p className="kit-page-description">Giặt sấy, hồ sơ và trợ giúp trong một nơi.</p>
        </div>
        <div className="kit-inset rounded-full hidden sm:flex items-center gap-2 px-4 py-2.5 apple-body font-medium kit-text-secondary"><House size={16} strokeWidth={1.7} />{profile.room.roomNumber || 'Phòng của bạn'}</div>
      </header>

      <section data-motion-list data-tutorial="utilities-grid" className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">
        <button type="button" onClick={() => navigate('/laundry')} className="lg:col-span-2 liquid-panel p-5 sm:p-7 relative overflow-hidden text-left group flex flex-col justify-between min-h-[172px] sm:min-h-[240px]">

          <div className="relative mb-3 flex items-center gap-3 sm:mt-3 sm:mb-6 sm:gap-4">
            <div className="glass-icon resident-laundry-icon h-14 w-14 sm:h-20 sm:w-20 rounded-[27px] kit-text-secondary shrink-0 icon-plate"><IconLaundry3D size={80} /></div>
            <div><p className="apple-callout font-medium kit-text-secondary mb-1.5">Tiện ích trong khu nhà</p><h2 className="apple-title1 leading-tight font-semibold tracking-[-0.035em] kit-text-primary">Giặt & sấy</h2></div>
          </div>
          <div className="relative"><p className="apple-body kit-text-secondary leading-relaxed">Xem máy giặt, máy sấy và đặt lịch ngay trong ứng dụng.</p><span className="mt-3 sm:mt-5 inline-flex items-center gap-2 apple-body font-semibold kit-text-secondary">Khám phá giặt sấy <ChevronRight size={16} /></span></div>
        </button>

        <div className="lg:col-span-3 liquid-panel p-2 sm:p-3">
          <div className="px-4 pt-3 pb-3"><h2 className="kit-card-heading">Phòng thuê & tài khoản</h2></div>
          {utilitiesList.map(({ id, title, desc, Icon, color, action }) => <button key={id} type="button" onClick={action} className="kit-list-row w-full flex min-h-20 items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-[18px] text-left hover:bg-white/55 dark:hover:bg-white/5 transition-colors group">
            <span className={`h-11 w-11 sm:h-14 sm:w-14 flex items-center justify-center shrink-0`}><Icon size={56} /></span>
            <span className="min-w-0 flex-1"><span className="block apple-body font-semibold kit-text-primary">{title}</span><span className="block mt-1 apple-callout leading-relaxed kit-text-secondary">{desc}</span></span>
            <ChevronRight size={17} className="text-neutral-600 shrink-0 group-hover:translate-x-0.5 transition-transform dark:text-neutral-300" />
          </button>)}
        </div>
      </section>


      {isAccountGuideOpen && <div className="tahoe-dialog-overlay fixed inset-0 z-[70] flex items-center justify-center p-4 bg-neutral-950/30" onClick={() => setIsAccountGuideOpen(false)}>
        <div ref={accountGuideRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-guide-title" className="tahoe-dialog kit-dialog w-full max-w-md overflow-y-auto overscroll-contain p-5 sm:p-7 space-y-5" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-4"><div><span className="apple-callout kit-text-secondary">Tài khoản cư dân</span><h2 id="account-guide-title" className="apple-title1 font-semibold tracking-tight kit-text-primary mt-2">Tài khoản & trợ giúp</h2></div><button type="button" aria-label="Đóng" onClick={() => setIsAccountGuideOpen(false)} className="soft-button h-11 w-11 flex items-center justify-center shrink-0"><X size={18} /></button></div>
          <div className="space-y-2">
            <button type="button" onClick={() => { setIsAccountGuideOpen(false); setIsPasswordModalOpen(true); }} className="liquid-panel-subtle rounded-[20px] p-4 w-full flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-amber-500/10 text-amber-600 dark:text-amber-300 shrink-0 icon-plate"><IconKey3D size={40} /></span><span className="flex-1"><span className="apple-body font-semibold kit-text-primary block">Đổi mật khẩu</span><span className="apple-callout kit-text-secondary block mt-1">Quản lý mật khẩu tài khoản</span></span><ChevronRight size={17} className="kit-text-secondary" /></button>
            <button type="button" onClick={() => { setIsAccountGuideOpen(false); openTourGuide(); }} className="liquid-panel-subtle rounded-[20px] p-4 w-full flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-neutral-500/10 kit-text-secondary shrink-0 icon-plate"><IconGuide3D size={40} /></span><span className="flex-1"><span className="apple-body font-semibold kit-text-primary block">Hướng dẫn sử dụng</span><span className="apple-callout kit-text-secondary block mt-1">Làm quen với không gian cư dân</span></span><ChevronRight size={17} className="kit-text-secondary" /></button>
          </div>
        </div>
      </div>}
      <PasswordUpdateModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
      <UtilityDetailModal type={activeModalType} isOpen={Boolean(activeModalType)} onClose={() => setActiveModalType(null)} onOpenContract={openContractModal} />
    </div>
  );
}
