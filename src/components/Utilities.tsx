import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronRight, Compass, FileText, House, KeyRound, ReceiptText, ShieldCheck, UserRound, WashingMachine, X } from 'lucide-react';
import { IconWallet3D, IconContract3D, IconProfile3D, IconGuide3D, IconLaundry3D, IconHome3D, IconKey3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { UtilityDetailModal, UtilityModalType } from './UtilityDetailModal';

export function Utilities() {
  const navigate = useNavigate();
  const { profile, invoices, openContractModal, openProfileEditModal, openTourGuide } = useApp();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isAccountGuideOpen, setIsAccountGuideOpen] = useState(false);
  const [activeModalType, setActiveModalType] = useState<UtilityModalType>(null);
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  const utilitiesList = [
    { id: 'invoices', title: 'Hóa đơn & thanh toán', desc: unpaidCount > 0 ? `${unpaidCount} hóa đơn cần thanh toán` : 'Theo dõi chi phí và lịch sử thanh toán', Icon: IconWallet3D, color: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300', action: () => navigate('/invoices') },
    { id: 'contract', title: 'Hợp đồng thuê phòng', desc: 'Văn bản và thông tin lưu trú', Icon: IconContract3D, color: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300', action: openContractModal },
    { id: 'profile', title: 'Thông tin cá nhân', desc: 'Hồ sơ, phương tiện và liên hệ', Icon: IconProfile3D, color: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300', action: openProfileEditModal },
    { id: 'account_guide', title: 'Tài khoản & trợ giúp', desc: 'Mật khẩu và hướng dẫn sử dụng', Icon: IconGuide3D, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300', action: () => setIsAccountGuideOpen(true) },
  ];

  return (
    <div className="space-y-7 sm:space-y-9 pt-2">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="liquid-eyebrow mb-2">CUỘC SỐNG THUẬN TIỆN HƠN</p>
          <h1 className="text-[29px] sm:text-[36px] font-semibold tracking-[-0.045em] leading-tight text-neutral-950 dark:text-white">Tiện ích<span className="text-neutral-500">.</span></h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">Một chạm cho những điều thường ngày.</p>
        </div>
        <div className="liquid-panel-subtle rounded-full hidden sm:flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-200"><House size={16} strokeWidth={1.7} />{profile.room.roomNumber || 'Phòng của bạn'}</div>
      </header>

      <section data-tutorial="utilities-grid" className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">
        <button type="button" onClick={() => navigate('/laundry')} className="lg:col-span-2 liquid-panel p-6 sm:p-8 relative overflow-hidden text-left group flex flex-col justify-between min-h-[290px]">
          <div aria-hidden="true" className="absolute w-64 h-64 -right-24 -top-20 rounded-full bg-neutral-300/25 dark:bg-neutral-500/10 blur-3xl" />
          <div className="relative flex items-center justify-between"><span className="liquid-chip inline-flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300"><span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />Dịch vụ cư dân</span><ArrowUpRight size={20} className="text-neutral-400 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" /></div>
          <div className="relative mt-8 mb-7 flex items-center gap-5">
            <div className="glass-icon h-20 w-20 rounded-[27px] text-neutral-700 dark:text-neutral-300 shrink-0"><IconLaundry3D size={80} /></div>
            <div><h2 className="text-[27px] font-semibold tracking-[-0.04em] text-neutral-900 dark:text-white">Giặt sạch.<br />Sống nhẹ.</h2></div>
          </div>
          <div className="relative"><p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">Xem máy giặt, máy sấy và đặt lịch ngay trong ứng dụng.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Khám phá giặt sấy <ChevronRight size={16} /></span></div>
        </button>

        <div className="lg:col-span-3 liquid-panel p-2 sm:p-3">
          <div className="px-4 pt-3 pb-2"><h2 className="liquid-eyebrow">PHÒNG THUÊ & TÀI KHOẢN</h2></div>
          {utilitiesList.map(({ id, title, desc, Icon, color, action }) => <button key={id} type="button" onClick={action} className="w-full flex items-center gap-3 sm:gap-4 p-4 rounded-[22px] text-left hover:bg-white/55 dark:hover:bg-white/5 transition-colors group">
            <span className={`h-14 w-14 flex items-center justify-center shrink-0`}><Icon size={56} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</span><span className="block mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{desc}</span></span>
            <ChevronRight size={17} className="text-neutral-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </button>)}
        </div>
      </section>

      <button type="button" onClick={openTourGuide} className="liquid-panel-subtle rounded-[26px] p-5 sm:p-6 w-full flex items-center gap-4 text-left group">
        <span className="glass-icon h-11 w-11 rounded-2xl shrink-0 text-neutral-600 dark:text-neutral-300"><IconGuide3D size={48} /></span>
        <span className="flex-1"><span className="block text-sm font-semibold text-neutral-800 dark:text-neutral-100">Lần đầu dùng Trọ-Hub?</span><span className="block mt-1 text-xs text-neutral-500 dark:text-neutral-400">Khám phá nhanh các tính năng dành cho bạn.</span></span>
        <ArrowUpRight size={18} className="text-neutral-400 shrink-0 group-hover:text-neutral-500 transition-colors" />
      </button>

      {isAccountGuideOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-neutral-950/30 backdrop-blur-md" onClick={() => setIsAccountGuideOpen(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="account-guide-title" className="liquid-panel w-full max-w-md p-5 sm:p-7 space-y-5" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-4"><div><span className="liquid-eyebrow">DÀNH RIÊNG CHO BẠN</span><h2 id="account-guide-title" className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white mt-2">Tài khoản & trợ giúp</h2></div><button autoFocus type="button" aria-label="Đóng" onClick={() => setIsAccountGuideOpen(false)} className="soft-button h-10 w-10 flex items-center justify-center shrink-0"><X size={18} /></button></div>
          <div className="space-y-2">
            <button type="button" onClick={() => { setIsAccountGuideOpen(false); setIsPasswordModalOpen(true); }} className="liquid-panel-subtle rounded-[20px] p-4 w-full flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-amber-500/10 text-amber-600 dark:text-amber-300 shrink-0"><IconKey3D size={40} /></span><span className="flex-1"><span className="text-sm font-semibold text-neutral-900 dark:text-white block">Đổi mật khẩu</span><span className="text-xs text-neutral-500 dark:text-neutral-400 block mt-1">Quản lý mật khẩu tài khoản</span></span><ChevronRight size={17} className="text-neutral-400" /></button>
            <button type="button" onClick={() => { setIsAccountGuideOpen(false); openTourGuide(); }} className="liquid-panel-subtle rounded-[20px] p-4 w-full flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-neutral-500/10 text-neutral-600 dark:text-neutral-300 shrink-0"><IconGuide3D size={40} /></span><span className="flex-1"><span className="text-sm font-semibold text-neutral-900 dark:text-white block">Hướng dẫn sử dụng</span><span className="text-xs text-neutral-500 dark:text-neutral-400 block mt-1">Làm quen với không gian cư dân</span></span><ChevronRight size={17} className="text-neutral-400" /></button>
          </div>
        </div>
      </div>}
      <PasswordUpdateModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
      <UtilityDetailModal type={activeModalType} isOpen={Boolean(activeModalType)} onClose={() => setActiveModalType(null)} onOpenContract={openContractModal} />
    </div>
  );
}
