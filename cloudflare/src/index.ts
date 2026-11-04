import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { hashPassword, normalizePhone, verifyPassword } from './password.ts';
import { signToken, verifyToken } from './token.ts';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "http://localhost:3000,https://tro-hub.pages.dev"
}

/** Who is calling, read fresh from D1 on every request. */
type Viewer =
  | { kind: 'resident'; id: number; name: string; phone: string | null; houseId: string; roomId: number | null; roomName: string | null }
  | { kind: 'staff'; id: number; name: string; phone: string; role: 'owner' | 'manager'; houseIds: string[] };

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
        `SELECT r.id, r.full_name, r.phone, r.house_id, r.room_id, rm.name AS room_name
           FROM residents r LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE r.id = ? AND r.status = 'approved' AND r.deleted_at IS NULL`
      )
      .bind(sub)
      .first<{ id: number; full_name: string; phone: string | null; house_id: string; room_id: number | null; room_name: string | null }>();
    if (!row) return null;
    return { kind, id: row.id, name: row.full_name, phone: row.phone, houseId: row.house_id, roomId: row.room_id, roomName: row.room_name };
  }

  const staff = await db
    .prepare(`SELECT id, full_name, phone, role FROM staff WHERE id = ? AND status = 'active'`)
    .bind(sub)
    .first<{ id: number; full_name: string; phone: string; role: 'owner' | 'manager' }>();
  if (!staff) return null;
  const houses =
    staff.role === 'owner'
      ? await db.prepare(`SELECT id AS house_id FROM houses ORDER BY name`).all<{ house_id: string }>()
      : await db.prepare(`SELECT house_id FROM staff_houses WHERE staff_id = ?`).bind(staff.id).all<{ house_id: string }>();
  return { kind, id: staff.id, name: staff.full_name, phone: staff.phone, role: staff.role, houseIds: houses.results.map((h) => h.house_id) };
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
  if (phone.length < 10 || !password) return fail(c, 400, 'AUTH_INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không chính xác.');

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
    return fail(c, 401, 'AUTH_INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không chính xác.');
  }

  if (staff && staff.status !== 'active') return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản quản lý đã bị khoá.');
  if (resident && resident.status === 'pending')
    return fail(c, 403, 'AUTH_PENDING_APPROVAL', 'Tài khoản đang chờ quản lý duyệt.');
  if (resident && resident.status !== 'approved')
    return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

  const kind = staff ? 'staff' : 'resident';
  const viewer = await loadViewer(c.env.DB, account.id, kind);
  if (!viewer) return fail(c, 403, 'AUTH_REJECTED', 'Tài khoản không còn hoạt động. Vui lòng liên hệ quản lý.');

  await audit(c, actorOf(viewer), 'login', resident?.house_id ?? null);
  return c.json({ success: true, token: await signToken(account.id, kind, c.env.JWT_SECRET), viewer });
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

  const table = viewer.kind === 'staff' ? 'staff' : 'residents';
  const row = await c.env.DB.prepare(`SELECT password_hash FROM ${table} WHERE id = ?`).bind(viewer.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return fail(c, 400, 'PASSWORD_WRONG', 'Mật khẩu hiện tại không đúng.');
  }
  await c.env.DB.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`).bind(await hashPassword(next), viewer.id).run();
  await audit(c, actorOf(viewer), 'change_password', viewer.kind === 'resident' ? viewer.houseId : null);
  return c.json({ success: true });
});

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

const HOUSE_FIELDS = ['name', 'abbreviation', 'address_detail', 'ward', 'province', 'landlord_name', 'landlord_phone'] as const;
const BANK_FIELDS = ['bank_name', 'bank_code', 'bank_account_no', 'bank_account_name'] as const;
const RATE_FIELDS = ['electricity_per_kwh', 'water_per_m3', 'trash', 'internet', 'parking'] as const;

const isOwner = (v: Viewer) => v.kind === 'staff' && v.role === 'owner';

app.get('/api/houses/:houseId', async (c) => {
  const houseId = c.req.param('houseId');
  const house = await c.env.DB.prepare(
    `SELECT id, ${[...HOUSE_FIELDS, ...BANK_FIELDS].join(', ')}, status FROM houses WHERE id = ?`
  )
    .bind(houseId)
    .first();
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
  const rates = await c.env.DB.prepare(`SELECT ${RATE_FIELDS.join(', ')} FROM house_rates WHERE house_id = ?`).bind(houseId).first();
  return c.json({ success: true, house, rates, canEditBank: isOwner(c.get('viewer')) });
});

/** House details: both admin levels. Bank and account number: Admin Tổng only. */
app.patch('/api/houses/:houseId', staffOnly, async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (BANK_FIELDS.some((f) => f in body) && !isOwner(viewer)) {
    await audit(c, actorOf(viewer), 'bank_edit_denied', houseId);
    return fail(c, 403, 'BANK_OWNER_ONLY', 'Chỉ Admin Tổng được đổi ngân hàng và số tài khoản.');
  }
  const fields = [...HOUSE_FIELDS, ...BANK_FIELDS].filter((f) => f in body);
  if (!fields.length) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');
  await c.env.DB.prepare(`UPDATE houses SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .bind(...fields.map((f) => String(body[f] ?? '').trim()), houseId)
    .run();
  await audit(c, actorOf(viewer), 'house_update', houseId, fields.join(','));
  return c.json({ success: true });
});

