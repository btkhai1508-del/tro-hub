import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { hashPassword, normalizePhone, verifyPassword } from './password.ts';
import { signToken, verifyToken } from './token.ts';
import { checkState, connectUrl, finishConnect, googleKey, sheetsApi } from './google.ts';
import {
  currentMonth, ensureMonthFresh, fromSheetMonth, legacyRoomCode, legacySheet, paintSheetPayment, parseLegacyRoom, previousMonth,
  saveScriptGate, scriptGates, sheetMonths, syncMonthFromSheet, toSheetMonth,
} from './sheetSync.ts';
import { decryptText } from './cccd.ts';
import { checkSepayState, disconnectSepay, finishSepayConnect, sepayConfigured, sepayConnectUrl, sepayRedirectUri, syncSepay } from './sepayOauth.ts';
import { checkoutPage, paidFromIpn, pgConfigured, pgLive, pgOrderNumber, sameSecret, type PgIpn } from './sepayGateway.ts';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CCCD_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ZALO_CHECKOUT_ACCOUNT?: string; // "<bin>:<số tài khoản>" đã đăng ký với Zalo Checkout
  ALLOWED_ORIGINS?: string; // comma-separated, e.g. "http://localhost:3000,https://tro-hub.pages.dev"
  SEPAY_OAUTH_CLIENT_ID?: string; // ứng dụng OAuth của Trọ Hub trên SePay (secret)
  SEPAY_OAUTH_CLIENT_SECRET?: string; // (secret)
  SEPAY_OAUTH_BASE?: string; // mặc định https://my.sepay.vn; trỏ sang mock khi thử trên máy
  SEPAY_WEBHOOK_ORIGIN?: string; // địa chỉ public SePay gửi webhook về, nếu khác địa chỉ Worker
  SHEET_WRITES?: string; // 'off': không tô cột P / không ghi cổng thanh toán sang Apps Script (chạy thử trên máy)
  EXPRESS_ORIGIN?: string; // server Express còn chạy giặt sấy, mặc định https://tro-hub.onrender.com
  SEPAY_PG_MERCHANT_ID?: string; // Cổng thanh toán SePay: mã đơn vị (secret)
  SEPAY_PG_SECRET_KEY?: string; // khoá ký form thanh toán (secret)
  SEPAY_PG_IPN_SECRET?: string; // khoá IPN đặt ở Cổng thanh toán → Cấu hình → IPN (secret)
  SEPAY_PG_ENV?: string; // 'production' để thu tiền thật; còn lại là sandbox
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
  return cors({ origin: allowed, allowHeaders: ['Content-Type', 'Authorization'], maxAge: 86400 })(c, next); // maxAge: không gửi lại OPTIONS mỗi lần app hỏi trạng thái
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
  // Admin Tổng and Admin căn alike see only the houses in staff_houses: each Admin Tổng is an independent landlord.
  // The Developer sells the service and can open every house.
  const houses = staff.role === 'developer'
    ? await db.prepare(`SELECT id AS house_id FROM houses`).all<{ house_id: string }>()
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
/** Admin Tổng: owns their houses, sets their bank accounts, sees their summary and creates Admin căn. */
const isOwner = (v: Viewer) => v.kind === 'staff' && v.role === 'owner';

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

/** The houses the caller may open. Admin Tổng gets the summary across their houses. */
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
  return c.json({ success: true, houses: results, canSeeSummary: isOwner(viewer) });
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
 * it (residents need it to pay); only Admin Tổng can change it. Zalo's quick transfer
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
  // A resident's transfer content is XXXPPP + MMYYYY: their house number, then their room number.
  const viewer = c.get('viewer');
  let payPrefix: string | null = null;
  if (viewer.kind === 'resident' && viewer.houseId === c.req.param('houseId') && viewer.roomId) {
    await assignPayNumbers(c.env.DB, viewer.houseId);
    const nums = await c.env.DB.prepare(
      `SELECT h.pay_no AS house_no, rm.pay_no AS room_no FROM rooms rm JOIN houses h ON h.id = rm.house_id WHERE rm.id = ? AND h.id = ?`
    )
      .bind(viewer.roomId, viewer.houseId)
      .first<{ house_no: number | null; room_no: number | null }>();
    if (nums?.house_no != null && nums.room_no != null) payPrefix = `${pad3(nums.house_no)}${pad3(nums.room_no)}`;
  }
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
      payPrefix,
    },
    canEdit: isOwner(c.get('viewer')),
  });
});

app.put('/api/houses/:houseId/payment-portal', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  if (!isOwner(viewer)) {
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
// Staff accounts. Admin Tổng creates and locks Admin căn for their own houses. New Admin Tổng
// (a new independent landlord) will sign up through a separate service site, not here.
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<StaffRole, string> = { developer: 'Developer', owner: 'Admin Tổng', manager: 'Admin căn' };

/** Which roles this viewer may create or edit, and on which houses. */
function staffScope(v: Viewer): { roles: StaffRole[]; houseIds: string[] } | null {
  return isOwner(v) && v.kind === 'staff' ? { roles: ['manager'], houseIds: v.houseIds } : null;
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
    .filter((s) => s.id === viewer.id || (s.role === 'manager' && s.house_ids.some((h) => scope.houseIds.includes(h))));
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
  if (current.some((h) => !scope.houseIds.includes(h)))
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
// New house (Admin Tổng): house, rates and rooms in one request; the house belongs to its creator.
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
  if (!isOwner(viewer)) return fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng được tạo nhà trọ.');
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
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, abbreviation, text('address_detail'), text('ward'), text('province'), text('landlord_name'), normalizePhone(text('landlord_phone')), viewer.id),
    c.env.DB.prepare(`INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})`)
      .bind(id, ...RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(rates[f]) || 0)))),
    ...rooms.map((room) => c.env.DB.prepare(`INSERT INTO rooms (house_id, name, price) VALUES (?, ?, ?)`).bind(id, room, Math.max(0, Number(body.roomPrice) || 0))),
    c.env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (?, ?)`).bind(viewer.id, id),
  ]);
  await assignPayNumbers(c.env.DB);
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

/**
 * Admin Tổng or Admin căn creates a resident account straight into a room, already approved.
 * A room holds at most its capacity (3) of approved and pending residents.
 */
app.post('/api/houses/:houseId/residents', staffOnly, async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const body = await c.req.json<{ fullName?: string; phone?: string; password?: string; email?: string; gender?: string; roomId?: number }>()
    .catch(() => ({}) as Record<string, never>);
  const fullName = String(body.fullName ?? '').trim();
  const phone = normalizePhone(body.phone ?? '');
  const password = String(body.password ?? '');
  if (!fullName || !/^0\d{9}$/.test(phone)) return fail(c, 400, 'RESIDENT_INVALID', 'Vui lòng nhập họ tên và số điện thoại 10 số.');
  if (password.length < 6) return fail(c, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu phải có ít nhất 6 ký tự');

  const room = await c.env.DB.prepare(
    `SELECT rm.id, rm.name, rm.capacity,
            (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status IN ('approved', 'pending') AND r.deleted_at IS NULL) AS occupants
       FROM rooms rm WHERE rm.id = ? AND rm.house_id = ? AND rm.deleted_at IS NULL`
  )
    .bind(Number(body.roomId), houseId)
    .first<{ id: number; name: string; capacity: number; occupants: number }>();
  if (!room) return fail(c, 400, 'ROOM_INVALID', 'Vui lòng chọn phòng của nhà này.');
  if (room.occupants >= room.capacity)
    return fail(c, 400, 'ROOM_FULL', `Phòng ${room.name} đã đủ ${room.capacity} người.`);
  const taken = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE phone = ? UNION SELECT 1 FROM residents WHERE phone = ? AND deleted_at IS NULL`)
    .bind(phone, phone)
    .first();
  if (taken) return fail(c, 400, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');

  const created = await c.env.DB.prepare(
    `INSERT INTO residents (house_id, room_id, full_name, gender, phone, password_hash, email, status, move_in_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', strftime('%d/%m/%Y', 'now', '+7 hours')) RETURNING id`
  )
    .bind(houseId, room.id, fullName, String(body.gender ?? '').trim() || null, phone, await hashPassword(password), String(body.email ?? '').trim() || null)
    .first<{ id: number }>();
  await audit(c, actorOf(viewer), 'resident_create', houseId, `resident:${created!.id}`);
  return c.json({ success: true, id: created!.id, room: room.name });
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

/** Bank transfers not yet tied to a house, limited to accounts used by this Admin Tổng's houses. */
app.use('/api/payments/unassigned', requireAuth);
app.get('/api/payments/unassigned', async (c) => {
  const viewer = c.get('viewer');
  if (!isOwner(viewer) || viewer.kind !== 'staff' || !viewer.houseIds.length) return fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng xem được mục này.');
  const marks = viewer.houseIds.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT id, amount, method, bank_name, reference, content, paid_at FROM payments
      WHERE house_id IS NULL AND account_no IN (SELECT bank_account_no FROM houses WHERE id IN (${marks}))
      ORDER BY paid_at DESC`
  )
    .bind(...viewer.houseIds)
    .all();
  return c.json({ success: true, payments: results });
});

/** Each Admin Tổng links their own Google account; their houses' Sheets live in their Drive. */
const ownerOnly = async (c: Context<App>, next: Next) =>
  isOwner(c.get('viewer')) ? next() : fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng dùng được chức năng này.');

app.use('/api/google/status', requireAuth, ownerOnly);
app.get('/api/google/status', async (c) => {
  const row = await c.env.DB.prepare(`SELECT account, updated_at FROM integrations WHERE name = ?`)
    .bind(googleKey(actorOf(c.get('viewer'))))
    .first<{ account: string; updated_at: string }>();
  return c.json({ success: true, connected: Boolean(row), account: row?.account ?? null, since: row?.updated_at ?? null });
});

/** Admin Tổng opens this link in a browser and allows access with the Google account that should own the Sheets. */
app.use('/api/google/connect-url', requireAuth, ownerOnly);
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
app.use('/api/google/test-sheet', requireAuth, ownerOnly);
app.post('/api/google/test-sheet', async (c) => {
  try {
    const actor = actorOf(c.get('viewer'));
    const sheet = await sheetsApi<{ spreadsheetId: string; spreadsheetUrl: string }>(c.env, actor, 'spreadsheets', {
      method: 'POST',
      body: { properties: { title: 'Trọ-Hub – kiểm tra kết nối' }, sheets: [{ properties: { title: 'Kiểm tra' } }] },
    });
    await sheetsApi(c.env, actor, `spreadsheets/${sheet.spreadsheetId}/values/Kiểm tra!A1:B1?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [['Kết nối từ Cloudflare lúc', new Date().toISOString()]] },
    });
    return c.json({ success: true, url: sheet.spreadsheetUrl });
  } catch (e: any) {
    return fail(c, 400, 'GOOGLE_ERROR', e.message);
  }
});

// ---------------------------------------------------------------------------
// Routes that replace the Express + Google Sheet ones, with the same paths and response shapes,
// so the app moves over one data group at a time. Room codes keep the old form: LVC rooms are
// "LVC-101", other houses' rooms are their plain name.
// ---------------------------------------------------------------------------

export { legacyRoomCode, parseLegacyRoom };

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

