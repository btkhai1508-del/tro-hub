import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { hashPassword, normalizePhone, verifyPassword } from './password.ts';
import { requireAuth, registerAuth } from './routes/auth.ts';
import { checkState, connectUrl, finishConnect, googleKey, sheetsApi } from './google.ts';
import {
  currentMonth, ensureMonthFresh, fromSheetMonth, legacyRoomCode, legacySheet, paintSheetPayment, parseLegacyRoom, previousMonth,
  saveScriptGate, scriptGates, sheetMonths, syncMonthFromSheet, toSheetMonth,
} from './sheetSync.ts';
import { decryptText } from './cccd.ts';
import { checkSepayState, disconnectSepay, finishSepayConnect, sepayConfigured, sepayConnectUrl, sepayRedirectUri, syncSepay } from './sepayOauth.ts';
import {
  actorOf, audit, developerOnly, fail, isDeveloper, isOwner, ownerOnly, requireHouse, staffOnly,
  type App, type Env, type StaffRole, type Viewer,
} from './app.ts';
import { TenantLockedError } from './tenant/route.ts';
import { registerHouses, assignHousePayNumbers, assignRoomPayNumbers, houseModules, moduleCatalog, monthlyPerRoom } from './routes/houses.ts';
import { page, registerIntegrations, vietQrBanks } from './routes/integrations.ts';

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

/** Every landlord with their houses, room and resident counts. */
app.get('/api/dev/landlords', async (c) => {
  await assignHousePayNumbers(c.env);
  await assignRoomPayNumbers(c.env.DB);
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
/**
 * Edit a landlord: name, phone (their login), email, or lock / unlock. A locked landlord is signed out
 * at once (the Worker reads D1 on every request). Only the fields sent change.
 */
app.patch('/api/dev/landlords/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status?: string; fullName?: string; phone?: string; email?: string }>().catch(() => ({}) as Record<string, string>);
  const target = await c.env.DB.prepare(`SELECT id, phone FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first<{ id: number; phone: string }>();
  if (!target) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (body.status !== undefined) {
    if (!['active', 'locked'].includes(String(body.status))) return fail(c, 400, 'STATUS_INVALID', 'Trạng thái không hợp lệ.');
    sets.push('status = ?'); values.push(String(body.status));
  }
  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) return fail(c, 400, 'LANDLORD_INVALID', 'Vui lòng nhập họ tên.');
    sets.push('full_name = ?'); values.push(fullName);
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone));
    if (!/^0\d{9}$/.test(phone)) return fail(c, 400, 'LANDLORD_INVALID', 'Số điện thoại phải có 10 số.');
    if (phone !== target.phone) {
      const taken = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE phone = ? AND id <> ? UNION SELECT 1 FROM residents WHERE phone = ? AND deleted_at IS NULL`)
        .bind(phone, id, phone)
        .first();
      if (taken) return fail(c, 400, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');
    }
    sets.push('phone = ?'); values.push(phone);
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(c, 400, 'EMAIL_INVALID', 'Email không hợp lệ.');
    sets.push('email = ?'); values.push(email || null);
  }
  if (!sets.length) return fail(c, 400, 'NOTHING_TO_CHANGE', 'Không có gì để cập nhật.');

  await c.env.DB.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
  const action = body.status === 'locked' ? 'landlord_lock' : body.status === 'active' ? 'landlord_unlock' : 'landlord_edit';
  await audit(c, actorOf(viewer), action, null, `owner:${id}`);
  return c.json({ success: true });
});

/** Readable temporary password: no 0/O or 1/l/I, so it can be read out over the phone. */
function temporaryPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Reset a landlord's password when they forget it or it may have leaked. Every session they have
 * is signed out. The new password is returned once, to pass on to them.
 */
