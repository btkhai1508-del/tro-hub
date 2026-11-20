/**
 * Houses and rooms. A house exists in two places: its row in the central directory (name, status,
 * payment number, modules, counters) and its data in the landlord's store. Every write goes to the
 * directory first, then the store, then the counters.
 */
import type { Context, Hono } from 'hono';
import { feeConfigFor } from '../billing/fees.ts';
import { recomputeDrafts } from '../billing/invoices.ts';
import { currentMonth } from '../sheetSync.ts';
import { normalizePhone } from '../password.ts';
import {
  actorOf, audit, developerOnly, fail, isDeveloper, isOwner, requireHouse, staffOnly, type App, type Env,
} from '../app.ts';
import {
  allocateHousePayNo, houseDir, houseOwner, removeHouseDir, setHouseCounts, upsertHouseDir, type HouseDir,
} from '../central/directory.ts';
import { TenantLockedError, tenantFor, tenantOfOwner } from '../tenant/route.ts';
import type { TenantDb, TenantStatement } from '../tenant/db.ts';
import type { SqlValue } from '../tenant/schema.ts';
import { vietQrBanks } from './integrations.ts';
import { requireAuth } from './auth.ts';

const HOUSE_FIELDS = ['name', 'abbreviation', 'address_detail', 'ward', 'province', 'landlord_name', 'landlord_phone'] as const;
const BANK_FIELDS = ['bank_name', 'bank_code', 'bank_account_no', 'bank_account_name'] as const;
const RATE_FIELDS = ['electricity_per_kwh', 'water_per_m3', 'trash', 'internet', 'parking'] as const;
const MAX_ROOMS_PER_HOUSE = 500;
const DELETE_GRACE_DAYS = 7;

// ---------------------------------------------------------------------------
// Tiện ích: the admin tools a house pays for, priced per room per month. Core tools are always on.
// ---------------------------------------------------------------------------

export interface ServiceModule { key: string; label: string; price_per_room: number; core: number }

export async function moduleCatalog(db: D1Database): Promise<ServiceModule[]> {
  const { results } = await db.prepare(`SELECT key, label, price_per_room, core FROM service_modules ORDER BY sort, key`).all<ServiceModule>();
  return results;
}

/** The tools a house uses. NULL (houses from before tiện ích existed) means every tool. */
export function houseModules(stored: string | null, catalog: ServiceModule[]): string[] {
  if (stored == null) return catalog.map((m) => m.key);
  const picked = new Set(JSON.parse(stored) as string[]);
  return catalog.filter((m) => m.core || picked.has(m.key)).map((m) => m.key);
}

/** Known keys only, core tools always included. */
function cleanModules(input: unknown, catalog: ServiceModule[]): string[] {
  const picked = new Set(Array.isArray(input) ? input.map(String) : []);
  return catalog.filter((m) => m.core || picked.has(m.key)).map((m) => m.key);
}

export const monthlyPerRoom = (keys: string[], catalog: ServiceModule[]) =>
  catalog.filter((m) => keys.includes(m.key)).reduce((sum, m) => sum + m.price_per_room, 0);

// ---------------------------------------------------------------------------
// Payment numbers XXXPPPMMYYYY: house numbers live in the directory (never reissued), room numbers in
// the landlord's store. The store's houses.pay_no is kept equal to the directory's.
// ---------------------------------------------------------------------------

/** Copies a house's directory number into its landlord's store when they differ; a locked store is retried on the next call. */
async function syncStorePayNo(env: Env, ownerId: number, houseId: string, payNo: number): Promise<void> {
  try {
    const db = await tenantOfOwner(env, ownerId);
    const row = await db.prepare(`SELECT pay_no FROM houses WHERE id = ?`).bind(houseId).first<{ pay_no: number | null }>();
    if (row && row.pay_no !== payNo) await db.prepare(`UPDATE houses SET pay_no = ? WHERE id = ?`).bind(payNo, houseId).run();
  } catch (e) {
    if (!(e instanceof TenantLockedError)) throw e;
  }
}