// ---------------------------------------------------------------------------
// Nhóm 2: tiền phòng và thanh toán trên D1, cùng đường dẫn và dạng dữ liệu với Express.
// Số tiền vẫn đọc từ Sheet cũ (sheetSync.ts) cho tới nhóm 4; trạng thái thanh toán và cổng thanh toán
// do D1 quyết định, và được ghi ngược sang Sheet/Apps Script để phần còn trên Express thấy giống nhau.
// ---------------------------------------------------------------------------

type InvoiceStatus = 'unpaid' | 'pending' | 'paid' | 'cash';

/** 'MM/YYYY' từ app → 'YYYY-MM'; trống hoặc sai → tháng hiện tại. */
const monthParam = (value: unknown) => fromSheetMonth(String(value ?? '')) ?? currentMonth();
const vnDate = (iso: string | null) => (iso ? new Date(Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`) + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/') : '');

function paymentStatusOut(status: InvoiceStatus | null, paidAt: string | null) {
  const s = status ?? 'unpaid';
  const paid = s === 'paid' || s === 'cash';
  const day = vnDate(paidAt);
  return {
    paymentStatus: paid ? 'paid' : s === 'pending' ? 'pending' : 'unpaid',
    paymentMethod: s === 'cash' ? 'cash' : paid ? 'qr' : null,
    sheetColor: paid ? '#b6d7a8' : s === 'pending' ? '#FFF2CC' : '#F7D1D5',
    label: s === 'cash' ? `Đã thanh toán tiền mặt${day ? ` ngày ${day}` : ''}` : paid ? `Đã thanh toán${day ? ` ngày ${day}` : ''}` : s === 'pending' ? 'Chờ xác nhận' : 'Chưa thanh toán',
    statusText: paid ? 'Đã đóng' : s === 'pending' ? 'Chờ xác nhận' : 'Chưa đóng',
  };
}

/** Phòng theo mã kiểu cũ ("LVC-101", "G01"), chỉ trong các nhà người gọi được xem. */
async function findRentRoom(db: D1Database, houseIds: string[], code: string) {
  if (!houseIds.length) return null;
  const place = parseLegacyRoom(code);
  if (place && houseIds.includes(place.houseId)) {
    const row = await db.prepare(`SELECT id, house_id, name FROM rooms WHERE house_id = ? AND name = ? AND deleted_at IS NULL`)
      .bind(place.houseId, place.room).first<{ id: number; house_id: string; name: string }>();
    if (row) return row;
  }
  // Nhà mới không có tiền tố: tên phòng phải chỉ thuộc một nhà.
  const { results } = await db.prepare(
    `SELECT id, house_id, name FROM rooms WHERE deleted_at IS NULL AND UPPER(name) = ? AND house_id IN (${houseIds.map(() => '?').join(',')})`
  ).bind(String(code ?? '').trim().toUpperCase(), ...houseIds).all<{ id: number; house_id: string; name: string }>();
  return results.length === 1 ? results[0] : null;
}

interface InvoiceRow { id: number; house_id: string; room_id: number; total: number; status: InvoiceStatus; paid_at: string | null; sheet_row: number | null }

const invoiceFor = (db: D1Database, roomId: number, month: string) =>
  db.prepare(`SELECT id, house_id, room_id, total, status, paid_at, sheet_row FROM invoices WHERE room_id = ? AND month = ?`)
    .bind(roomId, month).first<InvoiceRow>();

/** Hoá đơn của phòng trong tháng; tháng mới chưa có trên D1 thì đọc Sheet ngay một lần. */
async function invoiceOrSync(db: D1Database, roomId: number, month: string) {
  return (await invoiceFor(db, roomId, month)) ?? ((await ensureMonthFresh(db, month, 0)) ? invoiceFor(db, roomId, month) : null);
}

function statusResponse(houseId: string, room: string, month: string, inv: InvoiceRow | null) {
  return {
    success: true,
    roomNumber: legacyRoomCode(houseId, room),
    foundRow: inv?.sheet_row ?? -1,
    cellAddress: inv?.sheet_row ? `P${inv.sheet_row}` : 'N/A',
    tabName: toSheetMonth(month),
    amount: inv?.total ?? 0,
    ...paymentStatusOut(inv?.status ?? null, inv?.paid_at ?? null),
  };
}

/** Cư dân xem phòng mình; quản lý xem phòng bất kỳ trong nhà mình (?room=). */
app.use('/api/payment/status', requireAuth);
app.get('/api/payment/status', async (c) => {
  const v = c.get('viewer');
  const month = monthParam(c.req.query('month'));
  const room = v.kind === 'resident'
    ? (v.roomId && v.roomName ? { id: v.roomId, house_id: v.houseId, name: v.roomName } : null)
    : await findRentRoom(c.env.DB, v.houseIds, c.req.query('room') ?? '');
  if (!room) return fail(c, 400, 'ROOM_REQUIRED', 'Thiếu mã phòng');
  c.executionCtx.waitUntil(ensureMonthFresh(c.env.DB, month, 10 * 60_000));
  return c.json(statusResponse(room.house_id, room.name, month, await invoiceFor(c.env.DB, room.id, month)));
});

/**
 * Cư dân bấm "đã chuyển khoản": hoá đơn chuyển sang Chờ xác nhận. Chỉ tiền về tài khoản (SePay) hoặc
 * quản lý mới đánh dấu Đã đóng được.
 */
app.use('/api/payment/mark-paid', requireAuth);
app.post('/api/payment/mark-paid', async (c) => {
  const v = c.get('viewer');
  if (v.kind !== 'resident' || !v.roomId || !v.roomName) return fail(c, 403, 'RESIDENT_ONLY', 'Chỉ cư dân của phòng mới báo đã chuyển khoản được.');
  const body = await c.req.json<{ month?: string }>().catch(() => ({} as { month?: string }));
  const month = monthParam(body.month);
  const inv = await invoiceOrSync(c.env.DB, v.roomId, month);
  if (!inv) return fail(c, 404, 'INVOICE_NOT_FOUND', `Chưa có hoá đơn tháng ${toSheetMonth(month)}.`);
  if (inv.status === 'unpaid') {
    await c.env.DB.prepare(`UPDATE invoices SET status = 'pending', status_by = ? WHERE id = ? AND status = 'unpaid'`).bind(actorOf(v), inv.id).run();
    await audit(c, actorOf(v), 'rent_claimed_paid', v.houseId, `invoice:${inv.id}`);
  }
  const fresh = await invoiceFor(c.env.DB, v.roomId, month);
  const status = statusResponse(v.houseId, v.roomName, month, fresh);
  return c.json({ success: true, roomNumber: status.roomNumber, status, message: status.paymentStatus === 'paid' ? 'Hoá đơn đã được xác nhận thanh toán.' : 'Đã ghi nhận, đang chờ xác nhận tiền về.' });
});

/** Cổng thanh toán của nhà trong tháng; tháng chưa đặt thì giữ giá trị mới nhất của nhà. */
async function gateFor(db: D1Database, houseId: string, month: string): Promise<'START' | 'STOP'> {
  const exact = await db.prepare(`SELECT value FROM payment_gates WHERE house_id = ? AND month = ?`).bind(houseId, month).first<{ value: 'START' | 'STOP' }>();
  if (exact) return exact.value;
  const latest = await db.prepare(`SELECT value FROM payment_gates WHERE house_id = ? ORDER BY updated_at DESC, month DESC LIMIT 1`).bind(houseId).first<{ value: 'START' | 'STOP' }>();
  if (latest) return latest.value;
  // Lần đầu: lấy các tháng Express đã lưu trong Apps Script cho nhà còn dùng Sheet cũ.
  const legacy = await legacySheet(db);
  if (!legacy?.houses.includes(houseId)) return 'STOP';
  const gates = await scriptGates();
  const rows = Object.entries(gates ?? {})
    .map(([label, g]) => ({ month: fromSheetMonth(label), value: g.value === 'START' ? 'START' : 'STOP', at: g.updatedAt ?? 0 }))
    .filter((g): g is { month: string; value: 'START' | 'STOP'; at: number } => Boolean(g.month));
  if (!rows.length) return 'STOP';
  await db.batch(rows.map((g) =>
    db.prepare(`INSERT OR IGNORE INTO payment_gates (house_id, month, value, updated_by, updated_at) VALUES (?, ?, ?, 'apps-script', ?)`)
      .bind(houseId, g.month, g.value, new Date(g.at || Date.now()).toISOString().replace('T', ' ').slice(0, 19))
  ));
  return gateFor(db, houseId, month);
}

app.use('/api/payment/gate', requireAuth);
app.get('/api/payment/gate', async (c) => {
  const v = c.get('viewer');
  const month = monthParam(c.req.query('month'));
  const houseId = v.kind === 'resident' ? v.houseId : v.houseIds[0];
  if (!houseId) return c.json({ success: true, month: toSheetMonth(month), value: 'STOP' });
  return c.json({ success: true, month: toSheetMonth(month), value: await gateFor(c.env.DB, houseId, month) });
});

for (const path of ['/api/admin/months', '/api/admin/dashboard', '/api/admin/billing', '/api/admin/payment-status', '/api/admin/payment-gate'])
  app.use(path, requireAuth, staffOnly);

const staffHouseIds = (v: Viewer) => (v.kind === 'staff' ? v.houseIds : []);
const inList = (ids: string[]) => ids.map(() => '?').join(',') || 'NULL';

app.get('/api/admin/months', async (c) => {
  const houseIds = staffHouseIds(c.get('viewer'));
  const months = new Set<string>([currentMonth()]);
  if (houseIds.length) {
    const { results } = await c.env.DB.prepare(`SELECT DISTINCT month FROM invoices WHERE house_id IN (${inList(houseIds)})`).bind(...houseIds).all<{ month: string }>();
    results.forEach((r) => months.add(r.month));
    const legacy = await legacySheet(c.env.DB);
    if (legacy && legacy.houses.some((h) => houseIds.includes(h))) (await sheetMonths(legacy.sheetId).catch(() => [])).forEach((m) => months.add(m));
  }
  return c.json({ success: true, months: [...months].sort().map(toSheetMonth) });
});

app.get('/api/admin/dashboard', async (c) => {
  const houseIds = staffHouseIds(c.get('viewer'));
  const month = monthParam(c.req.query('month'));
  const empty = { dien: 0, nuoc: 0, tienDien: 0, tienNuoc: 0, doanhThu: 0, soNguoi: 0, soXe: 0 };
  if (!houseIds.length) return c.json({ success: true, data: { ...empty, usageTrend: [] } });
  await ensureMonthFresh(c.env.DB, month);
  const marks = inList(houseIds);
  const { results: trend } = await c.env.DB.prepare(
    `SELECT i.month,
            SUM(MAX(COALESCE(m.electric_new - m.electric_old, 0), 0)) AS dien,
            SUM(MAX(COALESCE(m.water_new - m.water_old, 0), 0)) AS nuoc,
            SUM(i.electricity) AS tienDien, SUM(i.water) AS tienNuoc, SUM(i.total) AS doanhThu
       FROM invoices i LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id IN (${marks}) AND i.month <= ?
      GROUP BY i.month ORDER BY i.month DESC LIMIT 6`
  ).bind(...houseIds, month).all<{ month: string; dien: number; nuoc: number; tienDien: number; tienNuoc: number; doanhThu: number }>();
  const people = await c.env.DB.prepare(
    `SELECT COUNT(*) AS soNguoi,
            SUM(CASE WHEN LENGTH(TRIM(COALESCE(plate_number, ''))) >= 4 THEN 1 ELSE 0 END) AS soXe
       FROM residents WHERE house_id IN (${marks}) AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL`
  ).bind(...houseIds).first<{ soNguoi: number; soXe: number | null }>();
  const selected = trend.find((t) => t.month === month);
  const counts = { soNguoi: people?.soNguoi ?? 0, soXe: people?.soXe ?? 0 };
  const usageTrend = trend.reverse().map((t) => ({ ...t, month: toSheetMonth(t.month), ...counts }));
  return c.json({ success: true, data: { ...empty, ...(selected ? { ...selected, month: undefined } : {}), ...counts, usageTrend } });
});

interface BillingRow {
  id: number; house_id: string; room_id: number; room: string; month: string; room_rent: number; electricity: number; water: number;
  trash: number; internet: number; parking: number; other: number; deposit: number; total: number; status: InvoiceStatus;
  paid_at: string | null; sheet_row: number | null; electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null;
}

app.get('/api/admin/billing', async (c) => {
  const houseIds = staffHouseIds(c.get('viewer'));
  const month = monthParam(c.req.query('month'));
  if (!houseIds.length) return c.json({ success: true, billing: [] });
  await ensureMonthFresh(c.env.DB, month);
  const marks = inList(houseIds);
  const { results: invoices } = await c.env.DB.prepare(
    `SELECT i.id, i.house_id, i.room_id, rm.name AS room, i.month, i.room_rent, i.electricity, i.water, i.trash, i.internet, i.parking,
            i.other, i.deposit, i.total, i.status, i.paid_at, i.sheet_row, m.electric_old, m.electric_new, m.water_old, m.water_new
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id
       LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id IN (${marks}) AND i.month = ?
      ORDER BY COALESCE(i.sheet_row, 9999), i.house_id, rm.name`
  ).bind(...houseIds, month).all<BillingRow>();
  const { results: people } = await c.env.DB.prepare(
    `SELECT room_id, full_name, phone, cccd_enc, plate_number FROM residents
      WHERE house_id IN (${marks}) AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL ORDER BY id`
  ).bind(...houseIds).all<{ room_id: number; full_name: string; phone: string | null; cccd_enc: string | null; plate_number: string | null }>();
  const byRoom = new Map<number, typeof people>();
  for (const p of people) byRoom.set(p.room_id, [...(byRoom.get(p.room_id) ?? []), p]);
  const cccd = async (enc: string | null) => (enc ? decryptText(enc, c.env.CCCD_KEY).catch(() => '') : '');

  const billing = await Promise.all(invoices.map(async (i) => {
    const occupants = (byRoom.get(i.room_id) ?? []).slice(0, 3);
    const slot = async (n: number) => {
      const p = occupants[n];
      return { name: p?.full_name ?? '', cccd: await cccd(p?.cccd_enc ?? null), phone: p?.phone ?? '', plate: p?.plate_number ?? '' };
    };
    const [p1, p2, p3] = await Promise.all([slot(0), slot(1), slot(2)]);
    const plates = [p1.plate, p2.plate, p3.plate].filter((x) => x.trim().length >= 4);
    const st = paymentStatusOut(i.status, i.paid_at);
    const eOld = i.electric_old ?? 0, eNew = i.electric_new ?? 0, wOld = i.water_old ?? 0, wNew = i.water_new ?? 0;
    return {
      row: i.sheet_row ?? undefined,
      houseId: i.house_id,
      invoiceId: i.id,
      room: legacyRoomCode(i.house_id, i.room),
      name: p1.name || p2.name || p3.name || `Phòng ${i.room}`,
      phone: p1.phone || p2.phone || p3.phone || '',
      dienCu: eOld, dienMoi: eNew, dienUsed: Math.max(eNew - eOld, 0),
      nuocCu: wOld, nuocMoi: wNew, nuocUsed: Math.max(wNew - wOld, 0),
      tienPhong: i.room_rent, tienDien: i.electricity, tienNuoc: i.water, tienRac: i.trash, tienNet: i.internet,
      tienXe: i.parking, tienKhac: i.other, tienCoc: i.deposit, tongTien: i.total,
      nguoi1: p1.name, cccd1: p1.cccd, sdt1: p1.phone, xe1: p1.plate,
      nguoi2: p2.name, cccd2: p2.cccd, sdt2: p2.phone, xe2: p2.plate,
      nguoi3: p3.name, cccd3: p3.cccd, sdt3: p3.phone, xe3: p3.plate,
      soNguoi: occupants.length, soXe: plates.length, soNet: 0,
      paymentStatus: st.paymentStatus, statusText: st.statusText, status: st.paymentStatus, paymentMethod: st.paymentMethod,
      paidAt: vnDate(i.paid_at),
    };
  }));
  return c.json({ success: true, billing });
});

/** Quản lý đổi trạng thái một phòng: 'paid' / 'cash' (đã đóng), 'pending', 'unpaid'. */
app.post('/api/admin/payment-status', async (c) => {
  const v = c.get('viewer');
  const body = await c.req.json<{ roomNumber?: string; status?: string; month?: string; row?: number }>().catch(() => ({} as Record<string, never>));
  const status: InvoiceStatus = (['paid', 'cash', 'pending'] as const).find((s) => s === body.status) ?? 'unpaid';
  const month = monthParam(body.month);
  const room = await findRentRoom(c.env.DB, staffHouseIds(v), String(body.roomNumber ?? ''));
  if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng trong nhà bạn quản lý.');
  const inv = await invoiceOrSync(c.env.DB, room.id, month);
  if (!inv) return fail(c, 404, 'INVOICE_NOT_FOUND', `Phòng ${body.roomNumber} chưa có hoá đơn tháng ${toSheetMonth(month)}.`);
  const paid = status === 'paid' || status === 'cash';
  await c.env.DB.prepare(
    `UPDATE invoices SET status = ?, paid_at = CASE WHEN ? THEN COALESCE(paid_at, datetime('now')) ELSE NULL END, status_by = ? WHERE id = ?`
  ).bind(status, paid ? 1 : 0, actorOf(v), inv.id).run();
  await audit(c, actorOf(v), `rent_status_${status}`, room.house_id, `invoice:${inv.id}`);
  if (status !== 'pending') c.executionCtx.waitUntil(paintSheetPayment(c.env, room.house_id, room.name, paid, month, inv.sheet_row));
  return c.json({ success: true, message: `Đã cập nhật trạng thái phòng ${body.roomNumber}`, roomNumber: legacyRoomCode(room.house_id, room.name), status, row: inv.sheet_row ?? undefined });
});

app.get('/api/admin/payment-gate', async (c) => {
  const houseIds = staffHouseIds(c.get('viewer'));
  const month = monthParam(c.req.query('month'));
  return c.json({ success: true, month: toSheetMonth(month), value: houseIds[0] ? await gateFor(c.env.DB, houseIds[0], month) : 'STOP' });
});

/** Mở/đóng cổng cho mọi nhà quản lý này phụ trách (trang Admin hiện có một nút chung). */
app.post('/api/admin/payment-gate', async (c) => {
  const v = c.get('viewer');
  const houseIds = staffHouseIds(v);
  const body = await c.req.json<{ month?: string; value?: string }>().catch(() => ({} as Record<string, never>));
  const month = monthParam(body.month);
  const value = String(body.value).toUpperCase() === 'START' ? 'START' : 'STOP';
  if (!houseIds.length) return fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn chưa được giao nhà trọ nào.');
  await c.env.DB.batch(houseIds.map((h) =>
    c.env.DB.prepare(
      `INSERT INTO payment_gates (house_id, month, value, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (house_id, month) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(h, month, value, actorOf(v))
  ));
  await audit(c, actorOf(v), `payment_gate_${value.toLowerCase()}`, null, `${houseIds.join(',')}:${month}`);
  const legacy = await legacySheet(c.env.DB);
  if (legacy?.houses.some((h) => houseIds.includes(h))) c.executionCtx.waitUntil(saveScriptGate(c.env, month, value));
  return c.json({ success: true, month: toSheetMonth(month), value });
});

