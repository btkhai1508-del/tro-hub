import React, { useState } from 'react';
import '../styles/resident-tahoe.css';
import { Bike, ChevronRight, ContactRound, Edit3, FileText, House, KeyRound, LogOut, Moon, Settings2, Sun, Sunrise, UserRound } from './AppIcons';
import { IconProfile3D, IconHome3D, IconVehicle3D, IconSupport3D, IconSettings3D, IconKey3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { cn } from '../lib/utils';

function ProfileField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="kit-profile-field min-w-0 border-b border-black/[0.06] py-3.5 dark:border-white/[0.08]">
      <dt className="apple-callout font-medium kit-text-secondary">{label}</dt>
      <dd className={cn('mt-1.5 break-words apple-body', value?.trim() ? 'font-medium kit-text-primary' : 'kit-text-secondary')}>
        {value?.trim() || 'Chưa cập nhật'}
      </dd>
    </div>
  );
}

function ProfileSection({ icon: Icon, title, summary, children }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; summary: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  return (
    <details className="resident-disclosure liquid-panel px-4 py-2 sm:px-6" open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)}>
      <summary className="resident-disclosure-summary min-h-16 gap-2.5 py-3">
        <span className="glass-icon h-9 w-9 icon-plate"><Icon size={44} /></span>
        <span className="min-w-0 flex-1"><span className="kit-card-heading apple-title2 apple-strong block">{title}</span><span className="apple-callout kit-text-secondary mt-1 block break-words lg:hidden">{summary}</span></span>
        <ChevronRight size={20} className="resident-disclosure-chevron shrink-0" />
      </summary>
      <dl className="resident-detail-body grid grid-cols-1 gap-x-6 border-t border-[var(--separator)] pb-2 sm:grid-cols-2">{children}</dl>
    </details>
  );
}

