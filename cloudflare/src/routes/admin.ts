/**
 * Admin screens on the Worker: the room list of a month, one room's meters, fee settings, per-room service
 * opt-outs and issuing a month. They replace the Express routes that wrote to the Google Sheet. Invoice
 * lifecycle and money rules live in billing/invoices.ts (recompute, issueMonth, edit rules); this file
 * validates input, writes the inputs (meter readings, rates, services) and shapes the JSON the screen reads.
 */
import type { Context, Hono } from 'hono';
import { ensureModule } from '../modules.ts';
import { actorOf, audit, fail, staffOnly, type App } from '../app.ts';
import { phoneTaken, PhoneTakenError, updateResidentIndex } from '../central/directory.ts';
import { normalizePhone } from '../password.ts';
import { cccdColumns, CCCD_INVALID_MESSAGE, CCCD_TAKEN_MESSAGE, cleanCccd, isCccd, PHONE_INVALID_MESSAGE, storablePhone } from '../residentInput.ts';
import { sheetLines } from '../billing/invoiceSheet.ts';
import { assertCanRecompute, effectiveOld, ensureDraft, InvoiceFrozenError, InvoiceLockedError, issueMonth, previousReadings, recompute, recomputeDrafts } from '../billing/invoices.ts';
import { deferredByRoom, type InvoiceStatus } from '../central/deferred.ts';
import { feeConfigFor, mirrorTemplate } from '../billing/fees.ts';
import { enqueueExport } from '../sheetExport.ts';
import { currentMonth, legacyRoomCode, parseLegacyRoom, toSheetMonth } from '../sheetSync.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantFor } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';
import { applyPaymentStatus, findRentRoom, invoiceFor, parseMonth, paymentStatusOut, staffHouseIds, statusView, vnDate } from './rent.ts';

const MAX_MONEY = 100_000_000;
const MAX_READING = 10_000_000;
const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_MONEY;

const fromHandler = async <T>(c: Context<App>, run: () => Promise<T>): Promise<T | Response> => {
  try {
    return await run();
  } catch (err) {
    if (err instanceof InvoiceLockedError || err instanceof InvoiceFrozenError) return fail(c, 409, err.code, err.message);
    throw err;
  }
};

const readBody = (c: Context<App>) => c.req.json<Record<string, any>>().catch(() => ({}) as Record<string, any>);

/** The house a request is about: given (query/body), else the staff's only house. The access check is `tenantFor`'s. */
function pickHouse(c: Context<App>, given: unknown): string | Response {
  const text = typeof given === 'string' ? given.trim() : '';
  if (text) return text;
  const ids = staffHouseIds(c.get('viewer'));
  return ids.length === 1 ? ids[0] : fail(c, 400, 'HOUSE_REQUIRED', 'Hãy chọn nhà trọ.');
}

/** 'YYYY-MM' from 'MM/YYYY' or 'YYYY-MM'; empty → this month; anything else → a 400 response. */
function pickMonth(c: Context<App>, given: unknown): string | Response {
  if (given === undefined || given === null || String(given).trim() === '') return currentMonth();
  return parseMonth(given) ?? fail(c, 400, 'MONTH_INVALID', 'Tháng không hợp lệ (dùng 11/2026 hoặc 2026-11).');
}

/** For the fee routes: a valid month that is not after next month (a typo such as 2062-11 must not store anything). */
function pickFeeMonth(c: Context<App>, given: unknown): string | Response {
  const month = pickMonth(c, given);
  if (month instanceof Response) return month;
  const [y, m] = currentMonth().split('-').map(Number);
  const max = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return month <= max ? month : fail(c, 400, 'MONTH_INVALID', 'Tháng không hợp lệ: chỉ chọn đến tháng sau.');
}

// ── Reading a month of rooms ───────────────────────────────────────────────

interface RoomJoin {
  id: number; name: string; price: number; room_deposit: number; price_custom: number; deposit_custom: number; floor: number | null; capacity: number;
  invoice_id: number | null; room_rent: number | null; electricity: number | null; water: number | null; trash: number | null; internet: number | null;
  parking: number | null; other: number | null; deposit: number | null; total: number | null; status: InvoiceStatus | null; paid_at: string | null;
  sheet_row: number | null; issued_at: string | null;
  has_meter: number; electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null;
  prev_e: number | null; prev_w: number | null;
}

const used = (oldR: number | null, newR: number | null) => (oldR === null || newR === null ? 0 : Math.max(Math.trunc(newR) - Math.trunc(oldR), 0));

/**
 * The rooms of a house for `month` as the admin screen reads them (the keys of the old Express list), with
 * the invoice when there is one. A room without an invoice keeps its money fields null. Residents show names,
 * phones and plates only: no CCCD. `only` narrows to one room.
 */
