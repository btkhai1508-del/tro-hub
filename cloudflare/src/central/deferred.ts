/**
 * SePay rent transfers that arrived while a landlord's store could not take writes (migrating) are
 * kept centrally as `sepay_events.status = 'deferred'` until they are replayed into the store. The
 * payment-status APIs add them on top of the stored invoice, so the resident and the landlord see
 * "Đã đóng" as soon as the money is there, not only after the replay.
 */

export type InvoiceStatus = 'unpaid' | 'pending' | 'paid' | 'cash';

/** Room name → sum of deferred rent for that house and month. Almost always an empty map (partial index sepay_events_deferred). */
export async function deferredByRoom(db: D1Database, houseId: string, month: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT room, SUM(amount) AS amount FROM sepay_events
        WHERE house_id = ? AND month = ? AND status = 'deferred' AND kind = 'rent' AND room IS NOT NULL
        GROUP BY room`
    )
    .bind(houseId, month)
    .all<{ room: string; amount: number }>();
  return new Map(results.map((r) => [r.room, r.amount ?? 0]));
}

/** paid/cash stay as they are; bank money already recorded plus deferred money covering the total → 'paid'. */
export function effectiveStatus(status: InvoiceStatus, total: number, bankReceived: number, deferred: number): InvoiceStatus {
  if (status === 'paid' || status === 'cash') return status;
  return bankReceived + deferred >= total ? 'paid' : status;
}
