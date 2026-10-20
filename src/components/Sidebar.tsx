import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, 
  Receipt, 
  FileText, 
  User, 
  Building2, 
  PhoneCall, 
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  LogOut,
  LayoutGrid,
  Copy,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { soundFx } from '../lib/soundFx';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  IconComponent?: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

const defaultNavItems: NavItem[] = [
  { name: 'Trang chủ', path: '/', icon: Home, IconComponent: Home },
  { name: 'Tiện ích', path: '/utilities', icon: LayoutGrid, IconComponent: LayoutGrid },
  { name: 'Hóa đơn & Thanh toán', path: '/invoices', icon: Receipt, IconComponent: Receipt },
  { name: 'Hợp đồng', path: '/contract', icon: FileText, IconComponent: FileText },
  { name: 'Cá nhân', path: '/profile', icon: User, IconComponent: User },
];

export function Sidebar() {
  const { profile, invoices, openProfileEditModal, isSidebarCollapsed, toggleSidebar, logoutUser } = useApp();
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  const [hasCopiedPhone, setHasCopiedPhone] = useState(false);

  const handleCopyPhone = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    navigator.clipboard.writeText('0902371800');
    setHasCopiedPhone(true);
    setTimeout(() => setHasCopiedPhone(false), 2000);
  };

  const navItems = defaultNavItems;

  return (
    <aside 
      className={cn(
        "hidden lg:flex flex-col fixed left-4 top-4 bottom-4 z-40 transition-all duration-300 ease-out select-none",
        isSidebarCollapsed ? "w-[105px]" : "w-[260px]"
      )}
    >
      {/* Neumorphic Glass Sidebar Surface */}
      <div className={cn(
        "relative w-full h-full bg-white/85 dark:bg-[#101726]/90 backdrop-blur-[16px] border border-white/80 dark:border-white/10 shadow-[8px_8px_24px_rgba(166,175,195,0.2),-8px_-8px_24px_rgba(255,255,255,0.95)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.6)] rounded-[31px] flex flex-col justify-between py-6 transition-all duration-300",
        isSidebarCollapsed ? "px-3 items-center" : "px-4"
      )}>
        
        {/* Toggle Arrow Button */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 dark:bg-slate-800 backdrop-blur-md border border-white dark:border-slate-700 shadow-md hover:scale-105 active:scale-95 text-slate-700 dark:text-slate-200 hover:text-slate-900 flex items-center justify-center transition-all z-50 cursor-pointer"
          title={isSidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          aria-label={isSidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
        >
          {isSidebarCollapsed ? (
            <ChevronRight size={18} className="stroke-[2.5]" />
          ) : (
            <ChevronLeft size={18} className="stroke-[2.5]" />
          )}
        </button>

        {/* Top Header & Brand */}
        <div className="w-full">
          {isSidebarCollapsed ? (
            /* Collapsed Logo */
            <div className="flex justify-center mb-7 w-full">
              <div 
                className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center shadow-md shadow-slate-900/15 cursor-pointer hover:scale-105 transition-transform"
                title={`Nhà Trọ Phong Lan - Phòng ${profile.room.roomNumber}`}
              >
                <Building2 size={24} className="text-white" />
              </div>
            </div>
          ) : (
            /* Expanded Brand Header */
            <div className="flex items-center gap-3 px-1 mb-7">
              <div className="w-11 h-11 rounded-2xl bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center shadow-md shadow-slate-900/15 shrink-0">
                <Building2 size={22} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white truncate">Phong Lan</span>
                  {profile.room.roomNumber ? (
                    <span className="px-1.5 py-0.2 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded-md font-num border border-emerald-100 dark:border-emerald-800/40">
                      {profile.room.roomNumber}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-400 font-medium truncate">
                  {profile.room.building || 'Trung Kim'}
                </p>
              </div>
            </div>
          )}

          {/* Navigation Links with Pure Morphic Glass Icons */}
          <nav className={cn(
            "w-full transition-all duration-300",
            isSidebarCollapsed ? "flex flex-col items-center space-y-3.5" : "space-y-1.5"
          )}>
            {navItems.map((item) => {
              const Icon = item.icon || (item as any).IconComponent;
              const tutorialAttr = item.path === '/' 
                ? 'nav-dashboard' 
                : item.path === '/utilities' 
                ? 'nav-utilities' 
                : item.path === '/invoices'
                ? 'nav-invoices'
                : item.path === '/contract'
                ? 'nav-contract'
                : 'nav-profile';

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  data-tutorial={tutorialAttr}
                  title={isSidebarCollapsed ? item.name : undefined}
                  onClick={() => soundFx.tab()}
                  className={({ isActive }) => cn(
                    "group relative transition-all duration-200 select-none cursor-pointer",
                    isSidebarCollapsed 
                      ? "w-12 h-12 rounded-2xl flex items-center justify-center mx-auto" 
                      : "w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl",
                    isActive 
                      ? "bg-slate-900 dark:bg-slate-800 text-white shadow-md shadow-slate-900/15 font-semibold" 
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/60 font-medium"
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isSidebarCollapsed ? (
                        /* Collapsed Icon */
                        <div className="relative flex items-center justify-center w-full h-full">
                          <div className={cn("transition-transform duration-200 shrink-0", isActive ? "scale-110" : "group-hover:scale-105")}>
                            <Icon size={20} strokeWidth={2} />
                          </div>

                          {(item.path === '/invoices' || item.path === '/utilities') && unpaidCount > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center font-num shadow-xs ring-2 ring-white dark:ring-slate-900">
                              {unpaidCount}
                            </span>
                          )}
                        </div>
                      ) : (
                        /* Expanded Full Row */
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn("transition-transform duration-200 shrink-0", isActive ? "scale-105" : "group-hover:scale-105")}>
                              <Icon size={20} strokeWidth={2} />
                            </div>
                            <span className="text-sm tracking-tight truncate">{item.name}</span>
                          </div>

                          {(item.path === '/invoices' || item.path === '/utilities') && unpaidCount > 0 && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full font-num shadow-xs",
                              isActive ? "bg-rose-500 text-white" : "bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400"
                            )}>
                              {unpaidCount}
                            </span>
                          )}
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: Hotline & Resident Profile */}
        <div className="w-full space-y-3 pt-3 border-t border-slate-900/5 dark:border-white/10">
          {/* Hotline & BQL Contact Card */}
          {isSidebarCollapsed ? (
            <div 
              data-tutorial="sidebar-bql-contact" 
              className="flex flex-col items-center gap-1.5 w-full"
            >
              <button 
                type="button"
                onClick={handleCopyPhone}
                title="Sao chép SĐT BQL Bùi Trung Khải (0902 371 800)"
                className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800/40 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100/80 dark:hover:bg-blue-900/60 transition-colors shadow-2xs relative cursor-pointer"
              >
                {hasCopiedPhone ? <Check size={16} className="text-emerald-600" /> : <PhoneCall size={18} />}
              </button>
              <a
                href="https://zalo.me/0902371800"
                target="_blank"
                rel="noopener noreferrer"
                title="Nhắn tin Zalo với Bùi Trung Khải"
                className="w-8 h-8 rounded-xl bg-[#0068FF] hover:bg-[#0055d4] active:scale-90 text-white flex items-center justify-center text-[10px] font-black shadow-xs transition-transform cursor-pointer"
              >
                Z
              </a>
            </div>
          ) : (
            <div 
              data-tutorial="sidebar-bql-contact"
              className="p-2.5 rounded-2xl bg-slate-50/80 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-800/40">
                  <PhoneCall size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 font-medium truncate">BQL: Bùi Trung Khải</p>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    title="Bấm để sao chép số điện thoại"
                    className="text-xs font-bold font-num text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>0902 371 800</span>
                    {hasCopiedPhone ? (
                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded">Đã chép</span>
                    ) : (
                      <Copy size={11} className="text-slate-400 hover:text-blue-500 shrink-0" />
                    )}
                  </button>
                </div>
              </div>

              {/* Nút chuyển sang Zalo của Bùi Trung Khải */}
              <a
                href="https://zalo.me/0902371800"
                target="_blank"
                rel="noopener noreferrer"
                title="Nhắn tin Zalo với Bùi Trung Khải (0902 371 800)"
                className="h-7 px-2 rounded-xl bg-[#0068FF] hover:bg-[#0055d4] active:scale-95 text-white flex items-center gap-1 text-[10px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
              >
                <span>Zalo</span>
              </a>
            </div>
          )}

          {/* User Profile Capsule */}
          {isSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2 w-full">
              <NavLink 
                to="/profile"
                className="w-11 h-11 rounded-2xl ring-2 ring-white dark:ring-slate-700 shadow-xs overflow-hidden flex items-center justify-center hover:ring-blue-300 transition-all cursor-pointer"
                title={`Hồ sơ: ${profile.name}`}
              >
                <img 
                  src={profile.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'} 
                  alt={profile.name} 
                  className="w-full h-full object-cover"
                />
              </NavLink>
              <button
                type="button"
                onClick={logoutUser}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                title="Đăng xuất"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-2 rounded-2xl bg-white/60 dark:bg-slate-800/80 border border-white/80 dark:border-slate-700/60 shadow-2xs">
              <NavLink 
                to="/profile" 
                className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-85 transition-opacity"
              >
                <img 
                  src={profile.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'} 
                  alt={profile.name} 
                  className="w-9 h-9 rounded-xl object-cover ring-2 ring-white dark:ring-slate-700 shadow-xs shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{profile.name}</p>
                  <p className="text-[10px] text-slate-400 font-num truncate">
                    {profile.room.roomNumber ? (profile.room.roomNumber.startsWith('P.') ? profile.room.roomNumber : `P. ${profile.room.roomNumber}`) : profile.phone}
                  </p>
                </div>
              </NavLink>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={openProfileEditModal}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
                  title="Cài đặt thông tin"
                >
                  <SlidersHorizontal size={14} />
                </button>
                <button
                  type="button"
                  onClick={logoutUser}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                  title="Đăng xuất"
                >
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </aside>
  );
}
