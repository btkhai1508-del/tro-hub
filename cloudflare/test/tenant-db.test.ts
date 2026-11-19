/**
 * The TenantDb adapter: the same statements must behave the same on the shared D1 (`env.DB`) and on a
 * landlord's own store (`remoteTenantDb`), plus the read-only wrapper used while a landlord migrates
 * and the routing from the storage switch to the right backend.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { App, Env, Viewer } from '../src/app.ts';
import { setStorage, upsertHouseDir } from '../src/central/directory.ts';
import { isReadOnly, readOnlyDb, remoteTenantDb, type TenantDb } from '../src/tenant/db.ts';
import { TenantLockedError, tenantFor, tenantOfOwner, tenantStub } from '../src/tenant/route.ts';
import { isWriteSql } from '../src/tenant/schema.ts';

const e = env as unknown as Env;
let n = 0;

const HOUSE = `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone)
               VALUES (?, 'n', 'a', 'd', 'w', 'p', 'l', '0')`;

/** A database of the given backend with one fresh house in it (D1 storage is shared by the tests of this file). */
async function open(backend: 'd1' | 'do'): Promise<{ db: TenantDb; house: string }> {
  const house = `TDB${++n}`;
  const db: TenantDb = backend === 'd1' ? e.DB : remoteTenantDb(e.TENANT.get(e.TENANT.idFromName(`tdb:${n}`)));
  await db.prepare(HOUSE).bind(house).run();
  return { db, house };
}

