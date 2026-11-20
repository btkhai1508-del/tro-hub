/**
 * Rent, invoices and the payment gate. Every read of a status goes through `statusView`, which adds
 * the SePay money still waiting centrally (sepay_events 'deferred') on top of the stored invoice, so
 * the resident and the landlord/manager see "Đã đóng" as soon as the money is there, in every storage
 * state, before the replay writes it into the store.
 */
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { actorOf, audit, fail, staffOnly, type App, type Viewer } from '../app.ts';
import { bankReceived, deferredByRoom, effectiveStatus, type InvoiceStatus } from '../central/deferred.ts';
import { decryptText } from '../cccd.ts';
import {
  currentMonth, ensureMonthFresh, fromSheetMonth, legacyRoomCode, legacySheet, paintSheetPayment, parseLegacyRoom,
  saveScriptGate, scriptGates, sheetMonths, toSheetMonth,
} from '../sheetSync.ts';
import { isReadOnly, type TenantDb } from '../tenant/db.ts';
import { tenantFor, tenantOfOwner } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';

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

export interface InvoiceRow { id: number; house_id: string; room_id: number; total: number; status: InvoiceStatus; paid_at: string | null; sheet_row: number | null; issued_at: string | null }

export const invoiceFor = (db: TenantDb, roomId: number, month: string) =>
  db.prepare(`SELECT id, house_id, room_id, total, status, paid_at, sheet_row, issued_at FROM invoices WHERE room_id = ? AND month = ?`)
    .bind(roomId, month).first<InvoiceRow>();

/** Hoá đơn của phòng trong tháng; tháng mới chưa có trong kho thì đọc Sheet ngay một lần (bỏ qua khi kho chỉ đọc). */
export async function invoiceOrSync(tenant: TenantDb, central: D1Database, roomId: number, month: string) {
  return (await invoiceFor(tenant, roomId, month)) ?? ((await ensureMonthFresh(central, tenant, month, 0)) ? invoiceFor(tenant, roomId, month) : null);
}

/**
 * The status the caller should see for invoices of `houseIds` in `month`. Deferred SePay money is
 * looked up every time (a cheap partial index, an empty map almost always); only a room that has some
 * reads the bank money already recorded for its invoice.
 */
async function statusView(central: D1Database, db: TenantDb, houseIds: string[], month: string) {
  const deferred = new Map<string, Map<string, number>>();
  await Promise.all(houseIds.map(async (h) => deferred.set(h, await deferredByRoom(central, h, month, db))));
  return async (inv: { id: number; house_id: string; room: string; total: number; status: InvoiceStatus; issued_at?: string | null }): Promise<InvoiceStatus> => {
    if (inv.issued_at === null) return inv.status; // a draft shows its stored status: no overlay, so it never flips after the replay
    // Present = the room has an open SePay event (even a booked one: its invoice update may not have landed yet).
    const open = deferred.get(inv.house_id);
    if (!open?.has(inv.room) || inv.status === 'paid' || inv.status === 'cash') return inv.status;
    const waiting = open.get(inv.room) ?? 0;
    return effectiveStatus(inv.status, inv.total, await bankReceived(db, inv.id), waiting);
  };
}

function statusResponse(houseId: string, room: string, month: string, inv: InvoiceRow | null, status: InvoiceStatus | null) {
  return {
    success: true,
    roomNumber: legacyRoomCode(houseId, room),
    foundRow: inv?.sheet_row ?? -1,
    cellAddress: inv?.sheet_row ? `P${inv.sheet_row}` : 'N/A',
    tabName: toSheetMonth(month),
    amount: inv?.total ?? 0,
    ...paymentStatusOut(status ?? inv?.status ?? null, inv?.paid_at ?? null),
  };
}

const staffHouseIds = (v: Viewer) => (v.kind === 'staff' ? v.houseIds : []);
const inList = (ids: string[]) => ids.map(() => '?').join(',') || 'NULL';