/**
 * Tiền phòng về tài khoản (SePay, mã XXXPPPMMYYYY hoặc mã cũ): ghi vào sổ thu tiền và đánh dấu Đã đóng
 * khi tổng tiền nhận cho hoá đơn đủ số tiền của hoá đơn.
 */
/** SePay ghi giờ Việt Nam ("2026-11-17 20:10:00"); D1 lưu giờ UTC như datetime('now'). */
function vnTimeToUtc(text: string | undefined) {
  const m = String(text ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const at = m ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+07:00`) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString().replace('T', ' ').slice(0, 19) : null;
}

async function settleRent(env: Env, houseId: string, room: string, month: string, t: SepayTransfer, sepayId: string) {
  const db = env.DB;
  const roomRow = await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room).first<{ id: number }>();
  if (!roomRow) return { settled: false, reason: 'room' as const };
  const inv = await invoiceOrSync(db, roomRow.id, month);
  const amount = Math.round(Number(t.transferAmount) || 0);
  await db.prepare(
    `INSERT OR IGNORE INTO payments (house_id, invoice_id, amount, method, bank_name, account_no, reference, content, paid_at, confirmed_by)
     VALUES (?, ?, ?, 'bank', ?, ?, ?, ?, ?, 'sepay')`
  ).bind(houseId, inv?.id ?? null, amount, t.gateway ?? null, t.accountNumber ?? null, t.referenceCode || `sepay-${sepayId}`,
    String(t.content ?? '').slice(0, 300), t.transactionDate ?? new Date().toISOString()).run();
  if (!inv) return { settled: false, reason: 'invoice' as const };
  const sum = await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ? AND method = 'bank'`).bind(inv.id).first<{ paid: number }>();
  const received = sum?.paid ?? 0;
  if (inv.status === 'paid' || inv.status === 'cash') return { settled: true, already: true, invoiceId: inv.id, received, total: inv.total };
  if (received < inv.total) return { settled: false, reason: 'short' as const, invoiceId: inv.id, received, total: inv.total };
  await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = COALESCE(?, datetime('now')), status_by = 'sepay' WHERE id = ?`)
    .bind(vnTimeToUtc(t.transactionDate), inv.id).run();
  await paintSheetPayment(env, houseId, room, true, month, inv.sheet_row);
  return { settled: true, invoiceId: inv.id, received, total: inv.total };
}

// ---------------------------------------------------------------------------
// Developer: the person who sells Trọ Hub. Creates landlords (Admin Tổng), locks them, and
// creates houses with their floors and rooms for a landlord, and picks which admin tools (tiện ích)
// each house pays for.
// ---------------------------------------------------------------------------

const isDeveloper = (v: Viewer) => v.kind === 'staff' && v.role === 'developer';
const developerOnly = async (c: Context<App>, next: Next) =>
  isDeveloper(c.get('viewer')) ? next() : fail(c, 403, 'DEVELOPER_ONLY', 'Chỉ Developer dùng được chức năng này.');

app.use('/api/dev/*', requireAuth, developerOnly);

// ---------------------------------------------------------------------------
// Tiện ích: the admin tools a house pays for, priced per room per month. Core tools are always on.
// ---------------------------------------------------------------------------

interface ServiceModule { key: string; label: string; price_per_room: number; core: number }

async function moduleCatalog(db: D1Database): Promise<ServiceModule[]> {
  const { results } = await db.prepare(`SELECT key, label, price_per_room, core FROM service_modules ORDER BY sort, key`).all<ServiceModule>();
  return results;
}

/** The tools a house uses. NULL (houses from before tiện ích existed) means every tool. */
function houseModules(stored: string | null, catalog: ServiceModule[]): string[] {
  if (stored == null) return catalog.map((m) => m.key);
  const picked = new Set(JSON.parse(stored) as string[]);
  return catalog.filter((m) => m.core || picked.has(m.key)).map((m) => m.key);
}

/** Known keys only, core tools always included. */
function cleanModules(input: unknown, catalog: ServiceModule[]): string[] {
  const picked = new Set(Array.isArray(input) ? input.map(String) : []);
  return catalog.filter((m) => m.core || picked.has(m.key)).map((m) => m.key);
}

const monthlyPerRoom = (keys: string[], catalog: ServiceModule[]) =>
  catalog.filter((m) => keys.includes(m.key)).reduce((sum, m) => sum + m.price_per_room, 0);

app.get('/api/dev/modules', async (c) => c.json({ success: true, modules: await moduleCatalog(c.env.DB) }));

/** Change the price of one tool. Every house that uses it is billed at the new price. */
app.put('/api/dev/modules/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json<{ price_per_room?: number }>().catch(() => ({}) as { price_per_room?: number });
  const price = Math.round(Number(body.price_per_room));
  if (!(price >= 0 && price <= 10_000_000)) return fail(c, 400, 'PRICE_INVALID', 'Giá phải là số từ 0 đến 10.000.000.');
  const row = await c.env.DB.prepare(`UPDATE service_modules SET price_per_room = ? WHERE key = ? RETURNING key`).bind(price, key).first();
  if (!row) return fail(c, 404, 'MODULE_NOT_FOUND', 'Không tìm thấy tiện ích.');
  await audit(c, actorOf(c.get('viewer')), 'module_price', null, `${key}=${price}`);
  return c.json({ success: true });
});

const MAX_ROOMS_PER_HOUSE = 500;

/** Every landlord with their houses, room and resident counts. */
app.get('/api/dev/landlords', async (c) => {
  await assignPayNumbers(c.env.DB);
  const { results: owners } = await c.env.DB.prepare(
    `SELECT id, full_name, phone, email, status, created_at FROM staff WHERE role = 'owner' ORDER BY created_at DESC, id DESC`
  ).all<{ id: number; full_name: string; phone: string; email: string | null; status: string; created_at: string }>();
  const { results: houses } = await c.env.DB.prepare(
    `SELECT h.id, h.name, h.abbreviation, h.address_detail, h.ward, h.province, h.floors, h.modules, h.status, h.delete_after, h.created_at, h.pay_no,
            sh.staff_id AS owner_id,
            (SELECT COUNT(*) FROM rooms rm WHERE rm.house_id = h.id AND rm.deleted_at IS NULL) AS room_count,
            (SELECT COUNT(*) FROM residents r WHERE r.house_id = h.id AND r.status = 'approved' AND r.deleted_at IS NULL) AS resident_count
       FROM houses h JOIN staff_houses sh ON sh.house_id = h.id JOIN staff s ON s.id = sh.staff_id AND s.role = 'owner'
      ORDER BY h.created_at, h.name`
  ).all<Record<string, any>>();
  const catalog = await moduleCatalog(c.env.DB);
  const landlords = owners.map((o) => ({
    ...o,
    houses: houses
      .filter((h) => h.owner_id === o.id)
      .map(({ owner_id, modules, ...h }) => {
        const keys = houseModules(modules, catalog);
        return { ...h, modules: keys, monthly_fee: h.room_count * monthlyPerRoom(keys, catalog) };
      }),
  }));
  return c.json({ success: true, landlords });
});

/** A new landlord: an Admin Tổng account that logs in with this phone and password. */
app.post('/api/dev/landlords', async (c) => {
  const viewer = c.get('viewer');
  const body = await c.req.json<{ fullName?: string; phone?: string; password?: string; email?: string }>().catch(() => ({}) as Record<string, never>);
  const fullName = String(body.fullName ?? '').trim();
  const phone = normalizePhone(body.phone ?? '');
  const password = String(body.password ?? '');
  const email = String(body.email ?? '').trim();
  if (!fullName || !/^0\d{9}$/.test(phone)) return fail(c, 400, 'LANDLORD_INVALID', 'Vui lòng nhập họ tên và số điện thoại 10 số.');
  if (!password) return fail(c, 400, 'PASSWORD_REQUIRED', 'Vui lòng nhập mật khẩu ban đầu.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(c, 400, 'EMAIL_INVALID', 'Email không hợp lệ.');
  const taken = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE phone = ? UNION SELECT 1 FROM residents WHERE phone = ? AND deleted_at IS NULL`)
    .bind(phone, phone)
    .first();
  if (taken) return fail(c, 400, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');

  const created = await c.env.DB.prepare(
    `INSERT INTO staff (full_name, phone, password_hash, role, email, created_by) VALUES (?, ?, ?, 'owner', ?, ?) RETURNING id`
  )
    .bind(fullName, phone, await hashPassword(password), email || null, viewer.id)
    .first<{ id: number }>();
  await audit(c, actorOf(viewer), 'landlord_create', null, `owner:${created!.id}`);
  return c.json({ success: true, id: created!.id });
});

