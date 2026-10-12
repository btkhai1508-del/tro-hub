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
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { updateResidentProfileToSheet, DEFAULT_SPREADSHEET_ID, DEFAULT_PROFILE_TAB } from '../lib/googleSheetsService';
import { getAccessToken, googleSignIn, auth } from '../lib/googleAuth';
import { apiFetch } from '../lib/api';

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
          message: `Đã kết nối tài khoản Google (${res.user.email}). Sẵn sàng ghi trực tiếp lên Google Sheet!`
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
          message: '✅ Đã cập nhật và đồng bộ trực tiếp vào Google Sheet thành công!'
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
        message: 'Lỗi cập nhật Google Sheet: ' + (err.message || 'Vui lòng thử lại')
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCustomAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, avatar: reader.result as string }));
        setShowAvatarPicker(false);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={closeProfileEditModal}
    >
      <div 
        className="w-full max-w-lg bg-white dark:bg-[#101726] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.35)] flex flex-col max-h-[92vh] overflow-hidden relative animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Header */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
              <User size={18} />
            </div>
            <div>
              <span className="type-label text-slate-400 dark:text-slate-400 block text-[10px]">Cài đặt tài khoản</span>
              <h3 className="type-h4 text-slate-900 dark:text-slate-100 font-bold">Chỉnh sửa thông tin cư dân</h3>
            </div>
          </div>

          <button 
            type="button"
            onClick={closeProfileEditModal}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* Google Sheet Sync Status Bar */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#162032] border border-slate-200/80 dark:border-slate-750 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {hasGoogleToken ? (
                  <strong className="text-emerald-600 dark:text-emerald-400">Đã kết nối Google Sheet</strong>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Chưa liên kết Google Sheet để ghi trực tiếp</span>
                )}
              </span>
            </div>

            {!hasGoogleToken ? (
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={isConnectingGoogle}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
              >
                {isConnectingGoogle ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <LogIn size={11} />
                )}
                <span>Kết nối Google</span>
              </button>
            ) : (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-100/60 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                Tự động ghi Sheet ✓
              </span>
            )}
          </div>

          {/* Status Alert Message */}
          {syncStatus.type === 'success' && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
              <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{syncStatus.message}</span>
            </div>
          )}
          {syncStatus.type === 'warning' && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{syncStatus.message}</span>
            </div>
          )}
          {syncStatus.type === 'error' && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
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
                className="w-20 h-20 rounded-3xl object-cover ring-4 ring-slate-100 dark:ring-slate-800 shadow-md"
              />
              <button
                type="button"
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-slate-900 dark:bg-indigo-600 text-white flex items-center justify-center shadow-md hover:bg-slate-800 dark:hover:bg-indigo-500 transition-colors cursor-pointer"
                title="Thay đổi ảnh đại diện"
              >
                <Camera size={13} />
              </button>
            </div>

            {showAvatarPicker && (
              <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center gap-2.5 animate-in fade-in duration-150">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Chọn ảnh mẫu hoặc tải ảnh lên:</span>
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
                      className="w-9 h-9 rounded-xl object-cover ring-1 ring-slate-300 dark:ring-slate-600 hover:scale-105 cursor-pointer transition-transform"
                    />
                  ))}
                  <label className="w-9 h-9 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-500 cursor-pointer text-xs">
                    +
                    <input type="file" accept="image/*" onChange={handleCustomAvatarUpload} className="hidden" />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Section 1: Thông tin cơ bản */}
          <div className="space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Thông tin cơ bản (Ghi Cột A - E)</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Họ và tên * (Cột A)</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Bùi Trung Khải"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Số điện thoại * (Cột B)</label>
                <input
                  type="tel"
                  required
                  placeholder="0902371800"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Số CCCD / Hộ chiếu (Cột C)</label>
                <input
                  type="text"
                  placeholder="Nhập số CCCD"
                  value={formData.cccd}
                  onChange={(e) => setFormData({ ...formData, cccd: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Email liên hệ (Cột D)</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Ngày sinh (Cột E)</label>
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  value={formData.dob}
                  onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Số phòng đang ở (Cột I)</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 203 hoặc P. 203"
                  value={formData.roomNumber}
                  onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Địa chỉ thường trú (Cột F)</label>
              <textarea
                rows={2}
                placeholder="Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/TP"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none resize-none"
              />
            </div>
          </div>

          {/* Section 2: Phương tiện */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Bike size={15} className="text-indigo-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Phương tiện (Cột G & H)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Biển số xe (Cột G)</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 59-X1 123.45"
                  value={formData.plateNumber}
                  onChange={(e) => setFormData({ ...formData, plateNumber: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num font-bold uppercase rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Loại phương tiện (Cột H)</label>
                <input
                  type="text"
                  placeholder="Xe máy / Vision / AirBlade"
                  value={formData.vehicleType}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Người liên hệ khẩn cấp */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldAlert size={15} className="text-rose-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Người liên hệ khẩn cấp (Cột J - L)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Họ tên (Cột J)</label>
                <input
                  type="text"
                  placeholder="Người thân"
                  value={formData.emergencyName}
                  onChange={(e) => setFormData({ ...formData, emergencyName: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">Mối quan hệ (Cột K)</label>
                <input
                  type="text"
                  placeholder="Bố / Mẹ / Anh"
                  value={formData.emergencyRelation}
                  onChange={(e) => setFormData({ ...formData, emergencyRelation: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">SĐT khẩn (Cột L)</label>
                <input
                  type="tel"
                  placeholder="090..."
                  value={formData.emergencyPhone}
                  onChange={(e) => setFormData({ ...formData, emergencyPhone: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-num rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-slate-900/10 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Submit Action */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={closeProfileEditModal}
              className="soft-button py-2 px-4 text-xs text-slate-600 dark:text-slate-300 cursor-pointer disabled:opacity-50"
            >
              Hủy bỏ
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="primary-button py-2.5 px-5 text-xs flex items-center gap-1.5 cursor-pointer font-bold disabled:opacity-50 shadow-sm"
            >
              {isSaving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Đang ghi lên Google Sheet...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Lưu & Cập nhật Google Sheet</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
