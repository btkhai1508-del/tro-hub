import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { hashPassword, normalizePhone, verifyPassword } from './password.ts';
import { signToken, verifyToken } from './token.ts';
import { checkState, connectUrl, finishConnect, sheetsApi } from './google.ts';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CCCD_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ZALO_CHECKOUT_ACCOUNT?: string; // "<bin>:<số tài khoản>" đã đăng ký với Zalo Checkout
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "http://localhost:3000,https://tro-hub.pages.dev"
}

/** Who is calling, read fresh from D1 on every request. */
type Viewer =
  | { kind: 'resident'; id: number; name: string; phone: string | null; houseId: string; roomId: number | null; roomName: string | null }
  | { kind: 'staff'; id: number; name: string; phone: string; role: StaffRole; houseIds: string[] };

type StaffRole = 'developer' | 'owner' | 'manager';

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
    .first<{ id: number; full_name: string; phone: string; role: StaffRole }>();
  if (!staff) return null;
  const houses =
    staff.role === 'developer'
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
const isDeveloper = (v: Viewer) => v.kind === 'staff' && v.role === 'developer';
/** Developer or Admin Tổng: may set a house's bank account and see the summary of their houses. */
const isOwnerOrAbove = (v: Viewer) => v.kind === 'staff' && (v.role === 'developer' || v.role === 'owner');

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

/** The houses the caller may open. Developer and Admin Tổng get the summary across their houses. */
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
  return c.json({ success: true, houses: results, canSeeSummary: isOwnerOrAbove(viewer) });
});

app.use('/api/houses/:houseId/*', requireHouse);
app.use('/api/houses/:houseId', requireHouse);

const HOUSE_FIELDS = ['name', 'abbreviation', 'address_detail', 'ward', 'province', 'landlord_name', 'landlord_phone'] as const;
const BANK_FIELDS = ['bank_name', 'bank_code', 'bank_account_no', 'bank_account_name'] as const;
const RATE_FIELDS = ['electricity_per_kwh', 'water_per_m3', 'trash', 'internet', 'parking'] as const;


interface Bank { bin: string; code: string; shortName: string; name: string; logo: string; transferSupported: number }
let bankCache: { banks: Bank[]; at: number } | null = null;

/** Banks that can receive VietQR transfers, from VietQR's public list, kept for a day. */
async function vietQrBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 24 * 3600_000) return bankCache.banks;
  const res = await fetch('https://api.vietqr.io/v2/banks');
  const data = (await res.json().catch(() => null)) as { data?: Bank[] } | null;
  const banks = (data?.data ?? []).filter((b) => b.transferSupported);
  if (!banks.length) throw new Error('Không tải được danh sách ngân hàng VietQR.');
  bankCache = { banks, at: Date.now() };
  return banks;
}

app.use('/api/banks', requireAuth);
app.get('/api/banks', async (c) => {
  const banks = await vietQrBanks();
  return c.json({ success: true, banks: banks.map(({ bin, code, shortName, name, logo }) => ({ bin, code, shortName, name, logo })) });
});

/**
 * Payment portal of a house: the bank and account residents pay into. Everyone in the house can read
 * it (residents need it to pay); only Developer and Admin Tổng can change it. Zalo's quick transfer
 * pays into the one account registered with Zalo Checkout, so it is offered only when they match.
 */
app.get('/api/houses/:houseId/payment-portal', async (c) => {
  const house = await c.env.DB.prepare(
    `SELECT bank_bin, bank_code, bank_name, bank_account_no, bank_account_name, landlord_name FROM houses WHERE id = ?`
  )
    .bind(c.req.param('houseId'))
    .first<{ bank_bin: string | null; bank_code: string | null; bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null; landlord_name: string }>();
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
  const ready = Boolean(house.bank_bin && house.bank_account_no);
  return c.json({
    success: true,
    portal: {
      ready,
      bankBin: house.bank_bin,
      bankCode: house.bank_code,
      bankName: house.bank_name,
      accountNo: house.bank_account_no,
      accountName: house.bank_account_name || house.landlord_name,
      zaloCheckout: ready && c.env.ZALO_CHECKOUT_ACCOUNT === `${house.bank_bin}:${house.bank_account_no}`,
    },
    canEdit: isOwnerOrAbove(c.get('viewer')),
  });
});

