import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { ensureDraft } from '../src/billing/invoices.ts';
import { TENANT_MIGRATIONS } from '../src/tenant/schema.ts';
import type { TenantStore } from '../src/tenant/store.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env & { TENANT: DurableObjectNamespace<TenantStore> };
const store = () => tenantOfOwner(e, 1);
const MONTH = '2026-11'; // seedWorld's invoices
const NEXT = '2026-12';

const call = (token: string | undefined, method: string, path: string, body?: unknown) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, token);
const json = async (res: Response) => (await res.json()) as any;

const invoice = async (roomId: number, month: string) =>
  (await store()).prepare(`SELECT * FROM invoices WHERE room_id = ? AND month = ?`).bind(roomId, month).first<any>();
const room = async (id: number) => (await store()).prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first<any>();
const rentLine = async (invoiceId: number) =>
  (await store()).prepare(`SELECT amount FROM invoice_lines WHERE invoice_id = ? AND kind = 'room'`).bind(invoiceId).first<{ amount: number }>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 15, 5, 0, 0));
});
afterEach(() => { vi.useRealTimers(); });

describe.each(BACKENDS)('admin sửa cư dân và tiền phòng [%s]', (backend) => {
  let owner: string;
  let manager: string;
  let otherOwner: string;
  let resident: string;
  let tkResident: number; // Trung Kim 101's seeded resident
  let lvcResident: number;

  const idByPhone = async (phone: string) =>
    (await (await store()).prepare(`SELECT id FROM residents WHERE phone = ?`).bind(phone).first<{ id: number }>())!.id;
  const addResident = async (houseId: string, roomId: number, phone: string, fullName: string) => {
    const res = await call(owner, 'POST', `/api/houses/${houseId}/residents`, { fullName, phone, password: 'abcdef', roomId });
    expect(res.status).toBe(200);
    return (await json(res)).id as number;
  };
  const patchResident = (id: number, body: Record<string, unknown>, token: string | null = owner) => call(token ?? undefined, 'PATCH', `/api/admin/residents/${id}`, body);
  const patchRoom = (id: number, body: Record<string, unknown>, token: string | null = owner) => call(token ?? undefined, 'PATCH', `/api/admin/rooms/${id}`, body);

  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM audit_log`).run();
    [owner, manager, otherOwner, resident] = await Promise.all([login(PHONES.owner), login(PHONES.manager), login(PHONES.otherOwner), login(PHONES.residentTk)]);
    tkResident = await idByPhone(PHONES.residentTk);
    lvcResident = await idByPhone(PHONES.residentLvc);
  });

  describe('đọc phòng', () => {
    it('room detail lists occupants with residentId and room money', async () => {
      const second = await addResident('TRUNG_KIM', 1, '0900000102', 'Người thứ hai');
      await patchResident(second, { houseId: 'TRUNG_KIM', plateNumber: '59A1-123.45', vehicleType: 'Xe máy', cccd: '079012345678' });
      const res = await call(owner, 'GET', `/api/admin/room-detail?houseId=TRUNG_KIM&room=101&month=${MONTH}`);
      expect(res.status).toBe(200);
      const { data } = await json(res);
      expect(data).toMatchObject({ roomId: 1, roomPrice: 3_000_000, roomDeposit: 0, priceCustom: true, depositCustom: true });
      expect(data.occupants).toEqual([
        { residentId: tkResident, name: 'Cư dân Trung Kim', phone: PHONES.residentTk, plate: '', vehicleType: '', cccdLast4: '' },
        { residentId: second, name: 'Người thứ hai', phone: '0900000102', plate: '59A1-123.45', vehicleType: 'Xe máy', cccdLast4: '5678' },
      ]);
      expect(data.nguoi1).toBe('Cư dân Trung Kim');
      expect(data.nguoi2).toBe('Người thứ hai');
      expect(data.cccd2).toBe(''); // the full CCCD never leaves the server
      const list = await json(await call(owner, 'GET', `/api/admin/rooms?houseId=TRUNG_KIM&month=${MONTH}`));
      expect(list.rooms[0]).toMatchObject({ roomPrice: 3_000_000, roomDeposit: 0, priceCustom: true, depositCustom: true });
      expect(list.rooms[0].occupants).toHaveLength(2);
    });
  });

  describe('PATCH /api/admin/residents/:id', () => {
    it("staff edits a resident's name, phone, plate", async () => {
      const res = await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: '  Nguyễn Văn B ', phone: '+84 901 234 567', plateNumber: '59B2-999.99', vehicleType: 'Xe máy' });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toMatchObject({ success: true, message: expect.any(String) });
      expect(body.data.occupants[0]).toMatchObject({ residentId: tkResident, name: 'Nguyễn Văn B', phone: '0901234567', plate: '59B2-999.99', vehicleType: 'Xe máy' });
      const again = await json(await call(owner, 'GET', `/api/admin/room-detail?houseId=TRUNG_KIM&room=101&month=${MONTH}`));
      expect(again.data.occupants[0]).toMatchObject({ name: 'Nguyễn Văn B', phone: '0901234567', plate: '59B2-999.99' });
      const idx = (phone: string) => e.DB.prepare(`SELECT resident_id FROM resident_index WHERE phone = ?`).bind(phone).first<{ resident_id: number }>();
      expect(await idx('0901234567')).toEqual({ resident_id: tkResident });
      expect(await idx(PHONES.residentTk)).toBeNull();
      expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'resident_edit_by_staff'`).first()).not.toBeNull();
    });

    it('a plate change recomputes the open invoice (vehicle fee)', async () => {
      const db = await store();
      await db.batch([
        db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, 20000)`),
      ]);
      const before = await invoice(1, MONTH);
      await patchResident(tkResident, { houseId: 'TRUNG_KIM', plateNumber: '59B2-999.99' });
      const after = await invoice(1, MONTH);
      expect(after.parking).toBe(50_000);
      expect(after.total).not.toBe(before.total);
    });

    it('9-digit phone is stored with a leading 0', async () => {
      const res = await patchResident(tkResident, { houseId: 'TRUNG_KIM', phone: '901234567' });
      expect(res.status).toBe(200);
      expect((await json(res)).data.occupants[0].phone).toBe('0901234567');
    });

    it('a phone that is not 10 digits → 400 PHONE_INVALID', async () => {
      const res = await patchResident(tkResident, { houseId: 'TRUNG_KIM', phone: '09012345678' });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ success: false, errorCode: 'PHONE_INVALID' });
    });

    it('phone already used by another resident → 409 PHONE_TAKEN, nothing changed', async () => {
      const res = await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: 'Tên mới', phone: PHONES.residentLvc });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ success: false, errorCode: 'PHONE_TAKEN' });
      const row = await (await store()).prepare(`SELECT full_name, phone FROM residents WHERE id = ?`).bind(tkResident).first<any>();
      expect(row).toEqual({ full_name: 'Cư dân Trung Kim', phone: PHONES.residentTk });
    });

    it('a staff phone is taken too', async () => {
      const res = await patchResident(tkResident, { houseId: 'TRUNG_KIM', phone: PHONES.manager });
      expect(res.status).toBe(409);
    });

    it('cccd taken → 409 CCCD_TAKEN; invalid → 400 CCCD_INVALID; stored encrypted with last4', async () => {
      const ok = await patchResident(tkResident, { houseId: 'TRUNG_KIM', cccd: '079 012 345 678' });
      expect(ok.status).toBe(200);
      const row = await (await store()).prepare(`SELECT cccd_enc, cccd_last4, cccd_hash FROM residents WHERE id = ?`).bind(tkResident).first<any>();
      expect(row.cccd_last4).toBe('5678');
      expect(row.cccd_enc).not.toContain('079012345678');
      expect(row.cccd_hash).toBeTruthy();
      const dup = await patchResident(lvcResident, { houseId: 'LVC', cccd: '079012345678' });
      expect(dup.status).toBe(409);
      expect(await json(dup)).toMatchObject({ errorCode: 'CCCD_TAKEN' });
      const bad = await patchResident(lvcResident, { houseId: 'LVC', cccd: '12ab' });
      expect(bad.status).toBe(400);
      expect(await json(bad)).toMatchObject({ errorCode: 'CCCD_INVALID' });
    });

    it('empty name → 400 NAME_REQUIRED; unknown resident → 404', async () => {
      expect((await json(await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: '  ' }))).errorCode).toBe('NAME_REQUIRED');
      expect((await patchResident(99999, { houseId: 'TRUNG_KIM', fullName: 'X' })).status).toBe(404);
    });

    it('houseId decides: a resident of another house is not found', async () => {
      const res = await patchResident(lvcResident, { houseId: 'TRUNG_KIM', fullName: 'X' });
      expect(res.status).toBe(404);
    });

    it('manager of another house → 403; resident → 403; anonymous → 401', async () => {
      expect((await patchResident(lvcResident, { houseId: 'LVC', fullName: 'X' }, manager)).status).toBe(403);
      expect((await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: 'X' }, resident)).status).toBe(403);
      expect((await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: 'X' }, null)).status).toBe(401);
      expect((await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: 'X' }, otherOwner)).status).toBe(403);
      // the manager of the right house may edit
      expect((await patchResident(tkResident, { houseId: 'TRUNG_KIM', fullName: 'Quản lý sửa' }, manager)).status).toBe(200);
    });
  });

  describe('PATCH /api/admin/rooms/:id', () => {
    it('editing rent recomputes the open current-month invoice total', async () => {
      const first = await json(await patchRoom(1, { houseId: 'TRUNG_KIM', price: 4_000_000 }));
      expect(first).toMatchObject({ success: true, appliesFrom: 'this_month' });
      expect(first.data).toMatchObject({ roomPrice: 4_000_000, priceCustom: true });
      const t1 = await invoice(1, MONTH);
      expect(t1.room_rent).toBe(4_000_000);
      const res = await json(await patchRoom(1, { houseId: 'TRUNG_KIM', price: 4_500_000 }));
      expect(res.appliesFrom).toBe('this_month');
      const t2 = await invoice(1, MONTH);
      expect(t2.total).toBe(t1.total - 4_000_000 + 4_500_000);
      expect((await rentLine(t2.id))!.amount).toBe(4_500_000);
      expect(res.data.tongTien).toBe(t2.total);
      expect((await room(1)).price).toBe(4_500_000);
      expect(await e.DB.prepare(`SELECT 1 FROM audit_log WHERE action = 'room_money_edit'`).first()).not.toBeNull();
    });

    it("a next-month draft is recomputed too", async () => {
      await ensureDraft(await store(), 'TRUNG_KIM', 1, NEXT, e.DB);
      await patchRoom(1, { houseId: 'TRUNG_KIM', price: 3_100_000 });
      const draft = await invoice(1, NEXT);
      expect(draft.room_rent).toBe(3_100_000);
    });

    it("editing rent when this month's invoice is paid saves the room price, leaves the paid invoice untouched, returns appliesFrom next_month", async () => {
      const db = await store();
      await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE room_id = 1 AND month = ?`).bind(MONTH).run();
      await ensureDraft(db, 'TRUNG_KIM', 1, NEXT, e.DB);
      const before = await invoice(1, MONTH);
      const res = await patchRoom(1, { houseId: 'TRUNG_KIM', price: 3_300_000 });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toMatchObject({ success: true, appliesFrom: 'next_month', message: 'Đã lưu giá mới, áp dụng từ hoá đơn tháng sau vì tháng này đã đóng.' });
      expect(body.data.roomPrice).toBe(3_300_000);
      expect((await room(1)).price).toBe(3_300_000);
      expect(await invoice(1, MONTH)).toEqual(before);
      expect((await invoice(1, NEXT)).room_rent).toBe(3_300_000); // the next month's draft already has it
    });

    it('deposit alone is saved without touching invoices', async () => {
      const before = await invoice(1, MONTH);
      const body = await json(await patchRoom(1, { houseId: 'TRUNG_KIM', deposit: 1_500_000 }));
      expect(body).toMatchObject({ success: true, appliesFrom: 'this_month' });
      expect(body.data).toMatchObject({ roomDeposit: 1_500_000, depositCustom: true });
      expect((await room(1)).deposit).toBe(1_500_000);
      expect(await invoice(1, MONTH)).toEqual(before);
    });

    it('invalid money → 400 MONEY_INVALID; nothing to change → 400; unknown room → 404', async () => {
      for (const price of [-1, 1.5, 100_000_001, '3000000', null]) {
        const res = await patchRoom(1, { houseId: 'TRUNG_KIM', price });
        expect(res.status, String(price)).toBe(400);
        expect((await json(res)).errorCode).toBe('MONEY_INVALID');
      }
      expect((await room(1)).price).toBe(3_000_000);
      expect((await patchRoom(1, { houseId: 'TRUNG_KIM' })).status).toBe(400);
      expect((await patchRoom(9999, { houseId: 'TRUNG_KIM', price: 1 })).status).toBe(404);
    });

    it('useDefaultPrice without a house default → 400 NO_DEFAULT_PRICE', async () => {
      const res = await patchRoom(3, { houseId: 'LVC', useDefaultPrice: true });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ errorCode: 'NO_DEFAULT_PRICE' });
      const dep = await patchRoom(3, { houseId: 'LVC', useDefaultDeposit: true });
      expect(await json(dep)).toMatchObject({ errorCode: 'NO_DEFAULT_DEPOSIT' });
      expect((await room(3)).price).toBe(3_500_000);
    });

    it('same room name in two houses: houseId decides which room changes', async () => {
      // "101" exists in TRUNG_KIM (id 1) and LVC (id 3); the id belongs to one house only.
      expect((await patchRoom(3, { houseId: 'TRUNG_KIM', price: 1 })).status).toBe(404);
      expect((await room(3)).price).toBe(3_500_000);
      expect((await patchRoom(1, { houseId: 'TRUNG_KIM', price: 3_200_000 })).status).toBe(200);
      expect((await room(1)).price).toBe(3_200_000);
      expect((await room(3)).price).toBe(3_500_000);
      const lvc = await json(await call(owner, 'GET', `/api/admin/room-detail?houseId=LVC&room=101&month=${MONTH}`));
      expect(lvc.data).toMatchObject({ houseId: 'LVC', roomPrice: 3_500_000 });
    });

    it('manager of another house → 403; resident → 403; anonymous → 401', async () => {
      expect((await patchRoom(3, { houseId: 'LVC', price: 1 }, manager)).status).toBe(403);
      expect((await patchRoom(1, { houseId: 'TRUNG_KIM', price: 1 }, resident)).status).toBe(403);
      expect((await patchRoom(1, { houseId: 'TRUNG_KIM', price: 1 }, null)).status).toBe(401);
      expect((await patchRoom(5, { houseId: 'NTTD', price: 1 }, owner)).status).toBe(403);
      expect((await room(1)).price).toBe(3_000_000);
      expect((await patchRoom(1, { houseId: 'TRUNG_KIM', price: 3_050_000 }, manager)).status).toBe(200);
    });
  });

  describe('giá chung của căn', () => {
    const config = (body: Record<string, unknown>, method = 'POST') => call(owner, method, '/api/admin/config', { houseId: 'TRUNG_KIM', month: MONTH, ...body });

    it('house default rent applies to rooms without a custom price and recomputes their open invoices; custom rooms keep their price; applyToAllRooms resets every room', async () => {
      const db = await store();
      await db.prepare(`INSERT INTO rooms (id, house_id, name, price) VALUES (20, 'TRUNG_KIM', '102', 2000000)`).run();
      await addResident('TRUNG_KIM', 20, '0900000120', 'Phòng 102');
      await ensureDraft(db, 'TRUNG_KIM', 20, MONTH, e.DB);

      const got = await json(await call(owner, 'GET', `/api/admin/config?houseId=TRUNG_KIM&month=${MONTH}`));
      expect(got.defaultRoomPrice).toBeNull();
      expect(got.defaultDeposit).toBeNull();

      // 1) setting a default changes no room: every room still has its own price.
      expect((await config({ defaultRoomPrice: 3_300_000, defaultDeposit: 1_000_000 })).status).toBe(200);
      const after = await json(await call(owner, 'GET', `/api/admin/config?houseId=TRUNG_KIM&month=${MONTH}`));
      expect(after).toMatchObject({ defaultRoomPrice: 3_300_000, defaultDeposit: 1_000_000 });
      expect((await room(1)).price).toBe(3_000_000);
      expect((await room(20)).price).toBe(2_000_000);

      // 2) a room switched to the default follows it
      const use = await json(await patchRoom(20, { houseId: 'TRUNG_KIM', useDefaultPrice: true, useDefaultDeposit: true }));
      expect(use.data).toMatchObject({ roomPrice: 3_300_000, priceCustom: false, roomDeposit: 1_000_000, depositCustom: false });
      expect((await invoice(20, MONTH)).room_rent).toBe(3_300_000);

      // 3) a new default: the default room follows, the custom one keeps its price
      const res = await json(await config({ defaultRoomPrice: 3_600_000, defaultDeposit: 1_200_000 }));
      expect(res).toMatchObject({ success: true, defaultRoomPrice: 3_600_000, defaultDeposit: 1_200_000 });
      expect(await room(20)).toMatchObject({ price: 3_600_000, deposit: 1_200_000, price_custom: 0, deposit_custom: 0 });
      expect((await invoice(20, MONTH)).room_rent).toBe(3_600_000);
      expect(await room(1)).toMatchObject({ price: 3_000_000, price_custom: 1 });
      expect((await invoice(1, MONTH)).room_rent).toBe(3_000_000);

      // 4) applyToAllRooms resets every room of this house (and recomputes their open invoices), not other houses
      const all = await json(await config({ defaultRoomPrice: 3_700_000, applyToAllRooms: true }, 'PUT'));
      expect(all.success).toBe(true);
      expect(await room(1)).toMatchObject({ price: 3_700_000, price_custom: 0 });
      expect(await room(20)).toMatchObject({ price: 3_700_000, price_custom: 0 });
      expect((await invoice(1, MONTH)).room_rent).toBe(3_700_000);
      expect((await room(3)).price).toBe(3_500_000);
      expect((await room(3)).price_custom).toBe(1);
    });

    it('a paid invoice keeps its numbers when the default changes', async () => {
      const db = await store();
      await db.prepare(`UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE room_id = 1 AND month = ?`).bind(MONTH).run();
      const before = await invoice(1, MONTH);
      expect((await config({ defaultRoomPrice: 3_900_000, applyToAllRooms: true })).status).toBe(200);
      expect((await room(1)).price).toBe(3_900_000);
      expect(await invoice(1, MONTH)).toEqual(before);
    });

    it('invalid default → 400 MONEY_INVALID; null clears; a manager of the house may set it; other roles are refused', async () => {
      expect((await json(await config({ defaultRoomPrice: -5 }))).errorCode).toBe('MONEY_INVALID');
      expect((await json(await config({ defaultDeposit: 1.5 }))).errorCode).toBe('MONEY_INVALID');
      await config({ defaultRoomPrice: 3_000_000 });
      expect((await json(await config({ defaultRoomPrice: null }))).defaultRoomPrice).toBeNull();
      expect((await call(manager, 'POST', '/api/admin/config', { houseId: 'TRUNG_KIM', month: MONTH, defaultRoomPrice: 2_000_000 })).status).toBe(200);
      expect((await call(manager, 'POST', '/api/admin/config', { houseId: 'LVC', month: MONTH, defaultRoomPrice: 2_000_000 })).status).toBe(403);
      expect((await call(resident, 'POST', '/api/admin/config', { houseId: 'TRUNG_KIM', month: MONTH, defaultRoomPrice: 2_000_000 })).status).toBe(403);
    });

    it('a new room added to a house takes the house default (custom = 0)', async () => {
      await config({ defaultRoomPrice: 3_300_000, defaultDeposit: 800_000 });
      const dev = await login(PHONES.developer);
      const add = await call(dev, 'POST', '/api/dev/houses/TRUNG_KIM/rooms', { rooms: [{ name: '201', floor: 2, capacity: 3 }] });
      expect(add.status).toBe(200);
      const fresh = await (await store()).prepare(`SELECT * FROM rooms WHERE house_id = 'TRUNG_KIM' AND name = '201'`).first<any>();
      expect(fresh).toMatchObject({ price: 3_300_000, deposit: 800_000, price_custom: 0, deposit_custom: 0 });
      // an explicit price wins and is custom
      const explicit = await call(dev, 'POST', '/api/dev/houses/TRUNG_KIM/rooms', { rooms: [{ name: '202', floor: 2, capacity: 3 }], price: 2_000_000 });
      expect(explicit.status).toBe(200);
      expect(await (await store()).prepare(`SELECT price, price_custom FROM rooms WHERE house_id = 'TRUNG_KIM' AND name = '202'`).first()).toEqual({ price: 2_000_000, price_custom: 1 });
    });
  });

  describe('nhà mới', () => {
    it('the rent typed when creating a house becomes its common rent; its rooms follow it', async () => {
      const res = await call(owner, 'POST', '/api/houses', { name: 'Nhà mới', abbreviation: 'NM', rooms: '101-102', roomPrice: 2_800_000 });
      expect(res.status).toBe(200);
      const db = await store();
      expect(await db.prepare(`SELECT default_room_price AS p FROM houses WHERE id = 'NM'`).first()).toEqual({ p: 2_800_000 });
      expect((await db.prepare(`SELECT price, price_custom FROM rooms WHERE house_id = 'NM' ORDER BY name`).all()).results).toEqual([
        { price: 2_800_000, price_custom: 0 }, { price: 2_800_000, price_custom: 0 },
      ]);
    });
  });

  describe('migration 0026', () => {
    it('keeps existing room prices as custom (custom = 1) and leaves the defaults empty', async () => {
      const db = await store();
      expect(await db.prepare(`SELECT price, price_custom, deposit_custom FROM rooms WHERE id = 1`).first()).toEqual({ price: 3_000_000, price_custom: 1, deposit_custom: 1 });
      expect(await db.prepare(`SELECT default_room_price AS p, default_deposit AS d FROM houses WHERE id = 'TRUNG_KIM'`).first()).toEqual({ p: null, d: null });
    });

    if (backend === 'do') {
      it('an older store is upgraded: its rooms keep their own price', async () => {
        const stub = e.TENANT.get(e.TENANT.idFromName('money:old'));
        await runInDurableObject(stub, async (_i, state) => {
          const sql = state.storage.sql;
          sql.exec(`ALTER TABLE houses DROP COLUMN default_room_price`);
          sql.exec(`ALTER TABLE houses DROP COLUMN default_deposit`);
          sql.exec(`ALTER TABLE rooms DROP COLUMN price_custom`);
          sql.exec(`ALTER TABLE rooms DROP COLUMN deposit_custom`);
          sql.exec(`UPDATE meta SET value = '3' WHERE key = 'schema_version'`);
          sql.exec(`INSERT INTO houses (id,name,abbreviation,address_detail,ward,province,landlord_name,landlord_phone) VALUES ('H','n','a','d','w','p','l','0')`);
          sql.exec(`INSERT INTO rooms (house_id, name, price, deposit) VALUES ('H', '1', 2500000, 500000)`);
          const again = new (_i.constructor as new (s: DurableObjectState, e: unknown) => TenantStore)(state, env);
          await state.blockConcurrencyWhile(async () => {});
          expect((await again.info()).schemaVersion).toBe(TENANT_MIGRATIONS.length);
          expect(sql.exec(`SELECT price, deposit, price_custom, deposit_custom FROM rooms`).toArray()).toEqual([{ price: 2500000, deposit: 500000, price_custom: 1, deposit_custom: 1 }]);
          expect(sql.exec(`SELECT default_room_price AS p FROM houses`).toArray()).toEqual([{ p: null }]);
        });
      });
    }
  });
});
