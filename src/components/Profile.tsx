import React, { useEffect, useState } from 'react';
import '../styles/resident-tahoe.css';
import { Camera, Check, ChevronRight, Edit3, House, KeyRound, LogOut, Moon, QrCode, Sun, Sunrise, X } from './AppIcons';
import { IconProfile3D, IconHome3D, IconVehicle3D, IconSupport3D, IconSettings3D, IconKey3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { cn, formatDobInput } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { fileToAvatarDataUrl, pickImageInZalo, usesZaloImagePicker } from '../lib/imagePicker';
import type { CccdQrData } from '../lib/cccdQr';
import { AvatarCropper } from './AvatarCropper';
import { CccdQrScanner } from './CccdQrScanner';

function ProfileField({ label, value, onChange, type = 'text', placeholder, inputMode, maxLength }: { label: string; value?: string; onChange?: (value: string) => void; type?: string; placeholder?: string; inputMode?: 'numeric'; maxLength?: number }) {
  return (
    <div className="kit-profile-field min-w-0 border-b border-black/[0.06] py-3.5 dark:border-white/[0.08]">
      <dt className="apple-callout font-medium kit-text-secondary">{onChange ? <label>{label}</label> : label}</dt>
      <dd className={cn('mt-1.5 break-words apple-body', onChange || value?.trim() ? 'font-medium kit-text-primary' : 'kit-text-secondary')}>
        {onChange
          ? <input type={type} value={value || ''} aria-label={label} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} onChange={event => onChange(event.target.value)} className="kit-field px-3" />
          : value?.trim() || 'Chưa cập nhật'}
      </dd>
    </div>
  );
}

function ProfileSection({ icon: Icon, title, summary, editing, children }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; summary: string; editing?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  return (
    <details className="resident-disclosure liquid-panel px-4 py-2 sm:px-6" open={editing || isOpen} onToggle={event => { if (!editing) setIsOpen(event.currentTarget.open); }}>
      <summary className="resident-disclosure-summary min-h-16 gap-2.5 py-3">
        <span className="glass-icon h-9 w-9 icon-plate"><Icon size={44} /></span>
        <span className="min-w-0 flex-1"><span className="kit-card-heading apple-title2 apple-strong block">{title}</span><span className="apple-callout kit-text-secondary mt-1 block break-words lg:hidden">{summary}</span></span>
        <ChevronRight size={20} className="resident-disclosure-chevron shrink-0" />
      </summary>
      <dl className="resident-detail-body grid grid-cols-1 gap-x-6 border-t border-[var(--separator)] pb-2 sm:grid-cols-2">{children}</dl>
    </details>
  );
}

// Residents only register motorbikes, so this is not editable.
const VEHICLE_TYPE = 'Xe máy';

const emptyDraft = { name: '', phone: '', email: '', cccd: '', dob: '', gender: '', address: '', avatar: '', vehicleType: '', plateNumber: '', emergencyName: '', emergencyPhone: '', emergencyRelation: '' };

