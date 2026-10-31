import React, { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, CheckCheck, Receipt, AlertTriangle, CheckCircle2, MessageSquare, X, Sun, Moon, Monitor, ChevronRight } from './AppIcons';
import { IconClock3D, IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

const iconMap = { invoice: Receipt, alert: AlertTriangle, success: CheckCircle2, info: MessageSquare };
const badgeColorMap = {
  invoice: 'bg-slate-900/10 text-slate-800',
  alert: 'bg-rose-500/15 text-rose-700',
  success: 'bg-emerald-500/15 text-emerald-700',
  info: 'bg-sky-500/15 text-sky-700',
};
const pageLabels: Record<string, string> = { '/': 'Tổng quan', '/utilities': 'Tiện ích', '/invoices': 'Hóa đơn', '/contract': 'Hợp đồng', '/profile': 'Cá nhân', '/laundry': 'Giặt sấy' };

export function TopHeader() {
  const { profile, notifications, unreadNotiCount, isNotificationPanelOpen, setIsNotificationPanelOpen, openNotificationModal, markAllNotificationsAsRead } = useApp();
  const { mode, toggleTheme } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rawRoom = profile.room?.roomNumber?.trim() || '';
  const roomSubtitle = rawRoom
    ? (/^phòng\b/i.test(rawRoom) ? rawRoom : `Phòng ${rawRoom.replace(/^P\.\s*/i, '')}`)
    : 'Chưa xếp phòng';

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
    <header className="kit-toolbar relative z-40 flex w-full items-center justify-between lg:justify-end gap-3">
      <div data-brand-target="brand" className="flex min-w-0 items-center gap-2.5 lg:hidden">
        <span data-brand-logo className="flex h-10 w-10 shrink-0 items-center justify-center"><IconHome3D size={44} /></span>
        <div data-brand-copy className="min-w-0">
          <span data-brand-title className="apple-title2 kit-text-primary block font-semibold">Trọ-Hub</span>
          <span data-brand-subtitle className="apple-subheadline kit-text-secondary block truncate">{roomSubtitle}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5 !bg-transparent !p-0">
        {/* Independent Theme Toggle Capsule */}
        <button
          type="button"
          onClick={toggleTheme}
          className="kit-toolbar-control flex h-11 items-center justify-center gap-2 rounded-full border border-black/[0.08] bg-white/70 px-3 text-[var(--text-secondary)] shadow-xs backdrop-blur-md transition-all hover:bg-white hover:shadow-sm dark:border-white/[0.12] dark:bg-neutral-800/75 dark:hover:bg-neutral-800 sm:px-3.5 cursor-pointer"
          aria-label={`${themeLabel}. Bấm để đổi giao diện`}
          title={`${themeLabel} · Bấm để chuyển Sáng, Tối hoặc Tự động`}
        >
          {mode === 'auto' ? <IconClock3D size={22} /> : <ThemeIcon size={17} strokeWidth={1.85} />}
          <span className="apple-callout hidden font-medium sm:inline">{themeLabel}</span>
        </button>

        {/* Independent Notification Bell Capsule */}
        <button
          ref={buttonRef}
          type="button"
          data-tutorial="header-notifications"
          onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)}
          className={cn(
            'kit-toolbar-control relative flex h-11 w-11 items-center justify-center rounded-full border border-black/[0.08] bg-white/70 text-[var(--text-secondary)] shadow-xs backdrop-blur-md transition-all hover:bg-white hover:shadow-sm  dark:border-white/[0.12] dark:bg-neutral-800/75 dark:hover:bg-neutral-800 cursor-pointer',
            isNotificationPanelOpen && 'ring-2 ring-neutral-900/15 bg-white dark:ring-white/20 dark:bg-neutral-700'
          )}
          aria-label={`Thông báo${unreadNotiCount > 0 ? `, ${unreadNotiCount} chưa đọc` : ''}`}
          aria-expanded={isNotificationPanelOpen}
          aria-controls="header-notification-panel"
          title="Thông báo"
        >
          <Bell size={19} strokeWidth={1.85} className="transition-transform" />
          {unreadNotiCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-xs ring-2 ring-white dark:ring-neutral-900">
              {unreadNotiCount > 9 ? '9+' : unreadNotiCount}
            </span>
          )}
        </button>
      </div>

      {isNotificationPanelOpen && (
        <div
          ref={panelRef}
          id="header-notification-panel"
          data-stage="popover"
          aria-label="Danh sách thông báo"
          className="notification-popover-frosted absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[calc(100svh_-_8rem)] w-[min(380px,calc(100vw-2rem))] flex-col space-y-3 overflow-y-auto rounded-xl p-4 duration-200"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-300/60 dark:border-white/10 pb-3 px-1">
            <div className="flex items-center gap-2">
              <h2 className="apple-title2 font-bold text-slate-900 dark:text-white tracking-tight">Thông báo</h2>
              {unreadNotiCount > 0 && (
                <span className="rounded-full bg-slate-900/10 dark:bg-white/10 px-2.5 py-0.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                  {unreadNotiCount} mới
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {unreadNotiCount > 0 && (
                <button
                  type="button"
                  onClick={markAllNotificationsAsRead}
                  className="flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-950 hover:bg-black/5 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <CheckCheck size={14} />
                  <span>Đọc tất cả</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsNotificationPanelOpen(false)}
                aria-label="Đóng danh sách thông báo"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-black/5 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          <div className="min-h-0 max-h-[min(420px,calc(100svh_-_15rem))] space-y-1.5 overflow-y-auto overscroll-contain">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900/10 dark:bg-white/10 text-slate-800 dark:text-slate-200 shadow-xs">
                  <Bell size={22} strokeWidth={1.8} className="text-slate-700 dark:text-slate-200" />
                </div>
                <p className="apple-body font-bold text-slate-900 dark:text-white">Bạn đã cập nhật tất cả</p>
                <p className="apple-callout mt-1 max-w-[240px] font-medium text-slate-600 dark:text-slate-300">
                  Thông báo từ ban quản lý sẽ xuất hiện tại đây.
                </p>
              </div>
            ) : (
              notifications.map(notif => {
                const Icon = iconMap[notif.type] || Bell;
                return (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => {
                      setIsNotificationPanelOpen(false);
                      openNotificationModal(notif);
                    }}
                    className={cn(
                      'relative flex w-full gap-3 rounded-lg p-3 text-left transition-all cursor-pointer',
                      notif.unread
                        ? 'bg-white/80 hover:bg-white shadow-xs text-slate-900 border border-black/[0.05] dark:bg-white/10 dark:hover:bg-white/15 dark:text-white dark:border-white/10'
                        : 'hover:bg-white/60 dark:hover:bg-white/5 text-slate-800 dark:text-slate-200'
                    )}
                  >
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', badgeColorMap[notif.type])}>
                      <Icon size={18} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('apple-body block pr-3 text-slate-900 dark:text-white', notif.unread ? 'font-bold' : 'font-medium')}>
                        {notif.title}
                      </span>
                      <span className="apple-callout mt-1 block line-clamp-2 text-slate-600 dark:text-slate-300">
                        {notif.desc}
                      </span>
                      <span className="apple-subheadline mt-1.5 block text-slate-500 dark:text-slate-400 font-medium">
                        {notif.time}
                      </span>
                    </span>
                    {notif.unread && <span className="absolute right-3.5 top-4 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-neutral-900" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </header>
  );
}
