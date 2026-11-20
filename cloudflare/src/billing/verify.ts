// Read-only check of stored (frozen) invoices against the billing formula. Never writes.
import type { TenantDb } from '../tenant/db.ts';
import { computeInvoice } from './compute.ts';

/** One invoice joined with its room name and (optional) meter reading, as the verification SELECT returns it. */
export interface VerifyRow {
  house_id: string;
  room: string;
  month: string;
  room_rent: number;
  electricity: number;
  water: number;
  trash: number;
  internet: number;
  parking: number;
  other: number;
  total: number;
  electric_old: number | null;
  electric_new: number | null;
  water_old: number | null;
  water_new: number | null;
}

export interface VerifyOptions {
  electricPriceByMonth: Record<string, number>;
  waterPrice: number;
  actualElectricPriceByHouse: Record<string, number | null>;
}

export type VerifyField = 'electricity' | 'water' | 'other' | 'total';
export interface Mismatch { houseId: string; room: string; month: string; field: VerifyField; stored: number; computed: number }
export interface VerifyResult { checked: number; skipped: number; mismatches: Mismatch[] }

/** The one read-only query (placeholders for the house ids). Shared by verifyHistory and the script. */
export function verifySelectSql(houseCount: number): string {
  const marks = Array.from({ length: houseCount }, () => '?').join(', ');
  return (
    `SELECT i.house_id AS house_id, r.name AS room, i.month AS month, ` +
    `i.room_rent AS room_rent, i.electricity AS electricity, i.water AS water, i.trash AS trash, ` +
    `i.internet AS internet, i.parking AS parking, i.other AS other, i.total AS total, ` +
    `m.electric_old AS electric_old, m.electric_new AS electric_new, m.water_old AS water_old, m.water_new AS water_new ` +
    `FROM invoices i JOIN rooms r ON r.id = i.room_id ` +
    `LEFT JOIN meter_readings m ON m.room_id = i.room_id AND m.month = i.month ` +
    `WHERE i.house_id IN (${marks}) ORDER BY i.house_id, i.month, r.name`
  );
}

/**
 * Pure core. Per invoice with a meter row: electricity, water and "Khác" must equal the formula, and the
 * stored total must equal the Sheet's sum (rent + electricity + water + trash + internet + parking + other,
 * deposit excluded). Trash/internet/parking depend on people and vehicles that history does not keep, so
 * they are taken as stored. Invoices without a meter row are counted as skipped.
 */
export function compareRows(rows: VerifyRow[], opts: VerifyOptions): VerifyResult {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.electric_old === null || row.electric_new === null || row.water_old === null || row.water_new === null) {
      skipped++;
      continue;
    }
    checked++;
    const electricPrice = opts.electricPriceByMonth[row.month];
    if (electricPrice === undefined) throw new Error(`Thiếu đơn giá điện tháng ${row.month}`);
    const calc = computeInvoice({
      rent: row.room_rent,
      electricOld: row.electric_old, electricNew: row.electric_new, waterOld: row.water_old, waterNew: row.water_new,
      electricPrice, waterPrice: opts.waterPrice, actualElectricPrice: opts.actualElectricPriceByHouse[row.house_id] ?? null,
      services: [], people: 0, vehicles: 0,
    });
    const amount = (kind: 'electricity' | 'water' | 'other') => calc.lines.find((l) => l.kind === kind)?.amount ?? 0;
    const check = (field: VerifyField, stored: number, computed: number) => {
      if (stored !== computed) mismatches.push({ houseId: row.house_id, room: row.room, month: row.month, field, stored, computed });
    };
    check('electricity', row.electricity, amount('electricity'));
    check('water', row.water, amount('water'));
    check('other', row.other, amount('other'));
    check('total', row.total, row.room_rent + row.electricity + row.water + row.trash + row.internet + row.parking + row.other);
  }
  return { checked, skipped, mismatches };
}

export async function verifyHistory(db: TenantDb, houseIds: string[], opts: VerifyOptions): Promise<VerifyResult> {
  if (houseIds.length === 0) return { checked: 0, skipped: 0, mismatches: [] };
  const { results } = await db.prepare(verifySelectSql(houseIds.length)).bind(...houseIds).all<VerifyRow>();
  return compareRows(results, opts);
}
