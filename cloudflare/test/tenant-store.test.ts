import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TENANT_MIGRATIONS, TENANT_TABLES } from '../src/tenant/schema.ts';
import type { SqlOp, TenantStore } from '../src/tenant/store.ts';

const e = env as unknown as { DB: D1Database; TENANT: DurableObjectNamespace<TenantStore> };
let n = 0;
// query() returns SQL errors as values; the other methods still throw, and errors thrown across the
// DO RPC boundary surface as unhandled rejections in the test runner, so those expected failures go
// through runInDurableObject (same instance, no RPC hop).
const direct = <T>(stub: DurableObjectStub<TenantStore>, fn: (s: TenantStore) => Promise<T>) => runInDurableObject(stub, (i: TenantStore) => fn(i));
const fresh = () => e.TENANT.get(e.TENANT.idFromName(`test:${++n}`));
/** Rows of a query that must succeed. */
async function rows(stub: DurableObjectStub<TenantStore>, ops: SqlOp[], atomic = false) {
  const r = await stub.query(ops, atomic);
  if (!r.ok) throw new Error(r.error);
  return r.results;
}
const HOUSE_SQL = "INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('H','n','a','d','w','p','l','0')";

type Row = Record<string, unknown>;

// PRAGMA table_info on both sides, normalized to name,type,notnull,dflt_value,pk.
const norm = (rows: Row[]) => rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk]);

async function d1Columns(t: string) {
  return norm((await e.DB.prepare(`PRAGMA table_info(${t})`).all()).results as Row[]);
}

