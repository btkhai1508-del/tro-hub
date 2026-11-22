/**
 * Admin screen refresh helpers (worker mode).
 *
 * 1. houseIdCache: the list of houses is stable inside one session, so it is read once and
 *    remembered for the session token that read it (a new login = a new token = a fresh read).
 *    An empty list is never remembered.
 * 2. refreshRooms / refreshBilling / refreshDashboard / refreshGate: after a save, call the one
 *    for the resource that changed (with the month shown on screen). They reload that resource
 *    only, silently (no spinner), and do nothing when the admin screen is not open or the month
 *    is no longer the one on screen.
 */

export type HouseIdCache = {
  get(token: string | null): string[] | null;
  set(token: string | null, ids: string[]): void;
  clear(): void;
};

export function createHouseIdCache(): HouseIdCache {
  let entry: { token: string | null; ids: string[] } | null = null;
  return {
    get(token) {
      return entry && entry.token === token && entry.ids.length > 0 ? entry.ids : null;
    },
    set(token, ids) {
      entry = ids.length > 0 ? { token, ids: [...ids] } : null;
    },
    clear() {
      entry = null;
    },
  };
}

export type AdminRefreshHandlers = {
  rooms: (month: string) => void;
  billing: (month: string) => void;
  dashboard: (month: string) => void;
  gate: (month: string) => void;
};

let handlers: AdminRefreshHandlers | null = null;

/** Called by the admin screen while it is open. Returns the function that removes the handlers. */
export function registerAdminRefresh(next: AdminRefreshHandlers): () => void {
  handlers = next;
  return () => {
    if (handlers === next) handlers = null;
  };
}

/** Reload the room list (Phòng & Khách) for `month`. */
export function refreshRooms(month: string): void {
  handlers?.rooms(month);
}
/** Reload the billing list (Thu tiền tháng) for `month`. */
export function refreshBilling(month: string): void {
  handlers?.billing(month);
}
/** Reload the dashboard numbers (Tổng quan) for `month`. */
export function refreshDashboard(month: string): void {
  handlers?.dashboard(month);
}
/** Reload the payment gate for `month`. */
export function refreshGate(month: string): void {
  handlers?.gate(month);
}