app.put('/api/houses/:houseId/payment-portal', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  if (!isOwnerOrAbove(viewer)) {
    await audit(c, actorOf(viewer), 'bank_edit_denied', houseId);
    return fail(c, 403, 'BANK_OWNER_ONLY', 'Chỉ Admin Tổng được đổi ngân hàng và số tài khoản.');
  }
  const body = await c.req.json<{ bankBin?: string; accountNo?: string }>().catch(() => ({}) as { bankBin?: string; accountNo?: string });
  const accountNo = String(body.accountNo ?? '').replace(/\s/g, '');
  if (!/^[0-9A-Za-z]{6,19}$/.test(accountNo)) return fail(c, 400, 'ACCOUNT_INVALID', 'Số tài khoản phải có 6–19 chữ số.');
  const bank = (await vietQrBanks()).find((b) => b.bin === String(body.bankBin ?? ''));
  if (!bank) return fail(c, 400, 'BANK_INVALID', 'Vui lòng chọn ngân hàng trong danh sách.');

  await c.env.DB.prepare(`UPDATE houses SET bank_bin = ?, bank_code = ?, bank_name = ?, bank_account_no = ? WHERE id = ?`)
    .bind(bank.bin, bank.code, bank.shortName, accountNo, houseId)
    .run();
  await audit(c, actorOf(viewer), 'payment_portal_update', houseId, `${bank.shortName} ****${accountNo.slice(-4)}`);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Staff accounts. Developer creates Admin Tổng (and Admin căn); Admin Tổng creates Admin căn
// for their own houses only. Nobody manages an account above their own level.
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<StaffRole, string> = { developer: 'Developer', owner: 'Admin Tổng', manager: 'Admin căn' };

/** Which roles this viewer may create or edit, and on which houses. */
function staffScope(v: Viewer): { roles: StaffRole[]; houseIds: string[] } | null {
  if (v.kind !== 'staff') return null;
  if (v.role === 'developer') return { roles: ['owner', 'manager'], houseIds: v.houseIds };
  if (v.role === 'owner') return { roles: ['manager'], houseIds: v.houseIds };
  return null;
}

async function staffHouses(db: D1Database, staffId: number) {
  const { results } = await db.prepare(`SELECT house_id FROM staff_houses WHERE staff_id = ?`).bind(staffId).all<{ house_id: string }>();
  return results.map((r) => r.house_id);
}

app.use('/api/staff', requireAuth);
app.use('/api/staff/*', requireAuth);

app.get('/api/staff', async (c) => {
  const viewer = c.get('viewer');
  const scope = staffScope(viewer);
  if (!scope) return fail(c, 403, 'STAFF_FORBIDDEN', 'Bạn không quản lý tài khoản quản lý.');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.full_name, s.phone, s.role, s.status, s.created_at, GROUP_CONCAT(sh.house_id) AS house_ids
       FROM staff s LEFT JOIN staff_houses sh ON sh.staff_id = s.id GROUP BY s.id ORDER BY s.role, s.full_name`
  ).all<{ id: number; role: StaffRole; house_ids: string | null }>();
  const staff = results
    .map((s) => ({ ...s, house_ids: s.house_ids ? s.house_ids.split(',') : [], role_label: ROLE_LABEL[s.role] }))
    // Admin Tổng sees themself and the Admin căn of their houses.
    .filter((s) => isDeveloper(viewer) || s.id === viewer.id || (s.role === 'manager' && s.house_ids.some((h) => scope.houseIds.includes(h))));
  return c.json({ success: true, staff, canCreate: scope.roles.map((r) => ({ role: r, label: ROLE_LABEL[r] })) });
});

app.post('/api/staff', async (c) => {
  const viewer = c.get('viewer');
  const scope = staffScope(viewer);
  const body = await c.req.json<{ fullName?: string; phone?: string; password?: string; role?: StaffRole; houseIds?: string[] }>().catch(() => ({}) as Record<string, never>);
  const role = body.role as StaffRole;
  const houseIds = [...new Set((body.houseIds ?? []).map(String))];
  if (!scope || !scope.roles.includes(role)) return fail(c, 403, 'STAFF_FORBIDDEN', 'Bạn không được tạo loại tài khoản này.');
  if (!houseIds.length || houseIds.some((h) => !scope.houseIds.includes(h)))
    return fail(c, 403, 'HOUSE_FORBIDDEN', 'Chỉ được giao những nhà bạn đang quản lý.');

  const fullName = String(body.fullName ?? '').trim();
  const phone = normalizePhone(body.phone ?? '');
  const password = String(body.password ?? '');
  if (!fullName || !/^0\d{9}$/.test(phone)) return fail(c, 400, 'STAFF_INVALID', 'Vui lòng nhập họ tên và số điện thoại 10 số.');
  if (password.length < 6) return fail(c, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu phải có ít nhất 6 ký tự');
  const taken = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE phone = ? UNION SELECT 1 FROM residents WHERE phone = ? AND deleted_at IS NULL`)
    .bind(phone, phone)
    .first();
  if (taken) return fail(c, 400, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');

  const created = await c.env.DB.prepare(`INSERT INTO staff (full_name, phone, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .bind(fullName, phone, await hashPassword(password), role, viewer.id)
    .first<{ id: number }>();
  await c.env.DB.batch(houseIds.map((h) => c.env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (?, ?)`).bind(created!.id, h)));
  await audit(c, actorOf(viewer), 'staff_create', null, `${role}:${created!.id}`);
  return c.json({ success: true, id: created!.id });
});