const countRooms = (db: TenantDb, house: string) => db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE house_id = ?`).bind(house).first('c');

describe.each(['d1', 'do'] as const)('adapter %s', (backend) => {
  it('first/all/run trả cùng dạng như D1', async () => {
    const { db, house } = await open(backend);
    const ins = await db.prepare(`INSERT INTO rooms (house_id, name, price) VALUES (?, ?, ?)`).bind(house, 'P101', 3000000).run();
    expect(ins.success).toBe(true);
    expect(ins.meta.changes).toBe(1);
    expect(ins.meta.last_row_id).toBeGreaterThan(0);
    const id = ins.meta.last_row_id;

    expect(await db.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(id).first('name')).toBe('P101');
    expect(await db.prepare(`SELECT name, price FROM rooms WHERE id = ?`).bind(id).first()).toEqual({ name: 'P101', price: 3000000 });
    expect(await db.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(-1).first()).toBeNull();
    expect(await db.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(-1).first('name')).toBeNull();
    expect(await db.prepare(`SELECT NULL AS v`).first('v')).toBeNull();

    const all = await db.prepare(`SELECT id, name FROM rooms WHERE house_id = ? ORDER BY id`).bind(house).all<{ id: number; name: string }>();
    expect(all.results).toEqual([{ id, name: 'P101' }]);
    expect(all.meta.changes).toBe(0);
    expect((await db.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(-1).all()).results).toEqual([]);

    const upd = await db.prepare(`UPDATE rooms SET price = price + 1 WHERE house_id = ?`).bind(house).run();
    expect(upd.meta.changes).toBe(1);
    expect((await db.prepare(`DELETE FROM rooms WHERE id = ?`).bind(-1).run()).meta.changes).toBe(0);
    const viaAll = await db.prepare(`UPDATE rooms SET price = 7 WHERE house_id = ?`).bind(house).all();
    expect(viaAll.results).toEqual([]);
    expect(viaAll.meta.changes).toBe(1);
  });

  it('bind, first(cột) và lệnh ghi có chú thích / WITH giống D1', async () => {
    const { db, house } = await open(backend);
    // bind returns a new statement: one prepared statement serves several values.
    const stmt = db.prepare(`SELECT ? AS v`);
    expect(await stmt.bind('a').first('v')).toBe('a');
    expect(await stmt.bind(2).first('v')).toBe(2);
    // Numbered parameters, booleans bound as 1/0, undefined refused, a missing column refused.
    expect(await db.prepare(`SELECT ?2 AS a, ?1 AS b`).bind('x', 'y').first()).toEqual({ a: 'y', b: 'x' });
    expect(await db.prepare(`SELECT ? AS t, ? AS f`).bind(true as unknown as number, false as unknown as number).first()).toEqual({ t: 1, f: 0 });
    expect(() => db.prepare(`SELECT ? AS v`).bind(undefined as unknown as null)).toThrow("Type 'undefined' not supported");
    await expect(db.prepare(`SELECT 1 AS a`).first('b')).rejects.toThrow('Column not found (b)');
    await expect(db.prepare(`SELECT ? AS a, ? AS b`).bind(1).first()).rejects.toThrow('Wrong number of parameter bindings');

    // Writes behind a leading comment or a WITH clause still report changes and the new row id.
    const commented = await db.prepare(`-- note\n/* why */ INSERT INTO rooms (house_id, name) VALUES (?, 'C1')`).bind(house).run();
    expect(commented.meta.changes).toBe(1);
    expect(commented.meta.last_row_id).toBeGreaterThan(0);
    const cte = await db.prepare(`WITH t(name) AS (VALUES ('W1'), ('W2')) INSERT INTO rooms (house_id, name) SELECT ?, name FROM t`).bind(house).run();
    expect(cte.meta.changes).toBe(2);
    expect(cte.meta.last_row_id).toBe(commented.meta.last_row_id + 2);
  });

  it('RETURNING trả dòng vừa chèn', async () => {
    const { db, house } = await open(backend);
    const row = await db.prepare(`INSERT INTO rooms (house_id, name) VALUES (?, ?) RETURNING id, name`).bind(house, 'R1').first<{ id: number; name: string }>();
    expect(row).toEqual({ id: expect.any(Number), name: 'R1' });
    expect(await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = 'R1'`).bind(house).first('id')).toBe(row!.id);
    expect(await db.prepare(`INSERT INTO rooms (house_id, name) VALUES (?, 'R2') RETURNING name`).bind(house).first('name')).toBe('R2');

    const upd = await db.prepare(`UPDATE rooms SET price = 5 WHERE house_id = ? RETURNING name, price`).bind(house).all();
    expect(upd.results.sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual([
      { name: 'R1', price: 5 },
      { name: 'R2', price: 5 },
    ]);
    expect(upd.meta.changes).toBe(2);

    // RETURNING inside a batch (how notifications are created).
    const [created] = await db.batch([db.prepare(`INSERT INTO rooms (house_id, name) VALUES (?, ?) RETURNING name`).bind(house, 'R3')]);
    expect(created.results).toEqual([{ name: 'R3' }]);
    expect(created.meta.changes).toBe(1);
  });

  it('batch là nguyên tử', async () => {
    const { db, house } = await open(backend);
    const ins = (name: string) => db.prepare(`INSERT INTO rooms (house_id, name) VALUES (?, ?)`).bind(house, name);
    const ok = await db.batch([ins('A'), ins('B'), db.prepare(`SELECT name FROM rooms WHERE house_id = ? ORDER BY name`).bind(house)]);
    expect(ok.map((r) => r.meta.changes).slice(0, 2)).toEqual([1, 1]);
    expect(ok[1].meta.last_row_id).toBe(ok[0].meta.last_row_id + 1);
    expect(ok[2].results).toEqual([{ name: 'A' }, { name: 'B' }]);

    // The second statement breaks UNIQUE (house_id, name): the first one is rolled back.
    await expect(db.batch([ins('C'), ins('A')])).rejects.toThrow('UNIQUE constraint failed');
    expect(await countRooms(db, house)).toBe(2);
    expect(await db.prepare(`SELECT id FROM rooms WHERE house_id = ? AND name = 'C'`).bind(house).first()).toBeNull();
    await expect(db.batch([])).rejects.toThrow('No SQL statements detected');
  });

  it('lỗi UNIQUE có message chứa "UNIQUE constraint failed"', async () => {
    const { db, house } = await open(backend);
    const dup = () => db.prepare(`INSERT INTO rooms (house_id, name) VALUES (?, 'X') RETURNING id`).bind(house);
    await dup().run();
    await expect(dup().run()).rejects.toThrow('UNIQUE constraint failed');
    await expect(dup().first()).rejects.toThrow('UNIQUE constraint failed');
    await expect(dup().all()).rejects.toBeInstanceOf(Error);
    await expect(db.prepare(HOUSE).bind(house).run()).rejects.toThrow('UNIQUE constraint failed');
    // The failed statements wrote nothing.
    expect(await countRooms(db, house)).toBe(1);
  });
});

describe('isWriteSql', () => {
  it.each([
    ['INSERT INTO rooms VALUES (1)', true],
    ['  update rooms set name = 1', true],
    ['delete from rooms', true],
    ['REPLACE INTO rooms VALUES (1)', true],
    ['-- note\n/* why */\n  INSERT INTO rooms VALUES (1)', true],
    ['/* a */ -- b\nupdate rooms SET price = 1', true],
    ["WITH t AS (SELECT 1) INSERT INTO rooms SELECT * FROM t", true],
    ['with t as (select 1) delete from rooms where id in t', true],
    ['SELECT * FROM rooms', false],
    ['select updated_at, deleted_at from rooms', false],
    ['-- DELETE\nSELECT 1', false],
    ['/* INSERT */ SELECT 1', false],
    ['WITH t AS (SELECT 1) SELECT * FROM t', false],
    ['', false],
  ])('%j → %s', (sql, expected) => {
    expect(isWriteSql(sql)).toBe(expected);
  });
});

