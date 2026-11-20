/**
 * The source-of-truth switch. Anyone may read it (the app asks before login to pick between the
 * Sheet and the Worker); only the Developer changes it, and going back to the Sheet is refused while
 * the export queue still holds work the Sheet has not received.
 */
import type { Hono } from 'hono';
import { syncLegacySheets } from '../cron.ts';
import { requeueFailed } from '../sheetExport.ts';
import { actorOf, audit, developerOnly, fail, type App } from '../app.ts';
import { houseOwner } from '../central/directory.ts';
import { getSource, setSource, type Source } from '../billing/source.ts';
import { legacySheet } from '../sheetSync.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';

/** Residents created since the switch to 'worker' in houses that still have a legacy Sheet: they have no row there. */
async function workerOnlyResidents(env: App['Bindings']): Promise<number> {
  const legacy = await legacySheet(env.DB);
  const since = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'source_worker_since'`).first<{ value: string }>())?.value;
  if (!legacy || !since) return 0;
  const byOwner = new Map<number, string[]>();
  for (const houseId of legacy.houses) {
    const owner = await houseOwner(env.DB, houseId);
    if (owner !== null) byOwner.set(owner, [...(byOwner.get(owner) ?? []), houseId]);
  }
  let total = 0;
  for (const [owner, ids] of byOwner) {
    const db = await tenantOfOwner(env, owner);
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM residents WHERE house_id IN (${ids.map(() => '?').join(',')}) AND created_at >= ? AND deleted_at IS NULL`)
      .bind(...ids, since)
      .first<{ n: number }>();
    total += row?.n ?? 0;
  }
  return total;
}

export function registerSource(app: Hono<App>): void {
  app.get('/api/source', async (c) => {
    c.header('Cache-Control', 'public, max-age=30');
    return c.json({ success: true, source: await getSource(c.env.DB) });
  });

  app.put('/api/dev/source', requireAuth, developerOnly, async (c) => {
    const body = await c.req.json<{ source?: unknown; acknowledgeFailed?: unknown }>().catch(() => ({}) as { source?: unknown; acknowledgeFailed?: unknown });
    if (body.source !== 'sheet' && body.source !== 'worker') return fail(c, 400, 'SOURCE_INVALID', 'Nguồn dữ liệu chỉ có thể là "sheet" hoặc "worker".');
    const next: Source = body.source;
    const current = await getSource(c.env.DB);

    if (next === 'worker' && current !== 'worker' && !c.env.ZALO_APP_SECRET)
      return fail(c, 409, 'ZALO_NOT_CONFIGURED', 'Chưa thêm khoá bí mật Zalo vào Worker. Thêm ZALO_APP_SECRET rồi bật lại.');

    // Last read of the Sheet: whatever the landlord typed since the previous cron tick is imported before the Sheet becomes write-only.
    if (next === 'worker' && current !== 'worker') {
      try {
        await syncLegacySheets(c.env, undefined, true);
      } catch (err) {
        await audit(c, actorOf(c.get('viewer')), 'source_sync_failed', null, String((err as Error)?.message ?? err).slice(0, 300));
        return fail(c, 409, 'SYNC_FAILED', 'Chưa đọc được lần cuối từ Google Sheet nên chưa chuyển sang Worker. Kiểm tra Sheet rồi thử lại.');
      }
    }

    if (next === 'sheet' && current === 'worker') {
      const pending = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sheet_export_queue WHERE done_at IS NULL AND attempts < 5`).first<{ n: number }>();
      if (pending?.n)
        return fail(c, 409, 'EXPORT_PENDING', `Còn ${pending.n} thay đổi chưa chép sang Google Sheet. Đợi chép xong rồi mới chuyển về Sheet.`);
      // Rows that gave up are changes the Sheet never received: switching back would let the Sheet read overwrite them.
      const dead = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sheet_export_queue WHERE done_at IS NULL AND attempts >= 5`).first<{ n: number }>();
      if (dead?.n && body.acknowledgeFailed !== true)
        return fail(c, 409, 'EXPORT_FAILED', `Có ${dead.n} thay đổi không chép được sang Google Sheet (đã thử 5 lần). Thử lại các dòng lỗi, hoặc xác nhận bỏ qua rồi chuyển về Sheet.`);
    }

    // Counted while the switch is still on worker: the count tells the Developer how many residents the Sheet lacks.
    const workerOnly = next === 'sheet' && current === 'worker' ? await workerOnlyResidents(c.env) : 0;
    await setSource(c.env.DB, next);
    await audit(c, actorOf(c.get('viewer')), 'source_set', null, next);
    if (next === 'worker' && current !== 'worker') await audit(c, actorOf(c.get('viewer')), 'source_final_sync_ok', null, 'sheet');
    return c.json({ success: true, source: next, workerOnlyResidents: workerOnly });
  });

  /** Developer: gives the failed export rows another round (attempts back to 0). */
  app.post('/api/dev/export-queue/requeue', requireAuth, developerOnly, async (c) => {
    const requeued = await requeueFailed(c.env.DB);
    await audit(c, actorOf(c.get('viewer')), 'export_requeue', null, String(requeued));
    return c.json({ success: true, requeued });
  });
}
