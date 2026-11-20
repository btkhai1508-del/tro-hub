/**
 * Tiện ích gate for the Express routes of non-core tools. The truth is the Worker (houses.modules), so the
 * list is re-read live through the Worker bearer the session carries (`wt`), cached per session for 60 s:
 * a tool the Developer just enabled works within about a minute, a revoked one stops within about a minute.
 *
 * Fallbacks, all logged: the Worker unreachable or answering 5xx -> the modules claim copied into the token at
 * login (or, with no claim, allowed). Sessions without `wt` (Zalo login on Express, sheet mode, tokens issued
 * before this existed) use the claim, or are allowed when there is none; they expire within 30 days.
 * A Worker 401 means the Worker session is over (password changed, account locked): refuse with 401.
 */
import type { NextFunction, Response } from 'express';
import { MODULE_DISABLED_BODY, tokenAllowsModule, type AuthedRequest, type TenantTokenPayload } from './authToken.js';

export const MODULES_TTL_MS = 60_000;

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type ModuleVerdict = 'allowed' | 'disabled' | 'expired';

export function createModuleGate(baseUrl: string, opts: { fetchImpl?: FetchLike; now?: () => number; ttlMs?: number; warn?: (m: string) => void } = {}) {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? MODULES_TTL_MS;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const cache = new Map<string, { at: number; modules: string[] | 'expired' }>();

  async function live(wt: string): Promise<string[] | 'expired' | null> {
    const hit = cache.get(wt);
    if (hit && now() - hit.at < ttl) return hit.modules;
    try {
      const res = await fetchImpl(`${baseUrl}/api/modules`, { headers: { Authorization: `Bearer ${wt}` }, signal: AbortSignal.timeout(5000) });
      let value: string[] | 'expired' | null = null;
      if (res.status === 401) value = 'expired';
      else if (res.ok) {
        const body = await res.json().catch(() => null);
        if (Array.isArray(body?.modules)) value = body.modules.map(String);
      }
      if (value === null) return null; // 5xx / odd answer: not cached, caller falls back
      if (cache.size > 2000) for (const [k, v] of cache) if (now() - v.at >= ttl) cache.delete(k);
      cache.set(wt, { at: now(), modules: value });
      return value;
    } catch {
      return null;
    }
  }

  async function check(payload: TenantTokenPayload | undefined, key: string): Promise<ModuleVerdict> {
    if (!payload) return 'disabled';
    if (payload.wt) {
      const modules = await live(payload.wt);
      if (modules === 'expired') return 'expired';
      if (modules) return modules.includes(key) ? 'allowed' : 'disabled';
      warn('[modules] Worker unreachable, using the modules claim of the token');
    }
    return tokenAllowsModule(payload, key) ? 'allowed' : 'disabled';
  }

  const requireModule = (key: string) => async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const verdict = await check(req.tenant, key);
    if (verdict === 'expired') return res.status(401).json({ success: false, errorCode: 'AUTH_SESSION_EXPIRED', error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    if (verdict === 'disabled') return res.status(403).json(MODULE_DISABLED_BODY);
    next();
  };

  return { check, requireModule };
}
