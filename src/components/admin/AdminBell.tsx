import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from '../AppIcons';
import { cn } from '../../lib/utils';
import { alertPlace, alertSource, alertTitle, badgeText, formatVnd, vnTime, type AdminAlert } from '../../lib/adminAlerts';
import { workerCall } from './workerAdmin';

const POLL_MS = 30_000;

/**
 * The admin bell (worker mode), top right of the admin screen on desktop and phone. The Worker decides what the
 * caller sees: the landlord gets every house, a manager only the houses given to them. Opening the list marks the
 * alerts shown as read (for this person only). Reusable: any alert kind the Worker sends is listed.
 */
export default function AdminBell({ className }: { className?: string }) {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  // The ids that were unread when the list opened: they keep their "Mới" mark until it closes.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const take = (d: { alerts?: AdminAlert[]; unread?: number } | null) => {
    if (!d) return;
    setAlerts(Array.isArray(d.alerts) ? d.alerts : []);
    setUnread(Number(d.unread) || 0);
  };

  const retry = useRef<number | undefined>(undefined);
  const load = useCallback(async () => {
    const r = await workerCall<{ alerts: AdminAlert[]; unread: number }>('/api/admin/alerts');
    window.clearTimeout(retry.current);
    if (r.ok) { take(r.data); setError(''); return; }
    setError(r.error);
    // A failed read (the session still starting, a network blip) is tried again soon, not only on the next round.
    retry.current = window.setTimeout(() => { if (document.visibilityState !== 'hidden') load(); }, 5_000);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); window.clearTimeout(retry.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const openList = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    const unreadIds = alerts.filter((a) => !a.read).map((a) => a.id);
    setFresh(new Set(unreadIds));
    if (!unreadIds.length) { load(); return; }
    const r = await workerCall<{ alerts: AdminAlert[]; unread: number }>('/api/admin/alerts/read', {
      method: 'POST', body: JSON.stringify({ ids: unreadIds }),
    });
    if (r.ok) take(r.data); else setError(r.error);
  };

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const badge = badgeText(unread);
  return (
    <div className={cn('relative', className)} data-testid="admin-bell">
      <button
        ref={buttonRef}
        type="button"
        onClick={openList}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Thông báo thanh toán: ${unread} chưa đọc` : 'Thông báo thanh toán'}
        className="soft-button relative w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-neutral-900 dark:text-white cursor-pointer"
      >
        <Bell size={24} />
        {badge && (
          <span data-testid="admin-bell-badge" className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Thông báo thanh toán"
          data-testid="admin-bell-panel"
          className="absolute right-0 top-[56px] z-[60] w-[min(360px,calc(100vw-40px))] rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
            <p className="text-sm font-bold text-neutral-900 dark:text-white">Thông báo thanh toán</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng thông báo" className="w-11 h-11 -mr-3 flex items-center justify-center rounded-xl text-neutral-600 dark:text-neutral-300 cursor-pointer">
              <X size={16} />
            </button>
          </div>
          {error && <p role="alert" className="px-4 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-neutral-600 dark:text-neutral-300">Chưa có thông báo nào.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
              {alerts.map((a) => {
                const isNew = fresh.has(a.id);
                return (
                  <li key={a.id} data-testid="admin-bell-item" data-read={isNew ? 'false' : 'true'} className={cn('px-4 py-3 space-y-1', isNew && 'bg-sky-50/70 dark:bg-sky-950/30')}>
                    <div className="flex items-start justify-between gap-3">
                      <p className={cn('text-[13px] font-bold', a.kind === 'overpaid' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>{alertTitle(a)}</p>
                      <span className="shrink-0 whitespace-nowrap tabular-nums text-[13px] font-bold text-neutral-900 dark:text-white">{a.amount != null ? formatVnd(a.amount) : ''}</span>
                    </div>
                    <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">{alertPlace(a)}</p>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
                      <span>Nhận lúc {vnTime(a.receivedAt)}{alertSource(a) ? ` · ${alertSource(a)}` : ''}</span>
                      <span className={cn('shrink-0 font-semibold', isNew ? 'text-sky-700 dark:text-sky-300' : '')}>{isNew ? 'Mới' : 'Đã đọc'}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
