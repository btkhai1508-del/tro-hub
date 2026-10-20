import React from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import {
  IconHome3D,
  IconMeter3D,
  IconWallet3D,
  IconCalendar3D,
  IconProfile3D
} from './Icons3D';
import { soundFx } from '../lib/soundFx';

interface NavItemDef {
  name: string;
  path: string;
  IconComponent: React.ComponentType<{ size?: number; className?: string }>;
}

const navItems: NavItemDef[] = [
  { name: 'Trang chủ', path: '/', IconComponent: IconHome3D },
  { name: 'Tiện ích', path: '/utilities', IconComponent: IconMeter3D },
  { name: 'Hóa đơn', path: '/invoices', IconComponent: IconWallet3D },
  { name: 'Hợp đồng', path: '/contract', IconComponent: IconCalendar3D },
  { name: 'Cá nhân', path: '/profile', IconComponent: IconProfile3D },
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
            className="relative flex flex-col items-center gap-0.5 py-1 px-2.5 touch-manipulation group min-w-[56px]"
          >
            {({ isActive }) => (
              <>
                <div className="relative p-0.5 transition-all duration-200">
                  <div className={cn(
                    "transition-all duration-200 shrink-0 flex items-center justify-center",
                    isActive ? "scale-110 -translate-y-0.5" : "opacity-75 group-hover:opacity-100 group-hover:scale-105"
                  )}>
                    <Icon size={28} />
                  </div>
                  
                  {/* Badge on invoice item */}
                  {item.path === '/invoices' && unpaidCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center font-num shadow-sm ring-2 ring-white dark:ring-slate-900">
                      {unpaidCount}
                    </span>
                  )}
                </div>

                <span className={cn(
                  "text-[10px] sm:text-[11px] font-medium transition-all duration-200 tracking-tight whitespace-nowrap",
                  isActive 
                    ? "text-slate-900 dark:text-white font-bold" 
                    : "text-slate-500 dark:text-slate-400"
                )}>
                  {item.name}
                </span>

                {/* Subtle active pill indicator */}
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-900 dark:bg-white mt-0.5" />
                )}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
