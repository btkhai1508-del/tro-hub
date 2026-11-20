/**
 * One-way export to the old Google Sheet while the Worker owns the data (source = 'worker').
 * Writes enqueue a row in the central `sheet_export_queue`; the 10-minute cron drains it through the
 * existing Apps Script web app, with the action names and parameter shapes Express uses today.
 * Every action is overwrite-style (cells are set, never incremented), so a retry is harmless; the two
 * exceptions (register_account, delete_*) treat the "already done" answer as success.
 */
import type { Env } from './app.ts';
import { isWorkerSource } from './billing/source.ts';
import { APPS_SCRIPT_URL, legacySheet } from './sheetSync.ts';

export type ExportKind = 'meters' | 'payment' | 'config' | 'register_account' | 'update_profile' | 'update_account_status' | 'delete_resident';

/** Apps Script action behind each kind (delete_resident with mode 'account' becomes delete_account, as in Express). */
const ACTION: Record<ExportKind, string> = {
  meters: 'update_meters',
  payment: 'update_payment',
  config: 'update_config',
  register_account: 'register_account',
  update_profile: 'update_profile',
  update_account_status: 'update_account_status',
  delete_resident: 'delete_resident',
};
/** Actions whose answer must name the action (an older script deployment answers success without it). */
const NAMED = new Set(['register_account', 'update_profile', 'update_account_status', 'delete_resident', 'delete_account']);

export const MAX_ATTEMPTS = 5;
/**
 * Rows per cron tick. Each row costs one Apps Script call and one D1 update; with the few reads before it this stays
 * under the 50 subrequests of the free plan (and far under 1000).
 */
export const DRAIN_LIMIT = 20;

/**
 * Queues one Sheet write. `payload.houseId` says which house it belongs to (checked against the legacy Sheet's houses,
 * removed before sending); the rest is sent as the Apps Script parameters. Never throws: the caller's own write is
 * already committed, so a failed enqueue is logged and recorded in the audit log instead.
 */
export async function enqueueExport(db: D1Database, kind: ExportKind, payload: Record<string, unknown>): Promise<void> {
  try {
    if (!(await isWorkerSource(db))) return;
    const houseId = String(payload.houseId ?? '');
    const legacy = await legacySheet(db);
    if (!houseId || !legacy?.houses.includes(houseId)) return;
    await db.prepare(`INSERT INTO sheet_export_queue (kind, payload) VALUES (?, ?)`).bind(kind, JSON.stringify(payload)).run();
  } catch (err) {
    console.warn('[sheetExport] enqueue failed', kind, err);
    await db
      .prepare(`INSERT INTO audit_log (actor, action, house_id, target) VALUES ('system', 'sheet_export_enqueue_failed', ?, ?)`)
      .bind(String(payload.houseId ?? '') || null, `${kind}: ${String((err as Error)?.message ?? err)}`.slice(0, 500))
      .run()
      .catch(() => {});
  }
}

interface QueueRow { id: number; kind: ExportKind; payload: string }

/** Rows that overwrite each other: the latest wins (full state per room+month / house+month). */
function coalesceKey(row: QueueRow, p: Record<string, unknown>): string | null {
  if (row.kind === 'meters' || row.kind === 'payment') return `${row.kind}|${p.houseId}|${p.room}|${p.month}`;
  if (row.kind === 'config') return `config|${p.houseId}|${p.month}`;
  return null;
}

async function send(kind: ExportKind, payload: Record<string, unknown>): Promise<void> {
  // A cleared reading ('') is skipped by the script: the old value stays on the Sheet.
  const { houseId: _h, mode, ...params } = payload;
  const action = kind === 'delete_resident' && mode === 'account' ? 'delete_account' : ACTION[kind];
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json<{ success?: boolean; action?: string; error?: string }>().catch(() => null);
  if (!data) throw new Error('Apps Script returned no valid JSON');
  if (!data.success) {
    const message = data.error || 'Apps Script refused';
    // Already done on an earlier attempt whose answer was lost: nothing left to write.
    if (action === 'register_account' && /đã được đăng ký/.test(message)) return;
    if (action.startsWith('delete_') && /Không tìm thấy/.test(message)) return;
    throw new Error(message);
  }
  if (NAMED.has(action) && data.action !== action) throw new Error('Apps Script has no newer deployment');
}

