/**
 * SePay OAuth2: each landlord links their own SePay account to Trọ Hub (they sign in to SePay and
 * press "Đồng ý"; Trọ Hub never sees their password). With the token Trọ Hub reads their bank
 * accounts and creates one webhook on their SePay account that reports incoming transfers to
 * /api/sepay/webhook. Money still lands straight in the landlord's bank account.
 *
 * client_id / client_secret belong to the Trọ Hub OAuth app (one pair), set as Worker secrets.
 * Tokens are stored per landlord in sepay_connections, encrypted with CCCD_KEY.
 */
import { decryptText, encryptText } from './cccd.ts';

export interface SepayEnv {
  DB: D1Database;
  CCCD_KEY: string;
  JWT_SECRET: string;
  SEPAY_OAUTH_CLIENT_ID?: string;
  SEPAY_OAUTH_CLIENT_SECRET?: string;
  /** https://my.sepay.vn unless set (a local mock while testing). */
  SEPAY_OAUTH_BASE?: string;
  /** Public origin SePay should send webhooks to, when it differs from the Worker's own origin. */
  SEPAY_WEBHOOK_ORIGIN?: string;
}

export const SEPAY_SCOPES = ['bank-account:read', 'webhook:read', 'webhook:write', 'webhook:delete', 'profile', 'company'];
const STATE_TTL_SECONDS = 30 * 60;

const base = (env: SepayEnv) => (env.SEPAY_OAUTH_BASE || 'https://my.sepay.vn').replace(/\/$/, '');
export const sepayConfigured = (env: SepayEnv) => Boolean(env.SEPAY_OAUTH_CLIENT_ID && env.SEPAY_OAUTH_CLIENT_SECRET);
export const sepayRedirectUri = (origin: string) => `${origin}/api/sepay/oauth/callback`;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`sepay-state:${text}`))));
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The consent link for one landlord. The state names the landlord and expires, signed, so the callback needs no login. */
export async function sepayConnectUrl(env: SepayEnv, origin: string, ownerId: number) {
  if (!sepayConfigured(env)) throw new Error('Chưa cài client_id / client_secret của ứng dụng SePay OAuth.');
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(9)));
  const payload = `${ownerId}.${Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS}.${nonce}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SEPAY_OAUTH_CLIENT_ID!,
    redirect_uri: sepayRedirectUri(origin),
    scope: SEPAY_SCOPES.join(' '),
    state: `${payload}.${await hmac(env.JWT_SECRET, payload)}`,
  });
  return `${base(env)}/oauth/authorize?${params}`;
}

/** The landlord id the link was made for, or null when the state is forged or expired. */
export async function checkSepayState(env: SepayEnv, state: string): Promise<number | null> {
  const [owner, exp, nonce, sig] = state.split('.');
  if (!owner || !exp || !nonce || !sig || Number(exp) < Date.now() / 1000) return null;
  return sig === (await hmac(env.JWT_SECRET, `${owner}.${exp}.${nonce}`)) ? Number(owner) : null;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string; message?: string };

async function tokenCall(env: SepayEnv, fields: Record<string, string>) {
  const res = await fetch(`${base(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...fields, client_id: env.SEPAY_OAUTH_CLIENT_ID ?? '', client_secret: env.SEPAY_OAUTH_CLIENT_SECRET ?? '' }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token || !data.refresh_token)
    throw new Error(data.error_description || data.message || data.error || `SePay từ chối cấp token (${res.status})`);
  return data as Required<Pick<TokenResponse, 'access_token' | 'refresh_token'>> & TokenResponse;
}

