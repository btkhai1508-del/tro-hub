import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth, registerAuth } from './routes/auth.ts';
import {
  currentMonth, ensureMonthFresh, legacyRoomCode, legacySheet, parseLegacyRoom, previousMonth,
} from './sheetSync.ts';
import { actorOf, audit, fail, staffOnly, type App, type Env } from './app.ts';
import { TenantLockedError, tenantOfOwner } from './tenant/route.ts';
import { houseOwner } from './central/directory.ts';
import { registerHouses } from './routes/houses.ts';
import { registerPeople } from './routes/people.ts';
import { registerRent } from './routes/rent.ts';
import { registerIntegrations } from './routes/integrations.ts';
import { registerBilling } from './routes/billing.ts';
import { registerSepay, parseRentCode, rentPayCode } from './routes/sepay.ts';

export { TenantStore } from './tenant/store.ts';

const app = new Hono<App>();

app.use('/api/*', (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return cors({ origin: allowed, allowHeaders: ['Content-Type', 'Authorization'], maxAge: 86400 })(c, next); // maxAge: không gửi lại OPTIONS mỗi lần app hỏi trạng thái
});

registerAuth(app);

app.use('/api/houses', requireAuth);
app.use('/api/houses/*', requireAuth);

registerIntegrations(app);
registerHouses(app);
registerPeople(app);
registerRent(app);
registerBilling(app);
registerSepay(app);

// ---------------------------------------------------------------------------
// Routes that replace the Express + Google Sheet ones, with the same paths and response shapes,
// so the app moves over one data group at a time. Room codes keep the old form: LVC rooms are
// "LVC-101", other houses' rooms are their plain name.
// ---------------------------------------------------------------------------

export { legacyRoomCode, parseLegacyRoom, parseRentCode, rentPayCode };

interface NotificationRow {
  id: number; house_id: string; room_names: string | null; title: string; content: string; type: string;
  time_label: string | null; sender: string | null; scheduled_at: string | null; created_at: string;
}

const notificationOut = (n: NotificationRow) => ({
  id: `d1-${n.id}`,
  title: n.title,
  desc: n.content,
  time: n.time_label || 'Vừa xong',
  createdAt: `${n.created_at.replace(' ', 'T')}Z`,
  type: n.type,
  target: n.room_names ? 'CUSTOM' : n.house_id,
  customRooms: n.room_names ? (JSON.parse(n.room_names) as string[]).map((r) => legacyRoomCode(n.house_id, r)) : [],
  scheduledAt: n.scheduled_at,
  sender: n.sender ?? undefined,
  unread: true,
});

async function notificationsFor(db: D1Database, houseIds: string[], room: string | null, includeScheduled: boolean) {
  if (!houseIds.length) return [];
  const { results } = await db
    .prepare(
      `SELECT * FROM notifications WHERE deleted_at IS NULL AND house_id IN (${houseIds.map(() => '?').join(',')})
        ORDER BY created_at DESC, id DESC LIMIT 200`
    )
    .bind(...houseIds)
    .all<NotificationRow>();
  const now = Date.now();
  return results
    .filter((n) => includeScheduled || !n.scheduled_at || !(Date.parse(n.scheduled_at) > now))
    .filter((n) => !room || !n.room_names || (JSON.parse(n.room_names) as string[]).includes(room))
    .map(notificationOut);
}

/** A resident reads their house's notices (and their room's); staff read every house they manage. */
app.use('/api/notifications', requireAuth);
app.get('/api/notifications', async (c) => {
  const v = c.get('viewer');
  const list =
    v.kind === 'resident'
      ? await notificationsFor(c.env.DB, [v.houseId], v.roomName ?? '', false)
      : await notificationsFor(c.env.DB, v.houseIds, null, false);
  return c.json({ success: true, notifications: list });
});

app.use('/api/admin/notifications', requireAuth, staffOnly);
app.get('/api/admin/notifications', async (c) => {
  const v = c.get('viewer');
  return c.json({ success: true, notifications: await notificationsFor(c.env.DB, v.kind === 'staff' ? v.houseIds : [], null, true) });
});

