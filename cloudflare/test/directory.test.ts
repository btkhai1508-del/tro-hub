import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PhoneTakenError,
  allocateHousePayNo,
  getStorage,
  houseOwner,
  removeHouseDir,
  reserveResident,
  setStorage,
} from '../src/central/directory.ts';

const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: { name: string; queries: string[] }[] };
const DB = e.DB;

// The backfill block of 0019 (between the backfill markers): readD1Migrations splits the file into
// statements and may drop comments, so pick its INSERT statements by shape.
function backfillSql(): string[] {
  const m = e.TEST_MIGRATIONS.find((x) => x.name.startsWith('0019'))!;
  return m.queries.filter((q) => /^\s*(--[^\n]*\n\s*)*INSERT INTO (house_directory|resident_index|tenant_storage|settings)\b/i.test(q));
}

describe('danh bạ trung tâm', () => {
  beforeEach(async () => {
    await DB.batch([
      DB.prepare(`DELETE FROM house_directory`),
      DB.prepare(`DELETE FROM resident_index`),
      DB.prepare(`DELETE FROM tenant_storage`),
      DB.prepare(`DELETE FROM settings WHERE key = 'house_pay_seq'`),
      DB.prepare(`DELETE FROM staff_houses`),
      DB.prepare(`DELETE FROM residents`),
      DB.prepare(`DELETE FROM rooms`),
      DB.prepare(`DELETE FROM houses`),
      DB.prepare(`DELETE FROM staff`),
      DB.prepare(`INSERT INTO staff (id, full_name, phone, password_hash, role) VALUES
        (1, 'Chủ trọ', '0902371800', 'x', 'owner'), (2, 'Quản lý', '0900000001', 'x', 'manager')`),
      DB.prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, owner_id, pay_no) VALUES
        ('LVC', 'NHÀ 109/6', 'N', 'a', 'w', 'p', 'c', '0902371800', 1, 7)`),
      DB.prepare(`INSERT INTO rooms (id, house_id, name, deleted_at) VALUES (1, 'LVC', '101', NULL), (2, 'LVC', '102', NULL), (3, 'LVC', '103', datetime('now'))`),
      DB.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES
        (41, 'LVC', 1, 'A', '0900000101', 'x', 'approved'), (42, 'LVC', 2, 'B', '0900000102', 'x', 'pending')`),
    ]);
    await DB.prepare(`INSERT INTO resident_index (phone, owner_id, house_id) VALUES ('0900000101', 1, 'LVC')`).run();
  });

  it('backfill khớp bảng gốc', async () => {
    await DB.batch([DB.prepare(`DELETE FROM house_directory`), DB.prepare(`DELETE FROM resident_index`), DB.prepare(`DELETE FROM tenant_storage`)]);
    const sql = backfillSql();
    expect(sql.length).toBe(4);
    await DB.batch(sql.map((q) => DB.prepare(q)));
    expect(await houseOwner(DB, 'LVC')).toBe(1);
    const dir = await DB.prepare(`SELECT room_count, resident_count, pay_no FROM house_directory WHERE house_id = 'LVC'`).first<{ room_count: number; resident_count: number; pay_no: number }>();
    expect(dir).toEqual({ room_count: 2, resident_count: 1, pay_no: 7 });
    const ids = (await DB.prepare(`SELECT resident_id FROM resident_index ORDER BY resident_id`).all<{ resident_id: number }>()).results.map((r) => r.resident_id);
    expect(ids).toEqual([41, 42]);
    expect((await getStorage(DB, 1)).backend).toBe('d1');
    expect((await DB.prepare(`SELECT COUNT(*) AS n FROM tenant_storage`).first<{ n: number }>())!.n).toBe(1);
    const seq = await DB.prepare(`SELECT value FROM settings WHERE key = 'house_pay_seq'`).first<{ value: string }>();
    expect(seq!.value).toBe('7');
  });

  it('mã căn không cấp lại', async () => {
    const a = await allocateHousePayNo(DB);
    await removeHouseDir(DB, 'X');
    expect(await allocateHousePayNo(DB)).toBe(a + 1);
  });

  it('reserveResident chặn số trùng staff', async () => {
    await expect(reserveResident(DB, { phone: '0902371800', ownerId: 1, houseId: 'LVC' })).rejects.toBeInstanceOf(PhoneTakenError);
    await expect(reserveResident(DB, { phone: '0900000101', ownerId: 1, houseId: 'LVC' })).rejects.toBeInstanceOf(PhoneTakenError);
    expect(await reserveResident(DB, { phone: '0900000999', ownerId: 1, houseId: 'LVC' })).toBeGreaterThan(0);
  });

  it('setStorage có expect là CAS', async () => {
    expect(await setStorage(DB, 1, 'migrating', { expect: 'd1' })).toBe(true);
    expect(await setStorage(DB, 1, 'migrating', { expect: 'd1' })).toBe(false);
  });

  it('khoá hết hạn tự về d1', async () => {
    await setStorage(DB, 1, 'migrating', { lockMinutes: 10 });
    expect((await getStorage(DB, 1)).backend).toBe('migrating');
    expect((await getStorage(DB, 1, Date.now() + 11 * 60_000)).backend).toBe('d1');
    expect((await getStorage(DB, 1)).lockExpiresAt).toBeNull();
  });
});