export function Profile() {
  const { profile, updateProfile, isProfileEditModalOpen: isEditing, openProfileEditModal, closeProfileEditModal, logoutUser } = useApp();
  const [draft, setDraft] = useState(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

  // Start from what the card shows each time editing opens, including from the sidebar.
  useEffect(() => {
    if (!isEditing) return;
    setStatus(null);
    setDraft({
      name: profile.name || '', phone: profile.phone || '', email: profile.email || '', cccd: profile.cccd || '',
      dob: profile.dob || '', gender: profile.gender || '', address: profile.address || '', avatar: profile.avatar || '',
      vehicleType: VEHICLE_TYPE, plateNumber: profile.vehicle?.plateNumber || '',
      emergencyName: profile.emergencyContact?.name || '', emergencyPhone: profile.emergencyContact?.phone || '', emergencyRelation: profile.emergencyContact?.relationship || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const editable = (key: keyof typeof emptyDraft) => isEditing
    ? { value: draft[key], onChange: (value: string) => setDraft(prev => ({ ...prev, [key]: value })) }
    : {};
  const shownAvatar = isEditing ? draft.avatar : profile.avatar;

  const handleQrResult = (data: CccdQrData) => {
    setIsScanning(false);
    setDraft(prev => ({ ...prev, name: data.name, cccd: data.cccd, address: data.address || prev.address, dob: data.dob || prev.dob, gender: data.gender || prev.gender }));
    setStatus({ ok: true, text: 'Đã điền từ CCCD. QR không có số điện thoại nên bạn tự kiểm tra ô này, rồi bấm Lưu thay đổi.' });
  };

  const startCrop = (dataUrl: string | null) => {
    if (dataUrl) setCropSource(dataUrl);
  };
  const handleAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      startCrop(await fileToAvatarDataUrl(file));
    } catch {
      setStatus({ ok: false, text: 'Không đọc được ảnh này. Vui lòng chọn ảnh JPG hoặc PNG khác.' });
    }
  };
  const handleZaloAvatar = async (source: 'album' | 'camera') => {
    try {
      startCrop(await pickImageInZalo(source));
    } catch {
      setStatus({ ok: false, text: 'Zalo chưa được cấp quyền truy cập ảnh. Vui lòng cho phép trong cài đặt Zalo rồi thử lại.' });
    }
  };

  const handleSave = async () => {
    const clean = { ...draft, name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim(), cccd: draft.cccd.trim(), dob: draft.dob.trim(), address: draft.address.trim(), plateNumber: draft.plateNumber.trim(), vehicleType: VEHICLE_TYPE, emergencyName: draft.emergencyName.trim(), emergencyPhone: draft.emergencyPhone.trim(), emergencyRelation: draft.emergencyRelation.trim() };
    if (!clean.name) {
      setStatus({ ok: false, text: 'Vui lòng nhập họ và tên.' });
      return;
    }
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await apiFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...clean, avatar: undefined, roomNumber: profile.room.roomNumber }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = await res.json().catch(() => null);
      updateProfile({
        name: clean.name, phone: clean.phone, email: clean.email, cccd: clean.cccd, dob: clean.dob, gender: clean.gender, address: clean.address, avatar: clean.avatar,
        vehicle: { ...profile.vehicle, type: clean.vehicleType, plateNumber: clean.plateNumber },
        emergencyContact: { name: clean.emergencyName, phone: clean.emergencyPhone, relationship: clean.emergencyRelation },
      });
      closeProfileEditModal();
      setShowAvatarPicker(false);
      setStatus(saved?.sheetSynced === false ? { ok: false, text: 'Đã lưu trên ứng dụng, chưa ghi được vào Google Sheet.' } : { ok: true, text: 'Đã lưu thông tin cư dân.' });
    } catch {
      setStatus({ ok: false, text: 'Chưa lưu được hồ sơ. Vui lòng thử lại.' });
    } finally {
      setIsSaving(false);
    }
  };

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
            <div className="relative shrink-0">
            {shownAvatar && !shownAvatar.includes('unsplash.com') ? (
              <img src={shownAvatar} alt={profile.name || 'Ảnh đại diện'} className="h-20 w-20 shrink-0 rounded-[26px] object-cover ring-4 ring-white/60 shadow-lg dark:ring-white/10" />
            ) : (
              <div aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] bg-white/50 dark:bg-white/5 text-2xl font-semibold tracking-tight shadow-sm ring-4 ring-white/60 dark:ring-white/10 icon-plate"><IconProfile3D size={76} /></div>
            )}
              {isEditing && <button type="button" onClick={() => setShowAvatarPicker(open => !open)} aria-label="Đổi ảnh đại diện" title="Đổi ảnh đại diện" className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"><Camera size={15} /></button>}
            </div>
            <div className="min-w-0">
              <span className="liquid-chip mb-2 inline-flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300"><House size={12} />Cư dân Trọ-Hub</span>
              <h2 className="break-words apple-title1 apple-strong kit-text-primary">{(isEditing ? draft.name : profile.name) || 'Hồ sơ cư dân'}</h2>
              <p className="mt-1 apple-body kit-text-secondary">{roomLabel}{profile.room.building ? ` · ${profile.room.building}` : ''}</p>
            </div>
          </div>
          {isEditing ? (
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
              <button type="button" onClick={() => setIsScanning(true)} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 px-4 py-3 text-sm"><QrCode size={16} /><span>QR CCCD</span></button>
              <button type="button" onClick={closeProfileEditModal} disabled={isSaving} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 px-4 py-3 text-sm"><X size={16} /><span>Hủy</span></button>
              <button type="button" onClick={handleSave} disabled={isSaving} aria-busy={isSaving} className="primary-button inline-flex min-h-11 items-center justify-center gap-2 px-4 py-3 text-sm"><Check size={16} /><span>{isSaving ? 'Đang lưu…' : 'Lưu thay đổi'}</span></button>
            </div>
          ) : (
            <button type="button" onClick={openProfileEditModal} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 self-start px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 sm:self-center"><Edit3 size={16} /><span>Chỉnh sửa hồ sơ</span></button>
          )}
        </div>
        {status && <p role={status.ok ? 'status' : 'alert'} className={cn('relative mt-4 apple-callout', status.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>{status.text}</p>}
        {isEditing && showAvatarPicker && (
          <div className="relative mt-4 flex flex-wrap gap-2">
            {usesZaloImagePicker ? <>
              <button type="button" onClick={() => handleZaloAvatar('album')} className="soft-button min-h-11 px-4 text-xs">Chọn từ thư viện ảnh</button>
              <button type="button" onClick={() => handleZaloAvatar('camera')} className="soft-button min-h-11 px-4 text-xs">Chụp ảnh</button>
            </> : <>
              <label className="soft-button inline-flex min-h-11 cursor-pointer items-center px-4 text-xs focus-within:ring-2">Chọn từ thư viện ảnh<input type="file" accept="image/*" onChange={handleAvatarFile} className="sr-only" /></label>
              <label className="soft-button inline-flex min-h-11 cursor-pointer items-center px-4 text-xs focus-within:ring-2 lg:hidden">Chụp ảnh<input type="file" accept="image/*" capture="user" onChange={handleAvatarFile} className="sr-only" /></label>
            </>}
          </div>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="order-2 space-y-3 lg:order-1 lg:space-y-5">
          <ProfileSection icon={IconProfile3D} editing={isEditing} title="Thông tin cá nhân" summary={profile.phone || 'Họ tên, liên hệ và giấy tờ'}>
            <ProfileField label="Họ và tên" value={profile.name} {...editable('name')} />
            <ProfileField label="Số điện thoại" value={profile.phone} {...editable('phone')} />
            <ProfileField label="Email" value={profile.email} {...editable('email')} />
            <ProfileField label="CCCD / Hộ chiếu" value={profile.cccd} {...editable('cccd')} />
            <ProfileField label="Ngày sinh" value={profile.dob} {...editable('dob')} {...(isEditing ? { onChange: (value: string) => setDraft(prev => ({ ...prev, dob: formatDobInput(value, prev.dob) })) } : {})} placeholder="dd/mm/yyyy" inputMode="numeric" maxLength={10} />
            {isEditing ? <div className="kit-profile-field min-w-0 border-b border-black/[0.06] py-3.5 dark:border-white/[0.08]"><dt className="apple-callout font-medium kit-text-secondary">Giới tính</dt><dd role="group" aria-label="Giới tính" className="kit-segmented mt-1.5 grid grid-cols-2 gap-1">{['Nam', 'Nữ'].map(option => <button key={option} type="button" aria-pressed={draft.gender === option} onClick={() => setDraft(prev => ({ ...prev, gender: option }))} className={cn('kit-segment', draft.gender === option && 'kit-segment-active')}>{option}</button>)}</dd></div> : <ProfileField label="Giới tính" value={profile.gender} />}
            <ProfileField label="Địa chỉ thường trú" value={profile.address} {...editable('address')} />
          </ProfileSection>
          <ProfileSection icon={IconHome3D} editing={isEditing} title="Không gian sống" summary={`${roomLabel}${profile.room.floor ? ` · ${profile.room.floor}` : ''}`}>
            <ProfileField label="Phòng đang thuê" value={profile.room.roomNumber ? roomLabel : ''} />
            <ProfileField label="Khu nhà" value={profile.room.building} />
            <ProfileField label="Ngày bắt đầu thuê" value={profile.room.startDate} />
            <ProfileField label="Tầng" value={profile.room.floor} />
          </ProfileSection>
          <ProfileSection icon={IconVehicle3D} editing={isEditing} title="Phương tiện đã đăng ký" summary={profile.vehicle.plateNumber || 'Chưa cập nhật biển số xe'}>
            <ProfileField label="Biển số xe" value={profile.vehicle.plateNumber} {...editable('plateNumber')} />
            <ProfileField label="Loại phương tiện" value={VEHICLE_TYPE} />
          </ProfileSection>
          <ProfileSection icon={IconSupport3D} editing={isEditing} title="Liên hệ khẩn cấp" summary={profile.emergencyContact.name || 'Thêm người liên hệ khi cần'}>
            <ProfileField label="Họ và tên" value={profile.emergencyContact.name} {...editable('emergencyName')} />
            <ProfileField label="Mối quan hệ" value={profile.emergencyContact.relationship} {...editable('emergencyRelation')} />
            <ProfileField label="Số điện thoại" value={profile.emergencyContact.phone} {...editable('emergencyPhone')} />
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
      {isScanning && <CccdQrScanner onClose={() => setIsScanning(false)} onResult={handleQrResult} />}
      {cropSource && <AvatarCropper src={cropSource} onCancel={() => setCropSource(null)} onApply={dataUrl => { setDraft(prev => ({ ...prev, avatar: dataUrl })); setCropSource(null); setShowAvatarPicker(false); }} />}
    </div>
  );
}