/** Sends the oldest pending rows (at most DRAIN_LIMIT), each on its own. Only runs in worker mode. */
export async function drainExportQueue(env: Env): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (env.SHEET_WRITES === 'off' || !(await isWorkerSource(env.DB))) return out;
  const { results } = await env.DB
    .prepare(`SELECT id, kind, payload, attempts FROM sheet_export_queue WHERE done_at IS NULL ORDER BY id`)
    .all<QueueRow & { attempts: number }>();
  // Older rows of the same room+month (or house+month) are superseded by the latest one.
  const latest = new Map<string, number>();
  const parsed = new Map<number, Record<string, unknown>>();
  for (const r of results) {
    try { parsed.set(r.id, JSON.parse(r.payload)); } catch { parsed.set(r.id, {}); }
    const key = coalesceKey(r, parsed.get(r.id)!);
    if (key) latest.set(key, r.id);
  }
  // `latest` also counts rows that gave up (5 attempts): an older pending row must never overtake a newer dead one.
  const todo: QueueRow[] = [];
  const superseded: number[] = [];
  for (const r of results) {
    const key = coalesceKey(r, parsed.get(r.id)!);
    if (key && latest.get(key) !== r.id) superseded.push(r.id);
    else if (r.attempts < MAX_ATTEMPTS) todo.push(r);
  }
  // One UPDATE per chunk instead of one per row (keeps the subrequest budget for the sends).
  for (let i = 0; i < superseded.length; i += 50) {
    const ids = superseded.slice(i, i + 50);
    await env.DB.prepare(`UPDATE sheet_export_queue SET done_at = datetime('now'), last_error = 'superseded' WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
  for (const row of todo.slice(0, DRAIN_LIMIT)) {
    try {
      await send(row.kind, parsed.get(row.id)!);
      await env.DB.prepare(`UPDATE sheet_export_queue SET done_at = datetime('now'), last_error = NULL WHERE id = ?`).bind(row.id).run();
      out.sent++;
    } catch (err) {
      out.failed++;
      await env.DB
        .prepare(`UPDATE sheet_export_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`)
        .bind(String((err as Error)?.message ?? err).slice(0, 300), row.id)
        .run()
        .catch(() => {});
    }
  }
  return out;
}

/** For /api/dev/storage: rows still waiting and the ones given up on (5 attempts). */
export async function exportQueueStatus(db: D1Database): Promise<{ pending: number; failed: { id: number; kind: string; lastError: string }[] }> {
  const p = await db.prepare(`SELECT COUNT(*) AS n FROM sheet_export_queue WHERE done_at IS NULL AND attempts < ?`).bind(MAX_ATTEMPTS).first<{ n: number }>();
  const { results } = await db
    .prepare(`SELECT id, kind, last_error FROM sheet_export_queue WHERE done_at IS NULL AND attempts >= ? ORDER BY id LIMIT 50`)
    .bind(MAX_ATTEMPTS)
    .all<{ id: number; kind: string; last_error: string | null }>();
  return { pending: p?.n ?? 0, failed: results.map((r) => ({ id: r.id, kind: r.kind, lastError: r.last_error ?? '' })) };
}

/** Gives up-rows (attempts >= 5) another round, e.g. after the missing Sheet tab was created. Returns how many. */
export async function requeueFailed(db: D1Database): Promise<number> {
  const r = await db.prepare(`UPDATE sheet_export_queue SET attempts = 0 WHERE done_at IS NULL AND attempts >= ?`).bind(MAX_ATTEMPTS).run();
  return r.meta?.changes ?? 0;
}
