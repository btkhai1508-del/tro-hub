/**
 * Fee settings per month. A month's fees (electricity and water price + the service list) live in a snapshot:
 * `house_fee_months` (prices) and `house_fee_services` (services, keyed by the stable `house_services.id`).
 *
 * Design: the snapshot is the authority for every month that has one. `house_rates` / `house_services` stay as
 * the live template: they mirror the CURRENT month's snapshot (written together with it) and are the id
 * registry for services, so opt-outs and invoice lines keep pointing at a stable id. A month without a
 * snapshot is resolved by copy-forward from the latest earlier snapshot, and from the template when there is
 * no earlier one. Services missing from a month's snapshot do not exist in that month.
 */
import type { TenantDb, TenantStatement } from '../tenant/db.ts';
import type { Per } from './compute.ts';

export interface FeeService {
  id: number; name: string; price: number; per: Per; maxQty: number | null; sheetCol: 'K' | 'L' | 'M' | null; active: boolean; sort: number;
}
export interface FeeConfig {
  month: string;
  electricPrice: number;
  waterPrice: number;
  services: FeeService[];
  /** Where the numbers came from: this month's snapshot, or (not stored yet) a copy of an earlier one / the template. */
  from: 'snapshot' | 'copy' | 'template';
}

interface ServiceRow { id: number; name: string; price: number; per: Per; max_qty: number | null; sheet_col: 'K' | 'L' | 'M' | null; active: number; sort: number }

const shape = (r: ServiceRow): FeeService => ({
  id: r.id, name: r.name, price: r.price, per: r.per, maxQty: r.max_qty, sheetCol: r.sheet_col, active: r.active === 1, sort: r.sort,
});

const SNAPSHOT_SERVICES = `SELECT service_id AS id, name, price, per, max_qty, sheet_col, active, sort FROM house_fee_services WHERE house_id = ? AND month = ? ORDER BY sort, service_id`;

async function readSnapshot(db: TenantDb, houseId: string, month: string): Promise<Omit<FeeConfig, 'from'> | null> {
  const [head, services] = await Promise.all([
    db.prepare(`SELECT electricity_per_kwh AS e, water_per_m3 AS w FROM house_fee_months WHERE house_id = ? AND month = ?`).bind(houseId, month).first<{ e: number; w: number }>(),
    db.prepare(SNAPSHOT_SERVICES).bind(houseId, month).all<ServiceRow>(),
  ]);
  return head ? { month, electricPrice: head.e, waterPrice: head.w, services: services.results.map(shape) } : null;
}

export interface FeeOptions {
  /** Store the resolved snapshot when the month has none (default true). A read-only view passes false. */
  persist?: boolean;
}

/**
 * The fees of `month` for a house. Existing snapshot: returned as is. None: copied forward from the latest
 * earlier snapshot (else from `house_rates`/`house_services`) and, unless `persist` is false, stored so the month
 * keeps those numbers from now on.
 */
