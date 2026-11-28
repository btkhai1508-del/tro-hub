/**
 * Invoice lifecycle in the landlord's store: monthly drafts, recomputing an invoice from its inputs,
 * issuing a month and the edit rules. A draft (`issued_at IS NULL`) is invisible to residents; issuing
 * sets `issued_at` and opens the payment gate. Money formulas live in compute.ts; this file only reads the
 * inputs (rooms, meters, rates, services, residents) and writes the result.
 */
import type { Env } from '../app.ts';
import { houseOwner, ownerHouses } from '../central/directory.ts';
import { bankReceived, deferredByRoom, eventReference, type InvoiceStatus } from '../central/deferred.ts';
import { gateStatement } from '../routes/rent.ts';
import { currentMonth } from '../sheetSync.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { isWorkerSource } from './source.ts';
import { prepMonth } from './period.ts';
import { invoicePaidAlert } from './alerts.ts';
import { feeConfigFor, mirrorTemplate } from './fees.ts';
import { computeInvoice, type ServiceFee } from './compute.ts';

// ── Edit rules ─────────────────────────────────────────────────────────────

/** A paid invoice (bank or cash) is locked; any other can still be edited. */
export const canEdit = (inv: { status: InvoiceStatus }): boolean => inv.status !== 'paid' && inv.status !== 'cash';

/** Thrown for a locked invoice; a route answers it with HTTP 409 and this code. */
export class InvoiceLockedError extends Error {
  readonly status = 409;
  readonly code = 'INVOICE_LOCKED';
  constructor() {
    super('Hoá đơn đã đóng tiền nên không sửa được.');
    this.name = 'InvoiceLockedError';
  }
}

/** Thrown when an invoice of an earlier month would be recomputed without `allowPast`. */
export class InvoiceFrozenError extends Error {
  readonly status = 409;
  readonly code = 'INVOICE_FROZEN';
  constructor() {
    super('Hoá đơn của tháng đã qua được giữ nguyên.');
    this.name = 'InvoiceFrozenError';
  }
}

export function assertEditable(inv: { status: InvoiceStatus }): void {
  if (!canEdit(inv)) throw new InvoiceLockedError();
}

/** What `recompute` checks first: locked (paid/cash), then frozen (issued in an earlier month, unless `allowPast`). */
export function assertCanRecompute(inv: { status: InvoiceStatus; issued_at: string | null; month: string }, allowPast = false): void {
  assertEditable(inv);
  if (inv.issued_at !== null && inv.month < currentMonth() && !allowPast) throw new InvoiceFrozenError();
}

// ── Inputs ─────────────────────────────────────────────────────────────────

/**
 * The old meter readings for a room's `month`: the new reading of the most recent EARLIER month that has
 * numbers (a month without numbers, or with an all-zero row, is skipped), per meter. null = never read.
 */
export async function previousReadings(db: TenantDb, roomId: number, month: string): Promise<{ electricOld: number | null; waterOld: number | null }> {
  const one = (col: 'electric_new' | 'water_new') =>
    db.prepare(`SELECT ${col} AS v FROM meter_readings WHERE room_id = ? AND month < ? AND ${col} IS NOT NULL AND ${col} > 0 ORDER BY month DESC LIMIT 1`)
      .bind(roomId, month).first<{ v: number }>();
  const [e, w] = await Promise.all([one('electric_new'), one('water_new')]);
  return { electricOld: e?.v ?? null, waterOld: w?.v ?? null };
}

/**
 * The old reading a month is billed from. With an earlier reading: the row's own old value when > 0, else the
 * earlier month's new reading. With no earlier reading: the row's own old value, 0 included (a brand-new meter
 * starting at 0). null = no row and nothing earlier (never read: usage 0).
 */
export function effectiveOld(rowOld: number | null, previous: number | null): number | null {
  if (previous === null) return rowOld;
  return rowOld !== null && rowOld > 0 ? rowOld : previous;
}

interface InvoiceHead {
  id: number; house_id: string; room_id: number; month: string; status: InvoiceStatus; issued_at: string | null; room: string;
  people: number | null; vehicles: number | null;
}