/** Lock or unlock a landlord. A locked landlord is signed out at once (the Worker reads D1 on every request). */
app.patch('/api/dev/landlords/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (!['active', 'locked'].includes(String(body.status))) return fail(c, 400, 'STATUS_INVALID', 'Trạng thái không hợp lệ.');
  const target = await c.env.DB.prepare(`SELECT id FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first();
  if (!target) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  await c.env.DB.prepare(`UPDATE staff SET status = ? WHERE id = ?`).bind(body.status, id).run();
  await audit(c, actorOf(viewer), body.status === 'locked' ? 'landlord_lock' : 'landlord_unlock', null, `owner:${id}`);
  return c.json({ success: true });
});

interface NewRoom { name?: string; floor?: number; capacity?: number }

/**
 * A new house for a landlord, with every room the wizard laid out. The client sends the final room
 * list (names already chosen), so the naming rules live in one place: the wizard's preview.
 */
app.post('/api/dev/landlords/:id/houses', async (c) => {
  const viewer = c.get('viewer');
  const ownerId = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare(`SELECT id, full_name, phone FROM staff WHERE id = ? AND role = 'owner'`)
    .bind(ownerId)
    .first<{ id: number; full_name: string; phone: string }>();
  if (!owner) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');

  const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);
  const text = (key: string, max = 120) => String(body[key] ?? '').trim().slice(0, max);
  const name = text('name');
  const abbreviation = text('abbreviation', 20).toUpperCase();
  const id = abbreviation.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Đ/g, 'D').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!name || !id) return fail(c, 400, 'HOUSE_INVALID', 'Vui lòng nhập tên căn trọ và tên viết tắt.');
  if (await c.env.DB.prepare(`SELECT 1 FROM houses WHERE id = ?`).bind(id).first())
    return fail(c, 400, 'HOUSE_EXISTS', 'Tên viết tắt này đã được dùng cho căn khác.');

  const floors = Math.round(Number(body.floors));
  if (!(floors >= 1 && floors <= 50)) return fail(c, 400, 'FLOORS_INVALID', 'Số tầng phải từ 1 đến 50.');
  const rooms = (Array.isArray(body.rooms) ? (body.rooms as NewRoom[]) : []).map((r) => ({
    name: String(r?.name ?? '').trim().toUpperCase().slice(0, 20),
    floor: Math.round(Number(r?.floor)),
    capacity: Math.round(Number(r?.capacity)),
  }));
  if (!rooms.length) return fail(c, 400, 'ROOMS_INVALID', 'Căn trọ cần ít nhất một phòng.');
  if (rooms.length > MAX_ROOMS_PER_HOUSE) return fail(c, 400, 'ROOMS_INVALID', `Một căn tối đa ${MAX_ROOMS_PER_HOUSE} phòng.`);
  const bad = rooms.find((r) => !r.name || !(r.floor >= 1 && r.floor <= floors) || !(r.capacity >= 1 && r.capacity <= 20));
  if (bad) return fail(c, 400, 'ROOMS_INVALID', `Phòng "${bad.name || '(trống)'}" thiếu tên, sai tầng hoặc số người không nằm trong 1–20.`);
  const seen = new Set<string>();
  const dup = rooms.find((r) => (seen.has(r.name) ? true : (seen.add(r.name), false)));
  if (dup) return fail(c, 400, 'ROOMS_DUPLICATE', `Tên phòng ${dup.name} bị trùng.`);

  const modules = cleanModules(body.modules, await moduleCatalog(c.env.DB));
  const price = Math.max(0, Math.round(Number(body.price) || 0));
  const rates = (body.rates ?? {}) as Record<string, unknown>;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, floors, modules, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, abbreviation, text('address_detail'), text('ward'), text('province'), owner.full_name, owner.phone, floors, JSON.stringify(modules), owner.id),
    c.env.DB.prepare(`INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})`)
      .bind(id, ...RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(rates[f]) || 0)))),
    ...rooms.map((r) =>
      c.env.DB.prepare(`INSERT INTO rooms (house_id, name, floor, capacity, price) VALUES (?, ?, ?, ?, ?)`).bind(id, r.name, r.floor, r.capacity, price)
    ),
    c.env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (?, ?)`).bind(owner.id, id),
  ]);
  await assignPayNumbers(c.env.DB);
  await audit(c, actorOf(viewer), 'house_create', id, `owner:${owner.id}, ${rooms.length} phòng`);
  return c.json({ success: true, id, rooms: rooms.length });
});

// ---------------------------------------------------------------------------
// Developer: change a house after it was created. Info and tiện ích, then rooms one at a time.
// A room is never hard-deleted (invoices and payments point to it): it gets deleted_at, and adding
// a room with the same name later brings that row back.
// ---------------------------------------------------------------------------

interface DevRoom { id: number; name: string; floor: number | null; capacity: number; price: number; pay_no: number | null; occupants: number }

async function devHouse(db: D1Database, houseId: string) {
  return db.prepare(`SELECT id, floors FROM houses WHERE id = ?`).bind(houseId).first<{ id: string; floors: number | null }>();
}

const roomOccupants = `(SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status IN ('approved', 'pending') AND r.deleted_at IS NULL)`;

app.get('/api/dev/houses/:houseId', async (c) => {
  const houseId = c.req.param('houseId');
  await assignPayNumbers(c.env.DB, houseId);
  const house = await c.env.DB.prepare(
    `SELECT id, name, abbreviation, address_detail, ward, province, floors, modules, owner_id, pay_no FROM houses WHERE id = ?`
  )
    .bind(houseId)
    .first<Record<string, any>>();
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  const { results: rooms } = await c.env.DB.prepare(
    `SELECT rm.id, rm.name, rm.floor, rm.capacity, rm.price, rm.pay_no, ${roomOccupants} AS occupants
       FROM rooms rm WHERE rm.house_id = ? AND rm.deleted_at IS NULL ORDER BY rm.floor, rm.name`
  )
    .bind(houseId)
    .all<DevRoom>();
  return c.json({ success: true, house: { ...house, modules: houseModules(house.modules, await moduleCatalog(c.env.DB)) }, rooms });
});