describe('readOnlyDb', () => {
  it('readOnlyDb chặn ghi, cho đọc', async () => {
    const house = `TDB${++n}`;
    await e.DB.prepare(HOUSE).bind(house).run();
    const ro = readOnlyDb(e.DB);
    expect(isReadOnly(ro)).toBe(true);
    expect(isReadOnly(e.DB)).toBe(false);

    expect(await ro.prepare(`SELECT name FROM houses WHERE id = ?`).bind(house).first('name')).toBe('n');
    expect(await ro.prepare(`SELECT name FROM houses WHERE id = ?`).bind(house).first()).toEqual({ name: 'n' });
    expect((await ro.prepare(`SELECT id FROM houses WHERE id = ?`).bind(house).all()).results).toEqual([{ id: house }]);
    expect((await ro.prepare(`SELECT 1 AS one`).run()).success).toBe(true);
    const [r] = await ro.batch([ro.prepare(`SELECT name FROM houses WHERE id = ?`).bind(house)]);
    expect(r.results).toEqual([{ name: 'n' }]);

    for (const sql of [
      `UPDATE houses SET name = 'x' WHERE id = ?`,
      `  -- note\n delete FROM houses WHERE id = ?`,
      `/* c */ REPLACE INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES (?, 'x', 'a', 'd', 'w', 'p', 'l', '0')`,
      `WITH t AS (SELECT 1) UPDATE houses SET name = 'x' WHERE id = ?`,
    ]) {
      const stmt = ro.prepare(sql).bind(house);
      await expect(stmt.run(), sql).rejects.toBeInstanceOf(TenantLockedError);
      await expect(stmt.first(), sql).rejects.toBeInstanceOf(TenantLockedError);
      await expect(stmt.all(), sql).rejects.toBeInstanceOf(TenantLockedError);
    }
    // One write anywhere in a batch refuses the whole batch before anything runs.
    const mixed = [ro.prepare(`SELECT 1`), ro.prepare(`UPDATE houses SET name = 'x' WHERE id = ?`).bind(house)];
    await expect(ro.batch(mixed)).rejects.toBeInstanceOf(TenantLockedError);
    expect(await e.DB.prepare(`SELECT name FROM houses WHERE id = ?`).bind(house).first('name')).toBe('n');

    // It wraps a landlord's store the same way.
    const store = remoteTenantDb(e.TENANT.get(e.TENANT.idFromName(`tdb:ro:${++n}`)));
    const roStore = readOnlyDb(store);
    expect(isReadOnly(roStore)).toBe(true);
    expect(isReadOnly(store)).toBe(false);
    await expect(roStore.prepare(HOUSE).bind('X').run()).rejects.toBeInstanceOf(TenantLockedError);
    expect(await roStore.prepare(`SELECT COUNT(*) AS c FROM houses`).first('c')).toBe(0);
  });
});

