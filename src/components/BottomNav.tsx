import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LayoutGrid, Receipt, FileText, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

const navItems = [
  { name: 'Trang chủ', path: '/', icon: Home },
  { name: 'Tiện ích', path: '/utilities', icon: LayoutGrid },
  { name: 'Hóa đơn', path: '/invoices', icon: Receipt },
  { name: 'Hợp đồng', path: '/contract', icon: FileText },
  { name: 'Cá nhân', path: '/profile', icon: User },
];

export function BottomNav({ className }: { className?: string }) {
  const { invoices } = useApp();
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;

  return (
    <nav className={cn("px-4 py-3 flex items-center justify-around", className)}>
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

        return (
          <NavLink
            key={item.path}
            to={item.path}
            data-tutorial={tutorialAttr}
            className="relative flex flex-col items-center gap-1 py-1 px-3 touch-manipulation"
          >
          {({ isActive }) => (
            <>
              <div className="relative p-1 transition-all duration-200">
                <item.icon 
                  size={22} 
                  className={cn(
                    "transition-all duration-200 shrink-0", 
                    isActive 
                      ? "stroke-[2.4] text-slate-900 dark:text-white scale-110 drop-shadow-[0_2px_8px_rgba(99,102,241,0.25)]" 
                      : "stroke-2 text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  )} 
                />
                
                {/* Badge on invoice item */}
                {item.path === '/invoices' && unpaidCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center font-num shadow-sm">
                    {unpaidCount}
                  </span>
                )}
              </div>

              <span className={cn(
                "text-[11px] font-medium transition-all duration-200 tracking-tight",
                isActive ? "text-slate-900 dark:text-white font-bold" : "text-slate-500 dark:text-slate-400"
              )}>
                {item.name}
              </span>
            </>
          )}
        </NavLink>
        );
      })}
    </nav>
  );
}