app.post('/api/dev/landlords/:id/reset-password', async (c) => {
  const viewer = c.get('viewer');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  const target = await c.env.DB.prepare(`SELECT id FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first();
  if (!target) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  const chosen = String(body.password ?? '').trim();
  if (chosen && chosen.length < 6) return fail(c, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu mới phải có ít nhất 6 ký tự');
  const password = chosen || temporaryPassword();
  await c.env.DB.prepare(`UPDATE staff SET password_hash = ?, password_changed_at = ? WHERE id = ?`)
    .bind(await hashPassword(password), Math.floor(Date.now() / 1000), id)
    .run();
  await audit(c, actorOf(viewer), 'landlord_reset_password', null, `owner:${id}`);
  return c.json({ success: true, password });
});

/**
 * Delete a landlord who has no house and was never billed (for example one created by mistake).
 * Anyone with houses or fee invoices is kept for the records: lock them instead.
 */
app.post('/api/dev/landlords/:id/delete', async (c) => {
  const viewer = c.get('viewer');
  const id = Number(c.req.param('id'));
  const target = await c.env.DB.prepare(`SELECT id, full_name FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first<{ id: number; full_name: string }>();
  if (!target) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
  const houses = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM houses WHERE owner_id = ? OR id IN (SELECT house_id FROM staff_houses WHERE staff_id = ?)`)
    .bind(id, id)
    .first<{ n: number }>();
  if (houses?.n) return fail(c, 400, 'LANDLORD_HAS_HOUSES', 'Chủ trọ còn căn trọ. Xoá hoặc chuyển các căn trước, hoặc bấm Khoá.');
  const billed = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM service_invoices WHERE owner_id = ?`).bind(id).first<{ n: number }>();
  if (billed?.n) return fail(c, 400, 'LANDLORD_HAS_INVOICES', 'Chủ trọ đã có hoá đơn phí, cần giữ lại để đối soát. Hãy bấm Khoá thay vì xoá.');

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM sepay_manual_webhooks WHERE owner_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM sepay_connections WHERE owner_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM staff_houses WHERE staff_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE staff SET created_by = NULL WHERE created_by = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM staff WHERE id = ?`).bind(id),
  ]);
  await audit(c, actorOf(viewer), 'landlord_delete', null, `owner:${id} ${target.full_name}`);
  return c.json({ success: true });
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
async function forwardToExpress(env: Env, body: SepayTransfer, authorization: string) {
  const origin = (env.EXPRESS_ORIGIN || 'https://tro-hub.onrender.com').replace(/\/+$/, '');
  // Express checks the same SePay API key (SEPAY_WEBHOOK_KEY on Render), so the header goes along.
  await fetch(`${origin}/api/sepay/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) })
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
  if (laundry) c.executionCtx.waitUntil(forwardToExpress(c.env, body, c.req.header('Authorization') ?? ''));
  return c.json({ success: true, kind, ...(service.matched ? service : {}), ...(rent ? { houseId, room: rent.room, month: rent.month, rent: settled } : {}) });
}

app.post('/api/sepay/webhook', sepayWebhook);

/**
 * SePay's QR image (vietqr.app) with a CORS header, so the app can turn it into a PNG to save.
 * Only the QR parameters pass through and only that one host is fetched: this is not an open proxy.
 */
app.get('/qr.png', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const acc = q.get('acc') ?? '';
  const bank = q.get('bank') ?? '';
  if (!/^[A-Za-z0-9]{4,30}$/.test(acc) || !/^[A-Za-z0-9]{2,20}$/.test(bank)) return fail(c, 400, 'QR_INVALID', 'Thiếu số tài khoản hoặc ngân hàng.');
  const out = new URLSearchParams({ acc, bank });
  const amount = q.get('amount');
  if (amount && /^\d{1,12}$/.test(amount)) out.set('amount', amount);
  const des = q.get('des');
  if (des) out.set('des', des.slice(0, 100));
  const template = q.get('template');
  if (template && ['qronly', 'compact'].includes(template)) out.set('template', template);
  const res = await fetch(`https://vietqr.app/img?${out}`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit).catch(() => null);
  if (!res || !res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return c.json({ success: false, errorCode: 'QR_UPSTREAM', error: 'Chưa tạo được mã QR.' }, 502);
  return new Response(res.body, {
    headers: { 'Content-Type': res.headers.get('content-type')!, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
  });
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
    ctx.waitUntil(Promise.all([month, previousMonth(month)].map((m) => syncMonthFromSheet(env.DB, m).catch((err) => console.warn('[cron] sheet sync', m, err)))));
  },
} satisfies ExportedHandler<Env>;
