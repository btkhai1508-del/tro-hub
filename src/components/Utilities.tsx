import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { 
  IconHome3D, 
  IconWallet3D, 
  IconMeter3D,
  IconVehicle3D,
  IconWifi3D,
  IconMaintenance3D,
  IconDeclaration3D,
  IconHandbook3D,
  IconSupport3D,
  IconKey3D,
  IconGuide3D,
  IconContract3D
} from './Icons3D';
import { PasswordUpdateModal } from './PasswordUpdateModal';
import { UtilityDetailModal, UtilityModalType } from './UtilityDetailModal';

type CategoryFilter = 'all' | 'essential' | 'services' | 'admin';

export function Utilities() {
  const navigate = useNavigate();
  const { 
    profile, 
    invoices, 
    openContractModal,
    openTourGuide 
  } = useApp();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [activeModalType, setActiveModalType] = useState<UtilityModalType>(null);
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
  const unpaidCount = unpaidInvoices.length;

  const utilitiesList = [
    {
      id: 'meter',
      title: 'Điện & Nước',
      desc: 'Chỉ số điện nước & đơn giá',
      category: 'essential',
      Icon: IconMeter3D,
      badge: 'Chốt ngày 25',
      action: () => setActiveModalType('meter')
    },
    {
      id: 'vehicle',
      title: 'Thẻ xe & Bãi đỗ',
      desc: `${profile.vehicle.plateNumber || '59-X1 888.88'} · Hầm B1`,
      category: 'essential',
      Icon: IconVehicle3D,
      badge: 'Thẻ Active',
      action: () => setActiveModalType('vehicle')
    },
    {
      id: 'wifi',
      title: 'Wifi & Internet',
      desc: 'Mật khẩu & kết nối nhanh',
      category: 'essential',
      Icon: IconWifi3D,
      badge: '300 Mbps',
      action: () => setActiveModalType('wifi')
    },
    {
      id: 'invoices',
      title: 'Hóa đơn tiền phòng',
      desc: unpaidCount > 0 ? `${unpaidCount} hóa đơn cần đóng` : 'Đã thanh toán',
      category: 'services',
      Icon: IconWallet3D,
      badge: unpaidCount > 0 ? `${unpaidCount} chưa nộp` : undefined,
      badgeColor: unpaidCount > 0 ? 'bg-rose-500 text-white' : undefined,
      action: () => navigate('/invoices')
    },
    {
      id: 'maintenance',
      title: 'Báo hỏng & Sửa chữa',
      desc: 'Điện nước, máy lạnh, thiết bị',
      category: 'services',
      Icon: IconMaintenance3D,
      badge: 'Hỗ trợ 24/7',
      action: () => setActiveModalType('maintenance')
    },
    {
      id: 'contract',
      title: 'Hợp đồng thuê phòng',
      desc: 'Hợp đồng điện tử 12 tháng',
      category: 'admin',
      Icon: IconContract3D,
      badge: 'Hiệu lực',
      action: () => openContractModal()
    },
    {
      id: 'declaration',
      title: 'Khai báo tạm trú (CT01)',
      desc: 'Thủ tục VNeID & Công an',
      category: 'admin',
      Icon: IconDeclaration3D,
      badge: 'Mẫu BCA',
      action: () => setActiveModalType('declaration')
    },
    {
      id: 'rules',
      title: 'Nội quy & PCCC',
      desc: 'Giờ giấc, an ninh, lối thoát nạn',
      category: 'admin',
      Icon: IconHandbook3D,
      badge: 'Quy chuẩn',
      action: () => setActiveModalType('rules')
    },
    {
      id: 'hotline',
      title: 'Hotline Ban quản lý',
      desc: 'Bùi Trung Khải · 0902 371 800',
      category: 'admin',
      Icon: IconSupport3D,
      badge: 'Gọi / Zalo',
      action: () => setActiveModalType('hotline')
    },
    {
      id: 'password',
      title: 'Đổi mật khẩu',
      desc: 'Bảo mật tài khoản cư dân',
      category: 'services',
      Icon: IconKey3D,
      badge: undefined,
      action: () => setIsPasswordModalOpen(true)
    },
    {
      id: 'guide',
      title: 'Hướng dẫn sử dụng',
      desc: 'Tour khám phá tính năng',
      category: 'services',
      Icon: IconGuide3D,
      badge: undefined,
      action: () => openTourGuide()
    }
  ];

  const filteredUtilities = utilitiesList.filter(item => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

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
            Chỉ số điện nước, thẻ xe, internet wifi, báo hỏng sửa chữa và thủ tục lưu trú.
          </p>
        </div>

        {/* Quick Room badge matching site template */}
        <div className="flex items-center gap-3">
          <div className="soft-card px-4 py-2 flex items-center gap-3.5">
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

      {/* Filter Tabs (Functional segmented controls) */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 dark:bg-slate-850 rounded-xl overflow-x-auto">
        {[
          { key: 'all', label: 'Tất cả tiện ích' },
          { key: 'essential', label: 'Thiết yếu (Điện, Nước, Xe, Wifi)' },
          { key: 'services', label: 'Dịch vụ & Hỗ trợ' },
          { key: 'admin', label: 'Hợp đồng & Pháp lý' }
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveFilter(tab.key as CategoryFilter)}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer",
              activeFilter === tab.key
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 3D Utility Cards Grid */}
      <div data-tutorial="utilities-grid" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3.5 sm:gap-4">
        {filteredUtilities.map((item) => {
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              className="group relative flex flex-col items-center text-center justify-between p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#121927] border border-slate-200/90 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.03)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)] hover:shadow-md hover:-translate-y-1 active:translate-y-0 transition-all duration-200 cursor-pointer min-h-[155px] sm:min-h-[168px]"
            >
              {/* Optional Chip/Badge */}
              {item.badge && (
                <span className={cn(
                  "absolute top-2.5 right-2.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full font-num shadow-2xs",
                  item.badgeColor 
                    ? item.badgeColor 
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                )}>
                  {item.badge}
                </span>
              )}

              {/* 3D Icon Container */}
              <div className="mt-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                <Icon size={52} className="shrink-0 drop-shadow-sm" />
              </div>

              {/* Text Content */}
              <div className="w-full mt-2.5">
                <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {item.title}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1 leading-snug">
                  {item.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

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
