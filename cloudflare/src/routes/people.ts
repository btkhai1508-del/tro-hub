/**
 * Residents, staff and landlords. Staff and landlord accounts are central rows in the shared D1; a
 * resident is a row of their landlord's store plus a row of the central resident index, which gives
 * the id and keeps phones unique across both. Creating a resident reserves the index row first and
 * releases it again if the store refuses.
 */
import type { Hono } from 'hono';
import { actorOf, audit, fail, isOwner, staffOnly, type App, type StaffRole, type Viewer } from '../app.ts';
import { newOwnerBackend, ownerHouses, phoneTaken, PhoneTakenError, releaseResident, reserveResident, setStorage } from '../central/directory.ts';
import { hashPassword, normalizePhone } from '../password.ts';
import { tenantFor, tenantOfOwner } from '../tenant/route.ts';
import { houseModules, moduleCatalog, monthlyPerRoom, refreshCounts } from './houses.ts';
import { requireAuth } from './auth.ts';

const ROLE_LABEL: Record<StaffRole, string> = { developer: 'Developer', owner: 'Admin Tổng', manager: 'Admin căn' };
const PHONE_TAKEN = 'Số điện thoại này đã có tài khoản.';

/** Which roles this viewer may create or edit, and on which houses. */
function staffScope(v: Viewer): { roles: StaffRole[]; houseIds: string[] } | null {
  return isOwner(v) && v.kind === 'staff' ? { roles: ['manager'], houseIds: v.houseIds } : null;
}

async function staffHouses(db: D1Database, staffId: number) {
  const { results } = await db.prepare(`SELECT house_id FROM staff_houses WHERE staff_id = ?`).bind(staffId).all<{ house_id: string }>();
  return results.map((r) => r.house_id);
}