/** Name, short name, address, number of floors and tiện ích. The house id never changes. */
app.patch('/api/dev/houses/:houseId', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const house = await devHouse(c.env.DB, houseId);
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);

  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  for (const [key, max] of [['name', 120], ['abbreviation', 20], ['address_detail', 120], ['ward', 120], ['province', 120]] as const) {
    if (!(key in body)) continue;
    const value = String(body[key] ?? '').trim().slice(0, max);
    if ((key === 'name' || key === 'abbreviation') && !value) return fail(c, 400, 'HOUSE_INVALID', 'Tên căn và tên viết tắt không được trống.');
    put(key, key === 'abbreviation' ? value.toUpperCase() : value);
  }
  if ('floors' in body) {
    const floors = Math.round(Number(body.floors));
    if (!(floors >= 1 && floors <= 50)) return fail(c, 400, 'FLOORS_INVALID', 'Số tầng phải từ 1 đến 50.');
    const above = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM rooms WHERE house_id = ? AND deleted_at IS NULL AND floor > ?`)
      .bind(houseId, floors)
      .first<{ n: number }>();
    if (above?.n) return fail(c, 400, 'FLOORS_HAVE_ROOMS', `Còn ${above.n} phòng ở các tầng trên ${floors}. Xoá hoặc chuyển các phòng đó trước.`);
    put('floors', floors);
  }
  if ('modules' in body) put('modules', JSON.stringify(cleanModules(body.modules, await moduleCatalog(c.env.DB))));
  if (!sets.length) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');
  await c.env.DB.prepare(`UPDATE houses SET ${sets.join(', ')} WHERE id = ?`).bind(...values, houseId).run();
  await audit(c, actorOf(viewer), 'house_update', houseId, sets.map((s) => s.split(' ')[0]).join(','));
  return c.json({ success: true });
});

function cleanRoom(input: NewRoom, floors: number) {
  const room = {
    name: String(input?.name ?? '').trim().toUpperCase().slice(0, 20),
    floor: Math.round(Number(input?.floor)),
    capacity: Math.round(Number(input?.capacity)),
  };
  const problem = !room.name
    ? 'Vui lòng nhập tên phòng.'
    : !(room.floor >= 1 && room.floor <= floors)
      ? `Tầng phải từ 1 đến ${floors}.`
      : !(room.capacity >= 1 && room.capacity <= 20)
        ? 'Số người mỗi phòng phải từ 1 đến 20.'
        : '';
  return { room, problem };
}

/** Add rooms. A name that belonged to a deleted room brings that room back with the new floor and size. */
app.post('/api/dev/houses/:houseId/rooms', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const house = await devHouse(c.env.DB, houseId);
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  const body = await c.req.json<{ rooms?: NewRoom[]; price?: number }>().catch(() => ({}) as { rooms?: NewRoom[]; price?: number });
  const floors = house.floors ?? 50;
  const rooms = [];
  for (const input of Array.isArray(body.rooms) ? body.rooms : []) {
    const { room, problem } = cleanRoom(input, floors);
    if (problem) return fail(c, 400, 'ROOMS_INVALID', `${room.name ? `Phòng ${room.name}: ` : ''}${problem}`);
    rooms.push(room);
  }
  if (!rooms.length) return fail(c, 400, 'ROOMS_INVALID', 'Chưa có phòng nào để thêm.');

  const { results: existing } = await c.env.DB.prepare(`SELECT id, name, deleted_at FROM rooms WHERE house_id = ?`)
    .bind(houseId)
    .all<{ id: number; name: string; deleted_at: string | null }>();
  const live = existing.filter((r) => !r.deleted_at);
  if (live.length + rooms.length > MAX_ROOMS_PER_HOUSE) return fail(c, 400, 'ROOMS_INVALID', `Một căn tối đa ${MAX_ROOMS_PER_HOUSE} phòng.`);
  const seen = new Set(live.map((r) => r.name));
  for (const r of rooms) {
    if (seen.has(r.name)) return fail(c, 400, 'ROOMS_DUPLICATE', `Phòng ${r.name} đã có trong căn này.`);
    seen.add(r.name);
  }

  const price = Math.max(0, Math.round(Number(body.price) || 0));
  await c.env.DB.batch(
    rooms.map((r) => {
      const old = existing.find((e) => e.deleted_at && e.name === r.name);
      return old
        ? c.env.DB.prepare(`UPDATE rooms SET deleted_at = NULL, floor = ?, capacity = ? WHERE id = ?`).bind(r.floor, r.capacity, old.id)
        : c.env.DB.prepare(`INSERT INTO rooms (house_id, name, floor, capacity, price) VALUES (?, ?, ?, ?, ?)`).bind(houseId, r.name, r.floor, r.capacity, price);
    })
  );
  await assignPayNumbers(c.env.DB);
  await audit(c, actorOf(viewer), 'rooms_add', houseId, rooms.map((r) => r.name).join(','));
  return c.json({ success: true, added: rooms.length });
});

async function devRoom(db: D1Database, houseId: string, roomId: number) {
  return db
    .prepare(`SELECT rm.id, rm.name, rm.floor, rm.capacity, ${roomOccupants} AS occupants FROM rooms rm WHERE rm.id = ? AND rm.house_id = ? AND rm.deleted_at IS NULL`)
    .bind(roomId, houseId)
    .first<{ id: number; name: string; floor: number | null; capacity: number; occupants: number }>();
}

/** Rename a room, move it to another floor or change how many people it holds. */
app.patch('/api/dev/houses/:houseId/rooms/:roomId', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const house = await devHouse(c.env.DB, houseId);
  const current = house && (await devRoom(c.env.DB, houseId, Number(c.req.param('roomId'))));
  if (!house || !current) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
  const body = await c.req.json<NewRoom>().catch(() => ({}) as NewRoom);
  const { room, problem } = cleanRoom({ name: body.name ?? current.name, floor: body.floor ?? current.floor ?? 1, capacity: body.capacity ?? current.capacity }, house.floors ?? 50);
  if (problem) return fail(c, 400, 'ROOM_INVALID', problem);
  if (room.capacity < current.occupants)
    return fail(c, 400, 'ROOM_TOO_SMALL', `Phòng ${current.name} đang có ${current.occupants} người, không giảm xuống ${room.capacity} được.`);
  if (room.name !== current.name) {
    const clash = await c.env.DB.prepare(`SELECT id, deleted_at FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room.name).first<{ id: number; deleted_at: string | null }>();
    if (clash && !clash.deleted_at) return fail(c, 400, 'ROOMS_DUPLICATE', `Phòng ${room.name} đã có trong căn này.`);
    // A deleted room still holds the name (UNIQUE): free it by renaming the old row.
    if (clash) await c.env.DB.prepare(`UPDATE rooms SET name = ? WHERE id = ?`).bind(`${room.name}~${clash.id}`, clash.id).run();
  }
  await c.env.DB.prepare(`UPDATE rooms SET name = ?, floor = ?, capacity = ? WHERE id = ?`).bind(room.name, room.floor, room.capacity, current.id).run();
  await audit(c, actorOf(viewer), 'room_update', houseId, `${current.name}→${room.name}`);
  return c.json({ success: true });
});

/** Remove a room that nobody lives in. Its past invoices stay. */
app.delete('/api/dev/houses/:houseId/rooms/:roomId', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const room = await devRoom(c.env.DB, houseId, Number(c.req.param('roomId')));
  if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
  if (room.occupants > 0) return fail(c, 400, 'ROOM_OCCUPIED', `Phòng ${room.name} đang có ${room.occupants} người. Chuyển hoặc trả phòng cho họ trước.`);
  await c.env.DB.prepare(`UPDATE rooms SET deleted_at = datetime('now') WHERE id = ?`).bind(room.id).run();
  await audit(c, actorOf(viewer), 'room_delete', houseId, room.name);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Developer: delete a house with a 7-day grace period. During those days the data stays, can be
// downloaded as a backup, and the deletion can be cancelled. The daily cron then removes it for good.
// ---------------------------------------------------------------------------

const DELETE_GRACE_DAYS = 7;

app.post('/api/dev/houses/:houseId/delete', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  if (!(await devHouse(c.env.DB, houseId))) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  const row = await c.env.DB.prepare(
    `UPDATE houses SET status = 'inactive', delete_after = datetime('now', '+${DELETE_GRACE_DAYS} days') WHERE id = ? RETURNING delete_after`
  )
    .bind(houseId)
    .first<{ delete_after: string }>();
  await audit(c, actorOf(viewer), 'house_delete_scheduled', houseId, row!.delete_after);
  return c.json({ success: true, deleteAfter: row!.delete_after });
});

app.post('/api/dev/houses/:houseId/restore', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  if (!(await devHouse(c.env.DB, houseId))) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  await c.env.DB.prepare(`UPDATE houses SET status = 'active', delete_after = NULL WHERE id = ?`).bind(houseId).run();
  await audit(c, actorOf(viewer), 'house_delete_cancelled', houseId);
  return c.json({ success: true });
});

/**
 * Everything D1 holds for one house, as JSON. Passwords are left out; CCCD numbers stay encrypted
 * with CCCD_KEY (only the last 4 digits are readable), so the file can be restored into D1 later.
 */
