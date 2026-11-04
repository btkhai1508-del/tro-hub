import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { normalizePhone, verifyPassword } from './password.ts';
import { signToken, verifyToken } from './token.ts';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "http://localhost:3000,https://tro-hub.pages.dev"
}

/** Who is calling, read fresh from D1 on every request. */
type Viewer =
  | { kind: 'resident'; id: number; name: string; houseId: string; roomId: number | null; roomName: string | null }
  | { kind: 'staff'; id: number; name: string; role: 'owner' | 'manager'; houseIds: string[] };

type App = { Bindings: Env; Variables: { viewer: Viewer } };

const app = new Hono<App>();

app.use('/api/*', (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return cors({ origin: allowed, allowHeaders: ['Content-Type', 'Authorization'] })(c, next);
});

const fail = (c: Context, status: 400 | 401 | 403 | 404, errorCode: string, error: string) =>
  c.json({ success: false, errorCode, error }, status);

async function audit(c: Context<App>, actor: string, action: string, houseId: string | null = null, target: string | null = null) {
  await c.env.DB.prepare('INSERT INTO audit_log (actor, action, house_id, target, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(actor, action, houseId, target, c.req.header('CF-Connecting-IP') ?? null)
    .run();
}

async function loadViewer(db: D1Database, sub: number, kind: 'resident' | 'staff'): Promise<Viewer | null> {
  if (kind === 'resident') {
    const row = await db
      .prepare(
        `SELECT r.id, r.full_name, r.house_id, r.room_id, rm.name AS room_name
           FROM residents r LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE r.id = ? AND r.status = 'approved' AND r.deleted_at IS NULL`
      )
      .bind(sub)
      .first<{ id: number; full_name: string; house_id: string; room_id: number | null; room_name: string | null }>();
    if (!row) return null;
    return { kind, id: row.id, name: row.full_name, houseId: row.house_id, roomId: row.room_id, roomName: row.room_name };
  }

  const staff = await db
    .prepare(`SELECT id, full_name, role FROM staff WHERE id = ? AND status = 'active'`)
    .bind(sub)
    .first<{ id: number; full_name: string; role: 'owner' | 'manager' }>();
  if (!staff) return null;
  const houses =
    staff.role === 'owner'
      ? await db.prepare(`SELECT id AS house_id FROM houses ORDER BY name`).all<{ house_id: string }>()
      : await db.prepare(`SELECT house_id FROM staff_houses WHERE staff_id = ?`).bind(staff.id).all<{ house_id: string }>();
  return { kind, id: staff.id, name: staff.full_name, role: staff.role, houseIds: houses.results.map((h) => h.house_id) };
}

async function requireAuth(c: Context<App>, next: Next) {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null;
  const viewer = payload && (await loadViewer(c.env.DB, payload.sub, payload.kind));
  if (!viewer) return fail(c, 401, 'AUTH_SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  c.set('viewer', viewer);
  await next();
}

const actorOf = (v: Viewer) => `${v.kind}:${v.id}`;

function canAccessHouse(viewer: Viewer, houseId: string) {
  return viewer.kind === 'resident' ? viewer.houseId === houseId : viewer.houseIds.includes(houseId);
}

/** Every route under /api/houses/:houseId goes through here: the house comes from the URL, the right to see it from D1. */
async function requireHouse(c: Context<App>, next: Next) {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId') ?? '';
  if (!canAccessHouse(viewer, houseId)) {
    await audit(c, actorOf(viewer), 'house_access_denied', houseId);
    return fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn không có quyền xem nhà trọ này.');
  }
  await next();
}

const staffOnly = async (c: Context<App>, next: Next) =>
  c.get('viewer').kind === 'staff' ? next() : fail(c, 403, 'STAFF_ONLY', 'Chỉ quản lý mới dùng được chức năng này.');

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ phone?: string; password?: string }>().catch(() => ({}) as { phone?: string; password?: string });
  const phone = normalizePhone(body.phone ?? '');
  const password = String(body.password ?? '');
  if (phone.length < 10 || !password) return fail(c, 400, 'AUTH_INVALID', 'Số điện thoại hoặc mật khẩu không chính xác.');

  const staff = await c.env.DB.prepare(`SELECT id, password_hash, status FROM staff WHERE phone = ?`)
    .bind(phone)
    .first<{ id: number; password_hash: string; status: string }>();
  const resident = staff
    ? null
    : await c.env.DB.prepare(`SELECT id, password_hash, status, house_id FROM residents WHERE phone = ? AND deleted_at IS NULL`)
        .bind(phone)
        .first<{ id: number; password_hash: string; status: string; house_id: string }>();
  const account = staff ?? resident;

  if (!account || !(await verifyPassword(password, account.password_hash))) {
    await audit(c, 'anonymous', 'login_failed', null, phone);
    return fail(c, 401, 'AUTH_INVALID', 'Số điện thoại hoặc mật khẩu không chính xác.');
  }

  if (staff && staff.status !== 'active') return fail(c, 403, 'AUTH_LOCKED', 'Tài khoản quản lý đã bị khoá.');
  if (resident && resident.status === 'pending')
    return fail(c, 403, 'AUTH_PENDING', 'Tài khoản đang chờ quản lý duyệt.');
  if (resident && resident.status !== 'approved')
    return fail(c, 403, 'AUTH_NOT_ACTIVE', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

  const kind = staff ? 'staff' : 'resident';
  const viewer = await loadViewer(c.env.DB, account.id, kind);
  if (!viewer) return fail(c, 403, 'AUTH_NOT_ACTIVE', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

  await audit(c, actorOf(viewer), 'login', resident?.house_id ?? null);
  return c.json({ success: true, token: await signToken(account.id, kind, c.env.JWT_SECRET), viewer });
});

app.use('/api/me', requireAuth);
app.get('/api/me', (c) => c.json({ success: true, viewer: c.get('viewer') }));

app.use('/api/houses', requireAuth);
app.use('/api/houses/*', requireAuth);

/** The houses the caller may open. Only the owner gets the "all houses" summary. */
app.get('/api/houses', async (c) => {
  const viewer = c.get('viewer');
  const ids = viewer.kind === 'resident' ? [viewer.houseId] : viewer.houseIds;
  if (!ids.length) return c.json({ success: true, houses: [], canSeeSummary: false });
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, status
       FROM houses WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`
  )
    .bind(...ids)
    .all();
  return c.json({ success: true, houses: results, canSeeSummary: viewer.kind === 'staff' && viewer.role === 'owner' });
});

app.use('/api/houses/:houseId/*', requireHouse);
app.use('/api/houses/:houseId', requireHouse);

app.get('/api/houses/:houseId', async (c) => {
  const house = await c.env.DB.prepare(
    `SELECT id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, status FROM houses WHERE id = ?`
  )
    .bind(c.req.param('houseId'))
    .first();
  return house ? c.json({ success: true, house }) : fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
});

app.get('/api/houses/:houseId/rooms', staffOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT rm.id, rm.name, rm.price, rm.capacity,
            (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status = 'approved' AND r.deleted_at IS NULL) AS occupants
       FROM rooms rm WHERE rm.house_id = ? AND rm.deleted_at IS NULL ORDER BY rm.name`
  )
    .bind(c.req.param('houseId'))
    .all();
  return c.json({ success: true, rooms: results });
});

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

export default app;
