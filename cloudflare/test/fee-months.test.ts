import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { feeConfigFor } from '../src/billing/fees.ts';
import { InvoiceFrozenError, recompute } from '../src/billing/invoices.ts';
import { FREQUENT_CRON, MONTH_CRON, runCron } from '../src/cron.ts';
import { migrateOwner } from '../src/migrate/tenant.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] };
const store = () => tenantOfOwner(e, 1);
const NOV = '2026-11';
const DEC = '2026-12';
// Vietnam is UTC+7: 2026-12-01 00:00 there is 2026-11-30 17:00 UTC.
const MIDNIGHT = Date.UTC(2026, 10, 30, 17, 0, 0);
const setSource = (v: 'sheet' | 'worker') =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('source_of_truth', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(v).run();
const setNow = (ms: number) => vi.setSystemTime(ms);
const call = async (phone: string, method: string, path: string, body?: unknown) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, await login(phone));
const json = async (res: Response) => (await res.json()) as any;
const invoiceOf = async (house: string, room: string, month: string) =>
  (await store()).prepare(`SELECT i.* FROM invoices i JOIN rooms r ON r.id = i.room_id WHERE i.house_id = ? AND r.name = ? AND i.month = ?`).bind(house, room, month).first<any>();
const linesOf = async (id: number) =>
  (await (await store()).prepare(`SELECT kind, name, qty, unit_price, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY id`).bind(id).all<any>()).results;
