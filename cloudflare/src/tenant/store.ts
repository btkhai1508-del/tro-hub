import { DurableObject } from 'cloudflare:workers';
import { TENANT_MIGRATIONS, TENANT_TABLES, type SqlValue } from './schema.ts';

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

export interface TenantInfo {
  ownerId: number | null;
  schemaVersion: number;
  lastWriteAt: number | null;
  migratedFrom: string | null;
  migratedAt: number | null;
  sizeBytes: number;
  rowsWrittenToday: number;
}

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const today = () => new Date().toISOString().slice(0, 10); // UTC day: Cloudflare daily limits reset at 00:00 UTC

function tableDef(table: string) {
  const def = TENANT_TABLES.find((t) => t.name === table);
  if (!def) throw new Error(`Unknown tenant table: ${table}`);
  return def;
}

/** One landlord's data: a Durable Object with its own SQLite database, named `owner:<staff.id>`. */
export class TenantStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
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

  async query(ops: SqlOp[], atomic: boolean): Promise<SqlResult[]> {
    const out: SqlResult[] = [];
    let wrote = false;
    let rowsWritten = 0;
    const runAll = () => {
      for (const op of ops) {
        const isWrite = WRITE_RE.test(op.sql);
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
    try {
      if (atomic) this.ctx.storage.transactionSync(runAll);
      else runAll();
    } finally {
      // Non-atomic calls keep what ran before a failure, so they still count; an atomic rollback undid it.
      if (wrote && (!atomic || out.length === ops.length)) this.touch(rowsWritten);
    }
    return out;
  }

  async importRows(table: string, rows: Record<string, SqlValue>[]): Promise<number> {
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
    return rows.length;
  }

  async exportTable(table: string, offset: number, limit: number): Promise<Record<string, SqlValue>[]> {
    const def = tableDef(table);
    return this.sql(`SELECT * FROM ${table} ORDER BY ${def.pk.join(', ')} LIMIT ? OFFSET ?`, limit, offset).toArray() as Record<
      string,
      SqlValue
    >[];
  }

  async digest(_table: string): Promise<{ count: number; sha256: string }> {
    throw new Error('not implemented'); // Task 12 (digestRows)
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
