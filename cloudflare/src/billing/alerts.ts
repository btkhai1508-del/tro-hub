/**
 * The admin bell: alerts for the landlord and the managers of a house, kept in the landlord's own store
 * (`admin_alerts`, read state per person in `admin_alert_reads`). Every alert has a stable key, so a webhook
 * sent again, a replay or a second mark adds nothing (INSERT OR IGNORE on the UNIQUE key).
 * Only payment alerts for now; `kind` is open so other requests (password reset) can use the same bell later.
 */
import type { TenantDb } from '../tenant/db.ts';

export type AlertKind = 'invoice_paid' | 'overpaid';

export interface AlertInput {
  houseId: string;
  kind: AlertKind;
  room: string | null;
  month: string | null;
  invoiceId: number | null;
  amount: number | null;
  /** UTC "YYYY-MM-DD HH:MM:SS" (when SePay received the money); null = now. */
  receivedAt: string | null;
  source: string;
  /** 'paid:<invoiceId>' or 'sepay:<sepayId>'. */
  key: string;
}

export function alertStatement(db: TenantDb, a: AlertInput) {
  return db.prepare(
    `INSERT OR IGNORE INTO admin_alerts (house_id, kind, room_name, month, invoice_id, amount, received_at, source, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`
  ).bind(a.houseId, a.kind, a.room, a.month, a.invoiceId, a.amount, a.receivedAt, a.source, a.key);
}

/** Writes one alert; never throws (a payment is never refused because its alert could not be written). */
export async function addAlert(db: TenantDb, a: AlertInput): Promise<void> {
  try {
    await alertStatement(db, a).run();
  } catch (err) {
    console.warn('[alerts] write', a.key, err);
  }
}

/** "The invoice is paid" for an invoice that just became paid; the amount is the money received (or its total). */
export async function invoicePaidAlert(db: TenantDb, invoiceId: number, source: string, receivedAt: string | null = null): Promise<void> {
  const inv = await db.prepare(
    `SELECT i.house_id, i.month, i.total, i.paid_at, rm.name AS room,
            (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.invoice_id = i.id AND p.method = 'bank') AS bank
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.id = ?`
  ).bind(invoiceId).first<{ house_id: string; month: string; total: number; paid_at: string | null; room: string; bank: number }>().catch(() => null);
  if (!inv) return;
  await addAlert(db, {
    houseId: inv.house_id, kind: 'invoice_paid', room: inv.room, month: inv.month, invoiceId,
    amount: inv.bank > 0 ? inv.bank : inv.total, receivedAt: receivedAt ?? inv.paid_at, source, key: `paid:${invoiceId}`,
  });
}

/** The invoice is no longer paid (taken back by hand): its "paid" alert goes, so a later payment alerts again. */
export async function clearPaidAlert(db: TenantDb, invoiceId: number): Promise<void> {
  const key = `paid:${invoiceId}`;
  try {
    await db.batch([
      db.prepare(`DELETE FROM admin_alert_reads WHERE alert_id IN (SELECT id FROM admin_alerts WHERE dedupe_key = ?)`).bind(key),
      db.prepare(`DELETE FROM admin_alerts WHERE dedupe_key = ?`).bind(key),
    ]);
  } catch (err) {
    console.warn('[alerts] clear', key, err);
  }
}
