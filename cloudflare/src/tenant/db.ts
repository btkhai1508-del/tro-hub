/**
 * TenantDb: the slice of the D1 API that route code uses (prepare/bind/first/all/run/batch), so the
 * same SQL runs on the shared D1 (`env.DB` satisfies TenantDb as is) or on a landlord's own store
 * (remoteTenantDb), and can be made read-only while that landlord's data is being moved (readOnlyDb).
 *
 * Errors: SQL errors carry SQLite's text (D1 shows the same text after its own `D1_ERROR: ` prefix),
 * so callers match on e.g. /UNIQUE constraint failed/. Errors the adapter raises itself copy D1's
 * wording without the `D1_*:` prefix.
 */
import { isWriteSql, type SqlValue } from './schema.ts';
import type { SqlOp, SqlResult, TenantStore } from './store.ts';

export interface TenantStatement {
  bind(...values: SqlValue[]): TenantStatement;
  first<T = Record<string, SqlValue>>(column?: string): Promise<T | null>;
  all<T = Record<string, SqlValue>>(): Promise<{ results: T[]; meta: { changes: number; last_row_id: number } }>;
  run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }>;
}

export interface TenantDb {
  prepare(sql: string): TenantStatement;
  batch<T = Record<string, SqlValue>>(statements: TenantStatement[]): Promise<{ results: T[]; meta: { changes: number; last_row_id: number } }[]>;
}

/** A write while the landlord's data is being moved to its own store; the API answers 503 TENANT_MIGRATING. */
export class TenantLockedError extends Error {
  constructor() {
    super('Đang nâng cấp dữ liệu, thử lại sau ít phút.');
    this.name = 'TenantLockedError';
  }
}

const meta = (r: SqlResult) => ({ changes: r.changes, last_row_id: r.lastRowId });

/** D1 binds booleans as 1/0 and refuses undefined; the store's SQL API would bind "true" and NULL. */
function bindValue(v: unknown): SqlValue {
  if (typeof v === 'string' || typeof v === 'number' || v === null) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new Error(`Type '${typeof v}' not supported for value '${String(v)}'`);
}

class RemoteStatement implements TenantStatement {
  constructor(
    readonly db: RemoteTenantDb,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  op(mode: SqlOp['mode']): SqlOp {
    return { sql: this.sql, params: this.params, mode };
  }

  bind(...values: SqlValue[]): TenantStatement {
    return new RemoteStatement(this.db, this.sql, values.map(bindValue));
  }

  async first<T = Record<string, SqlValue>>(column?: string): Promise<T | null> {
    const [r] = await this.db.send([this.op('first')], false);
    const row = r.results[0];
    if (column === undefined) return (row ?? null) as T | null;
    if (row && !(column in row)) throw new Error(`Column not found (${column})`);
    return (row?.[column] ?? null) as T | null;
  }

  async all<T = Record<string, SqlValue>>() {
    const [r] = await this.db.send([this.op('all')], false);
    return { success: true as const, results: r.results as T[], meta: meta(r) };
  }

  async run() {
    const [r] = await this.db.send([this.op('run')], false);
    return { success: true as const, meta: meta(r) };
  }
}

class RemoteTenantDb implements TenantDb {
  constructor(private readonly stub: DurableObjectStub<TenantStore>) {}

  /** One RPC to the store; a SQL error comes back as a value and is rethrown here with its message. */
  async send(ops: SqlOp[], atomic: boolean): Promise<SqlResult[]> {
    const r = await this.stub.query(ops, atomic);
    if (!r.ok) throw new Error(r.error);
    return r.results;
  }

  prepare(sql: string): TenantStatement {
    return new RemoteStatement(this, sql);
  }

  /** Like D1: every statement's rows, all in one transaction (one RPC). */
  async batch<T = Record<string, SqlValue>>(statements: TenantStatement[]) {
    if (!statements.length) throw new Error('No SQL statements detected.');
    const ops = statements.map((s) => {
      if (!(s instanceof RemoteStatement)) throw new TypeError('batch() takes statements prepared on this database');
      return s.op('all');
    });
    const out = await this.send(ops, true);
    return out.map((r) => ({ success: true as const, results: r.results as T[], meta: meta(r) }));
  }
}

/** A landlord's own store behind the D1-shaped API. */
export function remoteTenantDb(stub: DurableObjectStub<TenantStore>): TenantDb {
  return new RemoteTenantDb(stub);
}

class ReadOnlyStatement implements TenantStatement {
  constructor(
    readonly inner: TenantStatement,
    readonly sql: string,
  ) {}

  /** Refuse a write at run time (preparing one is harmless), as a rejected promise like any SQL error. */
  private check() {
    if (isWriteSql(this.sql)) throw new TenantLockedError();
  }

  bind(...values: SqlValue[]): TenantStatement {
    return new ReadOnlyStatement(this.inner.bind(...values), this.sql);
  }

  async first<T = Record<string, SqlValue>>(column?: string): Promise<T | null> {
    this.check();
    return this.inner.first<T>(column);
  }

  async all<T = Record<string, SqlValue>>() {
    this.check();
    return this.inner.all<T>();
  }

  async run() {
    this.check();
    return this.inner.run();
  }
}

class ReadOnlyTenantDb implements TenantDb {
  constructor(private readonly db: TenantDb) {}

  prepare(sql: string): TenantStatement {
    return new ReadOnlyStatement(this.db.prepare(sql), sql);
  }

  /** One write anywhere refuses the whole batch before any statement runs. */
  async batch<T = Record<string, SqlValue>>(statements: TenantStatement[]) {
    const inner = statements.map((s) => {
      if (!(s instanceof ReadOnlyStatement)) throw new TypeError('batch() takes statements prepared on this database');
      if (isWriteSql(s.sql)) throw new TenantLockedError();
      return s.inner;
    });
    return this.db.batch<T>(inner);
  }
}

/** Reads pass through to `db`; writes (see isWriteSql) reject with TenantLockedError. */
export function readOnlyDb(db: TenantDb): TenantDb {
  return new ReadOnlyTenantDb(db);
}

/** True for a database made by readOnlyDb: callers skip optional writes (e.g. Sheet sync inside a read API). */
export function isReadOnly(db: TenantDb): boolean {
  return db instanceof ReadOnlyTenantDb;
}
