/** Share import promises between navigation intent, idle warmup and React.lazy. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => pending ??= load().catch(error => { pending = undefined; throw error; });
}
export const routeLoaders = {
  home: cached(() => import('../components/Home')),
  utilities: cached(() => import('../components/Utilities')),
  invoices: cached(() => import('../components/InvoicesAndPayment')),
  contract: cached(() => import('../components/Contract')),
  profile: cached(() => import('../components/Profile')),
  payment: cached(() => import('../components/PaymentPage')),
  laundry: cached(() => import('../components/LaundryPage')),
  login: cached(() => import('../components/LoginPage')),
  admin: cached(() => import('../components/AdminPortal')),
};
const paths = { '/': 'home', '/utilities': 'utilities', '/invoices': 'invoices', '/contract': 'contract', '/profile': 'profile', '/payment': 'payment', '/laundry': 'laundry' } as const;
export function preloadRoute(path: string): void {
  const key = paths[path.split('?')[0] as keyof typeof paths];
  if (key) void routeLoaders[key]().catch(() => { /* Normal navigation can retry. */ });
}
export function warmResidentRoutes(): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return () => {};
  const queue = ['home', 'utilities', 'invoices', 'profile', 'contract'] as const;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  let idle: number | undefined;
  let index = 0;
  let waitingForVisible = false;
  const resume = () => {
    if (waitingForVisible && document.visibilityState === 'visible') { waitingForVisible = false; schedule(); }
  };
  document.addEventListener('visibilitychange', resume);
  function schedule() {
    if (cancelled || index >= queue.length) return;
    timer = setTimeout(() => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') { waitingForVisible = true; return; }
      const next = () => {
        if (cancelled) return;
        if (document.visibilityState === 'hidden') { waitingForVisible = true; return; }
        void routeLoaders[queue[index++]]().catch(() => {}).finally(schedule);
      };
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(next, { timeout: 2500 });
      else next();
    }, 180);
  }
  schedule();
  return () => { cancelled = true; document.removeEventListener('visibilitychange', resume); clearTimeout(timer); if (idle !== undefined) window.cancelIdleCallback(idle); };
}
