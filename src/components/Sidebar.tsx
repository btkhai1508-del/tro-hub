import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Receipt, FileText, User, PhoneCall, SlidersHorizontal, ChevronLeft, ChevronRight, LogOut, LayoutGrid, Copy, Check, ArrowUpRight } from 'lucide-react';
import { IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { preloadRoute } from '../lib/routePreload';
import { cn } from '../lib/utils';

function NavigationHome({ size = 21, className = '' }: { size?: number; strokeWidth?: number; className?: string }) { return <img src="/icons/home.svg" alt="" aria-hidden="true" width={size} height={size} className={className} />; }

const navItems = [
  { name: 'Trang chủ', path: '/', icon: NavigationHome, tutorial: 'nav-dashboard' },
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
    <aside aria-label="Thanh điều hướng chính" className={cn('kit-sidebar fixed bottom-4 left-4 top-4 z-40 hidden flex-col lg:flex', isSidebarCollapsed ? 'w-[105px]' : 'w-[260px]')}>
      <div className="kit-sidebar-panel h-full min-h-0">
        <div id="resident-sidebar-content" className={cn('kit-sidebar-scroll flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain py-5', isSidebarCollapsed ? 'px-3' : 'px-4')}>
          <div className={cn('mb-3 flex min-h-16 shrink-0 items-center gap-2', isSidebarCollapsed ? 'justify-center' : 'px-2')}>
            <NavLink to="/" aria-label="Trọ-Hub · Trang chủ" className={cn('flex min-w-0 flex-1 items-center gap-2.5', isSidebarCollapsed && 'justify-center')}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center">
                <IconHome3D size={52} />
              </div>
              {!isSidebarCollapsed && <div className="min-w-0"><span className="apple-title2 kit-text-primary block truncate whitespace-nowrap font-semibold">Trọ-Hub.</span><span className="apple-subheadline kit-text-secondary block truncate whitespace-nowrap">Nhà trọ Phong Lan</span></div>}
            </NavLink>
          </div>

          {!isSidebarCollapsed && <p className="apple-subheadline kit-text-secondary mb-2 px-3 font-semibold">Không gian cư dân</p>}
          <nav className="shrink-0 space-y-1" aria-label="Các trang cư dân">
            {navItems.map(({ name, path, icon: Icon, tutorial }) => (
              <NavLink key={path} to={path} onPointerEnter={() => preloadRoute(path)} onFocus={() => preloadRoute(path)} onPointerDown={() => preloadRoute(path)} end={path === '/'} data-tutorial={tutorial} title={isSidebarCollapsed ? name : undefined} aria-label={isSidebarCollapsed ? name : undefined} className={({ isActive }) => cn('kit-nav-item group relative flex min-h-11 items-center gap-3 rounded-xl px-3 apple-body', isSidebarCollapsed && 'justify-center px-0', isActive && 'kit-nav-active')}>
                {({ isActive }) => <><Icon size={19} strokeWidth={isActive ? 2 : 1.7} className="shrink-0" />{!isSidebarCollapsed && <span className="flex-1">{name}</span>}{path === '/invoices' && unpaidCount > 0 && <span className={cn('flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-800 px-1 apple-caption font-semibold text-white dark:bg-white dark:text-neutral-900', isSidebarCollapsed && 'absolute right-0 top-0')}>{unpaidCount > 99 ? '99+' : unpaidCount}</span>}</>}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto shrink-0 space-y-4 pb-4 pt-6">
            <div data-tutorial="sidebar-bql-contact" className={cn('kit-sidebar-support', isSidebarCollapsed ? 'flex flex-col items-center gap-1' : 'px-3')}>
              {isSidebarCollapsed ? <>
                <button type="button" onClick={handleCopyPhone} aria-label={hasCopiedPhone ? 'Đã sao chép số quản lý' : 'Sao chép số quản lý'} title="Sao chép số quản lý" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)]">{hasCopiedPhone ? <Check size={18} /> : <PhoneCall size={18} />}</button>
                <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" aria-label="Nhắn Zalo cho quản lý" title="Nhắn Zalo cho quản lý" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl"><img src="/brand/zalo-logo.png" alt="" className="h-6 w-6 object-contain" /></a>
              </> : <>
                <p className="apple-subheadline kit-text-secondary mb-2 font-semibold">Ban quản lý</p>
                <button type="button" onClick={handleCopyPhone} className="kit-toolbar-control -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-xl px-2 apple-body kit-text-secondary" aria-label={hasCopiedPhone ? 'Đã sao chép số điện thoại quản lý' : 'Sao chép số điện thoại quản lý'}><PhoneCall size={16} strokeWidth={1.7} /><span className="flex-1 text-left font-medium">0902 371 800</span>{hasCopiedPhone ? <Check size={14} /> : <Copy size={13} />}</button>
                <a href="https://zalo.me/0902371800" target="_blank" rel="noopener noreferrer" className="kit-toolbar-control -mx-2 flex min-h-11 items-center gap-2.5 rounded-xl px-2 apple-body kit-text-secondary"><img src="/brand/zalo-logo.png" alt="" className="h-5 w-5 object-contain" /><span className="flex-1">Nhắn qua Zalo</span><ArrowUpRight size={14} /></a>
              </>}
            </div>

            <div className={cn('flex items-center gap-2 border-t border-[var(--liquid-stroke)] pt-4', isSidebarCollapsed && 'flex-col')}>
              <NavLink to="/profile" title={profile.name || 'Hồ sơ cá nhân'} aria-label="Hồ sơ cá nhân" className={cn('kit-toolbar-control flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1', isSidebarCollapsed && 'flex-none')}>
                {profile.avatar ? <img src={profile.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--liquid-stroke)]" /> : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/40 text-[var(--text-secondary)] ring-1 ring-[var(--liquid-stroke)] dark:bg-white/10"><User size={17} /></div>}
                {!isSidebarCollapsed && <div className="min-w-0"><p className="apple-callout kit-text-primary truncate font-semibold">{profile.name || 'Cư dân'}</p><span className="apple-subheadline kit-text-secondary block truncate">{profile.room.roomNumber || 'Hồ sơ của bạn'}</span></div>}
              </NavLink>
              {!isSidebarCollapsed && <button type="button" onClick={openProfileEditModal} aria-label="Chỉnh sửa hồ sơ" title="Chỉnh sửa hồ sơ" className="kit-toolbar-control flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)]"><SlidersHorizontal size={16} strokeWidth={1.7} /></button>}
            </div>
            <div className={cn('flex items-center', isSidebarCollapsed ? 'flex-col gap-1' : 'justify-between px-1')}>
              {isSidebarCollapsed && <button type="button" onClick={openProfileEditModal} aria-label="Chỉnh sửa hồ sơ" title="Chỉnh sửa hồ sơ" className="kit-toolbar-control flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)]"><SlidersHorizontal size={17} strokeWidth={1.7} /></button>}
              <button type="button" onClick={logoutUser} aria-label="Đăng xuất" title="Đăng xuất" className={cn('kit-toolbar-control flex min-h-11 items-center justify-center gap-2 rounded-xl text-[var(--text-secondary)]', isSidebarCollapsed ? 'w-11' : 'px-2 apple-callout')}><LogOut size={16} strokeWidth={1.7} />{!isSidebarCollapsed && <span>Đăng xuất</span>}</button>
              {!isSidebarCollapsed && <span className="apple-caption kit-text-tertiary">Trọ-Hub</span>}
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={isSidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        title={isSidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        aria-expanded={!isSidebarCollapsed}
        aria-controls="resident-sidebar-content"
        className="kit-sidebar-toggle absolute -right-5 top-1/2 z-50 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white bg-white/95 text-neutral-700 shadow-md transition-[background-color,transform] duration-150 hover:scale-105 hover:text-neutral-900 active:scale-95 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        {isSidebarCollapsed ? <ChevronRight size={18} strokeWidth={2.5} /> : <ChevronLeft size={18} strokeWidth={2.5} />}
      </button>
    </aside>
  );
}
