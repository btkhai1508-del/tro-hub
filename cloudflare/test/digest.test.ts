import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { digestRows, ownerRowsFromD1 } from '../src/migrate/digest.ts';
import { TENANT_TABLES, type SqlValue } from '../src/tenant/schema.ts';
import { tenantStub } from '../src/tenant/route.ts';
import { seedWorld } from './helpers.ts';

const e = env as unknown as Env;
type Row = Record<string, SqlValue>;
const MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1
let n = 0;
const fresh = () => e.TENANT.get(e.TENANT.idFromName(`digest:${++n}`));

describe('digestRows', () => {
  const rows: Row[] = [
    { id: 2, a: 'x', b: null },
    { id: 10, a: 'y', b: 0 },
    { id: 1, a: '', b: 'z' },
  ];
  it('same set in any order gives the same digest, numeric pk sorted as numbers', async () => {
    const d = await digestRows(rows, ['id']);
    expect(await digestRows([rows[2], rows[0], rows[1]], ['id'])).toBe(d);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });
  it('key order inside a row does not matter', async () => {
    expect(await digestRows([{ b: null, a: 'x', id: 2 }], ['id'])).toBe(await digestRows([{ id: 2, a: 'x', b: null }], ['id']));
  });
  it('changing one cell changes the digest', async () => {
    const d = await digestRows(rows, ['id']);
    expect(await digestRows([rows[0], { ...rows[1], a: 'Y' }, rows[2]], ['id'])).not.toBe(d);
    expect(await digestRows(rows.slice(0, 2), ['id'])).not.toBe(d);
  });
  it('null, empty string, 0 and "0" are all different', async () => {
    const ds = await Promise.all([null, '', 0, '0'].map((v) => digestRows([{ id: 1, v }], ['id'])));
    expect(new Set(ds).size).toBe(4);
  });
  it('composite pk is supported', async () => {
    const a: Row[] = [{ house_id: 'B', month: '2026-01' }, { house_id: 'A', month: '2026-02' }, { house_id: 'A', month: '2026-01' }];
    expect(await digestRows([a[1], a[2], a[0]], ['house_id', 'month'])).toBe(await digestRows([a[2], a[1], a[0]], ['house_id', 'month']));
  });
});

