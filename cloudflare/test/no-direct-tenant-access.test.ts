/// <reference types="vite/client" />
/**
 * Static guard: the nine tenant tables are reached only through the routing layer (tenantOfOwner /
 * tenantFor), never by running SQL on the shared D1 binding directly. Central tables (staff,
 * house_directory, tenant_storage, ...) may still use env.DB.
 *
 * Limits (textual scan, not a type check): only SQL written literally inside the call arguments is
 * seen, and a lowercase `db.prepare(...)` is ignored because tenant handles use that name. To make the
 * aliasing bypass (`const x = c.env.DB; x.prepare(...)`) visible, findSharedDbAliases flags an alias of
 * the shared binding that is later used with .prepare/.batch/.exec in the same file.
 */
import { describe, expect, it } from 'vitest';

const TENANT_TABLES = ['houses', 'house_rates', 'rooms', 'residents', 'invoices', 'meter_readings', 'payments', 'payment_gates', 'notifications', 'house_services', 'house_fee_months', 'house_fee_services'];

// A table name used as a SQL object: FROM x, JOIN x, INTO x, UPDATE x, TABLE x (optionally quoted).
const TABLE_REF = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+["'\`]?(${TENANT_TABLES.join('|')})\\b`, 'i');
// The shared binding: env.DB, c.env.DB, or a local alias named DB.
const DIRECT_CALL = /(?<![\w$.])(?:(?:[\w$]+\.)*env\.)?DB\s*\.\s*(prepare|batch|exec)\s*\(/g;

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
function findDirectTenantSql(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(DIRECT_CALL)) {
    const args = callArgs(src, m.index! + m[0].length - 1);
    if (TABLE_REF.test(args)) hits.push(`${m[0]}${args.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return hits;
}

// `x = ...env.DB` or `x: Type = ...env.DB` (not followed by a property access), and `{ DB } = ...env`.
const ALIAS = /\b([\w$]+)\s*(?::[^=;]+)?=\s*(?:[\w$]+\.)*env\.DB\b(?!\s*\.)/g;
const DESTRUCTURE = /\{[^}]*\bDB\b[^}]*\}\s*=\s*(?:[\w$]+\.)*env\b/g;

/** Lists aliases of the shared D1 that the same file later uses to run SQL. */
function findSharedDbAliases(src: string): string[] {
  const names = [...src.matchAll(ALIAS)].map((m) => m[1]);
  if (DESTRUCTURE.test(src)) names.push('DB');
  DESTRUCTURE.lastIndex = 0;
  return [...new Set(names)].filter((n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\.\\s*(?:prepare|batch|exec)\\s*\\(`).test(src));
}

// Files that read the shared D1 on purpose.
const ALLOW: Record<string, string> = {
  'src/tenant/': 'the routing layer itself: the d1 backend adapter wraps env.DB',
  'src/migrate/': 'reserved for Task 13: the migration code reads the shared D1 deliberately',
};

// Files allowed to alias env.DB and run SQL on the alias.
const ALIAS_ALLOW: Record<string, string> = {
  'src/routes/auth.ts': 'aliases env.DB only for central staff/directory lookups; resident rows switch to the tenant handle',
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
  it('catches this.env.DB / ctx.env.DB receivers and exec', () => {
    expect(findDirectTenantSql("this.env.DB.prepare('SELECT * FROM rooms')")).toHaveLength(1);
    expect(findDirectTenantSql("ctx.env.DB.batch([x.prepare('DELETE FROM residents')])")).toHaveLength(1);
    expect(findDirectTenantSql("c.env.DB.exec('DELETE FROM invoices')")).toHaveLength(1);
  });
  it('flags an alias of env.DB that runs SQL, not one only passed along', () => {
    expect(findSharedDbAliases("const db = c.env.DB;\nawait db.prepare('SELECT 1')")).toEqual(['db']);
    expect(findSharedDbAliases("let db: TenantDb = this.env.DB; db.batch([])")).toEqual(['db']);
    expect(findSharedDbAliases("const { DB } = env; DB.prepare('x')")).toEqual(['DB']);
    expect(findSharedDbAliases("const db = env.DB; await residentRoute(db, {})")).toEqual([]);
    expect(findSharedDbAliases("const r = env.DB.prepare('x')")).toEqual([]);
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

  it('không đặt bí danh cho env.DB rồi chạy SQL trên bí danh', () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      const path = file.replace('../', '');
      if (Object.keys({ ...ALLOW, ...ALIAS_ALLOW }).some((a) => path.startsWith(a))) continue;
      for (const name of findSharedDbAliases(src)) offenders.push(`${path}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });
});