async function loadRooms(c: Context<App>, db: TenantDb, houseId: string, month: string, only?: number) {
  const prev = (col: 'electric_new' | 'water_new') =>
    `(SELECT p.${col} FROM meter_readings p WHERE p.room_id = rm.id AND p.month < ? AND p.${col} > 0 ORDER BY p.month DESC LIMIT 1)`;
  const [{ results: rooms }, { results: people }, { results: optouts }, { results: banks }, view, waiting] = await Promise.all([
    db.prepare(
      `SELECT rm.id, rm.name, rm.price, rm.deposit AS room_deposit, rm.price_custom, rm.deposit_custom, rm.floor, rm.capacity,
              i.id AS invoice_id, i.room_rent, i.electricity, i.water, i.trash, i.internet, i.parking, i.other, i.deposit, i.total, i.status, i.paid_at, i.sheet_row, i.issued_at,
              (m.id IS NOT NULL) AS has_meter, m.electric_old, m.electric_new, m.water_old, m.water_new,
              ${prev('electric_new')} AS prev_e, ${prev('water_new')} AS prev_w
         FROM rooms rm
         LEFT JOIN invoices i ON i.room_id = rm.id AND i.month = ?
         LEFT JOIN meter_readings m ON m.room_id = rm.id AND m.month = ?
        WHERE rm.house_id = ? AND rm.deleted_at IS NULL${only === undefined ? '' : ' AND rm.id = ?'}`
    ).bind(month, month, month, month, houseId, ...(only === undefined ? [] : [only])).all<RoomJoin>(),
    db.prepare(`SELECT id, room_id, full_name, phone, plate_number, vehicle_type, cccd_last4 FROM residents WHERE house_id = ? AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL ORDER BY id`)
      .bind(houseId).all<{ id: number; room_id: number; full_name: string; phone: string | null; plate_number: string | null; vehicle_type: string | null; cccd_last4: string | null }>(),
    db.prepare(`SELECT o.room_id, o.service_id FROM room_service_optouts o JOIN rooms r ON r.id = o.room_id WHERE r.house_id = ?`).bind(houseId).all<{ room_id: number; service_id: number }>(),
    db.prepare(`SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid FROM payments WHERE house_id = ? AND method = 'bank' AND invoice_id IS NOT NULL GROUP BY invoice_id`)
      .bind(houseId).all<{ invoice_id: number; paid: number }>(),
    statusView(c.env.DB, db, [houseId], month),
    deferredByRoom(c.env.DB, houseId, month, db),
  ]);
  const bank = new Map(banks.map((b) => [b.invoice_id, b.paid]));
  rooms.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));

  // The fee lines with their "Chi tiết" text (old Sheet invoices included), for the room invoice the admin prints.
  const feeLines = await sheetLines(db, rooms.filter((r) => r.invoice_id !== null).map((r) => r.invoice_id!));

  return Promise.all(rooms.map(async (r) => {
    const occupants = people.filter((p) => p.room_id === r.id);
    const slot = (n: number) => ({ name: occupants[n]?.full_name ?? '', phone: occupants[n]?.phone ?? '', plate: occupants[n]?.plate_number ?? '' });
    const [p1, p2, p3] = [slot(0), slot(1), slot(2)];
    // The old reading of a month is the stored one when > 0, else the latest earlier reading (as recompute does).
    const eOld = effectiveOld(r.has_meter ? r.electric_old : null, r.prev_e);
    const wOld = effectiveOld(r.has_meter ? r.water_old : null, r.prev_w);
    const eNew = r.has_meter ? r.electric_new : null;
    const wNew = r.has_meter ? r.water_new : null;
    const missing = !r.has_meter || ((eNew ?? 0) === 0 && (wNew ?? 0) === 0);
    const hasInvoice = r.invoice_id !== null;
    const status = hasInvoice ? await view({ id: r.invoice_id!, house_id: houseId, room: r.name, total: r.total!, status: r.status!, issued_at: r.issued_at }) : 'unpaid';
    const st = paymentStatusOut(status, hasInvoice ? r.paid_at : null);
    const received = hasInvoice ? (bank.get(r.invoice_id!) ?? 0) + (waiting.get(r.name) ?? 0) : 0;
    // tienCoc is the room's deposit: invoices.deposit is only written by the old Sheet import, so it would go stale.
    const money = (n: number | null) => (hasInvoice ? n : null);
    return {
      row: r.sheet_row ?? null,
      houseId,
      roomId: r.id,
      roomPrice: r.price, roomDeposit: r.room_deposit, priceCustom: r.price_custom === 1, depositCustom: r.deposit_custom === 1,
      // Up to 3 residents, in the order of nguoi1..3; residentId is what PATCH /api/admin/residents/:id takes. No CCCD, only its last 4 digits.
      occupants: occupants.slice(0, 3).map((p) => ({
        residentId: p.id, name: p.full_name, phone: p.phone ?? '', plate: p.plate_number ?? '', vehicleType: p.vehicle_type ?? '', cccdLast4: p.cccd_last4 ?? '',
      })),
      invoiceId: r.invoice_id,
      room: legacyRoomCode(houseId, r.name),
      roomName: r.name,
      floor: r.floor,
      capacity: r.capacity,
      name: p1.name || p2.name || p3.name || `Phòng ${r.name}`,
      phone: p1.phone || p2.phone || p3.phone || '',
      status: st.paymentStatus, statusText: st.statusText, paymentStatus: st.paymentStatus, paymentMethod: hasInvoice ? st.paymentMethod : null,
      paidAt: hasInvoice ? vnDate(r.paid_at) : '',
      draft: hasInvoice && r.issued_at === null,
      surplus: hasInvoice ? Math.max(received - r.total!, 0) : 0,
      missingMeters: missing,
      feeLines: r.invoice_id === null ? [] : (feeLines.get(r.invoice_id) ?? []).map((l) => ({ kind: l.kind, name: l.name, amount: l.amount, formula: l.formula })),
      dienCu: eOld ?? 0, dienMoi: eNew ?? 0, dienUsed: used(eOld, eNew),
      nuocCu: wOld ?? 0, nuocMoi: wNew ?? 0, nuocUsed: used(wOld, wNew),
      tienPhong: money(r.room_rent), tienDien: money(r.electricity), tienNuoc: money(r.water), tienRac: money(r.trash), tienNet: money(r.internet),
      tienXe: money(r.parking), tienKhac: money(r.other), tienCoc: r.room_deposit, tongTien: money(r.total),
      nguoi1: p1.name, cccd1: '', sdt1: p1.phone, xe1: p1.plate,
      nguoi2: p2.name, cccd2: '', sdt2: p2.phone, xe2: p2.plate,
      nguoi3: p3.name, cccd3: '', sdt3: p3.phone, xe3: p3.plate,
      soNguoi: occupants.length, soXe: occupants.filter((p) => (p.plate_number ?? '').trim().length > 0).length, soNet: 0,
      optOut: optouts.filter((o) => o.room_id === r.id).map((o) => o.service_id),
    };
  }));
}

type RoomRow = Awaited<ReturnType<typeof loadRooms>>[number];

/** What every write returns so the screen updates without a refetch; null = the room has no invoice. */
const summaryOf = (r: RoomRow | undefined) =>
  r && r.invoiceId !== null ? { invoiceId: r.invoiceId, total: r.tongTien, status: r.status, draft: r.draft, surplus: r.surplus } : null;

