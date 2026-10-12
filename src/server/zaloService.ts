/**
 * Zalo Open API helpers (server-side only).
 * Docs:
 *  - Profile:      GET https://graph.zalo.me/v2.0/me       (headers: access_token, appsecret_proof)
 *  - Phone number: GET https://graph.zalo.me/v2.0/me/info  (headers: access_token, code, secret_key)
 *
 * The Zalo App Secret Key must NEVER be sent to the Mini App frontend.
 */
import crypto from 'crypto';

export interface ZaloProfile {
  id: string;
  name: string;
  avatar?: string;
}

function getAppSecret(): string {
  const secret = process.env.ZALO_APP_SECRET;
  if (!secret) {
    throw new Error('ZALO_APP_SECRET chưa được cấu hình trong file .env');
  }
  return secret;
}

/** appsecret_proof = HMAC-SHA256(access_token, app_secret) in hex (required since 01/01/2024). */
export function calculateAppSecretProof(accessToken: string): string {
  return crypto.createHmac('sha256', getAppSecret()).update(accessToken).digest('hex');
}

/** Fetch the Zalo user profile (id, name, picture) from a Mini App access token. */
export async function getZaloProfile(accessToken: string): Promise<ZaloProfile> {
  const url = 'https://graph.zalo.me/v2.0/me?fields=id,name,picture';
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      access_token: accessToken,
      appsecret_proof: calculateAppSecretProof(accessToken)
    }
  });
  const body: any = await res.json().catch(() => ({}));

  if (!res.ok || body.error !== 0 || !body.id) {
    throw new Error(`Zalo profile error: ${body.message || res.statusText || 'unknown'} (code ${body.error ?? res.status})`);
  }

  return {
    id: String(body.id),
    name: String(body.name || ''),
    avatar: body.picture?.data?.url || undefined
  };
}

/**
 * Exchange the token returned by zmp-sdk `getPhoneNumber()` for the real phone number.
 * Zalo returns the number in international format, e.g. "84912345678".
 */
export async function getZaloPhoneNumber(accessToken: string, phoneToken: string): Promise<string> {
  const res = await fetch('https://graph.zalo.me/v2.0/me/info', {
    method: 'GET',
    headers: {
      access_token: accessToken,
      code: phoneToken,
      secret_key: getAppSecret()
    }
  });
  const body: any = await res.json().catch(() => ({}));
  const number = body?.data?.number;

  if (!res.ok || body.error !== 0 || !number) {
    throw new Error(`Zalo phone error: ${body.message || res.statusText || 'unknown'} (code ${body.error ?? res.status})`);
  }
  return String(number);
}
