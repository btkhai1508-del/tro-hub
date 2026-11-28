// Row digests and per-owner export from the shared D1, used to prove a tenant store holds exactly the
// rows D1 held. Reading tenant tables from the shared D1 is deliberate here (migration only).
import type { Env } from '../app.ts';
import type { SqlValue, TenantTable } from '../tenant/schema.ts';

type Row = Record<string, SqlValue>;

function cmp(a: SqlValue, b: SqlValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  // Mixed types: numbers first; otherwise compare by UTF-16 code units (locale independent)
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1;
  return (a as string) < (b as string) ? -1 : 1;
}

function serialize(row: Row): string {
  const sorted: Row = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k];
  return JSON.stringify(sorted); // typed: null, 0 and '' stay distinct; integers and strings stay distinct
}

/** SHA-256 hex of the rows sorted by `pk`, each as JSON with alphabetically sorted keys, joined by '\n'. */
export async function digestRows(rows: Row[], pk: string[]): Promise<string> {
  const sorted = [...rows].sort((x, y) => {
    for (const k of pk) {
      const c = cmp(x[k], y[k]);
      if (c) return c;
    }
    return 0;
  });
  const bytes = new TextEncoder().encode(sorted.map(serialize).join('\n'));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const OWNER_HOUSES = 'SELECT id FROM houses WHERE owner_id = ?1';

/**
 * WHERE clause (owner id bound as ?1) of the child tables that carry no house_id: reached through their
 * invoice or room. Null for tables that have house_id themselves.
 */
export function ownerChildWhere(table: string): string | null {
  if (table === 'invoice_lines') return `invoice_id IN (SELECT id FROM invoices WHERE house_id IN (${OWNER_HOUSES}))`;
  if (table === 'room_service_optouts') return `room_id IN (SELECT id FROM rooms WHERE house_id IN (${OWNER_HOUSES}))`;
  if (table === 'admin_alert_reads') return `alert_id IN (SELECT id FROM admin_alerts WHERE house_id IN (${OWNER_HOUSES}))`;
  return null;
}

/** One owner's rows of `table` from the shared D1, ordered by primary key (stable paging). */
export async function ownerRowsFromD1(env: Env, ownerId: number, table: TenantTable, offset: number, limit: number): Promise<Row[]> {
  const order = table.pk.map((c) => `${table.name}.${c}`).join(', ');
  let where: string;
  if (table.name === 'houses') where = 'owner_id = ?1';
  else if (table.name === 'payments') {
    where = `(house_id IN (${OWNER_HOUSES}) OR (house_id IS NULL AND account_no IN (SELECT bank_account_no FROM houses WHERE owner_id = ?1 AND bank_account_no IS NOT NULL)))`;
  } else where = ownerChildWhere(table.name) ?? `house_id IN (${OWNER_HOUSES})`;
  const res = await env.DB.prepare(`SELECT * FROM ${table.name} WHERE ${where} ORDER BY ${order} LIMIT ?2 OFFSET ?3`)
    .bind(ownerId, limit, offset)
    .all();
  return res.results as Row[];
}
