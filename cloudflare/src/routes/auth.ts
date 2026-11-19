/**
 * Login, sessions and password change. Staff accounts live in the central D1; a resident's account
 * is a row of their landlord's store, found through the central resident index.
 */
import type { Context, Hono, Next } from 'hono';
import { actorOf, audit, fail, type App, type StaffRole, type Viewer } from '../app.ts';
import { residentRoute } from '../central/directory.ts';
import { hashPassword, normalizePhone, verifyPassword } from '../password.ts';
import { signToken, verifyToken } from '../token.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantOfOwner } from '../tenant/route.ts';

type ResidentRow = { id: number; full_name: string; phone: string | null; house_id: string; room_id: number | null; room_name: string | null };

/**
 * Who the token belongs to, read fresh. issuedAt (the token's iat) must not be older than the
 * account's last password change: changing or resetting a password signs out every older session.
 * `tid` is the landlord a resident token was issued for; without it the resident index tells.
 */
async function loadViewer(
  env: App['Bindings'],
  sub: number,
  kind: 'resident' | 'staff',
  issuedAt = Infinity,
  tid?: number
): Promise<Viewer | null> {
  const db = env.DB;
  const limit = issuedAt === Infinity ? Number.MAX_SAFE_INTEGER : issuedAt;
  if (kind === 'resident') {
    const ownerId = tid ?? (await residentRoute(db, { id: sub }))?.owner_id;
    if (ownerId === undefined) return null;
    // The resident is looked up by id inside that landlord's store only: a token carrying someone
    // else's landlord id finds nothing.
    const row = await (await tenantOfOwner(env, ownerId))
      .prepare(
        `SELECT r.id, r.full_name, r.phone, r.house_id, r.room_id, rm.name AS room_name
           FROM residents r LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE r.id = ? AND r.status = 'approved' AND r.deleted_at IS NULL
            AND (r.password_changed_at IS NULL OR r.password_changed_at <= ?)`
      )
      .bind(sub, limit)
      .first<ResidentRow>();
    if (!row) return null;
    return { kind, id: row.id, name: row.full_name, phone: row.phone, houseId: row.house_id, roomId: row.room_id, roomName: row.room_name };
  }

  const staff = await db
    .prepare(`SELECT id, full_name, phone, role FROM staff WHERE id = ? AND status = 'active' AND (password_changed_at IS NULL OR password_changed_at <= ?)`)
    .bind(sub, limit)
    .first<{ id: number; full_name: string; phone: string; role: StaffRole }>();
  if (!staff) return null;
  // Admin Tổng and Admin căn alike see only the houses in staff_houses: each Admin Tổng is an independent landlord.
  // The Developer sells the service and can open every house (the directory lists them whatever store holds the data).
  const houses = staff.role === 'developer'
    ? await db.prepare(`SELECT house_id FROM house_directory`).all<{ house_id: string }>()
    : await db.prepare(`SELECT house_id FROM staff_houses WHERE staff_id = ?`).bind(staff.id).all<{ house_id: string }>();
  return { kind, id: staff.id, name: staff.full_name, phone: staff.phone, role: staff.role, houseIds: houses.results.map((h) => h.house_id) };
}

export async function requireAuth(c: Context<App>, next: Next) {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null;
  const viewer = payload && (await loadViewer(c.env, payload.sub, payload.kind, payload.iat, payload.tid));
  if (!viewer) return fail(c, 401, 'AUTH_SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  c.set('viewer', viewer);
  await next();
}

export function registerAuth(app: Hono<App>) {
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ phone?: string; password?: string }>().catch(() => ({}) as { phone?: string; password?: string });
    const phone = normalizePhone(body.phone ?? '');
    const password = String(body.password ?? '');
    if (phone.length < 10 || !password) return fail(c, 400, 'AUTH_INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không chính xác.');

    const staff = await c.env.DB.prepare(`SELECT id, password_hash, status FROM staff WHERE phone = ?`)
      .bind(phone)
      .first<{ id: number; password_hash: string; status: string }>();
    let ownerId: number | null = null;
    let resident: { id: number; password_hash: string; status: string; house_id: string } | null = null;
    if (!staff) {
      const route = await residentRoute(c.env.DB, { phone });
      if (route) {
        ownerId = route.owner_id;
        resident = await (await tenantOfOwner(c.env, route.owner_id))
          .prepare(`SELECT id, password_hash, status, house_id FROM residents WHERE phone = ? AND deleted_at IS NULL`)
          .bind(phone)
          .first<{ id: number; password_hash: string; status: string; house_id: string }>();
      }
    }
    const account = staff ?? resident;

    if (!account || !(await verifyPassword(password, account.password_hash))) {
      await audit(c, 'anonymous', 'login_failed', null, phone);
      return fail(c, 401, 'AUTH_INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không chính xác.');
    }

    if (staff && staff.status !== 'active') return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản quản lý đã bị khoá.');
    if (resident && resident.status === 'pending')
      return fail(c, 403, 'AUTH_PENDING_APPROVAL', 'Tài khoản đang chờ quản lý duyệt.');
    if (resident && resident.status !== 'approved')
      return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

    const kind = staff ? 'staff' : 'resident';
    const viewer = await loadViewer(c.env, account.id, kind, Infinity, ownerId ?? undefined);
    if (!viewer) return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

    await audit(c, actorOf(viewer), 'login', resident?.house_id ?? null);
    return c.json({ success: true, token: await signToken(account.id, kind, c.env.JWT_SECRET, ownerId ?? undefined), viewer });
  });

  app.use('/api/me', requireAuth);
  app.get('/api/me', (c) => c.json({ success: true, viewer: c.get('viewer') }));

  app.use('/api/auth/change-password', requireAuth);
  app.post('/api/auth/change-password', async (c) => {
    const viewer = c.get('viewer');
    const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>().catch(() => ({}) as { currentPassword?: string; newPassword?: string });
    const current = String(body.currentPassword ?? '').trim();
    const next = String(body.newPassword ?? '').trim();
    if (next.length < 6) return fail(c, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu mới phải có ít nhất 6 ký tự');

    // Staff rows are central; a resident's row is in their landlord's store (writes there answer 503 while it is moving).
    let ownerId: number | undefined;
    let db: TenantDb = c.env.DB;
    if (viewer.kind === 'resident') {
      ownerId = (await residentRoute(c.env.DB, { id: viewer.id }))?.owner_id;
      if (ownerId === undefined) return fail(c, 401, 'AUTH_SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      db = await tenantOfOwner(c.env, ownerId);
    }
    const table = viewer.kind === 'staff' ? 'staff' : 'residents';
    const row = await db.prepare(`SELECT password_hash FROM ${table} WHERE id = ?`).bind(viewer.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      return fail(c, 400, 'PASSWORD_WRONG', 'Mật khẩu hiện tại không đúng.');
    }
    // Every other session of this account ends; this one continues with the fresh token returned here.
    await db.prepare(`UPDATE ${table} SET password_hash = ?, password_changed_at = ? WHERE id = ?`)
      .bind(await hashPassword(next), Math.floor(Date.now() / 1000), viewer.id)
      .run();
    await audit(c, actorOf(viewer), 'change_password', viewer.kind === 'resident' ? viewer.houseId : null);
    return c.json({ success: true, token: await signToken(viewer.id, viewer.kind, c.env.JWT_SECRET, ownerId) });
  });
}
