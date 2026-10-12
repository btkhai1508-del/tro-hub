import React, { useState } from 'react';
import { 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Bike, 
  Building, 
  Calendar, 
  CreditCard, 
  Edit3, 
  PhoneCall, 
  ShieldAlert, 
  LogOut,
  Sun,
  Moon,
  Sparkles,
  Palette,
  KeyRound
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { GlassIconProfile, GlassIconLocation, GlassIconHome, GlassIconMoon } from './GlassIcons';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { cn } from '../lib/utils';
import { followOA, openChat } from 'zmp-sdk/apis';
import { isZaloMiniApp } from '../lib/platform';

export function Profile() {
  const { profile, openProfileEditModal, openContractModal, logoutUser, openTourGuide } = useApp();
  const { mode, isDark, setMode } = useTheme();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const renderValue = (val?: string) => {
    if (!val || !val.trim()) {
      return <span className="text-slate-400 font-normal italic text-xs">(Chưa cập nhật)</span>;
    }
    return val;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
      
      {/* Header */}
      <div>
        <span className="type-label text-slate-400">Tài khoản & Cá nhân</span>
        <h1 className="type-h1 text-slate-900 dark:text-white mt-1 font-bold">Hồ sơ cư dân</h1>
        <p className="type-body text-slate-500 dark:text-slate-400 mt-1">
          Thông tin hợp đồng, thông tin định danh và phương tiện đã đăng ký với ban quản lý.
        </p>
      </div>

      {/* Main Profile Identity Card */}
      <div className="soft-card p-6 sm:p-8 space-y-7">
        
        {/* Top Info Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div data-tutorial="profile-id-card" className="flex items-center gap-4">
            <div className="relative">
              <img 
                src={profile.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'} 
                alt={profile.name} 
                className="w-18 h-18 sm:w-20 sm:h-20 rounded-3xl object-cover ring-4 ring-white dark:ring-slate-800 shadow-md"
              />
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-800 flex items-center justify-center text-white text-[10px]" title="Đang cư trú">
                ✓
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{profile.name}</h2>
                <span className="badge-paid text-[10px] py-0.5">Cư dân chính</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-num mt-0.5">
                {profile.room.roomNumber ? `Phòng ${profile.room.roomNumber}` : <span className="italic text-slate-400">Chưa xếp phòng</span>}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:self-center">
            <button 
              type="button"
              onClick={() => setIsPasswordModalOpen(true)}
              className="soft-button flex items-center gap-1.5 text-slate-800 dark:text-slate-200 text-xs sm:text-sm py-2 px-3 shadow-xs cursor-pointer font-semibold"
              title="Đổi mật khẩu tài khoản"
            >
              <KeyRound size={15} />
              <span>Đổi mật khẩu</span>
            </button>

            <button 
              type="button"
              onClick={openProfileEditModal}
              className="soft-button flex items-center gap-2 text-slate-900 text-xs sm:text-sm py-2 px-3.5 shadow-xs cursor-pointer font-semibold"
            >
              <Edit3 size={15} />
              <span>Chỉnh sửa</span>
            </button>

            <button 
              type="button"
              onClick={logoutUser}
              className="flex items-center gap-1.5 py-2 px-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer border border-rose-200/60"
              title="Đăng xuất khỏi tài khoản"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>

        {/* Section 1: Thông tin cá nhân & định danh */}
        <div className="space-y-3.5">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-200">
            <GlassIconProfile size={22} className="shrink-0" />
            <span>Thông tin cá nhân & định danh</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-white/60 dark:bg-slate-800/60 p-5 sm:p-6 rounded-2xl border border-white/90 dark:border-slate-700/80 shadow-[inset_1px_1px_3px_rgba(255,255,255,0.8),2px_2px_8px_rgba(166,175,195,0.08)] dark:shadow-none">
            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Họ và tên:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block">{profile.name}</span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Số điện thoại:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-num text-sm sm:text-base mt-1 block">{profile.phone}</span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Email liên hệ:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block truncate">{renderValue(profile.email)}</span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Số CCCD / Hộ chiếu:</span>
              <span className="font-bold font-num text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block">{renderValue(profile.cccd)}</span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Ngày sinh:</span>
              <span className="font-bold font-num text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block">{renderValue(profile.dob)}</span>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Địa chỉ thường trú:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100 text-xs sm:text-sm mt-1 block leading-relaxed">{renderValue(profile.address)}</span>
            </div>
          </div>
        </div>

        {/* Section 2: Phương tiện */}
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-200">
            <GlassIconLocation size={22} className="shrink-0" />
            <span>Phương tiện đã đăng ký</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white/60 dark:bg-slate-800/60 p-5 sm:p-6 rounded-2xl border border-white/90 dark:border-slate-700/80 shadow-[inset_1px_1px_3px_rgba(255,255,255,0.8),2px_2px_8px_rgba(166,175,195,0.08)] dark:shadow-none">
            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Biển số xe:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block font-num">
                {renderValue(profile.vehicle.plateNumber)}
              </span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Loại phương tiện:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block">{renderValue(profile.vehicle.type)}</span>
            </div>
          </div>
        </div>

        {/* Section 3: Căn hộ đang thuê */}
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-200">
            <GlassIconHome size={22} className="shrink-0" />
            <span>Căn hộ đang thuê</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white/60 dark:bg-slate-800/60 p-5 sm:p-6 rounded-2xl border border-white/90 dark:border-slate-700/80 shadow-[inset_1px_1px_3px_rgba(255,255,255,0.8),2px_2px_8px_rgba(166,175,195,0.08)] dark:shadow-none">
            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Phòng:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-num text-sm sm:text-base mt-1 block">
                {profile.room.roomNumber ? `Phòng ${profile.room.roomNumber}` : renderValue('')}
              </span>
            </div>

            <div>
              <span className="text-slate-400 dark:text-slate-400 block text-xs sm:text-[13px] font-medium">Ngày bắt đầu thuê:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-num text-sm sm:text-base mt-1 block">{renderValue(profile.room.startDate)}</span>
            </div>
          </div>
        </div>

        {/* Section 4: Liên hệ khẩn cấp */}
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-500 dark:text-slate-300">
            <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50">
              <ShieldAlert size={16} />
            </div>
            <span>Người liên hệ trong trường hợp khẩn cấp</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white/60 dark:bg-slate-800/60 p-5 sm:p-6 rounded-2xl border border-white/90 dark:border-slate-700/80 shadow-[inset_1px_1px_3px_rgba(255,255,255,0.8),2px_2px_8px_rgba(166,175,195,0.08)] dark:shadow-none">
            <div>
              <span className="text-slate-400 block text-xs sm:text-[13px] font-medium">Họ và tên:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base mt-1 block">{renderValue(profile.emergencyContact.name)}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-xs sm:text-[13px] font-medium">Mối quan hệ:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm sm:text-base mt-1 block">{renderValue(profile.emergencyContact.relationship)}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-xs sm:text-[13px] font-medium">Số điện thoại khẩn:</span>
              <span className="font-bold font-num text-rose-600 dark:text-rose-400 text-sm sm:text-base mt-1 block">{renderValue(profile.emergencyContact.phone)}</span>
            </div>
          </div>
        </div>

        {/* Section 5: Giao diện & Chế độ sáng tối */}
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300">
            <Palette size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Chế độ hiển thị giao diện</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Chế độ sáng */}
            <button
              type="button"
              onClick={() => setMode('light')}
              className={cn(
                "p-4 rounded-2xl border flex items-center gap-3.5 transition-all text-left cursor-pointer",
                mode === 'light'
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-900 dark:text-amber-200 shadow-sm ring-2 ring-amber-500/30"
                  : "bg-white/60 dark:bg-slate-800/60 border-white/90 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
              )}
            >
              <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
                <Sun size={20} />
              </div>
              <div>
                <span className="text-sm font-bold block">Chế độ sáng</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Ban ngày / Nền sáng rõ</span>
              </div>
            </button>

            {/* Chế độ tối */}
            <button
              type="button"
              onClick={() => setMode('dark')}
              className={cn(
                "p-4 rounded-2xl border flex items-center gap-3.5 transition-all text-left cursor-pointer",
                mode === 'dark'
                  ? "bg-indigo-500/15 border-indigo-500/50 text-indigo-900 dark:text-indigo-200 shadow-sm ring-2 ring-indigo-500/30"
                  : "bg-white/60 dark:bg-slate-800/60 border-white/90 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
              )}
            >
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 shadow-xs">
                <Moon size={20} />
              </div>
              <div>
                <span className="text-sm font-bold block">Chế độ tối</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Dịu mắt / Đêm tối</span>
              </div>
            </button>

            {/* Tự động */}
            <button
              type="button"
              onClick={() => setMode('auto')}
              className={cn(
                "p-4 rounded-2xl border flex items-center gap-3.5 transition-all text-left cursor-pointer",
                mode === 'auto'
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200 shadow-sm ring-2 ring-emerald-500/30"
                  : "bg-white/60 dark:bg-slate-800/60 border-white/90 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
              )}
            >
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
                <GlassIconMoon size={22} />
              </div>
              <div>
                <span className="text-sm font-bold block">Tự động</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Theo thời gian thực</span>
              </div>
            </button>
          </div>
        </div>

        {/* Section 6: Tiện ích Zalo Official Account & Hỗ trợ */}
        <div data-tutorial="profile-zalo-section" className="space-y-3.5 pt-2 border-t border-slate-100/90">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300">
            <div className="w-5 h-5 rounded-md bg-[#0068FF] text-white flex items-center justify-center text-[10px] font-black">Z</div>
            <span>Tiện ích Zalo & Hỗ trợ cư dân</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                try {
                  followOA({
                    id: "61954560911870422",
                    success: () => alert('Đã gửi yêu cầu quan tâm Official Account EcoStay!'),
                    fail: (err: any) => console.log('followOA:', err)
                  });
                } catch {
                  window.open('https://zalo.me', '_blank');
                }
              }}
              className="p-3.5 rounded-2xl bg-[#0068FF]/5 hover:bg-[#0068FF]/10 border border-[#0068FF]/20 text-slate-800 dark:text-slate-200 flex items-center gap-3 transition-all cursor-pointer text-left"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#0068FF] text-white flex items-center justify-center font-bold text-base shadow-xs shrink-0">
                OA
              </div>
              <div>
                <span className="text-xs sm:text-sm font-bold block text-[#0068FF] dark:text-[#3889ff]">Quan tâm Zalo OA</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Nhận thông báo hóa đơn & tin tức</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                try {
                  openChat({
                    type: 'oa',
                    id: '61954560911870422',
                    message: `Xin chào Quản lý, tôi là cư dân ${profile.name} ${profile.room?.roomNumber ? `phòng ${profile.room.roomNumber}` : ''}, cần hỗ trợ.`
                  });
                } catch {
                  window.location.href = 'tel:0909888999';
                }
              }}
              className="p-3.5 rounded-2xl bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20 text-slate-800 dark:text-slate-200 flex items-center gap-3 transition-all cursor-pointer text-left"
            >
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                💬
              </div>
              <div>
                <span className="text-xs sm:text-sm font-bold block text-emerald-600 dark:text-emerald-400">Nhắn tin cho Quản lý</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Hỗ trợ phản ánh sự cố phòng</span>
              </div>
            </button>
          </div>

          {/* Tour Guide Replay button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => openTourGuide()}
              className="w-full p-3.5 rounded-2xl bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/20 text-slate-800 dark:text-slate-200 flex items-center justify-between transition-all cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                  ✨
                </div>
                <div>
                  <span className="text-xs sm:text-sm font-bold block text-indigo-600 dark:text-indigo-400">Xem lại Tour hướng dẫn</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">Khám phá lại các tính năng chính của Trọ-Hub</span>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                Bắt đầu
              </span>
            </button>
          </div>
        </div>

      </div>

      {/* Password Update Modal */}
      <PasswordUpdateModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

    </div>
  );
}
