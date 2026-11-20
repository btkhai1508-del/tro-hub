/**
 * Notices from the admins to residents. A notice lives in the store of the landlord who owns the house
 * it is addressed to; one row is written per house reached.
 */
import type { Hono } from 'hono';
import { moduleAllowed, moduleOff } from '../modules.ts';
import { actorOf, audit, fail, staffOnly, type App } from '../app.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { legacyRoomCode, parseLegacyRoom } from '../sheetSync.ts';
import { requireAuth } from './auth.ts';

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

/** Houses grouped by the landlord who owns them (a house missing from the directory is dropped). */
async function byOwner(db: D1Database, houseIds: string[]): Promise<Map<number, string[]>> {
  const groups = new Map<number, string[]>();
  if (!houseIds.length) return groups;
  const { results } = await db
    .prepare(`SELECT house_id, owner_id FROM house_directory WHERE house_id IN (${houseIds.map(() => '?').join(',')})`)
    .bind(...houseIds)
    .all<{ house_id: string; owner_id: number }>();
  for (const r of results) groups.set(r.owner_id, [...(groups.get(r.owner_id) ?? []), r.house_id]);
  return groups;
}

async function notificationsFor(c: { env: App['Bindings'] }, houseIds: string[], room: string | null, includeScheduled: boolean) {
  const rows: NotificationRow[] = [];
  for (const [ownerId, houses] of await byOwner(c.env.DB, houseIds)) {
    const tenant = await tenantOfOwner(c.env, ownerId);
    const { results } = await tenant
      .prepare(
        `SELECT * FROM notifications WHERE deleted_at IS NULL AND house_id IN (${houses.map(() => '?').join(',')})
          ORDER BY created_at DESC, id DESC LIMIT 200`
      )
      .bind(...houses)
      .all<NotificationRow>();
    rows.push(...results);
  }
  if (rows.length && new Set(rows.map((r) => r.house_id)).size > 1) {
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
  }
  const now = Date.now();
  return rows
    .slice(0, 200)
    .filter((n) => includeScheduled || !n.scheduled_at || !(Date.parse(n.scheduled_at) > now))
    .filter((n) => !room || !n.room_names || (JSON.parse(n.room_names) as string[]).includes(room))
    .map(notificationOut);
}

export function registerNotifications(app: Hono<App>): void {
  /** A resident reads their house's notices (and their room's); staff read every house they manage. */
  app.use('/api/notifications', requireAuth);
  app.get('/api/notifications', async (c) => {
    const v = c.get('viewer');
    const list =
      v.kind === 'resident'
        ? await notificationsFor(c, [v.houseId], v.roomName ?? '', false)
        : await notificationsFor(c, v.houseIds, null, false);
    return c.json({ success: true, notifications: list });
  });

  app.use('/api/admin/notifications', requireAuth, staffOnly);
  app.get('/api/admin/notifications', async (c) => {
    const v = c.get('viewer');
    return c.json({ success: true, notifications: await notificationsFor(c, v.kind === 'staff' ? v.houseIds : [], null, true) });
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
    // Tạo thông báo is a tiện ích: houses that did not buy it are left out ('ALL' reaches only the houses that have it);
    // when none of the targets has it the call is refused.
    for (const h of [...perHouse.keys()]) if (!(await moduleAllowed(c, 'createNotification', h))) perHouse.delete(h);
    if (!perHouse.size) return moduleOff(c);

    const scheduledAt = body.scheduledAt ? String(body.scheduledAt) : null;
    const first = new Map<string, NotificationRow>();
    for (const [ownerId, houses] of await byOwner(c.env.DB, [...perHouse.keys()])) {
      const tenant = await tenantOfOwner(c.env, ownerId);
      const created = await tenant.batch<NotificationRow>(
        houses.map((houseId) => {
          const rooms = perHouse.get(houseId) ?? null;
          return tenant
            .prepare(
              `INSERT INTO notifications (house_id, room_names, title, content, type, time_label, sender, scheduled_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
            )
            .bind(houseId, rooms ? JSON.stringify(rooms) : null, title, content, type, body.time ? String(body.time) : null,
              body.sender ? String(body.sender) : null, scheduledAt, actorOf(v));
        })
      );
      houses.forEach((h, i) => first.set(h, created[i].results[0]));
    }
    const firstRow = [...perHouse.keys()].map((h) => first.get(h)).find(Boolean);
    if (!firstRow) return fail(c, 400, 'NOTIFICATION_TARGET', 'Chưa chọn người nhận thuộc nhà bạn quản lý.');
    await audit(c, actorOf(v), 'notification_create', null, [...perHouse.keys()].join(','));
    return c.json({ success: true, notification: notificationOut(firstRow) });
  });
}
