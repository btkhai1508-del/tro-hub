/**
 * Developer-only: where each landlord's data lives, and the dry run / move / rollback / unlock of one landlord
 * (migrate/tenant.ts). /api/dev/* is guarded by requireAuth + developerOnly in registerHouses.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, type App } from '../app.ts';
import { getStorage, newOwnerBackend } from '../central/directory.ts';
import { migrateOwner, rollbackOwner, unlockOwner, type MigrationErrorCode, type MigrationReport } from '../migrate/tenant.ts';
import { tenantStub } from '../tenant/route.ts';
import type { TenantInfo } from '../tenant/store.ts';

type Status = 200 | 404 | 409 | 500;

const STATUS: Partial<Record<MigrationErrorCode, Status>> = {
  LANDLORD_NOT_FOUND: 404,
  MIGRATION_RUNNING: 409,
  ALREADY_MIGRATED: 409,
  NOT_MIGRATED: 409,
  STORE_NOT_EMPTY: 409,
  SHARED_BANK_ACCOUNT: 409,
};

/** A finished run answers 200; a refusal 409/404; a run that started and failed 500. The report is always in the body. */
function reply(c: Context<App>, r: MigrationReport) {
  const status: Status = r.ok ? 200 : STATUS[r.errorCode!] ?? 500;
  return c.json(r.ok ? { success: true, report: r } : { success: false, errorCode: r.errorCode, error: r.error, report: r }, status);
}

export function registerStorage(app: Hono<App>): void {
  /** One row per landlord: the switch, the lock, and (for those on their own store) the store's own numbers. */
  app.get('/api/dev/storage', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT s.id, s.full_name, s.phone, (SELECT COUNT(*) FROM house_directory d WHERE d.owner_id = s.id) AS houses
         FROM staff s WHERE s.role = 'owner' ORDER BY s.id`
    ).all<{ id: number; full_name: string; phone: string; houses: number }>();
    const owners = [];
    for (const o of results) {
      const st = await getStorage(c.env.DB, o.id);
      const note = (await c.env.DB.prepare(`SELECT note, changed_at FROM tenant_storage WHERE owner_id = ?`).bind(o.id).first<{ note: string | null; changed_at: string | null }>()) ?? null;
      let store: TenantInfo | null = null;
      if (st.backend !== 'd1') store = await tenantStub(c.env, o.id).info().catch(() => null); // never wake a store that is not in use
      owners.push({ ownerId: o.id, name: o.full_name, phone: o.phone, houses: o.houses, backend: st.backend, lockExpiresAt: st.lockExpiresAt, migratedAt: st.migratedAt, note: note?.note ?? null, changedAt: note?.changed_at ?? null, store });
    }
    return c.json({ success: true, newOwnerBackend: await newOwnerBackend(c.env.DB), owners });
  });

  const run = (action: 'dry-run' | 'migrate' | 'rollback') => async (c: Context<App>) => {
    const ownerId = Number(c.req.param('ownerId'));
    if (!Number.isInteger(ownerId) || ownerId <= 0) return c.json({ success: false, errorCode: 'LANDLORD_NOT_FOUND', error: 'Không tìm thấy chủ trọ.' }, 404);
    await audit(c, actorOf(c.get('viewer')), `storage_${action}`.replace('-', '_'), null, `staff:${ownerId}`);
    const report = action === 'rollback' ? await rollbackOwner(c.env, ownerId) : await migrateOwner(c.env, ownerId, { dryRun: action === 'dry-run' });
    await audit(c, actorOf(c.get('viewer')), `storage_${action}_${report.ok ? 'ok' : 'failed'}`.replace('-', '_'), null, `staff:${ownerId}${report.errorCode ? ` ${report.errorCode}` : ''}`);
    return reply(c, report);
  };
  app.post('/api/dev/storage/:ownerId/dry-run', run('dry-run'));
  app.post('/api/dev/storage/:ownerId/migrate', run('migrate'));
  app.post('/api/dev/storage/:ownerId/rollback', run('rollback'));

  app.post('/api/dev/storage/:ownerId/unlock', async (c) => {
    const ownerId = Number(c.req.param('ownerId'));
    const r = await unlockOwner(c.env, Number.isInteger(ownerId) ? ownerId : 0);
    await audit(c, actorOf(c.get('viewer')), r.ok ? 'storage_unlock' : 'storage_unlock_refused', null, `staff:${ownerId}`);
    if (!r.ok) return c.json({ success: false, errorCode: 'NOT_LOCKED', error: r.error }, 409);
    return c.json({ success: true, backend: r.backend, replayed: r.replayed });
  });
}