const marker = async () => (await e.DB.prepare(`SELECT value FROM settings WHERE key = 'month_started'`).first<{ value: string }>())?.value ?? null;
const snapshotCount = async (month: string) =>
  (await (await store()).prepare(`SELECT COUNT(*) AS n FROM house_fee_months WHERE month = ? AND house_id IN ('LVC', 'TRUNG_KIM')`).bind(month).first<{ n: number }>())!.n;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(Date.UTC(2026, 10, 20, 5, 0, 0)); // 2026-11-20 12:00 Vietnam
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(BACKENDS)('phí theo tháng và chuyển tháng 00:00 [%s]', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    const db = await store();
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000), ('TRUNG_KIM', 3500, 20000)`),
      // November readings of LVC 101 (room 3): the numbers December starts from.
      db.prepare(`INSERT INTO meter_readings (house_id, room_id, month, electric_old, electric_new, water_old, water_new) VALUES ('LVC', 3, ?, 100, 150, 10, 14)`).bind(NOV),
    ]);
    await setSource('worker');
    // November is the current month: its fees are stored and its issued invoice is priced from them.
    await feeConfigFor(db, 'LVC', NOV);
    await feeConfigFor(db, 'TRUNG_KIM', NOV);
    await recompute(db, (await invoiceOf('LVC', '101', NOV)).id, { central: e.DB });
  });

  describe('chuyển tháng đúng 00:00 giờ Việt Nam', () => {
    it('trước 00:00 (5 ngày cuối): tháng 12 mới chỉ là bản chuẩn bị, chưa "bắt đầu"; đúng 00:00: tháng 12 bắt đầu, số cũ = số mới tháng 11', async () => {
      setNow(MIDNIGHT - 1000);
      await runCron(MONTH_CRON, e, MIDNIGHT - 1000);
      expect(await marker()).toBe(NOV); // December is only prepared (month_prepared), not started
      expect((await invoiceOf('LVC', '101', DEC))?.issued_at ?? null).toBeNull(); // at most a draft

      setNow(MIDNIGHT);
      await runCron(MONTH_CRON, e, MIDNIGHT);
      const dec = await invoiceOf('LVC', '101', DEC);
      expect(dec).toMatchObject({ issued_at: null, status: 'unpaid', room_rent: 3_500_000, electricity: 0, water: 0, total: 3_500_000 + 30_000 + 40_000 });
      expect(await invoiceOf('TRUNG_KIM', '101', DEC)).toMatchObject({ issued_at: null });
      expect(await snapshotCount(DEC)).toBe(2);
      expect(await marker()).toBe(DEC);

      const rooms = await json(await call(PHONES.owner, 'GET', `/api/admin/rooms?houseId=LVC&month=${DEC}`));
      expect(rooms.rooms[0]).toMatchObject({ roomName: '101', dienCu: 150, nuocCu: 14, dienMoi: 0, nuocMoi: 0, draft: true });

      // The admin only enters the new readings.
      const entered = await call(PHONES.owner, 'POST', '/api/admin/room-detail', { month: DEC, room: '101', houseId: 'LVC', data: { dienMoi: 180, nuocMoi: 20 } });
      expect(entered.status).toBe(200);
      expect(await invoiceOf('LVC', '101', DEC)).toMatchObject({ electricity: 30 * 3500, water: 6 * 20_000 });
    });

    it('chỉ cần giờ của cron: 17:00 UTC mọi ngày khác ngày 1 cũng chỉ làm tháng hiện tại, không lùi về tháng cũ', async () => {
      const db = await store();
      await db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = (SELECT id FROM invoices WHERE room_id = 3 AND month = ?)`).bind(NOV).run();
      await db.prepare(`DELETE FROM invoices WHERE room_id = 3 AND month = ?`).bind(NOV).run();
      const day17 = Date.UTC(2026, 11, 16, 17, 0, 0); // 00:00 on 17 Dec
      setNow(day17);
      await runCron(MONTH_CRON, e, day17);
      expect(await invoiceOf('LVC', '101', DEC)).not.toBeNull();
      expect(await invoiceOf('LVC', '101', NOV)).toBeNull(); // a past month is never backfilled
    });

    it('chế độ sheet: không tạo gì, không ghi dấu', async () => {
      await setSource('sheet');
      setNow(MIDNIGHT);
      await runCron(MONTH_CRON, e, MIDNIGHT);
      await runCron(FREQUENT_CRON, e, MIDNIGHT);
      expect(await invoiceOf('LVC', '101', DEC)).toBeNull();
      expect(await snapshotCount(DEC)).toBe(0);
      expect(await marker()).toBeNull();
    });
  });

  describe('bắt kịp mỗi 10 phút', () => {
    it('lỡ 00:00: 00:05 tạo đủ; lần sau không làm lại (không ghi gì); không giới hạn ngày 1-3', async () => {
      setNow(MIDNIGHT + 5 * 60_000);
      await runCron(FREQUENT_CRON, e, MIDNIGHT + 5 * 60_000);
      expect(await invoiceOf('LVC', '101', DEC)).not.toBeNull();
      expect(await marker()).toBe(DEC);

      // Remove a draft: a second run that really scanned would make it again. It must not scan at all.
      const db = await store();
      const id = (await invoiceOf('LVC', '101', DEC)).id;
      await db.batch([db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = ?`).bind(id), db.prepare(`DELETE FROM invoices WHERE id = ?`).bind(id)]);
      await runCron(FREQUENT_CRON, e, MIDNIGHT + 15 * 60_000);
      expect(await invoiceOf('LVC', '101', DEC)).toBeNull();
    });

    it('giữa tháng (ngày 17) mà chưa có dấu: vẫn bắt kịp tháng hiện tại', async () => {
      const t = Date.UTC(2026, 11, 17, 3, 0, 0);
      setNow(t);
      await runCron(FREQUENT_CRON, e, t);
      expect(await invoiceOf('LVC', '101', DEC)).not.toBeNull();
      expect(await marker()).toBe(DEC);
    });

    it('lỗi thì không đánh dấu xong, thử lại ở lần sau, dừng sau 6 lần', async () => {
      const db = await store();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await db.prepare(`CREATE TRIGGER t_fail BEFORE INSERT ON invoice_lines WHEN NEW.invoice_id IN (SELECT id FROM invoices WHERE room_id = 3) BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();
      setNow(MIDNIGHT);
      await runCron(FREQUENT_CRON, e, MIDNIGHT);
      expect(await marker()).toBe(`${DEC}!1`);
      expect(await invoiceOf('LVC', '101', DEC)).toBeNull();
      await db.prepare(`DROP TRIGGER t_fail`).run();
      await runCron(FREQUENT_CRON, e, MIDNIGHT + 600_000);
      expect(await marker()).toBe(DEC);
      expect(await invoiceOf('LVC', '101', DEC)).not.toBeNull();

      await e.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'month_started'`).bind(`${DEC}!6`).run();
      await db.batch([db.prepare(`DELETE FROM invoice_lines WHERE invoice_id = (SELECT id FROM invoices WHERE room_id = 3 AND month = ?)`).bind(DEC), db.prepare(`DELETE FROM invoices WHERE room_id = 3 AND month = ?`).bind(DEC)]);
      await runCron(FREQUENT_CRON, e, MIDNIGHT + 1_200_000); // the cap is reached: left to the midnight / daily run
      expect(await invoiceOf('LVC', '101', DEC)).toBeNull();
      await runCron(MONTH_CRON, e, MIDNIGHT + 86_400_000 - 1000);
      expect(await invoiceOf('LVC', '101', DEC)).not.toBeNull();
    });
  });

  describe('phí là của từng tháng', () => {
    const switchToDecember = async () => {
      const nov = await invoiceOf('LVC', '101', NOV);
      const before = { total: nov.total, lines: await linesOf(nov.id) };
      setNow(MIDNIGHT);
      await runCron(MONTH_CRON, e, MIDNIGHT);
      return { novId: nov.id, before };
    };

    it('sửa phí trong tháng 12 chỉ đổi tháng 12: ảnh chụp tháng 11, dòng và tổng hoá đơn tháng 11 giữ nguyên', async () => {
      const { novId, before } = await switchToDecember();
      const cfg = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
      expect(cfg).toMatchObject({ month: DEC, electricPrice: 3500 });
      const res = await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 4000, waterPrice: 22000, services: cfg.services.map((s: any) => (s.name === 'Rác' ? { ...s, price: 35000 } : s)) });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ month: DEC, editable: true, recomputed: 1, config: { electricPrice: 4000 } });

      expect((await invoiceOf('LVC', '101', DEC)).total).toBe(3_500_000 + 35_000 + 40_000); // December draft: new fees
      const nov = await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${NOV}`));
      expect(nov).toMatchObject({ month: NOV, editable: false, config: { electricPrice: 3500, waterPrice: 20000 } });
      expect(nov.config.services.find((s: any) => s.name === 'Rác').price).toBe(30000);
      expect((await invoiceOf('LVC', '101', NOV)).total).toBe(before.total);
      expect(await linesOf(novId)).toEqual(before.lines);
      // The live template follows the current month.
      expect(await (await store()).prepare(`SELECT electricity_per_kwh AS e FROM house_rates WHERE house_id = 'LVC'`).first()).toEqual({ e: 4000 });
      // Another house is untouched.
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=TRUNG_KIM`))).config.electricPrice).toBe(3500);
    });

    it('tháng đã qua chỉ xem: PUT/POST trả 409 tiếng Việt và không đổi gì', async () => {
      await switchToDecember();
      for (const m of ['PUT', 'POST']) {
        const res = await call(PHONES.owner, m, '/api/admin/config', { houseId: 'LVC', month: NOV, electricPrice: 1, waterPrice: 1, services: [] });
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.errorCode).toBe('MONTH_READONLY');
        expect(body.error).toBe('Tháng 11/2026 đã qua nên không sửa được cài đặt phí. Bạn chỉ xem được.');
      }
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=11/2026`))).config).toMatchObject({ electricPrice: 3500, waterPrice: 20000 });
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${NOV}`))).config.services).toHaveLength(3);
    });

    it('dịch vụ thêm ở tháng 12 không có ở tháng 11; hoá đơn tháng 11 vẫn như cũ', async () => {
      const { novId, before } = await switchToDecember();
      const cfg = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
      const res = await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', services: [...cfg.services, { name: 'Bảo vệ', price: 10000, per: 'room', maxQty: null }] });
      expect(res.status).toBe(200);
      const dec = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${DEC}`))).config.services.map((s: any) => s.name);
      const nov = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${NOV}`))).config.services.map((s: any) => s.name);
      expect(dec).toEqual(['Rác', 'Internet', 'Xe máy', 'Bảo vệ']);
      expect(nov).toEqual(['Rác', 'Internet', 'Xe máy']);
      expect((await linesOf((await invoiceOf('LVC', '101', DEC)).id)).map((l: any) => l.name)).toContain('Bảo vệ');
      expect(await linesOf(novId)).toEqual(before.lines);
      // Deleting (switching off) a December service leaves November's list alone too.
      const again = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
      await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', services: again.services.filter((s: any) => s.name !== 'Rác') });
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${NOV}`))).config.services.find((s: any) => s.name === 'Rác').active).toBe(true);
    });

    it('phòng từ chối dịch vụ vẫn có hiệu lực, kể cả khi sao chép sang tháng sau', async () => {
      await switchToDecember();
      const cfg = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
      const rac = cfg.services.find((s: any) => s.name === 'Rác');
      const res = await call(PHONES.owner, 'PUT', '/api/admin/rooms/3/services', { houseId: 'LVC', month: DEC, optOut: [rac.id] });
      expect(res.status).toBe(200);
      expect((await linesOf((await invoiceOf('LVC', '101', DEC)).id)).map((l: any) => l.name)).not.toContain('Rác');
      const jan = Date.UTC(2026, 11, 31, 17, 0, 0);
      setNow(jan);
      await runCron(MONTH_CRON, e, jan);
      const draft = await invoiceOf('LVC', '101', '2027-01');
      expect(draft).not.toBeNull();
      expect((await linesOf(draft.id)).map((l: any) => l.name)).not.toContain('Rác');
    });

    it('tháng 12 chưa có ảnh chụp: xem thì lấy của tháng 11 mà chưa ghi; ghi thì chép từ tháng gần nhất trước đó', async () => {
      const db = await store();
      await db.prepare(`UPDATE house_fee_months SET electricity_per_kwh = 3777 WHERE house_id = 'LVC' AND month = ?`).bind(NOV).run();
      setNow(MIDNIGHT);
      expect(await snapshotCount(DEC)).toBe(0);
      const view = await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${DEC}`));
      expect(view.config.electricPrice).toBe(3777);
      expect(await snapshotCount(DEC)).toBe(0); // looking never writes
      const made = await feeConfigFor(db, 'LVC', DEC);
      expect(made).toMatchObject({ electricPrice: 3777, from: 'snapshot' });
      expect(made.services.map((s) => s.name)).toEqual(['Rác', 'Internet', 'Xe máy']);
      expect(await snapshotCount(DEC)).toBe(1);
      // Later edits of November do not leak into the stored December.
      await db.prepare(`UPDATE house_fee_months SET electricity_per_kwh = 1 WHERE house_id = 'LVC' AND month = ?`).bind(NOV).run();
      expect((await feeConfigFor(db, 'LVC', DEC)).electricPrice).toBe(3777);
    });

    it('chưa có ảnh chụp nào sớm hơn: lấy từ house_rates / house_services', async () => {
      const db = await store();
      await db.prepare(`UPDATE house_rates SET electricity_per_kwh = 4242 WHERE house_id = 'LVC'`).run();
      const cfg = await feeConfigFor(db, 'LVC', '2026-05', { persist: false });
      expect(cfg).toMatchObject({ electricPrice: 4242, from: 'template' });
      expect(cfg.services).toHaveLength(3);
    });

    it('recompute dùng phí của tháng của hoá đơn: tháng đã qua đã phát hành bị khoá, ép thì vẫn dùng phí tháng đó', async () => {
      const { novId, before } = await switchToDecember();
      const cfg = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
      await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 9000, waterPrice: 9000, services: cfg.services });
      const db = await store();
      await expect(recompute(db, novId, { central: e.DB })).rejects.toBeInstanceOf(InvoiceFrozenError);
      await recompute(db, novId, { central: e.DB, allowPast: true });
      expect((await invoiceOf('LVC', '101', NOV)).total).toBe(before.total); // still November's 3.500 / 20.000
      expect(await linesOf(novId)).toEqual(before.lines);
    });

    it('xuất Sheet chỉ cho tháng hiện tại', async () => {
      await switchToDecember();
      await e.DB.prepare(`DELETE FROM sheet_export_queue`).run();
      expect((await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 3600, waterPrice: 20000 })).status).toBe(200);
      let q = (await e.DB.prepare(`SELECT kind, payload FROM sheet_export_queue`).all<{ kind: string; payload: string }>()).results;
      expect(q.map((r) => r.kind)).toEqual(['config']);
      expect(JSON.parse(q[0].payload)).toMatchObject({ houseId: 'LVC', month: '12/2026', dien: 3600, nuoc: 20000, rac: 30000, net: 40000, xe: 50000 });
      // A later month's fees are not on the Sheet yet.
      await e.DB.prepare(`DELETE FROM sheet_export_queue`).run();
      expect((await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', month: '2027-01', electricPrice: 3700, waterPrice: 20000 })).status).toBe(200);
      q = (await e.DB.prepare(`SELECT kind, payload FROM sheet_export_queue`).all<{ kind: string; payload: string }>()).results;
      expect(q).toEqual([]);
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=2027-01`))).editable).toBe(true);
      // And it did not move the live template or December.
      expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config.electricPrice).toBe(3600);
    });
  });
});

