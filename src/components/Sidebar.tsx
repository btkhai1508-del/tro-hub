import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Receipt, FileText, User, PhoneCall, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, LogOut, LayoutGrid, Copy, Check, ArrowUpRight } from 'lucide-react';
import { IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { preloadRoute } from '../lib/routePreload';
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
    <aside aria-label="Thanh điều hướng chính" className={cn('kit-sidebar fixed bottom-4 left-4 top-4 z-40 hidden flex-col lg:flex', isSidebarCollapsed ? 'w-20 px-2' : 'w-[232px] px-3')}>
      <div className={cn('flex min-h-[84px] items-center gap-2', isSidebarCollapsed ? 'justify-center' : 'px-2')}>
        <NavLink to="/" aria-label="Trọ-Hub · Trang chủ" className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center">
            <IconHome3D size={52} />
          </div>
          {!isSidebarCollapsed && <div className="min-w-0"><span className="block text-[19px] font-semibold tracking-[-0.045em] text-[var(--text-primary)]">Trọ-Hub.</span><span className="block text-[11px] text-[var(--text-secondary)]">Nhà trọ Phong Lan</span></div>}
        </NavLink>
        {!isSidebarCollapsed && <button type="button" onClick={toggleSidebar} aria-label="Thu gọn thanh điều hướng" title="Thu gọn thanh điều hướng" className="kit-toolbar-control -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)]"><PanelLeftClose size={18} strokeWidth={1.7} /></button>}
      </div>

      {isSidebarCollapsed ? <button type="button" onClick={toggleSidebar} aria-label="Mở rộng thanh điều hướng" title="Mở rộng thanh điều hướng" className="kit-toolbar-control mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)]"><PanelLeftOpen size={18} strokeWidth={1.7} /></button> : <p className="mb-2 mt-3 px-3 !text-[11px] font-semibold !text-[var(--text-tertiary)]">Không gian cư dân</p>}
      <nav className="space-y-1" aria-label="Các trang cư dân">
        {navItems.map(({ name, path, icon: Icon, tutorial }) => (
          <NavLink key={path} to={path} onPointerEnter={() => preloadRoute(path)} onFocus={() => preloadRoute(path)} onPointerDown={() => preloadRoute(path)} end={path === '/'} data-tutorial={tutorial} title={isSidebarCollapsed ? name : undefined} aria-label={isSidebarCollapsed ? name : undefined} className={({ isActive }) => cn('kit-nav-item group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px]', isSidebarCollapsed && 'justify-center px-0', isActive && 'kit-nav-active')}>
            {({ isActive }) => <><Icon size={19} strokeWidth={isActive ? 2 : 1.7} className="shrink-0" />{!isSidebarCollapsed && <span className="flex-1">{name}</span>}{path === '/invoices' && unpaidCount > 0 && <span className={cn('flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-800 px-1 text-[10px] font-semibold text-white dark:bg-white dark:text-neutral-900', isSidebarCollapsed && 'absolute right-0 top-0')}>{unpaidCount > 99 ? '99+' : unpaidCount}</span>}</>}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-4 pb-4 pt-6">
        <div data-tutorial="sidebar-bql-contact" className={cn('kit-sidebar-support', isSidebarCollapsed ? 'flex flex-col items-center gap-1' : 'px-3')}>
          {isSidebarCollapsed ? <>
            <button type="button" onClick={handleCopyPhone} aria-label={hasCopiedPhone ? 'Đã sao chép số quản lý' : 'Sao chép số quản lý'} title="Sao chép số quản lý" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)]">{hasCopiedPhone ? <Check size={18} /> : <PhoneCall size={18} />}</button>
            <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" aria-label="Nhắn Zalo cho quản lý" title="Nhắn Zalo cho quản lý" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl"><img src="/brand/zalo-logo.png" alt="" className="h-6 w-6 object-contain" /></a>
          </> : <>
            <p className="mb-2 !text-[11px] font-semibold !text-[var(--text-tertiary)]">Ban quản lý</p>
            <button type="button" onClick={handleCopyPhone} className="kit-toolbar-control -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-xl px-2 text-[13px] text-[var(--text-secondary)]" aria-label={hasCopiedPhone ? 'Đã sao chép số điện thoại quản lý' : 'Sao chép số điện thoại quản lý'}><PhoneCall size={16} strokeWidth={1.7} /><span className="flex-1 text-left font-medium">0902 371 800</span>{hasCopiedPhone ? <Check size={14} /> : <Copy size={13} />}</button>
            <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" className="kit-toolbar-control -mx-2 flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-[13px] text-[var(--text-secondary)]"><img src="/brand/zalo-logo.png" alt="" className="h-5 w-5 object-contain" /><span className="flex-1">Nhắn qua Zalo</span><ArrowUpRight size={14} /></a>
          </>}
        </div>

        <div className={cn('flex items-center gap-2 border-t border-[var(--liquid-stroke)] pt-4', isSidebarCollapsed && 'flex-col')}>
          <NavLink to="/profile" title={profile.name || 'Hồ sơ cá nhân'} aria-label="Hồ sơ cá nhân" className={cn('kit-toolbar-control flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1', isSidebarCollapsed && 'flex-none')}>
            {profile.avatar ? <img src={profile.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--liquid-stroke)]" /> : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/40 text-[var(--text-secondary)] ring-1 ring-[var(--liquid-stroke)] dark:bg-white/10"><User size={17} /></div>}
            {!isSidebarCollapsed && <div className="min-w-0"><p className="truncate !text-[12px] font-semibold !text-[var(--text-primary)]">{profile.name || 'Cư dân'}</p><span className="block truncate text-[11px] text-[var(--text-secondary)]">{profile.room.roomNumber || 'Hồ sơ của bạn'}</span></div>}
          </NavLink>
          {!isSidebarCollapsed && <button type="button" onClick={openProfileEditModal} aria-label="Chỉnh sửa hồ sơ" title="Chỉnh sửa hồ sơ" className="kit-toolbar-control flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)]"><SlidersHorizontal size={16} strokeWidth={1.7} /></button>}
        </div>
        <div className={cn('flex items-center', isSidebarCollapsed ? 'flex-col gap-1' : 'justify-between px-1')}>
          {isSidebarCollapsed && <button type="button" onClick={openProfileEditModal} aria-label="Chỉnh sửa hồ sơ" title="Chỉnh sửa hồ sơ" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)]"><SlidersHorizontal size={17} strokeWidth={1.7} /></button>}
          <button type="button" onClick={logoutUser} aria-label="Đăng xuất" title="Đăng xuất" className={cn('kit-toolbar-control flex min-h-11 items-center justify-center gap-2 rounded-xl text-[var(--text-secondary)]', isSidebarCollapsed ? 'w-11' : 'px-2 text-[12px]')}><LogOut size={16} strokeWidth={1.7} />{!isSidebarCollapsed && <span>Đăng xuất</span>}</button>
          {!isSidebarCollapsed && <span className="text-[10px] text-[var(--text-tertiary)]">Trọ-Hub</span>}
        </div>
      </div>
    </aside>
  );
}