app.get('/api/dev/houses/:houseId/backup', async (c) => {
  const viewer = c.get('viewer');
  const houseId = c.req.param('houseId');
  const db = c.env.DB;
  const house = await db.prepare(`SELECT * FROM houses WHERE id = ?`).bind(houseId).first();
  if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
  const all = (sql: string) => db.prepare(sql).bind(houseId).all().then((r) => r.results);
  const [rates, rooms, residents, managers, meters, invoices, payments, notifications] = await Promise.all([
    all(`SELECT * FROM house_rates WHERE house_id = ?`),
    all(`SELECT * FROM rooms WHERE house_id = ?`),
    all(`SELECT id, house_id, room_id, full_name, gender, phone, cccd_enc, cccd_last4, email, dob, address_detail, ward, province,
                status, move_in_date, move_out_date, created_at, deleted_at FROM residents WHERE house_id = ?`),
    all(`SELECT s.id, s.full_name, s.phone, s.role, s.status FROM staff s JOIN staff_houses sh ON sh.staff_id = s.id WHERE sh.house_id = ?`),
    all(`SELECT * FROM meter_readings WHERE house_id = ?`),
    all(`SELECT * FROM invoices WHERE house_id = ?`),
    all(`SELECT * FROM payments WHERE house_id = ?`),
    all(`SELECT * FROM notifications WHERE house_id = ?`),
  ]);
  await audit(c, actorOf(viewer), 'house_backup', houseId);
  return c.json({
    success: true,
    backup: { format: 'tro-hub-house-backup/1', exportedAt: new Date().toISOString(), house, rates, rooms, residents, managers, meters, invoices, payments, notifications },
  });
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

// ---------------------------------------------------------------------------
// Phí dịch vụ Trọ Hub: the Developer bills each landlord once a month (rooms × tiện ích prices) and
// is paid by bank transfer into the Developer's own SePay account. SePay calls the webhook below;
// the invoice code in the transfer content tells which invoice was paid. Rent never passes here.
// ---------------------------------------------------------------------------

const BILLING_KEYS = ['billing_bank_bin', 'billing_bank_name', 'billing_account_no', 'billing_account_name', 'sepay_key_sha256'] as const;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function billingSettings(db: D1Database) {
  const { results } = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${BILLING_KEYS.map(() => '?').join(',')})`)
    .bind(...BILLING_KEYS)
    .all<{ key: string; value: string }>();
  const get = (k: (typeof BILLING_KEYS)[number]) => results.find((r) => r.key === k)?.value ?? '';
  return {
    bankBin: get('billing_bank_bin'),
    bankName: get('billing_bank_name'),
    accountNo: get('billing_account_no'),
    accountName: get('billing_account_name'),
    keySha: get('sepay_key_sha256'),
  };
}

/** This month in Vietnam, 'YYYY-MM'. */
const vnMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);

/** 'TH' + 6 letters/digits without look-alikes (0/O, 1/I). */
function invoiceCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `TH${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** What each landlord owes for a month: every active house they own (not waiting to be deleted). */
async function landlordFees(db: D1Database) {
  const catalog = await moduleCatalog(db);
  const { results } = await db.prepare(
    `SELECT s.id AS owner_id, h.id, h.name, h.modules,
            (SELECT COUNT(*) FROM rooms rm WHERE rm.house_id = h.id AND rm.deleted_at IS NULL) AS rooms
       FROM staff s JOIN staff_houses sh ON sh.staff_id = s.id JOIN houses h ON h.id = sh.house_id
      WHERE s.role = 'owner' AND s.status = 'active' AND h.delete_after IS NULL`
  ).all<{ owner_id: number; id: string; name: string; modules: string | null; rooms: number }>();
  const byOwner = new Map<number, { houses: { id: string; name: string; rooms: number; fee: number }[]; total: number }>();
  for (const h of results) {
    const fee = h.rooms * monthlyPerRoom(houseModules(h.modules, catalog), catalog);
    const entry = byOwner.get(h.owner_id) ?? { houses: [], total: 0 };
    entry.houses.push({ id: h.id, name: h.name, rooms: h.rooms, fee });
    entry.total += fee;
    byOwner.set(h.owner_id, entry);
  }
  return byOwner;
}

interface SepayTransfer {
  id?: number | string;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  content?: string;
  description?: string;
  transferType?: string;
  transferAmount?: number;
  referenceCode?: string;
}

/**
 * Records one SePay transfer and marks the invoice whose code appears in the content as paid once the
 * money received for it reaches the amount. The same SePay id twice is ignored.
 */
async function processServiceTransfer(db: D1Database, t: SepayTransfer, simulated: boolean, keepUnmatched = true) {
  if (t.transferType && t.transferType !== 'in') return { matched: false, ignored: 'outgoing' as const };
  const amount = Math.round(Number(t.transferAmount) || 0);
  const sepayId = t.id != null ? String(t.id) : null;
  if (sepayId && (await db.prepare(`SELECT 1 FROM service_payments WHERE sepay_id = ?`).bind(sepayId).first()))
    return { matched: false, ignored: 'duplicate' as const };

  // Banks add, drop or split spaces, so look for each open invoice code in the content squashed to A–Z0–9.
  const squashed = `${t.content ?? ''} ${t.description ?? ''}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { results: open } = await db.prepare(`SELECT id, code, amount FROM service_invoices WHERE status = 'unpaid'`).all<{ id: number; code: string; amount: number }>();
  const invoice = open.find((i) => squashed.includes(i.code)) ?? null;
  // The shared webhook logs every transfer in sepay_events; here only fee payments are kept.
  if (!invoice && !keepUnmatched) return { matched: false };

  await db.prepare(
    `INSERT INTO service_payments (sepay_id, invoice_id, amount, content, account_no, gateway, reference, paid_at, simulated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sepayId, invoice?.id ?? null, amount, String(t.content ?? '').slice(0, 300), t.accountNumber ?? null, t.gateway ?? null,
      t.referenceCode ?? null, t.transactionDate ?? new Date().toISOString(), simulated ? 1 : 0)
    .run();
  if (!invoice) return { matched: false };

  const paid = await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM service_payments WHERE invoice_id = ?`).bind(invoice.id).first<{ total: number }>();
  const settled = (paid?.total ?? 0) >= invoice.amount;
  if (settled) await db.prepare(`UPDATE service_invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).bind(invoice.id).run();
  return { matched: true, code: invoice.code, settled, received: paid?.total ?? 0, due: invoice.amount };
}

/** "G01-T11-2026", "G01T112026", "LVCLVC101-T11-2026" (how the app writes rent transfers) → room and month. */

// ---------------------------------------------------------------------------
// Mã thanh toán tiền trọ XXXPPPMMYYYY: số căn (3 số), số phòng (3 số), tháng, năm.
// Số căn cấp một lần và không dùng lại (đếm ở settings.house_pay_seq). Số phòng: tên phòng là 1–3 chữ số
// thì dùng luôn (101 → 101), tên có chữ thì lấy phần số nếu còn trống (G01 → 1, A12 → 12), còn lại số trống nhỏ nhất.
// ---------------------------------------------------------------------------

const pad3 = (n: number) => String(n).padStart(3, '0');

export function rentPayCode(housePayNo: number, roomPayNo: number, month: string /* YYYY-MM */) {
  return `${pad3(housePayNo)}${pad3(roomPayNo)}${month.slice(5, 7)}${month.slice(0, 4)}`;
}

/** Gives every house and room without a number one. Safe to call often: it does nothing when all have one. */
async function assignPayNumbers(db: D1Database, houseId?: string) {
  const houses = await db.prepare(`SELECT id FROM houses WHERE pay_no IS NULL ORDER BY created_at, id`).all<{ id: string }>();
  if (houses.results.length) {
    const seq = await db.prepare(`SELECT value FROM settings WHERE key = 'house_pay_seq'`).first<{ value: string }>();
    const max = await db.prepare(`SELECT COALESCE(MAX(pay_no), 0) AS n FROM houses`).first<{ n: number }>();
    let next = Math.max(Number(seq?.value ?? 0), max?.n ?? 0);
    const stmts = houses.results.map((h) => db.prepare(`UPDATE houses SET pay_no = ? WHERE id = ? AND pay_no IS NULL`).bind(++next, h.id));
    if (next > 999) throw new Error('Đã hết số căn (tối đa 999).');
    stmts.push(
      db.prepare(`INSERT INTO settings (key, value) VALUES ('house_pay_seq', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
        .bind(String(next))
    );
    await db.batch(stmts);
  }

  const pending = await db.prepare(
    `SELECT DISTINCT house_id FROM rooms WHERE pay_no IS NULL ${houseId ? 'AND house_id = ?' : ''}`
  ).bind(...(houseId ? [houseId] : [])).all<{ house_id: string }>();
  for (const { house_id } of pending.results) {
    // Deleted rooms keep their number, so an old code never points at a different room.
    const { results: rooms } = await db.prepare(`SELECT id, name, pay_no FROM rooms WHERE house_id = ? ORDER BY id`)
      .bind(house_id)
      .all<{ id: number; name: string; pay_no: number | null }>();
    const taken = new Set(rooms.filter((r) => r.pay_no != null).map((r) => r.pay_no!));
    const todo = rooms.filter((r) => r.pay_no == null);
    const wish = (name: string) => {
      const digits = /^\d{1,3}$/.test(name) ? name : (name.match(/\d+/g) ?? []).join('');
      const n = Number(digits);
      return digits && digits.length <= 3 && n >= 1 ? n : null;
    };
    const stmts: D1PreparedStatement[] = [];
    // Pure numeric names first, so room 1 is not taken by G01 before room "1" asks for it.
    const ordered = [...todo.filter((r) => /^\d{1,3}$/.test(r.name)), ...todo.filter((r) => !/^\d{1,3}$/.test(r.name))];
    const late: typeof todo = [];
    for (const r of ordered) {
      const w = wish(r.name);
      if (w && !taken.has(w)) { taken.add(w); stmts.push(db.prepare(`UPDATE rooms SET pay_no = ? WHERE id = ?`).bind(w, r.id)); }
      else late.push(r);
    }
    let free = 1;
    for (const r of late) {
      while (taken.has(free)) free++;
      if (free > 999) throw new Error(`Căn ${house_id} đã hết số phòng (tối đa 999).`);
      taken.add(free);
      stmts.push(db.prepare(`UPDATE rooms SET pay_no = ? WHERE id = ?`).bind(free, r.id));
    }
    if (stmts.length) await db.batch(stmts);
  }
}

/**
 * Finds XXXPPPMMYYYY in a transfer memo. Tries the memo as written, then with spaces/dots/dashes between
 * digits removed (some banks split long numbers). A candidate counts only when that house and room exist,
 * and, for a transfer reported by a landlord's own SePay, only among that landlord's houses.
 */
async function findPayCode(db: D1Database, text: string, ownerId: number | null) {
  const squashed = text.replace(/(\d)[\s.\-]+(?=\d)/g, '$1');
  for (const source of [text, squashed]) {
    for (const m of source.matchAll(/(?<!\d)(\d{3})(\d{3})(0[1-9]|1[0-2])(20\d{2})(?!\d)/g)) {
      const row = await db.prepare(
        `SELECT h.id AS house_id, rm.name AS room FROM houses h JOIN rooms rm ON rm.house_id = h.id AND rm.pay_no = ?
          WHERE h.pay_no = ? ${ownerId != null ? 'AND h.owner_id = ?' : ''}`
      )
        .bind(Number(m[2]), Number(m[1]), ...(ownerId != null ? [ownerId] : []))
        .first<{ house_id: string; room: string }>();
      if (row) return { houseId: row.house_id, room: row.room, month: `${m[4]}-${m[3]}`, code: m[0] };
    }
  }
  return null;
}

export function parseRentCode(content: string): { lvc: boolean; room: string; month: string } | null {
  const m = String(content ?? '').toUpperCase()
    .match(/(?:^|[^A-Z0-9])((?:LVC)*)-?([A-Z]?\d{2,4}[A-Z]?)[-\s.]?T(1[0-2]|0?[1-9])[-\s.]?(20\d{2})(?!\d)/);
  if (!m) return null;
  return { lvc: Boolean(m[1]), room: m[2], month: `${m[4]}-${m[3].padStart(2, '0')}` };
}

/** Which house a rent transfer belongs to: LVC by its prefix, otherwise the one house paid into that account that has the room. */
async function houseForRent(db: D1Database, rent: { lvc: boolean; room: string }, accountNo: string | undefined, ownerId: number | null) {
  if (rent.lvc) return 'LVC';
  // Old-style codes carry no house number: guess only when exactly one house fits, never across landlords,
  // and never a house that did not declare the account the money arrived in.
  if (ownerId == null && !accountNo) return null;
  const { results } = await db.prepare(
    `SELECT DISTINCT h.id FROM houses h JOIN rooms rm ON rm.house_id = h.id AND rm.deleted_at IS NULL AND rm.name = ?
      WHERE h.delete_after IS NULL
        AND (? IS NULL OR h.owner_id = ?)
        AND (? IS NOT NULL OR h.bank_account_no = ?)`
  )
    .bind(rent.room, ownerId, ownerId, ownerId, accountNo ?? '')
    .all<{ id: string }>();
  return results.length === 1 ? results[0].id : null;
}

/**
 * The one SePay webhook. In SePay set the URL to /api/sepay/webhook and the auth to "API Key"; SePay then
 * sends "Authorization: Apikey <key>" (only the key's SHA-256 is stored). Each SePay transaction is handled
 * once: a service-fee code settles that invoice; a rent code is recorded with its house, room and month
 * (marking rent paid comes when rent moves to D1); everything else is just logged.
 */
async function forwardToExpress(env: Env, body: SepayTransfer) {
  const origin = (env.EXPRESS_ORIGIN || 'https://tro-hub.onrender.com').replace(/\/+$/, '');
  await fetch(`${origin}/api/sepay/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch((err) => console.warn('[sepay] forward laundry', err));
}

async function sepayWebhook(c: Context<App>) {
  const { keySha } = await billingSettings(c.env.DB);
  const sent = (c.req.header('Authorization') ?? '').replace(/^Apikey\s+/i, '').trim();
  const sentSha = sent ? await sha256Hex(sent) : '';
  // The Developer's own webhook, one Trọ Hub created on a landlord's SePay account through OAuth,
  // or one the landlord made by hand with the key Trọ Hub gave them.
  const landlord = sentSha && sentSha !== keySha
    ? await c.env.DB.prepare(
        `SELECT owner_id FROM sepay_connections WHERE webhook_key_sha256 = ?1
         UNION ALL SELECT owner_id FROM sepay_manual_webhooks WHERE key_sha256 = ?1 LIMIT 1`
      ).bind(sentSha).first<{ owner_id: number }>()
    : null;
  if (landlord)
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE sepay_manual_webhooks SET last_event_at = datetime('now') WHERE key_sha256 = ?`).bind(sentSha).run()
    );
  if (!sentSha || (sentSha !== keySha && !landlord)) {
    await audit(c, 'anonymous', 'sepay_webhook_rejected');
    return c.json({ success: false, error: 'Sai API key.' }, 401);
  }
  const body = await c.req.json<SepayTransfer>().catch(() => null);
  if (!body) return c.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, 400);
  if (body.transferType && body.transferType !== 'in') return c.json({ success: true, ignored: 'outgoing' });

  const sepayId = String(body.id ?? `noid-${body.referenceCode ?? Date.now()}`);
  if (await c.env.DB.prepare(`SELECT 1 FROM sepay_events WHERE sepay_id = ?`).bind(sepayId).first())
    return c.json({ success: true, ignored: 'duplicate' });

  const text = `${body.content ?? ''} ${body.description ?? ''}`;
  // Service fees are paid into the Developer's account only, so a landlord's webhook never settles an invoice.
  const service = landlord ? { matched: false } : await processServiceTransfer(c.env.DB, { ...body, id: sepayId }, false, false);
  const ownerId = landlord?.owner_id ?? null;
  const payCode = service.matched ? null : await findPayCode(c.env.DB, text, ownerId);
  const oldCode = service.matched || payCode ? null : parseRentCode(text);
  const rent = payCode ?? (oldCode ? { room: oldCode.room, month: oldCode.month } : null);
  const laundry = !service.matched && !rent && /(?:^|[^A-Z0-9])(MG|MS)\d{1,2}(?![0-9])/.test(text.toUpperCase());
  const kind = service.matched ? 'service' : rent ? 'rent' : laundry ? 'laundry' : 'none';
  const houseId = payCode ? payCode.houseId : oldCode ? await houseForRent(c.env.DB, oldCode, body.accountNumber, ownerId) : null;

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO sepay_events (sepay_id, kind, amount, content, account_no, house_id, room, month, paid_at, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sepayId, kind, Math.round(Number(body.transferAmount) || 0), String(body.content ?? '').slice(0, 300), body.accountNumber ?? null,
      houseId, rent?.room ?? null, rent?.month ?? null, body.transactionDate ?? null, landlord?.owner_id ?? null)
    .run();
  const settled = rent && houseId ? await settleRent(c.env, houseId, rent.room, rent.month, body, sepayId) : null;
  // Giặt sấy vẫn chạy trên Express: chuyển nguyên giao dịch sang đó.
  if (laundry) c.executionCtx.waitUntil(forwardToExpress(c.env, body));
  return c.json({ success: true, kind, ...(service.matched ? service : {}), ...(rent ? { houseId, room: rent.room, month: rent.month, rent: settled } : {}) });
}

app.post('/api/sepay/webhook', sepayWebhook);

// ── Cổng thanh toán SePay: chủ trọ trả phí dịch vụ bằng thẻ / chuyển khoản / NAPAS VietQR ──

/** The pay link of a fee invoice. Public: the invoice code is the secret, as it is on the bank-transfer QR. */
app.get('/pay/service/:code', async (c) => {
  if (!pgConfigured(c.env)) return c.html(page('Chưa mở thanh toán online', 'Trọ Hub chưa cài Cổng thanh toán SePay. Vui lòng chuyển khoản theo mã QR trên hoá đơn.'), 503);
  const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const inv = await c.env.DB.prepare(
    `SELECT i.code, i.month, i.amount, i.status, i.owner_id,
            (SELECT COALESCE(SUM(p.amount), 0) FROM service_payments p WHERE p.invoice_id = i.id) AS received
       FROM service_invoices i WHERE i.code = ?`
  )
    .bind(code)
    .first<{ code: string; month: string; amount: number; status: string; owner_id: number; received: number }>();
  if (!inv) return c.html(page('Không tìm thấy hoá đơn', 'Link không đúng. Vui lòng hỏi lại Trọ Hub.'), 404);
  if (inv.status === 'paid') return c.html(page('Hoá đơn đã thanh toán', `Hoá đơn ${inv.code} đã được thanh toán. Cảm ơn bạn!`));
  const due = inv.amount - inv.received;
  const [y, m] = inv.month.split('-');
  return c.html(
    await checkoutPage(c.env, {
      amount: due,
      orderNumber: pgOrderNumber(inv.code),
      description: `Phi Tro Hub thang ${Number(m)}/${y} ${inv.code}`,
      customerId: `OWNER${inv.owner_id}`,
      returnBase: new URL(c.req.url).origin,
    })
  );
});

app.get('/pay/done', (c) => {
  const r = c.req.query('r');
  if (r === 'success')
    return c.html(page('Đã thanh toán', 'SePay đã nhận thanh toán. Hoá đơn sẽ chuyển sang "Đã thanh toán" trong giây lát. Bạn có thể đóng trang này.'));
  if (r === 'cancel') return c.html(page('Đã huỷ thanh toán', 'Bạn đã huỷ. Có thể mở lại link hoá đơn để thanh toán bất cứ lúc nào.'));
  return c.html(page('Thanh toán chưa thành công', 'Giao dịch bị lỗi hoặc bị từ chối. Vui lòng thử lại, hoặc chuyển khoản theo mã QR trên hoá đơn.'));
});

/** SePay's IPN. Only an approved, captured payment settles the invoice; repeats are recorded once. */
app.post('/api/sepay/pg/ipn', async (c) => {
  const secret = c.env.SEPAY_PG_IPN_SECRET;
  if (!secret || !sameSecret(c.req.header('X-Secret-Key') ?? '', secret)) {
    await audit(c, 'anonymous', 'sepay_pg_ipn_rejected');
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json<PgIpn>().catch(() => null);
  if (!body) return c.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, 400);
  const paid = paidFromIpn(body);
  if (!paid.ok) return c.json({ success: true, ignored: paid.reason });
  const result = await processServiceTransfer(c.env.DB, {
    id: paid.id,
    gateway: `SePay PG ${paid.method}`,
    content: `${paid.invoiceCode} ${paid.orderNumber}`,
    transferType: 'in',
    transferAmount: paid.amount,
    referenceCode: paid.orderNumber,
    transactionDate: paid.date ?? undefined,
  }, false);
  return c.json({ success: true, ...result });
});
// Same handler under the first name the Developer page showed.
app.post('/api/sepay/service-webhook', sepayWebhook);

app.get('/api/dev/billing', async (c) => {
  const s = await billingSettings(c.env.DB);
  const month = c.req.query('month') || vnMonth();
  const { results: invoices } = await c.env.DB.prepare(
    `SELECT i.id, i.owner_id, i.month, i.amount, i.code, i.detail, i.status, i.paid_at, s.full_name, s.phone,
            (SELECT COALESCE(SUM(p.amount), 0) FROM service_payments p WHERE p.invoice_id = i.id) AS received
       FROM service_invoices i JOIN staff s ON s.id = i.owner_id WHERE i.month = ? ORDER BY s.full_name`
  )
    .bind(month)
    .all<Record<string, any>>();
  const { results: payments } = await c.env.DB.prepare(
    `SELECT p.id, p.amount, p.content, p.paid_at, p.simulated, p.created_at, i.code, s.full_name
       FROM service_payments p LEFT JOIN service_invoices i ON i.id = p.invoice_id LEFT JOIN staff s ON s.id = i.owner_id
      ORDER BY p.id DESC LIMIT 20`
  ).all();
  const { results: events } = await c.env.DB.prepare(
    `SELECT e.sepay_id, e.kind, e.amount, e.content, e.house_id, e.room, e.month, e.paid_at, e.created_at, s.full_name AS landlord
       FROM sepay_events e LEFT JOIN staff s ON s.id = e.owner_id ORDER BY e.created_at DESC, e.rowid DESC LIMIT 30`
  ).all();
  const fees = await landlordFees(c.env.DB);
  const billed = new Set(invoices.map((i) => i.owner_id));
  const unbilled = [...fees].filter(([id, f]) => f.total > 0 && !billed.has(id)).length;
  return c.json({
    success: true,
    month,
    settings: {
      bankBin: s.bankBin, bankName: s.bankName, accountNo: s.accountNo, accountName: s.accountName,
      keySet: Boolean(s.keySha),
      webhookUrl: `${new URL(c.req.url).origin}/api/sepay/webhook`,
    },
    gateway: {
      configured: pgConfigured(c.env),
      live: pgLive(c.env),
      ipnUrl: `${new URL(c.req.url).origin}/api/sepay/pg/ipn`,
      payBase: `${new URL(c.req.url).origin}/pay/service/`,
    },
    invoices: invoices.map((i) => ({ ...i, detail: i.detail ? JSON.parse(i.detail) : [] })),
    payments,
    events,
    unbilled,
  });
});

/** The account landlords pay into, and the SePay API key (send an empty key to keep the current one). */
app.put('/api/dev/billing/settings', async (c) => {
  const body = await c.req.json<{ bankBin?: string; accountNo?: string; accountName?: string; apiKey?: string }>().catch(() => ({}) as Record<string, string>);
  const accountNo = String(body.accountNo ?? '').replace(/\s/g, '');
  if (!/^[0-9A-Za-z]{6,19}$/.test(accountNo)) return fail(c, 400, 'ACCOUNT_INVALID', 'Số tài khoản phải có 6–19 chữ số.');
  const bank = (await vietQrBanks()).find((b) => b.bin === String(body.bankBin ?? ''));
  if (!bank) return fail(c, 400, 'BANK_INVALID', 'Vui lòng chọn ngân hàng trong danh sách.');
  const apiKey = String(body.apiKey ?? '').trim();
  if (apiKey && apiKey.length < 8) return fail(c, 400, 'KEY_INVALID', 'API key quá ngắn.');

  const values: [string, string][] = [
    ['billing_bank_bin', bank.bin],
    ['billing_bank_name', bank.shortName],
    ['billing_account_no', accountNo],
    ['billing_account_name', String(body.accountName ?? '').trim().toUpperCase().slice(0, 60)],
  ];
  if (apiKey) values.push(['sepay_key_sha256', await sha256Hex(apiKey)]);
  await c.env.DB.batch(values.map(([k, v]) =>
    c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).bind(k, v)
  ));
  await audit(c, actorOf(c.get('viewer')), 'billing_settings', null, `${bank.shortName} ****${accountNo.slice(-4)}${apiKey ? ', key' : ''}`);
  return c.json({ success: true });
});

/** One invoice per landlord for the month, from today's rooms and prices. Landlords already billed are skipped. */
app.post('/api/dev/billing/invoices', async (c) => {
  const body = await c.req.json<{ month?: string }>().catch(() => ({}) as { month?: string });
  const month = String(body.month || vnMonth());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(c, 400, 'MONTH_INVALID', 'Tháng không hợp lệ.');
  const fees = await landlordFees(c.env.DB);
  const { results: done } = await c.env.DB.prepare(`SELECT owner_id FROM service_invoices WHERE month = ?`).bind(month).all<{ owner_id: number }>();
  const billed = new Set(done.map((d) => d.owner_id));
  const rows = [...fees].filter(([id, f]) => f.total > 0 && !billed.has(id));
  if (!rows.length) return c.json({ success: true, created: 0 });
  await c.env.DB.batch(rows.map(([ownerId, f]) =>
    c.env.DB.prepare(`INSERT INTO service_invoices (owner_id, month, amount, code, detail) VALUES (?, ?, ?, ?, ?)`)
      .bind(ownerId, month, f.total, invoiceCode(), JSON.stringify(f.houses))
  ));
  await audit(c, actorOf(c.get('viewer')), 'service_invoices_create', null, `${month}: ${rows.length}`);
  return c.json({ success: true, created: rows.length });
});

/** Runs the webhook logic with a made-up SePay transfer, to try the whole flow without real money. */
app.post('/api/dev/billing/simulate', async (c) => {
  const body = await c.req.json<{ invoiceId?: number; amount?: number }>().catch(() => ({}) as { invoiceId?: number; amount?: number });
  const invoice = await c.env.DB.prepare(`SELECT id, code, amount FROM service_invoices WHERE id = ?`).bind(Number(body.invoiceId)).first<{ id: number; code: string; amount: number }>();
  if (!invoice) return fail(c, 404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hoá đơn.');
  const s = await billingSettings(c.env.DB);
  const result = await processServiceTransfer(c.env.DB, {
    id: `SIM-${Date.now()}`,
    gateway: s.bankName || 'SIMULATED',
    accountNumber: s.accountNo,
    content: `CT TU NGUOI THU ${invoice.code} THANH TOAN PHI TRO HUB`,
    transferType: 'in',
    transferAmount: Number(body.amount) > 0 ? Math.round(Number(body.amount)) : invoice.amount,
    referenceCode: `SIM${Date.now()}`,
    transactionDate: new Date(Date.now() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 19),
  }, true);
  await audit(c, actorOf(c.get('viewer')), 'service_payment_simulated', null, invoice.code);
  return c.json({ success: true, ...result });
});

/** The Tiện ích tools a staff member can open: every tool that at least one of their houses uses. */
app.use('/api/modules', requireAuth, staffOnly);
app.get('/api/modules', async (c) => {
  const viewer = c.get('viewer');
  const catalog = await moduleCatalog(c.env.DB);
  const ids = viewer.kind === 'staff' ? viewer.houseIds : [];
  if (!ids.length || isDeveloper(viewer)) return c.json({ success: true, modules: catalog.map((m) => m.key) });
  const { results } = await c.env.DB.prepare(`SELECT modules FROM houses WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ modules: string | null }>();
  const keys = new Set(results.flatMap((h) => houseModules(h.modules, catalog)));
  return c.json({ success: true, modules: catalog.filter((m) => keys.has(m.key)).map((m) => m.key) });
});


// ---------------------------------------------------------------------------
// SePay OAuth2: a landlord links their own SePay account. The Developer makes the consent link and
// sends it to the landlord (or opens it on the landlord's device); the landlord signs in to SePay
// and agrees. Trọ Hub then reads their bank accounts and creates its webhook on their account.
// ---------------------------------------------------------------------------

type SepayConnRow = { owner_id: number; company: string | null; bank_accounts: string | null; webhook_id: string | null; connected_at: string; updated_at: string };

const sepayStatus = (row: SepayConnRow | null) =>
  row
    ? { connected: true, company: row.company, bankAccounts: JSON.parse(row.bank_accounts || '[]'), webhookId: row.webhook_id, since: row.connected_at, updatedAt: row.updated_at }
    : { connected: false };

async function ownerExists(db: D1Database, id: number) {
  return Boolean(await db.prepare(`SELECT 1 FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first());
}

app.get('/api/dev/sepay', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT owner_id, company, bank_accounts, webhook_id, connected_at, updated_at FROM sepay_connections`
  ).all<SepayConnRow>();
  const manual = await c.env.DB.prepare(`SELECT owner_id, key_hint, created_at, last_event_at FROM sepay_manual_webhooks`).all<ManualRow>();
  const origin = new URL(c.req.url).origin;
  return c.json({
    success: true,
    configured: sepayConfigured(c.env),
    redirectUri: sepayRedirectUri(origin),
    webhookUrl: sepayWebhookUrl(c),
    connections: Object.fromEntries(results.map((r) => [r.owner_id, sepayStatus(r)])),
    manual: Object.fromEntries(manual.results.map((r) => [r.owner_id, manualStatus(r)])),
  });
});

// ── Webhook tự tạo: chủ trọ dán URL + API key Trọ Hub cấp vào my.sepay.vn của họ (không cần OAuth) ──

type ManualRow = { owner_id: number; key_hint: string; created_at: string; last_event_at: string | null };
const manualStatus = (r: ManualRow) => ({ keyHint: r.key_hint, createdAt: r.created_at, lastEventAt: r.last_event_at });
const sepayWebhookUrl = (c: Context<App>) => `${(c.env.SEPAY_WEBHOOK_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '')}/api/sepay/webhook`;

/** A new key for this landlord's hand-made webhook. The old key stops working at once; the new one is shown only here. */
app.post('/api/dev/landlords/:id/sepay/manual-key', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = 'th_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const row = await c.env.DB.prepare(
    `INSERT INTO sepay_manual_webhooks (owner_id, key_sha256, key_hint) VALUES (?, ?, ?)
     ON CONFLICT (owner_id) DO UPDATE SET key_sha256 = excluded.key_sha256, key_hint = excluded.key_hint,
       created_at = datetime('now'), last_event_at = NULL
     RETURNING owner_id, key_hint, created_at, last_event_at`
  )
    .bind(id, await sha256Hex(key), key.slice(-4))
    .first<ManualRow>();
  await audit(c, actorOf(c.get('viewer')), 'sepay_manual_key', null, `staff:${id}`);
  return c.json({ success: true, key, webhookUrl: sepayWebhookUrl(c), manual: manualStatus(row!) });
});

app.post('/api/dev/landlords/:id/sepay/manual-key/delete', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(`DELETE FROM sepay_manual_webhooks WHERE owner_id = ?`).bind(id).run();
  await audit(c, actorOf(c.get('viewer')), 'sepay_manual_key_delete', null, `staff:${id}`);
  return c.json({ success: true });
});

