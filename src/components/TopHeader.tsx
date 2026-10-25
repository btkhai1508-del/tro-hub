import React, { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, CheckCheck, Receipt, AlertTriangle, CheckCircle2, MessageSquare, X, Sun, Moon, Monitor, Building2, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

const iconMap = { invoice: Receipt, alert: AlertTriangle, success: CheckCircle2, info: MessageSquare };
const badgeColorMap = {
  invoice: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  alert: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
};
const pageLabels: Record<string, string> = { '/': 'Tổng quan', '/utilities': 'Tiện ích', '/invoices': 'Hóa đơn', '/contract': 'Hợp đồng', '/profile': 'Cá nhân', '/laundry': 'Giặt sấy' };

export function TopHeader() {
  const { notifications, unreadNotiCount, isNotificationPanelOpen, setIsNotificationPanelOpen, openNotificationModal, markAllNotificationsAsRead } = useApp();
  const { mode, toggleTheme } = useTheme();
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node) && buttonRef.current && !buttonRef.current.contains(event.target as Node)) setIsNotificationPanelOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && isNotificationPanelOpen) {
        setIsNotificationPanelOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [setIsNotificationPanelOpen, isNotificationPanelOpen]);

  const themeLabel = mode === 'light' ? 'Giao diện sáng' : mode === 'dark' ? 'Giao diện tối' : 'Giao diện tự động';
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  return (
    <header className="relative z-40 mb-7 flex min-h-11 w-full items-center justify-between gap-3 sm:mb-9">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="glass-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] text-blue-600 dark:text-blue-400 lg:hidden"><Building2 size={19} strokeWidth={1.8} /></span>
        <span className="text-[17px] font-bold tracking-[-0.05em] text-slate-900 dark:text-white lg:hidden">trọ<span className="font-normal text-blue-600 dark:text-blue-400">hub.</span></span>
        <span className="hidden text-[13px] font-medium text-slate-500 dark:text-slate-400 lg:inline">Không gian cư dân</span>
        <ChevronRight size={13} className="hidden text-slate-400 lg:block" />
        <span className="hidden text-[13px] font-semibold text-slate-700 dark:text-slate-200 lg:inline">{pageLabels[location.pathname] || 'Trọ-Hub'}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={toggleTheme} className="liquid-panel flex h-11 items-center justify-center gap-2 rounded-full px-3 text-slate-600 transition-colors hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-300 sm:px-4" aria-label={`${themeLabel}. Bấm để đổi giao diện`} title={`${themeLabel} · Bấm để chuyển Sáng, Tối hoặc Tự động`}>
          <ThemeIcon size={17} strokeWidth={1.8} /><span className="hidden text-[12px] font-medium sm:inline">{themeLabel}</span>
        </button>
        <button ref={buttonRef} type="button" data-tutorial="header-notifications" onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)} className={cn('liquid-panel relative flex h-11 w-11 items-center justify-center rounded-full transition-colors', isNotificationPanelOpen ? 'text-blue-600 dark:text-blue-300' : 'text-slate-600 hover:text-blue-600 dark:text-slate-300')} aria-label={`Thông báo${unreadNotiCount > 0 ? `, ${unreadNotiCount} chưa đọc` : ''}`} aria-expanded={isNotificationPanelOpen} aria-controls="header-notification-panel" title="Thông báo">
          <Bell size={18} strokeWidth={1.8} />
          {unreadNotiCount > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-800" />}
        </button>
      </div>

      {isNotificationPanelOpen && <div ref={panelRef} id="header-notification-panel" aria-label="Danh sách thông báo" className="liquid-panel absolute right-0 top-[56px] z-50 w-[min(380px,calc(100vw-2rem))] space-y-3 rounded-[28px] p-4 animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 px-1 pb-3 dark:border-white/10">
          <div className="flex items-center gap-2"><h2 className="!text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">Thông báo</h2>{unreadNotiCount > 0 && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-300">{unreadNotiCount} mới</span>}</div>
          <div className="flex items-center gap-1">
            {unreadNotiCount > 0 && <button type="button" onClick={markAllNotificationsAsRead} className="flex min-h-9 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-300"><CheckCheck size={15} /><span>Đọc tất cả</span></button>}
            <button type="button" onClick={() => setIsNotificationPanelOpen(false)} aria-label="Đóng danh sách thông báo" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-500/10 dark:text-slate-400"><X size={17} /></button>
          </div>
        </div>
        <div className="max-h-[min(420px,65vh)] space-y-1 overflow-y-auto overscroll-contain">
          {notifications.length === 0 ? <div className="flex flex-col items-center px-3 py-9 text-center"><div className="glass-icon mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-blue-500"><Bell size={22} strokeWidth={1.5} /></div><p className="!text-[14px] font-semibold !text-slate-700 dark:!text-slate-200">Bạn đã cập nhật tất cả</p><p className="mt-1 max-w-[230px] !text-[12px] !text-slate-500 dark:!text-slate-400">Thông báo từ ban quản lý sẽ xuất hiện tại đây.</p></div> : notifications.map(notif => {
            const Icon = iconMap[notif.type] || Bell;
            return <button key={notif.id} type="button" onClick={() => { setIsNotificationPanelOpen(false); openNotificationModal(notif); }} className={cn('relative flex w-full gap-3 rounded-[20px] p-3 text-left transition-colors', notif.unread ? 'bg-blue-500/[0.055] hover:bg-blue-500/10 dark:bg-blue-400/[0.07]' : 'hover:bg-white/50 dark:hover:bg-white/5')}>
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]', badgeColorMap[notif.type])}><Icon size={18} strokeWidth={1.8} /></span>
              <span className="min-w-0 flex-1"><span className={cn('block pr-3 text-[13px] leading-snug text-slate-800 dark:text-slate-200', notif.unread ? 'font-semibold' : 'font-medium')}>{notif.title}</span><span className="mt-1 block line-clamp-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{notif.desc}</span><span className="mt-2 block text-[11px] text-slate-400 dark:text-slate-500">{notif.time}</span></span>
              {notif.unread && <span className="absolute right-3 top-4 h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </button>;
          })}
        </div>
      </div>}
    </header>
  );
}
