/**
 * API client.
 * - In the Zalo Mini App the frontend is hosted on Zalo's domain, so every request must use
 *   the absolute backend URL (VITE_API_BASE_URL). On the normal web build it can stay relative.
 * - Auth is sent via the `Authorization: Bearer <jwt>` header (cookies are not supported in Zalo).
 */
import { storage, STORAGE_KEYS } from './storage';

const rawApiBase = import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL: string = String(
  rawApiBase || 'https://tro-hub.onrender.com'
).replace(/\/+$/, '');

export const UNAUTHORIZED_EVENT = 'ecostay:unauthorized';

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getAuthToken(): string | null {
  return storage.getItem(STORAGE_KEYS.TOKEN);
}

export function setAuthToken(token: string | null | undefined): void {
  if (token) storage.setItem(STORAGE_KEYS.TOKEN, token);
  else {
    resetSource();
    storage.removeItem(STORAGE_KEYS.TOKEN);
    storage.removeItem(STORAGE_KEYS.WORKER_TOKEN);
    workerSessionListeners.forEach((fn) => fn());
  }
}

/**
 * The Cloudflare Worker: login, password and (step by step) the rest of the API move here.
 * It has its own token, kept next to the Express one until Express is gone.
 */
export const WORKER_API_URL: string = String(
  import.meta.env.VITE_WORKER_API_URL || 'https://tro-hub-api.trohub.workers.dev'
).replace(/\/+$/, '');

export function setWorkerToken(token: string | null | undefined): void {
  if (token) storage.setItem(STORAGE_KEYS.WORKER_TOKEN, token);
  else storage.removeItem(STORAGE_KEYS.WORKER_TOKEN);
  workerSessionListeners.forEach((fn) => fn());
}

/** Lets caches of "who is signed in on the Worker" drop themselves when the session changes. */
const workerSessionListeners = new Set<() => void>();
export function onWorkerSessionChange(fn: () => void): void {
  workerSessionListeners.add(fn);
}

export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = storage.getItem(STORAGE_KEYS.WORKER_TOKEN);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${WORKER_API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && token && !path.startsWith('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  return res;
}

/**
 * Express routes that now live on the Cloudflare Worker with the same path and response, so
 * callers keep using apiFetch. Sessions without a Worker token (Zalo login) still go to Express.
 */
const WORKER_ROUTES = new Set([
  // Nhóm 1: thông báo
  '/api/notifications', '/api/admin/notifications',
  // Nhóm 2: tiền phòng, thanh toán, cổng thanh toán
  '/api/payment/status', '/api/payment/gate', '/api/payment/mark-paid',
  '/api/admin/months', '/api/admin/dashboard', '/api/admin/billing', '/api/admin/payment-status', '/api/admin/payment-gate',
]);

/**
 * Routes that move to the Worker only while the source-of-truth switch says `worker`.
 * In `sheet` mode Express keeps serving them exactly as before.
 */
const WORKER_SOURCE_ROUTES = new Set([
  '/api/sheets/tenant-data',
  '/api/admin/rooms', '/api/admin/room-detail', '/api/admin/config',
  '/api/admin/accounts', '/api/admin/accounts/status', '/api/admin/accounts/delete',
  '/api/profile/update', '/api/auth/register',
]);
/** Registration happens before sign-in, so it has no Worker token yet. */
const WORKER_SOURCE_PUBLIC = new Set(['/api/auth/register']);

export type DataSource = 'sheet' | 'worker';

let sourceValue: DataSource | null = null;
let sourcePromise: Promise<DataSource> | null = null;

/** The last known source; `sheet` until the first answer arrives. */
export function getSource(): DataSource {
  return sourceValue ?? 'sheet';
}

/**
 * Asks the Worker once which store owns the data. The answer is memoized; a failed
 * attempt is not (the next call retries) and counts as `sheet` for that call.
 */
export function ensureSource(): Promise<DataSource> {
  if (sourceValue) return Promise.resolve(sourceValue);
  if (!sourcePromise) {
    sourcePromise = (async () => {
      try {
        const res = await fetch(`${WORKER_API_URL}/api/source`);
        const data = await res.json().catch(() => null);
        if (res.ok && data && (data.source === 'sheet' || data.source === 'worker')) {
          sourceValue = data.source;
          return sourceValue as DataSource;
        }
      } catch { /* fall through; the next call retries */ }
      sourcePromise = null;
      return 'sheet' as DataSource;
    })();
  }
  return sourcePromise;
}

/** Forgets the memoized source so a flipped switch is picked up at the next sign-in. */
export function resetSource(): void {
  sourceValue = null;
  sourcePromise = null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const bare = path.split('?')[0];
  const workerToken = storage.getItem(STORAGE_KEYS.WORKER_TOKEN);
  if (WORKER_ROUTES.has(bare) && workerToken) return workerFetch(path, init);
  if (WORKER_SOURCE_ROUTES.has(bare) && (workerToken || WORKER_SOURCE_PUBLIC.has(bare))) {
    if ((await ensureSource()) === 'worker') return workerFetch(path, init);
  }
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Bypass localtunnel interstitial warning page for seamless API testing
  headers.set('Bypass-Tunnel-Reminder', 'true');

  const res = await fetch(apiUrl(path), { ...init, headers });

  // Session expired / missing -> let the app log out (skip for login endpoints themselves)
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  return res;
}