/** The caller's houses grouped by the landlord whose store holds them. */
async function storesOf(c: Context<App>, houseIds: string[]): Promise<{ db: TenantDb; houseIds: string[] }[]> {
  if (!houseIds.length) return [];
  const { results } = await c.env.DB.prepare(`SELECT house_id, owner_id FROM house_directory WHERE house_id IN (${inList(houseIds)})`)
    .bind(...houseIds).all<{ house_id: string; owner_id: number }>();
  const byOwner = new Map<number, string[]>();
  for (const r of results) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r.house_id]);
  return Promise.all([...byOwner].map(async ([ownerId, ids]) => ({ db: await tenantOfOwner(c.env, ownerId), houseIds: ids })));
}

interface RentRoom { id: number; house_id: string; name: string }

/** Phòng theo mã kiểu cũ ("LVC-101", "G01"), chỉ trong các nhà người gọi được xem. */
async function findRentRoom(c: Context<App>, houseIds: string[], code: string): Promise<(RentRoom & { db: TenantDb }) | null> {
  if (!houseIds.length) return null;
  const place = parseLegacyRoom(code);
  if (place && houseIds.includes(place.houseId)) {
    const db = await tenantFor(c, place.houseId);
    const row = await db.prepare(`SELECT id, house_id, name FROM rooms WHERE house_id = ? AND name = ? AND deleted_at IS NULL`)
      .bind(place.houseId, place.room).first<RentRoom>();
    if (row) return { ...row, db };
  }
  // Nhà mới không có tiền tố: tên phòng phải chỉ thuộc một nhà.
  const found: (RentRoom & { db: TenantDb })[] = [];
  for (const store of await storesOf(c, houseIds)) {
    const { results } = await store.db.prepare(
      `SELECT id, house_id, name FROM rooms WHERE deleted_at IS NULL AND UPPER(name) = ? AND house_id IN (${inList(store.houseIds)})`
    ).bind(String(code ?? '').trim().toUpperCase(), ...store.houseIds).all<RentRoom>();
    found.push(...results.map((r) => ({ ...r, db: store.db })));
  }
  return found.length === 1 ? found[0] : null;
}

