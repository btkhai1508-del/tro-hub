import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { migrateOwner } from '../src/migrate/tenant.ts';
import { TENANT_MIGRATIONS, TENANT_TABLES } from '../src/tenant/schema.ts';
import type { TenantStore } from '../src/tenant/store.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { seedWorld } from './helpers.ts';

const e = env as unknown as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[]; TENANT: DurableObjectNamespace<TenantStore> };
const DB = e.DB;
const NEW_TABLES = ['house_services', 'room_service_optouts', 'invoice_lines'];

type Row = Record<string, unknown>;
const norm = (rows: Row[]) => rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk]);

/** Statements of migration 0022 that change data (seed + backfill), picked by shape. */
function dataSql(re: RegExp): string[] {
  const m = e.TEST_MIGRATIONS.find((x) => x.name.startsWith('0022'))!;
  return m.queries.filter((q) => re.test(q.replace(/^\s*(--[^\n]*\n\s*)*/, '')));
}
const SEED_RE = /^(INSERT\b[^;]*\bhouse_services|UPDATE houses SET actual_electric_price)/i;
const ISSUED_RE = /^UPDATE invoices SET issued_at/i;

describe('lược đồ phí dịch vụ', () => {
  it('kho mới có 3 bảng giống D1 (cột, chỉ mục) kể cả invoices và houses', async () => {
    const stub = e.TENANT.get(e.TENANT.idFromName('billing:fresh'));
    await runInDurableObject(stub, async (_i, state) => {
      const sql = state.storage.sql;
      for (const t of NEW_TABLES) expect(TENANT_TABLES.map((x) => x.name)).toContain(t);
      for (const t of [...NEW_TABLES, 'invoices', 'houses']) {
        const cols = norm(sql.exec(`PRAGMA table_info(${t})`).toArray() as Row[]);
        expect(cols, t).toEqual(norm((await DB.prepare(`PRAGMA table_info(${t})`).all()).results as Row[]));
      }
    });
  });

  it('kho tạo trước phiên bản mới được nâng cấp khi mở lại', async () => {
    const stub = e.TENANT.get(e.TENANT.idFromName('billing:old'));
    await runInDurableObject(stub, async (_i, state) => {
      const sql = state.storage.sql;
      // Rebuild the old (version 1) shape: drop the new tables and columns, then rewind the version.
      for (const t of NEW_TABLES) sql.exec(`DROP TABLE ${t}`);
      sql.exec(`ALTER TABLE invoices DROP COLUMN issued_at`);
      sql.exec(`ALTER TABLE houses DROP COLUMN actual_electric_price`);
      sql.exec(`UPDATE meta SET value = '1' WHERE key = 'schema_version'`);
      sql.exec(
        `INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('H','n','a','d','w','p','l','0')`,
      );
      const again = new (_i.constructor as new (s: DurableObjectState, e: unknown) => TenantStore)(state, env);
      await state.blockConcurrencyWhile(async () => {}); // let the constructor's migration finish
      expect((await again.info()).schemaVersion).toBe(TENANT_MIGRATIONS.length);
      for (const t of [...NEW_TABLES, 'invoices', 'houses']) {
        expect(norm(sql.exec(`PRAGMA table_info(${t})`).toArray() as Row[]), t).toEqual(
          norm((await DB.prepare(`PRAGMA table_info(${t})`).all()).results as Row[]),
        );
      }
      expect(sql.exec(`SELECT id FROM houses`).toArray()).toEqual([{ id: 'H' }]);
    });
  });
});

