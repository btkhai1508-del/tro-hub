/**
 * Storage wrapper.
 * - Zalo Mini App: localStorage / sessionStorage / cookie are NOT supported -> use zmp-sdk nativeStorage (max 5MB).
 * - Normal browser: use localStorage.
 * - Falls back to in-memory storage if both fail, so the app never crashes on storage access.
 */
import { nativeStorage } from 'zmp-sdk/apis';
import { isZaloMiniApp } from './platform';

const memory = new Map<string, string>();

export const storage = {
  getItem(key: string): string | null {
    try {
      if (isZaloMiniApp) {
        const value = nativeStorage.getItem(key);
        return value === undefined || value === null || value === '' ? null : String(value);
      }
      return window.localStorage.getItem(key);
    } catch {
      return memory.has(key) ? memory.get(key)! : null;
    }
  },

  setItem(key: string, value: string): void {
    memory.set(key, value);
    try {
      if (isZaloMiniApp) {
        nativeStorage.setItem(key, value);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (err) {
      console.warn(`[storage] Failed to save "${key}"`, err);
    }
  },

  removeItem(key: string): void {
    memory.delete(key);
    try {
      if (isZaloMiniApp) {
        nativeStorage.removeItem(key);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }
};

/** Keys used across the app */
export const STORAGE_KEYS = {
  AUTH: 'ecostay_auth',
  TOKEN: 'ecostay_jwt',
  USER_PHONE: 'ecostay_user_phone',
  PROFILE_SYNCED: 'ecostay_profile_row_synced',
  INVOICES: 'ecostay_invoices'
} as const;