/** The one-room view: the list row plus the invoice lines and the HTML status the old detail screen shows. */
async function detailOf(db: TenantDb, row: RoomRow) {
  const lines = row.invoiceId === null ? [] : (await db.prepare(`SELECT kind, name, qty, unit_price AS unitPrice, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY id`)
    .bind(row.invoiceId).all()).results;
  const statusHTML = row.paymentStatus === 'paid' ? '<span style="color:#16a34a">Đã thanh toán</span>'
    : row.paymentStatus === 'pending' ? '<span style="color:#ca8a04">Chờ xác nhận</span>' : '<span style="color:#dc2626">Chưa thanh toán</span>';
  return { ...row, lines, statusHTML };
}

interface RoomRef { db: TenantDb; id: number; house_id: string; name: string }

/** The room a screen means: by house + name (or old code) when `houseId` is given, else by old code over the staff's houses. */
async function findRoom(c: Context<App>, houseId: string | null, code: string): Promise<RoomRef | null> {
  const text = code.trim();
  if (!text) return null;
  if (!houseId) return findRentRoom(c, staffHouseIds(c.get('viewer')), text);
  const db = await tenantFor(c, houseId);
  const place = parseLegacyRoom(text);
  for (const name of [text, ...(place && place.houseId === houseId ? [place.room] : [])]) {
    const row = await db.prepare(`SELECT id, house_id, name FROM rooms WHERE house_id = ? AND name = ? AND deleted_at IS NULL`).bind(houseId, name).first<{ id: number; house_id: string; name: string }>();
    if (row) return { ...row, db };
  }
  return null;
}

// ── Meter input ────────────────────────────────────────────────────────────

const METER_KEYS = ['dienCu', 'dienMoi', 'nuocCu', 'nuocMoi'] as const;

/** A reading from the screen: undefined = not given; a non-integer or negative → null (invalid). */
function reading(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_READING ? n : null;
}

// ── Fee settings ───────────────────────────────────────────────────────────

interface ServiceInput { id?: number; name: string; price: number; per: 'room' | 'person' | 'vehicle'; maxQty: number | null; active: boolean }

/** Validates the service list; the message names the first problem. */
function parseServices(list: unknown): ServiceInput[] | string {
  if (!Array.isArray(list)) return 'Danh sách dịch vụ không hợp lệ.';
  const out: ServiceInput[] = [];
  const seen = new Set<number>();
  for (const [i, s] of list.entries()) {
    const label = `Dịch vụ ${i + 1}`;
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 40) return `${label}: tên không được trống và tối đa 40 ký tự.`;
    if (!isMoney(s.price)) return `${label}: giá phải là số nguyên đồng từ 0 đến 100.000.000.`;
    if (s.per !== 'room' && s.per !== 'person' && s.per !== 'vehicle') return `${label}: "tính theo" phải là phòng, người hoặc xe.`;
    const maxQty = s.maxQty === undefined || s.maxQty === null || s.maxQty === '' ? null : s.maxQty;
    if (maxQty !== null && (s.per !== 'person' || !Number.isInteger(maxQty) || maxQty < 1)) return `${label}: số lượng tối đa chỉ dùng cho "mỗi người" và phải là số nguyên từ 1.`;
    const id = s.id === undefined || s.id === null ? undefined : s.id;
    if (id !== undefined) {
      if (!Number.isInteger(id) || seen.has(id)) return `${label}: mã dịch vụ không hợp lệ.`;
      seen.add(id);
    }
    out.push({ id, name, price: s.price, per: s.per, maxQty, active: s.active !== false });
  }
  return out;
}

/** The fees of one month as the screen reads them. Reading never stores a snapshot (a month may be looked at read-only). */
async function loadConfig(db: TenantDb, houseId: string, month: string) {
  const fee = await feeConfigFor(db, houseId, month, { persist: false });
  const house = await db.prepare(`SELECT default_room_price AS price, default_deposit AS deposit FROM houses WHERE id = ?`).bind(houseId).first<{ price: number | null; deposit: number | null }>();
  return {
    month,
    defaultRoomPrice: house?.price ?? null,
    defaultDeposit: house?.deposit ?? null,
    known: fee.known,
    electricPrice: fee.electricPrice,
    waterPrice: fee.waterPrice,
    services: fee.services.map((s) => ({ id: s.id, name: s.name, price: s.price, per: s.per, maxQty: s.maxQty, active: s.active })),
  };
}

/** Months before the current Vietnam month are read-only: their fees are what their invoices were priced with. */
const monthEditable = (month: string) => month >= currentMonth();
const monthLabel = (month: string) => `Tháng ${month.slice(5)}/${month.slice(0, 4)}`;

// ── Room rent and deposit ──────────────────────────────────────────────────

const nextMonthOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * A room's price changed: recompute its invoices of the current month and the next one that can still change.
 * A paid/cash invoice (locked) is never touched; 'next_month' = the current month's invoice is locked, so the
 * new price counts from the next invoice. An issued invoice of an earlier month is frozen and never reached here.
 */
async function repriceOpenInvoices(c: Context<App>, db: TenantDb, roomId: number): Promise<'this_month' | 'next_month'> {
  const now = currentMonth();
  let locked = false;
  for (const month of [now, nextMonthOf(now)]) {
    const inv = await invoiceFor(db, roomId, month);
    if (!inv) continue;
    try {
      await recompute(db, inv.id, { central: c.env.DB });
    } catch (err) {
      if (err instanceof InvoiceLockedError) {
        if (month === now) locked = true;
      } else if (!(err instanceof InvoiceFrozenError)) throw err;
    }
  }
  return locked ? 'next_month' : 'this_month';
}

const LOCKED_PRICE_MESSAGE = 'Đã lưu giá mới, áp dụng từ hoá đơn tháng sau vì tháng này đã đóng.';

interface DefaultsInput { price: number | null | undefined; deposit: number | null | undefined; applyAll: boolean }