/** 'YYYY-MM' of a stored move-in date ('dd/mm/yyyy' or 'yyyy-mm-dd'); null when it cannot be read. */
export function moveInMonth(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * The people and vehicles a room is billed for in `month`: approved residents who had moved in by the end of that
 * month (an unreadable or missing move-in date counts, as before). A roommate added while the next month is being
 * prepared moves in today, so they count for this month and the next one alike.
 */
export async function roomHeadcount(db: TenantDb, roomId: number, month: string): Promise<{ people: number; vehicles: number }> {
  const { results } = await db.prepare(
    `SELECT move_in_date, plate_number FROM residents WHERE room_id = ? AND status = 'approved' AND deleted_at IS NULL`
  ).bind(roomId).all<{ move_in_date: string | null; plate_number: string | null }>();
  const inMonth = results.filter((r) => { const m = moveInMonth(r.move_in_date); return m === null || m <= month; });
  return { people: inMonth.length, vehicles: inMonth.filter((r) => String(r.plate_number ?? '').trim().length > 0).length };
}

const LEGACY_COLUMN = { K: 'trash', L: 'internet', M: 'parking' } as const;

export interface RecomputeOptions {
  /** The central D1, to count SePay money still waiting there (deferred). Without it only booked money counts. */
  central?: D1Database;
  /** Allow an issued invoice of an earlier month (default false: those are frozen). */
  allowPast?: boolean;
  /** The room's residents changed: count the people of the month again even on an issued invoice (default: keep its count). */
  recount?: boolean;
}

/**
 * Recomputes one invoice from the room's current inputs and rewrites `invoice_lines`, the legacy money
 * columns and `total`. `deposit` is never touched. Then, for an ISSUED invoice, re-evaluates the status:
 * bank money booked + deferred money covering the total → 'paid' (paid_at set once), otherwise 'unpaid'
 * (a resident's 'pending' claim is kept). A draft keeps its status: its payments are picked up by the first
 * recompute after it is issued. Paid/cash invoices are locked, issued invoices of an earlier month frozen.
 * `surplus` = money received beyond the total (never refunded, computed again on every read).
 *
 * Legacy columns: `trash`/`internet`/`parking` hold the service lines whose `sheet_col` is K/L/M. A service
 * without `sheet_col` is in `invoice_lines` and in `total` but in no legacy column, so `total` can exceed the
 * sum of the legacy columns by exactly the amount of such services.
 */
export async function recompute(db: TenantDb, invoiceId: number, opts: RecomputeOptions = {}): Promise<{ total: number; surplus: number }> {
  const inv = await db.prepare(
    `SELECT i.id, i.house_id, i.room_id, i.month, i.status, i.issued_at, i.people, i.vehicles, rm.name AS room
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.id = ?`
  ).bind(invoiceId).first<InvoiceHead>();
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  assertCanRecompute(inv, opts.allowPast);

  // The fees of the invoice's OWN month (a snapshot; copied forward and stored when the month has none yet).
  const [room, house, fee, meter, optouts, people] = await Promise.all([
    db.prepare(`SELECT price FROM rooms WHERE id = ?`).bind(inv.room_id).first<{ price: number }>(),
    db.prepare(`SELECT actual_electric_price AS p FROM houses WHERE id = ?`).bind(inv.house_id).first<{ p: number | null }>(),
    feeConfigFor(db, inv.house_id, inv.month),
    db.prepare(`SELECT electric_old, electric_new, water_old, water_new FROM meter_readings WHERE room_id = ? AND month = ?`)
      .bind(inv.room_id, inv.month).first<{ electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null }>(),
    db.prepare(`SELECT service_id FROM room_service_optouts WHERE room_id = ?`).bind(inv.room_id).all<{ service_id: number }>(),
    // People of the invoice's month: an issued invoice keeps the count it was issued with; a draft (or an invoice
    // from before the count was stored) counts the residents of that month.
    inv.issued_at !== null && inv.people !== null && !opts.recount
      ? Promise.resolve({ people: inv.people, vehicles: inv.vehicles ?? 0 })
      : roomHeadcount(db, inv.room_id, inv.month),
  ]);
  const out = new Set(optouts.results.map((o) => o.service_id));
  const fees: ServiceFee[] = fee.services
    .filter((s) => s.active && !out.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, price: s.price, per: s.per, maxQty: s.maxQty, sheetCol: s.sheetCol }));

  // A month with no reading row yet: nothing new to charge.
  // The old columns default to 0, so a row written with only new readings must not bill the whole reading:
  // an old value is used only when it is > 0, otherwise the earlier months decide.
  const prev = meter && (meter.electric_old ?? 0) > 0 && (meter.water_old ?? 0) > 0 ? null : await previousReadings(db, inv.room_id, inv.month);
  const before = {
    electricOld: effectiveOld(meter ? meter.electric_old : null, prev?.electricOld ?? null),
    waterOld: effectiveOld(meter ? meter.water_old : null, prev?.waterOld ?? null),
  };
  const calc = computeInvoice({
    rent: room?.price ?? 0,
    electricOld: before.electricOld, electricNew: meter?.electric_new ?? null,
    waterOld: before.waterOld, waterNew: meter?.water_new ?? null,
    electricPrice: fee.electricPrice, waterPrice: fee.waterPrice, actualElectricPrice: house?.p ?? null,
    services: fees, people: people.people, vehicles: people.vehicles,
  });

  const legacy = { trash: 0, internet: 0, parking: 0 };
  const colOf = new Map(fees.map((f) => [f.id, f.sheetCol]));
  for (const l of calc.lines) {
    const col = l.kind === 'service' && l.serviceId !== null ? colOf.get(l.serviceId) : null;
    if (col) legacy[LEGACY_COLUMN[col]] += l.amount;
  }
  const amountOf = (kind: string) => calc.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);

  await db.batch([
    db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).bind(inv.id),
    ...calc.lines.map((l) =>
      db.prepare(`INSERT INTO invoice_lines (invoice_id, kind, service_id, name, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(inv.id, l.kind, l.serviceId, l.name, l.qty, l.unitPrice, l.amount)
    ),
    db.prepare(
      `UPDATE invoices SET room_rent = ?, electricity = ?, water = ?, other = ?, trash = ?, internet = ?, parking = ?, total = ?, people = ?, vehicles = ? WHERE id = ?`
    ).bind(amountOf('room'), amountOf('electricity'), amountOf('water'), amountOf('other'), legacy.trash, legacy.internet, legacy.parking, calc.total,
      people.people, people.vehicles, inv.id),
  ]);

  const bank = await bankReceived(db, inv.id);
  const waiting = opts.central ? ((await deferredByRoom(opts.central, inv.house_id, inv.month, db)).get(inv.room) ?? 0) : 0;
  const received = bank + waiting;
  if (inv.issued_at !== null) {
    // Guarded writes: a paid/cash set by someone else after our read is never overwritten.
    if (received > 0 && received >= calc.total) {
      // paid_at = when SePay received the last bank transfer (the one that covered the total), not when we noticed.
      const r = await db.prepare(
        `UPDATE invoices SET status = 'paid', status_by = 'recompute',
                paid_at = COALESCE(paid_at, (SELECT MAX(paid_at) FROM payments WHERE invoice_id = ?1 AND method = 'bank'), datetime('now'))
          WHERE id = ?1 AND status NOT IN ('paid', 'cash')`
      ).bind(inv.id).run();
      if (r.meta?.changes) await invoicePaidAlert(db, inv.id, 'recompute');
    } else if (inv.status !== 'pending' && inv.status !== 'unpaid') {
      await db.prepare(`UPDATE invoices SET status = 'unpaid', paid_at = NULL WHERE id = ? AND status NOT IN ('paid', 'cash')`).bind(inv.id).run();
    }
  }
  return { total: calc.total, surplus: Math.max(received - calc.total, 0) };
}

/** Recomputes the DRAFT invoices (not issued, not paid by hand) of one house and month; failures are listed, never thrown. */
export async function recomputeDrafts(db: TenantDb, central: D1Database, houseId: string, month: string): Promise<{ recomputed: number; failed: string[] }> {
  let recomputed = 0;
  const failed: string[] = [];
  const { results: drafts } = await db.prepare(
    `SELECT i.id, rm.name FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.house_id = ? AND i.month = ? AND i.issued_at IS NULL AND i.status NOT IN ('paid', 'cash') ORDER BY rm.name`
  ).bind(houseId, month).all<{ id: number; name: string }>();
  for (const d of drafts) {
    try {
      await recompute(db, d.id, { central });
      recomputed++;
    } catch (err) {
      if (err instanceof InvoiceLockedError) continue; // a draft marked paid by hand in the meantime stays as it is
      console.warn('[invoices] draft recompute', houseId, d.id, err);
      failed.push(d.name);
    }
  }
  return { recomputed, failed };
}

// ── Drafts ─────────────────────────────────────────────────────────────────

/** Rooms of a house that have an approved resident and no invoice for `month` (optionally only one room). */
async function roomsNeedingDraft(db: TenantDb, houseId: string, month: string, roomId?: number): Promise<number[]> {
  const { results } = await db.prepare(
    `SELECT rm.id FROM rooms rm
      WHERE rm.house_id = ? AND rm.deleted_at IS NULL${roomId === undefined ? '' : ' AND rm.id = ?'}
        AND EXISTS (SELECT 1 FROM residents r WHERE r.room_id = rm.id AND r.status = 'approved' AND r.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.room_id = rm.id AND i.month = ?)
      ORDER BY rm.name`
  ).bind(...(roomId === undefined ? [houseId, month] : [houseId, roomId, month])).all<{ id: number }>();
  return results.map((r) => r.id);
}

async function draftFor(db: TenantDb, houseId: string, roomId: number, month: string, central?: D1Database): Promise<boolean> {
  // UNIQUE (room_id, month) makes a concurrent second insert a no-op.
  const ins = await db.prepare(`INSERT OR IGNORE INTO invoices (house_id, room_id, month, status, issued_at) VALUES (?, ?, ?, 'unpaid', NULL)`)
    .bind(houseId, roomId, month).run();
  if (!ins.meta.changes) return false;
  const row = await db.prepare(`SELECT id FROM invoices WHERE room_id = ? AND month = ?`).bind(roomId, month).first<{ id: number }>();
  try {
    await recompute(db, row!.id, { central });
  } catch (err) {
    // Never leave a zero-total shell behind: remove it so the next run builds the draft again.
    await db.batch([
      db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).bind(row!.id),
      db.prepare(`DELETE FROM invoices WHERE id = ? AND issued_at IS NULL AND NOT EXISTS (SELECT 1 FROM payments WHERE invoice_id = invoices.id)`).bind(row!.id),
    ]).catch(() => {});
    throw err;
  }
  return true;
}

/**
 * Monthly drafts for every house of the landlord. First each active house gets its fee snapshot for `month`
 * (copied forward from the previous month when missing), so the new month starts from the previous month's
 * fees. `made` = drafts created, `failed` = houses/rooms that could not be handled (retried by the next run).
 */
export async function createDraftsDetailed(env: Env, ownerId: number, month: string): Promise<{ made: number; failed: number }> {
  const db = await tenantOfOwner(env, ownerId);
  let made = 0;
  let failed = 0;
  for (const h of await ownerHouses(env.DB, ownerId)) {
    if (h.status !== 'active') continue;
    try {
      const fee = await feeConfigFor(db, h.house_id, month);
      if (month === currentMonth()) await db.batch(mirrorTemplate(db, h.house_id, fee)); // the template follows the current month
    } catch (err) {
      failed++;
      console.warn('[invoices] fee snapshot', h.house_id, month, err);
      continue; // without the month's fees a draft would be priced from the wrong ones
    }
    for (const roomId of await roomsNeedingDraft(db, h.house_id, month)) {
      try {
        if (await draftFor(db, h.house_id, roomId, month, env.DB)) made++;
      } catch (err) {
        failed++;
        console.warn('[invoices] draft', h.house_id, roomId, month, err); // one failing room does not stop the others
      }
    }
  }
  return { made, failed };
}

/** Monthly drafts for every house of the landlord; returns how many were created. */
export async function createDrafts(env: Env, ownerId: number, month: string): Promise<number> {
  return (await createDraftsDetailed(env, ownerId, month)).made;
}

/**
 * The invoice of a room for `month`, making its draft first when there is none and the room has an approved
 * resident. null = no invoice and none to make (an empty room). Not tied to the source switch: the admin API decides.
 */
export async function ensureDraft(db: TenantDb, houseId: string, roomId: number, month: string, central?: D1Database): Promise<number | null> {
  for (const id of await roomsNeedingDraft(db, houseId, month, roomId)) await draftFor(db, houseId, id, month, central);
  const row = await db.prepare(`SELECT id FROM invoices WHERE room_id = ? AND month = ?`).bind(roomId, month).first<{ id: number }>();
  return row?.id ?? null;
}

/**
 * The residents of a room changed (someone approved, added, moved out): when the Worker owns the invoices, the room's
 * invoice of the current month and, during the last 5 days, of the month being prepared is made (a draft) when missing
 * and an open one is priced again with the new count. A paid/cash invoice stays as it is. No-op on the old Sheet flow.
 */
export async function ensureDraftForRoom(env: Env, ownerId: number, houseId: string, roomId: number): Promise<void> {
  if (!(await isWorkerSource(env.DB))) return;
  const db = await tenantOfOwner(env, ownerId);
  const months = [currentMonth(), prepMonth(Date.now())].filter((m): m is string => !!m);
  for (const month of months) {
    const inv = await db.prepare(`SELECT id FROM invoices WHERE room_id = ? AND month = ?`).bind(roomId, month).first<{ id: number }>();
    if (!inv) {
      for (const id of await roomsNeedingDraft(db, houseId, month, roomId)) await draftFor(db, houseId, id, month, env.DB);
      continue;
    }
    await recompute(db, inv.id, { central: env.DB, recount: true }).catch((err) => {
      if (!(err instanceof InvoiceLockedError) && !(err instanceof InvoiceFrozenError)) throw err;
    });
  }
}

// ── Issuing ────────────────────────────────────────────────────────────────

/**
 * Issues the drafts of a house for `month`: `issued_at` is set, the payment gate (house, month) becomes
 * START, and every invoice is recomputed (meters may have changed; money received while it was a draft now
 * decides its status). Without `force`, rooms that still miss new meter readings stop it: nothing changes
 * and their names are returned. `missingMeters` is informational when forced.
 */
export interface IssueOptions {
  /** Room names the admin ticked (older screens). */
  rooms?: string[];
  /** Room ids the admin ticked; the route checks they belong to the house. */
  roomIds?: number[];
  /** Who issues (written on the residents' notices). */
  actor?: string;
}

export async function issueMonth(env: Env, houseId: string, month: string, force: boolean, opts: IssueOptions = {}): Promise<{ issued: number; missingMeters: string[] }> {
  const ownerId = await houseOwner(env.DB, houseId);
  if (ownerId === null) throw new Error(`House ${houseId} not found`);
  const db = await tenantOfOwner(env, ownerId);
  const { results: allDrafts } = await db.prepare(
    `SELECT i.id, i.room_id, rm.name, i.status, (m.room_id IS NULL OR m.electric_new IS NULL OR m.water_new IS NULL OR (m.electric_new = 0 AND m.water_new = 0)) AS missing
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id
       LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id = ? AND i.month = ? AND i.issued_at IS NULL ORDER BY rm.name`
  ).bind(houseId, month).all<{ id: number; room_id: number; name: string; status: InvoiceStatus; missing: number }>();
  // `roomIds` / `rooms` narrow to the rooms the admin ticked; without them every draft of the house is issued.
  const ids = opts.roomIds?.length ? new Set(opts.roomIds) : null;
  const names = !ids && opts.rooms?.length ? new Set(opts.rooms) : null;
  const drafts = ids ? allDrafts.filter((d) => ids.has(d.room_id)) : names ? allDrafts.filter((d) => names.has(d.name)) : allDrafts;
  const missingMeters = drafts.filter((d) => d.missing).map((d) => d.name);
  if (!drafts.length || (!force && missingMeters.length)) return { issued: 0, missingMeters };

  // 1) Recompute every draft first (a draft keeps its status; a failure here changes nothing visible).
  for (const d of drafts) {
    // A draft a manager already marked paid by hand is locked: it is issued as it is.
    await recompute(db, d.id, { central: env.DB, allowPast: true }).catch((err) => { if (!(err instanceof InvoiceLockedError)) throw err; });
  }
  // 2) One atomic batch: every invoice gets issued_at together with its status and the gate opens, so there is no
  //    moment where a visible invoice has a stale status. "Covered" = bank money booked (read live inside the
  //    statement) + SePay events still waiting centrally. A tenant batch cannot read central sepay_events, so the open
  //    events are read here, right before the batch, and each one is counted only while its payment row `sepay-<id>`
  //    is NOT in payments (checked inside the statement, like deferredByRoom): a replay that books it meanwhile
  //    cannot be counted twice.
  //    Not covered: a draft created after the SELECT above stays a draft after START; ensureDraftForRoom / the cron
  //    pick it up on their next run and the next issueMonth issues it.
  const statements: ReturnType<TenantDb['prepare']>[] = [];
  for (const d of drafts) {
    const { results: events } = await env.DB.prepare(
      `SELECT sepay_id, amount FROM sepay_events WHERE house_id = ? AND month = ? AND room = ? AND status IN ('deferred', 'replaying') AND kind = 'rent'`
    ).bind(houseId, month, d.name).all<{ sepay_id: string; amount: number }>();
    const params: (string | number)[] = [];
    // The parameters are pushed in the textual order of the statement below.
    const received = () => {
      params.push(...events.flatMap((ev) => [eventReference(ev.sepay_id), ev.amount ?? 0]));
      return `((SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = invoices.id AND method = 'bank')` +
        events.map(() => ` + (CASE WHEN NOT EXISTS (SELECT 1 FROM payments WHERE reference = ?) THEN ? ELSE 0 END)`).join('') + `)`;
    };
    const covered = () => `status NOT IN ('paid', 'cash') AND ${received()} > 0 AND ${received()} >= total`;
    const sql = `UPDATE invoices SET issued_at = datetime('now'),
           status = CASE WHEN ${covered()} THEN 'paid' ELSE status END,
           paid_at = CASE WHEN ${covered()} THEN COALESCE(paid_at, datetime('now')) ELSE paid_at END,
           status_by = CASE WHEN ${covered()} THEN 'issue' ELSE status_by END
         WHERE id = ? AND issued_at IS NULL`;
    params.push(d.id);
    statements.push(db.prepare(sql).bind(...params));
  }
  await db.batch([...statements, gateStatement(db, houseId, month, 'START', 'issue')]);
  await afterIssue(db, houseId, month, drafts.map((d) => d.id), opts.actor ?? 'system');
  return { issued: drafts.length, missingMeters };
}

const vnMoney = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
const sheetMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/**
 * After issuing: one payment notice per issued invoice for the residents of its room (every resident of the room
 * sees exactly one; the key `invoice-issued:<id>` makes a second press or a retry add nothing), and a bell alert for
 * the invoices that money received while they were drafts already paid. Failures are logged, never thrown: the
 * invoices are issued either way.
 */
async function afterIssue(db: TenantDb, houseId: string, month: string, invoiceIds: number[], actor: string): Promise<void> {
  if (!invoiceIds.length) return;
  try {
    const { results } = await db.prepare(
      `SELECT i.id, i.total, i.status, i.status_by, rm.name AS room FROM invoices i JOIN rooms rm ON rm.id = i.room_id
        WHERE i.id IN (${invoiceIds.map(() => '?').join(',')}) AND i.issued_at IS NOT NULL`
    ).bind(...invoiceIds).all<{ id: number; total: number; status: InvoiceStatus; status_by: string | null; room: string }>();
    const label = sheetMonth(month);
    const notices = results.filter((r) => r.status !== 'paid' && r.status !== 'cash').map((r) => db.prepare(
      `INSERT OR IGNORE INTO notifications (house_id, room_names, title, content, type, sender, created_by, dedupe_key)
       VALUES (?, ?, ?, ?, 'invoice', 'Ban Quản Lý', ?, ?)`
    ).bind(houseId, JSON.stringify([r.room]), `Thông báo thanh toán tiền phòng tháng ${label}`,
      `Hoá đơn tháng ${label} của phòng ${r.room}: tổng ${vnMoney(r.total)}. Quý cư dân vui lòng mở ứng dụng để xem chi tiết và thanh toán.`,
      actor, `invoice-issued:${r.id}`));
    for (let i = 0; i < notices.length; i += 50) await db.batch(notices.slice(i, i + 50));
    for (const r of results) if (r.status === 'paid' && r.status_by === 'issue') await invoicePaidAlert(db, r.id, 'issue');
  } catch (err) {
    console.warn('[invoices] after issue', houseId, month, err);
  }
}
