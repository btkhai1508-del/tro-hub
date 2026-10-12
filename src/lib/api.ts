/**
 * API client.
 * - In the Zalo Mini App the frontend is hosted on Zalo's domain, so every request must use
 *   the absolute backend URL (VITE_API_BASE_URL). On the normal web build it can stay relative.
 * - Auth is sent via the `Authorization: Bearer <jwt>` header (cookies are not supported in Zalo).
 */
import { storage, STORAGE_KEYS } from './storage';

export const API_BASE_URL: string = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

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
  else storage.removeItem(STORAGE_KEYS.TOKEN);
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
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