app.post('/api/dev/landlords/:id/sepay/connect-url', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  try {
    const url = await sepayConnectUrl(c.env, new URL(c.req.url).origin, id);
    await audit(c, actorOf(c.get('viewer')), 'sepay_connect_link', null, `staff:${id}`);
    return c.json({ success: true, url, expiresInMinutes: 30 });
  } catch (e: any) {
    return fail(c, 400, 'SEPAY_NOT_CONFIGURED', e.message);
  }
});

app.post('/api/dev/landlords/:id/sepay/sync', async (c) => {
  const id = Number(c.req.param('id'));
  try {
    await syncSepay(c.env, new URL(c.req.url).origin, id);
    const row = await c.env.DB.prepare(`SELECT * FROM sepay_connections WHERE owner_id = ?`).bind(id).first<SepayConnRow>();
    return c.json({ success: true, sepay: sepayStatus(row) });
  } catch (e: any) {
    return fail(c, 400, 'SEPAY_ERROR', e.message);
  }
});

app.post('/api/dev/landlords/:id/sepay/disconnect', async (c) => {
  const id = Number(c.req.param('id'));
  try {
    const r = await disconnectSepay(c.env, id);
    await audit(c, actorOf(c.get('viewer')), 'sepay_disconnect', null, `staff:${id}`);
    return c.json({ success: true, ...r });
  } catch (e: any) {
    return fail(c, 400, 'SEPAY_ERROR', e.message);
  }
});

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