/**
 * Gives every directory house without a number one, and makes sure the landlord's store holds the
 * same number: for the houses just numbered and, when `houseId` is given, for that house (so a copy
 * that failed or was locked earlier is repaired on the next call).
 */
export async function assignHousePayNumbers(env: Env, houseId?: string): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT house_id, owner_id FROM house_directory WHERE pay_no IS NULL ORDER BY house_id`).all<{ house_id: string; owner_id: number }>();
  for (const h of results) {
    const no = await allocateHousePayNo(env.DB);
    if (no > 999) throw new Error('Đã hết số căn (tối đa 999).');
    await env.DB.prepare(`UPDATE house_directory SET pay_no = ? WHERE house_id = ? AND pay_no IS NULL`).bind(no, h.house_id).run();
  }
  const check = houseId
    ? await env.DB.prepare(`SELECT house_id, owner_id, pay_no FROM house_directory WHERE house_id = ? AND pay_no IS NOT NULL`).bind(houseId).all<{ house_id: string; owner_id: number; pay_no: number }>()
    : { results: [] as { house_id: string; owner_id: number; pay_no: number }[] };
  const fresh = results.length
    ? (await env.DB.prepare(`SELECT house_id, owner_id, pay_no FROM house_directory WHERE house_id IN (${results.map(() => '?').join(',')})`).bind(...results.map((r) => r.house_id)).all<{ house_id: string; owner_id: number; pay_no: number }>()).results
    : [];
  const todo = new Map([...check.results, ...fresh].map((r) => [r.house_id, r]));
  for (const r of todo.values()) await syncStorePayNo(env, r.owner_id, r.house_id, r.pay_no);
}

/** Gives every room without a number one (all rooms of `db`, or those of one house). */
export async function assignRoomPayNumbers(db: TenantDb, houseId?: string): Promise<void> {
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
    const stmts: TenantStatement[] = [];
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

/** Both halves, for read APIs: a store that is locked for a move simply keeps its numbers as they are. */
export async function assignPayNumbers(env: Env, db: TenantDb, houseId?: string): Promise<void> {
  await assignHousePayNumbers(env, houseId);
  try {
    await assignRoomPayNumbers(db, houseId);
  } catch (e) {
    if (!(e instanceof TenantLockedError)) throw e;
  }
}

/** Fresh room and resident counts from the store into the directory. */
export async function refreshCounts(env: Env, db: TenantDb, houseId: string): Promise<void> {
  const n = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM rooms WHERE house_id = ?1 AND deleted_at IS NULL) AS rooms,
              (SELECT COUNT(*) FROM residents WHERE house_id = ?1 AND status = 'approved' AND deleted_at IS NULL) AS residents`
    )
    .bind(houseId)
    .first<{ rooms: number; residents: number }>();
  await setHouseCounts(env.DB, houseId, { rooms: n?.rooms ?? 0, residents: n?.residents ?? 0 });
}

/** Directory first, then the store; if the store refuses, the directory goes back to what it was. */
async function dirThenStore<T>(env: Env, houseId: string, patch: Partial<Pick<HouseDir, 'name' | 'status' | 'delete_after' | 'modules'>>, store: () => Promise<T>): Promise<T> {
  const old = await houseDir(env.DB, houseId);
  if (!old) return store();
  const { room_count, resident_count, ...base } = old;
  void room_count; void resident_count;
  await upsertHouseDir(env.DB, { ...base, ...patch });
  try {
    return await store();
  } catch (e) {
    await upsertHouseDir(env.DB, base).catch(() => {});
    throw e;
  }
}

