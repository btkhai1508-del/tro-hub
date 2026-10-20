import React from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { Home, LayoutGrid, Receipt, FileText, User } from 'lucide-react';
import { soundFx } from '../lib/soundFx';

interface NavItemDef {
  name: string;
  path: string;
  IconComponent: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

const navItems: NavItemDef[] = [
  { name: 'Trang chủ', path: '/', IconComponent: Home },
  { name: 'Tiện ích', path: '/utilities', IconComponent: LayoutGrid },
  { name: 'Hóa đơn & Thanh toán', path: '/invoices', IconComponent: Receipt },
  { name: 'Hợp đồng', path: '/contract', IconComponent: FileText },
  { name: 'Cá nhân', path: '/profile', IconComponent: User },
];

export function BottomNav({ className }: { className?: string }) {
  const { invoices } = useApp();
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;

  return (
    <nav className={cn("px-2 sm:px-4 py-2 flex items-center justify-around", className)}>
      {navItems.map((item) => {
        const tutorialAttr = item.path === '/' 
          ? 'nav-dashboard-mobile' 
          : item.path === '/utilities' 
          ? 'nav-utilities-mobile' 
          : item.path === '/invoices'
          ? 'nav-invoices-mobile'
          : item.path === '/contract'
          ? 'nav-contract-mobile'
          : 'nav-profile-mobile';

        const Icon = item.IconComponent;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            data-tutorial={tutorialAttr}
            onClick={() => soundFx.tab()}
            className="relative flex flex-col items-center gap-1 py-1 px-2 touch-manipulation group min-w-[56px]"
          >
            {({ isActive }) => (
              <>
                <div className="relative p-0.5 transition-all duration-200">
                  <div className={cn(
                    "transition-all duration-200 shrink-0 flex items-center justify-center",
                    isActive 
                      ? "text-slate-900 dark:text-white scale-110" 
                      : "text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300"
                  )}>
                    <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} />
                  </div>
                  
                  {/* Badge on invoice item */}
                  {item.path === '/invoices' && unpaidCount > 0 && (
                    <span className="absolute -top-1 -right-2 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center font-num shadow-sm ring-2 ring-white dark:ring-slate-900">
                      {unpaidCount}
                    </span>
                  )}
                </div>

                <span className={cn(
                  "text-[10px] font-medium transition-all duration-200 tracking-tight whitespace-nowrap text-center max-w-[70px] truncate",
                  isActive 
                    ? "text-slate-900 dark:text-white font-bold" 
                    : "text-slate-400 dark:text-slate-500"
                )}>
                  {item.name === 'Hóa đơn & Thanh toán' ? 'Hóa đơn' : item.name}
                </span>

                {/* Active pill dot */}
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-slate-900 dark:bg-white" />
                )}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
