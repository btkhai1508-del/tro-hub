/**
 * Google access as each Admin Tổng's own Google account (OAuth), not a service account: new service
 * accounts have no Drive storage, so they cannot create the Sheets. The only Drive scope is
 * drive.file, which reaches just the files this app created, and the refresh token is kept in
 * D1 encrypted with CCCD_KEY.
 */
import { decryptText, encryptText } from './cccd.ts';

export interface GoogleEnv {
  DB: D1Database;
  CCCD_KEY: string;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const STATE_TTL_SECONDS = 10 * 60;

/** One Google link per Admin Tổng, stored as 'google:staff:<id>'. */
export const googleKey = (actor: string) => `google:${actor}`;

export const redirectUri = (origin: string) => `${origin}/api/google/callback`;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`google-state:${text}`))));
}

/** The consent link carries who asked and until when, signed, so the callback needs no login. */
export async function connectUrl(env: GoogleEnv, origin: string, actor: string) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('Chưa cấu hình GOOGLE_CLIENT_ID');
  const payload = `${actor}.${Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS}`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: `${payload}.${await hmac(env.JWT_SECRET, payload)}`,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Returns the actor who asked for the link, or null when the state is forged or expired. */
export async function checkState(env: GoogleEnv, state: string): Promise<string | null> {
  const [actor, exp, sig] = state.split('.');
  if (!actor || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return sig === (await hmac(env.JWT_SECRET, `${actor}.${exp}`)) ? actor : null;
}

export async function finishConnect(env: GoogleEnv, origin: string, code: string, actor: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; access_token?: string; id_token?: string; error_description?: string };
  if (!res.ok || !data.refresh_token) throw new Error(data.error_description || 'Google không trả về refresh token');

  // The id_token came straight from Google over TLS, so its email is read without verifying the signature.
  const email = data.id_token ? JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email : null;
  await env.DB.prepare(
    `INSERT INTO integrations (name, secret_enc, account, connected_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET secret_enc = excluded.secret_enc, account = excluded.account,
       connected_by = excluded.connected_by, updated_at = datetime('now')`
  )
    .bind(googleKey(actor), await encryptText(data.refresh_token, env.CCCD_KEY), email, actor)
    .run();
  cached.delete(actor);
  return email as string | null;
}

const cached = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(env: GoogleEnv, actor: string): Promise<string> {
  const hit = cached.get(actor);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const row = await env.DB.prepare(`SELECT secret_enc FROM integrations WHERE name = ?`).bind(googleKey(actor)).first<{ secret_enc: string }>();
  if (!row) throw new Error('Chưa kết nối Google');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: await decryptText(row.secret_enc, env.CCCD_KEY),
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'Không lấy được quyền truy cập Google');
  cached.set(actor, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

/** Calls the Sheets API as the Google account this Admin Tổng linked. `path` starts after /v4/. */
export async function sheetsApi<T = any>(env: GoogleEnv, actor: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await accessToken(env, actor)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error?.message || `Google Sheets lỗi ${res.status}`);
  return data as T;
}
