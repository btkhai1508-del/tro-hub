/**
 * Scheduled jobs. Every job isolates failures per landlord / per house: one failing owner is logged
 * and never blocks the rest.
 */
import type { Env } from './app.ts';
import { allHouses, getStorage, houseOwner, removeHouseDir, setHouseCounts } from './central/directory.ts';
import { replayPendingDeferred } from './payments/settle.ts';
import { currentMonth, ensureMonthFresh, legacySheet, previousMonth } from './sheetSync.ts';
import { tenantOfOwner } from './tenant/route.ts';

async function warn(env: Env, action: string, houseId: string | null, target: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO audit_log (actor, action, house_id, target) VALUES ('system', ?, ?, ?)`)
    .bind(action, houseId, target.slice(0, 500)).run().catch(() => {});
}

/** Re-reads this and last month from the old Sheet into the store of every landlord that owns one of its houses. */
export async function syncLegacySheets(env: Env, onlyOwner?: number): Promise<void> {
  const legacy = await legacySheet(env.DB);
  if (!legacy) return;
  const owners = new Set<number>();
  for (const h of legacy.houses) {
    const owner = await houseOwner(env.DB, h).catch(() => null);
    if (owner !== null) owners.add(owner);
  }
  const month = currentMonth();
  for (const ownerId of owners) {
    if (onlyOwner !== undefined && ownerId !== onlyOwner) continue;
    try {
      if ((await getStorage(env.DB, ownerId)).backend === 'migrating') continue;
      const tenant = await tenantOfOwner(env, ownerId);
      for (const m of [month, previousMonth(month)]) await ensureMonthFresh(env.DB, tenant, m, 0);
    } catch (err) {
      console.warn('[cron] sheet sync', ownerId, err);
    }
  }
}

// Children first: foreign keys are on, in D1 and in a landlord's store alike.
const HOUSE_TABLES = ['payments', 'meter_readings', 'invoices', 'notifications', 'payment_gates', 'residents', 'rooms', 'house_rates'];

/**
 * Removes the houses whose grace period is over: the landlord's store first, then the resident index,
 * then the directory (and the staff links that point at it). A later step that fails leaves a warning
 * in the audit log and the rest for the nightly reconcile / next run.
 */
export async function purgeDeletedHouses(env: Env, hooks: { beforeDelete?: (houseId: string) => Promise<void> } = {}): Promise<string[]> {
  const { results } = await env.DB
    .prepare(`SELECT house_id, owner_id FROM house_directory WHERE delete_after IS NOT NULL AND delete_after <= datetime('now')`)
    .all<{ house_id: string; owner_id: number }>();
  const purged: string[] = [];
  for (const { house_id: houseId, owner_id: ownerId } of results) {
    try {
      if ((await getStorage(env.DB, ownerId)).backend === 'migrating') continue; // retried on the next run
      const store = await tenantOfOwner(env, ownerId);
      await hooks.beforeDelete?.(houseId);
      // The list above may be minutes old: a house restored meanwhile must survive, so look again right before deleting.
      const stillDue = await env.DB
        .prepare(`SELECT 1 FROM house_directory WHERE house_id = ? AND delete_after IS NOT NULL AND delete_after <= datetime('now')`)
        .bind(houseId)
        .first();
      if (!stillDue) continue;
      await store.batch([
        ...HOUSE_TABLES.map((t) => store.prepare(`DELETE FROM ${t} WHERE house_id = ?`).bind(houseId)),
        store.prepare(`DELETE FROM houses WHERE id = ?`).bind(houseId),
      ]);
    } catch (err) {
      console.warn('[cron] purge store', houseId, err);
      await warn(env, 'house_purge_warning', houseId, `store: ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    purged.push(houseId);
    try {
      await env.DB.prepare(`DELETE FROM resident_index WHERE house_id = ?`).bind(houseId).run();
    } catch (err) {
      await warn(env, 'house_purge_warning', houseId, `resident_index: ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    try {
      await env.DB.prepare(`DELETE FROM staff_houses WHERE house_id = ?`).bind(houseId).run();
      await removeHouseDir(env.DB, houseId);
    } catch (err) {
      await warn(env, 'house_purge_warning', houseId, `directory: ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    await env.DB.prepare(`INSERT INTO audit_log (actor, action, house_id) VALUES ('system', 'house_purged', ?)`).bind(houseId).run().catch(() => {});
  }
  return purged;
}

export interface ReconcileResult {
  countsFixed: number;
  indexMismatches: { residentId: number; problem: string }[];
  /** Directory vs the landlord's store (report only). */
  houseMismatches: { houseId: string; problem: string }[];
}

/**
 * Recomputes each house's room/resident counters from its landlord's store and compares the resident
 * index with the store's residents. Mismatches are only reported, never fixed. Saved in settings.last_reconcile.
 */
export async function reconcile(env: Env): Promise<ReconcileResult> {
  const out: ReconcileResult = { countsFixed: 0, indexMismatches: [], houseMismatches: [] };
  const houses = await allHouses(env.DB);
  // A landlord on their own store with no house in the directory is still checked (their store may hold houses the directory lacks).
  const { results: inDo } = await env.DB.prepare(`SELECT owner_id FROM tenant_storage WHERE backend = 'do'`).all<{ owner_id: number }>();
  const owners = [...new Set([...houses.map((h) => h.owner_id), ...inDo.map((r) => r.owner_id)])];
  for (const ownerId of owners) {
    try {
      if ((await getStorage(env.DB, ownerId)).backend === 'migrating') continue;
      const store = await tenantOfOwner(env, ownerId);
      for (const h of houses.filter((x) => x.owner_id === ownerId)) {
        const n = await store
          .prepare(
            `SELECT (SELECT COUNT(*) FROM rooms WHERE house_id = ?1 AND deleted_at IS NULL) AS rooms,
                    (SELECT COUNT(*) FROM residents WHERE house_id = ?1 AND status = 'approved' AND deleted_at IS NULL) AS residents`
          )
          .bind(h.house_id)
          .first<{ rooms: number; residents: number }>();
        if (n && (n.rooms !== h.room_count || n.residents !== h.resident_count)) {
          await setHouseCounts(env.DB, h.house_id, { rooms: n.rooms, residents: n.residents });
          out.countsFixed++;
        }
      }
      const { results: storeHouses } = await store
        .prepare(`SELECT id, name, status, delete_after, pay_no FROM houses WHERE owner_id = ?`)
        .bind(ownerId)
        .all<{ id: string; name: string; status: string; delete_after: string | null; pay_no: number | null }>();
      const inStoreHouses = new Map(storeHouses.map((x) => [x.id, x]));
      const ownDir = houses.filter((x) => x.owner_id === ownerId);
      for (const h of ownDir) {
        const x = inStoreHouses.get(h.house_id);
        if (!x) {
          out.houseMismatches.push({ houseId: h.house_id, problem: 'in directory but missing from store' });
          continue;
        }
        const diff = (['name', 'status', 'delete_after', 'pay_no'] as const)
          .filter((f) => (h[f] ?? null) !== (x[f] ?? null))
          .map((f) => `${f} (directory ${h[f] ?? 'null'}, store ${x[f] ?? 'null'})`);
        if (diff.length) out.houseMismatches.push({ houseId: h.house_id, problem: `differs: ${diff.join('; ')}` });
      }
      const dirIds = new Set(ownDir.map((x) => x.house_id));
      for (const x of storeHouses) if (!dirIds.has(x.id)) out.houseMismatches.push({ houseId: x.id, problem: 'in store but missing from directory' });
      let { results: stored } = await store
        .prepare(`SELECT id, house_id, deleted_at FROM residents`)
        .all<{ id: number; house_id: string; deleted_at: string | null }>();
      const ownHouses = new Set(houses.filter((x) => x.owner_id === ownerId).map((x) => x.house_id));
      stored = stored.filter((r) => ownHouses.has(r.house_id)); // the shared D1 also holds other landlords' rows
      const inStore = new Map(stored.map((r) => [r.id, r]));
      const { results: indexed } = await env.DB
        .prepare(`SELECT resident_id, house_id FROM resident_index WHERE owner_id = ?`)
        .bind(ownerId)
        .all<{ resident_id: number; house_id: string }>();
      const inIndex = new Set(indexed.map((r) => r.resident_id));
      for (const r of indexed) {
        const s = inStore.get(r.resident_id);
        if (!s) out.indexMismatches.push({ residentId: r.resident_id, problem: 'in index but missing from store' });
        else if (s.house_id !== r.house_id) out.indexMismatches.push({ residentId: r.resident_id, problem: `house differs (index ${r.house_id}, store ${s.house_id})` });
      }
      for (const s of stored) if (!s.deleted_at && !inIndex.has(s.id)) out.indexMismatches.push({ residentId: s.id, problem: 'in store but missing from index' });
    } catch (err) {
      console.warn('[cron] reconcile', ownerId, err);
    }
  }
  await env.DB
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('last_reconcile', ?, datetime('now'))
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify({ ranAt: new Date().toISOString(), ...out }))
    .run();
  return out;
}

export const FREQUENT_CRON = '*/10 * * * *';
export const DAILY_CRON = '0 19 * * *';

/** The jobs behind one cron expression, each failing alone. */
export async function runCron(cron: string, env: Env): Promise<void> {
  const jobs: [string, () => Promise<unknown>][] =
    cron === DAILY_CRON
      ? [['purge', () => purgeDeletedHouses(env)], ['reconcile', () => reconcile(env)]]
      : [['sheet sync', () => syncLegacySheets(env)], ['replay deferred', () => replayPendingDeferred(env)]];
  // One after another (purge before reconcile, so reconcile sees the purged state); each fails alone.
  for (const [name, job] of jobs) await job().catch((err) => console.warn('[cron]', name, err));
}