app.get('/api/sepay/oauth/callback', async (c) => {
  const ownerId = await checkSepayState(c.env, c.req.query('state') ?? '');
  const code = c.req.query('code');
  if (c.req.query('error')) return c.html(page('Chưa kết nối SePay', 'Bạn đã không đồng ý cấp quyền. Có thể đóng trang này.'), 400);
  if (!ownerId || !code) return c.html(page('Không kết nối được', 'Link đã hết hạn hoặc không hợp lệ. Vui lòng xin link mới.'), 400);
  const origin = new URL(c.req.url).origin;
  try {
    await finishSepayConnect(c.env, origin, code, ownerId);
    await audit(c, `staff:${ownerId}`, 'sepay_connect');
  } catch (e: any) {
    return c.html(page('Không kết nối được', escapeHtml(String(e.message))), 400);
  }
  try {
    const r = await syncSepay(c.env, origin, ownerId);
    const list = r.bankAccounts.map((a) => `${escapeHtml(a.bank)} ••${escapeHtml(a.last4)}`).join(', ') || 'chưa có tài khoản ngân hàng nào';
    return c.html(page('Đã kết nối SePay', `Trọ Hub sẽ nhận thông báo tiền vào từ: <b>${list}</b>. Tiền vẫn vào thẳng tài khoản của bạn. Bạn có thể đóng trang này.`));
  } catch (e: any) {
    return c.html(page('Đã kết nối SePay', `Đã cấp quyền, nhưng chưa đọc được tài khoản ngân hàng: ${escapeHtml(String(e.message))}. Developer sẽ đồng bộ lại sau.`));
  }
});

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.'));

const DAILY_CRON = '0 19 * * *';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === DAILY_CRON) ctx.waitUntil(purgeDeletedHouses(env.DB));
    // Mỗi 10 phút: đọc lại số tiền tháng này và tháng trước từ Sheet cũ.
    const month = currentMonth();
    ctx.waitUntil(Promise.all([month, previousMonth(month)].map((m) => syncMonthFromSheet(env.DB, m).catch((err) => console.warn('[cron] sheet sync', m, err)))));
  },
} satisfies ExportedHandler<Env>;
