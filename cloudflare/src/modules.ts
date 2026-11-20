/**
 * Server-side enforcement of Tiện ích (service modules). The menu hides tools a house did not buy, but the
 * API must refuse them too. Core tools are never gated; a non-core key is allowed when the house's stored
 * list contains it, NULL meaning "every tool" (only the legacy houses from before tiện ích existed; houses
 * created today always store an explicit list). The Developer bypasses.
 *
 * Cost: the viewer is already loaded, so a check is one directory read (no catalog read: a non-core key
 * only needs the stored list), cached per request.
 */
import type { Context, Next } from 'hono';
import { canAccessHouse, fail, isDeveloper, type App, type Viewer } from './app.ts';

const MESSAGE = 'Nhà trọ của bạn chưa đăng ký tiện ích này. Vui lòng liên hệ Developer để bật.';

/** Directory `modules` column of the houses already read in this request (null = legacy "every tool"). */
const seen = new WeakMap<Request, Map<string, string | null | undefined>>();

async function storedModules(c: Context<App>, houseIds: string[]): Promise<Map<string, string | null | undefined>> {
  let cache = seen.get(c.req.raw);
  if (!cache) seen.set(c.req.raw, (cache = new Map()));
  const missing = houseIds.filter((h) => !cache!.has(h));
  for (let i = 0; i < missing.length; i += 90) {
    const part = missing.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(`SELECT house_id, modules FROM house_directory WHERE house_id IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ house_id: string; modules: string | null }>();
    const found = new Map(results.map((r) => [r.house_id, r.modules]));
    for (const h of part) cache.set(h, found.has(h) ? found.get(h)! : undefined); // undefined: no such house
  }
  return cache;
}

const has = (stored: string | null, key: string) => {
  if (stored === null) return true;
  try { return (JSON.parse(stored) as string[]).includes(key); } catch { return false; } // unreadable list: closed
};

/**
 * May this viewer use tool `key`? With a houseId: that house must use it. Without: any house the viewer
 * can open uses it (the union /api/modules shows), a resident being limited to their own house.
 */
export async function moduleAllowed(c: Context<App>, key: string, houseId?: string | null): Promise<boolean> {
  const viewer: Viewer = c.get('viewer');
  if (isDeveloper(viewer)) return true;
  if (houseId) {
    if (!canAccessHouse(viewer, houseId)) return false;
    const stored = (await storedModules(c, [houseId])).get(houseId);
    return stored !== undefined && has(stored, key);
  }
  const ids = viewer.kind === 'resident' ? [viewer.houseId] : viewer.houseIds;
  if (!ids.length) return false;
  const all = await storedModules(c, ids);
  return ids.some((h) => all.get(h) !== undefined && has(all.get(h)!, key));
}

/** The 403 answer for a tool that is off. */
export const moduleOff = (c: Context<App>) => fail(c, 403, 'MODULE_DISABLED', MESSAGE);

/** The 403 to return when the tool is off, or null when allowed. */
export async function ensureModule(c: Context<App>, key: string, houseId?: string | null): Promise<Response | null> {
  return (await moduleAllowed(c, key, houseId)) ? null : moduleOff(c);
}

/** Middleware form: the house is `:houseId` or ?houseId= when present, else the union over the viewer's houses. */
export const requireModule = (key: string) => async (c: Context<App>, next: Next) => {
  const houseId = c.req.param('houseId') || c.req.query('houseId')?.trim() || null;
  return (await ensureModule(c, key, houseId)) ?? next();
};
