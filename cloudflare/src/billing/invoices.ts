/**
 * Invoice lifecycle in the landlord's store: monthly drafts, recomputing an invoice from its inputs,
 * issuing a month and the edit rules. A draft (`issued_at IS NULL`) is invisible to residents; issuing
 * sets `issued_at` and opens the payment gate. Money formulas live in compute.ts; this file only reads the
 * inputs (rooms, meters, rates, services, residents) and writes the result.
 */
import type { Env } from '../app.ts';
import { houseOwner, ownerHouses } from '../central/directory.ts';
import { bankReceived, deferredByRoom, type InvoiceStatus } from '../central/deferred.ts';
import { gateStatement } from '../routes/rent.ts';
import { currentMonth } from '../sheetSync.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { isWorkerSource } from './source.ts';
import { computeInvoice, type Per, type ServiceFee } from './compute.ts';

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

interface ServiceRow { id: number; name: string; price: number; per: Per; max_qty: number | null; sheet_col: 'K' | 'L' | 'M' | null }

interface InvoiceHead { id: number; house_id: string; room_id: number; month: string; status: InvoiceStatus; issued_at: string | null; room: string }

const LEGACY_COLUMN = { K: 'trash', L: 'internet', M: 'parking' } as const;

export interface RecomputeOptions {
  /** The central D1, to count SePay money still waiting there (deferred). Without it only booked money counts. */
  central?: D1Database;
  /** Allow an issued invoice of an earlier month (default false: those are frozen). */
  allowPast?: boolean;
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
    `SELECT i.id, i.house_id, i.room_id, i.month, i.status, i.issued_at, rm.name AS room
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.id = ?`
  ).bind(invoiceId).first<InvoiceHead>();
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  assertEditable(inv);
  if (inv.issued_at !== null && inv.month < currentMonth() && !opts.allowPast) throw new InvoiceFrozenError();

  const [room, house, rates, meter, services, optouts, people] = await Promise.all([
    db.prepare(`SELECT price FROM rooms WHERE id = ?`).bind(inv.room_id).first<{ price: number }>(),
    db.prepare(`SELECT actual_electric_price AS p FROM houses WHERE id = ?`).bind(inv.house_id).first<{ p: number | null }>(),
    db.prepare(`SELECT electricity_per_kwh AS e, water_per_m3 AS w FROM house_rates WHERE house_id = ?`).bind(inv.house_id).first<{ e: number; w: number }>(),
    db.prepare(`SELECT electric_old, electric_new, water_old, water_new FROM meter_readings WHERE room_id = ? AND month = ?`)
      .bind(inv.room_id, inv.month).first<{ electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null }>(),
    db.prepare(`SELECT id, name, price, per, max_qty, sheet_col FROM house_services WHERE house_id = ? AND active = 1 ORDER BY sort, id`).bind(inv.house_id).all<ServiceRow>(),
    db.prepare(`SELECT service_id FROM room_service_optouts WHERE room_id = ?`).bind(inv.room_id).all<{ service_id: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS people, COALESCE(SUM(CASE WHEN LENGTH(TRIM(COALESCE(plate_number, ''))) > 0 THEN 1 ELSE 0 END), 0) AS vehicles
         FROM residents WHERE room_id = ? AND status = 'approved' AND deleted_at IS NULL`
    ).bind(inv.room_id).first<{ people: number; vehicles: number }>(),
  ]);
  const out = new Set(optouts.results.map((o) => o.service_id));
  const fees: ServiceFee[] = services.results
    .filter((s) => !out.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, price: s.price, per: s.per, maxQty: s.max_qty, sheetCol: s.sheet_col }));

  // A month with no reading row yet: nothing new to charge, the old numbers come from the earlier months.
  const before = meter ? { electricOld: meter.electric_old, waterOld: meter.water_old } : await previousReadings(db, inv.room_id, inv.month);
  const calc = computeInvoice({
    rent: room?.price ?? 0,
    electricOld: before.electricOld, electricNew: meter?.electric_new ?? null,
    waterOld: before.waterOld, waterNew: meter?.water_new ?? null,
    electricPrice: rates?.e ?? 0, waterPrice: rates?.w ?? 0, actualElectricPrice: house?.p ?? null,
    services: fees, people: people?.people ?? 0, vehicles: people?.vehicles ?? 0,
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
      `UPDATE invoices SET room_rent = ?, electricity = ?, water = ?, other = ?, trash = ?, internet = ?, parking = ?, total = ? WHERE id = ?`
    ).bind(amountOf('room'), amountOf('electricity'), amountOf('water'), amountOf('other'), legacy.trash, legacy.internet, legacy.parking, calc.total, inv.id),
  ]);

  const bank = await bankReceived(db, inv.id);
  const waiting = opts.central ? ((await deferredByRoom(opts.central, inv.house_id, inv.month, db)).get(inv.room) ?? 0) : 0;
  const received = bank + waiting;
  if (inv.issued_at !== null) {
    if (received > 0 && received >= calc.total) {
      await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, datetime('now')), status_by = 'recompute' WHERE id = ?`).bind(inv.id).run();
    } else if (inv.status !== 'pending') {
      await db.prepare(`UPDATE invoices SET status = 'unpaid', paid_at = NULL WHERE id = ?`).bind(inv.id).run();
    }
  }
  return { total: calc.total, surplus: Math.max(received - calc.total, 0) };
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
  await recompute(db, row!.id, { central });
  return true;
}