/** Extra owner-1 rows exercising NULLs, unicode, big integers and a house-less payment. */
async function seedExtras() {
  const DB = e.DB;
  await DB.batch([
    DB.prepare(`UPDATE houses SET bank_account_no = '111222333', bank_name = 'Ngân hàng Á Châu', floors = ? WHERE id = 'TRUNG_KIM'`).bind(MAX),
    DB.prepare(`UPDATE houses SET bank_account_no = '999888777' WHERE id = 'NTTD'`),
    DB.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, ?), ('NTTD', 1, 2)`).bind(MAX),
    DB.prepare(`INSERT INTO rooms (id, house_id, name, price, deposit, floor, deleted_at) VALUES (900, 'TRUNG_KIM', 'Phòng đặc biệt – ế', ?, 0, NULL, '2026-01-01')`).bind(MAX),
    DB.prepare(`INSERT INTO meter_readings (id, house_id, room_id, month, electric_old, electric_new) VALUES (700, 'TRUNG_KIM', 900, '2026-11', 0, ?)`).bind(MAX),
    DB.prepare(`INSERT INTO invoices (id, house_id, room_id, month, total, status, paid_at, status_by) VALUES (800, 'TRUNG_KIM', 900, '2026-10', ?, 'paid', NULL, '')`).bind(MAX),
    DB.prepare(`INSERT INTO payments (id, house_id, invoice_id, amount, method, account_no, reference, content, paid_at) VALUES
      (600, 'TRUNG_KIM', 800, ?, 'bank', '111222333', 'REF-1', 'Tiền phòng tháng 10 – Nguyễn Văn Ế', '2026-10-05'),
      (601, NULL, NULL, 123, 'bank', '111222333', 'REF-2', NULL, '2026-10-06'),
      (602, NULL, NULL, 456, 'bank', '999888777', 'REF-3', '', '2026-10-07'),
      (603, NULL, NULL, 789, 'bank', '000000000', 'REF-4', 'ai đó', '2026-10-08'),
      (604, 'NTTD', NULL, 5, 'cash', NULL, NULL, NULL, '2026-10-09')`).bind(MAX),
    DB.prepare(`INSERT INTO payment_gates (house_id, month, value, updated_by) VALUES ('TRUNG_KIM', '2026-11', 'STOP', NULL), ('LVC', '2026-11', 'START', 'staff:1'), ('NTTD', '2026-11', 'START', NULL)`),
    DB.prepare(`INSERT INTO notifications (id, house_id, room_names, title, content, created_by) VALUES (500, 'TRUNG_KIM', NULL, 'Thông báo', 'Nội dung có dấu: ắ ề ỗ ữ 😀', 'staff:1'), (501, 'NTTD', '1', 't', 'c', 'x')`),
  ]);
}

async function exportAll(owner: number, table: (typeof TENANT_TABLES)[number]): Promise<Row[]> {
  const out: Row[] = [];
  for (let off = 0; ; off += 3) {
    const page = await ownerRowsFromD1(e, owner, table, off, 3);
    out.push(...page);
    if (page.length < 3) return out;
  }
}

describe('ownerRowsFromD1 and store digest', () => {
  beforeEach(async () => {
    await seedWorld('d1');
    await seedExtras();
  });

  it('never returns another owner’s rows', async () => {
    for (const t of TENANT_TABLES) {
      const rows = await exportAll(1, t);
      const houseIds = new Set(rows.map((r) => (t.name === 'houses' ? r.id : r.house_id)));
      expect(houseIds.has('NTTD'), t.name).toBe(false);
      const other = await exportAll(4, t);
      expect(other.every((r) => (t.name === 'houses' ? r.id : r.house_id) !== 'TRUNG_KIM' && (t.name === 'houses' ? r.id : r.house_id) !== 'LVC' ), t.name).toBe(true);
    }
  });

  it('payments: includes house-less rows of the owner’s bank accounts only', async () => {
    const ids = (await exportAll(1, TENANT_TABLES[6])).map((r) => r.id);
    expect(ids).toEqual([600, 601]);
    const ids4 = (await exportAll(4, TENANT_TABLES[6])).map((r) => r.id);
    expect(ids4).toEqual([602, 604]);
  });

  it('pages are stable and complete', async () => {
    const all = await ownerRowsFromD1(e, 1, TENANT_TABLES[0], 0, 100);
    const paged = [...(await ownerRowsFromD1(e, 1, TENANT_TABLES[0], 0, 1)), ...(await ownerRowsFromD1(e, 1, TENANT_TABLES[0], 1, 1))];
    expect(paged).toEqual(all);
    expect(all.length).toBe(2);
  });

  it('round trip: store digest equals digest of the D1 rows, for all 9 tables', async () => {
    const stub = fresh();
    for (const t of TENANT_TABLES) {
      const rows = await exportAll(1, t);
      expect(rows.length, t.name).toBeGreaterThan(0);
      for (let i = 0; i < rows.length; i += 200) await stub.importRows(t.name, rows.slice(i, i + 200));
      const d = await stub.digest(t.name);
      expect(d.count, t.name).toBe(rows.length);
      expect(d.sha256, t.name).toBe(await digestRows(rows, t.pk));
      // No type drift across the RPC boundary: exported rows are identical, value for value.
      expect(await stub.exportTable(t.name, 0, 1000), t.name).toEqual(rows);
    }
  });

  it('large integers survive exactly', async () => {
    const stub = fresh();
    await stub.importRows('houses', await exportAll(1, TENANT_TABLES[0]));
    const r = await stub.query([{ sql: `SELECT floors FROM houses WHERE id = 'TRUNG_KIM'`, params: [], mode: 'first' }], false);
    expect(r.ok && r.results[0].results[0].floors).toBe(MAX);
  });

  it('digest detects a changed cell in the store', async () => {
    const stub = fresh();
    await stub.importRows('houses', await exportAll(1, TENANT_TABLES[0]));
    const rows = await exportAll(1, TENANT_TABLES[2]);
    await stub.importRows('rooms', rows);
    await stub.query([{ sql: `UPDATE rooms SET name = name || ' ' WHERE id = 900`, params: [], mode: 'run' }], false);
    expect((await stub.digest('rooms')).sha256).not.toBe(await digestRows(rows, ['id']));
  });

  it('AUTOINCREMENT: after import with explicit ids, an INSERT without id gets max id + 1', async () => {
    const stub = fresh();
    for (const t of TENANT_TABLES) await stub.importRows(t.name, await exportAll(1, t));
    const inserts: Record<string, string> = {
      rooms: `INSERT INTO rooms (house_id, name) VALUES ('TRUNG_KIM', 'new')`,
      residents: `INSERT INTO residents (house_id, full_name, password_hash) VALUES ('TRUNG_KIM', 'n', 'p')`,
      invoices: `INSERT INTO invoices (house_id, room_id, month) VALUES ('TRUNG_KIM', 900, '2030-01')`,
      meter_readings: `INSERT INTO meter_readings (house_id, room_id, month) VALUES ('TRUNG_KIM', 900, '2030-01')`,
      payments: `INSERT INTO payments (house_id, amount, method, paid_at) VALUES ('TRUNG_KIM', 1, 'cash', 'x')`,
      notifications: `INSERT INTO notifications (house_id, title, content, created_by) VALUES ('TRUNG_KIM', 't', 'c', 'x')`,
    };
    for (const [table, sql] of Object.entries(inserts)) {
      const before = (await stub.query([{ sql: `SELECT MAX(id) AS m FROM ${table}`, params: [], mode: 'first' }], false)) as any;
      const max = before.results[0].results[0].m as number;
      const r = (await stub.query([{ sql, params: [], mode: 'run' }], false)) as any;
      expect(r.ok, table).toBe(true);
      expect(r.results[0].lastRowId, table).toBe(max + 1);
    }
  });

  it('a 200-row batch of the widest table imports in one call', async () => {
    const stub = fresh();
    await stub.importRows('houses', await exportAll(1, TENANT_TABLES[0]));
    const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({
      id: 10000 + i, house_id: 'LVC', full_name: `Cư dân ${i}`, password_hash: 'p', phone: `09${String(i).padStart(8, '0')}`,
      gender: null, cccd_enc: null, cccd_last4: null, cccd_hash: null, email: null, dob: null, address_detail: null, ward: null,
      province: null, plate_number: null, vehicle_type: null, emergency_name: null, emergency_relation: null, emergency_phone: null,
      status: 'approved', move_in_date: null, move_out_date: null, created_at: '2026-01-01', deleted_at: null, password_changed_at: null, room_id: null,
    }));
    expect(await stub.importRows('residents', rows)).toBe(200);
    const d = await stub.digest('residents');
    expect(d.count).toBe(200);
    expect(d.sha256).toBe(await digestRows(rows, ['id']));
  });
});
