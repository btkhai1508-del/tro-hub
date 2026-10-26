import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Receipt, FileText, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { preloadRoute } from '../lib/routePreload';
import { cn } from '../lib/utils';

const navItems = [
  { name: 'Trang chủ', path: '/', Icon: Home, tutorial: 'nav-dashboard-mobile' },
  { name: 'Tiện ích', path: '/utilities', Icon: LayoutGrid, tutorial: 'nav-utilities-mobile' },
  { name: 'Hóa đơn', path: '/invoices', Icon: Receipt, tutorial: 'nav-invoices-mobile' },
  { name: 'Hợp đồng', path: '/contract', Icon: FileText, tutorial: 'nav-contract-mobile' },
  { name: 'Cá nhân', path: '/profile', Icon: User, tutorial: 'nav-profile-mobile' },
];

export function BottomNav({ className }: { className?: string }) {
  const { invoices } = useApp();
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  return (
    <nav aria-label="Điều hướng chính" className={cn('kit-dock flex items-center gap-1 rounded-full p-1.5', className)}>
      {navItems.map(({ name, path, Icon, tutorial }) => <NavLink key={path} to={path} onPointerEnter={() => preloadRoute(path)} onFocus={() => preloadRoute(path)} onPointerDown={() => preloadRoute(path)} end={path === '/'} data-tutorial={tutorial} className={({ isActive }) => cn('kit-nav-item relative flex min-h-[54px] min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-full px-0.5', isActive && 'kit-nav-active')}>
        {({ isActive }) => <><span className="relative flex items-center justify-center"><Icon size={20} strokeWidth={isActive ? 2.2 : 1.7} />{path === '/invoices' && unpaidCount > 0 && <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-xs ring-2 ring-white/80 dark:ring-neutral-800">{unpaidCount > 9 ? '9+' : unpaidCount}</span>}</span><span className={cn('text-[11px] leading-tight whitespace-nowrap transition-colors', isActive ? 'font-semibold text-neutral-900 dark:text-white' : 'font-medium text-neutral-600 dark:text-neutral-400')}>{name}</span></>}
      </NavLink>)}
    </nav>
  );
}
