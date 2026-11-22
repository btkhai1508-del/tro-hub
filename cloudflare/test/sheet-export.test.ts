import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { runCron, syncLegacySheets, FREQUENT_CRON } from '../src/cron.ts';
import { drainExportQueue, enqueueExport, DRAIN_LIMIT } from '../src/sheetExport.ts';
import { currentMonth, ensureMonthFresh, toSheetMonth } from '../src/sheetSync.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
// A month that has started (rows of a month still to come are held back by the drain): always the current one.
const CUR_MONTH = currentMonth();
const SHEET_MONTH = toSheetMonth(CUR_MONTH);
const call = (token: string, method: string, path: string, body?: unknown) =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, token);
const json = async (res: Response) => (await res.json()) as any;

const setting = (key: string, value: string) =>
  e.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
const rows = async () => (await e.DB.prepare(`SELECT * FROM sheet_export_queue ORDER BY id`).all<any>()).results;

interface Call { url: string; body: any }
/** Every Apps Script call; `respond` decides the answer. Anything else (CSV download) is recorded in `other`. */
function mockScript(respond: (c: Call) => Response | Promise<Response> = () => Response.json({ success: true })) {
  const calls: Call[] = [];
  const other: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('script.google.com')) {
      const c = { url, body: init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(new URL(url).searchParams) };
      calls.push(c);
      return respond(c);
    }
    other.push(url);
    return new Response('', { status: 404 });
  });
  return { calls, other };
}

afterEach(() => {
  vi.restoreAllMocks();
  (e as any).SHEET_WRITES = 'off';
});