const chunks = <T>(xs: T[], n = 90) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The new house: directory row, manager assignment, then the landlord's store, then counters; undone if the store refuses. */
async function createHouse(
  c: Context<App>,
  ownerId: number,
  input: { id: string; name: string; modules: string | null },
  statements: (db: TenantDb, payNo: number) => TenantStatement[],
  roomCount: number
): Promise<void> {
  const env = c.env;
  const payNo = await allocateHousePayNo(env.DB);
  if (payNo > 999) throw new Error('Đã hết số căn (tối đa 999).');
  await upsertHouseDir(env.DB, { house_id: input.id, owner_id: ownerId, name: input.name, status: 'active', delete_after: null, pay_no: payNo, modules: input.modules });
  let db: TenantDb;
  try {
    await env.DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (?, ?)`).bind(ownerId, input.id).run();
    db = await tenantOfOwner(env, ownerId);
    await db.batch(statements(db, payNo));
  } catch (e) {
    await env.DB.prepare(`DELETE FROM staff_houses WHERE house_id = ?`).bind(input.id).run().catch(() => {});
    await removeHouseDir(env.DB, input.id).catch(() => {});
    throw e;
  }
  await assignRoomPayNumbers(db, input.id);
  await setHouseCounts(env.DB, input.id, { rooms: roomCount, residents: 0 });
}

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

interface NewRoom { name?: string; floor?: number; capacity?: number }
interface DevRoom { id: number; name: string; floor: number | null; capacity: number; price: number; pay_no: number | null; occupants: number }

const roomOccupants = `(SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status IN ('approved', 'pending') AND r.deleted_at IS NULL)`;

async function devHouse(db: TenantDb, houseId: string) {
  return db.prepare(`SELECT id, floors FROM houses WHERE id = ?`).bind(houseId).first<{ id: string; floors: number | null }>();
}

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

export function registerHouses(app: Hono<App>): void {
  /** The houses the caller may open: ids from the session, rows from each landlord's store. Admin Tổng gets the summary across their houses. */
  app.get('/api/houses', async (c) => {
    const viewer = c.get('viewer');
    const ids = viewer.kind === 'resident' ? [viewer.houseId] : viewer.houseIds;
    if (!ids.length) return c.json({ success: true, houses: [], canSeeSummary: false });
    const byOwner = new Map<number, string[]>();
    for (const part of chunks(ids)) {
      const { results } = await c.env.DB.prepare(`SELECT house_id, owner_id FROM house_directory WHERE house_id IN (${part.map(() => '?').join(',')})`)
        .bind(...part)
        .all<{ house_id: string; owner_id: number }>();
      for (const r of results) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r.house_id]);
    }
    const houses: { name: string }[] = [];
    for (const [ownerId, owned] of byOwner) {
      const db = await tenantOfOwner(c.env, ownerId);
      for (const part of chunks(owned)) {
        const { results } = await db
          .prepare(
            `SELECT id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, status
               FROM houses WHERE id IN (${part.map(() => '?').join(',')}) ORDER BY name`
          )
          .bind(...part)
          .all<{ name: string }>();
        houses.push(...results);
      }
    }
    houses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return c.json({ success: true, houses, canSeeSummary: isOwner(viewer) });
  });

  app.use('/api/houses/:houseId/*', requireHouse);
  app.use('/api/houses/:houseId', requireHouse);

  /**
   * Payment portal of a house: the bank and account residents pay into. Everyone in the house can read
   * it (residents need it to pay); only Admin Tổng can change it. Zalo's quick transfer
   * pays into the one account registered with Zalo Checkout, so it is offered only when they match.
   */
  app.get('/api/houses/:houseId/payment-portal', async (c) => {
    const db = await tenantFor(c, c.req.param('houseId'));
    const house = await db
      .prepare(`SELECT bank_bin, bank_code, bank_name, bank_account_no, bank_account_name, landlord_name FROM houses WHERE id = ?`)
      .bind(c.req.param('houseId'))
      .first<{ bank_bin: string | null; bank_code: string | null; bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null; landlord_name: string }>();
    if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
    const ready = Boolean(house.bank_bin && house.bank_account_no);
    // A resident's transfer content is XXXPPP + MMYYYY: their house number, then their room number.
    const viewer = c.get('viewer');
    let payPrefix: string | null = null;
    if (viewer.kind === 'resident' && viewer.houseId === c.req.param('houseId') && viewer.roomId) {
      await assignPayNumbers(c.env, db, viewer.houseId);
      const nums = await db
        .prepare(`SELECT h.pay_no AS house_no, rm.pay_no AS room_no FROM rooms rm JOIN houses h ON h.id = rm.house_id WHERE rm.id = ? AND h.id = ?`)
        .bind(viewer.roomId, viewer.houseId)
        .first<{ house_no: number | null; room_no: number | null }>();
      const pad3 = (n: number) => String(n).padStart(3, '0');
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
    const houseId = c.req.param('houseId') ?? '';
    if (!isOwner(viewer)) {
      await audit(c, actorOf(viewer), 'bank_edit_denied', houseId);
      return fail(c, 403, 'BANK_OWNER_ONLY', 'Chỉ Admin Tổng được đổi ngân hàng và số tài khoản.');
    }
    const body = await c.req.json<{ bankBin?: string; accountNo?: string }>().catch(() => ({}) as { bankBin?: string; accountNo?: string });
    const accountNo = String(body.accountNo ?? '').replace(/\s/g, '');
    if (!/^[0-9A-Za-z]{6,19}$/.test(accountNo)) return fail(c, 400, 'ACCOUNT_INVALID', 'Số tài khoản phải có 6–19 chữ số.');
    const bank = (await vietQrBanks()).find((b) => b.bin === String(body.bankBin ?? ''));
    if (!bank) return fail(c, 400, 'BANK_INVALID', 'Vui lòng chọn ngân hàng trong danh sách.');

    const db = await tenantFor(c, houseId);
    await db.prepare(`UPDATE houses SET bank_bin = ?, bank_code = ?, bank_name = ?, bank_account_no = ? WHERE id = ?`)
      .bind(bank.bin, bank.code, bank.shortName, accountNo, houseId)
      .run();
    await audit(c, actorOf(viewer), 'payment_portal_update', houseId, `${bank.shortName} ****${accountNo.slice(-4)}`);
    return c.json({ success: true });
  });

  // New house (Admin Tổng): house, rates and rooms in one request; the house belongs to its creator.
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
    if ((await houseOwner(c.env.DB, id)) !== null) return fail(c, 400, 'HOUSE_EXISTS', 'Tên viết tắt này đã được dùng cho nhà khác.');

    const text = (key: string) => String(body[key] ?? '').trim();
    const rates = body.rates ?? {};
    await createHouse(c, viewer.id, { id, name, modules: null }, (db, payNo) => [
      db.prepare(
        `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, owner_id, pay_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, name, abbreviation, text('address_detail'), text('ward'), text('province'), text('landlord_name'), normalizePhone(text('landlord_phone')), viewer.id, payNo),
      db.prepare(`INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})`)
        .bind(id, ...RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(rates[f]) || 0)))),
      ...rooms.map((room) => db.prepare(`INSERT INTO rooms (house_id, name, price) VALUES (?, ?, ?)`).bind(id, room, Math.max(0, Number(body.roomPrice) || 0))),
    ], rooms.length);
    await audit(c, actorOf(viewer), 'house_create', id, `${rooms.length} phòng`);
    return c.json({ success: true, id, rooms: rooms.length });
  });

  app.get('/api/houses/:houseId', async (c) => {
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const house = await db.prepare(`SELECT id, ${[...HOUSE_FIELDS, ...BANK_FIELDS].join(', ')}, status FROM houses WHERE id = ?`).bind(houseId).first();
    if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà trọ.');
    const rates = await db.prepare(`SELECT ${RATE_FIELDS.join(', ')} FROM house_rates WHERE house_id = ?`).bind(houseId).first();
    return c.json({ success: true, house, rates, canEditBank: isOwner(c.get('viewer')) });
  });

  /** House details: both admin levels. Bank and account number: Admin Tổng only. */
  app.patch('/api/houses/:houseId', staffOnly, async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (BANK_FIELDS.some((f) => f in body) && !isOwner(viewer)) {
      await audit(c, actorOf(viewer), 'bank_edit_denied', houseId);
      return fail(c, 403, 'BANK_OWNER_ONLY', 'Chỉ Admin Tổng được đổi ngân hàng và số tài khoản.');
    }
    const fields = [...HOUSE_FIELDS, ...BANK_FIELDS].filter((f) => f in body);
    if (!fields.length) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');
    const db = await tenantFor(c, houseId);
    await dirThenStore(c.env, houseId, 'name' in body ? { name: String(body.name ?? '').trim() } : {}, () =>
      db.prepare(`UPDATE houses SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
        .bind(...fields.map((f) => String(body[f] ?? '').trim()), houseId)
        .run()
    );
    await audit(c, actorOf(viewer), 'house_update', houseId, fields.join(','));
    return c.json({ success: true });
  });

  app.put('/api/houses/:houseId/rates', staffOnly, async (c) => {
    const houseId = c.req.param('houseId') ?? '';
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const values = RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(body[f]) || 0)));
    const db = await tenantFor(c, houseId);
    await db.prepare(
      `INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})
       ON CONFLICT (house_id) DO UPDATE SET ${RATE_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = datetime('now')`
    )
      .bind(houseId, ...values)
      .run();
    // Billing reads the month's snapshot, not house_rates: write the electricity and water prices through to the CURRENT
    // month (as the fee screen does) and recompute that month's drafts. Other months keep their own fees.
    const month = currentMonth();
    await feeConfigFor(db, houseId, month);
    await db.prepare(`UPDATE house_fee_months SET electricity_per_kwh = ?, water_per_m3 = ?, updated_at = datetime('now') WHERE house_id = ? AND month = ?`)
      .bind(values[RATE_FIELDS.indexOf('electricity_per_kwh')], values[RATE_FIELDS.indexOf('water_per_m3')], houseId, month).run();
    const { recomputed, failed } = await recomputeDrafts(db, c.env.DB, houseId, month);
    await audit(c, actorOf(c.get('viewer')), 'rates_update', houseId, `${month} drafts:${recomputed}`);
    return c.json({ success: true, recomputed, recomputeFailed: failed });
  });

  app.get('/api/houses/:houseId/rooms', staffOnly, async (c) => {
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const { results } = await db.prepare(
      `SELECT rm.id, rm.name, rm.price, rm.deposit, rm.capacity,
              (SELECT COUNT(*) FROM residents r WHERE r.room_id = rm.id AND r.status = 'approved' AND r.deleted_at IS NULL) AS occupants
         FROM rooms rm WHERE rm.house_id = ? AND rm.deleted_at IS NULL ORDER BY rm.name`
    )
      .bind(houseId)
      .all();
    return c.json({ success: true, rooms: results });
  });

  /** The Tiện ích tools a staff member can open: every tool that at least one of their houses uses. */
  app.use('/api/modules', requireAuth, staffOnly);
  app.get('/api/modules', async (c) => {
    const viewer = c.get('viewer');
    const catalog = await moduleCatalog(c.env.DB);
    const ids = viewer.kind === 'staff' ? viewer.houseIds : [];
    if (!ids.length || isDeveloper(viewer)) return c.json({ success: true, modules: catalog.map((m) => m.key) });
    const keys = new Set<string>();
    for (const part of chunks(ids)) {
      const { results } = await c.env.DB.prepare(`SELECT modules FROM house_directory WHERE house_id IN (${part.map(() => '?').join(',')})`)
        .bind(...part)
        .all<{ modules: string | null }>();
      for (const h of results) for (const k of houseModules(h.modules, catalog)) keys.add(k);
    }
    return c.json({ success: true, modules: catalog.filter((m) => keys.has(m.key)).map((m) => m.key) });
  });

  // -------------------------------------------------------------------------
  // Developer: tiện ích prices, new houses for a landlord, changes to a house and its rooms.
  // A room is never hard-deleted (invoices and payments point to it): it gets deleted_at, and adding
  // a room with the same name later brings that row back.
  // -------------------------------------------------------------------------

  app.use('/api/dev/*', requireAuth, developerOnly);

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
    if ((await houseOwner(c.env.DB, id)) !== null) return fail(c, 400, 'HOUSE_EXISTS', 'Tên viết tắt này đã được dùng cho căn khác.');

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

    const modules = JSON.stringify(cleanModules(body.modules, await moduleCatalog(c.env.DB)));
    const price = Math.max(0, Math.round(Number(body.price) || 0));
    const rates = (body.rates ?? {}) as Record<string, unknown>;

    await createHouse(c, owner.id, { id, name, modules }, (db, payNo) => [
      db.prepare(
        `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, floors, modules, owner_id, pay_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, name, abbreviation, text('address_detail'), text('ward'), text('province'), owner.full_name, owner.phone, floors, modules, owner.id, payNo),
      db.prepare(`INSERT INTO house_rates (house_id, ${RATE_FIELDS.join(', ')}) VALUES (?, ${RATE_FIELDS.map(() => '?').join(', ')})`)
        .bind(id, ...RATE_FIELDS.map((f) => Math.max(0, Math.round(Number(rates[f]) || 0)))),
      ...rooms.map((r) =>
        db.prepare(`INSERT INTO rooms (house_id, name, floor, capacity, price) VALUES (?, ?, ?, ?, ?)`).bind(id, r.name, r.floor, r.capacity, price)
      ),
    ], rooms.length);
    await audit(c, actorOf(viewer), 'house_create', id, `owner:${owner.id}, ${rooms.length} phòng`);
    return c.json({ success: true, id, rooms: rooms.length });
  });

  app.get('/api/dev/houses/:houseId', async (c) => {
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    await assignPayNumbers(c.env, db, houseId);
    const house = await db
      .prepare(`SELECT id, name, abbreviation, address_detail, ward, province, floors, modules, owner_id, pay_no FROM houses WHERE id = ?`)
      .bind(houseId)
      .first<Record<string, any>>();
    if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
    const { results: rooms } = await db
      .prepare(
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
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const house = await devHouse(db, houseId);
    if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
    const body = await c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);

    const sets: string[] = [];
    const values: SqlValue[] = [];
    const dirPatch: Partial<Pick<HouseDir, 'name' | 'modules'>> = {};
    const put = (column: string, value: SqlValue) => { sets.push(`${column} = ?`); values.push(value); };
    for (const [key, max] of [['name', 120], ['abbreviation', 20], ['address_detail', 120], ['ward', 120], ['province', 120]] as const) {
      if (!(key in body)) continue;
      const value = String(body[key] ?? '').trim().slice(0, max);
      if ((key === 'name' || key === 'abbreviation') && !value) return fail(c, 400, 'HOUSE_INVALID', 'Tên căn và tên viết tắt không được trống.');
      put(key, key === 'abbreviation' ? value.toUpperCase() : value);
      if (key === 'name') dirPatch.name = value;
    }
    if ('floors' in body) {
      const floors = Math.round(Number(body.floors));
      if (!(floors >= 1 && floors <= 50)) return fail(c, 400, 'FLOORS_INVALID', 'Số tầng phải từ 1 đến 50.');
      const above = await db.prepare(`SELECT COUNT(*) AS n FROM rooms WHERE house_id = ? AND deleted_at IS NULL AND floor > ?`)
        .bind(houseId, floors)
        .first<{ n: number }>();
      if (above?.n) return fail(c, 400, 'FLOORS_HAVE_ROOMS', `Còn ${above.n} phòng ở các tầng trên ${floors}. Xoá hoặc chuyển các phòng đó trước.`);
      put('floors', floors);
    }
    if ('modules' in body) {
      const modules = JSON.stringify(cleanModules(body.modules, await moduleCatalog(c.env.DB)));
      put('modules', modules);
      dirPatch.modules = modules;
    }
    if (!sets.length) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');
    await dirThenStore(c.env, houseId, dirPatch, () => db.prepare(`UPDATE houses SET ${sets.join(', ')} WHERE id = ?`).bind(...values, houseId).run());
    await audit(c, actorOf(viewer), 'house_update', houseId, sets.map((s) => s.split(' ')[0]).join(','));
    return c.json({ success: true });
  });

  /** Add rooms. A name that belonged to a deleted room brings that room back with the new floor and size. */
  app.post('/api/dev/houses/:houseId/rooms', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const house = await devHouse(db, houseId);
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

    const { results: existing } = await db.prepare(`SELECT id, name, deleted_at FROM rooms WHERE house_id = ?`)
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
    await db.batch(
      rooms.map((r) => {
        const old = existing.find((e) => e.deleted_at && e.name === r.name);
        return old
          ? db.prepare(`UPDATE rooms SET deleted_at = NULL, floor = ?, capacity = ? WHERE id = ?`).bind(r.floor, r.capacity, old.id)
          : db.prepare(`INSERT INTO rooms (house_id, name, floor, capacity, price) VALUES (?, ?, ?, ?, ?)`).bind(houseId, r.name, r.floor, r.capacity, price);
      })
    );
    await assignRoomPayNumbers(db, houseId);
    await refreshCounts(c.env, db, houseId);
    await audit(c, actorOf(viewer), 'rooms_add', houseId, rooms.map((r) => r.name).join(','));
    return c.json({ success: true, added: rooms.length });
  });

  const devRoom = (db: TenantDb, houseId: string, roomId: number) =>
    db
      .prepare(`SELECT rm.id, rm.name, rm.floor, rm.capacity, ${roomOccupants} AS occupants FROM rooms rm WHERE rm.id = ? AND rm.house_id = ? AND rm.deleted_at IS NULL`)
      .bind(roomId, houseId)
      .first<{ id: number; name: string; floor: number | null; capacity: number; occupants: number }>();

  /** Rename a room, move it to another floor or change how many people it holds. */
  app.patch('/api/dev/houses/:houseId/rooms/:roomId', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const house = await devHouse(db, houseId);
    const current = house && (await devRoom(db, houseId, Number(c.req.param('roomId'))));
    if (!house || !current) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
    const body = await c.req.json<NewRoom>().catch(() => ({}) as NewRoom);
    const { room, problem } = cleanRoom({ name: body.name ?? current.name, floor: body.floor ?? current.floor ?? 1, capacity: body.capacity ?? current.capacity }, house.floors ?? 50);
    if (problem) return fail(c, 400, 'ROOM_INVALID', problem);
    if (room.capacity < current.occupants)
      return fail(c, 400, 'ROOM_TOO_SMALL', `Phòng ${current.name} đang có ${current.occupants} người, không giảm xuống ${room.capacity} được.`);
    if (room.name !== current.name) {
      const clash = await db.prepare(`SELECT id, deleted_at FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room.name).first<{ id: number; deleted_at: string | null }>();
      if (clash && !clash.deleted_at) return fail(c, 400, 'ROOMS_DUPLICATE', `Phòng ${room.name} đã có trong căn này.`);
      // A deleted room still holds the name (UNIQUE): free it by renaming the old row.
      if (clash) await db.prepare(`UPDATE rooms SET name = ? WHERE id = ?`).bind(`${room.name}~${clash.id}`, clash.id).run();
    }
    await db.prepare(`UPDATE rooms SET name = ?, floor = ?, capacity = ? WHERE id = ?`).bind(room.name, room.floor, room.capacity, current.id).run();
    await audit(c, actorOf(viewer), 'room_update', houseId, `${current.name}→${room.name}`);
    return c.json({ success: true });
  });

  /** Remove a room that nobody lives in. Its past invoices stay. */
  app.delete('/api/dev/houses/:houseId/rooms/:roomId', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const room = await devRoom(db, houseId, Number(c.req.param('roomId')));
    if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
    if (room.occupants > 0) return fail(c, 400, 'ROOM_OCCUPIED', `Phòng ${room.name} đang có ${room.occupants} người. Chuyển hoặc trả phòng cho họ trước.`);
    await db.prepare(`UPDATE rooms SET deleted_at = datetime('now') WHERE id = ?`).bind(room.id).run();
    await refreshCounts(c.env, db, houseId);
    await audit(c, actorOf(viewer), 'room_delete', houseId, room.name);
    return c.json({ success: true });
  });

  // Delete a house with a 7-day grace period. During those days the data stays, can be downloaded as a
  // backup, and the deletion can be cancelled. The daily cron then removes it for good.
  app.post('/api/dev/houses/:houseId/delete', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    if (!(await devHouse(db, houseId))) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
    const old = await houseDir(c.env.DB, houseId);
    const row = await c.env.DB.prepare(
      `UPDATE house_directory SET status = 'inactive', delete_after = datetime('now', '+${DELETE_GRACE_DAYS} days') WHERE house_id = ? RETURNING delete_after`
    )
      .bind(houseId)
      .first<{ delete_after: string }>();
    try {
      await db.prepare(`UPDATE houses SET status = 'inactive', delete_after = ? WHERE id = ?`).bind(row!.delete_after, houseId).run();
    } catch (e) {
      if (old) await c.env.DB.prepare(`UPDATE house_directory SET status = ?, delete_after = ? WHERE house_id = ?`).bind(old.status, old.delete_after, houseId).run().catch(() => {});
      throw e;
    }
    await audit(c, actorOf(viewer), 'house_delete_scheduled', houseId, row!.delete_after);
    return c.json({ success: true, deleteAfter: row!.delete_after });
  });

  app.post('/api/dev/houses/:houseId/restore', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    if (!(await devHouse(db, houseId))) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
    await dirThenStore(c.env, houseId, { status: 'active', delete_after: null }, () =>
      db.prepare(`UPDATE houses SET status = 'active', delete_after = NULL WHERE id = ?`).bind(houseId).run()
    );
    await audit(c, actorOf(viewer), 'house_delete_cancelled', houseId);
    return c.json({ success: true });
  });

  /**
   * Everything the landlord's store holds for one house, as JSON. Passwords are left out; CCCD numbers stay
   * encrypted with CCCD_KEY (only the last 4 digits are readable), so the file can be restored later.
   */
  app.get('/api/dev/houses/:houseId/backup', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const house = await db.prepare(`SELECT * FROM houses WHERE id = ?`).bind(houseId).first();
    if (!house) return fail(c, 404, 'HOUSE_NOT_FOUND', 'Không tìm thấy căn trọ.');
    const all = (sql: string) => db.prepare(sql).bind(houseId).all().then((r) => r.results);
    const [rates, rooms, residents, meters, invoices, payments, notifications] = await Promise.all([
      all(`SELECT * FROM house_rates WHERE house_id = ?`),
      all(`SELECT * FROM rooms WHERE house_id = ?`),
      all(`SELECT id, house_id, room_id, full_name, gender, phone, cccd_enc, cccd_last4, email, dob, address_detail, ward, province,
                  status, move_in_date, move_out_date, created_at, deleted_at FROM residents WHERE house_id = ?`),
      all(`SELECT * FROM meter_readings WHERE house_id = ?`),
      all(`SELECT * FROM invoices WHERE house_id = ?`),
      all(`SELECT * FROM payments WHERE house_id = ?`),
      all(`SELECT * FROM notifications WHERE house_id = ?`),
    ]);
    // Staff accounts are central, not in the landlord's store.
    const { results: managers } = await c.env.DB.prepare(`SELECT s.id, s.full_name, s.phone, s.role, s.status FROM staff s JOIN staff_houses sh ON sh.staff_id = s.id WHERE sh.house_id = ?`)
      .bind(houseId)
      .all();
    await audit(c, actorOf(viewer), 'house_backup', houseId);
    return c.json({
      success: true,
      backup: { format: 'tro-hub-house-backup/1', exportedAt: new Date().toISOString(), house, rates, rooms, residents, managers, meters, invoices, payments, notifications },
    });
  });
}
