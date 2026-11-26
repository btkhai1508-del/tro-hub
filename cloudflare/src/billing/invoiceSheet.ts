/**
 * One invoice as a resident reads it: the lines with their formula ("1.250 − 1.200 = 50 số × 3.500"),
 * the total and the meter readings. Shared by the resident app (tenantView) and the public payment page.
 */
import type { TenantDb } from '../tenant/db.ts';

export interface SheetLine { kind: string; name: string; qty: number; unitPrice: number; amount: number; formula: string; per?: string | null; sheetCol?: string | null }

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const PER_UNIT: Record<string, string> = { room: 'phòng', person: 'người', vehicle: 'chiếc' };

/** The "Chi tiết" text of one line. `meterNew` = the new reading of that meter for the month (null = unknown). */
export function lineFormula(l: { kind: string; qty: number; unitPrice: number; per?: string | null }, meterNew: number | null = null): string {
  if (l.kind === 'room') return '1 tháng';
  if (l.kind === 'electricity' || l.kind === 'water') {
    const unit = l.kind === 'electricity' ? 'số' : 'khối';
    const usage = `${vnd(l.qty)} ${unit} × ${vnd(l.unitPrice)}`;
    return meterNew !== null && meterNew >= l.qty ? `${vnd(meterNew)} − ${vnd(meterNew - l.qty)} = ${usage}` : usage;
  }
  if (l.kind === 'service') {
    if (l.per === 'room') return `1 phòng × ${vnd(l.unitPrice)}`;
    return `${vnd(l.qty)} ${PER_UNIT[l.per ?? ''] ?? ''} × ${vnd(l.unitPrice)}`.replace(/\s+×/, ' ×');
  }
  // 'other': the electricity price difference (usage × difference); a one-off amount has no formula.
  return l.qty > 1 ? `${vnd(l.qty)} số × ${vnd(l.unitPrice)}` : '';
}

interface LineRow { invoice_id: number; kind: string; name: string; qty: number; unit_price: number; amount: number; per: string | null; sheet_col: string | null }
interface MeterRow { invoice_id: number; electric_new: number | null; water_new: number | null }

/** Lines of several invoices (in order), each with its formula. Lines worth 0 that are not room/electricity/water are left out. */
export async function sheetLines(db: TenantDb, invoiceIds: number[]): Promise<Map<number, SheetLine[]>> {
  const out = new Map<number, SheetLine[]>();
  if (!invoiceIds.length) return out;
  const marks = invoiceIds.map(() => '?').join(',');
  const [{ results: lines }, { results: meters }] = await Promise.all([
    db.prepare(
      `SELECT l.invoice_id, l.kind, l.name, l.qty, l.unit_price, l.amount, s.per, s.sheet_col
         FROM invoice_lines l LEFT JOIN house_services s ON s.id = l.service_id
        WHERE l.invoice_id IN (${marks}) ORDER BY l.id`
    ).bind(...invoiceIds).all<LineRow>(),
    db.prepare(
      `SELECT i.id AS invoice_id, m.electric_new, m.water_new FROM invoices i
         LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
        WHERE i.id IN (${marks})`
    ).bind(...invoiceIds).all<MeterRow>(),
  ]);
  const meterOf = new Map(meters.map((m) => [m.invoice_id, m]));
  for (const l of lines) {
    if (l.amount === 0 && !['room', 'electricity', 'water'].includes(l.kind)) continue;
    const m = meterOf.get(l.invoice_id);
    const meterNew = l.kind === 'electricity' ? m?.electric_new ?? null : l.kind === 'water' ? m?.water_new ?? null : null;
    const list = out.get(l.invoice_id) ?? [];
    list.push({ kind: l.kind, name: l.name, qty: l.qty, unitPrice: l.unit_price, amount: l.amount, per: l.per, sheetCol: l.sheet_col, formula: lineFormula({ kind: l.kind, qty: l.qty, unitPrice: l.unit_price, per: l.per }, meterNew || null) });
    out.set(l.invoice_id, list);
  }
  return out;
}

/** Due date shown on an invoice: one week after it was issued, as dd/mm/yyyy (Vietnam time). */
export function dueDateOf(issuedAt: string | null): string {
  if (!issuedAt) return '';
  const at = Date.parse(issuedAt.includes('T') ? issuedAt : `${issuedAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(at)) return '';
  return new Date(at + 7 * 86400_000 + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
}