/** Readable temporary password: no 0/O or 1/l/I, so it can be read out over the phone. */
function temporaryPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export function registerPeople(app: Hono<App>): void {
  // -------------------------------------------------------------------------
  // Staff accounts. Admin Tổng creates and locks Admin căn for their own houses.
  // -------------------------------------------------------------------------
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
    if (await phoneTaken(c.env.DB, phone)) return fail(c, 400, 'PHONE_TAKEN', PHONE_TAKEN);

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
    const houseId = String(c.req.param('houseId'));
    const body = await c.req.json<{ fullName?: string; phone?: string; password?: string; email?: string; gender?: string; roomId?: number }>()
      .catch(() => ({}) as Record<string, never>);
    const fullName = String(body.fullName ?? '').trim();
    const phone = normalizePhone(body.phone ?? '');
    const password = String(body.password ?? '');
    if (!fullName || !/^0\d{9}$/.test(phone)) return fail(c, 400, 'RESIDENT_INVALID', 'Vui lòng nhập họ tên và số điện thoại 10 số.');
    if (password.length < 6) return fail(c, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu phải có ít nhất 6 ký tự');

    const db = await tenantFor(c, houseId);
    const room = await db.prepare(
      `SELECT rm.id, rm.name, rm.capacity,
              (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status IN ('approved', 'pending') AND r.deleted_at IS NULL) AS occupants
         FROM rooms rm WHERE rm.id = ? AND rm.house_id = ? AND rm.deleted_at IS NULL`
    )
      .bind(Number(body.roomId), houseId)
      .first<{ id: number; name: string; capacity: number; occupants: number }>();
    if (!room) return fail(c, 400, 'ROOM_INVALID', 'Vui lòng chọn phòng của nhà này.');
    if (room.occupants >= room.capacity)
      return fail(c, 400, 'ROOM_FULL', `Phòng ${room.name} đã đủ ${room.capacity} người.`);

    // Index first (it gives the id and claims the phone), store second, index row released if the store refuses.
    const ownerId = (await c.env.DB.prepare(`SELECT owner_id FROM house_directory WHERE house_id = ?`).bind(houseId).first<{ owner_id: number }>())!.owner_id;
    let id: number;
    try {
      id = await reserveResident(c.env.DB, { phone, ownerId, houseId });
    } catch (e) {
      if (e instanceof PhoneTakenError) return fail(c, 400, 'PHONE_TAKEN', PHONE_TAKEN);
      throw e;
    }
    try {
      await db.prepare(
        `INSERT INTO residents (id, house_id, room_id, full_name, gender, phone, password_hash, email, status, move_in_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', strftime('%d/%m/%Y', 'now', '+7 hours'))`
      )
        .bind(id, houseId, room.id, fullName, String(body.gender ?? '').trim() || null, phone, await hashPassword(password), String(body.email ?? '').trim() || null)
        .run();
    } catch (e) {
      await releaseResident(c.env.DB, id).catch(() => {});
      throw e;
    }
    await refreshCounts(c.env, db, houseId);
    await audit(c, actorOf(viewer), 'resident_create', houseId, `resident:${id}`);
    return c.json({ success: true, id, room: room.name });
  });

  // -------------------------------------------------------------------------
  // Landlords (Developer only; /api/dev/* is guarded in registerHouses).
  // -------------------------------------------------------------------------

  /** Every landlord with their houses, room and resident counts (from the directory; no store is needed for the counters). */
  app.get('/api/dev/landlords', async (c) => {
    const { results: owners } = await c.env.DB.prepare(
      `SELECT id, full_name, phone, email, status, created_at FROM staff WHERE role = 'owner' ORDER BY created_at DESC, id DESC`
    ).all<{ id: number; full_name: string; phone: string; email: string | null; status: string; created_at: string }>();
    const { results: houses } = await c.env.DB.prepare(
      `SELECT d.house_id AS id, d.name, d.status, d.delete_after, d.pay_no, d.modules, d.room_count, d.resident_count, d.owner_id
         FROM house_directory d JOIN staff s ON s.id = d.owner_id AND s.role = 'owner'`
    ).all<Record<string, any>>();
    // Descriptive fields (abbreviation, address, floors, created_at) are not in the directory: read them
    // from each landlord's store in one query, and leave them blank when the store cannot answer.
    const detail = new Map<string, Record<string, any>>();
    for (const ownerId of new Set(houses.map((h) => h.owner_id as number))) {
      try {
        const db = await tenantOfOwner(c.env, ownerId);
        const { results } = await db.prepare(`SELECT id, abbreviation, address_detail, ward, province, floors, created_at FROM houses`).all<Record<string, any>>();
        for (const r of results) detail.set(r.id, r);
      } catch {
        /* the list still works from the directory alone */
      }
    }
    const rows = houses
      .map((h) => {
        const d = detail.get(h.id);
        return {
          id: h.id,
          name: h.name,
          abbreviation: d?.abbreviation ?? '',
          address_detail: d?.address_detail ?? '',
          ward: d?.ward ?? '',
          province: d?.province ?? '',
          floors: d?.floors ?? null,
          modules: h.modules,
          status: h.status,
          delete_after: h.delete_after,
          created_at: d?.created_at ?? '',
          pay_no: h.pay_no,
          room_count: h.room_count,
          resident_count: h.resident_count,
          owner_id: h.owner_id,
        };
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name));
    const catalog = await moduleCatalog(c.env.DB);
    const landlords = owners.map((o) => ({
      ...o,
      houses: rows
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
    if (await phoneTaken(c.env.DB, phone)) return fail(c, 400, 'PHONE_TAKEN', PHONE_TAKEN);

    const created = await c.env.DB.prepare(
      `INSERT INTO staff (full_name, phone, password_hash, role, email, created_by) VALUES (?, ?, ?, 'owner', ?, ?) RETURNING id`
    )
      .bind(fullName, phone, await hashPassword(password), email || null, viewer.id)
      .first<{ id: number }>();
    // A new landlord starts on the backend the Developer chose for new landlords (their store is empty, so no move is needed).
    await setStorage(c.env.DB, created!.id, await newOwnerBackend(c.env.DB));
    await audit(c, actorOf(viewer), 'landlord_create', null, `owner:${created!.id}`);
    return c.json({ success: true, id: created!.id });
  });

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
      if (phone !== target.phone && (await phoneTaken(c.env.DB, phone, { staffId: id }))) return fail(c, 400, 'PHONE_TAKEN', PHONE_TAKEN);
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
   * Anyone with houses or invoices is kept for the records: lock them instead.
   */
  app.post('/api/dev/landlords/:id/delete', async (c) => {
    const viewer = c.get('viewer');
    const id = Number(c.req.param('id'));
    const target = await c.env.DB.prepare(`SELECT id, full_name FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first<{ id: number; full_name: string }>();
    if (!target) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const linked = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_houses WHERE staff_id = ?`).bind(id).first<{ n: number }>();
    if ((await ownerHouses(c.env.DB, id)).length || linked?.n)
      return fail(c, 400, 'LANDLORD_HAS_HOUSES', 'Chủ trọ còn căn trọ. Xoá hoặc chuyển các căn trước, hoặc bấm Khoá.');
    // Rent invoices live in the landlord's own store; fee invoices (service_invoices) are central.
    const rent = await (await tenantOfOwner(c.env, id)).prepare(`SELECT COUNT(*) AS n FROM invoices WHERE house_id IN (SELECT id FROM houses WHERE owner_id = ?)`).bind(id).first<{ n: number }>();
    const billed = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM service_invoices WHERE owner_id = ?`).bind(id).first<{ n: number }>();
    if (rent?.n || billed?.n) return fail(c, 400, 'LANDLORD_HAS_INVOICES', 'Chủ trọ đã có hoá đơn phí, cần giữ lại để đối soát. Hãy bấm Khoá thay vì xoá.');

    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM sepay_manual_webhooks WHERE owner_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM sepay_connections WHERE owner_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM staff_houses WHERE staff_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM tenant_storage WHERE owner_id = ?`).bind(id),
      c.env.DB.prepare(`UPDATE staff SET created_by = NULL WHERE created_by = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM staff WHERE id = ?`).bind(id),
    ]);
    await audit(c, actorOf(viewer), 'landlord_delete', null, `owner:${id} ${target.full_name}`);
    return c.json({ success: true });
  });
}
