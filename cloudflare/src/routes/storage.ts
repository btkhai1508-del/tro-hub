/**
 * Developer-only: where each landlord's data lives, and the dry run / move / rollback / unlock of one landlord
 * (migrate/tenant.ts). /api/dev/* is guarded by requireAuth + developerOnly in registerHouses.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, type App } from '../app.ts';
import { getSource } from '../billing/source.ts';
import { exportQueueStatus } from '../sheetExport.ts';
import { getStorage, newOwnerBackend } from '../central/directory.ts';
import { clearStore, migrateOwner, rollbackOwner, unlockOwner, type MigrationErrorCode, type MigrationReport } from '../migrate/tenant.ts';
import { ownerRowsFromD1 } from '../migrate/digest.ts';
import { TENANT_TABLES } from '../tenant/schema.ts';
import { tenantStub } from '../tenant/route.ts';
import type { TenantInfo } from '../tenant/store.ts';

type Status = 200 | 404 | 409 | 500;

const STATUS: Partial<Record<MigrationErrorCode, Status>> = {
  LANDLORD_NOT_FOUND: 404,
  MIGRATION_RUNNING: 409,
  ALREADY_MIGRATED: 409,
  NOT_MIGRATED: 409,
  STORE_IN_USE: 409,
  SHARED_BANK_ACCOUNT: 409,
};

/** A finished run answers 200; a refusal 409/404; a run that started and failed 500. The report is always in the body. */
function reply(c: Context<App>, r: MigrationReport) {
  const status: Status = r.ok ? 200 : STATUS[r.errorCode!] ?? 500;
  return c.json(r.ok ? { success: true, report: r } : { success: false, errorCode: r.errorCode, error: r.error, report: r }, status);
}

/** Cloudflare free-plan limits the page warns about. Durable Object storage is measured in decimal GB (1 GB = 1,000,000,000 bytes). */
export const FREE_LIMITS = { perStoreBytes: 1_000_000_000, totalBytes: 5_000_000_000, rowsWrittenPerDay: 100000 } as const;
const WARN_AT = 0.7;

const mb = (n: number) => `${(n / 1_000_000).toFixed(n >= 1_000_000_000 ? 0 : 1)} MB`;

/** Warnings (Vietnamese) when a store, the total size or today's writes reach 70% of the free plan. */
export function storageWarnings(input: { owners: { name: string; sizeBytes: number | null }[]; totalBytes: number; rowsWrittenToday: number }): string[] {
  const out: string[] = [];
  for (const o of input.owners) {
    if (o.sizeBytes !== null && o.sizeBytes >= WARN_AT * FREE_LIMITS.perStoreBytes) {
      out.push(`Kho của ${o.name} đã dùng ${Math.round((o.sizeBytes / FREE_LIMITS.perStoreBytes) * 100)}% giới hạn 1 GB của gói miễn phí.`);
    }
  }
  if (input.totalBytes >= WARN_AT * FREE_LIMITS.totalBytes) {
    out.push(`Tổng dung lượng các kho là ${mb(input.totalBytes)}, đã dùng ${Math.round((input.totalBytes / FREE_LIMITS.totalBytes) * 100)}% giới hạn 5 GB của gói miễn phí.`);
  }
  if (input.rowsWrittenToday >= WARN_AT * FREE_LIMITS.rowsWrittenPerDay) {
    out.push(`Hôm nay đã ghi ${input.rowsWrittenToday.toLocaleString('en-US')} dòng, đã dùng ${Math.round((input.rowsWrittenToday / FREE_LIMITS.rowsWrittenPerDay) * 100)}% giới hạn 100.000 dòng/ngày của gói miễn phí.`);
  }
  return out;
}