/** Monthly drafts for every house of the landlord; returns how many were created. */
export async function createDrafts(env: Env, ownerId: number, month: string): Promise<number> {
  const db = await tenantOfOwner(env, ownerId);
  let made = 0;
  for (const h of await ownerHouses(env.DB, ownerId)) {
    if (h.status !== 'active') continue;
    for (const roomId of await roomsNeedingDraft(db, h.house_id, month)) if (await draftFor(db, h.house_id, roomId, month, env.DB)) made++;
  }
  return made;
}

/**
 * A resident was approved into a room: when the Worker owns the invoices and the room has none for the
 * current month, make its draft. No-op on the old Sheet flow.
 */
export async function ensureDraftForRoom(env: Env, ownerId: number, houseId: string, roomId: number): Promise<void> {
  if (!(await isWorkerSource(env.DB))) return;
  const db = await tenantOfOwner(env, ownerId);
  const month = currentMonth();
  for (const id of await roomsNeedingDraft(db, houseId, month, roomId)) await draftFor(db, houseId, id, month, env.DB);
}

// ── Issuing ────────────────────────────────────────────────────────────────

/**
 * Issues the drafts of a house for `month`: `issued_at` is set, the payment gate (house, month) becomes
 * START, and every invoice is recomputed (meters may have changed; money received while it was a draft now
 * decides its status). Without `force`, rooms that still miss new meter readings stop it: nothing changes
 * and their names are returned. `missingMeters` is informational when forced.
 */
export async function issueMonth(env: Env, houseId: string, month: string, force: boolean): Promise<{ issued: number; missingMeters: string[] }> {
  const ownerId = await houseOwner(env.DB, houseId);
  if (ownerId === null) throw new Error(`House ${houseId} not found`);
  const db = await tenantOfOwner(env, ownerId);
  const { results: drafts } = await db.prepare(
    `SELECT i.id, rm.name, (m.room_id IS NULL OR m.electric_new IS NULL OR m.water_new IS NULL) AS missing
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id
       LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
      WHERE i.house_id = ? AND i.month = ? AND i.issued_at IS NULL ORDER BY rm.name`
  ).bind(houseId, month).all<{ id: number; name: string; missing: number }>();
  const missingMeters = drafts.filter((d) => d.missing).map((d) => d.name);
  if (!drafts.length || (!force && missingMeters.length)) return { issued: 0, missingMeters };

  await db.batch([
    db.prepare(`UPDATE invoices SET issued_at = datetime('now') WHERE house_id = ? AND month = ? AND issued_at IS NULL`).bind(houseId, month),
    gateStatement(db, houseId, month, 'START', 'issue'),
  ]);
  for (const d of drafts) {
    // A draft a manager already marked paid by hand is locked: it is issued as it is.
    await recompute(db, d.id, { central: env.DB, allowPast: true }).catch((err) => { if (!(err instanceof InvoiceLockedError)) throw err; });
  }
  return { issued: drafts.length, missingMeters };
}
