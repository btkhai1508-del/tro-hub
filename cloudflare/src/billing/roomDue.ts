/**
 * What a room still owes, invoice by invoice. Payment follows the "Tổng cộng" of the printed invoice:
 * debt of earlier months + this month. Only issued invoices count (a draft is not billed yet); an invoice
 * marked paid or cash owes nothing; otherwise it owes its total minus the money already booked on it.
 */
import type { InvoiceStatus } from '../central/deferred.ts';
import type { TenantDb } from '../tenant/db.ts';

export interface OpenInvoice { id: number; month: string; total: number; received: number; remaining: number; sheet_row: number | null }

/** Issued, not yet paid invoices of a room up to `month` ("YYYY-MM", inclusive), oldest first, each with what it still owes. */
export async function openInvoices(db: TenantDb, roomId: number, month: string): Promise<OpenInvoice[]> {
  const { results } = await db.prepare(
    `SELECT i.id, i.month, i.total, i.status, i.sheet_row,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.invoice_id = i.id) AS received
       FROM invoices i
      WHERE i.room_id = ? AND i.month <= ? AND i.issued_at IS NOT NULL AND i.status NOT IN ('paid', 'cash')
      ORDER BY i.month, i.id`
  ).bind(roomId, month).all<{ id: number; month: string; total: number; status: InvoiceStatus; sheet_row: number | null; received: number }>();
  return results
    .map((r) => ({ id: r.id, month: r.month, total: r.total, received: r.received, remaining: Math.max(0, r.total - r.received), sheet_row: r.sheet_row }))
    .filter((r) => r.remaining > 0);
}

export interface RoomDue {
  /** Still owed on the invoices of earlier months. */
  previousDebt: number;
  /** What paying this invoice means: earlier debt + what this month still owes ("Tổng cộng"). */
  amountDue: number;
}

/** The debt figures of one invoice of the room, from that room's open invoices (see openInvoices). */
export function dueOf(open: OpenInvoice[], invoice: { id: number; month: string }): RoomDue {
  const previousDebt = open.filter((o) => o.month < invoice.month).reduce((s, o) => s + o.remaining, 0);
  const own = open.find((o) => o.id === invoice.id)?.remaining ?? 0;
  return { previousDebt, amountDue: previousDebt + own };
}

export async function roomDue(db: TenantDb, roomId: number, invoice: { id: number; month: string }): Promise<RoomDue> {
  return dueOf(await openInvoices(db, roomId, invoice.month), invoice);
}

/**
 * How a transfer for `month` is split: earlier open invoices first (oldest first, each up to what it owes),
 * then everything left to the month's own invoice (an overpayment stays there). `targetId` null: there is no
 * invoice for that month, the rest is kept without one. Never an empty list.
 */
export function allocate(amount: number, older: OpenInvoice[], targetId: number | null): { invoiceId: number | null; amount: number }[] {
  const out: { invoiceId: number | null; amount: number }[] = [];
  let left = amount;
  for (const o of older) {
    if (left <= 0) break;
    const take = Math.min(left, o.remaining);
    out.push({ invoiceId: o.id, amount: take });
    left -= take;
  }
  if (left > 0 || !out.length) out.push({ invoiceId: targetId, amount: left });
  return out;
}
