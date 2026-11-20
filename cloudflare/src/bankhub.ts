/**
 * SePay Bank Hub client (sandbox trial). Server side only: the client secret never leaves the Worker.
 * POST {base}/v1/token (Basic client_id:client_secret) -> { code, access_token, ttl (seconds) }, then Bearer calls.
 * The token is cached in memory per isolate until shortly before it expires and refreshed once on a 401.
 * Every call takes an injectable fetch so tests never reach the network.
 */
export interface BankHubEnv {
  BANKHUB_BASE?: string;
  BANKHUB_CLIENT_ID?: string;
  BANKHUB_CLIENT_SECRET?: string;
  BANKHUB_IPN_KEY?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_BANKHUB_BASE = 'https://bankhub-api.sepay.vn';
export const bankHubBase = (env: BankHubEnv) => (env.BANKHUB_BASE || DEFAULT_BANKHUB_BASE).replace(/\/+$/, '');
/** The API can be called only when both credentials are set. */
export const bankHubConfigured = (env: BankHubEnv) => Boolean(env.BANKHUB_CLIENT_ID && env.BANKHUB_CLIENT_SECRET);

export class BankHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The docs give ttl in seconds. Be conservative: keep a token for 80% of it, at most an hour, so a wrong unit only costs a refresh.
const TOKEN_MAX_MS = 3600_000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const resetBankHubTokenCache = () => tokenCache.clear();

export interface BankHubClient {
  createCompany(fullName: string): Promise<{ xid: string; fullName: string }>;
  createLinkToken(companyXid: string, opts?: { completionRedirectUri?: string }): Promise<{ xid: string; linkToken: string | null; hostedLinkUrl: string; expiresAt: string | null }>;
  listBankAccounts(companyXid: string): Promise<BankHubAccount[]>;
}

export interface BankHubAccount {
  xid: string;
  companyXid: string | null;
  bank: string | null;
  accountNumber: string | null;
  accountName: string | null;
  active: boolean;
}

type Json = Record<string, any>;

export function bankHubClient(env: BankHubEnv, fetchImpl: FetchLike = (u, i) => fetch(u, i)): BankHubClient {
  const base = bankHubBase(env);
  const cacheKey = `${base}|${env.BANKHUB_CLIENT_ID}`;

  async function readJson(res: Response): Promise<Json> {
    return ((await res.json().catch(() => ({}))) as Json) ?? {};
  }

  async function freshToken(): Promise<string> {
    if (!bankHubConfigured(env)) throw new BankHubError(503, 'Chưa cài BANKHUB_CLIENT_ID / BANKHUB_CLIENT_SECRET.');
    const res = await fetchImpl(`${base}/v1/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${env.BANKHUB_CLIENT_ID}:${env.BANKHUB_CLIENT_SECRET}`)}`, Accept: 'application/json' },
    });
    const data = await readJson(res);
    if (!res.ok || typeof data.access_token !== 'string' || !data.access_token)
      throw new BankHubError(res.status || 502, `Bank Hub từ chối cấp token (${res.status}).`);
    const ttl = Number(data.ttl);
    const keepMs = Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl * 800, TOKEN_MAX_MS) : 60_000;
    tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + keepMs });
    return data.access_token;
  }

  async function token(): Promise<string> {
    const hit = tokenCache.get(cacheKey);
    return hit && hit.expiresAt > Date.now() ? hit.token : freshToken();
  }

  /** A Bearer call; a 401 drops the cached token and retries once with a new one. */
  async function call(method: 'GET' | 'POST', path: string, body?: Json): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 401 && attempt === 0) {
        tokenCache.delete(cacheKey);
        continue;
      }
      const data = await readJson(res);
      if (!res.ok) throw new BankHubError(res.status, typeof data.message === 'string' ? data.message : `Bank Hub trả lỗi ${res.status}.`);
      return data;
    }
  }

  return {
    async createCompany(fullName) {
      const data = await call('POST', '/v1/company/create', { full_name: fullName, status: 'Active' });
      const xid = data.data?.xid;
      if (typeof xid !== 'string' || !xid) throw new BankHubError(502, 'Bank Hub không trả mã công ty.');
      return { xid, fullName: String(data.data?.full_name ?? fullName) };
    },
    async createLinkToken(companyXid, opts = {}) {
      const data = await call('POST', '/v1/link-token/create', {
        company_xid: companyXid,
        purpose: 'LINK_BANK_ACCOUNT',
        language: 'vi',
        ...(opts.completionRedirectUri ? { completion_redirect_uri: opts.completionRedirectUri } : {}),
      });
      // The docs list xid, hosted_link_url, link_token and expires_at at the top level of the 201 body.
      const d: Json = typeof data.hosted_link_url === 'string' ? data : (data.data ?? {});
      if (typeof d.hosted_link_url !== 'string' || !d.hosted_link_url) throw new BankHubError(502, 'Bank Hub không trả đường dẫn liên kết.');
      return { xid: String(d.xid ?? ''), linkToken: d.link_token ? String(d.link_token) : null, hostedLinkUrl: d.hosted_link_url, expiresAt: d.expires_at ? String(d.expires_at) : null };
    },
    async listBankAccounts(companyXid) {
      const out: BankHubAccount[] = [];
      for (let page = 1; page <= 20; page++) {
        const data = await call('GET', `/v1/bank-account?company_xid=${encodeURIComponent(companyXid)}&per_page=100&page=${page}`);
        for (const a of Array.isArray(data.data) ? data.data : []) {
          if (typeof a?.xid !== 'string') continue;
          out.push({
            xid: a.xid,
            companyXid: a.company_xid ? String(a.company_xid) : null,
            bank: a.brand_name ? String(a.brand_name) : null,
            accountNumber: a.account_number ? String(a.account_number) : null,
            accountName: a.account_holder_name ? String(a.account_holder_name) : null,
            active: String(a.active) === '1',
          });
        }
        if (!data.meta?.has_more) break;
      }
      return out;
    },
  };
}
