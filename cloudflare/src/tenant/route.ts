/**
 * Which database holds a landlord's business tables right now, from the storage switch in the
 * central D1 (tenant_storage): `d1` → the shared D1 as today, `migrating` → the shared D1 read-only,
 * `do` → the landlord's own store.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { actorOf, audit, canAccessHouse, fail, type App, type Env } from '../app.ts';
import { getStorage, houseOwner, ROLLBACK_NOTE } from '../central/directory.ts';
import { readOnlyDb, remoteTenantDb, type TenantDb } from './db.ts';
import type { TenantStore } from './store.ts';

export { TenantLockedError } from './db.ts';

/** A landlord's store: `owner:<id>`, or `dryrun:owner:<id>` for a migration dry run; always placed in APAC. */
export function tenantStub(env: Env, ownerId: number, opts: { dryRun?: boolean } = {}): DurableObjectStub<TenantStore> {
  const name = `${opts.dryRun ? 'dryrun:' : ''}owner:${ownerId}`;
  return env.TENANT.get(env.TENANT.idFromName(name), { locationHint: 'apac' });
}

export async function tenantOfOwner(env: Env, ownerId: number): Promise<TenantDb> {
  const { backend, note } = await getStorage(env.DB, ownerId);
  if (backend === 'do') return remoteTenantDb(tenantStub(env, ownerId), `owner:${ownerId}`);
  // A rollback lock: the landlord's own store is still the truth (D1 is the stale pre-move copy), so read it, read-only.
  if (backend === 'migrating' && note === ROLLBACK_NOTE) return readOnlyDb(remoteTenantDb(tenantStub(env, ownerId), `owner:${ownerId}`));
  if (backend === 'migrating') return readOnlyDb(env.DB); // reads still come from D1; writes answer 503
  return env.DB;
}

/**
 * The data of a house the caller may open. The access check comes first, so a house the caller may
 * not open answers 403 whether it exists or not; a house missing from the directory answers 404.
 */
export async function tenantFor(c: Context<App>, houseId: string): Promise<TenantDb> {
  const viewer = c.get('viewer');
  if (!canAccessHouse(viewer, houseId)) {
    await audit(c, actorOf(viewer), 'house_access_denied', houseId);
    throw new HTTPException(403, { res: fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn không có quyền xem nhà trọ này.') });
  }
  const ownerId = await houseOwner(c.env.DB, houseId);
  if (ownerId === null) throw new HTTPException(404, { res: fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.') });
  return tenantOfOwner(c.env, ownerId);
}
