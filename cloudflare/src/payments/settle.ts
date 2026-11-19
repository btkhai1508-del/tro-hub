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
import { deferredByRoom } from '../central/deferred.ts';
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

export type SettleResult =
  | { settled: false; reason: 'room' }
  | { settled: false; reason: 'invoice' }
  | { settled: false; reason: 'short'; invoiceId: number; received: number; total: number }
  | { settled: true; already?: true; invoiceId: number; received: number; total: number };

/** A transfer that no house could be found for: kept centrally so the landlord can see it. */
export async function recordUnassigned(env: Env, t: SepayTransfer, sepayId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO unassigned_payments (sepay_id, amount, content, account_no, bank_name, reference, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(sepayId, Math.round(Number(t.transferAmount) || 0), String(t.content ?? '').slice(0, 300), t.accountNumber ?? null,
    t.gateway ?? null, t.referenceCode || `sepay-${sepayId}`, t.transactionDate ?? new Date().toISOString()).run();
}

/**
 * Records the transfer in the landlord's store and marks the invoice paid once the bank money for it
 * reaches the total. The same transfer twice books once (payments.reference is UNIQUE).
 * `paint: false` skips the old Sheet's green cell (a replay: the deferral already painted it).
 */
export async function settleRent(
  env: Env, ownerId: number, houseId: string, room: string, month: string, t: SepayTransfer, sepayId: string,
  opts: { paint?: boolean } = {},
): Promise<SettleResult> {
  const db = await tenantOfOwner(env, ownerId);
  const roomRow = await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = ?`).bind(houseId, room).first<{ id: number }>();
  if (!roomRow) return { settled: false, reason: 'room' };
  const inv = await invoiceOrSync(db, env.DB, roomRow.id, month);
  const amount = Math.round(Number(t.transferAmount) || 0);
  await db.prepare(
    `INSERT OR IGNORE INTO payments (house_id, invoice_id, amount, method, bank_name, account_no, reference, content, paid_at, confirmed_by)
     VALUES (?, ?, ?, 'bank', ?, ?, ?, ?, ?, 'sepay')`
  ).bind(houseId, inv?.id ?? null, amount, t.gateway ?? null, t.accountNumber ?? null, t.referenceCode || `sepay-${sepayId}`,
    String(t.content ?? '').slice(0, 300), t.transactionDate ?? new Date().toISOString()).run();
  if (!inv) return { settled: false, reason: 'invoice' };
  const sum = await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ? AND method = 'bank'`).bind(inv.id).first<{ paid: number }>();
  const received = sum?.paid ?? 0;
  if (inv.status === 'paid' || inv.status === 'cash') return { settled: true, already: true, invoiceId: inv.id, received, total: inv.total };
  if (received < inv.total) return { settled: false, reason: 'short', invoiceId: inv.id, received, total: inv.total };
  await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = COALESCE(?, datetime('now')), status_by = 'sepay' WHERE id = ?`)
    .bind(vnTimeToUtc(t.transactionDate), inv.id).run();
  if (opts.paint !== false) await paintSheetPayment(env, houseId, room, true, month, inv.sheet_row);
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
  if (!inv || inv.status === 'paid' || inv.status === 'cash') return;
  const sum = await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ? AND method = 'bank'`).bind(inv.id).first<{ paid: number }>();
  const total = (sum?.paid ?? 0) + ((await deferredByRoom(env.DB, houseId, month)).get(room) ?? 0);
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
      const r = await settleRent(env, ownerId, e.house_id, e.room, e.month, t, e.sepay_id, { paint: false });
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
