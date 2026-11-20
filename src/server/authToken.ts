/**
 * Minimal HS256 JWT (no external dependency).
 * Used to identify a logged-in tenant on every API call via
 * `Authorization: Bearer <token>` (Zalo Mini App does not support cookies/localStorage).
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface TenantTokenPayload {
  phone: string;          // normalized 0xxxxxxxxx
  room: string;           // normalized room number (e.g. "203", "G01", "LVC101")
  isAdmin?: boolean;
  personType?: string;
  zaloId?: string;        // present when logged in via Zalo
  /** Tiện ích keys the person's house(s) use, copied from the Worker when the session is issued. Absent on older / sheet-mode tokens. */
  modules?: string[];
  /** The Worker bearer of the same login: lets Express re-read the live tiện ích list (see moduleGate.ts). */
  wt?: string;
  iat?: number;
  exp?: number;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.JWT_SECRET || 'ecostay_jwt_secret_61954560911870422_super_secure_2026_auth';
  return secret;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const fromB64url = (input: string) =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function signTenantToken(payload: TenantTokenPayload): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const signature = b64url(crypto.createHmac('sha256', getSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

export function verifyTenantToken(token: string): TenantTokenPayload | null {
  try {
    const [header, body, signature] = String(token || '').split('.');
    if (!header || !body || !signature) return null;

    const expected = b64url(crypto.createHmac('sha256', getSecret()).update(`${header}.${body}`).digest());
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(fromB64url(body)) as TenantTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  tenant?: TenantTokenPayload;
}

/** Express middleware: requires a valid Bearer token, attaches `req.tenant`. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = token ? verifyTenantToken(token) : null;
  if (!payload) {
    return res.status(401).json({
      success: false,
      errorCode: 'AUTH_SESSION_EXPIRED',
      error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    });
  }
  req.tenant = payload;
  next();
}

/** Express middleware: requires a session issued for a Google Sheets admin account. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = token ? verifyTenantToken(token) : null;

  if (!payload) {
    return res.status(401).json({
      success: false,
      errorCode: 'AUTH_SESSION_EXPIRED',
      error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    });
  }
  if (!payload.isAdmin) {
    return res.status(403).json({
      success: false,
      errorCode: 'AUTH_FORBIDDEN',
      error: 'Tài khoản cư dân không có quyền truy cập khu vực quản trị.'
    });
  }
  req.tenant = payload;
  next();
}

/**
 * Does this session may use tiện ích `key`? A token WITH a modules claim is enforced strictly; a token
 * without one (issued before the claim existed, or by the sheet-mode / Zalo logins, which have no per-house
 * list) is allowed: such tokens expire within TOKEN_TTL_SECONDS (30 days) and the Worker enforces its own routes.
 */
export function tokenAllowsModule(payload: Pick<TenantTokenPayload, 'modules'> | undefined | null, key: string): boolean {
  if (!payload) return false;
  if (!Array.isArray(payload.modules)) return true;
  return payload.modules.includes(key);
}

export const MODULE_DISABLED_BODY = {
  success: false,
  errorCode: 'MODULE_DISABLED',
  error: 'Nhà trọ của bạn chưa đăng ký tiện ích này. Vui lòng liên hệ Developer để bật.'
};
