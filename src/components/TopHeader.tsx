import React, { useRef, useEffect } from 'react';
import { Bell, CheckCheck, Receipt, AlertTriangle, CheckCircle2, MessageSquare, X, Sun, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../lib/utils';
import { GlassIconMoon } from './GlassIcons';

const iconMap = {
  invoice: Receipt,
  alert: AlertTriangle,
  success: CheckCircle2,
  info: MessageSquare,
};

const badgeColorMap = {
  invoice: 'bg-indigo-50 text-indigo-600',
  alert: 'bg-rose-50 text-rose-600',
  success: 'bg-emerald-50 text-emerald-600',
  info: 'bg-blue-50 text-blue-600',
};

export function TopHeader() {
  const { 
    notifications, 
    unreadNotiCount, 
    isNotificationPanelOpen, 
    setIsNotificationPanelOpen,
    openNotificationModal,
    markAllNotificationsAsRead
  } = useApp();

  const { mode, isDark, toggleTheme } = useTheme();

  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close panel when clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current && 
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsNotificationPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsNotificationPanelOpen]);

  const getThemeLabel = () => {
    if (mode === 'light') return 'Chế độ sáng';
    if (mode === 'dark') return 'Chế độ tối';
    return 'Tự động';
  };

  return (
    <header className="w-full flex items-center justify-end gap-2.5 mb-6 pb-2 relative z-40">
      
      {/* Real-time Light/Dark Mode Switcher */}
      <button
        type="button"
        onClick={toggleTheme}
        className="h-10 px-3.5 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-white/80 dark:border-slate-800 text-slate-700 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800 shadow-xs flex items-center gap-2 transition-all duration-200 cursor-pointer active:scale-95"
        title={`Chế độ hiện tại: ${getThemeLabel()} - Bấm để chuyển đổi giữa Sáng, Tối và Tự động`}
      >
        {mode === 'light' ? (
          <Sun size={18} className="text-amber-500 drop-shadow-[0_2px_6px_rgba(245,158,11,0.3)]" />
        ) : mode === 'dark' ? (
          <Moon size={18} className="text-indigo-400 drop-shadow-[0_2px_6px_rgba(99,102,241,0.3)]" />
        ) : (
          <GlassIconMoon size={19} className="shrink-0" />
        )}
        <span className="text-xs font-semibold">
          {getThemeLabel()}
        </span>
      </button>

      {/* Right side: Top-Right Notification Bell */}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          data-tutorial="header-notifications"
          onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)}
          className={cn(
            "relative w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer",
            isNotificationPanelOpen
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/15"
              : "bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-white/70 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 hover:bg-white shadow-xs"
          )}
          aria-label="Thông báo"
          title="Thông báo"
        >
          <Bell size={19} className={cn("transition-transform", unreadNotiCount > 0 && "animate-bounce duration-1000")} />
          
          {unreadNotiCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-rose-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center shadow-md border-2 border-white font-num animate-pulse">
              {unreadNotiCount}
            </span>
          )}
        </button>

        {/* Floating Dropdown Notification Panel in Top-Right */}
        {isNotificationPanelOpen && (
          <div
            ref={panelRef}
            className="absolute right-0 top-12 w-[320px] sm:w-[380px] bg-white dark:bg-[#111827] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_20px_50px_-10px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] p-4 space-y-3 z-50 animate-in fade-in slide-in-from-top-3 duration-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <h3 className="type-h4 text-slate-900 dark:text-slate-100 font-bold">Thông báo</h3>
                {unreadNotiCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-full font-num">
                    {unreadNotiCount} mới
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {unreadNotiCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllNotificationsAsRead}
                    className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCheck size={14} />
                    <span>Đã đọc hết</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsNotificationPanelOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Notification List */}
            <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">
                  Không có thông báo nào.
                </div>
              ) : (
                notifications.map((notif) => {
                  const Icon = iconMap[notif.type] || Bell;
                  return (
                    <div
                      key={notif.id}
                      onClick={() => {
                        setIsNotificationPanelOpen(false);
                        openNotificationModal(notif);
                      }}
                      className={cn(
                        "p-3 rounded-2xl transition-all duration-200 flex gap-3 cursor-pointer text-left relative",
                        notif.unread
                          ? "bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100/90 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80"
                          : "hover:bg-slate-50/60 dark:hover:bg-slate-800/40 border border-transparent"
                      )}
                    >
                      {notif.unread && (
                        <span className="absolute top-3.5 right-3 w-2 h-2 rounded-full bg-rose-500" />
                      )}

                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-2xs",
                        badgeColorMap[notif.type]
                      )}>
                        <Icon size={18} />
                      </div>

                      <div className="flex-1 min-w-0 pr-2">
                        <p className={cn(
                          "text-xs leading-snug line-clamp-1",
                          notif.unread ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300"
                        )}>
                          {notif.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                          {notif.desc}
                        </p>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                          <span className="font-num">{notif.time}</span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-medium">Bấm xem chi tiết →</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

    </header>
  );
}
