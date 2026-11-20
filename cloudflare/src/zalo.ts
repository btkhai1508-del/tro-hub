/**
 * Zalo Open API (server side only; the app secret never reaches the Mini App).
 *  - profile: GET https://graph.zalo.me/v2.0/me?fields=id,name,picture   (headers access_token, appsecret_proof)
 *  - phone:   GET https://graph.zalo.me/v2.0/me/info                     (headers access_token, code, secret_key)
 */
import type { Env } from './app.ts';
import { normalizePhone } from './password.ts';

export class ZaloError extends Error {
  constructor(
    readonly status: 401 | 502 | 503,
    readonly code: 'ZALO_REJECTED' | 'ZALO_UNAVAILABLE' | 'ZALO_NOT_CONFIGURED',
    message: string
  ) {
    super(message);
    this.name = 'ZaloError';
  }
}

const REJECTED = 'Không xác thực được tài khoản Zalo. Vui lòng mở lại ứng dụng trong Zalo và thử lại.';

/** appsecret_proof = HMAC-SHA256(access token) keyed with the app secret, in hex. */
async function appSecretProof(accessToken: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(accessToken));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function graph(url: string, headers: Record<string, string>): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch {
    throw new ZaloError(502, 'ZALO_UNAVAILABLE', 'Chưa kết nối được Zalo. Vui lòng thử lại sau.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.status >= 500) throw new ZaloError(502, 'ZALO_UNAVAILABLE', 'Chưa kết nối được Zalo. Vui lòng thử lại sau.');
  if (!res.ok || body.error !== 0) throw new ZaloError(401, 'ZALO_REJECTED', REJECTED);
  return body;
}

/** Verifies the Mini App's tokens with Zalo and returns the phone number (10 digits, leading 0) with the Zalo profile. */
export async function zaloPhone(env: Env, accessToken: string, phoneToken: string): Promise<{ phone: string; zaloId: string; name: string; avatar: string }> {
  const secret = env.ZALO_APP_SECRET;
  if (!secret) throw new ZaloError(503, 'ZALO_NOT_CONFIGURED', 'Chưa cấu hình đăng nhập Zalo. Vui lòng liên hệ quản lý.');

  const profile = await graph('https://graph.zalo.me/v2.0/me?fields=id,name,picture', {
    access_token: accessToken,
    appsecret_proof: await appSecretProof(accessToken, secret),
  });
  if (!profile.id) throw new ZaloError(401, 'ZALO_REJECTED', REJECTED);

  const info = await graph('https://graph.zalo.me/v2.0/me/info', { access_token: accessToken, code: phoneToken, secret_key: secret });
  const phone = normalizePhone(String(info.data?.number ?? ''));
  if (!/^0\d{9}$/.test(phone)) throw new ZaloError(401, 'ZALO_REJECTED', 'Zalo không trả về số điện thoại hợp lệ. Vui lòng cho phép truy cập số điện thoại.');

  return { phone, zaloId: String(profile.id), name: String(profile.name ?? ''), avatar: String(profile.picture?.data?.url ?? '') };
}