async function saveTokens(env: SepayEnv, ownerId: number, t: TokenResponse, oldRefreshEnc?: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600);
  const access = await encryptText(t.access_token!, env.CCCD_KEY);
  const refresh = await encryptText(t.refresh_token!, env.CCCD_KEY);
  if (oldRefreshEnc) {
    // Only the request that used this refresh token may store the next one.
    const row = await env.DB.prepare(
      `UPDATE sepay_connections SET access_enc = ?, refresh_enc = ?, expires_at = ?, updated_at = datetime('now')
        WHERE owner_id = ? AND refresh_enc = ? RETURNING owner_id`
    )
      .bind(access, refresh, expiresAt, ownerId, oldRefreshEnc)
      .first();
    return Boolean(row);
  }
  await env.DB.prepare(
    `INSERT INTO sepay_connections (owner_id, access_enc, refresh_enc, expires_at, scope) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (owner_id) DO UPDATE SET access_enc = excluded.access_enc, refresh_enc = excluded.refresh_enc,
       expires_at = excluded.expires_at, scope = excluded.scope, connected_at = datetime('now'), updated_at = datetime('now')`
  )
    .bind(ownerId, access, refresh, expiresAt, t.scope ?? SEPAY_SCOPES.join(' '))
    .run();
  return true;
}

export async function finishSepayConnect(env: SepayEnv, origin: string, code: string, ownerId: number) {
  const t = await tokenCall(env, { grant_type: 'authorization_code', code, redirect_uri: sepayRedirectUri(origin) });
  await saveTokens(env, ownerId, t);
}

type ConnRow = { access_enc: string; refresh_enc: string; expires_at: number; webhook_id: string | null };

const readConn = (env: SepayEnv, ownerId: number) =>
  env.DB.prepare(`SELECT access_enc, refresh_enc, expires_at FROM sepay_connections WHERE owner_id = ?`).bind(ownerId).first<ConnRow>();

/** Refreshes in flight in this isolate, so parallel calls for one landlord share a single refresh. */
const refreshing = new Map<number, Promise<string>>();

async function refreshToken(env: SepayEnv, ownerId: number, row: ConnRow): Promise<string> {
  let t: TokenResponse;
  try {
    t = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: await decryptText(row.refresh_enc, env.CCCD_KEY) });
  } catch {
    // SePay rotates refresh tokens: if another request (or isolate) already used this one, take what it stored.
    const now = await readConn(env, ownerId);
    if (now && now.refresh_enc !== row.refresh_enc) return decryptText(now.access_enc, env.CCCD_KEY);
    throw new Error('Quyền truy cập SePay đã hết hạn hoặc bị thu hồi. Chủ trọ cần kết nối lại.');
  }
  if (!(await saveTokens(env, ownerId, t, row.refresh_enc))) {
    const now = await readConn(env, ownerId);
    if (!now) throw new Error('Chủ trọ này chưa kết nối SePay.');
    return decryptText(now.access_enc, env.CCCD_KEY);
  }
  return t.access_token!;
}

/** A valid access token for this landlord, refreshed when it is about to expire. */
async function accessToken(env: SepayEnv, ownerId: number, force = false): Promise<string> {
  const row = await readConn(env, ownerId);
  if (!row) throw new Error('Chủ trọ này chưa kết nối SePay.');
  if (!force && row.expires_at > Date.now() / 1000 + 60) return decryptText(row.access_enc, env.CCCD_KEY);
  const pending = refreshing.get(ownerId);
  if (pending) return pending;
  const p = refreshToken(env, ownerId, row).finally(() => refreshing.delete(ownerId));
  refreshing.set(ownerId, p);
  return p;
}

