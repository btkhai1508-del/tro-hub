import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../app.ts';
import { digestRows } from '../migrate/digest.ts';
import { TENANT_MIGRATIONS, TENANT_TABLES, isWriteSql, type SqlValue } from './schema.ts';

export interface SqlOp {
  sql: string;
  params: SqlValue[];
  mode: 'all' | 'first' | 'run';
}

export interface SqlResult {
  results: Record<string, SqlValue>[];
  changes: number;
  lastRowId: number;
}

/**
 * Outcome of query(). A SQL error comes back as a value rather than a thrown exception: thrown errors
 * cross the RPC boundary as uncaught exceptions in the store, and the caller (remoteTenantDb) rethrows
 * the message on its side anyway.
 */
export type QueryResult = { ok: true; results: SqlResult[] } | { ok: false; error: string };

/** Result of the copy methods (importRows / exportTable / digest): errors come back as values, as with query(). */
export type Outcome<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

export interface TenantInfo {
  ownerId: number | null;
  schemaVersion: number;
  lastWriteAt: number | null;
  migratedFrom: string | null;
  migratedAt: number | null;
  sizeBytes: number;
  rowsWrittenToday: number;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const today = () => new Date().toISOString().slice(0, 10); // UTC day: Cloudflare daily limits reset at 00:00 UTC

function tableDef(table: string) {
  const def = TENANT_TABLES.find((t) => t.name === table);
  if (!def) throw new Error(`Unknown tenant table: ${table}`);
  return def;
}

/** One landlord's data: a Durable Object with its own SQLite database, named `owner:<staff.id>`. */
export class TenantStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private sql = (query: string, ...params: SqlValue[]) => this.ctx.storage.sql.exec(query, ...params);

