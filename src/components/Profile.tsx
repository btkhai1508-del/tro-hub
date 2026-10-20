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
  Palette,
  KeyRound,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { IconProfile3D, IconVehicle3D, IconHome3D, IconClock3D, IconSettings3D } from './Icons3D';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { soundFx, HOVER_SOUND_PRESETS, HoverSoundType } from '../lib/soundFx';
import { cn } from '../lib/utils';

export function Profile() {
  const { profile, openProfileEditModal, openContractModal, logoutUser } = useApp();
  const { mode, isDark, setMode } = useTheme();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [hoverSound, setHoverSound] = useState<HoverSoundType>(() => soundFx.getHoverType());

  const handleSelectHoverSound = (type: HoverSoundType) => {
    setHoverSound(type);
    soundFx.setHoverType(type);
  };

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
              {profile.avatar && !profile.avatar.includes('unsplash.com') ? (
                <img 
                  src={profile.avatar} 
                  alt={profile.name} 
                  className="w-18 h-18 sm:w-20 sm:h-20 rounded-3xl object-cover ring-4 ring-white dark:ring-slate-800 shadow-md"
                />
              ) : (
                <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center ring-4 ring-white dark:ring-slate-800 shadow-md">
                  <IconProfile3D size={52} />
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-800 flex items-center justify-center text-white text-[10px]" title="Đang cư trú">
                ✓
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{profile.name}</h2>
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
            <IconProfile3D size={24} className="shrink-0" />
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
            <IconVehicle3D size={28} className="shrink-0" />
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
            <IconHome3D size={26} className="shrink-0" />
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
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300">
            <IconSettings3D size={26} className="shrink-0" />
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
              <div className="shrink-0 text-amber-500 dark:text-amber-400 flex items-center justify-center">
                <Sun size={24} />
              </div>
              <span className="text-sm font-bold block">Chế độ sáng</span>
            </button>

            {/* Chế độ tối */}
            <button
              type="button"
              onClick={() => setMode('dark')}
              className={cn(
                "p-4 rounded-2xl border flex items-center gap-3.5 transition-all text-left cursor-pointer",
                mode === 'dark'
                  ? "bg-blue-500/15 border-blue-500/50 text-blue-900 dark:text-blue-200 shadow-sm ring-2 ring-blue-500/30"
                  : "bg-white/60 dark:bg-slate-800/60 border-white/90 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
              )}
            >
              <div className="shrink-0 text-blue-500 dark:text-blue-400 flex items-center justify-center">
                <Moon size={24} />
              </div>
              <span className="text-sm font-bold block">Chế độ tối</span>
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
              <div className="shrink-0 text-emerald-500 dark:text-emerald-400 flex items-center justify-center">
                <IconClock3D size={26} />
              </div>
              <span className="text-sm font-bold block">Tự động</span>
            </button>
          </div>
        </div>

        {/* Section 6: Âm thanh toggle di chuột */}
        <div className="space-y-3.5 pt-2 border-t border-slate-100/90 dark:border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300">
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">
                <Volume2 size={16} />
              </div>
              <span>Âm thanh toggle di chuột (Hover Sound)</span>
            </div>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Click để nghe thử & lưu ngay vào máy
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.values(HOVER_SOUND_PRESETS).map((preset) => {
              const isSelected = hoverSound === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectHoverSound(preset.id)}
                  className={cn(
                    "p-3.5 rounded-2xl border flex flex-col text-left transition-all cursor-pointer relative",
                    isSelected
                      ? "bg-indigo-500/10 border-indigo-500/50 text-indigo-950 dark:text-indigo-200 shadow-sm ring-2 ring-indigo-500/30"
                      : "bg-white/60 dark:bg-slate-800/60 border-white/90 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      {preset.id === 'none' ? (
                        <VolumeX size={15} className="text-slate-400 shrink-0" />
                      ) : (
                        <Volume2 size={15} className={cn("shrink-0", isSelected ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400")} />
                      )}
                      <span>{preset.label}</span>
                    </span>
                    {isSelected && (
                      <span className="text-[10px] uppercase font-black tracking-wide px-1.5 py-0.5 rounded-md bg-indigo-600 text-white shrink-0">
                        Đang chọn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                    {preset.desc}
                  </p>
                </button>
              );
            })}
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
