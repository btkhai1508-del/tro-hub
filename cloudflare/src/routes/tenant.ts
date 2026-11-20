/**
 * Resident accounts on the Worker: public registration (always pending), the staff screen that
 * approves, rejects and deletes them, and a resident editing their own profile.
 *
 * Write order everywhere: the central resident index first (it hands out the id and claims the
 * phone), the landlord's store second, the index row released again if the store refuses. A delete
 * goes the other way round: store first, index row after, so a failure never leaves a phone free
 * while its row still exists.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, fail, staffOnly, type App } from '../app.ts';
import { isWorkerSource } from '../billing/source.ts';
import { ensureDraftForRoom } from '../billing/invoices.ts';
import { encryptText, hashCccd } from '../cccd.ts';
import { allHouses, houseDir, PhoneTakenError, releaseResident, reserveResident, residentRoute } from '../central/directory.ts';
import { REGISTER_LIMITS, registerHit } from '../loginLimit.ts';
import { hashPassword, normalizePhone } from '../password.ts';
import { enqueueExport } from '../sheetExport.ts';
import { legacyRoomCode } from '../sheetSync.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantFor, tenantOfOwner } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';
import { refreshCounts } from './houses.ts';

const PHONE_TAKEN = 'Số điện thoại này đã có tài khoản.';
const OCCUPYING = `('approved', 'pending')`;

/** "01/06/2026" for the current day in Vietnam, and for a stored UTC timestamp. */
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
function dmy(utc: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(utc ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "P.101", "Phòng 101" and "101" are the same room. */
const roomKey = (name: unknown) => String(name ?? '').trim().toUpperCase().replace(/^(P\.|P\s+|PHÒNG\s+)/i, '').trim();

interface RoomRow { id: number; name: string; capacity: number; occupants: number }

/** A room of the house with how many approved or pending residents it holds (not counting `except`). */
async function roomOf(db: TenantDb, houseId: string, by: { id: number } | { name: string }, except = 0): Promise<RoomRow | null> {
  const { results } = await db
    .prepare(
      `SELECT rm.id, rm.name, rm.capacity,
              (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status IN ${OCCUPYING} AND r.deleted_at IS NULL AND r.id <> ?) AS occupants
         FROM rooms rm WHERE rm.house_id = ? AND rm.deleted_at IS NULL`
    )
    .bind(except, houseId)
    .all<RoomRow>();
  return 'id' in by ? (results.find((r) => r.id === by.id) ?? null) : (results.find((r) => roomKey(r.name) === roomKey(by.name)) ?? null);
}

interface AccountRow { id: number; house_id: string; room_id: number | null; full_name: string; phone: string | null; status: string }

/**
 * The resident a staff request names: `residentId` (or the `sheet-<id>` the list hands out), else the
 * phone. The house is checked against the caller before anything is read from the store.
 */
async function findAccount(c: Context<App>, body: Record<string, unknown>) {
  const rawId = Number(String(body.residentId ?? body.id ?? '').replace(/^sheet-/, ''));
  const phone = normalizePhone(String(body.phone ?? ''));
  const route = Number.isInteger(rawId) && rawId > 0 ? await residentRoute(c.env.DB, { id: rawId }) : phone.length >= 9 ? await residentRoute(c.env.DB, { phone }) : null;
  if (!route) return null;
  const db = await tenantFor(c, route.house_id);
  const row = await db
    .prepare(`SELECT id, house_id, room_id, full_name, phone, status FROM residents WHERE id = ? AND deleted_at IS NULL`)
    .bind(route.resident_id)
    .first<AccountRow>();
  return { route, db, row };
}

/** Room code as the Sheet writes it (LVC-101), '' when the resident has no room. */
async function roomCode(db: TenantDb, houseId: string, roomId: number | null | undefined): Promise<string> {
  if (!roomId) return '';
  const r = await db.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(roomId).first<{ name: string }>();
  return r ? legacyRoomCode(houseId, r.name) : '';
}

const accountNotFound = (c: Context<App>) => fail(c, 404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.');

export function registerTenantAccounts(app: Hono<App>): void {
  // -------------------------------------------------------------------------
  // Registration: public, always pending until staff approve.
  // -------------------------------------------------------------------------
  app.post('/api/auth/register', async (c) => {
    // Public and unauthenticated: while the Sheet owns the data this route does not exist (Express registers into the Sheet).
    if (!(await isWorkerSource(c.env.DB))) return fail(c, 404, 'NOT_FOUND', 'Không tìm thấy.');
    const body = await c.req
      .json<{ name?: string; phone?: string; email?: string; gender?: string; password?: string; roomNumber?: string; roomId?: number; houseId?: string }>()
      .catch(() => ({}) as Record<string, never>);
    const name = String(body.name ?? '').trim();
    const phone = normalizePhone(body.phone ?? '');
    const password = String(body.password ?? '');
    const roomName = String(body.roomNumber ?? '').trim();
    const roomId = Number(body.roomId);
    if (!name || !/^0\d{9}$/.test(phone) || password.length < 6 || (!roomName && !(roomId > 0)))
      return fail(c, 400, 'REGISTER_INVALID', 'Vui lòng điền đầy đủ họ tên, số điện thoại 10 số, phòng và mật khẩu từ 6 ký tự.');

    // Throttle the public route (only well-formed attempts count): 5 per IP per hour, 3 per phone per day.
    const ip = c.req.header('CF-Connecting-IP');
    const withinLimit =
      (!ip || (await registerHit(c.env.DB, 'reg_ip', ip, REGISTER_LIMITS.ip.max, REGISTER_LIMITS.ip.windowSec))) &&
      (await registerHit(c.env.DB, 'reg_phone', phone, REGISTER_LIMITS.phone.max, REGISTER_LIMITS.phone.windowSec));
    if (!withinLimit) return fail(c, 429, 'REGISTER_LIMIT', 'Bạn đã gửi đăng ký quá nhiều lần. Vui lòng thử lại sau hoặc liên hệ quản lý.');

    // The house: the one asked for, or the only active house there is.
    let dir = body.houseId ? await houseDir(c.env.DB, String(body.houseId)) : null;
    if (!body.houseId) {
      const active = (await allHouses(c.env.DB)).filter((h) => h.status === 'active');
      dir = active.length === 1 ? active[0] : null;
      if (!dir) return fail(c, 400, 'HOUSE_REQUIRED', 'Vui lòng chọn nhà trọ.');
    }
    if (!dir || dir.status !== 'active') return fail(c, 400, 'HOUSE_INVALID', 'Không tìm thấy nhà trọ này.');

    const db = await tenantOfOwner(c.env, dir.owner_id);
    const room = await roomOf(db, dir.house_id, roomId > 0 ? { id: roomId } : { name: roomName });
    if (!room) return fail(c, 400, 'ROOM_INVALID', 'Không tìm thấy phòng này trong nhà trọ.');
    // Accounts waiting for approval count towards the room's capacity.
    if (room.occupants >= room.capacity)
      return fail(c, 400, 'ROOM_FULL', `Phòng ${room.name} đã đủ ${room.capacity} người. Vui lòng liên hệ BQL nếu bạn cần chuyển vào phòng này.`);

    let id: number;
    try {
      id = await reserveResident(c.env.DB, { phone, ownerId: dir.owner_id, houseId: dir.house_id });
    } catch (e) {
      if (e instanceof PhoneTakenError) return fail(c, 400, 'PHONE_TAKEN', PHONE_TAKEN);
      throw e;
    }
    try {
      await db
        .prepare(`INSERT INTO residents (id, house_id, room_id, full_name, gender, phone, password_hash, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .bind(id, dir.house_id, room.id, name, String(body.gender ?? '').trim() || null, phone, await hashPassword(password), String(body.email ?? '').trim() || null)
        .run();
    } catch (e) {
      await releaseResident(c.env.DB, id).catch(() => {});
      throw e;
    }
    await audit(c, 'anonymous', 'register', dir.house_id, `resident:${id}`);
    // The password is never exported (only its hash exists here); the Sheet row is created without one.
    await enqueueExport(c.env.DB, 'register_account', {
      houseId: dir.house_id, name, phone, email: String(body.email ?? '').trim(), gender: String(body.gender ?? '').trim(),
      password: '', room: legacyRoomCode(dir.house_id, room.name), approved: false,
    });
    return c.json({ success: true, approved: false, joinedAt: today() });
  });

  // -------------------------------------------------------------------------
  // Accounts screen (staff). The list is scoped to the houses of the caller.
  // -------------------------------------------------------------------------
  for (const path of ['/api/admin/accounts', '/api/admin/accounts/*']) {
    app.use(path, requireAuth);
    app.use(path, staffOnly);
  }

  app.get('/api/admin/accounts', async (c) => {
    const viewer = c.get('viewer');
    if (viewer.kind !== 'staff') return fail(c, 403, 'STAFF_ONLY', 'Chỉ quản lý mới dùng được chức năng này.');
    const accounts: Record<string, unknown>[] = [];
    for (const houseId of viewer.houseIds) {
      const db = await tenantFor(c, houseId);
      const { results } = await db
        .prepare(
          `SELECT r.id, r.house_id, r.room_id, r.full_name, r.gender, r.phone, r.email, r.status, r.created_at, rm.name AS room_name
             FROM residents r LEFT JOIN rooms rm ON rm.id = r.room_id
            WHERE r.house_id = ? AND r.deleted_at IS NULL AND r.status <> 'moved_out' ORDER BY r.id DESC`
        )
        .bind(houseId)
        .all<{ id: number; house_id: string; room_id: number | null; full_name: string; gender: string | null; phone: string | null; email: string | null; status: string; created_at: string; room_name: string | null }>();
      for (const r of results) {
        accounts.push({
          // `sheet-` keeps the screen that still tells Sheet rows from device-only rows by this prefix working.
          id: `sheet-${r.id}`,
          name: r.full_name,
          gender: r.gender ?? '',
          phone: r.phone ?? '',
          email: r.email ?? '',
          roomNumber: r.room_name ?? '',
          createdAt: dmy(r.created_at),
          status: r.status === 'pending' ? 'pending' : r.status === 'approved' ? 'approved' : 'rejected',
          isAdmin: false,
          residentId: r.id,
          houseId: r.house_id,
          roomId: r.room_id,
        });
      }
    }
    const order: Record<string, number> = { pending: 0, rejected: 1, approved: 2 };
    accounts.sort((a, b) => order[a.status as string] - order[b.status as string] || (b.residentId as number) - (a.residentId as number));
    return c.json({ success: true, accounts });
  });

  app.post('/api/admin/accounts/status', async (c) => {
    const viewer = c.get('viewer');
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const status = String(body.status ?? '');
    if (!['pending', 'approved', 'rejected'].includes(status)) return fail(c, 400, 'STATUS_INVALID', 'Trạng thái không hợp lệ.');
    const found = await findAccount(c, body);
    if (!found?.row) return accountNotFound(c);
    const { route, db, row } = found;

    let roomId = row.room_id;
    if (status === 'approved') {
      // An approved resident lives in a room: the one they registered for, or the one staff pick now.
      const room = Number(body.roomId) > 0
        ? await roomOf(db, row.house_id, { id: Number(body.roomId) }, row.id)
        : row.room_id
          ? await roomOf(db, row.house_id, { id: row.room_id }, row.id)
          : String(body.room ?? '').trim()
            ? await roomOf(db, row.house_id, { name: String(body.room) }, row.id)
            : null;
      if (!room) {
        const asked = Number(body.roomId) > 0 || String(body.room ?? '').trim();
        return asked ? fail(c, 400, 'ROOM_INVALID', 'Vui lòng chọn phòng của nhà này.') : fail(c, 400, 'ROOM_REQUIRED', 'Cần chọn phòng trước khi duyệt tài khoản.');
      }
      if (row.status !== 'approved' && room.occupants >= room.capacity) return fail(c, 400, 'ROOM_FULL', `Phòng ${room.name} đã đủ ${room.capacity} người.`);
      roomId = room.id;
      await db
        .prepare(`UPDATE residents SET status = 'approved', room_id = ?, move_in_date = COALESCE(move_in_date, ?), move_out_date = NULL WHERE id = ?`)
        .bind(roomId, today(), row.id)
        .run();
    } else {
      await db.prepare(`UPDATE residents SET status = ? WHERE id = ?`).bind(status, row.id).run();
    }
    await refreshCounts(c.env, db, row.house_id);
    if (status === 'approved' && roomId) await ensureDraftForRoom(c.env, route.owner_id, row.house_id, roomId).catch((err) => console.warn('[tenant] draft for room', err));
    await audit(c, actorOf(viewer), `account_${status}`, row.house_id, `resident:${row.id}`);
    await enqueueExport(c.env.DB, 'update_account_status', {
      houseId: row.house_id, phone: row.phone ?? '', name: row.full_name, room: await roomCode(db, row.house_id, roomId), status,
    });
    return c.json({ success: true });
  });

  app.post('/api/admin/accounts/delete', async (c) => {
    const viewer = c.get('viewer');
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const mode = body.mode;
    if (mode !== 'account' && mode !== 'resident') return fail(c, 400, 'DELETE_MODE_INVALID', 'Thao tác xoá không hợp lệ.');
    const found = await findAccount(c, body);
    if (!found) return accountNotFound(c);
    const { route, db, row } = found;
    if (!row && mode === 'resident') return accountNotFound(c);

    if (mode === 'resident') {
      // Out of the room, account kept: the person can no longer sign in, the phone stays theirs.
      await db.prepare(`UPDATE residents SET status = 'moved_out', move_out_date = ? WHERE id = ?`).bind(today(), row!.id).run();
    } else {
      // Store first, then the index row; a retry after a failed release finds no row and only releases.
      // The phone leaves the store row too (it is UNIQUE there) so the number can register again.
      if (row) await db.prepare(`UPDATE residents SET deleted_at = datetime('now'), phone = NULL WHERE id = ?`).bind(row.id).run();
      await releaseResident(c.env.DB, route.resident_id);
    }
    await refreshCounts(c.env, db, route.house_id);
    if (row) await enqueueExport(c.env.DB, 'delete_resident', { houseId: route.house_id, phone: row.phone ?? '', name: row.full_name, room: await roomCode(db, route.house_id, row.room_id), mode });
    await audit(c, actorOf(viewer), mode === 'account' ? 'account_delete' : 'account_remove_from_room', route.house_id, `resident:${route.resident_id}`);
    return c.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // A resident edits their own profile. Phone, password, status, room and house are not editable here.
  // -------------------------------------------------------------------------
  app.use('/api/profile/*', requireAuth);
  app.post('/api/profile/update', async (c) => {
    const viewer = c.get('viewer');
    if (viewer.kind !== 'resident') return fail(c, 403, 'RESIDENT_ONLY', 'Chỉ cư dân mới sửa được hồ sơ cá nhân.');
    const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);
    const text = (...values: unknown[]) => {
      const v = values.find((x) => x !== undefined && x !== null);
      return v === undefined ? undefined : String(v).trim();
    };

    const route = await residentRoute(c.env.DB, { id: viewer.id });
    if (!route) return fail(c, 401, 'AUTH_SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    const db = await tenantOfOwner(c.env, route.owner_id);
    const current = await db.prepare(`SELECT phone FROM residents WHERE id = ? AND deleted_at IS NULL`).bind(viewer.id).first<{ phone: string | null }>();
    if (!current) return fail(c, 401, 'AUTH_SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

    // The phone is the identity (login, index, billing): the screen sends it back unchanged, anything else is refused.
    const sentPhone = normalizePhone(String(body.phone ?? ''));
    if (sentPhone && sentPhone !== normalizePhone(current.phone ?? ''))
      return fail(c, 400, 'PHONE_LOCKED', 'Số điện thoại là tên đăng nhập nên chưa đổi được ở đây. Vui lòng liên hệ quản lý.');

    const fields: Record<string, string | undefined> = {
      full_name: text(body.name),
      email: text(body.email),
      dob: text(body.dob),
      gender: text(body.gender),
      address_detail: text(body.address),
      plate_number: text(body.plateNumber, body.vehicle?.plateNumber),
      vehicle_type: text(body.vehicleType, body.vehicle?.type),
      emergency_name: text(body.emergencyName, body.emergencyContact?.name),
      emergency_phone: text(body.emergencyPhone, body.emergencyContact?.phone),
      emergency_relation: text(body.emergencyRelation, body.emergencyContact?.relationship),
    };
    if (fields.full_name === '') return fail(c, 400, 'NAME_REQUIRED', 'Vui lòng nhập họ và tên.');

    const sets: string[] = [];
    const values: (string | null)[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(column === 'full_name' ? value : value || null);
    }

    // CCCD: encrypted like everywhere else; an empty value is "not filled in", never "erase".
    const cccd = String(body.cccd ?? body.citizenId ?? '').replace(/\s/g, '');
    if (cccd) {
      if (!/^\d{9,12}$/.test(cccd)) return fail(c, 400, 'CCCD_INVALID', 'Số CCCD phải gồm 9 đến 12 chữ số.');
      const hash = await hashCccd(cccd, c.env.CCCD_KEY);
      const dup = await db.prepare(`SELECT id FROM residents WHERE cccd_hash = ? AND id <> ?`).bind(hash, viewer.id).first();
      if (dup) return fail(c, 400, 'CCCD_TAKEN', 'Số CCCD này đã được dùng cho một tài khoản khác.');
      sets.push('cccd_enc = ?', 'cccd_last4 = ?', 'cccd_hash = ?');
      values.push(await encryptText(cccd, c.env.CCCD_KEY), cccd.slice(-4), hash);
    }

    if (sets.length) await db.prepare(`UPDATE residents SET ${sets.join(', ')} WHERE id = ?`).bind(...values, viewer.id).run();
    await audit(c, actorOf(viewer), 'profile_update', viewer.houseId, `resident:${viewer.id}`);
    // Same parameters as Express' update_profile; the CCCD is not copied into the queue (personal data).
    const mine = await db.prepare(`SELECT house_id, room_id FROM residents WHERE id = ?`).bind(viewer.id).first<{ house_id: string; room_id: number | null }>();
    if (mine) {
      await enqueueExport(c.env.DB, 'update_profile', {
        houseId: mine.house_id, room: await roomCode(db, mine.house_id, mine.room_id), currentPhone: normalizePhone(current.phone ?? ''),
        name: body.name || '', phone: body.phone || '', plateNumber: body.plateNumber || body.vehicle?.plateNumber || '',
        email: body.email || '', dob: body.dob || '', gender: body.gender || '', address: body.address || '',
        vehicleType: body.vehicleType || body.vehicle?.type || 'Xe máy', emergencyName: body.emergencyName || body.emergencyContact?.name || '',
        emergencyPhone: body.emergencyPhone || body.emergencyContact?.phone || '', emergencyRelation: body.emergencyRelation || body.emergencyContact?.relationship || '',
      });
    }
    const { cccd: _c, citizenId: _z, ...profile } = body;
    return c.json({ success: true, message: 'Đã lưu thông tin cá nhân', profile });
  });
}