/** Lock or unlock an account, or change its houses. */
app.patch('/api/staff/:id', async (c) => {
  const viewer = c.get('viewer');
  const scope = staffScope(viewer);
  const id = Number(c.req.param('id'));
  const target = await c.env.DB.prepare(`SELECT id, role FROM staff WHERE id = ?`).bind(id).first<{ id: number; role: StaffRole }>();
  if (!scope || !target || target.id === viewer.id || !scope.roles.includes(target.role))
    return fail(c, 403, 'STAFF_FORBIDDEN', 'Bạn không được sửa tài khoản này.');
  const current = await staffHouses(c.env.DB, id);
  if (viewer.kind === 'staff' && viewer.role === 'owner' && current.some((h) => !scope.houseIds.includes(h)))
    return fail(c, 403, 'STAFF_FORBIDDEN', 'Tài khoản này còn quản lý nhà khác ngoài nhà của bạn.');

  const body = await c.req.json<{ status?: string; houseIds?: string[] }>().catch(() => ({}) as Record<string, never>);
  const writes: D1PreparedStatement[] = [];
  if (body.status !== undefined) {
    if (!['active', 'locked'].includes(body.status)) return fail(c, 400, 'STATUS_INVALID', 'Trạng thái không hợp lệ.');
    writes.push(c.env.DB.prepare(`UPDATE staff SET status = ? WHERE id = ?`).bind(body.status, id));
  }
  if (body.houseIds !== undefined) {
    const houseIds = [...new Set(body.houseIds.map(String))];
    if (!houseIds.length || houseIds.some((h) => !scope.houseIds.includes(h)))
      return fail(c, 403, 'HOUSE_FORBIDDEN', 'Chỉ được giao những nhà bạn đang quản lý.');
    writes.push(c.env.DB.prepare(`DELETE FROM staff_houses WHERE staff_id = ?`).bind(id));
    writes.push(...houseIds.map((h) => c.env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (?, ?)`).bind(id, h)));
  }
  if (!writes.length) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');
  await c.env.DB.batch(writes);
  await audit(c, actorOf(viewer), 'staff_update', null, `${target.role}:${id}`);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// New house (Developer only): house, rates and rooms in one request.
// ---------------------------------------------------------------------------

/** "101-105, 201, G01-G03" → 101…105, 201, G01…G03 (letter prefix and zero padding kept). */
export function expandRooms(text: string): string[] {
  const names: string[] = [];
  for (const part of text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^([A-Za-z]*)(\d+)\s*-\s*\1?(\d+)$/);
    if (!range) { names.push(part.toUpperCase()); continue; }
    const [, prefix, from, to] = range;
    for (let n = Number(from); n <= Number(to) && names.length < 500; n++) names.push(`${prefix.toUpperCase()}${String(n).padStart(from.length, '0')}`);
  }
  return [...new Set(names)];
}

app.post('/api/houses', async (c) => {
  const viewer = c.get('viewer');
  if (!isDeveloper(viewer)) return fail(c, 403, 'DEVELOPER_ONLY', 'Chỉ Developer được tạo nhà trọ.');
  const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);
  const name = String(body.name ?? '').trim();
  const abbreviation = String(body.abbreviation ?? '').trim().toUpperCase();
  const id = abbreviation.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const rooms = expandRooms(String(body.rooms ?? ''));
  if (!name || !id) return fail(c, 400, 'HOUSE_INVALID', 'Vui lòng nhập tên nhà và tên viết tắt.');
  if (!rooms.length) return fail(c, 400, 'ROOMS_INVALID', 'Vui lòng nhập danh sách phòng, ví dụ 101-110, 201-210.');
  if (await c.env.DB.prepare(`SELECT 1 FROM houses WHERE id = ?`).bind(id).first())
    return fail(c, 400, 'HOUSE_EXISTS', 'Tên viết tắt này đã được dùng cho nhà khác.');

  const text = (key: string) => String(body[key] ?? '').trim();
  const rates = body.rates ?? {};
  const ownerIds: number[] = (body.ownerIds ?? []).map(Number).filter(Boolean);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, abbreviation, text('address_detail'), text('ward'), text('province'), text('landlord_name'), normalizePhone(text('landlord_phone'))),
    c.env.DB.prepare(`INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})`)
      .bind(id, ...RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(rates[f]) || 0)))),
    ...rooms.map((room) => c.env.DB.prepare(`INSERT INTO rooms (house_id, name, price) VALUES (?, ?, ?)`).bind(id, room, Math.max(0, Number(body.roomPrice) || 0))),
    ...ownerIds.map((sid) =>
      c.env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) SELECT id, ? FROM staff WHERE id = ? AND role = 'owner'`).bind(id, sid)
    ),
  ]);
  await audit(c, actorOf(viewer), 'house_create', id, `${rooms.length} phòng`);
  return c.json({ success: true, id, rooms: rooms.length });
});

