import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const files = import.meta.glob('../scripts/post-deploy-catchup.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SQL = Object.values(files)[0];

/** The file's statements, comments dropped (the file is meant for `wrangler d1 execute --file`). */
const statements = SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const selects = statements.filter((s) => /^SELECT/i.test(s));
const writes = statements.filter((s) => !/^SELECT/i.test(s));

async function runCatchup(): Promise<number[]> {
  for (const w of writes) await e.DB.prepare(w).run();
  const out: number[] = [];
  for (const q of selects) out.push(Object.values((await e.DB.prepare(q).first<Record<string, number>>())!)[0]);
  return out;
}
const snapshot = async () => ({
  dir: (await e.DB.prepare(`SELECT * FROM house_directory ORDER BY house_id`).all()).results,
  idx: (await e.DB.prepare(`SELECT * FROM resident_index ORDER BY resident_id`).all()).results,
  seq: await e.DB.prepare(`SELECT value FROM settings WHERE key = 'house_pay_seq'`).first<{ value: string }>(),
});

describe('scripts/post-deploy-catchup.sql', () => {
  beforeEach(async () => {
    await seedWorld('d1');
    // What the OLD Worker leaves behind in the deploy window: rows only in houses / residents.
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, owner_id, pay_no, modules)
        VALUES ('OLDH', 'Nhà tạo lúc deploy', 'OLD', '1 A', 'Linh Xuân', 'TP. Hồ Chí Minh', 'Chủ', '0900', 1, 90, 'rent')`),
      e.DB.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (900, 'OLDH', '101', 1000000), (901, 'OLDH', '102', 1000000)`),
      e.DB.prepare(`UPDATE rooms SET deleted_at = datetime('now') WHERE id = 901`),
      e.DB.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (900, 'OLDH', 900, 'Cư dân mới', '0900000900', 'x', 'approved')`),
      e.DB.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (901, 'OLDH', 900, 'Chờ duyệt', '0900000901', 'x', 'pending')`),
      // an existing house gets a resident the old way too
      e.DB.prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (902, 'LVC', 3, 'Thêm lúc deploy', '0900000902', 'x', 'approved')`),
      e.DB.prepare(`UPDATE settings SET value = '3' WHERE key = 'house_pay_seq'`),
    ]);
  });

  it('chép nhà và cư dân còn thiếu, kiểm tra về 0, chạy lần hai không đổi gì', async () => {
    const missing = async () => [
      (await e.DB.prepare(selects[0]).first<{ houses_missing_from_directory: number }>())!.houses_missing_from_directory,
      (await e.DB.prepare(selects[1]).first<{ residents_missing_from_index: number }>())!.residents_missing_from_index,
    ];
    expect(selects).toHaveLength(2);
    expect(await missing()).toEqual([1, 3]); // OLDH; residents 900, 901 and 902

    expect(await runCatchup()).toEqual([0, 0]);
    expect(await e.DB.prepare(`SELECT house_id, owner_id, name, status, pay_no, modules, room_count, resident_count FROM house_directory WHERE house_id = 'OLDH'`).first())
      .toEqual({ house_id: 'OLDH', owner_id: 1, name: 'Nhà tạo lúc deploy', status: 'active', pay_no: 90, modules: 'rent', room_count: 1, resident_count: 1 });
    expect((await e.DB.prepare(`SELECT resident_id, phone, owner_id, house_id FROM resident_index WHERE resident_id IN (900, 901, 902) ORDER BY resident_id`).all()).results).toEqual([
      { resident_id: 900, phone: '0900000900', owner_id: 1, house_id: 'OLDH' },
      { resident_id: 901, phone: '0900000901', owner_id: 1, house_id: 'OLDH' },
      { resident_id: 902, phone: '0900000902', owner_id: 1, house_id: 'LVC' },
    ]);
    expect(Number((await e.DB.prepare(`SELECT value FROM settings WHERE key = 'house_pay_seq'`).first<{ value: string }>())!.value)).toBeGreaterThanOrEqual(90);

    const first = await snapshot();
    expect(await runCatchup()).toEqual([0, 0]);
    expect(await snapshot()).toEqual(first);
  });

  it('không đụng dòng đã có trong thư mục (số đếm, tên khác vẫn giữ)', async () => {
    await e.DB.prepare(`UPDATE house_directory SET name = 'Tên đã sửa ở thư mục', room_count = 7 WHERE house_id = 'LVC'`).run();
    await runCatchup();
    expect(await e.DB.prepare(`SELECT name, room_count FROM house_directory WHERE house_id = 'LVC'`).first()).toEqual({ name: 'Tên đã sửa ở thư mục', room_count: 7 });
  });
});
