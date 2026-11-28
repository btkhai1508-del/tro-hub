/**
 * The admin bell. GET lists the alerts of the houses the caller manages (the landlord: every house; a manager: only
 * the houses given to them) with this person's read state and the unread count; POST .../read marks some (or all)
 * read for this person only. Alerts live in each landlord's own store; an id names its house ('<houseId>:<n>'), and
 * an id of a house the caller does not manage is refused (403), like every other admin route.
 */
import type { Context, Hono } from 'hono';
import { actorOf, fail, staffOnly, type App } from '../app.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';
import { staffHouseIds } from './rent.ts';

const LIMIT = 50;

interface AlertRow {
  id: number; house_id: string; kind: string; room_name: string | null; month: string | null; amount: number | null;
  received_at: string; source: string | null; created_at: string; is_read: number;
}

/** The caller's houses grouped by owning landlord, with the house names. */
async function storesOf(c: Context<App>, houseIds: string[]) {
  if (!houseIds.length) return [];
  const { results } = await c.env.DB.prepare(
    `SELECT house_id, owner_id, name FROM house_directory WHERE house_id IN (${houseIds.map(() => '?').join(',')})`
  ).bind(...houseIds).all<{ house_id: string; owner_id: number; name: string }>();
  const byOwner = new Map<number, { houseIds: string[]; names: Map<string, string> }>();
  for (const r of results) {
    const g = byOwner.get(r.owner_id) ?? { houseIds: [] as string[], names: new Map<string, string>() };
    g.houseIds.push(r.house_id);
    g.names.set(r.house_id, r.name);
    byOwner.set(r.owner_id, g);
  }
  return Promise.all([...byOwner].map(async ([ownerId, g]) => ({ db: await tenantOfOwner(c.env, ownerId), ...g })));
}

const utcIso = (t: string) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t) ? `${t.replace(' ', 'T')}Z` : t);
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

async function listFor(c: Context<App>) {
  const v = c.get('viewer');
  const reader = actorOf(v);
  const alerts: (ReturnType<typeof out>)[] = [];
  let unread = 0;
  const out = (r: AlertRow, names: Map<string, string>) => ({
    id: `${r.house_id}:${r.id}`, kind: r.kind, houseId: r.house_id, houseName: names.get(r.house_id) ?? r.house_id,
    room: r.room_name, month: r.month, amount: r.amount, receivedAt: utcIso(r.received_at), createdAt: utcIso(r.created_at),
    source: r.source, read: r.is_read === 1,
  });
  for (const s of await storesOf(c, staffHouseIds(v))) {
    const [{ results }, count] = await Promise.all([
      s.db.prepare(
        `SELECT a.id, a.house_id, a.kind, a.room_name, a.month, a.amount, a.received_at, a.source, a.created_at,
                EXISTS (SELECT 1 FROM admin_alert_reads r WHERE r.alert_id = a.id AND r.reader = ?) AS is_read
           FROM admin_alerts a WHERE a.house_id IN (${marks(s.houseIds.length)}) ORDER BY a.created_at DESC, a.id DESC LIMIT ${LIMIT}`
      ).bind(reader, ...s.houseIds).all<AlertRow>(),
      s.db.prepare(
        `SELECT COUNT(*) AS n FROM admin_alerts a WHERE a.house_id IN (${marks(s.houseIds.length)})
            AND NOT EXISTS (SELECT 1 FROM admin_alert_reads r WHERE r.alert_id = a.id AND r.reader = ?)`
      ).bind(...s.houseIds, reader).first<{ n: number }>(),
    ]);
    alerts.push(...results.map((r) => out(r, s.names)));
    unread += count?.n ?? 0;
  }
  alerts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { alerts: alerts.slice(0, LIMIT), unread };
}

export function registerAlerts(app: Hono<App>): void {
  app.use('/api/admin/alerts', requireAuth, staffOnly);
  app.use('/api/admin/alerts/*', requireAuth, staffOnly);

  app.get('/api/admin/alerts', async (c) => c.json({ success: true, ...(await listFor(c)) }));

  /** { ids: ['<houseId>:<n>', ...] } or { all: true }. Read state is this person's only. */
  app.post('/api/admin/alerts/read', async (c) => {
    const v = c.get('viewer');
    const reader = actorOf(v);
    const mine = staffHouseIds(v);
    const body = await c.req.json<{ ids?: unknown; all?: unknown }>().catch(() => ({} as { ids?: unknown; all?: unknown }));
    const all = body.all === true;
    const wanted = new Map<string, number[]>();
    if (!all) {
      const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200).map(String) : [];
      if (!ids.length) return fail(c, 400, 'ALERTS_INVALID', 'Chưa chọn thông báo nào.');
      for (const id of ids) {
        const at = id.lastIndexOf(':');
        const houseId = id.slice(0, at);
        const n = Number(id.slice(at + 1));
        if (at <= 0 || !Number.isInteger(n) || n <= 0) return fail(c, 400, 'ALERTS_INVALID', 'Thông báo không hợp lệ.');
        if (!mine.includes(houseId)) return fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn không có quyền xem nhà trọ này.');
        wanted.set(houseId, [...(wanted.get(houseId) ?? []), n]);
      }
    }
    for (const s of await storesOf(c, all ? mine : [...wanted.keys()])) {
      if (all) {
        await s.db.prepare(
          `INSERT OR IGNORE INTO admin_alert_reads (alert_id, reader) SELECT id, ? FROM admin_alerts WHERE house_id IN (${marks(s.houseIds.length)})`
        ).bind(reader, ...s.houseIds).run();
        continue;
      }
      // Each id must be an alert of the house it names: an id copied onto another house marks nothing.
      await s.db.batch(s.houseIds.flatMap((h) => (wanted.get(h) ?? []).map((n) =>
        s.db.prepare(`INSERT OR IGNORE INTO admin_alert_reads (alert_id, reader) SELECT id, ? FROM admin_alerts WHERE id = ? AND house_id = ?`).bind(reader, n, h))));
    }
    return c.json({ success: true, ...(await listFor(c)) });
  });
}