  private getMeta(key: string): string | null {
    const row = this.sql('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return row ? (row.value as string | null) : null;
  }

  private putMeta(key: string, value: string | null) {
    if (value === null) this.sql('DELETE FROM meta WHERE key = ?', key);
    else this.sql('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  private migrate() {
    const hasMeta = this.sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
    const version = hasMeta ? Number(this.getMeta('schema_version') ?? 0) : 0;
    for (let i = version; i < TENANT_MIGRATIONS.length; i++) {
      this.ctx.storage.transactionSync(() => {
        this.sql(TENANT_MIGRATIONS[i]);
        this.putMeta('schema_version', String(i + 1));
      });
    }
  }

  /** Record a data write: last_write_at plus the UTC-day row counter. */
  private touch(rowsWritten: number) {
    const day = today();
    const [d, n] = (this.getMeta('writes_today') ?? '').split(':');
    const total = (d === day ? Number(n) || 0 : 0) + rowsWritten;
    this.putMeta('last_write_at', String(Date.now()));
    this.putMeta('writes_today', `${day}:${total}`);
  }

  /** Run statements in order; `atomic` runs them in one transaction (D1 batch semantics). */
  async query(ops: SqlOp[], atomic: boolean): Promise<QueryResult> {
    const out: SqlResult[] = [];
    let wrote = false;
    let rowsWritten = 0;
    const runAll = () => {
      for (const op of ops) {
        const isWrite = isWriteSql(op.sql);
        const cur = this.sql(op.sql, ...op.params);
        let results: Record<string, SqlValue>[] = [];
        if (op.mode === 'all') results = cur.toArray() as Record<string, SqlValue>[];
        else if (op.mode === 'first') results = cur.toArray().slice(0, 1) as Record<string, SqlValue>[];
        else cur.toArray(); // drain so the statement fully executes
        let changes = 0;
        let lastRowId = 0;
        if (isWrite) {
          wrote = true;
          rowsWritten += cur.rowsWritten;
          const m = this.sql('SELECT changes() AS c, last_insert_rowid() AS r').one();
          changes = m.c as number;
          lastRowId = m.r as number;
        }
        out.push({ results, changes, lastRowId });
      }
    };
    let error: string | null = null;
    try {
      if (atomic) this.ctx.storage.transactionSync(runAll);
      else runAll();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    // Non-atomic calls keep what ran before a failure, so they still count; an atomic rollback undid it.
    if (wrote && (error === null || !atomic)) this.touch(rowsWritten);
    return error === null ? { ok: true, results: out } : { ok: false, error };
  }

  /**
   * Insert rows (explicit ids kept) in one transaction. Like query(), a SQL error comes back as a value:
   * thrown errors cross the RPC boundary as uncaught exceptions, and the migration treats any failure as fatal.
   */
  async importRows(table: string, rows: Record<string, SqlValue>[]): Promise<Outcome<{ count: number }>> {
    return this.guard(() => {
      tableDef(table);
      let written = 0;
      this.ctx.storage.transactionSync(() => {
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.every((c) => IDENT_RE.test(c))) throw new Error(`Invalid column name in ${table}`);
          const cur = this.sql(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            ...cols.map((c) => row[c]),
          );
          written += cur.rowsWritten;
        }
        if (rows.length) this.touch(written);
      });
      return { count: rows.length };
    });
  }

  async exportTable(table: string, offset: number, limit: number): Promise<Outcome<{ rows: Record<string, SqlValue>[] }>> {
    return this.guard(() => {
      const def = tableDef(table);
      const rows = this.sql(`SELECT * FROM ${table} ORDER BY ${def.pk.join(', ')} LIMIT ? OFFSET ?`, limit, offset).toArray() as Record<string, SqlValue>[];
      return { rows };
    });
  }

  async digest(table: string): Promise<Outcome<{ count: number; sha256: string }>> {
    try {
      const def = tableDef(table);
      const rows = this.sql(`SELECT * FROM ${table}`).toArray() as Record<string, SqlValue>[];
      return { ok: true, count: rows.length, sha256: await digestRows(rows, def.pk) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private guard<T extends object>(fn: () => T): Outcome<T> {
    try {
      return { ok: true, ...fn() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Raise the AUTOINCREMENT counters so the next id of each table is at least the given floor (never lowers
   * one). Deliberately not a data write: last_write_at stays, so the rollback fast path still sees "no writes".
   * Call after reset() and after the rows were copied (reset clears sqlite_sequence).
   */
  async setSequences(floors: Record<string, number>): Promise<Outcome<{ raised: number }>> {
    return this.guard(() => {
      let raised = 0;
      this.ctx.storage.transactionSync(() => {
        for (const [table, floor] of Object.entries(floors)) {
          tableDef(table);
          const want = floor - 1; // sqlite_sequence holds the last id used
          const cur = this.sql('SELECT seq FROM sqlite_sequence WHERE name = ?', table).toArray()[0];
          if (!cur) this.sql('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', table, want);
          else if ((cur.seq as number) < want) this.sql('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', want, table);
          else continue;
          raised++;
        }
      });
      return { raised };
    });
  }

  async info(): Promise<TenantInfo> {
    const num = (k: string) => {
      const v = this.getMeta(k);
      return v === null ? null : Number(v);
    };
    const [d, n] = (this.getMeta('writes_today') ?? '').split(':');
    return {
      ownerId: num('owner_id'),
      schemaVersion: num('schema_version') ?? 0,
      lastWriteAt: num('last_write_at'),
      migratedFrom: this.getMeta('migrated_from'),
      migratedAt: num('migrated_at'),
      sizeBytes: this.ctx.storage.sql.databaseSize,
      rowsWrittenToday: d === today() ? Number(n) || 0 : 0,
    };
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    this.putMeta(key, value);
  }

  async reset(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const t of [...TENANT_TABLES].reverse()) this.sql(`DELETE FROM ${t.name}`);
      this.sql('DELETE FROM sqlite_sequence');
      for (const k of ['last_write_at', 'migrated_from', 'migrated_at']) this.putMeta(k, null);
    });
  }
}
