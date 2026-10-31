import { useDialogFocus } from '../lib/useDialogFocus';
import React, { useState } from 'react';
import { X, Copy, Check, Phone, MessageCircle, AlertTriangle, ShieldCheck, Wrench, Wifi, Droplet, Zap, Bike, FileText, CheckCircle2, Send, Clock } from './AppIcons';
import { useApp } from '../context/AppContext';
import {
  IconMeter3D,
  IconElectricity3D,
  IconWater3D,
  IconVehicle3D,
  IconWifi3D,
  IconMaintenance3D,
  IconDeclaration3D,
  IconHandbook3D,
  IconSupport3D,
  IconSecurity3D,
  IconClock3D,
  IconCleanliness3D
} from './Icons3D';
import { cn } from '../lib/utils';
import { houseFromRoom } from '../lib/houses';

export type UtilityModalType = 'meter' | 'vehicle' | 'wifi' | 'maintenance' | 'declaration' | 'rules' | 'hotline' | null;

interface UtilityDetailModalProps {
  type: UtilityModalType;
  isOpen: boolean;
  onClose: () => void;
  onOpenContract?: () => void;
}

interface MaintenanceTicket {
  id: string;
  category: string;
  description: string;
  urgency: 'normal' | 'urgent';
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const DEFAULT_TICKETS: MaintenanceTicket[] = [
  {
    id: 'BT-102',
    category: 'Máy lạnh / Điều hòa',
    description: 'Vệ sinh lưới lọc và bảo dưỡng máy lạnh định kỳ',
    urgency: 'normal',
    createdAt: '12/10/2026',
    status: 'completed'
  },
  {
    id: 'BT-108',
    category: 'Điện & Đèn',
    description: 'Thay bóng đèn LED chiếu sáng ban công phòng',
    urgency: 'normal',
    createdAt: '16/10/2026',
    status: 'completed'
  }
];

export function UtilityDetailModal({ type, isOpen, onClose, onOpenContract }: UtilityDetailModalProps) {
  const { profile } = useApp();
  const residentHouse = houseFromRoom(profile.room?.roomNumber);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Maintenance form state
  const [tickets, setTickets] = useState<MaintenanceTicket[]>(DEFAULT_TICKETS);
  const [mCategory, setMCategory] = useState('Điện / Thiết bị');
  const [mDesc, setMDesc] = useState('');
  const [mUrgency, setMUrgency] = useState<'normal' | 'urgent'>('normal');
  const [mSuccessMsg, setMSuccessMsg] = useState(false);

  // Meter report state
  const [meterReportSent, setMeterReportSent] = useState(false);
  const [meterNote, setMeterNote] = useState('');

  const dialogRef = useDialogFocus(Boolean(isOpen && type), onClose);

  if (!isOpen || !type) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mDesc.trim()) return;

    const newTicket: MaintenanceTicket = {
      id: `BT-${Math.floor(100 + Math.random() * 900)}`,
      category: mCategory,
      description: mDesc.trim(),
      urgency: mUrgency,
      createdAt: new Date().toLocaleDateString('vi-VN'),
      status: 'pending'
    };

