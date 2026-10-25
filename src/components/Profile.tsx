import React, { useState } from 'react';
import { Bike, ChevronRight, ContactRound, Edit3, FileText, House, KeyRound, LogOut, Moon, Settings2, Sun, Sunrise, UserRound } from 'lucide-react';
import { IconProfile3D, IconHome3D, IconVehicle3D, IconSupport3D, IconSettings3D, IconContract3D, IconKey3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { cn } from '../lib/utils';

function ProfileField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="kit-profile-field min-w-0 border-b border-black/[0.06] py-3.5 dark:border-white/[0.08]">
      <dt className="text-xs font-medium text-neutral-700 dark:text-neutral-200">{label}</dt>
      <dd className={cn('mt-1.5 break-words text-sm leading-relaxed', value?.trim() ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-700 dark:text-neutral-200')}>
        {value?.trim() || 'Chưa cập nhật'}
      </dd>
    </div>
  );
}

function ProfileSection({ icon: Icon, title, children }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; children: React.ReactNode }) {
  return (
    <section className="liquid-panel px-5 py-2 sm:px-6">
      <div className="flex items-center gap-2.5 border-b border-neutral-200/50 py-4 dark:border-white/10">
        <span className="glass-icon h-9 w-9 text-neutral-700 dark:text-neutral-200"><Icon size={44} /></span>
        <h2 className="kit-card-heading">{title}</h2>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 pb-2 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export function Profile() {
  const { profile, openProfileEditModal, openContractModal, logoutUser } = useApp();
  const { mode, setMode } = useTheme();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const initials = profile.name.trim().split(/\s+/).slice(-2).map(part => part.charAt(0)).join('').toUpperCase() || 'TH';
  const roomLabel = profile.room.roomNumber ? `Phòng ${profile.room.roomNumber.replace(/^P\.\s*/i, '')}` : 'Chưa xếp phòng';

  return (
    <div className="kit-page mx-auto max-w-5xl pb-6">
      <header className="kit-page-header">
        <div><p className="kit-page-kicker">Tài khoản</p>
        <h1 className="kit-page-title">Hồ sơ của bạn</h1>
        <p className="kit-page-description">Thông tin cư trú và những tùy chỉnh dành riêng cho bạn.</p></div>
      </header>

      <section data-tutorial="profile-id-card" aria-label="Hồ sơ cư dân" className="liquid-panel relative overflow-hidden p-5 sm:p-7">
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            {profile.avatar && !profile.avatar.includes('unsplash.com') ? (
              <img src={profile.avatar} alt={profile.name || 'Ảnh đại diện'} className="h-20 w-20 shrink-0 rounded-[26px] object-cover ring-4 ring-white/60 shadow-lg dark:ring-white/10" />
            ) : (
              <div aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] bg-white/50 dark:bg-white/5 text-2xl font-semibold tracking-tight shadow-sm ring-4 ring-white/60 dark:ring-white/10"><IconProfile3D size={76} /></div>
            )}
            <div className="min-w-0">
              <span className="liquid-chip mb-2 inline-flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300"><House size={12} />Cư dân Trọ-Hub</span>
              <h2 className="break-words text-xl font-semibold tracking-tight text-neutral-900 dark:text-white sm:text-2xl">{profile.name || 'Hồ sơ cư dân'}</h2>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{roomLabel}{profile.room.building ? ` · ${profile.room.building}` : ''}</p>
            </div>
          </div>
          <button type="button" onClick={openProfileEditModal} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 self-start px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 sm:self-center"><Edit3 size={16} />Chỉnh sửa hồ sơ</button>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <ProfileSection icon={IconProfile3D} title="Thông tin cá nhân">
            <ProfileField label="Họ và tên" value={profile.name} />
            <ProfileField label="Số điện thoại" value={profile.phone} />
            <ProfileField label="Email" value={profile.email} />
            <ProfileField label="CCCD / Hộ chiếu" value={profile.cccd} />
            <ProfileField label="Ngày sinh" value={profile.dob} />
            <ProfileField label="Địa chỉ thường trú" value={profile.address} />
          </ProfileSection>
          <ProfileSection icon={IconHome3D} title="Không gian sống">
            <ProfileField label="Phòng đang thuê" value={profile.room.roomNumber ? roomLabel : ''} />
            <ProfileField label="Khu nhà" value={profile.room.building} />
            <ProfileField label="Ngày bắt đầu thuê" value={profile.room.startDate} />
            <ProfileField label="Tầng" value={profile.room.floor} />
          </ProfileSection>
          <ProfileSection icon={IconVehicle3D} title="Phương tiện đã đăng ký">
            <ProfileField label="Biển số xe" value={profile.vehicle.plateNumber} />
            <ProfileField label="Loại phương tiện" value={profile.vehicle.type} />
          </ProfileSection>
          <ProfileSection icon={IconSupport3D} title="Liên hệ khẩn cấp">
            <ProfileField label="Họ và tên" value={profile.emergencyContact.name} />
            <ProfileField label="Mối quan hệ" value={profile.emergencyContact.relationship} />
            <ProfileField label="Số điện thoại" value={profile.emergencyContact.phone} />
          </ProfileSection>
        </div>

        <div className="space-y-5">
          <section className="liquid-panel p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="glass-icon h-9 w-9 text-neutral-700 dark:text-neutral-200"><IconSettings3D size={44} /></span>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Giao diện</h2>
            </div>
            <div role="group" aria-label="Chế độ giao diện" className="kit-segmented flex gap-1">
              {([{ value: 'light', label: 'Sáng', icon: Sun }, { value: 'dark', label: 'Tối', icon: Moon }, { value: 'auto', label: 'Tự động', icon: Sunrise }] as const).map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={cn('kit-segment min-h-16 min-w-0 flex-1 flex-col gap-1.5 px-1 py-2 text-xs', mode === value && 'kit-segment-active')}><Icon size={18} strokeWidth={1.7} />{label}</button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-700 dark:text-neutral-200">{mode === 'auto' ? 'Tự chuyển sáng và tối theo thời gian trong ngày.' : mode === 'dark' ? 'Dịu mắt trong không gian thiếu sáng.' : 'Trong trẻo, rõ ràng trong từng chi tiết.'}</p>
          </section>

          <section className="liquid-panel overflow-hidden p-2" aria-label="Tài khoản và tài liệu">
            <button type="button" onClick={openContractModal} className="kit-list-row flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-neutral-500/5">
              <span className="glass-icon h-9 w-9 shrink-0 text-neutral-700 dark:text-neutral-200"><IconContract3D size={40} /></span><span className="flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">Hợp đồng thuê phòng</span><ChevronRight size={16} className="text-neutral-600 dark:text-neutral-300" />
            </button>
            <div className="mx-3 border-t border-neutral-200/50 dark:border-white/10" />
            <button type="button" onClick={() => setIsPasswordModalOpen(true)} className="kit-list-row flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-neutral-500/5">
              <span className="glass-icon h-9 w-9 shrink-0 text-neutral-700 dark:text-neutral-200"><IconKey3D size={40} /></span><span className="flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">Đổi mật khẩu</span><ChevronRight size={16} className="text-neutral-600 dark:text-neutral-300" />
            </button>
          </section>
          <button type="button" onClick={logoutUser} className="liquid-panel-subtle flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-500/5 dark:text-rose-400"><LogOut size={17} />Đăng xuất</button>
        </div>
      </div>
      <PasswordUpdateModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </div>
  );
}
