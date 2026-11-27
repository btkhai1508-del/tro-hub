/**
 * One invoice as a resident reads it: the lines with their formula ("1.250 − 1.200 = 50 số × 3.500"),
 * the total and the meter readings. Shared by the resident app (tenantView) and the public payment page.
 */
import type { TenantDb } from '../tenant/db.ts';

export interface SheetLine { kind: string; name: string; qty: number; unitPrice: number; amount: number; formula: string; per?: string | null; sheetCol?: string | null }

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

/**
 * The "Chi tiết" text of one line. Rent: none. Electricity/water: "(1.250 − 1.210) × 3.500" (just "40 × 3.500"
 * when the readings are unknown). Services and the price difference: "2 × 40.000", no unit word.
 * `meterNew` = the new reading of that meter for the month (null = unknown).
 */
export function lineFormula(l: { kind: string; qty: number; unitPrice: number; per?: string | null }, meterNew: number | null = null): string {
  if (l.kind === 'room') return '';
  if (l.kind === 'electricity' || l.kind === 'water') {
    return meterNew !== null && meterNew >= l.qty ? `(${vnd(meterNew)} − ${vnd(meterNew - l.qty)}) × ${vnd(l.unitPrice)}` : `${vnd(l.qty)} × ${vnd(l.unitPrice)}`;
  }
  if (l.kind === 'service') return `${vnd(l.qty)} × ${vnd(l.unitPrice)}`;
  // 'other': the electricity price difference (usage × difference); a one-off amount has no formula.
  return l.qty > 1 ? `${vnd(l.qty)} × ${vnd(l.unitPrice)}` : '';
}

interface LineRow { invoice_id: number; kind: string; name: string; qty: number; unit_price: number; amount: number; per: string | null; sheet_col: string | null }

interface LegacyRow {
  invoice_id: number; house_id: string; room_rent: number; electricity: number; water: number; trash: number; internet: number; parking: number; other: number;
  electric_old: number | null; electric_new: number | null; water_old: number | null; water_new: number | null;
}

/** "(1.250 − 1.210) × 3.000" from an old Sheet row (no invoice_lines): the price only when it divides evenly. */
function legacyMeter(amount: number, oldR: number | null, newR: number | null): string {
  if (oldR === null || newR === null || newR < oldR) return '';
  const usage = newR - oldR;
  const price = usage > 0 && amount % usage === 0 ? ` × ${vnd(amount / usage)}` : '';
  return `(${vnd(newR)} − ${vnd(oldR)})${price}`;
}

/** "2 × 40.000" when an old Sheet amount is a whole number of the house's service price, else ''. */
function legacyService(amount: number, price: number | undefined): string {
  if (!price || price <= 0 || amount <= 0 || amount % price !== 0) return '';
  return `${vnd(amount / price)} × ${vnd(price)}`;
}

function legacyLines(r: LegacyRow, prices: Map<string, number> = new Map()): SheetLine[] {
  const price = (col: string) => prices.get(`${r.house_id}|${col}`);
  const line = (kind: string, name: string, amount: number, formula: string, sheetCol: string | null = null): SheetLine =>
    ({ kind, name, qty: 0, unitPrice: 0, amount, formula, sheetCol });
  const out = [
    line('room', 'Tiền phòng', r.room_rent, ''),
    line('electricity', 'Tiền điện', r.electricity, legacyMeter(r.electricity, r.electric_old, r.electric_new)),
    line('water', 'Tiền nước', r.water, legacyMeter(r.water, r.water_old, r.water_new)),
  ];
  if (r.trash) out.push(line('service', 'Rác', r.trash, legacyService(r.trash, price('K')), 'K'));
  if (r.internet) out.push(line('service', 'Internet', r.internet, legacyService(r.internet, price('L')), 'L'));
  if (r.parking) out.push(line('service', 'Xe máy', r.parking, legacyService(r.parking, price('M')), 'M'));
  if (r.other) out.push(line('other', 'Khác', r.other, ''));
  return out;
}

/**
 * Lines of several invoices (in order), each with its formula. Lines worth 0 that are not room/electricity/water
 * are left out. An invoice imported from the old Sheet has no invoice_lines: its money columns are used instead.
 */
export async function sheetLines(db: TenantDb, invoiceIds: number[]): Promise<Map<number, SheetLine[]>> {
  const out = new Map<number, SheetLine[]>();
  if (!invoiceIds.length) return out;
  const marks = invoiceIds.map(() => '?').join(',');
  const [{ results: lines }, { results: heads }] = await Promise.all([
    db.prepare(
      `SELECT l.invoice_id, l.kind, l.name, l.qty, l.unit_price, l.amount, s.per, s.sheet_col
         FROM invoice_lines l LEFT JOIN house_services s ON s.id = l.service_id
        WHERE l.invoice_id IN (${marks}) ORDER BY l.id`
    ).bind(...invoiceIds).all<LineRow>(),
    db.prepare(
      `SELECT i.id AS invoice_id, i.house_id, i.room_rent, i.electricity, i.water, i.trash, i.internet, i.parking, i.other,
              m.electric_old, m.electric_new, m.water_old, m.water_new
         FROM invoices i LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month
        WHERE i.id IN (${marks})`
    ).bind(...invoiceIds).all<LegacyRow>(),
  ]);
  const headOf = new Map(heads.map((m) => [m.invoice_id, m]));
  for (const l of lines) {
    if (l.amount === 0 && !['room', 'electricity', 'water'].includes(l.kind)) continue;
    const m = headOf.get(l.invoice_id);
    const meterNew = l.kind === 'electricity' ? m?.electric_new ?? null : l.kind === 'water' ? m?.water_new ?? null : null;
    const list = out.get(l.invoice_id) ?? [];
    list.push({ kind: l.kind, name: l.name, qty: l.qty, unitPrice: l.unit_price, amount: l.amount, per: l.per, sheetCol: l.sheet_col, formula: lineFormula({ kind: l.kind, qty: l.qty, unitPrice: l.unit_price, per: l.per }, meterNew || null) });
    out.set(l.invoice_id, list);
  }
  const legacy = invoiceIds.filter((id) => !out.has(id) && headOf.has(id));
  if (legacy.length) {
    // Old Sheet invoices only have amounts: the house's service prices turn them back into "quantity × price".
    const houses = [...new Set(legacy.map((id) => headOf.get(id)!.house_id))];
    const { results: services } = await db.prepare(
      `SELECT house_id, sheet_col, price FROM house_services WHERE house_id IN (${houses.map(() => '?').join(',')}) AND sheet_col IS NOT NULL AND active = 1`
    ).bind(...houses).all<{ house_id: string; sheet_col: string; price: number }>();
    const prices = new Map(services.map((x) => [`${x.house_id}|${x.sheet_col}`, x.price]));
    for (const id of legacy) out.set(id, legacyLines(headOf.get(id)!, prices));
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
