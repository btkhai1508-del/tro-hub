import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { compareRows, verifyHistory, type VerifyOptions, type VerifyRow } from '../src/billing/verify.ts';

const DB = (env as unknown as Env).DB;
const H = 'VERIFY_H';
const OPTS: VerifyOptions = {
  electricPriceByMonth: { '2026-03': 3300, '2026-10': 3500 },
  waterPrice: 20000,
  actualElectricPriceByHouse: { [H]: 3300 },
};

// March: 3300/kWh, no Khác. October: 3500/kWh with -200/kWh Khác (real month: 1000 -> 1065).
const MARCH: VerifyRow = {
  house_id: H, room: 'P1', month: '2026-03', room_rent: 2_000_000, electricity: 100 * 3300, water: 3 * 20000,
  trash: 30000, internet: 80000, parking: 50000, other: 0, total: 2_000_000 + 330000 + 60000 + 30000 + 80000 + 50000,
  electric_old: 500, electric_new: 600, water_old: 10, water_new: 13,
};
const OCT: VerifyRow = {
  house_id: H, room: 'P2', month: '2026-10', room_rent: 2_300_000, electricity: 227_500, water: 80_000,
  trash: 30000, internet: 80000, parking: 100000, other: -13_000, total: 2_300_000 + 227_500 + 80_000 + 30000 + 80000 + 100000 - 13_000,
  electric_old: 1000, electric_new: 1065, water_old: 100, water_new: 104,
};
const NO_METER: VerifyRow = { ...MARCH, room: 'P3', electric_old: null, electric_new: null, water_old: null, water_new: null };

describe('compareRows', () => {
  it('reports nothing when everything matches (3300 month and 3500 month with Khác)', () => {
    const noOtherOpts: VerifyOptions = { ...OPTS, actualElectricPriceByHouse: { [H]: null } };
    expect(compareRows([MARCH], noOtherOpts)).toEqual({ checked: 1, skipped: 0, mismatches: [] });
    expect(compareRows([OCT], OPTS)).toEqual({ checked: 1, skipped: 0, mismatches: [] });
  });

  it('computes the real October numbers: electricity 227500, Khác -13000', () => {
    expect(compareRows([{ ...OCT, electricity: 1, other: 2 }], OPTS).mismatches).toEqual([
      { houseId: H, room: 'P2', month: '2026-10', field: 'electricity', stored: 1, computed: 227_500 },
      { houseId: H, room: 'P2', month: '2026-10', field: 'other', stored: 2, computed: -13_000 },
      // total is checked against the stored parts, which the edits above changed
      { houseId: H, room: 'P2', month: '2026-10', field: 'total', stored: OCT.total, computed: OCT.total - 227_500 + 1 - (-13_000) + 2 },
    ]);
  });

  it('flags exactly the changed field', () => {
    const noOther: VerifyOptions = { ...OPTS, actualElectricPriceByHouse: { [H]: null } };
    expect(compareRows([{ ...MARCH, total: MARCH.total + 1 }], noOther).mismatches).toEqual([
      { houseId: H, room: 'P1', month: '2026-03', field: 'total', stored: MARCH.total + 1, computed: MARCH.total },
    ]);
    expect(compareRows([{ ...MARCH, water: 1, total: MARCH.total - 60000 + 1 }], noOther).mismatches).toEqual([
      { houseId: H, room: 'P1', month: '2026-03', field: 'water', stored: 1, computed: 60000 },
    ]);
  });

  it('does not count deposit and skips invoices without a meter row', () => {
    const noOther: VerifyOptions = { ...OPTS, actualElectricPriceByHouse: { [H]: null } };
    const res = compareRows([{ ...MARCH, deposit: 5_000_000 } as VerifyRow, NO_METER], noOther);
    expect(res).toEqual({ checked: 1, skipped: 1, mismatches: [] });
  });

  it('expects Khác 0 when the house has no actual price', () => {
    const noOther: VerifyOptions = { ...OPTS, actualElectricPriceByHouse: {} };
    expect(compareRows([OCT], noOther).mismatches.map((m) => m.field)).toEqual(['other']);
  });
});

describe('verifyHistory (reads through the db)', () => {
  beforeAll(async () => {
    await DB.batch([
      DB.prepare(`INSERT INTO houses (id, name, abbreviation, address_detail, ward, province, landlord_name, landlord_phone) VALUES (?, 'n', 'n', 'a', 'w', 'p', 'l', '0')`).bind(H),
      DB.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (9001, ?, 'P2', 2300000), (9002, ?, 'P3', 1)`).bind(H, H),
      DB.prepare(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES (?, 9001, '2026-10', 1000, 1065, 100, 104)`).bind(H),
      DB.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, electricity, water, trash, internet, parking, other, total) VALUES (?, 9001, '2026-10', 2300000, 227500, 80000, 30000, 80000, 100000, -13000, ?)`).bind(H, OCT.total),
      DB.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total) VALUES (?, 9002, '2026-10', 1, 1)`).bind(H),
    ]);
  });

  it('checks matching invoices, skips those without readings, and writes nothing', async () => {
    const before = await DB.prepare('SELECT COUNT(*) AS n FROM invoices').first<{ n: number }>();
    expect(await verifyHistory(DB, [H], OPTS)).toEqual({ checked: 1, skipped: 1, mismatches: [] });
    expect(await verifyHistory(DB, [], OPTS)).toEqual({ checked: 0, skipped: 0, mismatches: [] });
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM invoices').first<{ n: number }>())!.n).toBe(before!.n);
  });
});
