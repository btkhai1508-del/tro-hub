/**
 * Shared test world for both storage backends. `seedWorld('d1')` puts the 9 business tables of
 * landlords #1 and #4 in the shared D1; `seedWorld('do')` puts them in each landlord's own store
 * (owner:1, owner:4) and leaves them out of D1. Central tables (staff, directory, index) always
 * live in D1. Every account's password is "1". Safe to call in beforeEach: it clears first.
 */
import { env, SELF } from 'cloudflare:test';
import { expect } from 'vitest';
import type { Env } from '../src/app.ts';
import { setHouseCounts, setStorage, reserveResident, upsertHouseDir } from '../src/central/directory.ts';
import { hashPassword } from '../src/password.ts';
import { tenantOfOwner, tenantStub } from '../src/tenant/route.ts';

export const BACKENDS = ['d1', 'do'] as const;
export type BackendName = (typeof BACKENDS)[number];

export const PHONES = {
  developer: '0918338863',
  owner: '0902371800',
  otherOwner: '0911111111',
  manager: '0900000001',
  residentTk: '0900000101',
  residentLvc: '0900000201',
};

const e = env as unknown as Env;
const BASE = 'https://tro-hub.test';
const OWNERS = [1, 4];
const MONTH = '2026-11';

const HOUSES = [
  { id: 'TRUNG_KIM', name: 'NHÀ TRỌ TRUNG KIM', abbr: 'NTTK', addr: '116/32 Đường 17', owner: 1, payNo: 1, phone: PHONES.owner },
  { id: 'LVC', name: 'NHÀ TRỌ 109/6', abbr: 'NT1096', addr: '109/6 Lê Văn Chí', owner: 1, payNo: 2, phone: PHONES.owner },
  { id: 'NTTD', name: 'NHÀ TRỌ NTTD', abbr: 'NTTD', addr: '1 Nguyễn Thị Tần', owner: 4, payNo: 3, phone: PHONES.otherOwner },
];
// [id, house, name, price]
const ROOMS: [number, string, string, number][] = [
  [1, 'TRUNG_KIM', '101', 3000000],
  [3, 'LVC', '101', 3500000],
  [5, 'NTTD', '101', 2500000],
  [6, 'NTTD', '102', 2500000],
];
// [house, room id, name, phone]
const RESIDENTS: [string, number, string, string][] = [
  ['TRUNG_KIM', 1, 'Cư dân Trung Kim', PHONES.residentTk],
  ['LVC', 3, 'Cư dân LVC', PHONES.residentLvc],
];

const BUSINESS_TABLES = ['notifications', 'payment_gates', 'payments', 'meter_readings', 'invoices', 'residents', 'rooms', 'house_rates', 'houses'];

export async function seedWorld(backend: BackendName): Promise<void> {
  const DB = e.DB;
  const pw = await hashPassword('1');

  // Clear: business tables in D1, both landlords' stores, then the central tables.
  await DB.batch([
    DB.prepare(`DELETE FROM staff_houses`),
    ...BUSINESS_TABLES.map((t) => DB.prepare(`DELETE FROM ${t}`)),
    DB.prepare(`DELETE FROM staff`),
    DB.prepare(`DELETE FROM house_directory`),
    DB.prepare(`DELETE FROM resident_index`),
    DB.prepare(`DELETE FROM sqlite_sequence WHERE name = 'resident_index'`),
    DB.prepare(`DELETE FROM tenant_storage`),
  ]);
  for (const id of OWNERS) await tenantStub(e, id).reset();

  await DB.batch([
    DB.prepare(`INSERT INTO staff (id, full_name, phone, password_hash, role) VALUES
      (1, 'Chủ trọ', ?1, ?5, 'owner'),
      (2, 'Quản lý Trung Kim', ?2, ?5, 'manager'),
      (3, 'Developer', ?3, ?5, 'developer'),
      (4, 'Chủ trọ khác', ?4, ?5, 'owner')`).bind(PHONES.owner, PHONES.manager, PHONES.developer, PHONES.otherOwner, pw),
  ]);

  await setStorage(DB, 1, backend);
  await setStorage(DB, 4, backend);
  for (const h of HOUSES) {
    await upsertHouseDir(DB, { house_id: h.id, owner_id: h.owner, name: h.name, status: 'active', delete_after: null, pay_no: h.payNo, modules: null });
  }

  // Reserve resident ids centrally first, then write the rows with those exact ids.
  const ids: number[] = [];
  for (const [house, , , phone] of RESIDENTS) ids.push(await reserveResident(DB, { phone, ownerId: 1, houseId: house }));

  for (const owner of OWNERS) {
    const db = await tenantOfOwner(e, owner);
    const houses = HOUSES.filter((h) => h.owner === owner);
    const rooms = ROOMS.filter((r) => houses.some((h) => h.id === r[1]));
    const residents = RESIDENTS.map((r, i) => ({ r, id: ids[i] })).filter(({ r }) => houses.some((h) => h.id === r[0]));
    const stmts = [
      ...houses.map((h) =>
        db
          .prepare(
            `INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone, owner_id, pay_no)
             VALUES (?, ?, ?, ?, 'Linh Xuân', 'TP. Hồ Chí Minh', 'Chủ trọ', ?, ?, ?)`
          )
          .bind(h.id, h.name, h.abbr, h.addr, h.phone, h.owner, h.payNo)
      ),
      ...rooms.map(([id, house, name, price]) =>
        db.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (?, ?, ?, ?)`).bind(id, house, name, price)
      ),
      ...residents.map(({ r: [house, room, name, phone], id }) =>
        db
          .prepare(`INSERT INTO residents (id, house_id, room_id, full_name, phone, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')`)
          .bind(id, house, room, name, phone, pw)
      ),
      ...rooms
        .filter(([, house]) => house !== 'NTTD')
        .map(([id, house, , price]) =>
          db
            .prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, status) VALUES (?, ?, ?, ?, ?, 'unpaid')`)
            .bind(house, id, MONTH, price, price)
        ),
    ];
    await db.batch(stmts);
  }

  await DB.prepare(`INSERT INTO staff_houses (staff_id, house_id) VALUES (1, 'TRUNG_KIM'), (1, 'LVC'), (2, 'TRUNG_KIM')`).run();

  for (const h of HOUSES) {
    await setHouseCounts(DB, h.id, {
      rooms: ROOMS.filter((r) => r[1] === h.id).length,
      residents: RESIDENTS.filter((r) => r[0] === h.id).length,
    });
  }
}

export async function login(phone: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: '1' }),
  });
  const data = (await res.json()) as { token?: string };
  expect(res.status, `login ${phone}`).toBe(200);
  return data.token!;
}

export function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return SELF.fetch(`${BASE}${path}`, { ...init, headers });
}
