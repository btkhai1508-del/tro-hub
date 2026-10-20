import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { 
  IconHome3D, 
  IconWallet3D, 
  IconContract3D,
  IconProfile3D,
  IconGuide3D,
  IconKey3D
} from './Icons3D';
import { KeyRound, Compass, X, ChevronRight, ShieldCheck, HelpCircle } from 'lucide-react';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { UtilityDetailModal, UtilityModalType } from './UtilityDetailModal';

export function Utilities() {
  const navigate = useNavigate();
  const { 
    profile, 
    invoices, 
    openContractModal,
    openProfileEditModal,
    openTourGuide 
  } = useApp();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isAccountGuideOpen, setIsAccountGuideOpen] = useState(false);
  const [activeModalType, setActiveModalType] = useState<UtilityModalType>(null);

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
  const unpaidCount = unpaidInvoices.length;

  const utilitiesList = [
    {
      id: 'invoices',
      title: 'Hóa đơn thanh toán',
      desc: unpaidCount > 0 ? `${unpaidCount} hóa đơn cần đóng` : 'Đã hoàn tất thanh toán',
      Icon: IconWallet3D,
      action: () => navigate('/invoices')
    },
    {
      id: 'contract',
      title: 'Hợp đồng thuê phòng',
      desc: 'Hợp đồng điện tử lưu trú',
      Icon: IconContract3D,
      action: () => openContractModal()
    },
    {
      id: 'profile',
      title: 'Thông tin cá nhân',
      desc: `${profile.name || 'Cư dân'} · P.${profile.room?.roomNumber || '203'}`,
      Icon: IconProfile3D,
      action: () => openProfileEditModal()
    },
    {
      id: 'account_guide',
      title: 'Tài khoản & Hướng dẫn',
      desc: 'Đổi mật khẩu & Khám phá ứng dụng',
      Icon: IconGuide3D,
      action: () => setIsAccountGuideOpen(true)
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="type-label text-slate-400">Dịch vụ & Tiện ích cư dân</span>
          <h1 className="type-h1 text-slate-900 dark:text-white mt-1 font-bold">
            Tiện ích
          </h1>
          <p className="type-body text-slate-500 dark:text-slate-400 mt-1">
            Quản lý hóa đơn thanh toán, hợp đồng, hồ sơ cá nhân và hướng dẫn sử dụng.
          </p>
        </div>

        {/* Quick Room badge matching site template */}
        <div className="flex items-center gap-3">
          <div className="soft-card px-4 py-2 flex items-center gap-3.5 border border-white/80 dark:border-white/10">
            <IconHome3D size={38} className="shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 uppercase font-semibold block tracking-wider">Phòng của tôi</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-num">
                {profile.room.roomNumber} ({profile.room.building || 'Trung Kim'})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3D Glassmorphism Utility Cards Grid (matching Home payment card elements: soft-surface, 3D glow & glass sheen) */}
      <div data-tutorial="utilities-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {utilitiesList.map((item) => {
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              className="soft-surface group relative flex flex-col items-center text-center justify-between p-6 sm:p-7 rounded-[28px] hover:-translate-y-1.5 active:translate-y-0 transition-all duration-300 cursor-pointer min-h-[185px] overflow-hidden select-none"
            >
              {/* Subtle 3D Glass top sheen reflection */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/10 to-transparent" />

              {/* 3D Icon - Direct without background box */}
              <div className="mt-2 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Icon size={58} className="shrink-0 drop-shadow-md" />
              </div>

              {/* Text Content */}
              <div className="w-full mt-3.5">
                <h3 className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white line-clamp-1 leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1 leading-snug">
                  {item.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Combined Modal: Đổi mật khẩu & Hướng dẫn sử dụng */}
      {isAccountGuideOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsAccountGuideOpen(false)}
        >
          <div 
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Tài khoản & Trợ giúp
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Bảo mật tài khoản cư dân và hướng dẫn sử dụng
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsAccountGuideOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Option 1: Đổi mật khẩu */}
              <button
                type="button"
                onClick={() => {
                  setIsAccountGuideOpen(false);
                  setIsPasswordModalOpen(true);
                }}
                className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between group transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <KeyRound size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                      Đổi mật khẩu tài khoản
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Cập nhật mật khẩu để bảo vệ thông tin cá nhân
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* Option 2: Hướng dẫn sử dụng */}
              <button
                type="button"
                onClick={() => {
                  setIsAccountGuideOpen(false);
                  openTourGuide();
                }}
                className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between group transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Compass size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      Hướng dẫn sử dụng hệ thống
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Khởi chạy tour tương tác khám phá các tính năng
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Update Modal */}
      <PasswordUpdateModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      {/* Dedicated Utility Detail Modal */}
      <UtilityDetailModal
        type={activeModalType}
        isOpen={Boolean(activeModalType)}
        onClose={() => setActiveModalType(null)}
        onOpenContract={openContractModal}
      />

    </div>
  );
}