app.get('/api/houses/:houseId', async (c) => {
  const houseId = c.req.param('houseId');
  const house = await c.env.DB.prepare(
    `SELECT id, ${[...HOUSE_FIELDS, ...BANK_FIELDS].join(', ')}, status FROM houses WHERE id = ?`
  )
    .bind(houseId)
    .first();
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
  const rates = await c.env.DB.prepare(`SELECT ${RATE_FIELDS.join(', ')} FROM house_rates WHERE house_id = ?`).bind(houseId).first();
  return c.json({ success: true, house, rates, canEditBank: isOwnerOrAbove(c.get('viewer')) });
});

/** House details: both admin levels. Bank and account number: Admin Tổng only. */
app.patch('/api/houses/:houseId', staffOnly, async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (BANK_FIELDS.some((f) => f in body) && !isOwnerOrAbove(viewer)) {
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

/** Bank transfers not yet tied to a house. Only the Developer sees money that belongs to no house yet. */
app.use('/api/payments/unassigned', requireAuth);
app.get('/api/payments/unassigned', async (c) => {
  if (!isDeveloper(c.get('viewer'))) return fail(c, 403, 'DEVELOPER_ONLY', 'Chỉ Developer xem được mục này.');
  const { results } = await c.env.DB.prepare(
    `SELECT id, amount, method, bank_name, reference, content, paid_at FROM payments WHERE house_id IS NULL ORDER BY paid_at DESC`
  ).all();
  return c.json({ success: true, payments: results });
});

/** The Google account behind every house's Sheet is set up once, by the Developer. */
const developerOnly = async (c: Context<App>, next: Next) =>
  isDeveloper(c.get('viewer')) ? next() : fail(c, 403, 'DEVELOPER_ONLY', 'Chỉ Developer dùng được chức năng này.');

app.use('/api/google/status', requireAuth, developerOnly);
app.get('/api/google/status', async (c) => {
  const row = await c.env.DB.prepare(`SELECT account, updated_at FROM integrations WHERE name = 'google'`).first<{ account: string; updated_at: string }>();
  return c.json({ success: true, connected: Boolean(row), account: row?.account ?? null, since: row?.updated_at ?? null });
});

/** The Developer opens this link in a browser and allows access with the Google account that should own the Sheets. */
app.use('/api/google/connect-url', requireAuth, developerOnly);
app.post('/api/google/connect-url', async (c) => {
  const url = await connectUrl(c.env, new URL(c.req.url).origin, actorOf(c.get('viewer')));
  return c.json({ success: true, url });
});

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
   <body style="font-family:system-ui;max-width:420px;margin:48px auto;padding:0 16px"><h2>${title}</h2><p>${text}</p></body>`;

app.get('/api/google/callback', async (c) => {
  const actor = await checkState(c.env, c.req.query('state') ?? '');
  const code = c.req.query('code');
  if (!actor || !code) return c.html(page('Không kết nối được', 'Link đã hết hạn hoặc bị huỷ. Vui lòng tạo link mới.'), 400);
  try {
    const email = await finishConnect(c.env, new URL(c.req.url).origin, code, actor);
    await audit(c, actor, 'google_connect', null, email);
    return c.html(page('Đã kết nối Google', `Trọ-Hub sẽ tạo và cập nhật Google Sheet trong Drive của <b>${email ?? 'tài khoản này'}</b>. Bạn có thể đóng trang này.`));
  } catch (e: any) {
    return c.html(page('Không kết nối được', String(e.message).replace(/</g, '&lt;')), 400);
  }
});

/** Proves the connection end to end: makes a small Sheet in the owner's Drive and returns its link. */
app.use('/api/google/test-sheet', requireAuth, developerOnly);
app.post('/api/google/test-sheet', async (c) => {
  try {
    const sheet = await sheetsApi<{ spreadsheetId: string; spreadsheetUrl: string }>(c.env, 'spreadsheets', {
      method: 'POST',
      body: { properties: { title: 'Trọ-Hub – kiểm tra kết nối' }, sheets: [{ properties: { title: 'Kiểm tra' } }] },
    });
    await sheetsApi(c.env, `spreadsheets/${sheet.spreadsheetId}/values/Kiểm tra!A1:B1?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [['Kết nối từ Cloudflare lúc', new Date().toISOString()]] },
    });
    return c.json({ success: true, url: sheet.spreadsheetUrl });
  } catch (e: any) {
    return fail(c, 400, 'GOOGLE_ERROR', e.message);
  }
});

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

export default app;