describe.each(BACKENDS)('xuất Sheet một chiều [%s]', (backend) => {
  let owner: string;
  beforeEach(async () => {
    await seedWorld(backend);
    await e.DB.batch([
      e.DB.prepare(`DELETE FROM audit_log`),
      e.DB.prepare(`DELETE FROM settings WHERE key LIKE 'legacy_sync:%'`),
    ]);
    await setting('legacy_sheet_id', 'SHEET');
    await setting('legacy_sheet_houses', 'LVC');
    await setting('source_of_truth', 'worker');
    (e as any).SHEET_WRITES = 'on';
    const db = await tenantOfOwner(e, 1);
    await db.batch([
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('LVC', 3500, 20000)`),
      db.prepare(`INSERT INTO house_rates (house_id, electricity_per_kwh, water_per_m3) VALUES ('TRUNG_KIM', 3500, 20000)`),
    ]);
    owner = await login(PHONES.owner);
  });

  const enter = (house: string, room: string, data: Record<string, unknown>, month = SHEET_MONTH) =>
    call(owner, 'POST', '/api/admin/room-detail', { month, room, houseId: house, data });

  describe('enqueue', () => {
    it('worker + nhà có Sheet: nhập điện nước tạo một dòng meters đúng hình dạng update_meters', async () => {
      const res = await enter('LVC', '101', { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      expect(res.status).toBe(200);
      const q = await rows();
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({ kind: 'meters', attempts: 0, done_at: null });
      expect(JSON.parse(q[0].payload)).toEqual({
        houseId: 'LVC', room: 'LVC-101', month: SHEET_MONTH, dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14, status: '',
      });
    });

    it('nhà không có Sheet (TRUNG_KIM) hoặc công tắc sheet: không có dòng nào', async () => {
      await enter('TRUNG_KIM', '101', { dienCu: 1, dienMoi: 5 });
      expect(await rows()).toHaveLength(0);
      await setting('source_of_truth', 'sheet');
      await enter('LVC', '101', { dienCu: 1, dienMoi: 5 });
      expect(await rows()).toHaveLength(0);
    });

    it('đổi trạng thái thanh toán tạo dòng payment và KHÔNG gọi Apps Script trực tiếp', async () => {
      const { calls } = mockScript();
      const res = await call(owner, 'POST', '/api/admin/payment-status', { roomNumber: 'LVC-101', status: 'cash', month: '11/2026' });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toEqual([]);
      const q = await rows();
      expect(q.map((r) => r.kind)).toEqual(['payment']);
      expect(JSON.parse(q[0].payload)).toMatchObject({ houseId: 'LVC', room: 'LVC-101', status: 'paid', month: '11/2026' });
    });

    it('đổi đơn giá: dòng config với giá điện, nước và dịch vụ cột K/L/M', async () => {
      const res = await call(owner, 'PUT', '/api/admin/config', { houseId: 'LVC', electricPrice: 3600, waterPrice: 21000 });
      expect(res.status).toBe(200);
      const q = await rows();
      expect(q.map((r) => r.kind)).toEqual(['config']);
      const p = JSON.parse(q[0].payload);
      expect(p).toMatchObject({ houseId: 'LVC', dien: 3600, nuoc: 21000, rac: 30000, net: 40000, xe: 50000 });
      expect(p.month).toMatch(/^\d{2}\/\d{4}$/);
    });

    it('đăng ký, duyệt, sửa hồ sơ, xoá cư dân: mỗi việc một dòng, không có mật khẩu hay CCCD', async () => {
      const dev = await login(PHONES.owner);
      const reg = await api('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Người Mới', phone: '0900000999', email: 'a@b.c', gender: 'Nam', password: 'secret123', roomNumber: '101', houseId: 'LVC' }),
      });
      expect(reg.status).toBe(200);
      expect((await call(dev, 'POST', '/api/admin/accounts/status', { phone: '0900000999', status: 'approved' })).status).toBe(200);
      const login2 = await login(PHONES.residentLvc);
      expect((await call(login2, 'POST', '/api/profile/update', { name: 'Cư dân LVC', phone: PHONES.residentLvc, email: 'x@y.z', cccd: '012345678901', plateNumber: '59A1' })).status).toBe(200);
      expect((await call(dev, 'POST', '/api/admin/accounts/delete', { phone: '0900000999', mode: 'resident' })).status).toBe(200);

      const q = await rows();
      expect(q.map((r) => r.kind)).toEqual(['register_account', 'update_account_status', 'update_profile', 'delete_resident']);
      const [reg2, st, prof, del] = q.map((r) => JSON.parse(r.payload));
      expect(reg2).toEqual({ houseId: 'LVC', name: 'Người Mới', phone: '0900000999', email: 'a@b.c', gender: 'Nam', password: '', room: 'LVC-101', approved: false });
      expect(st).toEqual({ houseId: 'LVC', phone: '0900000999', name: 'Người Mới', room: 'LVC-101', status: 'approved' });
      expect(prof).toMatchObject({ houseId: 'LVC', room: 'LVC-101', currentPhone: PHONES.residentLvc, name: 'Cư dân LVC', email: 'x@y.z', plateNumber: '59A1' });
      expect(JSON.stringify(prof)).not.toContain('012345678901');
      expect(del).toEqual({ houseId: 'LVC', phone: '0900000999', name: 'Người Mới', room: 'LVC-101', mode: 'resident' });
      expect(JSON.stringify(q)).not.toContain('secret123');
    });

    it('enqueue lỗi không chặn việc ghi và để lại dấu vết trong audit_log', async () => {
      await e.DB.prepare(`ALTER TABLE sheet_export_queue RENAME TO sheet_export_queue_x`).run();
      try {
        const res = await enter('LVC', '101', { dienCu: 100, dienMoi: 150 });
        expect(res.status).toBe(200);
        const db = await tenantOfOwner(e, 1);
        expect((await db.prepare(`SELECT electric_new AS n FROM meter_readings WHERE month = '${CUR_MONTH}'`).first<any>()).n).toBe(150);
        const a = await e.DB.prepare(`SELECT target FROM audit_log WHERE action = 'sheet_export_enqueue_failed'`).first<any>();
        expect(a.target).toContain('meters');
      } finally {
        await e.DB.prepare(`ALTER TABLE sheet_export_queue_x RENAME TO sheet_export_queue`).run();
      }
    });

    it('enqueueExport trực tiếp: bỏ qua nhà không thuộc Sheet', async () => {
      await enqueueExport(e.DB, 'meters', { houseId: 'NTTD', room: '101' });
      await enqueueExport(e.DB, 'meters', {});
      expect(await rows()).toHaveLength(0);
    });
  });

  describe('drainExportQueue', () => {
    it('200: gửi đúng action và tham số, đặt done_at, trả {sent, failed}', async () => {
      await enter('LVC', '101', { dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14 });
      const { calls } = mockScript();
      expect(await drainExportQueue(e)).toEqual({ sent: 1, failed: 0 });
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ action: 'update_meters', room: 'LVC-101', month: SHEET_MONTH, dienCu: 100, dienMoi: 150, nuocCu: 10, nuocMoi: 14, status: '' });
      const [r] = await rows();
      expect(r.done_at).not.toBeNull();
      expect(r.attempts).toBe(0);
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 0 }); // nothing left, no new call
      expect(calls).toHaveLength(1);
    });

    it('mọi loại dòng gọi đúng action Express dùng (update_payment, update_config, tài khoản, delete_account)', async () => {
      const kinds: [string, Record<string, unknown>, string][] = [
        ['payment', { houseId: 'LVC', room: 'LVC-101', status: 'paid', month: '11/2026', row: 9 }, 'update_payment'],
        ['config', { houseId: 'LVC', month: '11/2026', dien: 1, nuoc: 2, rac: 3, net: 4, xe: 5 }, 'update_config'],
        ['register_account', { houseId: 'LVC', name: 'A', phone: '0900000999', email: '', gender: '', password: '', room: 'LVC-101', approved: false }, 'register_account'],
        ['update_profile', { houseId: 'LVC', room: 'LVC-101', currentPhone: '0900000999', name: 'A' }, 'update_profile'],
        ['update_account_status', { houseId: 'LVC', phone: '0900000999', name: 'A', room: 'LVC-101', status: 'rejected' }, 'update_account_status'],
        ['delete_resident', { houseId: 'LVC', phone: '0900000999', name: 'A', room: 'LVC-101', mode: 'resident' }, 'delete_resident'],
        ['delete_resident', { houseId: 'LVC', phone: '0900000999', name: 'A', room: 'LVC-101', mode: 'account' }, 'delete_account'],
      ];
      for (const [kind, payload] of kinds) await enqueueExport(e.DB, kind as any, payload);
      const { calls } = mockScript((c) => Response.json({ success: true, action: c.body.action }));
      expect(await drainExportQueue(e)).toEqual({ sent: 7, failed: 0 });
      expect(calls.map((c) => c.body.action)).toEqual(kinds.map((k) => k[2]));
      expect(calls[0].body).toEqual({ action: 'update_payment', room: 'LVC-101', status: 'paid', month: '11/2026', row: 9 });
      expect(calls[6].body).toEqual({ action: 'delete_account', phone: '0900000999', name: 'A', room: 'LVC-101' });
      expect(JSON.stringify(calls.map((c) => c.body))).not.toContain('houseId');
    });

    it('500 liên tục: attempts tăng tới 5 rồi dừng; hiện trong /api/dev/storage; ghi hoá đơn không bị ảnh hưởng', async () => {
      await enter('LVC', '101', { dienCu: 100, dienMoi: 150 });
      const { calls } = mockScript(() => new Response('boom', { status: 500 }));
      for (let i = 1; i <= 5; i++) {
        expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 1 });
        expect((await rows())[0].attempts).toBe(i);
      }
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 0 });
      expect(calls).toHaveLength(5);
      const [r] = await rows();
      expect(r).toMatchObject({ attempts: 5, done_at: null });
      expect(r.last_error).toContain('500');

      const dev = await login(PHONES.developer);
      const storage = await json(await call(dev, 'GET', '/api/dev/storage'));
      expect(storage.source).toBe('worker');
      expect(storage.exportQueue).toEqual({ pending: 0, failed: [{ id: r.id, kind: 'meters', lastError: r.last_error }] });

      // The invoice side keeps working while the Sheet is down.
      const again = await enter('LVC', '101', { dienMoi: 160 });
      expect(again.status).toBe(200);
      const db = await tenantOfOwner(e, 1);
      expect((await db.prepare(`SELECT electric_new AS n FROM meter_readings WHERE month = '${CUR_MONTH}'`).first<any>()).n).toBe(160);
    });

    it('một dòng lỗi không chặn dòng khác; Apps Script success:false tính là lỗi', async () => {
      await enqueueExport(e.DB, 'payment', { houseId: 'LVC', room: 'LVC-101', status: 'paid', month: '11/2026', row: '' });
      await enqueueExport(e.DB, 'config', { houseId: 'LVC', month: '11/2026', dien: 1 });
      const { calls } = mockScript((c) => (c.body.action === 'update_payment' ? Response.json({ success: false, error: 'Server busy, please retry' }) : Response.json({ success: true })));
      expect(await drainExportQueue(e)).toEqual({ sent: 1, failed: 1 });
      expect(calls).toHaveLength(2);
      const q = await rows();
      expect(q[0]).toMatchObject({ attempts: 1, last_error: 'Server busy, please retry', done_at: null });
      expect(q[1].done_at).not.toBeNull();
    });

    it('gộp: nhiều dòng meters cùng phòng+tháng chỉ gửi dòng mới nhất, dòng cũ done_at superseded', async () => {
      await enter('LVC', '101', { dienCu: 100, dienMoi: 110 });
      await enter('LVC', '101', { dienMoi: 120 });
      await enter('LVC', '101', { dienMoi: 130 });
      expect(await rows()).toHaveLength(3);
      const { calls } = mockScript();
      expect(await drainExportQueue(e)).toEqual({ sent: 1, failed: 0 });
      expect(calls).toHaveLength(1);
      expect(calls[0].body.dienMoi).toBe(130);
      const q = await rows();
      expect(q.map((r) => r.last_error)).toEqual(['superseded', 'superseded', null]);
      expect(q.every((r) => r.done_at)).toBe(true);
    });

    it(`tối đa ${DRAIN_LIMIT} dòng mỗi lần, cũ nhất trước`, async () => {
      for (let i = 1; i <= 25; i++) await enqueueExport(e.DB, 'update_profile' as any, { houseId: 'LVC', room: 'LVC-101', currentPhone: String(i) });
      const { calls } = mockScript((c) => Response.json({ success: true, action: c.body.action }));
      expect(await drainExportQueue(e)).toEqual({ sent: DRAIN_LIMIT, failed: 0 });
      expect(calls.map((c) => c.body.currentPhone)).toEqual(Array.from({ length: DRAIN_LIMIT }, (_, i) => String(i + 1)));
      expect(await drainExportQueue(e)).toEqual({ sent: 5, failed: 0 });
    });

    it('thử lại an toàn: register_account báo trùng và delete báo không thấy được coi là đã xong', async () => {
      await enqueueExport(e.DB, 'register_account', { houseId: 'LVC', name: 'A', phone: '0900000999', room: 'LVC-101' });
      await enqueueExport(e.DB, 'delete_resident', { houseId: 'LVC', phone: '0900000999', mode: 'account' });
      mockScript((c) => Response.json({ success: false, action: c.body.action, error: c.body.action === 'register_account' ? 'Số điện thoại này đã được đăng ký trên hệ thống' : 'Không tìm thấy cư dân trong tab cá nhân' }));
      expect(await drainExportQueue(e)).toEqual({ sent: 2, failed: 0 });
    });

    it('script cũ không nêu tên action: dòng tài khoản coi là lỗi', async () => {
      await enqueueExport(e.DB, 'update_account_status', { houseId: 'LVC', phone: '1', status: 'approved' });
      mockScript(() => Response.json({ success: true }));
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 1 });
    });

    it('công tắc sheet: không gửi gì; SHEET_WRITES=off: không gửi gì', async () => {
      await enter('LVC', '101', { dienCu: 1, dienMoi: 5 });
      const { calls } = mockScript();
      (e as any).SHEET_WRITES = 'off';
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 0 });
      (e as any).SHEET_WRITES = 'on';
      await setting('source_of_truth', 'sheet');
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 0 });
      expect(calls).toEqual([]);
    });

    it('cron 10 phút gọi drain ở worker, không ở sheet', async () => {
      await enter('LVC', '101', { dienCu: 1, dienMoi: 5 });
      const { calls } = mockScript();
      await setting('source_of_truth', 'sheet');
      await runCron(FREQUENT_CRON, e);
      expect(calls).toEqual([]);
      await setting('source_of_truth', 'worker');
      await runCron(FREQUENT_CRON, e);
      expect(calls.map((c) => c.body.action)).toEqual(['update_meters']);
    });
  });

  describe('đọc Sheet tắt ở worker', () => {
    it('syncLegacySheets, ensureMonthFresh và cron không tải CSV nào của Sheet', async () => {
      const { calls, other } = mockScript();
      const db = await tenantOfOwner(e, 1);
      await syncLegacySheets(e);
      await ensureMonthFresh(e.DB, db, '2026-11', 0);
      await runCron(FREQUENT_CRON, e);
      expect(other).toEqual([]);
      expect(calls).toEqual([]);
    });

    it('GET /api/admin/months ở worker không tải gì từ docs.google.com; ở sheet vẫn đọc Sheet', async () => {
      const { other, calls } = mockScript();
      const res = await call(owner, 'GET', '/api/admin/months');
      expect(res.status).toBe(200);
      expect((await json(res)).months).toContain('11/2026');
      await call(owner, 'GET', '/api/admin/billing?month=11/2026');
      await call(owner, 'GET', '/api/admin/dashboard');
      await call(await login(PHONES.residentLvc), 'GET', '/api/payment/status');
      expect(other.filter((u) => u.includes('google'))).toEqual([]);
      expect(calls).toEqual([]);
      await setting('source_of_truth', 'sheet');
      await call(owner, 'GET', '/api/admin/months');
      expect(other.some((u) => u.includes('docs.google.com'))).toBe(true);
    });

    it('ở sheet: cron vẫn đọc Sheet như cũ (có tải CSV)', async () => {
      await setting('source_of_truth', 'sheet');
      const { other } = mockScript();
      await syncLegacySheets(e);
      expect(other.length).toBeGreaterThan(0);
      expect(other[0]).toContain('docs.google.com');
    });

    it('ở sheet: thao tác ghi không xếp hàng; tô cột P trực tiếp như cũ', async () => {
      await setting('source_of_truth', 'sheet');
      const { calls } = mockScript();
      await call(owner, 'POST', '/api/admin/payment-status', { roomNumber: 'LVC-101', status: 'cash', month: '11/2026' });
      await new Promise((r) => setTimeout(r, 20));
      expect(await rows()).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ action: 'update_payment', room: 'LVC-101', status: 'paid' });
    });
  });

  describe('chuyển công tắc sang worker', () => {
    const put = async (body: Record<string, unknown>) => call(await login(PHONES.developer), 'PUT', '/api/dev/source', body);
    beforeEach(async () => {
      await setting('source_of_truth', 'sheet');
      (e as any).ZALO_APP_SECRET = 'test-zalo-secret';
    });

    it('lần đọc Sheet cuối lỗi: 409 SYNC_FAILED, công tắc giữ sheet, có audit', async () => {
      await setting('legacy_sheet_id', 'SHEET_BROKEN');
      mockScript();
      const res = await put({ source: 'worker' });
      expect(res.status).toBe(409);
      expect((await json(res)).errorCode).toBe('SYNC_FAILED');
      expect((await e.DB.prepare(`SELECT value FROM settings WHERE key = 'source_of_truth'`).first<any>()).value).toBe('sheet');
      expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'source_sync_failed'`).first<any>()).n).toBe(1);
    });

    it('lần đọc cuối chạy được (tải trang tab của Sheet): chuyển được và ghi audit', async () => {
      await setting('legacy_sheet_id', 'SHEET_OK');
      const seen: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        seen.push(String(input instanceof Request ? input.url : input));
        return new Response('<html></html>');
      });
      const res = await put({ source: 'worker' });
      expect(res.status).toBe(200);
      expect(seen.some((u) => u.includes('docs.google.com/spreadsheets/d/SHEET_OK'))).toBe(true);
      expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'source_final_sync_ok'`).first<any>()).n).toBe(1);
    });
  });

  describe('đăng ký công khai', () => {
    it('ở sheet: POST /api/auth/register trả 404 và không ghi gì', async () => {
      await setting('source_of_truth', 'sheet');
      const before = (await e.DB.prepare(`SELECT COUNT(*) AS n FROM resident_index`).first<any>()).n;
      const res = await api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', phone: '0900000888', password: 'secret1', roomNumber: '101', houseId: 'LVC' }) });
      expect(res.status).toBe(404);
      expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM resident_index`).first<any>()).n).toBe(before);
    });
  });

  describe('chuyển công tắc về sheet', () => {
    it('từ chối khi còn dòng chờ, cho phép khi đã gửi hoặc bỏ cuộc (5 lần)', async () => {
      const dev = await login(PHONES.developer);
      const put = (source: string) => call(dev, 'PUT', '/api/dev/source', { source });
      await e.DB.prepare(`UPDATE settings SET value = 'worker' WHERE key = 'source_of_truth'`).run();
      (e as any).ZALO_APP_SECRET = 'test-zalo-secret';
      await enter('LVC', '101', { dienCu: 1, dienMoi: 5 });
      const refused = await put('sheet');
      expect(refused.status).toBe(409);
      expect((await json(refused)).errorCode).toBe('EXPORT_PENDING');
      mockScript();
      await drainExportQueue(e);
      expect((await put('sheet')).status).toBe(200);
      // Given-up rows (attempts = 5) block with EXPORT_FAILED until acknowledged.
      await setting('source_of_truth', 'worker');
      await e.DB.prepare(`UPDATE sheet_export_queue SET done_at = NULL, attempts = 5`).run();
      const dead = await put('sheet');
      expect(dead.status).toBe(409);
      expect((await json(dead)).errorCode).toBe('EXPORT_FAILED');
      expect((await call(dev, 'PUT', '/api/dev/source', { source: 'sheet', acknowledgeFailed: true })).status).toBe(200);
    });

    it('requeue: chỉ Developer; đưa dòng lỗi về attempts 0, gửi lại được, ghi audit', async () => {
      await enter('LVC', '101', { dienCu: 1, dienMoi: 5 });
      await e.DB.prepare(`UPDATE sheet_export_queue SET attempts = 5, last_error = 'x'`).run();
      expect((await call(owner, 'POST', '/api/dev/export-queue/requeue')).status).toBe(403);
      const dev = await login(PHONES.developer);
      const res = await call(dev, 'POST', '/api/dev/export-queue/requeue');
      expect(await json(res)).toEqual({ success: true, requeued: 1 });
      expect((await rows())[0].attempts).toBe(0);
      expect((await e.DB.prepare(`SELECT target FROM audit_log WHERE action = 'export_requeue'`).first<any>()).target).toBe('1');
      mockScript();
      expect(await drainExportQueue(e)).toEqual({ sent: 1, failed: 0 });
    });

    it('gộp: dòng cũ không vượt dòng mới hơn đã bỏ cuộc', async () => {
      await enqueueExport(e.DB, 'meters', { houseId: 'LVC', room: 'LVC-101', month: SHEET_MONTH, dienMoi: 1 });
      await enqueueExport(e.DB, 'meters', { houseId: 'LVC', room: 'LVC-101', month: SHEET_MONTH, dienMoi: 2 });
      await e.DB.prepare(`UPDATE sheet_export_queue SET attempts = 5 WHERE id = (SELECT MAX(id) FROM sheet_export_queue)`).run();
      const { calls } = mockScript();
      expect(await drainExportQueue(e)).toEqual({ sent: 0, failed: 0 });
      expect(calls).toEqual([]);
    });
  });
});