describe('định tuyến', () => {
  it('tenantStub đặt tên kho owner:<id> / dryrun:owner:<id>', () => {
    expect(tenantStub(e, 5).id.equals(e.TENANT.idFromName('owner:5'))).toBe(true);
    expect(tenantStub(e, 5, { dryRun: true }).id.equals(e.TENANT.idFromName('dryrun:owner:5'))).toBe(true);
  });

  it('tenantOfOwner theo công tắc', async () => {
    const owner = 101;
    const find = (db: TenantDb, id: string) => db.prepare(`SELECT id FROM houses WHERE id = ?`).bind(id).first('id');

    // No tenant_storage row: d1, the shared database itself.
    expect(await tenantOfOwner(e, owner)).toBe(e.DB);

    await setStorage(e.DB, owner, 'migrating');
    const locked = await tenantOfOwner(e, owner);
    expect(isReadOnly(locked)).toBe(true);
    await expect(locked.prepare(HOUSE).bind('TOO_LOCK').run()).rejects.toBeInstanceOf(TenantLockedError);
    expect(await find(e.DB, 'TOO_LOCK')).toBeNull();

    await setStorage(e.DB, owner, 'do');
    const store = await tenantOfOwner(e, owner);
    expect(isReadOnly(store)).toBe(false);
    expect(store).not.toBe(e.DB);
    await store.prepare(HOUSE).bind('TOO_DO').run();
    // The write landed in owner:101's store, not in D1 and not in the dry-run store.
    expect(await find(remoteTenantDb(tenantStub(e, owner)), 'TOO_DO')).toBe('TOO_DO');
    expect(await find(e.DB, 'TOO_DO')).toBeNull();
    expect(await find(remoteTenantDb(tenantStub(e, owner, { dryRun: true })), 'TOO_DO')).toBeNull();

    // An expired migration lock reads as d1 again.
    await setStorage(e.DB, owner, 'migrating', { lockMinutes: -1 });
    expect(await tenantOfOwner(e, owner)).toBe(e.DB);
  });

  it('tenantFor: 404 ngoài danh bạ, 403 khi không có quyền, còn lại là kho của chủ căn', async () => {
    const owner = 102;
    await upsertHouseDir(e.DB, { house_id: 'TF1', owner_id: owner, name: 'n', status: 'active', delete_after: null, pay_no: null, modules: null });
    await e.DB.prepare(HOUSE).bind('TF1').run();
    const app = (viewer: Viewer) => {
      const a = new Hono<App>();
      a.use(async (c, next) => {
        c.set('viewer', viewer);
        await next();
      });
      a.get('/:houseId', async (c) => {
        const db = await tenantFor(c, c.req.param('houseId'));
        return c.json({ success: true, name: await db.prepare(`SELECT name FROM houses WHERE id = ?`).bind(c.req.param('houseId')).first('name') });
      });
      return a;
    };
    const staff = (houseIds: string[]): Viewer => ({ kind: 'staff', id: owner, name: 'A', phone: '0', role: 'owner', houseIds });
    const resident: Viewer = { kind: 'resident', id: 1, name: 'R', phone: null, houseId: 'TF1', roomId: null, roomName: null };

    let res = await app(staff(['TF1', 'GHOST'])).request('/GHOST', {}, e);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, errorCode: 'HOUSE_NOT_FOUND', error: 'Không tìm thấy nhà trọ.' });

    res = await app(staff([])).request('/TF1', {}, e);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, errorCode: 'HOUSE_FORBIDDEN', error: 'Bạn không có quyền xem nhà trọ này.' });
    // A house the caller may not open answers 403 whether or not it exists.
    expect((await app(staff([])).request('/GHOST', {}, e)).status).toBe(403);

    res = await app(staff(['TF1'])).request('/TF1', {}, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'n' });
    expect(await (await app(resident).request('/TF1', {}, e)).json()).toEqual({ success: true, name: 'n' });

    // Once the landlord is on their own store, the same route reads from it.
    await remoteTenantDb(tenantStub(e, owner)).prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone)
      VALUES ('TF1', 'trong kho', 'a', 'd', 'w', 'p', 'l', '0')`).run();
    await setStorage(e.DB, owner, 'do');
    expect(await (await app(staff(['TF1'])).request('/TF1', {}, e)).json()).toEqual({ success: true, name: 'trong kho' });
  });

  it('403 của tenantFor ghi house_access_denied như requireHouse', async () => {
    const a = new Hono<App>();
    a.use(async (c, next) => {
      c.set('viewer', { kind: 'staff', id: 77, name: 'A', phone: '0', role: 'owner', houseIds: [] });
      await next();
    });
    a.get('/:houseId', async (c) => c.json({ db: Boolean(await tenantFor(c, c.req.param('houseId'))) }));
    expect((await a.request('/AUD1', {}, e)).status).toBe(403);
    const row = await e.DB.prepare(`SELECT house_id FROM audit_log WHERE action = 'house_access_denied' AND actor = 'staff:77'`).first<{ house_id: string }>();
    expect(row?.house_id).toBe('AUD1');
  });

  it('batch từ chối câu lệnh chuẩn bị trên một TenantDb khác', async () => {
    const one = remoteTenantDb(tenantStub(e, 901));
    const two = remoteTenantDb(tenantStub(e, 902));
    await expect(one.batch([two.prepare(`SELECT 1`)])).rejects.toBeInstanceOf(TypeError);
    const roA = readOnlyDb(e.DB);
    const roB = readOnlyDb(e.DB);
    await expect(roA.batch([roB.prepare(`SELECT 1`)])).rejects.toBeInstanceOf(TypeError);
    expect((await roA.batch([roA.prepare(`SELECT 1 AS n`).bind()]))[0].results).toEqual([{ n: 1 }]);
  });
});