/** The house-wide rent/deposit fields of a config request; a 400 response names the first problem. */
function parseDefaults(c: Context<App>, input: Record<string, any>): DefaultsInput | Response | null {
  const given = (k: string) => input[k] !== undefined;
  if (!given('defaultRoomPrice') && !given('defaultDeposit') && !given('applyToAllRooms')) return null;
  for (const k of ['defaultRoomPrice', 'defaultDeposit']) {
    if (given(k) && input[k] !== null && !isMoney(input[k])) return fail(c, 400, 'MONEY_INVALID', 'Tiền phòng và tiền cọc phải là số nguyên đồng từ 0 đến 100.000.000.');
  }
  if (given('applyToAllRooms') && typeof input.applyToAllRooms !== 'boolean') return fail(c, 400, 'MONEY_INVALID', 'applyToAllRooms phải là true hoặc false.');
  return { price: input.defaultRoomPrice, deposit: input.defaultDeposit, applyAll: input.applyToAllRooms === true };
}

/**
 * Saves a house's common rent/deposit and moves the rooms that follow it (price_custom/deposit_custom = 0; every room
 * when `applyAll`, which also makes them follow). Rooms whose price changed get their open invoices recomputed.
 * With `applyAll` and no value in the request the saved common value is used. `null` clears a common value (rooms keep theirs).
 */
