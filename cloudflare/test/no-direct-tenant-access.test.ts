/// <reference types="vite/client" />
/**
 * Static guard: the nine tenant tables are reached only through the routing layer (tenantOfOwner /
 * tenantFor), never by running SQL on the shared D1 binding directly. Central tables (staff,
 * house_directory, tenant_storage, ...) may still use env.DB.
 */
import { describe, expect, it } from 'vitest';

export const TENANT_TABLES = ['houses', 'house_rates', 'rooms', 'residents', 'invoices', 'meter_readings', 'payments', 'payment_gates', 'notifications'];

// A table name used as a SQL object: FROM x, JOIN x, INTO x, UPDATE x, TABLE x (optionally quoted).
const TABLE_REF = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+["'\`]?(${TENANT_TABLES.join('|')})\\b`, 'i');
// The shared binding: env.DB, c.env.DB, or a local alias named DB.
const DIRECT_CALL = /(?<![\w.])(?:(?:c\.)?env\.)?DB\s*\.\s*(prepare|batch|exec)\s*\(/g;

/** Returns the argument text of the call whose "(" is at `open`, balancing parens and skipping string literals. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** Lists the direct env.DB statements in `src` that touch a tenant table. */
export function findDirectTenantSql(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(DIRECT_CALL)) {
    const args = callArgs(src, m.index! + m[0].length - 1);
    if (TABLE_REF.test(args)) hits.push(`${m[0]}${args.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return hits;
}

// Files that read the shared D1 on purpose.
const ALLOW: Record<string, string> = {
  'src/tenant/': 'the routing layer itself: the d1 backend adapter wraps env.DB',
  'src/migrate/': 'migration copies tenant rows out of the shared D1 into the landlord store',
  'src/central/deferred.ts': 'deferred money is held in the shared D1 until the landlord store accepts writes',
};

describe('static scanner', () => {
  it('catches a direct prepare on a tenant table', () => {
    const bad = 'const r = await c.env.DB.prepare(`SELECT id FROM rooms WHERE house_id = ?`).bind(h).all();';
    expect(findDirectTenantSql(bad)).toHaveLength(1);
  });
  it('catches env.DB.batch with a tenant statement and a local DB alias', () => {
    expect(findDirectTenantSql("await env.DB.batch([db.prepare('UPDATE invoices SET status = 1')]);")).toHaveLength(1);
    expect(findDirectTenantSql("const DB = c.env.DB; DB.prepare('INSERT INTO payments (id) VALUES (1)')")).toHaveLength(1);
  });
  it('ignores central tables and tenant handles', () => {
    expect(findDirectTenantSql("c.env.DB.prepare('SELECT * FROM staff WHERE id = ?')")).toEqual([]);
    expect(findDirectTenantSql("db.prepare('SELECT * FROM rooms')")).toEqual([]);
    expect(findDirectTenantSql("env.DB.prepare('SELECT * FROM house_directory')")).toEqual([]);
  });
});

describe('src/**/*.ts', () => {
  const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('reads the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it('không còn truy cập trực tiếp bảng kho qua env.DB', () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      const path = file.replace('../', '');
      if (Object.keys(ALLOW).some((a) => path.startsWith(a))) continue;
      for (const hit of findDirectTenantSql(src)) offenders.push(`${path}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});
