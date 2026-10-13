import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { IconHome3D, IconWallet3D, IconCalendar3D, IconFigmaSecurity } from './Icons3D';
import { GlassIconHome } from './GlassIcons';
import { PasswordUpdateModal } from './PasswordUpdateModal';

export function Utilities() {
  const navigate = useNavigate();
  const { 
    profile, 
    invoices, 
    openContractModal,
    openTourGuide 
  } = useApp();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
  const unpaidCount = unpaidInvoices.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="type-label text-slate-400">Dịch vụ & Tiện ích</span>
          <h1 className="type-h1 text-slate-900 dark:text-white mt-1 font-bold">
            Tiện ích
          </h1>
          <p className="type-body text-slate-500 dark:text-slate-400 mt-1">
            Hóa đơn tiền phòng, thanh toán trực tuyến, hợp đồng thuê và dịch vụ cư dân.
          </p>
        </div>

        {/* Quick Room badge matching Home.tsx */}
        <div className="flex items-center gap-3">
          <div className="soft-card px-4 py-2 flex items-center gap-3.5">
            <GlassIconHome size={38} className="shrink-0" />
            <div>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 uppercase font-semibold block tracking-wider">Phòng của tôi</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-num">
                {profile.room.roomNumber} ({profile.room.building || 'Trung Kim'})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Monochrome / Glass 3D Square Tiles Grid */}
      <div data-tutorial="utilities-grid" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
        
        {/* 1. Hóa đơn & Tiền phòng */}
        <button
          type="button"
          onClick={() => navigate('/invoices')}
          className="group relative flex flex-col items-center text-center justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#121927] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-md hover:-translate-y-1 active:translate-y-0 transition-all duration-200 cursor-pointer min-h-[145px] sm:min-h-[155px]"
        >
          {/* Badge */}
          {unpaidCount > 0 && (
            <span className="absolute top-2.5 right-2.5 w-5 h-5 bg-rose-500 text-white text-[10px] font-bold rounded-full font-num flex items-center justify-center shadow-xs">
              {unpaidCount}
            </span>
          )}

          {/* 3D Icon Container */}
          <div className="mt-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
            <IconWallet3D size={52} className="shrink-0 drop-shadow-sm" />
          </div>

          {/* Text Content */}
          <div className="w-full mt-2.5">
            <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
              Hóa đơn & Tiền phòng
            </h3>
            <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 leading-snug">
              {invoices.length === 0 ? 'Đang cập nhật' : (unpaidCount > 0 ? `${unpaidCount} hóa đơn cần đóng` : 'Đã thanh toán')}
            </p>
          </div>
        </button>

        {/* 2. Hợp đồng thuê phòng */}
        <button
          type="button"
          onClick={() => openContractModal()}
          className="group relative flex flex-col items-center text-center justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#121927] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-md hover:-translate-y-1 active:translate-y-0 transition-all duration-200 cursor-pointer min-h-[145px] sm:min-h-[155px]"
        >
          {/* Badge */}
          <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-num shadow-2xs">
            Hiệu lực
          </span>

          {/* 3D Icon Container */}
          <div className="mt-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
            <IconCalendar3D size={52} className="shrink-0 drop-shadow-sm" />
          </div>

          {/* Text Content */}
          <div className="w-full mt-2.5">
            <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
              Hợp đồng thuê phòng
            </h3>
            <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 leading-snug">
              Đang hiệu lực 12 tháng
            </p>
          </div>
        </button>

        {/* 3. Đổi mật khẩu */}
        <button
          type="button"
          onClick={() => setIsPasswordModalOpen(true)}
          className="group relative flex flex-col items-center text-center justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#121927] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-md hover:-translate-y-1 active:translate-y-0 transition-all duration-200 cursor-pointer min-h-[145px] sm:min-h-[155px]"
        >
          <div className="mt-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
            <IconFigmaSecurity size={52} className="shrink-0 drop-shadow-sm" />
          </div>

          <div className="w-full mt-2.5">
            <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
              Đổi mật khẩu
            </h3>
            <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 leading-snug">
              Bảo mật tài khoản
            </p>
          </div>
        </button>

        {/* 4. Hướng dẫn sử dụng (Tour Guide) */}
        <button
          type="button"
          onClick={() => openTourGuide()}
          className="group relative flex flex-col items-center text-center justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#121927] border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-md hover:-translate-y-1 active:translate-y-0 transition-all duration-200 cursor-pointer min-h-[145px] sm:min-h-[155px]"
        >
          <div className="mt-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
            <IconHome3D size={52} className="shrink-0 drop-shadow-sm" />
          </div>

          <div className="w-full mt-2.5">
            <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
              Hướng dẫn sử dụng
            </h3>
            <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 leading-snug">
              Tour khám phá tính năng
            </p>
          </div>
        </button>

      </div>

      {/* Password Update Modal */}
      <PasswordUpdateModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

    </div>
  );
}