describe.each(BACKENDS)('vòng sửa lỗi review 1 [%s]', (backend) => {
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    const db = await store();
    await db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000), ('TRUNG_KIM', 3500, 20000)`).run();
    await setSource('worker');
    await feeConfigFor(db, 'LVC', NOV);
    await feeConfigFor(db, 'TRUNG_KIM', NOV);
  });

  it('I1: tháng trước ảnh chụp đầu tiên: known=false, chỉ xem, và không bao giờ được lưu bằng phí hiện tại', async () => {
    const db = await store();
    const view = await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=2026-10`));
    expect(view).toMatchObject({ month: '2026-10', editable: false, known: false });
    expect(await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=${NOV}`))).toMatchObject({ known: true });
    // A forced recompute of an old draft prices it but must not store a snapshot for that past month.
    await db.prepare(`INSERT INTO invoices (house_id, room_id, month, status, issued_at) VALUES ('LVC', 3, '2026-10', 'unpaid', NULL)`).run();
    await recompute(db, (await invoiceOf('LVC', '101', '2026-10')).id, { central: e.DB, allowPast: true });
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM house_fee_months WHERE month = '2026-10'`).first<{ n: number }>())!.n).toBe(0);
    expect((await feeConfigFor(db, 'LVC', '2026-10')).from).toBe('template');
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM house_fee_months WHERE month = '2026-10'`).first<{ n: number }>())!.n).toBe(0);
  });

  it('I2: PUT /api/houses/:id/rates ghi xuống ảnh chụp tháng hiện tại và mẫu, tính lại nháp tháng đó', async () => {
    const db = await store();
    await db.prepare(`UPDATE invoices SET issued_at = NULL WHERE room_id = 3`).run();
    const res = await call(PHONES.owner, 'PUT', '/api/houses/LVC/rates', { electricity_per_kwh: 3900, water_per_m3: 21000 });
    expect(res.status).toBe(200);
    expect(await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).toMatchObject({ config: { electricPrice: 3900, waterPrice: 21000 } });
    expect(await db.prepare(`SELECT electricity_per_kwh AS e FROM house_rates WHERE house_id = 'LVC'`).first()).toEqual({ e: 3900 });
    expect((await db.prepare(`SELECT electricity_per_kwh AS e FROM house_fee_months WHERE house_id = 'LVC' AND month = ?`).bind(NOV).first<any>()).e).toBe(3900);
    expect((await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC&month=2026-10`))).config.electricPrice).toBe(3900); // template view only
  });

  it('I3: tháng sai hoặc quá xa bị từ chối 400 MONTH_INVALID; tháng sau tháng hiện tại thì được', async () => {
    for (const m of ['2099-01', '2027-01', '2026-13', 'abc']) {
      for (const [method, path, body] of [['GET', `/api/admin/config?houseId=LVC&month=${m}`], ['PUT', '/api/admin/config', { houseId: 'LVC', month: m, electricPrice: 1, waterPrice: 1 }]] as const) {
        const res = await call(PHONES.owner, method, path, body);
        expect(res.status, `${method} ${m}`).toBe(400);
        expect((await json(res)).errorCode).toBe('MONTH_INVALID');
      }
    }
    expect((await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', month: DEC, electricPrice: 3600, waterPrice: 20000 })).status).toBe(200);
    expect((await (await store()).prepare(`SELECT COUNT(*) AS n FROM house_fee_months WHERE month > ?`).bind(DEC).first<{ n: number }>())!.n).toBe(0);
  });

  it('I4: bật worker giữa tháng: trả draftsCreated và ghi dấu tháng đã bắt đầu', async () => {
    await setSource('sheet');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<html></html>'));
    const res = await call(PHONES.developer, 'PUT', '/api/dev/source', { source: 'worker' });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ success: true, source: 'worker', draftsCreated: 0 });
    expect(await marker()).toBe(NOV); // the seeded November invoices already exist: nothing to create
    await (await store()).prepare(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE room_id = 3)`).run();
    await (await store()).prepare(`DELETE FROM invoices WHERE room_id = 3`).run();
    await setSource('sheet');
    await e.DB.prepare(`DELETE FROM settings WHERE key = 'month_started'`).run();
    const again = await json(await call(PHONES.developer, 'PUT', '/api/dev/source', { source: 'worker' }));
    expect(again.draftsCreated).toBe(1);
  });

  it('M3: thêm dịch vụ mới là một khối: lỗi giữa chừng không để lại dòng mồ côi trong house_services', async () => {
    const db = await store();
    const before = (await db.prepare(`SELECT COUNT(*) AS n FROM house_services`).first<{ n: number }>())!.n;
    await db.prepare(`CREATE TRIGGER t_fee_fail BEFORE INSERT ON house_fee_services WHEN NEW.name = 'Hỏng' BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = (await json(await call(PHONES.owner, 'GET', `/api/admin/config?houseId=LVC`))).config;
    const res = await call(PHONES.owner, 'PUT', '/api/admin/config', { houseId: 'LVC', services: [...cfg.services, { name: 'Hỏng', price: 1, per: 'room', maxQty: null }] });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM house_services`).first<{ n: number }>())!.n).toBe(before);
    await db.prepare(`DROP TRIGGER t_fee_fail`).run();
  });
});

describe('di chuyển 0023', () => {
  const run = async (backfillOnly = true) => {
    const m = e.TEST_MIGRATIONS.find((x) => x.name.startsWith('0023'))!;
    return m.queries.filter((q) => !backfillOnly || /^\s*(--[^\n]*\n\s*)*INSERT INTO house_fee_/i.test(q));
  };

  it('điền lại D1: mỗi nhà một ảnh chụp của tháng hiện tại từ house_rates / house_services', async () => {
    await seedWorld('d1');
    const DB = e.DB;
    await DB.batch([
      DB.prepare(`DELETE FROM house_fee_services`), DB.prepare(`DELETE FROM house_fee_months`),
      DB.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000), ('TRUNG_KIM', 3600, 21000)`),
      DB.prepare(`UPDATE house_services SET active = 0 WHERE house_id = 'LVC' AND name = 'Xe máy'`),
    ]);
    const stmts = await run();
    expect(stmts).toHaveLength(2);
    await DB.batch(stmts.map((q) => DB.prepare(q)));
    const cur = (await DB.prepare(`SELECT strftime('%Y-%m', 'now', '+7 hours') AS m`).first<{ m: string }>())!.m;
    expect((await DB.prepare(`SELECT house_id, month, electricity_per_kwh AS e, water_per_m3 AS w FROM house_fee_months ORDER BY house_id`).all()).results).toEqual([
      { house_id: 'LVC', month: cur, e: 3500, w: 20000 }, { house_id: 'NTTD', month: cur, e: 0, w: 0 }, { house_id: 'TRUNG_KIM', month: cur, e: 3600, w: 21000 },
    ]);
    const lvc = (await DB.prepare(`SELECT s.service_id, s.name, s.price, s.active, s.sort, (s.service_id = h.id) AS same FROM house_fee_services s JOIN house_services h ON h.id = s.service_id WHERE s.house_id = 'LVC' ORDER BY s.sort`).all()).results;
    expect(lvc.map((r: any) => [r.name, r.price, r.active, r.same])).toEqual([['Rác', 30000, 1, 1], ['Internet', 40000, 1, 1], ['Xe máy', 50000, 0, 1]]);
    expect((await DB.prepare(`SELECT COUNT(*) AS n FROM house_fee_services WHERE house_id = 'NTTD'`).first<{ n: number }>())!.n).toBe(0);
  });

  it('chạy thử chuyển sang kho riêng: ảnh chụp khớp băm từng bảng', async () => {
    await seedWorld('d1');
    const db = await store();
    await feeConfigFor(db, 'LVC', '2026-11');
    await feeConfigFor(db, 'LVC', '2026-12');
    const r = await migrateOwner(e, 1, { dryRun: true });
    expect(r.error).toBeUndefined();
    for (const t of ['house_fee_months', 'house_fee_services']) {
      const row = r.tables.find((x) => x.table === t)!;
      expect(row.ok && row.d1Sha === row.doSha, t).toBe(true);
    }
    expect(r.tables.find((x) => x.table === 'house_fee_months')).toMatchObject({ d1Count: 2, doCount: 2 });
    expect(r.tables.find((x) => x.table === 'house_fee_services')).toMatchObject({ d1Count: 6, doCount: 6 });
  });
});
