/**
 * Booking SePay rent transfers into a landlord's store.
 *
 * Normal path: `settleRent` writes the payment and marks the invoice paid. While the landlord's data is
 * being moved (`migrating`) the store is read-only, so `deferRent` keeps the transfer centrally as
 * `sepay_events.status = 'deferred'` (the payment-status APIs already count it) and `replayDeferred`
 * books it once the move is over. Money is never booked twice: payments.reference is UNIQUE and every
 * insert is INSERT OR IGNORE.
 */
import type { Env } from '../app.ts';
import { getStorage } from '../central/directory.ts';
import { bankReceived, deferredByRoom, eventReference } from '../central/deferred.ts';
import { allocate, openInvoices } from '../billing/roomDue.ts';
import { addAlert, invoicePaidAlert } from '../billing/alerts.ts';
import { invoiceFor, invoiceOrSync } from '../routes/rent.ts';
import { paintSheetPayment } from '../sheetSync.ts';
import { TenantLockedError, tenantOfOwner } from '../tenant/route.ts';

export interface SepayTransfer {
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

/** SePay writes Vietnam time ("2026-11-17 20:10:00"); stored times are UTC like datetime('now'). */
export function vnTimeToUtc(text: string | undefined) {
  const m = String(text ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const at = m ? Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+07:00`) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString().replace('T', ' ').slice(0, 19) : null;
}

/** When SePay received the money, stored as UTC "YYYY-MM-DD HH:MM:SS"; an ISO time is converted, anything else is now. */
export function receivedAtUtc(text: string | undefined): string {
  const vn = vnTimeToUtc(text);
  if (vn) return vn;
  const at = Date.parse(String(text ?? ''));
  return new Date(Number.isFinite(at) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(String(text)) ? at : Date.now()).toISOString().replace('T', ' ').slice(0, 19);
}

export type SettleResult =
  | { settled: false; reason: 'room' }
  | { settled: false; reason: 'invoice' }
  | { settled: false; reason: 'draft'; invoiceId: number; received: number; total: number }
  | { settled: false; reason: 'short'; invoiceId: number; received: number; total: number }
  | { settled: true; already?: true; invoiceId: number; received: number; total: number };

/** A transfer that no house could be found for: kept centrally so the landlord can see it. */
export function unassignedStatement(env: Env, t: SepayTransfer, sepayId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO unassigned_payments (sepay_id, amount, content, account_no, bank_name, reference, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(sepayId, Math.round(Number(t.transferAmount) || 0), String(t.content ?? '').slice(0, 300), t.accountNumber ?? null,
    t.gateway ?? null, t.referenceCode || `sepay-${sepayId}`, t.transactionDate ?? new Date().toISOString());
}

export async function recordUnassigned(env: Env, t: SepayTransfer, sepayId: string): Promise<void> {
  await unassignedStatement(env, t, sepayId).run();
}

/**
 * Records the transfer in the landlord's store and marks invoices paid once their money reaches their total.
 * Payment follows the printed "Tổng cộng" (earlier debt + this month): the money pays the room's earlier
 * open invoices first, oldest first, and what is left goes to the month's own invoice (an overpayment stays
 * there). Each part is one payment row: the first is `sepay-<id>` (what the deferred overlay looks for), the
 * others `sepay-<id>#<invoiceId>`. A transfer already booked (any of those rows) is never split again, so a
 * direct booking, a retry and a replay of the same event book it once; marking and painting the old Sheet's
 * cell are idempotent and run again.
 */
export async function settleRent(
  env: Env, ownerId: number, houseId: string, room: string, month: string, t: SepayTransfer, sepayId: string,
): Promise<SettleResult> {
  const db = await tenantOfOwner(env, ownerId);
  const roomRow = await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room).first<{ id: number }>();
  if (!roomRow) return { settled: false, reason: 'room' };
  const inv = await invoiceOrSync(db, env.DB, roomRow.id, month);
  const amount = Math.round(Number(t.transferAmount) || 0);
  const anchor = eventReference(sepayId);
  const paidAt = receivedAtUtc(t.transactionDate);
  const older = (await openInvoices(db, roomRow.id, month)).filter((o) => o.month < month);
  const booked = await db.prepare(`SELECT 1 AS one FROM payments WHERE reference = ? OR reference LIKE ? LIMIT 1`).bind(anchor, `${anchor}#%`).first();
  // Money into an invoice the resident already paid (issued and paid/cash before this transfer): the landlord is told (tiền thừa).
  const wasPaid = !!inv && inv.issued_at !== null && (inv.status === 'paid' || inv.status === 'cash');
  if (!booked) {
    const parts = allocate(amount, older, inv?.id ?? null);
    const rows = parts.map((p, i) => db.prepare(
      `INSERT OR IGNORE INTO payments (house_id, invoice_id, amount, method, bank_name, account_no, reference, content, paid_at, confirmed_by)
       VALUES (?, ?, ?, 'bank', ?, ?, ?, ?, ?, 'sepay')`
    ).bind(houseId, p.invoiceId, p.amount, t.gateway ?? null, t.accountNumber ?? null, i === 0 ? anchor : `${anchor}#${p.invoiceId ?? 'none'}`,
      String(t.content ?? '').slice(0, 300), paidAt));
    // Several parts are written together (all or none); the usual single part is one plain insert.
    if (rows.length === 1) await rows[0].run();
    else await db.batch(rows);
    const onInvoice = parts.filter((p) => inv && p.invoiceId === inv.id).reduce((sum, p) => sum + p.amount, 0);
    if (wasPaid && onInvoice > 0) {
      await addAlert(db, {
        houseId, kind: 'overpaid', room, month, invoiceId: inv!.id, amount: onInvoice, receivedAt: paidAt, source: 'sepay', key: `sepay:${sepayId}`,
      });
    }
  }
  // Earlier invoices this money (or an earlier run of it) covered: marked paid, Sheet painted.
  for (const o of older) {
    if ((await bankReceived(db, o.id)) < o.total) continue;
    const r = await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, status_by = 'sepay' WHERE id = ? AND status NOT IN ('paid', 'cash')`)
      .bind(paidAt, o.id).run();
    if (r.meta?.changes) {
      await invoicePaidAlert(db, o.id, 'sepay', paidAt);
      await paintSheetPayment(env, houseId, room, true, o.month, o.sheet_row);
    }
  }
  if (!inv) return { settled: false, reason: 'invoice' };
  const received = await bankReceived(db, inv.id);
  // A draft is not yet billed to the resident: the money is kept, the status waits for issuing (issueMonth re-evaluates it).
  // Read AFTER the insert: an issue that ran between our first read and the insert has already summed the money
  // without this payment, so the invoice must be treated as issued here; an issue that comes later sums it itself.
  const issuedAt = (await db.prepare(`SELECT issued_at FROM invoices WHERE id = ?`).bind(inv.id).first<{ issued_at: string | null }>())?.issued_at ?? null;
  if (issuedAt === null) return { settled: false, reason: 'draft', invoiceId: inv.id, received, total: inv.total };
  const cur = await db.prepare(`SELECT status FROM invoices WHERE id = ?`).bind(inv.id).first<{ status: typeof inv.status }>();
  if (cur) inv.status = cur.status;
  if (inv.status === 'paid' || inv.status === 'cash') return { settled: true, already: true, invoiceId: inv.id, received, total: inv.total };
  if (received < inv.total) return { settled: false, reason: 'short', invoiceId: inv.id, received, total: inv.total };
  await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, status_by = 'sepay' WHERE id = ?`)
    .bind(paidAt, inv.id).run();
  await invoicePaidAlert(db, inv.id, 'sepay', paidAt);
  await paintSheetPayment(env, houseId, room, true, month, inv.sheet_row);
  return { settled: true, invoiceId: inv.id, received, total: inv.total };
}

/**
 * The landlord's store cannot take writes: keep the transfer as 'deferred' (the status APIs count it).
 * When this transfer is the one that brings bank money + deferred money up to the invoice total, the
 * old Sheet is painted "paid" once, so the Express/Sheet admin pages agree while the move lasts.
 */
export async function deferRent(env: Env, ownerId: number, houseId: string, room: string, month: string, sepayId: string): Promise<void> {
  await env.DB.prepare(`UPDATE sepay_events SET status = 'deferred' WHERE sepay_id = ?`).bind(sepayId).run();
  const event = await env.DB.prepare(`SELECT amount FROM sepay_events WHERE sepay_id = ?`).bind(sepayId).first<{ amount: number }>();
  const db = await tenantOfOwner(env, ownerId); // reads only
  const roomRow = await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room).first<{ id: number }>();
  const inv = roomRow ? await invoiceFor(db, roomRow.id, month) : null;
  if (!inv || inv.issued_at === null || inv.status === 'paid' || inv.status === 'cash') return; // a draft is never painted
  const total = (await bankReceived(db, inv.id)) + ((await deferredByRoom(env.DB, houseId, month, db)).get(room) ?? 0);
  // Only the transfer that crosses the line paints, so each event paints at most once.
  if (total >= inv.total && total - (event?.amount ?? 0) < inv.total) await paintSheetPayment(env, houseId, room, true, month, inv.sheet_row);
}

interface DeferredRow { sepay_id: string; amount: number; content: string | null; account_no: string | null; house_id: string; room: string; month: string; paid_at: string | null }

/**
 * Books every deferred transfer of a landlord into the store. Order matters: the event leaves
 * 'deferred' (to 'replaying', which no status API counts) BEFORE the payment is written, so the money
 * is never counted twice; a crash in between leaves 'replaying', which the next run picks up again.
 * Booking is idempotent (INSERT OR IGNORE on a stable reference), so a second run books nothing.
 * Returns how many events were processed.
 */
export async function replayDeferred(env: Env, ownerId: number): Promise<number> {
  if ((await getStorage(env.DB, ownerId)).backend === 'migrating') return 0;
  const { results } = await env.DB.prepare(
    `SELECT sepay_id, amount, content, account_no, house_id, room, month, paid_at FROM sepay_events
      WHERE status IN ('deferred', 'replaying') AND kind = 'rent' AND room IS NOT NULL AND month IS NOT NULL
        AND house_id IN (SELECT house_id FROM house_directory WHERE owner_id = ?)
      ORDER BY created_at, rowid`
  ).bind(ownerId).all<DeferredRow>();
  let done = 0;
  for (const e of results) {
    await env.DB.prepare(`UPDATE sepay_events SET status = 'replaying' WHERE sepay_id = ?`).bind(e.sepay_id).run();
    const t: SepayTransfer = { id: e.sepay_id, transferAmount: e.amount, content: e.content ?? '', accountNumber: e.account_no ?? undefined, transactionDate: e.paid_at ?? undefined };
    try {
      const r = await settleRent(env, ownerId, e.house_id, e.room, e.month, t, e.sepay_id);
      if (!r.settled && r.reason === 'room') await recordUnassigned(env, t, e.sepay_id);
    } catch (err) {
      // A lock refuses the first write, so nothing was booked: count the money again, as before.
      // Any other failure may have booked it already, so the event stays 'replaying' for the next run.
      if (err instanceof TenantLockedError) {
        await env.DB.prepare(`UPDATE sepay_events SET status = 'deferred' WHERE sepay_id = ? AND status = 'replaying'`).bind(e.sepay_id).run().catch(() => {});
        return done;
      }
      throw err;
    }
    await env.DB.prepare(`UPDATE sepay_events SET status = 'done' WHERE sepay_id = ?`).bind(e.sepay_id).run();
    done++;
  }
  return done;
}

/** For the cron: replays every landlord that has waiting transfers and is no longer being moved. */
export async function replayPendingDeferred(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT d.owner_id FROM sepay_events e JOIN house_directory d ON d.house_id = e.house_id
      WHERE e.status IN ('deferred', 'replaying') AND e.kind = 'rent'`
  ).all<{ owner_id: number }>();
  let total = 0;
  for (const { owner_id } of results) {
    if ((await getStorage(env.DB, owner_id)).backend === 'migrating') continue;
    try {
      total += await replayDeferred(env, owner_id);
    } catch (err) {
      console.warn('[sepay] replay', owner_id, err);
    }
  }
  return total;
}
