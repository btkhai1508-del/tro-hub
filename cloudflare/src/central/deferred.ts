/**
 * SePay rent transfers that arrived while a landlord's store could not take writes (migrating) are
 * kept centrally as `sepay_events.status = 'deferred'` until they are replayed into the store. The
 * payment-status APIs add them on top of the stored invoice, so the resident and the landlord see
 * "Đã đóng" as soon as the money is there, not only after the replay.
 */

import type { TenantDb } from '../tenant/db.ts';

export type InvoiceStatus = 'unpaid' | 'pending' | 'paid' | 'cash';

/** The reference a SePay rent event books its payment under; the same text on the first try and on every replay. */
export const eventReference = (sepayId: string) => `sepay-${sepayId}`;

/**
 * Room name → sum of SePay rent money for that house and month that is not in the store yet: events
 * 'deferred' (waiting) or 'replaying' (being booked) whose payment row `sepay-<id>` is NOT in `tenant`
 * yet. A room with an open event is present in the map even when every one of its events is already
 * booked (value 0): the payment is then counted once, through the stored payments, never twice, and
 * the caller knows the invoice's own status may lag behind the money (booking and marking are two writes).
 * Almost always an empty map (partial index sepay_events_open).
 */
export async function deferredByRoom(db: D1Database, houseId: string, month: string, tenant: TenantDb): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT sepay_id, room, amount FROM sepay_events
        WHERE house_id = ? AND month = ? AND status IN ('deferred', 'replaying') AND kind = 'rent' AND room IS NOT NULL`
    )
    .bind(houseId, month)
    .all<{ sepay_id: string; room: string; amount: number }>();
  const out = new Map<string, number>();
  if (!results.length) return out;
  const { results: booked } = await tenant
    .prepare(`SELECT reference FROM payments WHERE reference IN (${results.map(() => '?').join(',')})`)
    .bind(...results.map((r) => eventReference(r.sepay_id)))
    .all<{ reference: string }>();
  const done = new Set(booked.map((b) => b.reference));
  for (const r of results) out.set(r.room, (out.get(r.room) ?? 0) + (done.has(eventReference(r.sepay_id)) ? 0 : (r.amount ?? 0)));
  return out;
}

/** paid/cash stay as they are; bank money already recorded plus deferred money covering the total → 'paid'. */
export function effectiveStatus(status: InvoiceStatus, total: number, bankReceived: number, deferred: number): InvoiceStatus {
  if (status === 'paid' || status === 'cash') return status;
  return bankReceived + deferred >= total ? 'paid' : status;
}