async function applyDefaults(c: Context<App>, db: TenantDb, houseId: string, want: DefaultsInput) {
  const house = await db.prepare(`SELECT default_room_price AS price, default_deposit AS deposit FROM houses WHERE id = ?`).bind(houseId).first<{ price: number | null; deposit: number | null }>();
  const price = want.price === undefined ? house?.price ?? null : want.price;
  const deposit = want.deposit === undefined ? house?.deposit ?? null : want.deposit;
  const sets: string[] = [];
  const args: (number | null)[] = [];
  if (want.price !== undefined) { sets.push('default_room_price = ?'); args.push(want.price); }
  if (want.deposit !== undefined) { sets.push('default_deposit = ?'); args.push(want.deposit); }
  if (sets.length) await db.prepare(`UPDATE houses SET ${sets.join(', ')} WHERE id = ?`).bind(...args, houseId).run();

  // Only what the request is about moves; with neither value in the request (applyAll alone) both saved values do.
  const both = want.price === undefined && want.deposit === undefined;
  const { results: rooms } = await db.prepare(`SELECT id, name, price, deposit AS room_deposit, price_custom, deposit_custom FROM rooms WHERE house_id = ? AND deleted_at IS NULL ORDER BY name`)
    .bind(houseId).all<{ id: number; name: string; price: number; room_deposit: number; price_custom: number; deposit_custom: number }>();
  const writes: ReturnType<TenantDb['prepare']>[] = [];
  const repriced: { id: number; name: string }[] = [];
  for (const r of rooms) {
    const followsPrice = price !== null && (both || want.price !== undefined) && (want.applyAll || r.price_custom === 0);
    const followsDeposit = deposit !== null && (both || want.deposit !== undefined) && (want.applyAll || r.deposit_custom === 0);
    if (followsPrice && (r.price !== price || r.price_custom !== 0)) {
      writes.push(db.prepare(`UPDATE rooms SET price = ?, price_custom = 0 WHERE id = ?`).bind(price, r.id));
    }
    // Idempotent: every room that follows the price is recomputed, so a retry after a failure repairs the invoices.
    if (followsPrice) repriced.push({ id: r.id, name: r.name });
    if (followsDeposit && (r.room_deposit !== deposit || r.deposit_custom !== 0)) writes.push(db.prepare(`UPDATE rooms SET deposit = ?, deposit_custom = 0 WHERE id = ?`).bind(deposit, r.id));
  }
  if (writes.length) await db.batch(writes);

  const lockedRooms: string[] = [];
  for (const r of repriced) if ((await repriceOpenInvoices(c, db, r.id)) === 'next_month') lockedRooms.push(r.name);
  return { defaultRoomPrice: price, defaultDeposit: deposit, roomsUpdated: writes.length, roomsRepriced: repriced.length, lockedRooms };
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerAdmin(app: Hono<App>): void {
  for (const path of ['/api/admin/rooms', '/api/admin/rooms/*', '/api/admin/residents/*', '/api/admin/room-detail', '/api/admin/config', '/api/admin/issue-month'])
    app.use(path, requireAuth, staffOnly);

  app.get('/api/admin/rooms', async (c) => {
    const houseId = pickHouse(c, c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    const month = pickMonth(c, c.req.query('month'));
    if (month instanceof Response) return month;
    const db = await tenantFor(c, houseId);
    return c.json({ success: true, month, rooms: await loadRooms(c, db, houseId, month) });
  });

  app.get('/api/admin/room-detail', async (c) => {
    const month = pickMonth(c, c.req.query('month'));
    if (month instanceof Response) return month;
    const room = await findRoom(c, c.req.query('houseId')?.trim() || null, c.req.query('room') ?? '');
    if (!room) return c.json({ success: true, data: null });
    const [row] = await loadRooms(c, room.db, room.house_id, month, room.id);
    return c.json({ success: true, data: await detailOf(room.db, row) });
  });

  app.post('/api/admin/room-detail', async (c) => {
    const body = await readBody(c);
    const month = pickMonth(c, body.month);
    if (month instanceof Response) return month;
    const data: Record<string, unknown> = body.data && typeof body.data === 'object' ? body.data : {};
    const room = await findRoom(c, typeof body.houseId === 'string' && body.houseId.trim() ? body.houseId.trim() : null, String(body.room ?? ''));
    if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng trong nhà bạn quản lý.');
    const { db } = room;
    const given: Record<(typeof METER_KEYS)[number], number | undefined | null> = {
      dienCu: reading(data.dienCu ?? body.dienCu), dienMoi: reading(data.dienMoi ?? body.dienMoi),
      nuocCu: reading(data.nuocCu ?? body.nuocCu), nuocMoi: reading(data.nuocMoi ?? body.nuocMoi),
    };
    if (METER_KEYS.some((k) => given[k] === null)) return fail(c, 400, 'METER_INVALID', 'Chỉ số điện nước phải là số nguyên không âm.');

    const want = data.paymentStatus === 'paid' || data.paymentStatus === 'unpaid' ? data.paymentStatus : null;
    if (want && METER_KEYS.some((k) => given[k] !== undefined)) {
      return fail(c, 400, 'COMBINED_EDIT', 'Hãy bỏ "đã đóng" trước, rồi lưu chỉ số ở một lần lưu khác.');
    }

    // Entering meter readings is the Điện nước tool; marking an invoice paid (above) is core and stays open.
    if (METER_KEYS.some((k) => given[k] !== undefined)) {
      const off = await ensureModule(c, 'meter', room.house_id);
      if (off) return off;
    }

    return fromHandler(c, async () => {
      const viewer = c.get('viewer');
      let inv = await invoiceFor(db, room.id, month);

      // 1) "Đã đóng" switch: only on an explicit data.paymentStatus, and only when it flips paid-ness.
      if (want) {
        const paid = inv?.status === 'paid' || inv?.status === 'cash';
        if (!inv && want === 'paid') return fail(c, 404, 'INVOICE_NOT_FOUND', 'Phòng này chưa có hoá đơn tháng này.');
        if (inv && paid !== (want === 'paid')) {
          await applyPaymentStatus(c, room, inv, want, month);
          inv = (await invoiceFor(db, room.id, month))!;
        }
        const [row] = await loadRooms(c, db, room.house_id, month, room.id);
        return c.json({ success: true, message: 'Đã lưu thông tin phòng.', invoice: summaryOf(row), data: await detailOf(db, row) });
      }

      // 2) Meters: only what was given; an old reading of 0 (or the one already shown) leaves the stored one.
      const stored = await db.prepare(`SELECT electric_old AS eo, electric_new AS en, water_old AS wo, water_new AS wn FROM meter_readings WHERE room_id = ? AND month = ?`)
        .bind(room.id, month).first<{ eo: number; en: number; wo: number; wn: number }>();
      const before = await previousReadings(db, room.id, month);
      const effOld = { e: effectiveOld(stored ? stored.eo : null, before.electricOld) ?? 0, w: effectiveOld(stored ? stored.wo : null, before.waterOld) ?? 0 };
      const oldVal = (v: number | undefined | null, storedOld: number, eff: number) => (!v || (storedOld === 0 && v === eff) ? storedOld : v);
      const next = {
        eo: oldVal(given.dienCu, stored?.eo ?? 0, effOld.e), en: (given.dienMoi as number | undefined) ?? stored?.en ?? 0,
        wo: oldVal(given.nuocCu, stored?.wo ?? 0, effOld.w), wn: (given.nuocMoi as number | undefined) ?? stored?.wn ?? 0,
      };
      const oldE = effectiveOld(next.eo, before.electricOld) ?? 0, oldW = effectiveOld(next.wo, before.waterOld) ?? 0;
      if ((next.en > 0 && next.en < oldE) || (next.wn > 0 && next.wn < oldW)) return fail(c, 400, 'METER_INVALID', 'Chỉ số mới không được nhỏ hơn chỉ số cũ.');
      const changed = stored ? next.eo !== stored.eo || next.en !== stored.en || next.wo !== stored.wo || next.wn !== stored.wn : Object.values(next).some((n) => n !== 0);

      if (changed) {
        if (inv) assertCanRecompute({ status: inv.status, issued_at: inv.issued_at, month }); // before writing anything
        // Only the columns that changed are updated, so two tabs editing different fields do not clobber each other.
        const cols = ([['electric_old', 'eo'], ['electric_new', 'en'], ['water_old', 'wo'], ['water_new', 'wn']] as const).filter(([, k]) => next[k] !== (stored?.[k] ?? 0));
        await db.prepare(
          `INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (room_id, month) DO UPDATE SET ${cols.map(([col]) => `${col} = excluded.${col}`).join(', ')}`
        ).bind(room.house_id, room.id, month, next.eo, next.en, next.wo, next.wn).run();
        if (inv) await recompute(db, inv.id, { central: c.env.DB });
        else await ensureDraft(db, room.house_id, room.id, month, c.env.DB); // makes the draft (and prices it) when the room has residents
        // The next month's DRAFT (prepared in the last 5 days) starts from this month's new readings: price it again.
        const following = await invoiceFor(db, room.id, nextMonthOf(month));
        if (following && following.issued_at === null) {
          await recompute(db, following.id, { central: c.env.DB }).catch((err) => { if (!(err instanceof InvoiceLockedError)) console.warn('[admin] next draft recompute', room.id, err); });
        }
        await audit(c, actorOf(viewer), 'admin_meter_save', room.house_id, `${room.name}:${month}`);
        // Full state of the room's month (overwrite-style on the Sheet); an entered 0 means "not entered" and is sent empty.
        await enqueueExport(c.env.DB, 'meters', {
          houseId: room.house_id, room: legacyRoomCode(room.house_id, room.name), month: toSheetMonth(month),
          dienCu: oldE, dienMoi: next.en > 0 ? next.en : '', nuocCu: oldW, nuocMoi: next.wn > 0 ? next.wn : '', status: '',
        });
      }

      const [row] = await loadRooms(c, db, room.house_id, month, room.id);
      return c.json({ success: true, message: 'Đã lưu thông tin phòng.', invoice: summaryOf(row), data: await detailOf(db, row) });
    });
  });

  /**
   * Staff edits one resident of a room: name, phone, CCCD, plate and vehicle type (only what is sent). The same rules as the
   * resident's own profile and as creating one (residentInput.ts); the phone is also the login, so it is kept unique across
   * staff and residents (central index first, then the store, the index put back if the store refuses).
   */
  app.patch('/api/admin/residents/:residentId', async (c) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId);
    if (houseId instanceof Response) return houseId;
    const db = await tenantFor(c, houseId);
    const residentId = Number(c.req.param('residentId'));
    const row = Number.isInteger(residentId)
      ? await db.prepare(`SELECT id, room_id, full_name, phone, plate_number, vehicle_type FROM residents WHERE id = ? AND house_id = ? AND deleted_at IS NULL`)
        .bind(residentId, houseId).first<{ id: number; room_id: number | null; full_name: string; phone: string | null; plate_number: string | null; vehicle_type: string | null }>()
      : null;
    if (!row) return fail(c, 404, 'RESIDENT_NOT_FOUND', 'Không tìm thấy cư dân trong nhà này.');

    const sets: string[] = [];
    const values: (string | null)[] = [];
    const set = (column: string, value: string | null) => { sets.push(`${column} = ?`); values.push(value); };
    const text = (v: unknown) => String(v ?? '').trim();

    let fullName = row.full_name;
    if (body.fullName !== undefined) {
      fullName = text(body.fullName);
      if (!fullName) return fail(c, 400, 'NAME_REQUIRED', 'Vui lòng nhập họ và tên.');
      set('full_name', fullName);
    }
    const oldPhone = normalizePhone(row.phone ?? '');
    let phone = oldPhone;
    if (body.phone !== undefined) {
      const wanted = storablePhone(body.phone);
      if (!wanted) return fail(c, 400, 'PHONE_INVALID', PHONE_INVALID_MESSAGE);
      phone = wanted;
    }
    const phoneChanged = phone !== oldPhone;
    if (phoneChanged && (await phoneTaken(c.env.DB, phone, { residentId: row.id }))) return fail(c, 409, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');
    const cccd = cleanCccd(body.cccd); // empty = not filled in, never "erase"
    if (cccd) {
      if (!isCccd(cccd)) return fail(c, 400, 'CCCD_INVALID', CCCD_INVALID_MESSAGE);
      const cols = await cccdColumns(cccd, c.env.CCCD_KEY);
      if (await db.prepare(`SELECT id FROM residents WHERE cccd_hash = ? AND id <> ?`).bind(cols.cccd_hash, row.id).first()) return fail(c, 409, 'CCCD_TAKEN', CCCD_TAKEN_MESSAGE);
      set('cccd_enc', cols.cccd_enc); set('cccd_last4', cols.cccd_last4); set('cccd_hash', cols.cccd_hash);
    }
    const plate = body.plateNumber === undefined ? (row.plate_number ?? '') : text(body.plateNumber);
    if (body.plateNumber !== undefined) set('plate_number', plate || null);
    const vehicleType = body.vehicleType === undefined ? (row.vehicle_type ?? '') : text(body.vehicleType);
    if (body.vehicleType !== undefined) set('vehicle_type', vehicleType || null);
    if (!sets.length && !phoneChanged) return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');

    if (phoneChanged) {
      try {
        await updateResidentIndex(c.env.DB, row.id, { phone });
      } catch (err) {
        if (err instanceof PhoneTakenError) return fail(c, 409, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');
        throw err;
      }
      set('phone', phone);
    }
    try {
      await db.prepare(`UPDATE residents SET ${sets.join(', ')} WHERE id = ?`).bind(...values, row.id).run();
    } catch (err) {
      if (phoneChanged) await updateResidentIndex(c.env.DB, row.id, { phone: oldPhone || null }).catch((e) => console.warn('[admin] phone index revert failed', row.id, e));
      const reason = String((err as Error)?.message ?? err);
      if (/UNIQUE constraint failed.*cccd_hash/i.test(reason)) return fail(c, 409, 'CCCD_TAKEN', CCCD_TAKEN_MESSAGE);
      if (/UNIQUE constraint failed/i.test(reason)) return fail(c, 409, 'PHONE_TAKEN', 'Số điện thoại này đã có tài khoản.');
      throw err;
    }
    // A plate counts as a vehicle (the parking fee), so the open invoices are priced again; a paid one stays as it is.
    if (row.room_id !== null && body.plateNumber !== undefined) await repriceOpenInvoices(c, db, row.room_id);
    await audit(c, actorOf(c.get('viewer')), 'resident_edit_by_staff', houseId, `resident:${row.id}`);
    const place = row.room_id === null ? null : await db.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(row.room_id).first<{ name: string }>();
    // Same parameters as the resident's own profile update; the CCCD is not copied into the queue (personal data).
    await enqueueExport(c.env.DB, 'update_profile', {
      houseId, room: place ? legacyRoomCode(houseId, place.name) : '', currentPhone: oldPhone,
      name: fullName, phone, plateNumber: plate, email: '', dob: '', gender: '', address: '',
      vehicleType, emergencyName: '', emergencyPhone: '', emergencyRelation: '',
    });
    const [detail] = row.room_id === null ? [] : await loadRooms(c, db, houseId, currentMonth(), row.room_id);
    return c.json({ success: true, message: 'Đã lưu thông tin cư dân.', data: detail ? await detailOf(db, detail) : null });
  });

  /**
   * Staff sets a room's rent and/or deposit: its own number (`price`/`deposit`, the room then keeps it) or the house's common
   * one (`useDefaultPrice`/`useDefaultDeposit`, the room then follows the house). It can be saved at any time: the room always
   * gets it; the current month's invoice (and the next month's draft) are recomputed unless the current one is paid/locked, in
   * which case it stays as it is and `appliesFrom` is 'next_month'.
   */
  app.patch('/api/admin/rooms/:roomId', async (c) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId);
    if (houseId instanceof Response) return houseId;
    const month = pickMonth(c, body.month);
    if (month instanceof Response) return month;
    const db = await tenantFor(c, houseId);
    const roomId = Number(c.req.param('roomId'));
    const room = Number.isInteger(roomId)
      ? await db.prepare(`SELECT id, name, price, deposit FROM rooms WHERE id = ? AND house_id = ? AND deleted_at IS NULL`).bind(roomId, houseId).first<{ id: number; name: string; price: number; deposit: number }>()
      : null;
    if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng trong nhà này.');

    for (const k of ['price', 'deposit'] as const) {
      if (body[k] !== undefined && !isMoney(body[k])) return fail(c, 400, 'MONEY_INVALID', 'Tiền phòng và tiền cọc phải là số nguyên đồng từ 0 đến 100.000.000.');
    }
    const useDefaultPrice = body.useDefaultPrice === true, useDefaultDeposit = body.useDefaultDeposit === true;
    if ((useDefaultPrice && body.price !== undefined) || (useDefaultDeposit && body.deposit !== undefined))
      return fail(c, 400, 'MONEY_CONFLICT', 'Chỉ chọn một: nhập giá riêng hoặc dùng giá chung của căn.');
    if (body.price === undefined && body.deposit === undefined && !useDefaultPrice && !useDefaultDeposit)
      return fail(c, 400, 'NOTHING_TO_UPDATE', 'Không có thông tin nào để cập nhật.');

    const house = await db.prepare(`SELECT default_room_price AS price, default_deposit AS deposit FROM houses WHERE id = ?`).bind(houseId).first<{ price: number | null; deposit: number | null }>();
    if (useDefaultPrice && house?.price == null) return fail(c, 400, 'NO_DEFAULT_PRICE', 'Căn này chưa đặt tiền phòng chung. Hãy nhập tiền phòng chung ở phần Cài đặt trước.');
    if (useDefaultDeposit && house?.deposit == null) return fail(c, 400, 'NO_DEFAULT_DEPOSIT', 'Căn này chưa đặt tiền cọc chung. Hãy nhập tiền cọc chung ở phần Cài đặt trước.');

    const sets: string[] = [];
    const args: number[] = [];
    let price = room.price;
    if (useDefaultPrice) { price = house!.price!; sets.push('price = ?', 'price_custom = 0'); args.push(price); }
    else if (body.price !== undefined) { price = body.price; sets.push('price = ?', 'price_custom = 1'); args.push(price); }
    if (useDefaultDeposit) { sets.push('deposit = ?', 'deposit_custom = 0'); args.push(house!.deposit!); }
    else if (body.deposit !== undefined) { sets.push('deposit = ?', 'deposit_custom = 1'); args.push(body.deposit); }
    await db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).bind(...args, room.id).run();

    // Always (recompute is idempotent): a retry after a failed recompute repairs the invoice even though the stored price is the same.
    const appliesFrom = body.price !== undefined || useDefaultPrice ? await repriceOpenInvoices(c, db, room.id) : 'this_month';
    await audit(c, actorOf(c.get('viewer')), 'room_money_edit', houseId, `${room.name}:price=${price}${body.deposit !== undefined || useDefaultDeposit ? `,deposit=${args[args.length - 1]}` : ''}`);
    const [row] = await loadRooms(c, db, houseId, month, room.id);
    return c.json({
      success: true,
      message: appliesFrom === 'next_month' ? LOCKED_PRICE_MESSAGE : price !== room.price ? 'Đã lưu giá mới và tính lại hoá đơn chưa đóng.' : 'Đã lưu.',
      appliesFrom,
      data: await detailOf(db, row),
    });
  });

  const readConfig = async (c: Context<App>) => {
    const houseId = pickHouse(c, c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    const month = pickFeeMonth(c, c.req.query('month'));
    if (month instanceof Response) return month;
    const config = await loadConfig(await tenantFor(c, houseId), houseId, month);
    return c.json({ success: true, month, editable: monthEditable(month), known: config.known, defaultRoomPrice: config.defaultRoomPrice, defaultDeposit: config.defaultDeposit, config });
  };
  app.get('/api/admin/config', readConfig);

  /**
   * Saves the prices and the service list of ONE month (default: this month). Other months' snapshots are never
   * touched; only that month's DRAFT invoices are recomputed (issued ones keep their numbers). Months before the
   * current one are read-only (409). The current month also updates the live template and the Sheet export.
   */
  const saveConfig = async (c: Context<App>) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId ?? c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    const month = pickFeeMonth(c, body.month ?? c.req.query('month'));
    if (month instanceof Response) return month;
    const db = await tenantFor(c, houseId);
    const input: Record<string, any> = body.config && typeof body.config === 'object' ? body.config : body;
    // The common rent/deposit belong to the house, not to a month: they can be saved while looking at any month.
    const defaults = parseDefaults(c, input);
    if (defaults instanceof Response) return defaults;
    if (defaults && !['electricPrice', 'waterPrice', 'services'].some((k) => input[k] !== undefined)) {
      const applied = await applyDefaults(c, db, houseId, defaults);
      await audit(c, actorOf(c.get('viewer')), 'admin_house_defaults', houseId, `rent:${applied.defaultRoomPrice} deposit:${applied.defaultDeposit} rooms:${applied.roomsUpdated}`);
      return c.json({ success: true, month, editable: monthEditable(month), config: await loadConfig(db, houseId, month), ...applied });
    }
    if (!monthEditable(month)) return fail(c, 409, 'MONTH_READONLY', `${monthLabel(month)} đã qua nên không sửa được cài đặt phí. Bạn chỉ xem được.`);
    const current = await loadConfig(db, houseId, month);

    const electric = input.electricPrice === undefined ? current.electricPrice : input.electricPrice;
    const water = input.waterPrice === undefined ? current.waterPrice : input.waterPrice;
    if (!isMoney(electric) || !isMoney(water)) return fail(c, 400, 'RATE_INVALID', 'Đơn giá điện, nước phải là số nguyên đồng từ 0 đến 100.000.000.');
    const services = input.services === undefined ? null : parseServices(input.services);
    if (typeof services === 'string') return fail(c, 400, 'SERVICE_INVALID', services);
    const known = new Set(current.services.map((s) => s.id));
    if (services?.some((s) => s.id !== undefined && !known.has(s.id))) return fail(c, 400, 'SERVICE_INVALID', 'Có dịch vụ không thuộc nhà này.');

    const isCurrent = month === currentMonth();
    await feeConfigFor(db, houseId, month); // the month's snapshot exists from here on (copied forward when it had none)

    // One atomic batch. A new service gets its stable id in the registry (house_services) and, in the very next statement,
    // its snapshot row (last_insert_rowid); it is switched on in the registry only for the current month, because the
    // registry mirrors the current month. Services missing from the list are switched off in this month, never deleted.
    const statements = [
      db.prepare(`UPDATE house_fee_months SET electricity_per_kwh = ?, water_per_m3 = ?, updated_at = datetime('now') WHERE house_id = ? AND month = ?`).bind(electric, water, houseId, month),
    ];
    if (services) {
      const kept = services.flatMap((s) => (s.id === undefined ? [] : [s.id]));
      statements.push(db.prepare(`UPDATE house_fee_services SET active = 0 WHERE house_id = ? AND month = ?${kept.length ? ` AND service_id NOT IN (${kept.map(() => '?').join(',')})` : ''}`).bind(houseId, month, ...kept));
      services.forEach((s, i) => {
        if (s.id === undefined) {
          statements.push(
            db.prepare(`INSERT INTO house_services (house_id, name, price, per, max_qty, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(houseId, s.name, s.price, s.per, s.maxQty, i, isCurrent && s.active ? 1 : 0),
            db.prepare(`INSERT INTO house_fee_services (house_id, month, service_id, name, price, per, max_qty, active, sort) VALUES (?, ?, last_insert_rowid(), ?, ?, ?, ?, ?, ?)`)
              .bind(houseId, month, s.name, s.price, s.per, s.maxQty, s.active ? 1 : 0, i),
          );
          return;
        }
        statements.push(db.prepare(
          `INSERT INTO house_fee_services (house_id, month, service_id, name, price, per, max_qty, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (house_id, month, service_id) DO UPDATE SET name = excluded.name, price = excluded.price, per = excluded.per, max_qty = excluded.max_qty, active = excluded.active, sort = excluded.sort`
        ).bind(houseId, month, s.id, s.name, s.price, s.per, s.maxQty, s.active ? 1 : 0, i));
      });
    }
    await db.batch(statements);
    const saved = await loadConfig(db, houseId, month);
    if (isCurrent) {
      const fee = await feeConfigFor(db, houseId, month);
      await db.batch(mirrorTemplate(db, houseId, fee));
    }

    const { recomputed, failed: recomputeFailed } = await recomputeDrafts(db, c.env.DB, houseId, month);
    await audit(c, actorOf(c.get('viewer')), 'admin_config_save', houseId, `${month} drafts:${recomputed}`);
    if (isCurrent) {
      // The Sheet has a tab for the current month only.
      const fee = await feeConfigFor(db, houseId, month);
      const priceOf = (col: 'K' | 'L' | 'M') => fee.services.find((s) => s.sheetCol === col && s.active)?.price;
      const [rac, net, xe] = [priceOf('K'), priceOf('L'), priceOf('M')];
      await enqueueExport(c.env.DB, 'config', {
        houseId, month: toSheetMonth(month), dien: saved.electricPrice, nuoc: saved.waterPrice,
        ...(rac !== undefined && { rac }), ...(net !== undefined && { net }), ...(xe !== undefined && { xe }),
      });
    }
    const applied = defaults ? await applyDefaults(c, db, houseId, defaults) : {};
    return c.json({ success: true, month, editable: true, config: await loadConfig(db, houseId, month), recomputed, recomputeFailed, ...applied });
  };
  app.put('/api/admin/config', saveConfig);
  app.post('/api/admin/config', saveConfig); // the screen posts today

  app.put('/api/admin/rooms/:roomId/services', async (c) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId ?? c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    const month = pickMonth(c, body.month ?? c.req.query('month'));
    if (month instanceof Response) return month;
    const db = await tenantFor(c, houseId);
    const roomId = Number(c.req.param('roomId'));
    const room = Number.isInteger(roomId)
      ? await db.prepare(`SELECT id, name FROM rooms WHERE id = ? AND house_id = ? AND deleted_at IS NULL`).bind(roomId, houseId).first<{ id: number; name: string }>()
      : null;
    if (!room) return fail(c, 404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng.');
    const optOut: unknown = body.optOut;
    if (!Array.isArray(optOut) || optOut.some((n) => !Number.isInteger(n))) return fail(c, 400, 'SERVICE_INVALID', 'Danh sách dịch vụ không hợp lệ.');
    const ids = [...new Set(optOut as number[])];
    const { results: own } = await db.prepare(`SELECT id FROM house_services WHERE house_id = ?`).bind(houseId).all<{ id: number }>();
    if (ids.some((id) => !own.some((s) => s.id === id))) return fail(c, 400, 'SERVICE_INVALID', 'Có dịch vụ không thuộc nhà của phòng này.');

    await db.batch([
      db.prepare(`DELETE FROM room_service_optouts WHERE room_id = ?`).bind(room.id),
      ...ids.map((id) => db.prepare(`INSERT INTO room_service_optouts (room_id, service_id) VALUES (?, ?)`).bind(room.id, id)),
    ]);
    const inv = await invoiceFor(db, room.id, month);
    // A paid/cash invoice or an issued one of an earlier month keeps its numbers; the opt-out then counts from the next one.
    if (inv) await recompute(db, inv.id, { central: c.env.DB }).catch((err) => { if (!(err instanceof InvoiceLockedError || err instanceof InvoiceFrozenError)) throw err; });
    await audit(c, actorOf(c.get('viewer')), 'admin_room_services', houseId, `${room.name}:${ids.join(',')}`);
    const [row] = await loadRooms(c, db, houseId, month, room.id);
    return c.json({ success: true, optOut: ids, invoice: summaryOf(row) });
  });

  app.post('/api/admin/issue-month', async (c) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId);
    if (houseId instanceof Response) return houseId;
    const asked = pickMonth(c, body.month);
    if (asked instanceof Response) return asked;
    await tenantFor(c, houseId); // the access check (403 / 404) before anything is read or written
    const month = pickFeeMonth(c, asked); // up to next month
    if (month instanceof Response) return month;
    // The next month can be issued as soon as it is prepared (pickMonth allows at most next month).
    const { issued, missingMeters } = await issueMonth(c.env, houseId, month, body.force === true);
    if (issued > 0) await audit(c, actorOf(c.get('viewer')), 'admin_issue_month', houseId, `${month}:${issued}`);
    return c.json({ success: true, issued, missingMeters });
  });
}