export function Profile() {
  const { profile, openProfileEditModal, logoutUser } = useApp();
  const { mode, setMode } = useTheme();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const initials = profile.name.trim().split(/\s+/).slice(-2).map(part => part.charAt(0)).join('').toUpperCase() || 'TH';
  const roomLabel = profile.room.roomNumber ? `Phòng ${profile.room.roomNumber.replace(/^P\.\s*/i, '')}` : 'Chưa xếp phòng';

  return (
    <div className="kit-page mx-auto max-w-5xl pb-6">
      <header className="kit-page-header">
        <div><p className="kit-page-kicker">Tài khoản</p>
        <h1 className="kit-page-title apple-large-title apple-strong">Hồ sơ của bạn</h1>
        <p className="kit-page-description apple-body kit-text-secondary">Thông tin cư trú và những tùy chỉnh dành riêng cho bạn.</p></div>
      </header>

      <section data-tutorial="profile-id-card" aria-label="Hồ sơ cư dân" className="liquid-panel relative overflow-hidden p-5 sm:p-7">
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            {profile.avatar && !profile.avatar.includes('unsplash.com') ? (
              <img src={profile.avatar} alt={profile.name || 'Ảnh đại diện'} className="h-20 w-20 shrink-0 rounded-[26px] object-cover ring-4 ring-white/60 shadow-lg dark:ring-white/10" />
            ) : (
              <div aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] bg-white/50 dark:bg-white/5 text-2xl font-semibold tracking-tight shadow-sm ring-4 ring-white/60 dark:ring-white/10 icon-plate"><IconProfile3D size={76} /></div>
            )}
            <div className="min-w-0">
              <span className="liquid-chip mb-2 inline-flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300"><House size={12} />Cư dân Trọ-Hub</span>
              <h2 className="break-words apple-title1 apple-strong kit-text-primary">{profile.name || 'Hồ sơ cư dân'}</h2>
              <p className="mt-1 apple-body kit-text-secondary">{roomLabel}{profile.room.building ? ` · ${profile.room.building}` : ''}</p>
            </div>
          </div>
          <button type="button" onClick={openProfileEditModal} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 self-start px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 sm:self-center"><Edit3 size={16} />Chỉnh sửa hồ sơ</button>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="order-2 space-y-3 lg:order-1 lg:space-y-5">
          <ProfileSection icon={IconProfile3D} title="Thông tin cá nhân" summary={profile.phone || 'Họ tên, liên hệ và giấy tờ'}>
            <ProfileField label="Họ và tên" value={profile.name} />
            <ProfileField label="Số điện thoại" value={profile.phone} />
            <ProfileField label="Email" value={profile.email} />
            <ProfileField label="CCCD / Hộ chiếu" value={profile.cccd} />
            <ProfileField label="Ngày sinh" value={profile.dob} />
            <ProfileField label="Địa chỉ thường trú" value={profile.address} />
          </ProfileSection>
          <ProfileSection icon={IconHome3D} title="Không gian sống" summary={`${roomLabel}${profile.room.floor ? ` · ${profile.room.floor}` : ''}`}>
            <ProfileField label="Phòng đang thuê" value={profile.room.roomNumber ? roomLabel : ''} />
            <ProfileField label="Khu nhà" value={profile.room.building} />
            <ProfileField label="Ngày bắt đầu thuê" value={profile.room.startDate} />
            <ProfileField label="Tầng" value={profile.room.floor} />
          </ProfileSection>
          <ProfileSection icon={IconVehicle3D} title="Phương tiện đã đăng ký" summary={profile.vehicle.plateNumber || 'Chưa cập nhật biển số xe'}>
            <ProfileField label="Biển số xe" value={profile.vehicle.plateNumber} />
            <ProfileField label="Loại phương tiện" value={profile.vehicle.type} />
          </ProfileSection>
          <ProfileSection icon={IconSupport3D} title="Liên hệ khẩn cấp" summary={profile.emergencyContact.name || 'Thêm người liên hệ khi cần'}>
            <ProfileField label="Họ và tên" value={profile.emergencyContact.name} />
            <ProfileField label="Mối quan hệ" value={profile.emergencyContact.relationship} />
            <ProfileField label="Số điện thoại" value={profile.emergencyContact.phone} />
          </ProfileSection>

          {/* Bottom Actions: Đổi mật khẩu & Đăng xuất tài khoản căn lề theo các card */}
          <div className="pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            <button
              type="button"
              onClick={() => setIsPasswordModalOpen(true)}
              className="soft-button flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold kit-text-primary cursor-pointer"
            >
              <KeyRound size={18} strokeWidth={2} />
              <span>Đổi mật khẩu</span>
            </button>

            <button
              type="button"
              onClick={logoutUser}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-300/80 bg-rose-50/70 px-6 py-3 text-sm font-bold text-rose-600 shadow-xs transition-all hover:bg-rose-100 hover:shadow-sm dark:border-rose-800/80 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/50 cursor-pointer"
            >
              <LogOut size={18} strokeWidth={2} />
              <span>Đăng xuất tài khoản</span>
            </button>
          </div>
        </div>

        <div className="order-1 space-y-4 lg:order-2 lg:space-y-5">
          <section className="liquid-panel p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="glass-icon h-9 w-9 text-neutral-700 dark:text-neutral-200 icon-plate"><IconSettings3D size={44} /></span>
              <h2 className="apple-title2 apple-strong kit-text-primary">Giao diện</h2>
            </div>
            <div role="group" aria-label="Chế độ giao diện" className="kit-segmented flex gap-1">
              {([{ value: 'light', label: 'Sáng', icon: Sun }, { value: 'dark', label: 'Tối', icon: Moon }, { value: 'auto', label: 'Tự động', icon: Sunrise }] as const).map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={cn('kit-segment min-h-16 min-w-0 flex-1 flex-col gap-1.5 px-1 py-2 text-xs', mode === value && 'kit-segment-active')}><Icon size={18} strokeWidth={1.7} />{label}</button>
              ))}
            </div>
            <p className="mt-3 hidden apple-callout kit-text-secondary sm:block">{mode === 'auto' ? 'Tự chuyển sáng và tối theo thời gian trong ngày.' : mode === 'dark' ? 'Dịu mắt trong không gian thiếu sáng.' : 'Trong trẻo, rõ ràng trong từng chi tiết.'}</p>
          </section>
        </div>
      </div>

      <PasswordUpdateModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </div>
  );
}