export async function feeConfigFor(db: TenantDb, houseId: string, month: string, opts: FeeOptions = {}): Promise<FeeConfig> {
  const own = await readSnapshot(db, houseId, month);
  if (own) return { ...own, from: 'snapshot' };

  const earlier = await db.prepare(`SELECT month FROM house_fee_months WHERE house_id = ? AND month < ? ORDER BY month DESC LIMIT 1`).bind(houseId, month).first<{ month: string }>();
  let base: Omit<FeeConfig, 'from'>;
  let from: FeeConfig['from'];
  if (earlier) {
    base = { ...(await readSnapshot(db, houseId, earlier.month))!, month };
    from = 'copy';
  } else {
    const [rates, services] = await Promise.all([
      db.prepare(`SELECT electricity_per_kwh AS e, water_per_m3 AS w FROM house_rates WHERE house_id = ?`).bind(houseId).first<{ e: number; w: number }>(),
      db.prepare(`SELECT id, name, price, per, max_qty, sheet_col, active, sort FROM house_services WHERE house_id = ? ORDER BY sort, id`).bind(houseId).all<ServiceRow>(),
    ]);
    base = { month, electricPrice: rates?.e ?? 0, waterPrice: rates?.w ?? 0, services: services.results.map(shape) };
    from = 'template';
  }
  if (opts.persist === false) return { ...base, from };

  // INSERT OR IGNORE: a concurrent creator wrote the same content, whoever is first wins.
  const head = earlier
    ? db.prepare(`INSERT OR IGNORE INTO house_fee_months (house_id, month, electricity_per_kwh, water_per_m3) SELECT house_id, ?, electricity_per_kwh, water_per_m3 FROM house_fee_months WHERE house_id = ? AND month = ?`).bind(month, houseId, earlier.month)
    : db.prepare(`INSERT OR IGNORE INTO house_fee_months (house_id, month, electricity_per_kwh, water_per_m3) VALUES (?, ?, ?, ?)`).bind(houseId, month, base.electricPrice, base.waterPrice);
  const rows = earlier
    ? db.prepare(`INSERT OR IGNORE INTO house_fee_services (house_id, month, service_id, name, price, per, max_qty, sheet_col, active, sort) SELECT house_id, ?, service_id, name, price, per, max_qty, sheet_col, active, sort FROM house_fee_services WHERE house_id = ? AND month = ?`).bind(month, houseId, earlier.month)
    : db.prepare(`INSERT OR IGNORE INTO house_fee_services (house_id, month, service_id, name, price, per, max_qty, sheet_col, active, sort) SELECT house_id, ?, id, name, price, per, max_qty, sheet_col, active, sort FROM house_services WHERE house_id = ?`).bind(month, houseId);
  await db.batch([head, rows]);
  return { ...base, from: 'snapshot' };
}

/** Whether a house already has a snapshot for `month` (one cheap read; the catch-up check). */
export async function hasFeeSnapshot(db: TenantDb, houseId: string, month: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 FROM house_fee_months WHERE house_id = ? AND month = ?`).bind(houseId, month).first());
}

/**
 * Statements that make the live template (`house_rates`, `house_services`) equal to `cfg`, the CURRENT month's
 * fees. Every UPDATE is guarded by "only when something differs", so running it again changes (and costs) nothing.
 * Services of the registry that `cfg` does not list are switched off; none is deleted (opt-outs and old invoice
 * lines point at them).
 */
export function mirrorTemplate(db: TenantDb, houseId: string, cfg: Pick<FeeConfig, 'electricPrice' | 'waterPrice' | 'services'>): TenantStatement[] {
  const ids = cfg.services.map((s) => s.id);
  return [
    db.prepare(`INSERT OR IGNORE INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES (?, ?, ?)`).bind(houseId, cfg.electricPrice, cfg.waterPrice),
    db.prepare(
      `UPDATE house_rates SET electricity_per_kwh = ?, water_per_m3 = ?, updated_at = datetime('now')
        WHERE house_id = ? AND (electricity_per_kwh != ? OR water_per_m3 != ?)`
    ).bind(cfg.electricPrice, cfg.waterPrice, houseId, cfg.electricPrice, cfg.waterPrice),
    ...cfg.services.map((s) =>
      db.prepare(
        `UPDATE house_services SET name = ?, price = ?, per = ?, max_qty = ?, sort = ?, active = ?
          WHERE id = ? AND house_id = ? AND (name != ? OR price != ? OR per != ? OR max_qty IS NOT ? OR sort != ? OR active != ?)`
      ).bind(s.name, s.price, s.per, s.maxQty, s.sort, s.active ? 1 : 0, s.id, houseId, s.name, s.price, s.per, s.maxQty, s.sort, s.active ? 1 : 0)
    ),
    db.prepare(`UPDATE house_services SET active = 0 WHERE house_id = ? AND active != 0${ids.length ? ` AND id NOT IN (${ids.map(() => '?').join(',')})` : ''}`).bind(houseId, ...ids),
  ];
}