/** Calls the SePay API (path after /api/v1/) as this landlord; retries once with a refreshed token on 401. */
export async function sepayApi<T = any>(env: SepayEnv, ownerId: number, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(env, ownerId, attempt > 0);
    const res = await fetch(`${base(env)}/api/v1/${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue;
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || `SePay báo lỗi ${res.status}`), { status: res.status });
    return data as T;
  }
  throw new Error('Quyền truy cập SePay đã hết hạn hoặc bị thu hồi. Chủ trọ cần kết nối lại.');
}

export type BankAccountSummary = { id: number; bank: string; last4: string; holder: string; active: boolean };

const WEBHOOK_NAME = 'Trọ Hub – báo tiền trọ';

/**
 * Reads the landlord's company and bank accounts, and makes sure Trọ Hub's webhook exists on
 * their SePay account (creates it the first time, or again if they deleted it).
 */
export async function syncSepay(env: SepayEnv, origin: string, ownerId: number) {
  const [profile, company, accounts] = await Promise.all([
    sepayApi(env, ownerId, 'me').catch(() => null),
    sepayApi(env, ownerId, 'company').catch(() => null),
    sepayApi<{ data?: any[] }>(env, ownerId, 'bank-accounts?per_page=100'),
  ]);
  const bankAccounts: BankAccountSummary[] = (accounts.data ?? []).map((a) => ({
    id: Number(a.id),
    bank: String(a.bank?.short_name ?? a.bank?.brand_name ?? ''),
    last4: String(a.account_number ?? '').slice(-4),
    holder: String(a.account_holder_name ?? ''),
    active: a.active !== false && a.active !== 0,
  }));
  const name = company?.data?.full_name || company?.data?.short_name || company?.data?.name || [profile?.data?.first_name, profile?.data?.last_name].filter(Boolean).join(' ') || null;

  const row = await env.DB.prepare(`SELECT webhook_id FROM sepay_connections WHERE owner_id = ?`).bind(ownerId).first<{ webhook_id: string | null }>();
  let webhookId = row?.webhook_id ?? null;
  if (webhookId) {
    const exists = await sepayApi(env, ownerId, `webhooks/${webhookId}`).then(() => true, (e) => (e.status === 404 ? false : true));
    if (!exists) webhookId = null;
  }
  let keySha: string | null = null;
  if (!webhookId && bankAccounts.length) {
    const apiKey = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const created = await sepayApi<{ data?: { id?: number | string } }>(env, ownerId, 'webhooks', {
      method: 'POST',
      body: {
        bank_mode: 'all',
        name: WEBHOOK_NAME,
        event_type: 'In_only',
        authen_type: 'Api_Key',
        api_key: apiKey,
        request_content_type: 'Json',
        webhook_url: `${(env.SEPAY_WEBHOOK_ORIGIN || origin).replace(/\/$/, '')}/api/sepay/webhook`,
        is_verify_payment: 1,
        skip_if_no_code: 0,
        retry_conditions: ['non_2xx_status_code'],
        active: 1,
      },
    });
    webhookId = created.data?.id != null ? String(created.data.id) : null;
    if (!webhookId) throw new Error('SePay không trả về mã webhook vừa tạo.');
    keySha = await sha256Hex(apiKey);
  }

  await env.DB.prepare(
    `UPDATE sepay_connections SET company = ?, bank_accounts = ?, webhook_id = ?,
            webhook_key_sha256 = COALESCE(?, webhook_key_sha256), updated_at = datetime('now') WHERE owner_id = ?`
  )
    .bind(name, JSON.stringify(bankAccounts), webhookId, keySha, ownerId)
    .run();
  return { company: name, bankAccounts, webhookId };
}

/** Deletes Trọ Hub's webhook from the landlord's SePay account (best effort) and forgets the tokens. */
export async function disconnectSepay(env: SepayEnv, ownerId: number) {
  const row = await env.DB.prepare(`SELECT webhook_id FROM sepay_connections WHERE owner_id = ?`).bind(ownerId).first<{ webhook_id: string | null }>();
  let webhookRemoved = !row?.webhook_id;
  if (row?.webhook_id) {
    webhookRemoved = await sepayApi(env, ownerId, `webhooks/${row.webhook_id}`, { method: 'DELETE' }).then(
      () => true,
      (e) => e.status === 404
    );
  }
  await env.DB.prepare(`DELETE FROM sepay_connections WHERE owner_id = ?`).bind(ownerId).run();
  return { webhookRemoved };
}
