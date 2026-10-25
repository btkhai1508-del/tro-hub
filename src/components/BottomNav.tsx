import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Receipt, FileText, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
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
    <nav aria-label="Điều hướng chính" className={cn('liquid-panel flex items-center gap-0.5 rounded-full p-1.5', className)}>
      {navItems.map(({ name, path, Icon, tutorial }) => <NavLink key={path} to={path} end={path === '/'} data-tutorial={tutorial} className={({ isActive }) => cn('relative flex min-h-[56px] min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-full px-1 transition-colors duration-200', isActive ? 'bg-blue-500/10 text-blue-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:bg-blue-400/15 dark:text-blue-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-slate-500 hover:bg-white/40 dark:text-slate-400 dark:hover:bg-white/5')}>
        {({ isActive }) => <><span className="relative"><Icon size={21} strokeWidth={isActive ? 2.2 : 1.7} />{path === '/invoices' && unpaidCount > 0 && <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white/80 dark:ring-slate-800">{unpaidCount > 9 ? '9+' : unpaidCount}</span>}</span><span className={cn('whitespace-nowrap text-[10px] tracking-tight', isActive ? 'font-semibold' : 'font-medium')}>{name}</span></>}
      </NavLink>)}
    </nav>
  );
}