async function d1Indexes() {
  const out: unknown[] = [];
  for (const t of TENANT_TABLES) {
    const list = (await e.DB.prepare(`PRAGMA index_list(${t.name})`).all()).results as Row[];
    for (const ix of list) {
      const cols = (await e.DB.prepare(`PRAGMA index_info(${ix.name})`).all()).results as Row[];
      out.push([t.name, ix.unique, ix.origin, cols.map((c) => c.name)]);
    }
  }
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe('TenantStore', () => {
  it('lược đồ kho giống D1', async () => {
    const stub = fresh();
    await runInDurableObject(stub, async (_i, state) => {
      const sql = state.storage.sql;
      for (const t of TENANT_TABLES) {
        const cols = norm(sql.exec(`PRAGMA table_info(${t.name})`).toArray() as Row[]);
        expect(cols, t.name).toEqual(await d1Columns(t.name));
      }
      const out: unknown[] = [];
      for (const t of TENANT_TABLES) {
        for (const ix of sql.exec(`PRAGMA index_list(${t.name})`).toArray() as Row[]) {
          const cols = sql.exec(`PRAGMA index_info(${ix.name})`).toArray() as Row[];
          out.push([t.name, ix.unique, ix.origin, cols.map((c) => c.name)]);
        }
      }
      out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(out).toEqual(await d1Indexes());
    });
  });

  it('migration chạy một lần, phiên bản tăng', async () => {
    const stub = fresh();
    expect((await stub.info()).schemaVersion).toBe(TENANT_MIGRATIONS.length);
    await runInDurableObject(stub, async (_i, state) => {
      // A second construction pass over the same storage must be a no-op.
      const again = new (_i.constructor as new (s: DurableObjectState, e: unknown) => TenantStore)(state, env);
      expect((await again.info()).schemaVersion).toBe(TENANT_MIGRATIONS.length);
    });
  });

  it('query atomic quay lui khi một lệnh lỗi', async () => {
    const stub = fresh();
    const ins = { sql: "INSERT INTO rooms (house_id, name) VALUES ('H', 'P101')", params: [], mode: 'run' as const };
    const count = { sql: 'SELECT COUNT(*) AS c FROM rooms', params: [], mode: 'first' as const };
    // A failed atomic call returns the SQL error as a value and leaves data and meta untouched.
    const failed = await stub.query([{ sql: HOUSE_SQL, params: [], mode: 'run' }, ins, ins], true);
    expect(failed).toEqual({ ok: false, error: expect.stringContaining('UNIQUE constraint failed') });
    expect((await rows(stub, [{ sql: 'SELECT COUNT(*) AS c FROM houses', params: [], mode: 'first' }]))[0].results[0].c).toBe(0);
    expect(await stub.info()).toMatchObject({ lastWriteAt: null, rowsWrittenToday: 0 });

    await rows(stub, [{ sql: HOUSE_SQL, params: [], mode: 'run' }], true);
    expect(await stub.query([ins, ins], true)).toMatchObject({ ok: false });
    expect((await rows(stub, [count]))[0].results[0].c).toBe(0);
    // Non-atomic keeps what ran before the failure, and counts it as a write.
    const before = (await stub.info()).rowsWrittenToday;
    expect(await stub.query([ins, ins], false)).toEqual({ ok: false, error: expect.stringContaining('UNIQUE constraint failed') });
    expect((await rows(stub, [count]))[0].results[0].c).toBe(1);
    expect((await stub.info()).rowsWrittenToday).toBeGreaterThan(before);
  });

  it('kết quả: changes, lastRowId, các chế độ', async () => {
    const stub = fresh();
    await rows(stub, [{ sql: HOUSE_SQL, params: [], mode: 'run' }]);
    const [a, b, c] = await rows(
      stub,
      [
        { sql: "INSERT INTO rooms (house_id, name) VALUES (?, ?)", params: ['H', 'A'], mode: 'run' },
        { sql: 'SELECT name FROM rooms WHERE house_id = ?', params: ['H'], mode: 'all' },
        { sql: 'SELECT name FROM rooms WHERE name = ?', params: ['zzz'], mode: 'first' },
      ],
      false,
    );
    expect(a.changes).toBe(1);
    expect(a.lastRowId).toBe(1);
    expect(a.results).toEqual([]);
    expect(b.results).toEqual([{ name: 'A' }]);
    expect(c.results).toEqual([]);
  });

  it('importRows / exportTable xếp theo khoá chính, giữ id', async () => {
    const stub = fresh();
    const house = { id: 'H', name: 'n', abbreviation: 'a', address_detail: 'd', ward: 'w', province: 'p', landlord_name: 'l', landlord_phone: '0' };
    expect(await stub.importRows('houses', [house])).toBe(1);
    const rooms = [30, 10, 20].map((id) => ({ id, house_id: 'H', name: `R${id}` }));
    expect(await stub.importRows('rooms', rooms)).toBe(3);
    const out = await stub.exportTable('rooms', 1, 2);
    expect(out.map((r) => r.id)).toEqual([20, 30]);
    await expect(direct(stub, (s) => s.importRows('nope', []))).rejects.toThrow();
    await expect(direct(stub, (s) => s.exportTable('meta', 0, 1))).rejects.toThrow();
  });

  it('reset xoá dữ liệu, giữ lược đồ', async () => {
    const stub = fresh();
    await stub.setMeta('owner_id', '7');
    await stub.setMeta('migrated_from', 'd1');
    await stub.setMeta('migrated_at', '123');
    await rows(stub, [{ sql: HOUSE_SQL, params: [], mode: 'run' }]);
    await rows(stub, [{ sql: "INSERT INTO rooms (house_id, name) VALUES ('H', 'A')", params: [], mode: 'run' }]);
    await stub.reset();
    const r = await rows(
      stub,
      [
        { sql: 'SELECT COUNT(*) AS c FROM houses', params: [], mode: 'first' },
        { sql: 'SELECT COUNT(*) AS c FROM rooms', params: [], mode: 'first' },
      ],
      false,
    );
    expect(r.map((x) => x.results[0].c)).toEqual([0, 0]);
    const info = await stub.info();
    expect(info).toMatchObject({ ownerId: 7, schemaVersion: TENANT_MIGRATIONS.length, lastWriteAt: null, migratedFrom: null, migratedAt: null });
    // AUTOINCREMENT restarts after reset.
    await rows(stub, [{ sql: HOUSE_SQL, params: [], mode: 'run' }]);
    const [ins] = await rows(stub, [{ sql: "INSERT INTO rooms (house_id, name) VALUES ('H', 'A')", params: [], mode: 'run' }]);
    expect(ins.lastRowId).toBe(1);
  });

  it('setMeta ghi và xoá, info.ownerId null khi chưa đặt', async () => {
    const stub = fresh();
    expect((await stub.info()).ownerId).toBeNull();
    await stub.setMeta('owner_id', '42');
    await stub.setMeta('migrated_from', 'd1');
    expect(await stub.info()).toMatchObject({ ownerId: 42, migratedFrom: 'd1' });
    await stub.setMeta('migrated_from', null);
    expect((await stub.info()).migratedFrom).toBeNull();
  });

  it('ghi cập nhật last_write_at và rowsWrittenToday, đọc thì không', async () => {
    const stub = fresh();
    const i0 = await stub.info();
    expect(i0.lastWriteAt).toBeNull();
    expect(i0.rowsWrittenToday).toBe(0);
    expect(i0.sizeBytes).toBeGreaterThan(0);
    await rows(stub, [{ sql: 'SELECT 1', params: [], mode: 'all' }]);
    expect(await stub.info()).toMatchObject({ lastWriteAt: null, rowsWrittenToday: 0 });
    const before = Date.now();
    await rows(stub, [{ sql: HOUSE_SQL, params: [], mode: 'run' }]);
    const i1 = await stub.info();
    expect(i1.lastWriteAt).toBeGreaterThanOrEqual(before);
    expect(i1.rowsWrittenToday).toBeGreaterThanOrEqual(1);
    // setMeta does not count as a data write.
    await stub.setMeta('migrated_from', 'x');
    expect((await stub.info()).lastWriteAt).toBe(i1.lastWriteAt);
    // importRows counts like a write.
    await stub.importRows('rooms', [{ id: 5, house_id: 'H', name: 'A' }]);
    expect((await stub.info()).rowsWrittenToday).toBeGreaterThan(i1.rowsWrittenToday);
  });

  it('digest chưa cài đặt', async () => {
    await expect(direct(fresh(), (s) => s.digest('rooms'))).rejects.toThrow('not implemented');
  });
});