/**
 * target: 'ALL' (every house this admin manages), a house id ('TRUNG_KIM', 'LVC', …) or 'CUSTOM'
 * with customRooms in the old room-code form. One row is stored per house reached.
 */
app.post('/api/admin/notifications', async (c) => {
  const v = c.get('viewer');
  if (v.kind !== 'staff') return fail(c, 403, 'STAFF_ONLY', 'Chỉ quản lý mới dùng được chức năng này.');
  const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);
  const title = String(body.title ?? '').trim();
  const content = String(body.desc ?? '').trim();
  if (!title || !content) return fail(c, 400, 'NOTIFICATION_INVALID', 'Thiếu tiêu đề hoặc nội dung thông báo');
  const type = ['invoice', 'alert', 'success', 'info'].includes(body.type) ? body.type : 'info';
  const target = String(body.target ?? 'ALL');

  const perHouse = new Map<string, string[] | null>();
  if (target === 'ALL') v.houseIds.forEach((h) => perHouse.set(h, null));
  else if (target === 'CUSTOM') {
    for (const code of Array.isArray(body.customRooms) ? body.customRooms : []) {
      const place = parseLegacyRoom(code);
      if (!place || !v.houseIds.includes(place.houseId)) continue;
      perHouse.set(place.houseId, [...(perHouse.get(place.houseId) ?? []), place.room]);
    }
  } else if (v.houseIds.includes(target)) perHouse.set(target, null);
  if (!perHouse.size) return fail(c, 400, 'NOTIFICATION_TARGET', 'Chưa chọn người nhận thuộc nhà bạn quản lý.');

  const scheduledAt = body.scheduledAt ? String(body.scheduledAt) : null;
  const rows = [...perHouse].map(([houseId, rooms]) =>
    c.env.DB.prepare(
      `INSERT INTO notifications (house_id, room_names, title, content, type, time_label, sender, scheduled_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(houseId, rooms ? JSON.stringify(rooms) : null, title, content, type, body.time ? String(body.time) : null,
      body.sender ? String(body.sender) : null, scheduledAt, actorOf(v))
  );
  const created = await c.env.DB.batch<NotificationRow>(rows);
  await audit(c, actorOf(v), 'notification_create', null, [...perHouse.keys()].join(','));
  return c.json({ success: true, notification: notificationOut(created[0].results[0]) });
});

/** Removes every row of the houses whose grace period is over. Children first: foreign keys are on. */
export async function purgeDeletedHouses(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT id FROM houses WHERE delete_after IS NOT NULL AND delete_after <= datetime('now')`)
    .all<{ id: string }>();
  for (const { id } of results) {
    await db.batch([
      ...['payments', 'meter_readings', 'invoices', 'notifications', 'residents', 'rooms', 'house_rates', 'staff_houses'].map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE house_id = ?`).bind(id)
      ),
      db.prepare(`DELETE FROM houses WHERE id = ?`).bind(id),
      db.prepare(`INSERT INTO audit_log (actor, action, house_id) VALUES ('system', 'house_purged', ?)`).bind(id),
    ]);
  }
  return results.map((r) => r.id);
}

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

// A write while the landlord's data is being moved answers 503; anything else as Hono's default handler.
app.onError((err, c) => {
  if (err instanceof TenantLockedError) return fail(c, 503, 'TENANT_MIGRATING', err.message);
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
});

const DAILY_CRON = '0 19 * * *';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === DAILY_CRON) ctx.waitUntil(purgeDeletedHouses(env.DB));
    // Mỗi 10 phút: đọc lại số tiền tháng này và tháng trước từ Sheet cũ.
    const month = currentMonth();
    // Task 9: the Sheet's houses belong to one landlord; sync into that landlord's store.
    ctx.waitUntil((async () => {
      const legacy = await legacySheet(env.DB);
      let ownerId: number | null = null;
      for (const h of legacy?.houses ?? []) if ((ownerId = await houseOwner(env.DB, h)) !== null) break;
      if (ownerId === null) return;
      const tenant = await tenantOfOwner(env, ownerId);
      await Promise.all([month, previousMonth(month)].map((m) => ensureMonthFresh(env.DB, tenant, m, 0)));
    })().catch((err) => console.warn('[cron] sheet sync', err)));
  },
} satisfies ExportedHandler<Env>;
