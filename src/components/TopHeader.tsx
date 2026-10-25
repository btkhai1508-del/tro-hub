import React, { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, CheckCheck, Receipt, AlertTriangle, CheckCircle2, MessageSquare, X, Sun, Moon, Monitor, ChevronRight } from 'lucide-react';
import { IconClock3D, IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

const iconMap = { invoice: Receipt, alert: AlertTriangle, success: CheckCircle2, info: MessageSquare };
const badgeColorMap = {
  invoice: 'bg-black/5 kit-text-secondary dark:bg-white/10',
  alert: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  info: 'bg-black/5 kit-text-secondary dark:bg-white/10',
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
    <header className="kit-toolbar relative z-40 flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center lg:hidden"><IconHome3D size={44} /></span>
        <div className="min-w-0 lg:hidden"><span className="apple-title2 kit-text-primary block font-semibold">Trọ-Hub.</span><span className="apple-subheadline kit-text-secondary block truncate">{pageLabels[location.pathname] || 'Không gian cư dân'}</span></div>
        <span className="apple-body kit-text-secondary hidden xl:inline">Không gian cư dân</span>
        <ChevronRight size={13} className="hidden text-[var(--text-tertiary)] xl:block" />
        <span className="apple-title2 kit-text-primary hidden truncate font-semibold lg:inline">{pageLabels[location.pathname] || 'Trọ-Hub'}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={toggleTheme} className="kit-toolbar-control flex h-11 items-center justify-center gap-2 rounded-full px-3 text-[var(--text-secondary)] sm:px-3.5" aria-label={`${themeLabel}. Bấm để đổi giao diện`} title={`${themeLabel} · Bấm để chuyển Sáng, Tối hoặc Tự động`}>
          {mode === 'auto' ? <IconClock3D size={24} /> : <ThemeIcon size={17} strokeWidth={1.8} />}<span className="apple-callout hidden font-medium sm:inline">{themeLabel}</span>
        </button>
        <button ref={buttonRef} type="button" data-tutorial="header-notifications" onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)} className={cn('kit-toolbar-control relative flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-secondary)]', isNotificationPanelOpen && 'kit-nav-active')} aria-label={`Thông báo${unreadNotiCount > 0 ? `, ${unreadNotiCount} chưa đọc` : ''}`} aria-expanded={isNotificationPanelOpen} aria-controls="header-notification-panel" title="Thông báo">
          <Bell size={18} strokeWidth={1.8} />
          {unreadNotiCount > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-neutral-800" />}
        </button>
      </div>

      {isNotificationPanelOpen && <div ref={panelRef} id="header-notification-panel" aria-label="Danh sách thông báo" className="liquid-panel kit-popover absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[calc(100svh_-_8rem)] w-[min(380px,calc(100vw-2rem))] flex-col space-y-3 overflow-y-auto rounded-[26px] p-4 animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] px-1 pb-3">
          <div className="flex items-center gap-2"><h2 className="apple-title2 kit-text-primary font-semibold">Thông báo</h2>{unreadNotiCount > 0 && <span className="apple-subheadline kit-text-secondary rounded-full bg-black/5 px-2 py-0.5 font-semibold dark:bg-white/10">{unreadNotiCount} mới</span>}</div>
          <div className="flex items-center gap-1">
            {unreadNotiCount > 0 && <button type="button" onClick={markAllNotificationsAsRead} className="apple-callout kit-text-secondary flex min-h-11 items-center gap-1 rounded-xl px-2 font-medium hover:bg-black/5 dark:hover:bg-white/10"><CheckCheck size={15} /><span>Đọc tất cả</span></button>}
            <button type="button" onClick={() => setIsNotificationPanelOpen(false)} aria-label="Đóng danh sách thông báo" className="kit-toolbar-control kit-text-secondary flex h-11 w-11 items-center justify-center rounded-full"><X size={17} /></button>
          </div>
        </div>
        <div className="min-h-0 max-h-[min(420px,calc(100svh_-_15rem))] space-y-1 overflow-y-auto overscroll-contain">
          {notifications.length === 0 ? <div className="flex flex-col items-center px-3 py-9 text-center"><div className="glass-icon mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-neutral-700"><Bell size={22} strokeWidth={1.5} /></div><p className="apple-body kit-text-primary font-semibold">Bạn đã cập nhật tất cả</p><p className="apple-callout kit-text-secondary mt-1 max-w-[230px]">Thông báo từ ban quản lý sẽ xuất hiện tại đây.</p></div> : notifications.map(notif => {
            const Icon = iconMap[notif.type] || Bell;
            return <button key={notif.id} type="button" onClick={() => { setIsNotificationPanelOpen(false); openNotificationModal(notif); }} className={cn('relative flex w-full gap-3 rounded-[20px] p-3 text-left transition-colors', notif.unread ? 'bg-black/[0.035] hover:bg-black/5 dark:bg-white/[0.055] dark:hover:bg-white/10' : 'hover:bg-white/50 dark:hover:bg-white/5')}>
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]', badgeColorMap[notif.type])}><Icon size={18} strokeWidth={1.8} /></span>
              <span className="min-w-0 flex-1"><span className={cn('apple-body kit-text-primary block pr-3', notif.unread ? 'font-semibold' : 'font-medium')}>{notif.title}</span><span className="apple-callout kit-text-secondary mt-1 block line-clamp-2">{notif.desc}</span><span className="apple-subheadline kit-text-secondary mt-2 block">{notif.time}</span></span>
              {notif.unread && <span className="absolute right-3 top-4 h-1.5 w-1.5 rounded-full bg-neutral-500" />}
            </button>;
          })}
        </div>
      </div>}
    </header>
  );
}