/** Writes (house, month) → START/STOP; the one statement behind the admin switch and issuing a month. */
export const gateStatement = (db: TenantDb, houseId: string, month: string, value: 'START' | 'STOP', by: string) =>
  db.prepare(
    `INSERT INTO payment_gates (house_id, month, value, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (house_id, month) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(houseId, month, value, by);

/** Cổng thanh toán của nhà trong tháng; tháng chưa đặt thì giữ giá trị mới nhất của nhà. */
async function gateFor(central: D1Database, db: TenantDb, houseId: string, month: string): Promise<'START' | 'STOP'> {
  const exact = await db.prepare(`SELECT value FROM payment_gates WHERE house_id = ? AND month = ?`).bind(houseId, month).first<{ value: 'START' | 'STOP' }>();
  if (exact) return exact.value;
  const latest = await db.prepare(`SELECT value FROM payment_gates WHERE house_id = ? ORDER BY updated_at DESC, month DESC LIMIT 1`).bind(houseId).first<{ value: 'START' | 'STOP' }>();
  if (latest) return latest.value;
  if (isReadOnly(db)) return 'STOP'; // the first-time import below writes; a read never waits for the lock
  // Lần đầu: lấy các tháng Express đã lưu trong Apps Script cho nhà còn dùng Sheet cũ.
  const legacy = await legacySheet(central);
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
  return gateFor(central, db, houseId, month);
}

interface BillingRow {
  id: number; house_id: string; room_id: number; room: string; month: string; room_rent: number; electricity: number; water: number;
  trash: number; internet: number; parking: number; other: number; deposit: number; total: number; status: InvoiceStatus;
  paid_at: string | null; sheet_row: number | null; issued_at: string | null; electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null;
}

type Trend = { month: string; dien: number; nuoc: number; tienDien: number; tienNuoc: number; doanhThu: number };

export function registerRent(app: Hono<App>): void {
  /** One month of invoices with their meter readings. A resident only gets their own room. */
  app.get('/api/houses/:houseId/invoices', async (c) => {
    const viewer = c.get('viewer');
    const houseId = c.req.param('houseId');
    const roomFilter = viewer.kind === 'resident' ? viewer.roomId : null;
    if (viewer.kind === 'resident' && !roomFilter) return c.json({ success: true, month: null, invoices: [] });
    const db = await tenantFor(c, houseId);

    const month =
      c.req.query('month') ||
      (
        await db.prepare(`SELECT MAX(month) AS month FROM invoices WHERE house_id = ?${roomFilter ? ' AND room_id = ? AND issued_at IS NOT NULL' : ''}`)
          .bind(...(roomFilter ? [houseId, roomFilter] : [houseId]))
          .first<{ month: string | null }>()
      )?.month;
    if (!month) return c.json({ success: true, month: null, invoices: [] });

    const { results } = await db.prepare(
      `SELECT i.*, rm.name AS room_name, m.electric_old, m.electric_new, m.water_old, m.water_new
         FROM invoices i
         JOIN rooms rm ON rm.id = i.room_id
         LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
        WHERE i.house_id = ? AND i.month = ?${roomFilter ? ' AND i.room_id = ? AND i.issued_at IS NOT NULL' : ''}
        ORDER BY rm.name`
    )
      .bind(...(roomFilter ? [houseId, month, roomFilter] : [houseId, month]))
      .all<{ id: number; house_id: string; room_name: string; total: number; status: InvoiceStatus; issued_at: string | null }>();
    const view = await statusView(c.env.DB, db, [houseId], month);
    const invoices = await Promise.all(results.map(async (r) => ({ ...r, draft: r.issued_at === null, status: await view({ id: r.id, house_id: r.house_id, room: r.room_name, total: r.total, status: r.status, issued_at: r.issued_at }) })));
    return c.json({ success: true, month, invoices });
  });

  app.get('/api/houses/:houseId/payments', staffOnly, async (c) => {
    const houseId = c.req.param('houseId') ?? '';
    const db = await tenantFor(c, houseId);
    const { results } = await db.prepare(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.bank_name, p.reference, p.content, p.paid_at, p.confirmed_by,
              i.month, rm.name AS room_name
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN rooms rm ON rm.id = i.room_id
        WHERE p.house_id = ? ORDER BY p.paid_at DESC LIMIT 500`
    )
      .bind(houseId)
      .all();
    return c.json({ success: true, payments: results });
  });

  /** Cư dân xem phòng mình; quản lý xem phòng bất kỳ trong nhà mình (?room=). */
  app.use('/api/payment/status', requireAuth);
  app.get('/api/payment/status', async (c) => {
    const v = c.get('viewer');
    const month = monthParam(c.req.query('month'));
    const room = v.kind === 'resident'
      ? (v.roomId && v.roomName ? { id: v.roomId, house_id: v.houseId, name: v.roomName, db: await tenantFor(c, v.houseId) } : null)
      : await findRentRoom(c, v.houseIds, c.req.query('room') ?? '');
    if (!room) return fail(c, 400, 'ROOM_REQUIRED', 'Thiếu mã phòng');
    c.executionCtx.waitUntil(ensureMonthFresh(c.env.DB, room.db, month, 10 * 60_000));
    // A resident never gets a draft: it reads as "no invoice yet".
    const found = await invoiceFor(room.db, room.id, month);
    const inv = v.kind === 'resident' && found?.issued_at === null ? null : found;
    const status = inv ? await (await statusView(c.env.DB, room.db, [room.house_id], month))({ ...inv, room: room.name }) : null;
    return c.json(statusResponse(room.house_id, room.name, month, inv, status));
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
    const db = await tenantFor(c, v.houseId);
    const found = await invoiceOrSync(db, c.env.DB, v.roomId, month);
    const inv = found?.issued_at === null ? null : found; // a draft is invisible to the resident
    if (!inv) return fail(c, 404, 'INVOICE_NOT_FOUND', `Chưa có hoá đơn tháng ${toSheetMonth(month)}.`);
    // Money that already arrived (even if the invoice row lags or the store is read-only) reads "Đã đóng": nothing to write.
    const before = await (await statusView(c.env.DB, db, [v.houseId], month))({ ...inv, room: v.roomName });
    if (inv.status === 'unpaid' && before === 'unpaid') {
      await db.prepare(`UPDATE invoices SET status = 'pending', status_by = ? WHERE id = ? AND status = 'unpaid'`).bind(actorOf(v), inv.id).run();
      await audit(c, actorOf(v), 'rent_claimed_paid', v.houseId, `invoice:${inv.id}`);
    }
    const fresh = await invoiceFor(db, v.roomId, month);
    const effective = fresh ? await (await statusView(c.env.DB, db, [v.houseId], month))({ ...fresh, room: v.roomName }) : null;
    const status = statusResponse(v.houseId, v.roomName, month, fresh, effective);
    return c.json({ success: true, roomNumber: status.roomNumber, status, message: status.paymentStatus === 'paid' ? 'Hoá đơn đã được xác nhận thanh toán.' : 'Đã ghi nhận, đang chờ xác nhận tiền về.' });
  });

  app.use('/api/payment/gate', requireAuth);
  app.get('/api/payment/gate', async (c) => {
    const v = c.get('viewer');
    const month = monthParam(c.req.query('month'));
    const houseId = v.kind === 'resident' ? v.houseId : v.houseIds[0];
    if (!houseId) return c.json({ success: true, month: toSheetMonth(month), value: 'STOP' });
    return c.json({ success: true, month: toSheetMonth(month), value: await gateFor(c.env.DB, await tenantFor(c, houseId), houseId, month) });
  });

  for (const path of ['/api/admin/months', '/api/admin/dashboard', '/api/admin/billing', '/api/admin/payment-status', '/api/admin/payment-gate'])
    app.use(path, requireAuth, staffOnly);

  app.get('/api/admin/months', async (c) => {
    const houseIds = staffHouseIds(c.get('viewer'));
    const months = new Set<string>([currentMonth()]);
    if (houseIds.length) {
      for (const store of await storesOf(c, houseIds)) {
        const { results } = await store.db.prepare(`SELECT DISTINCT month FROM invoices WHERE house_id IN (${inList(store.houseIds)})`).bind(...store.houseIds).all<{ month: string }>();
        results.forEach((r) => months.add(r.month));
      }
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
    const merged = new Map<string, Trend>();
    const counts = { soNguoi: 0, soXe: 0 };
    for (const store of await storesOf(c, houseIds)) {
      await ensureMonthFresh(c.env.DB, store.db, month);
      const marks = inList(store.houseIds);
      const { results: trend } = await store.db.prepare(
        `SELECT i.month,
                SUM(MAX(COALESCE(m.electric_new - m.electric_old, 0), 0)) AS dien,
                SUM(MAX(COALESCE(m.water_new - m.water_old, 0), 0)) AS nuoc,
                SUM(i.electricity) AS tienDien, SUM(i.water) AS tienNuoc, SUM(i.total) AS doanhThu
           FROM invoices i LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
          WHERE i.house_id IN (${marks}) AND i.month <= ? AND i.issued_at IS NOT NULL
          GROUP BY i.month ORDER BY i.month DESC LIMIT 6`
      ).bind(...store.houseIds, month).all<Trend>();
      for (const t of trend) {
        const m = merged.get(t.month);
        merged.set(t.month, m ? { month: t.month, dien: m.dien + t.dien, nuoc: m.nuoc + t.nuoc, tienDien: m.tienDien + t.tienDien, tienNuoc: m.tienNuoc + t.tienNuoc, doanhThu: m.doanhThu + t.doanhThu } : t);
      }
      const people = await store.db.prepare(
        `SELECT COUNT(*) AS soNguoi,
                SUM(CASE WHEN LENGTH(TRIM(COALESCE(plate_number, ''))) >= 4 THEN 1 ELSE 0 END) AS soXe
           FROM residents WHERE house_id IN (${marks}) AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL`
      ).bind(...store.houseIds).first<{ soNguoi: number; soXe: number | null }>();
      counts.soNguoi += people?.soNguoi ?? 0;
      counts.soXe += people?.soXe ?? 0;
    }
    const trend = [...merged.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 6);
    const selected = trend.find((t) => t.month === month);
    const usageTrend = trend.reverse().map((t) => ({ ...t, month: toSheetMonth(t.month), ...counts }));
    return c.json({ success: true, data: { ...empty, ...(selected ? { ...selected, month: undefined } : {}), ...counts, usageTrend } });
  });

  app.get('/api/admin/billing', async (c) => {
    const houseIds = staffHouseIds(c.get('viewer'));
    const month = monthParam(c.req.query('month'));
    if (!houseIds.length) return c.json({ success: true, billing: [] });
    const stores = await storesOf(c, houseIds);
    const rows: Awaited<ReturnType<typeof billingOf>> = [];
    for (const store of stores) rows.push(...(await billingOf(c, store, month)));
    if (stores.length > 1) rows.sort((a, b) => (a.row ?? 9999) - (b.row ?? 9999) || (a.houseId < b.houseId ? -1 : a.houseId > b.houseId ? 1 : 0));
    return c.json({ success: true, billing: rows });
  });

  /** Quản lý đổi trạng thái một phòng: 'paid' / 'cash' (đã đóng), 'pending', 'unpaid'. */
  app.post('/api/admin/payment-status', async (c) => {
    const v = c.get('viewer');
    const body = await c.req.json<{ roomNumber?: string; status?: string; month?: string; row?: number }>().catch(() => ({} as Record<string, never>));
    const status: InvoiceStatus = (['paid', 'cash', 'pending'] as const).find((s) => s === body.status) ?? 'unpaid';
    const month = monthParam(body.month);
    const room = await findRentRoom(c, staffHouseIds(v), String(body.roomNumber ?? ''));
    if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng trong nhà bạn quản lý.');
    const inv = await invoiceOrSync(room.db, c.env.DB, room.id, month);
    if (!inv) return fail(c, 404, 'INVOICE_NOT_FOUND', `Phòng ${body.roomNumber} chưa có hoá đơn tháng ${toSheetMonth(month)}.`);
    const paid = status === 'paid' || status === 'cash';
    await room.db.prepare(
      `UPDATE invoices SET status = ?, paid_at = CASE WHEN ? THEN COALESCE(paid_at, datetime('now')) ELSE NULL END, status_by = ? WHERE id = ?`
    ).bind(status, paid ? 1 : 0, actorOf(v), inv.id).run();
    await audit(c, actorOf(v), `rent_status_${status}`, room.house_id, `invoice:${inv.id}`);
    if (status !== 'pending') c.executionCtx.waitUntil(paintSheetPayment(c.env, room.house_id, room.name, paid, month, inv.sheet_row));
    return c.json({ success: true, message: `Đã cập nhật trạng thái phòng ${body.roomNumber}`, roomNumber: legacyRoomCode(room.house_id, room.name), status, row: inv.sheet_row ?? undefined });
  });

  app.get('/api/admin/payment-gate', async (c) => {
    const houseIds = staffHouseIds(c.get('viewer'));
    const month = monthParam(c.req.query('month'));
    const houseId = houseIds[0];
    return c.json({ success: true, month: toSheetMonth(month), value: houseId ? await gateFor(c.env.DB, await tenantFor(c, houseId), houseId, month) : 'STOP' });
  });

  /** Mở/đóng cổng cho mọi nhà quản lý này phụ trách (trang Admin hiện có một nút chung). */
  app.post('/api/admin/payment-gate', async (c) => {
    const v = c.get('viewer');
    const houseIds = staffHouseIds(v);
    const body = await c.req.json<{ month?: string; value?: string }>().catch(() => ({} as Record<string, never>));
    const month = monthParam(body.month);
    const value = String(body.value).toUpperCase() === 'START' ? 'START' : 'STOP';
    if (!houseIds.length) return fail(c, 403, 'HOUSE_FORBIDDEN', 'Bạn chưa được giao nhà trọ nào.');
    for (const store of await storesOf(c, houseIds)) {
      await store.db.batch(store.houseIds.map((h) => gateStatement(store.db, h, month, value, actorOf(v))));
    }
    await audit(c, actorOf(v), `payment_gate_${value.toLowerCase()}`, null, `${houseIds.join(',')}:${month}`);
    const legacy = await legacySheet(c.env.DB);
    if (legacy?.houses.some((h) => houseIds.includes(h))) c.executionCtx.waitUntil(saveScriptGate(c.env, month, value));
    return c.json({ success: true, month: toSheetMonth(month), value });
  });
}

