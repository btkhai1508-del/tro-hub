import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Receipt, FileText, User, Building2, PhoneCall, SlidersHorizontal, ChevronLeft, ChevronRight, LogOut, LayoutGrid, Copy, Check, ArrowUpRight } from 'lucide-react';
import { IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

const navItems = [
  { name: 'Trang chủ', path: '/', icon: Home, tutorial: 'nav-dashboard' },
  { name: 'Tiện ích', path: '/utilities', icon: LayoutGrid, tutorial: 'nav-utilities' },
  { name: 'Hóa đơn', path: '/invoices', icon: Receipt, tutorial: 'nav-invoices' },
  { name: 'Hợp đồng', path: '/contract', icon: FileText, tutorial: 'nav-contract' },
  { name: 'Cá nhân', path: '/profile', icon: User, tutorial: 'nav-profile' },
];

export function Sidebar() {
  const { profile, invoices, openProfileEditModal, isSidebarCollapsed, toggleSidebar, logoutUser } = useApp();
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  const [hasCopiedPhone, setHasCopiedPhone] = useState(false);
  const handleCopyPhone = async () => {
    try {
      await navigator.clipboard.writeText('0902371800');
      setHasCopiedPhone(true);
      setTimeout(() => setHasCopiedPhone(false), 2000);
    } catch { setHasCopiedPhone(false); }
  };

  return (
    <aside aria-label="Thanh điều hướng chính" className={cn('fixed bottom-5 left-5 top-5 z-40 hidden flex-col transition-[width] duration-300 lg:flex', isSidebarCollapsed ? 'w-[88px]' : 'w-[240px]')}>
      <div className={cn('liquid-panel flex h-full min-h-0 flex-col rounded-[32px] py-5', isSidebarCollapsed ? 'px-3' : 'px-4')}>
        <NavLink to="/" aria-label="Trọ-Hub · Trang chủ" className={cn('flex items-center gap-3 py-2', isSidebarCollapsed ? 'justify-center' : 'px-2')}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-white/55 dark:bg-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]">
            <IconHome3D size={58} />
          </div>
          {!isSidebarCollapsed && <div className="min-w-0"><span className="block text-[21px] font-bold tracking-[-0.06em] text-neutral-900 dark:text-white">trọ<span className="font-normal text-neutral-700 dark:text-neutral-200">hub.</span></span><span className="block text-xs font-medium tracking-wide text-neutral-700 dark:text-neutral-200">NHÀ TRỌ PHONG LAN</span></div>}
        </NavLink>

        <div className={cn('mb-5 mt-7', isSidebarCollapsed ? 'px-0' : 'px-3')}>
          {isSidebarCollapsed ? <div className="mx-auto h-px w-7 bg-neutral-200/70 dark:bg-white/10" /> : <span className="liquid-eyebrow">Không gian cư dân</span>}
        </div>
        <nav className="space-y-1.5" aria-label="Các trang cư dân">
          {navItems.map(({ name, path, icon: Icon, tutorial }) => (
            <NavLink key={path} to={path} end={path === '/'} data-tutorial={tutorial} title={isSidebarCollapsed ? name : undefined} aria-label={isSidebarCollapsed ? name : undefined} className={({ isActive }) => cn('group relative flex min-h-12 items-center gap-3 rounded-[18px] px-3 transition-all duration-200', isSidebarCollapsed && 'justify-center px-0', isActive ? 'bg-white/45 font-semibold text-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-white/12 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'font-medium text-neutral-700 hover:bg-white/55 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/5 dark:hover:text-white')}>
              {({ isActive }) => <><Icon size={20} strokeWidth={isActive ? 2.1 : 1.7} className="shrink-0" />{!isSidebarCollapsed && <span className="flex-1 text-[14px]">{name}</span>}{path === '/invoices' && unpaidCount > 0 && <span className={cn('flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-600 px-1 text-[10px] font-semibold text-white', isSidebarCollapsed && 'absolute right-0 top-0')}>{unpaidCount > 99 ? '99+' : unpaidCount}</span>}</>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-4 pt-6">
          <div data-tutorial="sidebar-bql-contact" className={cn('liquid-panel-subtle rounded-[22px]', isSidebarCollapsed ? 'flex flex-col items-center gap-3 py-3' : 'p-3.5')}>
            {isSidebarCollapsed ? <>
              <button type="button" onClick={handleCopyPhone} aria-label={hasCopiedPhone ? 'Đã sao chép số quản lý' : 'Sao chép số quản lý'} title="Sao chép số quản lý" className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-400/10">{hasCopiedPhone ? <Check size={19} /> : <PhoneCall size={19} />}</button>
              <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" aria-label="Nhắn Zalo cho quản lý" className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-600 text-xs font-semibold text-white">Z</a>
            </> : <>
              <div className="mb-3 flex items-center gap-2.5"><div className="glass-icon flex h-9 w-9 items-center justify-center rounded-xl text-neutral-700 dark:text-neutral-200"><PhoneCall size={17} /></div><div><p className="!text-[12px] font-semibold !text-neutral-800 dark:!text-neutral-200">Luôn sẵn sàng hỗ trợ</p><p className="!text-xs !text-neutral-700 dark:!text-neutral-200">Ban quản lý Phong Lan</p></div></div>
              <button type="button" onClick={handleCopyPhone} className="mb-3 flex w-full items-center justify-between text-[14px] font-semibold tracking-tight text-neutral-700 dark:text-neutral-200" aria-label="Sao chép số điện thoại quản lý"><span>0902 371 800</span>{hasCopiedPhone ? <Check size={14} className="text-emerald-600" /> : <Copy size={13} className="text-neutral-600 dark:text-neutral-300" />}</button>
              <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between border-t border-neutral-200/60 pt-3 text-[12px] font-semibold text-neutral-700 dark:border-white/10 dark:text-neutral-200"><span>Nhắn qua Zalo</span><ArrowUpRight size={15} /></a>
            </>}
          </div>

          <div className={cn('flex items-center gap-2 border-t border-neutral-200/60 pt-4 dark:border-white/10', isSidebarCollapsed && 'flex-col')}>
            <NavLink to="/profile" title={profile.name || 'Hồ sơ cá nhân'} aria-label="Hồ sơ cá nhân" className={cn('flex min-w-0 flex-1 items-center gap-2.5', isSidebarCollapsed && 'flex-none')}>
              {profile.avatar ? <img src={profile.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full border-2 border-white/80 object-cover shadow-sm dark:border-white/20" /> : <div className="glass-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-700 dark:text-neutral-200"><User size={19} /></div>}
              {!isSidebarCollapsed && <div className="min-w-0"><p className="truncate !text-[12px] font-semibold !text-neutral-900 dark:!text-white">{profile.name || 'Cư dân'}</p><span className="block truncate text-xs text-neutral-700 dark:text-neutral-200">{profile.room.roomNumber || 'Hồ sơ của bạn'}</span></div>}
            </NavLink>
            <div className={cn('flex shrink-0', isSidebarCollapsed && 'flex-col')}>
              <button type="button" onClick={openProfileEditModal} aria-label="Chỉnh sửa hồ sơ" title="Chỉnh sửa hồ sơ" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300 hover:bg-white/60 hover:text-neutral-900 dark:hover:bg-white/5 dark:hover:text-white"><SlidersHorizontal size={15} /></button>
              <button type="button" onClick={logoutUser} aria-label="Đăng xuất" title="Đăng xuất" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><LogOut size={15} /></button>
            </div>
          </div>
        </div>
        <button type="button" onClick={toggleSidebar} aria-label={isSidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} title={isSidebarCollapsed ? 'Mở rộng' : 'Thu gọn'} className="liquid-panel absolute -right-3.5 top-[95px] flex h-7 w-7 items-center justify-center rounded-full text-neutral-700 transition-colors hover:text-neutral-900 dark:text-neutral-200 dark:hover:text-white">{isSidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button>
      </div>
    </aside>
  );
}