    setTickets([newTicket, ...tickets]);
    setMDesc('');
    setMSuccessMsg(true);
    setTimeout(() => setMSuccessMsg(false), 3500);
  };

  const cleanRoom = profile.room?.roomNumber
    ? (profile.room.roomNumber.startsWith('P.') ? profile.room.roomNumber : `P. ${profile.room.roomNumber}`)
    : 'P. G02';

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/30 dark:bg-black/45 duration-200"
      onClick={onClose}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="utility-dialog-title" className="tahoe-dialog kit-dialog w-full max-w-2xl flex flex-col max-h-[90svh] overflow-hidden relative duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="kit-window-toolbar shrink-0 flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3.5">
            {type === 'meter' && <IconMeter3D size={44} className="shrink-0" />}
            {type === 'vehicle' && <IconVehicle3D size={44} className="shrink-0" />}
            {type === 'wifi' && <IconWifi3D size={44} className="shrink-0" />}
            {type === 'maintenance' && <IconMaintenance3D size={44} className="shrink-0" />}
            {type === 'declaration' && <IconDeclaration3D size={44} className="shrink-0" />}
            {type === 'rules' && <IconHandbook3D size={44} className="shrink-0" />}
            {type === 'hotline' && <IconSupport3D size={44} className="shrink-0" />}

            <div>
              <h2 id="utility-dialog-title" className="text-[17px] font-semibold text-neutral-900 dark:text-white leading-tight">
                {type === 'meter' && 'Chỉ số Điện & Nước'}
                {type === 'vehicle' && 'Thẻ xe & Vị trí đỗ'}
                {type === 'wifi' && 'Wifi & Mạng Internet'}
                {type === 'maintenance' && 'Báo hỏng & Sửa chữa'}
                {type === 'declaration' && 'Khai báo tạm trú (CT01 / VNeID)'}
                {type === 'rules' && 'Nội quy nhà trọ & PCCC'}
                {type === 'hotline' && 'Hotline Ban quản lý & Hỗ trợ'}
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {cleanRoom} · Tòa nhà {profile.room?.building || 'Phong Lan'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="kit-dialog-close h-11 w-11 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="kit-dialog-body min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5 text-neutral-700 dark:text-neutral-200">

          {/* =========================================================================
              1. ĐIỆN & NƯỚC (METER)
             ========================================================================= */}
          {type === 'meter' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Electricity Card */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-50/80 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 text-neutral-900 dark:text-white font-bold text-sm">
                      <IconElectricity3D size={28} className="shrink-0" />
                      <span>Đồng hồ Điện</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
                      3.500 ₫/kWh
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                      <span>Chỉ số đầu kỳ:</span>
                      <span className="font-mono font-semibold text-neutral-700 dark:text-neutral-200">1.350 kWh</span>
                    </div>
                    <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                      <span>Chỉ số cuối kỳ:</span>
                      <span className="font-mono font-bold text-neutral-900 dark:text-white">1.482 kWh</span>
                    </div>
                    <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-800 flex justify-between items-baseline">
                      <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Tiêu thụ:</span>
                      <span className="text-base font-bold font-mono text-neutral-900 dark:text-white">132 kWh (462.000 ₫)</span>
                    </div>
                  </div>
                </div>

                {/* Water Card */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-50/80 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 text-neutral-900 dark:text-white font-bold text-sm">
                      <IconWater3D size={28} className="shrink-0" />
                      <span>Đồng hồ Nước</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
                      25.000 ₫/m³
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                      <span>Chỉ số đầu kỳ:</span>
                      <span className="font-mono font-semibold text-neutral-700 dark:text-neutral-200">70 m³</span>
                    </div>
                    <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                      <span>Chỉ số cuối kỳ:</span>
                      <span className="font-mono font-bold text-neutral-900 dark:text-white">78 m³</span>
                    </div>
                    <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-800 flex justify-between items-baseline">
                      <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Tiêu thụ:</span>
                      <span className="text-base font-bold font-mono text-neutral-900 dark:text-white">8 m³ (200.000 ₫)</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Meter Schedule Info */}
              <div className="kit-inset p-4 flex items-start gap-3">
                <IconClock3D size={28} className="shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold text-neutral-900 dark:text-white">Lịch ghi chốt chỉ số định kỳ</p>
                  <p className="text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Ban quản lý tiến hành ghi chỉ số công tơ điện nước vào ngày <strong>25 hàng tháng</strong>. Chỉ số được cập nhật trực tiếp lên hệ thống và hiển thị trong mục Hóa đơn.
                  </p>
                </div>
              </div>

              {/* Discrepancy Reporting Box */}
              <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-700/80 space-y-3">
                <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-400">
                  Phản hồi hoặc kiểm tra lại chỉ số
                </h4>
                {meterReportSent ? (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>Yêu cầu kiểm tra lại chỉ số của bạn đã được gửi tới Ban quản lý. Chúng tôi sẽ kiểm tra trong 24h!</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <textarea
                      aria-label="Ghi chú kiểm tra chỉ số điện nước" value={meterNote}
                      onChange={(e) => setMeterNote(e.target.value)}
                      placeholder="Nếu bạn thấy chỉ số ghi chưa khớp với công tơ thực tế tại phòng, vui lòng ghi chú số đo hiện tại tại đây..."
                      className="kit-field w-full text-xs p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white resize-none h-20"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (meterNote.trim()) {
                          setMeterReportSent(true);
                        }
                      }}
                      className="min-h-11 px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:bg-neutral-800 cursor-pointer transition-colors"
                    >
                      Gửi yêu cầu đối chiếu chỉ số
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =========================================================================
              2. THẺ XE & BÃI ĐỖ (VEHICLE)
             ========================================================================= */}
          {type === 'vehicle' && (
            <div className="space-y-5">
              {/* Vehicle Detail Card */}
              <div className="p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/80 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-700">
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider block">Phương tiện đăng ký</span>
                    <h3 className="text-base font-bold text-neutral-900 dark:text-white mt-0.5">
                      {profile.vehicle.type || 'Honda Vision (Xe máy)'}
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    Thẻ từ Active
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-neutral-400 block mb-0.5">Biển số xe:</span>
                    <span className="font-mono font-bold text-neutral-900 dark:text-white text-sm bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 inline-block shadow-2xs">
                      {profile.vehicle.plateNumber || '59-X1 888.88'}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block mb-0.5">Vị trí đỗ xe:</span>
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                      {profile.vehicle.parkingSlot || 'Hầm B1 — Ô đỗ xe cư dân'}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block mb-0.5">Mã thẻ quẹt từ:</span>
                    <span className="font-mono font-semibold text-neutral-700 dark:text-neutral-300">PL-CARD-{cleanRoom.replace(/[^\w]/g, '')}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block mb-0.5">Phí giữ xe tháng:</span>
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200">120.000 ₫/tháng</span>
                  </div>
                </div>
              </div>

              {/* Parking Rules */}
              <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-700/80 space-y-2.5 text-xs">
                <h4 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck size={16} className="text-emerald-600" />
                  <span>Quy định an toàn bãi giữ xe</span>
                </h4>
                <ul className="space-y-1.5 text-neutral-600 dark:text-neutral-300 list-disc list-inside leading-relaxed">
                  <li>Tốc độ di chuyển trong khu vực hầm không vượt quá 10 km/h.</li>
                  <li>Đỗ xe đúng vạch ô quy định của phòng, luôn khóa cổ xe trước khi lên phòng.</li>
                  <li>Xe máy điện / xe đạp điện cần thông báo trước nếu sạc pin tại khu vực trạm sạc chung.</li>
                  <li>Nếu bị mất thẻ từ, vui lòng báo ngay Ban quản lý để khóa mã thẻ cũ và cấp thẻ mới (phí làm lại thẻ 50.000 ₫).</li>
                </ul>
              </div>
            </div>
          )}

          {/* =========================================================================
              3. WIFI & INTERNET (WIFI)
             ========================================================================= */}
          {type === 'wifi' && (
            <div className="space-y-5">

              {/* 5GHz High Speed */}
              <div className="kit-inset p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Wifi size={20} className="text-neutral-700 dark:text-neutral-200" />
                    <div>
                      <h3 className="font-bold text-sm text-neutral-900 dark:text-white">PhongLan_Residents_5G</h3>
                      <span className="text-[11px] text-neutral-700 dark:text-neutral-200 font-medium">Băng tần 5GHz (Tốc độ cao 300 Mbps)</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                    Khuyên dùng
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-semibold block">Mật khẩu Wifi</span>
                    <span className="text-sm font-mono font-bold text-neutral-900 dark:text-white">ecostay_phonglan</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('ecostay_phonglan', 'wifi5g')}
                    className="min-h-11 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                  >
                    {copiedKey === 'wifi5g' ? (
                      <>
                        <Check size={14} className="text-emerald-600" />
                        <span className="text-emerald-600 font-bold">Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        <span>Sao chép</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 2.4GHz Wide Range */}
              <div className="kit-inset p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Wifi size={20} className="text-neutral-500" />
                    <div>
                      <h3 className="font-bold text-sm text-neutral-900 dark:text-white">PhongLan_CuDan_2.4G</h3>
                      <span className="text-[11px] text-neutral-500 font-medium">Băng tần 2.4GHz (Phủ sóng xuyên tường mọi góc phòng)</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-semibold block">Mật khẩu Wifi</span>
                    <span className="text-sm font-mono font-bold text-neutral-900 dark:text-white">phonglan_trungkinh</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('phonglan_trungkinh', 'wifi24g')}
                    className="min-h-11 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                  >
                    {copiedKey === 'wifi24g' ? (
                      <>
                        <Check size={14} className="text-emerald-600" />
                        <span className="text-emerald-600 font-bold">Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        <span>Sao chép</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Support note */}
              <div className="text-xs text-neutral-500 dark:text-neutral-400 p-3 rounded-xl bg-neutral-100/70 dark:bg-neutral-800/40">
                💡 Nếu thiết bị kết nối chậm hoặc mạng chập chờn, vui lòng khởi động lại Wi-Fi trên máy hoặc gọi Hotline kỹ thuật <strong>0902 371 800</strong> để được hỗ trợ kiểm tra router phòng.
              </div>

            </div>
          )}

          {/* =========================================================================
              4. BÁO HỎNG & SỬA CHỮA (MAINTENANCE)
             ========================================================================= */}
          {type === 'maintenance' && (
            <div className="space-y-6">

              {/* Form to submit request */}
              <form onSubmit={handleCreateTicket} className="kit-inset p-4 sm:p-5 space-y-3.5">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <Wrench size={16} className="text-amber-600" />
                  <span>Gửi yêu cầu sửa chữa thiết bị</span>
                </h3>

                {mSuccessMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>Yêu cầu sửa chữa của bạn đã được ghi nhận. Kỹ thuật viên sẽ liên hệ trong ít phút!</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-neutral-600 dark:text-neutral-400 block mb-1">
                      Loại thiết bị / Sự cố:
                    </label>
                    <select
                      aria-label="Loại sự cố" value={mCategory}
                      onChange={(e) => setMCategory(e.target.value)}
                      className="kit-field w-full text-xs p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
                    >
                      <option value="Điện & Đèn chiếu sáng">Điện & Đèn chiếu sáng</option>
                      <option value="Hệ thống Cấp & Thoát nước">Hệ thống Cấp & Thoát nước</option>
                      <option value="Máy lạnh / Điều hòa">Máy lạnh / Điều hòa</option>
                      <option value="Cửa & Khóa phòng">Cửa & Khóa phòng</option>
                      <option value="Thiết bị vệ sinh (Bồn cầu, Lavabo)">Thiết bị vệ sinh</option>
                      <option value="Vấn đề khác">Vấn đề khác</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-neutral-600 dark:text-neutral-400 block mb-1">
                      Mức độ ưu tiên:
                    </label>
                    <select
                      aria-label="Mức độ ưu tiên" value={mUrgency}
                      onChange={(e) => setMUrgency(e.target.value as any)}
                      className="kit-field w-full text-xs p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"
                    >
                      <option value="normal">Bình thường (Xử lý trong 24h)</option>
                      <option value="urgent">Cần gấp (Xử lý trong ngày)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-neutral-600 dark:text-neutral-400 block mb-1">
                    Mô tả chi tiết sự cố:
                  </label>
                  <textarea
                    aria-label="Mô tả sự cố" value={mDesc}
                    onChange={(e) => setMDesc(e.target.value)}
                    placeholder="Mô tả cụ thể sự cố để kỹ thuật viên mang đúng đồ nghề (ví dụ: vòi rửa bát bị rò nước ở khớp nối dưới bồn)..."
                    rows={2}
                    className="kit-field w-full text-xs p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="min-h-11 primary-button w-full sm:w-auto px-5"
                >
                  <Send size={14} />
                  <span>Gửi yêu cầu cho BQL</span>
                </button>
              </form>

              {/* Ticket History */}
              <div className="space-y-3">
                <h4 className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">
                  Lịch sử yêu cầu sửa chữa ({tickets.length})
                </h4>

                <div className="space-y-2">
                  {tickets.map((t) => (
                    <div
                      key={t.id}
                      className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/40 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-neutral-900 dark:text-white">{t.category}</span>
                          <span className="text-[10px] text-neutral-400 font-mono">#{t.id}</span>
                          {t.urgency === 'urgent' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-bold">
                              Gấp
                            </span>
                          )}
                        </div>
                        <p className="text-neutral-600 dark:text-neutral-300">{t.description}</p>
                        <span className="text-[10px] text-neutral-400 mt-1 block">Ngày gửi: {t.createdAt}</span>
                      </div>

                      <div className="shrink-0 text-right">
                        {t.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={12} />
                            <span>Đã xong</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full">
                            <Clock size={12} />
                            <span>Đang xử lý</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* =========================================================================
              5. KHAI BÁO CƯ TRÚ (CT01 / VNEID)
             ========================================================================= */}
          {type === 'declaration' && (
            <div className="space-y-5">

              {/* 4-Step Guide */}
              <div className="p-4 sm:p-5 rounded-2xl bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 dark:border-emerald-900/40 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-300">
                  Quy trình 4 bước đăng ký tạm trú trên VNeID
                </h3>
                <ol className="space-y-2 text-neutral-700 dark:text-neutral-300 list-decimal list-inside leading-relaxed">
                  <li>Mở ứng dụng <strong>VNeID</strong> trên điện thoại (yêu cầu tài khoản Định danh điện tử Mức 2).</li>
                  <li>Vào mục <strong>"Thủ tục hành chính"</strong> → Chọn <strong>"Thông báo lưu trú"</strong> hoặc <strong>"Đăng ký tạm trú"</strong>.</li>
                  <li>Chọn cơ quan Công an thụ lý tại nơi ở hiện tại và nhập thông tin cơ sở cho thuê bên dưới.</li>
                  <li>Xác nhận và gửi hồ sơ. Kết quả sẽ được cập nhật trực tiếp trên VNeID trong 1-3 ngày làm việc.</li>
                </ol>
              </div>

              {/* Information to copy */}
              <div className="kit-inset p-4 sm:p-5 space-y-3">
                <span className="text-[13px] font-semibold text-neutral-500 block">
                  Thông tin chủ nhà & Nhà trọ để điền hồ sơ
                </span>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">Họ tên chủ nhà:</span>
                      <span className="font-bold text-neutral-900 dark:text-white">{residentHouse.landlord}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(residentHouse.landlord, 'landlord_name')}
                      className="min-h-11 p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                      title="Sao chép tên chủ nhà"
                    >
                      {copiedKey === 'landlord_name' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">Số CCCD chủ nhà:</span>
                      <span className="font-mono font-bold text-neutral-900 dark:text-white">{residentHouse.landlordCccd}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(residentHouse.landlordCccd, 'landlord_cccd')}
                      className="min-h-11 p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                      title="Sao chép CCCD"
                    >
                      {copiedKey === 'landlord_cccd' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">Địa chỉ nhà trọ:</span>
                      <span className="font-medium text-neutral-900 dark:text-white">{residentHouse.address}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(residentHouse.address, 'address')}
                      className="min-h-11 p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                      title="Sao chép địa chỉ"
                    >
                      {copiedKey === 'address' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                {onOpenContract && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenContract();
                    }}
                    className="min-h-11 primary-button w-full mt-2 px-5"
                  >
                    <FileText size={15} />
                    <span>Xem tờ khai mẫu CT01 & Hợp đồng thuê phòng</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* =========================================================================
              6. NỘI QUY & PCCC (RULES)
             ========================================================================= */}
          {type === 'rules' && (
            <div className="space-y-4 text-xs leading-relaxed">

              {/* Rule 1: Giờ giấc */}
              <div className="kit-inset p-4 space-y-1.5">
                <h4 className="font-bold text-neutral-900 dark:text-white text-sm">
                  1. Giờ giấc & An ninh ra vào
                </h4>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Cửa chính tòa nhà sử dụng vân tay / thẻ từ 24/7. Cư dân ra vào tự giác đóng cửa cổng cẩn thận, không để người lạ bám theo vào khu vực chung. Người thân hoặc bạn bè đến chơi ngủ qua đêm cần đăng ký trước với Ban quản lý.
                </p>
              </div>

              {/* Rule 2: Trật tự */}
              <div className="kit-inset p-4 space-y-1.5">
                <h4 className="font-bold text-neutral-900 dark:text-white text-sm">
                  2. Trật tự & Văn minh nếp sống
                </h4>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Tuyệt đối giữ yên lặng từ <strong>23:00 đến 06:00 sáng</strong>. Không sử dụng loa kéo, hát karaoke trong phòng làm ảnh hưởng tới các phòng lân cận. Tôn trọng không gian nghỉ ngơi của mọi người xung quanh.
                </p>
              </div>

              {/* Rule 3: PCCC */}
              <div className="p-4 rounded-2xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 dark:border-rose-900/40 space-y-1.5">
                <h4 className="font-bold text-rose-700 dark:text-rose-400 text-sm flex items-center gap-1.5">
                  <AlertTriangle size={16} />
                  <span>3. An toàn Phòng cháy chữa cháy (PCCC)</span>
                </h4>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Bình chữa cháy khí CO2 và bột được trang bị tại đầu mỗi hành lang và cạnh cầu thang bộ. Tắt toàn bộ thiết bị sinh nhiệt (bếp từ, ấm siêu tốc, bàn ủi) khi ra khỏi phòng. Không đốt vàng mã, than củi trong phòng kín. Số khẩn cấp Cứu hỏa PCCC: <strong>114</strong>.
                </p>
              </div>

              {/* Rule 4: Vệ sinh */}
              <div className="p-4 rounded-2xl bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 dark:border-emerald-900/40 space-y-1.5">
                <h4 className="font-bold text-emerald-800 dark:text-emerald-400 text-sm flex items-center gap-1.5">
                  <IconCleanliness3D size={20} />
                  <span>4. Vệ sinh chung & Rác thải</span>
                </h4>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Rác sinh hoạt cần được phân loại và buộc kín miệng túi trước khi mang ra khu vực tập kết chung trước 20:00 hàng ngày. Giữ gìn hành lang, cầu thang sạch sẽ, không để giày dép hay đồ đạc cản trở lối đi thoát hiểm.
                </p>
              </div>

            </div>
          )}

          {/* =========================================================================
              7. HOTLINE BQL & KHẨN CẤP (HOTLINE)
             ========================================================================= */}
          {type === 'hotline' && (
            <div className="space-y-3.5">

              {/* Landlord Card */}
              <div className="kit-inset p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider block">Quản lý & Chủ nhà</span>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-white mt-0.5">Bùi Trung Khải</h3>
                  <p className="text-xs font-mono font-bold text-neutral-700 dark:text-neutral-300 mt-1">0902 371 800</p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="tel:0902371800"
                    className="primary-button px-4 text-sm"
                  >
                    <Phone size={14} />
                    <span>Gọi điện</span>
                  </a>
                  <a
                    href="https://zalo.me/0902371800"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="soft-button px-4 text-sm"
                  >
                    <MessageCircle size={14} />
                    <span>Zalo</span>
                  </a>
                </div>
              </div>

              {/* Technical 24/7 */}
              <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-700/80 flex items-center justify-between gap-3 text-xs">
                <div>
                  <h4 className="font-bold text-neutral-900 dark:text-white">Kỹ thuật Điện - Nước 24/7</h4>
                  <p className="text-neutral-500 dark:text-neutral-400 text-[11px] mt-0.5">Xử lý sự cố rò rỉ nước, mất điện phòng, chập điện khẩn cấp</p>
                </div>
                <a
                  href="tel:0902371800"
                  className="px-3.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold hover:bg-neutral-200 transition-colors shrink-0"
                >
                  0902 371 800
                </a>
              </div>

              {/* Emergency Numbers */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                <a
                  href="tel:114"
                  className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center block hover:border-rose-400 transition-colors"
                >
                  <span className="text-[10px] text-rose-500 uppercase font-bold block">Cứu hỏa PCCC</span>
                  <span className="text-lg font-black font-mono text-rose-600 dark:text-rose-400">114</span>
                </a>

                <a
                  href="tel:115"
                  className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center block hover:border-blue-400 transition-colors"
                >
                  <span className="text-[10px] text-blue-500 uppercase font-bold block">Cấp cứu Y tế</span>
                  <span className="text-lg font-black font-mono text-neutral-700 dark:text-neutral-200">115</span>
                </a>

                <a
                  href="tel:113"
                  className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-center block hover:border-neutral-400 transition-colors"
                >
                  <span className="text-[10px] text-neutral-400 uppercase font-bold block">Công an Cảnh sát</span>
                  <span className="text-lg font-black font-mono text-neutral-900 dark:text-white">113</span>
                </a>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="kit-dialog-footer shrink-0 p-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="soft-button min-h-11 px-5 text-sm"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}
