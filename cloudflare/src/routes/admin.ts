/**
 * Admin screens on the Worker: the room list of a month, one room's meters, fee settings, per-room service
 * opt-outs and issuing a month. They replace the Express routes that wrote to the Google Sheet. Invoice
 * lifecycle and money rules live in billing/invoices.ts (recompute, issueMonth, edit rules); this file
 * validates input, writes the inputs (meter readings, rates, services) and shapes the JSON the screen reads.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, fail, staffOnly, type App } from '../app.ts';
import { assertCanRecompute, effectiveOld, ensureDraft, InvoiceFrozenError, InvoiceLockedError, issueMonth, previousReadings, recompute } from '../billing/invoices.ts';
import { deferredByRoom, type InvoiceStatus } from '../central/deferred.ts';
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

// ── Reading a month of rooms ───────────────────────────────────────────────

interface RoomJoin {
  id: number; name: string; price: number; floor: number | null; capacity: number;
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
      `SELECT rm.id, rm.name, rm.price, rm.floor, rm.capacity,
              i.id AS invoice_id, i.room_rent, i.electricity, i.water, i.trash, i.internet, i.parking, i.other, i.deposit, i.total, i.status, i.paid_at, i.sheet_row, i.issued_at,
              (m.id IS NOT NULL) AS has_meter, m.electric_old, m.electric_new, m.water_old, m.water_new,
              ${prev('electric_new')} AS prev_e, ${prev('water_new')} AS prev_w
         FROM rooms rm
         LEFT JOIN invoices i ON i.room_id = rm.id AND i.month = ?
         LEFT JOIN meter_readings m ON m.room_id = rm.id AND m.month = ?
        WHERE rm.house_id = ? AND rm.deleted_at IS NULL${only === undefined ? '' : ' AND rm.id = ?'}`
    ).bind(month, month, month, month, houseId, ...(only === undefined ? [] : [only])).all<RoomJoin>(),
    db.prepare(`SELECT room_id, full_name, phone, plate_number FROM residents WHERE house_id = ? AND room_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL ORDER BY id`)
      .bind(houseId).all<{ room_id: number; full_name: string; phone: string | null; plate_number: string | null }>(),
    db.prepare(`SELECT o.room_id, o.service_id FROM room_service_optouts o JOIN rooms r ON r.id = o.room_id WHERE r.house_id = ?`).bind(houseId).all<{ room_id: number; service_id: number }>(),
    db.prepare(`SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid FROM payments WHERE house_id = ? AND method = 'bank' AND invoice_id IS NOT NULL GROUP BY invoice_id`)
      .bind(houseId).all<{ invoice_id: number; paid: number }>(),
    statusView(c.env.DB, db, [houseId], month),
    deferredByRoom(c.env.DB, houseId, month, db),
  ]);
  const bank = new Map(banks.map((b) => [b.invoice_id, b.paid]));
  rooms.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));

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
    const money = (n: number | null) => (hasInvoice ? n : null);
    return {
      row: r.sheet_row ?? null,
      houseId,
      roomId: r.id,
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
      dienCu: eOld ?? 0, dienMoi: eNew ?? 0, dienUsed: used(eOld, eNew),
      nuocCu: wOld ?? 0, nuocMoi: wNew ?? 0, nuocUsed: used(wOld, wNew),
      tienPhong: money(r.room_rent), tienDien: money(r.electricity), tienNuoc: money(r.water), tienRac: money(r.trash), tienNet: money(r.internet),
      tienXe: money(r.parking), tienKhac: money(r.other), tienCoc: money(r.deposit), tongTien: money(r.total),
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

async function loadConfig(db: TenantDb, houseId: string) {
  const [rates, services] = await Promise.all([
    db.prepare(`SELECT electricity_per_kwh AS e, water_per_m3 AS w FROM house_rates WHERE house_id = ?`).bind(houseId).first<{ e: number; w: number }>(),
    db.prepare(`SELECT id, name, price, per, max_qty, active FROM house_services WHERE house_id = ? ORDER BY sort, id`).bind(houseId)
      .all<{ id: number; name: string; price: number; per: string; max_qty: number | null; active: number }>(),
  ]);
  return {
    electricPrice: rates?.e ?? 0,
    waterPrice: rates?.w ?? 0,
    services: services.results.map((s) => ({ id: s.id, name: s.name, price: s.price, per: s.per, maxQty: s.max_qty, active: s.active === 1 })),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerAdmin(app: Hono<App>): void {
  for (const path of ['/api/admin/rooms', '/api/admin/rooms/*', '/api/admin/room-detail', '/api/admin/config', '/api/admin/issue-month'])
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

  const readConfig = async (c: Context<App>) => {
    const houseId = pickHouse(c, c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    return c.json({ success: true, config: await loadConfig(await tenantFor(c, houseId), houseId) });
  };
  app.get('/api/admin/config', readConfig);

  /** Saves prices and the service list; only DRAFT invoices of the house are recomputed (issued ones keep their numbers). */
  const saveConfig = async (c: Context<App>) => {
    const body = await readBody(c);
    const houseId = pickHouse(c, body.houseId ?? c.req.query('houseId'));
    if (houseId instanceof Response) return houseId;
    const db = await tenantFor(c, houseId);
    const input: Record<string, any> = body.config && typeof body.config === 'object' ? body.config : body;
    const current = await loadConfig(db, houseId);

    const electric = input.electricPrice === undefined ? current.electricPrice : input.electricPrice;
    const water = input.waterPrice === undefined ? current.waterPrice : input.waterPrice;
    if (!isMoney(electric) || !isMoney(water)) return fail(c, 400, 'RATE_INVALID', 'Đơn giá điện, nước phải là số nguyên đồng từ 0 đến 100.000.000.');
    const services = input.services === undefined ? null : parseServices(input.services);
    if (typeof services === 'string') return fail(c, 400, 'SERVICE_INVALID', services);
    const known = new Set(current.services.map((s) => s.id));
    if (services?.some((s) => s.id !== undefined && !known.has(s.id))) return fail(c, 400, 'SERVICE_INVALID', 'Có dịch vụ không thuộc nhà này.');

    const statements = [
      db.prepare(
        `INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (house_id) DO UPDATE SET electricity_per_kwh = excluded.electricity_per_kwh, water_per_m3 = excluded.water_per_m3, updated_at = excluded.updated_at`
      ).bind(houseId, electric, water),
    ];
    if (services) {
      const kept = services.flatMap((s) => (s.id === undefined ? [] : [s.id]));
      // Services missing from the list are switched off, never deleted: old invoice lines still point at them.
      statements.push(db.prepare(`UPDATE house_services SET active = 0 WHERE house_id = ?${kept.length ? ` AND id NOT IN (${kept.map(() => '?').join(',')})` : ''}`).bind(houseId, ...kept));
      services.forEach((s, i) => {
        statements.push(s.id === undefined
          ? db.prepare(`INSERT INTO house_services (house_id, name, price, per, max_qty, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(houseId, s.name, s.price, s.per, s.maxQty, i, s.active ? 1 : 0)
          : db.prepare(`UPDATE house_services SET name = ?, price = ?, per = ?, max_qty = ?, sort = ?, active = ? WHERE id = ? AND house_id = ?`).bind(s.name, s.price, s.per, s.maxQty, i, s.active ? 1 : 0, s.id, houseId));
      });
    }
    await db.batch(statements);

    let recomputed = 0;
    const recomputeFailed: string[] = [];
    const { results: drafts } = await db.prepare(
      `SELECT i.id, rm.name FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.house_id = ? AND i.issued_at IS NULL AND i.status NOT IN ('paid', 'cash') ORDER BY rm.name`
    ).bind(houseId).all<{ id: number; name: string }>();
    for (const d of drafts) {
      try {
        await recompute(db, d.id, { central: c.env.DB });
        recomputed++;
      } catch (err) {
        if (err instanceof InvoiceLockedError) continue; // a draft marked paid by hand in the meantime stays as it is
        console.warn('[admin] config recompute', houseId, d.id, err);
        recomputeFailed.push(d.name); // the saved config stays saved; the screen is told which drafts to recheck
      }
    }
    await audit(c, actorOf(c.get('viewer')), 'admin_config_save', houseId, `drafts:${recomputed}`);
    const saved = await loadConfig(db, houseId);
    const priceOf = async (col: 'K' | 'L' | 'M') =>
      (await db.prepare(`SELECT price FROM house_services WHERE house_id = ? AND sheet_col = ? AND active = 1 ORDER BY sort LIMIT 1`).bind(houseId, col).first<{ price: number }>())?.price;
    const [rac, net, xe] = await Promise.all([priceOf('K'), priceOf('L'), priceOf('M')]);
    await enqueueExport(c.env.DB, 'config', {
      houseId, month: toSheetMonth(currentMonth()), dien: saved.electricPrice, nuoc: saved.waterPrice,
      ...(rac !== undefined && { rac }), ...(net !== undefined && { net }), ...(xe !== undefined && { xe }),
    });
    return c.json({ success: true, config: await loadConfig(db, houseId), recomputed, recomputeFailed });
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
    const month = pickMonth(c, body.month);
    if (month instanceof Response) return month;
    await tenantFor(c, houseId); // the access check (403 / 404) before anything is read or written
    const { issued, missingMeters } = await issueMonth(c.env, houseId, month, body.force === true);
    if (issued > 0) await audit(c, actorOf(c.get('viewer')), 'admin_issue_month', houseId, `${month}:${issued}`);
    return c.json({ success: true, issued, missingMeters });
  });
}
