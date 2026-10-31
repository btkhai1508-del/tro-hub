import { useDialogFocus } from '../lib/useDialogFocus';
import { AvatarCropper } from './AvatarCropper';
import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Camera,
  User,
  Phone,
  Mail,
  MapPin,
  Bike,
  ShieldAlert,
  Calendar,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  LogIn
} from './AppIcons';
import { useApp } from '../context/AppContext';
import { updateResidentProfileToSheet, DEFAULT_SPREADSHEET_ID, DEFAULT_PROFILE_TAB } from '../lib/googleSheetsService';
import { getAccessToken, googleSignIn, auth } from '../lib/googleAuth';
import { apiFetch } from '../lib/api';
import { fileToAvatarDataUrl, pickImageInZalo, usesZaloImagePicker } from '../lib/imagePicker';

const sampleAvatars = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=400',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400',
];

export function ProfileEditModal() {
  const {
    profile,
    updateProfile,
    isProfileEditModalOpen,
    closeProfileEditModal,
    sheetConfig
  } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    cccd: '',
    dob: '',
    gender: '',
    address: '',
    avatar: '',
    vehicleType: '',
    plateNumber: '',
    roomNumber: '',
    emergencyName: '',
    emergencyPhone: '',
    emergencyRelation: '',
  });

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'idle' | 'success' | 'error' | 'warning'; message?: string }>({ type: 'idle' });

  // Check Google Auth token status on open
  useEffect(() => {
    if (isProfileEditModalOpen) {
      getAccessToken().then(token => {
        setHasGoogleToken(!!token);
      });

      setFormData({
        name: profile.name || '',
        phone: profile.phone || '',
        email: profile.email || '',
        cccd: profile.cccd || '',
        dob: profile.dob || '',
        gender: profile.gender || '',
        address: profile.address || '',
        avatar: profile.avatar || sampleAvatars[0],
        vehicleType: profile.vehicle?.type || 'Xe máy',
        plateNumber: profile.vehicle?.plateNumber || '',
        roomNumber: profile.room?.roomNumber || '',
        emergencyName: profile.emergencyContact?.name || '',
        emergencyPhone: profile.emergencyContact?.phone || '',
        emergencyRelation: profile.emergencyContact?.relationship || '',
      });
      setSyncStatus({ type: 'idle' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfileEditModalOpen]);

  const dialogRef = useDialogFocus(isProfileEditModalOpen, closeProfileEditModal);

  if (!isProfileEditModalOpen) return null;

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    setSyncStatus({ type: 'idle' });
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setHasGoogleToken(true);
        setSyncStatus({
          type: 'success',
          message: `Đã kết nối tài khoản Google (${res.user.email}). Bạn có thể tiếp tục cập nhật hồ sơ.`
        });
      }
    } catch (err: any) {
      console.error('Google Sign In error:', err);
      setSyncStatus({
        type: 'error',
        message: 'Không thể kết nối Google: ' + (err.message || 'Vui lòng thử lại')
      });
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSyncStatus({ type: 'idle' });

    const cleanName = formData.name.trim();
    const cleanPhone = formData.phone.trim();
    const cleanRoom = formData.roomNumber.trim();

    // 1. Update local React state and storage immediately
    updateProfile({
      name: cleanName,
      phone: cleanPhone,
      email: formData.email.trim(),
      cccd: formData.cccd.trim(),
      dob: formData.dob.trim(),
      gender: formData.gender,
      address: formData.address.trim(),
      avatar: formData.avatar,
      vehicle: {
        type: formData.vehicleType.trim() || 'Xe máy',
        plateNumber: formData.plateNumber.trim(),
        parkingSlot: '',
        registeredDate: profile.vehicle?.registeredDate || ''
      },
      emergencyContact: {
        name: formData.emergencyName.trim(),
        phone: formData.emergencyPhone.trim(),
        relationship: formData.emergencyRelation.trim()
      },
      room: {
        ...profile.room,
        roomNumber: cleanRoom
      }
    });

    const effectiveSheetId = sheetConfig.spreadsheetId || DEFAULT_SPREADSHEET_ID;

    // 2. Write directly to Backend & Google Sheet via 2-way sync
    try {
      const res = await apiFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          phone: cleanPhone,
          cccd: formData.cccd.trim(),
          email: formData.email.trim(),
          dob: formData.dob.trim(),
          gender: formData.gender,
          address: formData.address.trim(),
          plateNumber: formData.plateNumber.trim(),
          vehicleType: formData.vehicleType.trim() || 'Xe máy',
          roomNumber: cleanRoom,
          emergencyName: formData.emergencyName.trim(),
          emergencyRelation: formData.emergencyRelation.trim(),
          emergencyPhone: formData.emergencyPhone.trim()
        })
      });

      if (res.ok) {
        setSyncStatus({
          type: 'success',
          message: 'Đã lưu thông tin cư dân.'
        });

        setTimeout(() => {
          setIsSaving(false);
          closeProfileEditModal();
        }, 1000);
        return;
      }
    } catch (err: any) {
      console.warn('Backend profile update error:', err);
      setSyncStatus({
        type: 'error',
        message: 'Không thể lưu hồ sơ: ' + (err.message || 'Vui lòng thử lại')
      });
    } finally {
      setIsSaving(false);
    }
  };

  const applyAvatar = (dataUrl: string) => {
    setFormData(prev => ({ ...prev, avatar: dataUrl }));
    setCropSource(null);
    setShowAvatarPicker(false);
    setAvatarError('');
  };

  const startCrop = (dataUrl: string | null) => {
    if (!dataUrl) return;
    setAvatarError('');
    setCropSource(dataUrl);
  };

  const handleCustomAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      startCrop(await fileToAvatarDataUrl(file));
    } catch {
      setAvatarError('Không đọc được ảnh này. Vui lòng chọn ảnh JPG hoặc PNG khác.');
    }
  };

  const handleZaloAvatar = async (source: 'album' | 'camera') => {
    try {
      startCrop(await pickImageInZalo(source));
    } catch (err: any) {
      console.warn('[avatar] chooseImage failed', err);
      setAvatarError('Zalo chưa được cấp quyền truy cập ảnh. Vui lòng cho phép trong cài đặt Zalo rồi thử lại.');
    }
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30 dark:bg-black/45 duration-200"
      onClick={closeProfileEditModal}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="profile-edit-dialog-title" className="tahoe-dialog kit-dialog w-full max-w-lg flex flex-col max-h-[92svh] overflow-hidden relative duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Header */}
        <div className="kit-window-toolbar shrink-0 flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center icon-plate">
              <User size={18} />
            </div>
            <div>
              <span className="type-label text-neutral-600 dark:text-neutral-200 block text-[10px]">Cài đặt tài khoản</span>
              <h3 id="profile-edit-dialog-title" className="text-[17px] leading-snug font-semibold text-neutral-900 dark:text-neutral-100">Chỉnh sửa thông tin cư dân</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={closeProfileEditModal}
            className="kit-dialog-close h-11 w-11 shrink-0 rounded-full bg-white/20 dark:bg-white/5 hover:bg-white/35 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="kit-dialog-body min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">

          {/* Status Alert Message */}
          {syncStatus.type === 'success' && (
            <div role="status" className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
              <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{syncStatus.message}</span>
            </div>
          )}
          {syncStatus.type === 'warning' && (
            <div role="status" className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{syncStatus.message}</span>
            </div>
          )}
          {syncStatus.type === 'error' && (
            <div role="alert" className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{syncStatus.message}</span>
            </div>
          )}

          {/* Avatar Section */}
          <div className="flex flex-col items-center justify-center pb-2">
            <div className="relative">
              <img
                src={formData.avatar || sampleAvatars[0]}
                alt="Avatar"
                className="w-20 h-20 rounded-3xl object-cover ring-4 ring-neutral-100 dark:ring-neutral-800 shadow-md"
              />
              <button
                type="button"
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="absolute -bottom-1 -right-1 h-11 w-11 rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 flex items-center justify-center shadow-md hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors cursor-pointer"
                title="Thay đổi ảnh đại diện"
              >
                <Camera size={13} />
              </button>
            </div>

            {showAvatarPicker && (
              <div className="mt-3 p-3 bg-white/25 dark:bg-white/5 rounded-2xl border border-neutral-200 dark:border-neutral-700 flex flex-col items-center gap-2.5 duration-150">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">Chọn ảnh mẫu hoặc tải ảnh lên:</span>
                <div className="flex items-center gap-2">
                  {sampleAvatars.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`Avatar ${idx + 1}`}
                      onClick={() => {
                        setFormData(prev => ({ ...prev, avatar: url }));
                        setShowAvatarPicker(false);
                      }}
                      className="w-9 h-9 rounded-xl object-cover ring-1 ring-neutral-300 dark:ring-neutral-600 cursor-pointer transition-transform"
                    />
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {usesZaloImagePicker ? (
                    <>
                      <button type="button" onClick={() => handleZaloAvatar('album')} className="soft-button min-h-11 px-4 text-xs">Chọn từ thư viện ảnh</button>
                      <button type="button" onClick={() => handleZaloAvatar('camera')} className="soft-button min-h-11 px-4 text-xs">Chụp ảnh</button>
                    </>
                  ) : (
                    <>
                      <label className="soft-button min-h-11 px-4 text-xs cursor-pointer inline-flex items-center focus-within:ring-2">
                        Chọn từ thư viện ảnh
                        <input type="file" accept="image/*" onChange={handleCustomAvatarUpload} className="sr-only" />
                      </label>
                      <label className="soft-button min-h-11 px-4 text-xs cursor-pointer inline-flex items-center focus-within:ring-2 lg:hidden">
                        Chụp ảnh
                        <input type="file" accept="image/*" capture="user" onChange={handleCustomAvatarUpload} className="sr-only" />
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}
            {cropSource && <AvatarCropper src={cropSource} onCancel={() => setCropSource(null)} onApply={applyAvatar} />}
            {avatarError && <p role="alert" className="mt-2 text-center text-xs text-red-700 dark:text-red-400">{avatarError}</p>}
          </div>

          {/* Section 1: Thông tin cơ bản */}
          <div className="kit-inset p-4 space-y-3">
            <span className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-200">Thông tin cơ bản</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-edit-name" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Họ và tên *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Bùi Trung Khải"
                  id="profile-edit-name" value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-phone" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Số điện thoại *</label>
                <input
                  type="tel"
                  required
                  placeholder="0902371800"
                  id="profile-edit-phone" value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-cccd" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Số CCCD / Hộ chiếu</label>
                <input
                  type="text"
                  placeholder="Nhập số CCCD"
                  id="profile-edit-cccd" value={formData.cccd}
                  onChange={(e) => setFormData({ ...formData, cccd: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-email" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Email liên hệ</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  id="profile-edit-email" value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-dob" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Ngày sinh</label>
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  id="profile-edit-dob" value={formData.dob}
                  onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-roomNumber" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Số phòng đang ở</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 203 hoặc P. 203"
                  id="profile-edit-roomNumber" value={formData.roomNumber}
                  onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num font-bold rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <span id="profile-edit-gender" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Giới tính</span>
              <div role="group" aria-labelledby="profile-edit-gender" className="kit-segmented grid grid-cols-2 gap-1 p-1">
                {['Nam', 'Nữ'].map(option => (
                  <button key={option} type="button" aria-pressed={formData.gender === option} onClick={() => setFormData({ ...formData, gender: option })}
                    className={`kit-segment min-h-10 px-3 text-xs font-medium ${formData.gender === option ? 'kit-segment-active' : ''}`}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="profile-edit-address" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Địa chỉ thường trú</label>
              <textarea
                rows={2}
                placeholder="Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/TP"
                id="profile-edit-address" value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none resize-none"
              />
            </div>
          </div>

          {/* Section 2: Phương tiện */}
          <div className="kit-inset p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bike size={15} className="text-neutral-600 dark:text-neutral-300" />
              <span className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-200">Phương tiện</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-edit-plateNumber" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Biển số xe</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 59-X1 123.45"
                  id="profile-edit-plateNumber" value={formData.plateNumber}
                  onChange={(e) => setFormData({ ...formData, plateNumber: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num font-bold uppercase rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-vehicleType" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Loại phương tiện</label>
                <input
                  type="text"
                  placeholder="Xe máy / Vision / AirBlade"
                  id="profile-edit-vehicleType" value={formData.vehicleType}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Người liên hệ khẩn cấp */}
          <div className="kit-inset p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={15} className="text-rose-500" />
              <span className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-200">Người liên hệ khẩn cấp</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="profile-edit-emergencyName" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Họ tên</label>
                <input
                  type="text"
                  placeholder="Người thân"
                  id="profile-edit-emergencyName" value={formData.emergencyName}
                  onChange={(e) => setFormData({ ...formData, emergencyName: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-emergencyRelation" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">Mối quan hệ</label>
                <input
                  type="text"
                  placeholder="Bố / Mẹ / Anh"
                  id="profile-edit-emergencyRelation" value={formData.emergencyRelation}
                  onChange={(e) => setFormData({ ...formData, emergencyRelation: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="profile-edit-emergencyPhone" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 block mb-1">SĐT khẩn</label>
                <input
                  type="tel"
                  placeholder="090..."
                  id="profile-edit-emergencyPhone" value={formData.emergencyPhone}
                  onChange={(e) => setFormData({ ...formData, emergencyPhone: e.target.value })}
                  className="kit-field w-full px-3 py-2 text-xs font-num rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/25 dark:bg-white/5 text-neutral-900 dark:text-neutral-100 font-medium focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Submit Action */}
          <div className="kit-dialog-footer pt-4 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={closeProfileEditModal}
              className="min-h-11 soft-button py-2 px-4 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer disabled:opacity-50"
            >
              Hủy bỏ
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="min-h-11 primary-button py-2.5 px-5 text-xs flex items-center gap-1.5 cursor-pointer font-bold disabled:opacity-50 shadow-sm"
            >
              {isSaving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Đang lưu thông tin…</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Lưu thay đổi</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