describe('dữ liệu ban đầu của 0022', () => {
  beforeEach(async () => {
    await seedWorld('d1');
    await DB.batch([DB.prepare(`DELETE FROM house_services`), DB.prepare(`UPDATE houses SET actual_electric_price = NULL`)]);
  });

  it('Trung Kim và LVC có đúng 3 dịch vụ, nhà khác không đổi', async () => {
    const stmts = dataSql(SEED_RE);
    expect(stmts.length).toBeGreaterThan(0);
    await DB.batch(stmts.map((q) => DB.prepare(q)));
    for (const h of ['TRUNG_KIM', 'LVC']) {
      const rows = (await DB.prepare(`SELECT name, price, per, max_qty, sheet_col, sort, active FROM house_services WHERE house_id = ? ORDER BY sort`).bind(h).all()).results;
      expect(rows).toEqual([
        { name: 'Rác', price: 30000, per: 'room', max_qty: null, sheet_col: 'K', sort: 1, active: 1 },
        { name: 'Internet', price: 40000, per: 'person', max_qty: 2, sheet_col: 'L', sort: 2, active: 1 },
        { name: 'Xe máy', price: 50000, per: 'vehicle', max_qty: null, sheet_col: 'M', sort: 3, active: 1 },
      ]);
    }
    const prices = (await DB.prepare(`SELECT id, actual_electric_price AS p FROM houses ORDER BY id`).all()).results;
    expect(prices).toEqual([{ id: 'LVC', p: 3300 }, { id: 'NTTD', p: null }, { id: 'TRUNG_KIM', p: 3300 }]);
    expect((await DB.prepare(`SELECT COUNT(*) AS n FROM house_services WHERE house_id = 'NTTD'`).first<{ n: number }>())!.n).toBe(0);
  });

  it('cơ sở dữ liệu không có hai căn đó thì không đổi', async () => {
    await DB.batch([DB.prepare(`DELETE FROM invoices`), DB.prepare(`DELETE FROM residents WHERE house_id IN ('TRUNG_KIM','LVC')`), DB.prepare(`DELETE FROM rooms WHERE house_id IN ('TRUNG_KIM','LVC')`), DB.prepare(`DELETE FROM houses WHERE id IN ('TRUNG_KIM','LVC')`)]);
    await DB.batch(dataSql(SEED_RE).map((q) => DB.prepare(q)));
    expect((await DB.prepare(`SELECT COUNT(*) AS n FROM house_services`).first<{ n: number }>())!.n).toBe(0);
  });

  it('công tắc mặc định là sheet và không ghi đè giá trị có sẵn', async () => {
    const v = await DB.prepare(`SELECT value FROM settings WHERE key = 'source_of_truth'`).first<{ value: string }>();
    expect(v!.value).toBe('sheet');
    const ins = e.TEST_MIGRATIONS.find((x) => x.name.startsWith('0022'))!.queries.filter((q) => /INSERT OR IGNORE INTO settings/i.test(q));
    expect(ins).toHaveLength(1);
    await DB.prepare(`UPDATE settings SET value = 'worker' WHERE key = 'source_of_truth'`).run();
    await DB.prepare(ins[0]).run();
    expect((await DB.prepare(`SELECT value FROM settings WHERE key = 'source_of_truth'`).first<{ value: string }>())!.value).toBe('worker');
    await DB.prepare(`UPDATE settings SET value = 'sheet' WHERE key = 'source_of_truth'`).run();
  });

  it('hoá đơn cũ: tất cả đã phát hành (không có nháp từ bước điền lại)', async () => {
    const cur = (await DB.prepare(`SELECT strftime('%Y-%m', 'now', '+7 hours') AS m`).first<{ m: string }>())!.m;
    const prev = (await DB.prepare(`SELECT strftime('%Y-%m', 'now', '+7 hours', 'start of month', '-1 month') AS m`).first<{ m: string }>())!.m;
    await DB.batch([
      DB.prepare(`DELETE FROM payment_gates`),
      DB.prepare(`DELETE FROM invoices`),
      DB.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (7, 'TRUNG_KIM', '102', 1), (8, 'LVC', '102', 1)`),
      DB.prepare(`INSERT INTO invoices (id, house_id, room_id, month, created_at) VALUES
        (101, 'TRUNG_KIM', 1, ?1, '2026-01-05 00:00:00'),
        (102, 'TRUNG_KIM', 7, ?2, '2026-02-05 00:00:00'),
        (103, 'LVC', 3, ?2, '2026-03-05 00:00:00'),
        (104, 'LVC', 8, ?2, '2026-04-05 00:00:00')`).bind(prev, cur),
      DB.prepare(`INSERT INTO payment_gates (house_id, month, value) VALUES ('TRUNG_KIM', ?1, 'START'), ('LVC', ?1, 'STOP')`).bind(cur),
    ]);
    const stmts = dataSql(ISSUED_RE);
    expect(stmts.length).toBeGreaterThan(0);
    await DB.batch(stmts.map((q) => DB.prepare(q)));
    const got = (await DB.prepare(`SELECT id, issued_at FROM invoices ORDER BY id`).all()).results;
    expect(got).toEqual([
      { id: 101, issued_at: '2026-01-05 00:00:00' }, // earlier month
      { id: 102, issued_at: '2026-02-05 00:00:00' }, // current month, gate START
      { id: 103, issued_at: '2026-03-05 00:00:00' }, // current month, gate STOP: still visible, as today
      { id: 104, issued_at: '2026-04-05 00:00:00' }, // current month, no gate row
    ]);
  });
});

describe('chạy thử với dữ liệu ở 3 bảng mới', () => {
  it('migrateOwner dry-run khớp băm từng bảng', async () => {
    await seedWorld('d1');
    const db = await tenantOfOwner(e, 1);
    await db.batch([
      db.prepare(`DELETE FROM house_services`),
      db.prepare(`INSERT INTO house_services (id, house_id, name, price, per) VALUES (1, 'LVC', 'Rác', 30000, 'room'), (2, 'TRUNG_KIM', 'Xe máy', 50000, 'vehicle')`),
      db.prepare(`INSERT INTO room_service_optouts (room_id, service_id) VALUES (3, 1), (1, 2)`),
      db.prepare(`INSERT INTO invoice_lines (invoice_id, kind, name, qty, unit_price, amount)
        SELECT id, 'room', 'Tiền phòng', 1, room_rent, room_rent FROM invoices`),
    ]);
    // Another landlord's rows must not leak into this landlord's copy.
    await DB.batch([
      DB.prepare(`INSERT INTO house_services (id, house_id, name, price, per) VALUES (90, 'NTTD', 'Rác', 1, 'room')`),
    ]);
    const r = await migrateOwner(e, 1, { dryRun: true });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    for (const t of NEW_TABLES) {
      const row = r.tables.find((x) => x.table === t)!;
      expect(row.ok && row.d1Sha === row.doSha, t).toBe(true);
    }
    expect(r.tables.find((x) => x.table === 'house_services')).toMatchObject({ d1Count: 2, doCount: 2 });
    expect(r.tables.find((x) => x.table === 'room_service_optouts')).toMatchObject({ d1Count: 2, doCount: 2 });
    expect(r.tables.find((x) => x.table === 'invoice_lines')!.d1Count).toBeGreaterThan(0);
  });
});
