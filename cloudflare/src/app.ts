/**
 * Declarations every part of the Worker shares: the bindings, who is calling, the JSON error shape,
 * the audit log and the access checks used as middleware.
 */
import type { Context, Next } from 'hono';
import type { TenantStore } from './tenant/store.ts';

export interface Env {
  DB: D1Database;
  TENANT: DurableObjectNamespace<TenantStore>;
  JWT_SECRET: string;
  CCCD_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ZALO_CHECKOUT_ACCOUNT?: string; // "<bin>:<số tài khoản>" đã đăng ký với Zalo Checkout
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "http://localhost:3000,https://tro-hub.pages.dev"
  SEPAY_OAUTH_CLIENT_ID?: string; // ứng dụng OAuth của Trọ Hub trên SePay (secret)
  SEPAY_OAUTH_CLIENT_SECRET?: string; // (secret)
  SEPAY_OAUTH_BASE?: string; // mặc định https://my.sepay.vn; trỏ sang mock khi thử trên máy
  SEPAY_WEBHOOK_ORIGIN?: string; // địa chỉ public SePay gửi webhook về, nếu khác địa chỉ Worker
  SHEET_WRITES?: string; // 'off': không tô cột P / không ghi cổng thanh toán sang Apps Script (chạy thử trên máy)
  EXPRESS_ORIGIN?: string; // server Express còn chạy giặt sấy, mặc định https://tro-hub.onrender.com
}

/** Who is calling, read fresh from D1 on every request. */
export type Viewer =
  | { kind: 'resident'; id: number; name: string; phone: string | null; houseId: string; roomId: number | null; roomName: string | null }
  | { kind: 'staff'; id: number; name: string; phone: string; role: StaffRole; houseIds: string[] };

export type StaffRole = 'developer' | 'owner' | 'manager';

export type App = { Bindings: Env; Variables: { viewer: Viewer } };

export const fail = (c: Context, status: 400 | 401 | 403 | 404, errorCode: string, error: string) =>
  c.json({ success: false, errorCode, error }, status);

export async function audit(c: Context<App>, actor: string, action: string, houseId: string | null = null, target: string | null = null) {
  await c.env.DB.prepare('INSERT INTO audit_log (actor, action, house_id, target, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(actor, action, houseId, target, c.req.header('CF-Connecting-IP') ?? null)
    .run();
}

export const actorOf = (v: Viewer) => `${v.kind}:${v.id}`;
/** Admin Tổng: owns their houses, sets their bank accounts, sees their summary and creates Admin căn. */
export const isOwner = (v: Viewer) => v.kind === 'staff' && v.role === 'owner';
/** Developer: the person who sells Trọ Hub; can open every house. */
export const isDeveloper = (v: Viewer) => v.kind === 'staff' && v.role === 'developer';

export function canAccessHouse(viewer: Viewer, houseId: string) {
  return viewer.kind === 'resident' ? viewer.houseId === houseId : viewer.houseIds.includes(houseId);
}

/** Every route under /api/houses/:houseId goes through here: the house comes from the URL, the right to see it from D1. */
export async function requireHouse(c: Context<App>, next: Next) {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId') ?? '';
  if (!canAccessHouse(viewer, houseId)) {
    await audit(c, actorOf(viewer), 'house_access_denied', houseId);
    return fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn không có quyền xem nhà trọ này.');
  }
  await next();
}

export const staffOnly = async (c: Context<App>, next: Next) =>
  c.get('viewer').kind === 'staff' ? next() : fail(c, 403, 'STAFF_ONLY', 'Chỉ quản lý mới dùng được chức năng này.');

export const ownerOnly = async (c: Context<App>, next: Next) =>
  isOwner(c.get('viewer')) ? next() : fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng dùng được chức năng này.');

export const developerOnly = async (c: Context<App>, next: Next) =>
  isDeveloper(c.get('viewer')) ? next() : fail(c, 403, 'DEVELOPER_ONLY', 'Chỉ Developer dùng được chức năng này.');