app.put('/api/houses/:houseId/rates', staffOnly, async (c) => {
  const houseId = c.req.param('houseId');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const values = RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(body[f]) || 0)));
  await c.env.DB.prepare(
    `INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})
     ON CONFLICT (house_id) DO UPDATE SET ${RATE_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = datetime('now')`
  )
    .bind(houseId, ...values)
    .run();
  await audit(c, actorOf(c.get('viewer')), 'rates_update', houseId);
  return c.json({ success: true });
});

app.get('/api/houses/:houseId/rooms', staffOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT rm.id, rm.name, rm.price, rm.deposit, rm.capacity,
            (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status = 'approved' AND r.deleted_at IS NULL) AS occupants
       FROM rooms rm WHERE rm.house_id = ? AND rm.deleted_at IS NULL ORDER BY rm.name`
  )
    .bind(c.req.param('houseId'))
    .all();
  return c.json({ success: true, rooms: results });
});

/** One month of invoices with their meter readings. A resident only gets their own room. */
app.get('/api/houses/:houseId/invoices', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const roomFilter = viewer.kind === 'resident' ? viewer.roomId : null;
  if (viewer.kind === 'resident' && !roomFilter) return c.json({ success: true, month: null, invoices: [] });

  const month =
    c.req.query('month') ||
    (
      await c.env.DB.prepare(`SELECT MAX(month) AS month FROM invoices WHERE house_id = ?${roomFilter ? ' AND room_id = ?' : ''}`)
        .bind(...(roomFilter ? [houseId, roomFilter] : [houseId]))
        .first<{ month: string | null }>()
    )?.month;
  if (!month) return c.json({ success: true, month: null, invoices: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT i.*, rm.name AS room_name, m.electric_old, m.electric_new, m.water_old, m.water_new
       FROM invoices i
       JOIN rooms rm ON rm.id = i.room_id
       LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id = ? AND i.month = ?${roomFilter ? ' AND i.room_id = ?' : ''}
      ORDER BY rm.name`
  )
    .bind(...(roomFilter ? [houseId, month, roomFilter] : [houseId, month]))
    .all();
  return c.json({ success: true, month, invoices: results });
});

app.get('/api/houses/:houseId/payments', staffOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.invoice_id, p.amount, p.method, p.bank_name, p.reference, p.content, p.paid_at, p.confirmed_by,
            i.month, rm.name AS room_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN rooms rm ON rm.id = i.room_id
      WHERE p.house_id = ? ORDER BY p.paid_at DESC LIMIT 500`
  )
    .bind(c.req.param('houseId'))
    .all();
  return c.json({ success: true, payments: results });
});

/** Bank transfers not yet tied to a house. Only Admin Tổng sees money across houses. */
app.use('/api/payments/unassigned', requireAuth);
app.get('/api/payments/unassigned', async (c) => {
  if (!isOwner(c.get('viewer'))) return fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng xem được mục này.');
  const { results } = await c.env.DB.prepare(
    `SELECT id, amount, method, bank_name, reference, content, paid_at FROM payments WHERE house_id IS NULL ORDER BY paid_at DESC`
  ).all();
  return c.json({ success: true, payments: results });
});

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

export default app;