/** The billing sheet rows of one landlord's houses, with the status as the landlord should see it. */
async function billingOf(c: Context<App>, store: { db: TenantDb; houseIds: string[] }, month: string) {
  await ensureMonthFresh(c.env.DB, store.db, month);
  const marks = inList(store.houseIds);
  const { results: invoices } = await store.db.prepare(
    `SELECT i.id, i.house_id, i.room_id, rm.name AS room, i.month, i.room_rent, i.electricity, i.water, i.trash, i.internet, i.parking,
            i.other, i.deposit, i.total, i.status, i.paid_at, i.sheet_row, i.issued_at, m.electric_old, m.electric_new, m.water_old, m.water_new
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id
       LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id IN (${marks}) AND i.month = ?
      ORDER BY COALESCE(i.sheet_row, 9999), i.house_id, rm.name`
  ).bind(...store.houseIds, month).all<BillingRow>();
  const { results: people } = await store.db.prepare(
    `SELECT room_id, full_name, phone, cccd_enc, plate_number FROM residents
      WHERE house_id IN (${marks}) AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL ORDER BY id`
  ).bind(...store.houseIds).all<{ room_id: number; full_name: string; phone: string | null; cccd_enc: string | null; plate_number: string | null }>();
  const byRoom = new Map<number, typeof people>();
  for (const p of people) byRoom.set(p.room_id, [...(byRoom.get(p.room_id) ?? []), p]);
  const cccd = async (enc: string | null) => (enc ? decryptText(enc, c.env.CCCD_KEY).catch(() => '') : '');
  const view = await statusView(c.env.DB, store.db, store.houseIds, month);

  return Promise.all(invoices.map(async (i) => {
    const occupants = (byRoom.get(i.room_id) ?? []).slice(0, 3);
    const slot = async (n: number) => {
      const p = occupants[n];
      return { name: p?.full_name ?? '', cccd: await cccd(p?.cccd_enc ?? null), phone: p?.phone ?? '', plate: p?.plate_number ?? '' };
    };
    const [p1, p2, p3] = await Promise.all([slot(0), slot(1), slot(2)]);
    const plates = [p1.plate, p2.plate, p3.plate].filter((x) => x.trim().length >= 4);
    const st = paymentStatusOut(await view(i), i.paid_at);
    const eOld = i.electric_old ?? 0, eNew = i.electric_new ?? 0, wOld = i.water_old ?? 0, wNew = i.water_new ?? 0;
    return {
      row: i.sheet_row ?? undefined,
      houseId: i.house_id,
      invoiceId: i.id,
      draft: i.issued_at === null,
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
}