export function registerStorage(app: Hono<App>): void {
  /** One row per landlord: the switch, the lock, and (for those on their own store) the store's own numbers. */
  app.get('/api/dev/storage', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT s.id, s.full_name, s.phone, (SELECT COUNT(*) FROM house_directory d WHERE d.owner_id = s.id) AS houses
         FROM staff s WHERE s.role = 'owner' ORDER BY s.id`
    ).all<{ id: number; full_name: string; phone: string; houses: number }>();
    const owners = [];
    const failed: string[] = [];
    for (const o of results) {
      const st = await getStorage(c.env.DB, o.id);
      const note = (await c.env.DB.prepare(`SELECT note, changed_at FROM tenant_storage WHERE owner_id = ?`).bind(o.id).first<{ note: string | null; changed_at: string | null }>()) ?? null;
      let store: TenantInfo | null = null;
      // Only a landlord on their own store is asked; one failing store never fails the list.
      if (st.backend === 'do') {
        store = await tenantStub(c.env, o.id).info().catch(() => null);
        if (!store) failed.push(`Không đọc được kho của ${o.full_name}.`);
      }
      owners.push({
        ownerId: o.id, name: o.full_name, phone: o.phone, houses: o.houses, backend: st.backend, lockExpiresAt: st.lockExpiresAt,
        migratedAt: st.migratedAt, note: note?.note ?? null, changedAt: note?.changed_at ?? null,
        sizeBytes: store?.sizeBytes ?? null, rowsWrittenToday: store?.rowsWrittenToday ?? null, lastWriteAt: store?.lastWriteAt ?? null, store,
      });
    }
    const totalBytes = owners.reduce((n, o) => n + (o.sizeBytes ?? 0), 0);
    const rowsWrittenToday = owners.reduce((n, o) => n + (o.rowsWrittenToday ?? 0), 0);
    let lastReconcile: unknown = null;
    const lr = await c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'last_reconcile'`).first<{ value: string }>();
    if (lr) { try { lastReconcile = JSON.parse(lr.value); } catch { lastReconcile = null; } }
    return c.json({
      success: true, newOwnerBackend: await newOwnerBackend(c.env.DB), owners, totalBytes, rowsWrittenToday, freeLimits: FREE_LIMITS,
      source: await getSource(c.env.DB), exportQueue: await exportQueueStatus(c.env.DB),
      warnings: [...failed, ...storageWarnings({ owners, totalBytes, rowsWrittenToday })], lastReconcile,
    });
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

  /** Empty the live store of a landlord whose switch is on d1 (leftover of a crashed run). */
  app.post('/api/dev/storage/:ownerId/clear-store', async (c) => {
    const ownerId = Number(c.req.param('ownerId'));
    if (!Number.isInteger(ownerId) || ownerId <= 0) return c.json({ success: false, errorCode: 'LANDLORD_NOT_FOUND', error: 'Không tìm thấy chủ trọ.' }, 404);
    const r = await clearStore(c.env, ownerId);
    await audit(c, actorOf(c.get('viewer')), r.ok ? 'storage_clear_store' : 'storage_clear_store_refused', null, `staff:${ownerId}`);
    if (!r.ok) return c.json({ success: false, errorCode: r.errorCode, error: r.error }, r.errorCode === 'STORE_IN_USE' ? 409 : r.errorCode === 'LANDLORD_NOT_FOUND' ? 404 : 500);
    return c.json({ success: true });
  });

  app.post('/api/dev/storage/:ownerId/unlock', async (c) => {
    const ownerId = Number(c.req.param('ownerId'));
    const r = await unlockOwner(c.env, Number.isInteger(ownerId) ? ownerId : 0);
    await audit(c, actorOf(c.get('viewer')), r.ok ? 'storage_unlock' : 'storage_unlock_refused', null, `staff:${ownerId}`);
    if (!r.ok) return c.json({ success: false, errorCode: 'NOT_LOCKED', error: r.error }, 409);
    return c.json({ success: true, backend: r.backend, replayed: r.replayed });
  });

  /** Everything one landlord has, as a JSON download (their own rows only). */
  app.get('/api/dev/storage/:ownerId/export', async (c) => {
    const ownerId = Number(c.req.param('ownerId'));
    const owner = Number.isInteger(ownerId) && ownerId > 0
      ? await c.env.DB.prepare(`SELECT id FROM staff WHERE id = ? AND role = 'owner'`).bind(ownerId).first()
      : null;
    if (!owner) return c.json({ success: false, errorCode: 'LANDLORD_NOT_FOUND', error: 'Không tìm thấy chủ trọ.' }, 404);
    const { backend } = await getStorage(c.env.DB, ownerId);
    if (backend === 'migrating') return c.json({ success: false, errorCode: 'TENANT_MIGRATING', error: 'Đang chuyển dữ liệu, thử lại sau ít phút.' }, 409);
    const PAGE = 500;
    const tables: Record<string, unknown[]> = {};
    for (const t of TENANT_TABLES) {
      const all: unknown[] = [];
      for (let offset = 0; ; offset += PAGE) {
        let rows: unknown[];
        if (backend === 'do') {
          const page = await tenantStub(c.env, ownerId).exportTable(t.name, offset, PAGE);
          if (!page.ok) return c.json({ success: false, errorCode: 'EXPORT_FAILED', error: 'Chưa đọc được dữ liệu từ kho riêng.' }, 500);
          rows = page.rows;
        } else rows = await ownerRowsFromD1(c.env, ownerId, t, offset, PAGE);
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      tables[t.name] = all;
    }
    await audit(c, actorOf(c.get('viewer')), 'storage_export', null, `staff:${ownerId}`);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(JSON.stringify({ ownerId, exportedAt: new Date().toISOString(), tables }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="tro-hub-chu-tro-${ownerId}-${stamp}.json"` },
    });
  });
}
