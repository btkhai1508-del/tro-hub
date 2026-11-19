import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage } from '../src/central/directory.ts';
import { purgeDeletedHouses, reconcile, syncLegacySheets } from '../src/cron.ts';
import worker from '../src/index.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld, type BackendName } from './helpers.ts';

const e = env as unknown as Env;
const MONTH = '2026-11';
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const storeOf = (owner: number) => tenantOfOwner(e, owner);

async function runScheduled(cron: string) {
  const waits: Promise<unknown>[] = [];
  await worker.scheduled(
    { cron, scheduledTime: Date.now(), type: 'scheduled', noRetry() {} } as unknown as ScheduledController,
    e,
    { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext
  );
  await Promise.all(waits);
}

afterEach(() => vi.restoreAllMocks());

describe.each(BACKENDS)('thông báo [%s]', (backend) => {
  beforeEach(() => seedWorld(backend));

  it('tạo và đọc cho kết quả giống nhau', async () => {
    const owner = await login(PHONES.owner);
    const created = await api('/api/admin/notifications', json({ title: 'Cúp nước', desc: 'Mai cúp nước', type: 'alert', target: 'ALL' }), owner);
    expect(created.status).toBe(200);
    const body = (await created.json()) as any;
    expect(body.notification).toMatchObject({ title: 'Cúp nước', desc: 'Mai cúp nước', type: 'alert', target: 'LVC', customRooms: [], unread: true, time: 'Vừa xong' });

    await api('/api/admin/notifications', json({ title: 'Riêng', desc: 'Phòng 101', target: 'CUSTOM', customRooms: ['LVC-101'] }), owner);
    const list = (await (await api('/api/admin/notifications', {}, owner)).json()) as any;
    expect(list.notifications.map((n: any) => [n.title, n.target, n.customRooms, n.id.startsWith('d1-')]).sort()).toEqual([
      ['Cúp nước', 'LVC', [], true],
      ['Cúp nước', 'TRUNG_KIM', [], true],
      ['Riêng', 'CUSTOM', ['LVC-101'], true],
    ]);

    const res = (await (await api('/api/notifications', {}, await login(PHONES.residentLvc))).json()) as any;
    expect(res.notifications.map((n: any) => n.title).sort()).toEqual(['Cúp nước', 'Riêng']);
    const tk = (await (await api('/api/notifications', {}, await login(PHONES.residentTk))).json()) as any;
    expect(tk.notifications.map((n: any) => n.title)).toEqual(['Cúp nước']);
    const other = (await (await api('/api/admin/notifications', {}, await login(PHONES.otherOwner))).json()) as any;
    expect(other.notifications).toEqual([]);
  });
});

describe.each(BACKENDS)('cron [%s]', (backend) => {
  beforeEach(() => seedWorld(backend));

  it('syncLegacySheets bỏ qua chủ trọ đang migrating, không tải Sheet', async () => {
    await e.DB.batch([
      e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sheet_id', 'SHEET1'), ('legacy_sheet_houses', 'LVC')`),
      e.DB.prepare(`DELETE FROM settings WHERE key LIKE 'legacy_sync:%'`),
    ]);
    await setStorage(e.DB, 1, 'migrating');
    const spy = vi.spyOn(globalThis, 'fetch');
    await syncLegacySheets(e);
    expect(spy.mock.calls.filter(([u]) => /google\.com/.test(String(u instanceof Request ? u.url : u)))).toEqual([]);
    expect(await e.DB.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'legacy_sync:%'`).first('n')).toBe(0);
    await e.DB.prepare(`DELETE FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`).run();
  });

  it('purgeDeletedHouses xoá căn hết hạn gồm index, thư mục, staff_houses; căn khác còn nguyên', async () => {
    await e.DB.prepare(`UPDATE house_directory SET status = 'inactive', delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    expect(await purgeDeletedHouses(e)).toEqual(['LVC']);

    const store = await storeOf(1);
    const count = async (sql: string) => (await store.prepare(sql).first<{ n: number }>())!.n;
    expect(await count(`SELECT COUNT(*) n FROM houses WHERE id = 'LVC'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM rooms WHERE house_id = 'LVC'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM residents WHERE house_id = 'LVC'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM invoices WHERE house_id = 'LVC'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM houses WHERE id = 'TRUNG_KIM'`)).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM rooms WHERE house_id = 'TRUNG_KIM'`)).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM invoices WHERE house_id = 'TRUNG_KIM'`)).toBe(1);
    const n = async (sql: string) => (await e.DB.prepare(sql).first<{ n: number }>())!.n;
    expect(await n(`SELECT COUNT(*) n FROM resident_index WHERE house_id = 'LVC'`)).toBe(0);
    expect(await n(`SELECT COUNT(*) n FROM resident_index WHERE house_id = 'TRUNG_KIM'`)).toBe(1);
    expect(await n(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`)).toBe(0);
    expect(await n(`SELECT COUNT(*) n FROM staff_houses WHERE house_id = 'LVC'`)).toBe(0);
    expect(await n(`SELECT COUNT(*) n FROM staff_houses WHERE house_id = 'TRUNG_KIM'`)).toBe(2);
    // The other landlord is untouched.
    expect(await (await storeOf(4)).prepare(`SELECT COUNT(*) n FROM rooms WHERE house_id = 'NTTD'`).first('n')).toBe(2);
    expect(await purgeDeletedHouses(e)).toEqual([]);
  });

  it('purge: bước sau lỗi thì ghi cảnh báo và chạy lại được', async () => {
    await e.DB.prepare(`UPDATE house_directory SET delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    await e.DB.prepare(`DELETE FROM audit_log WHERE action = 'house_purge_warning'`).run();
    await e.DB.prepare(`CREATE TRIGGER block_idx BEFORE DELETE ON resident_index BEGIN SELECT RAISE(ABORT, 'blocked'); END`).run();
    try {
      await purgeDeletedHouses(e);
      expect(await e.DB.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'house_purge_warning' AND house_id = 'LVC'`).first('n')).toBe(1);
      expect(await e.DB.prepare(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`).first('n')).toBe(1);
    } finally {
      await e.DB.prepare(`DROP TRIGGER block_idx`).run();
    }
    expect(await purgeDeletedHouses(e)).toEqual(['LVC']);
  });

  it('reconcile sửa room_count sai và báo index thiếu cư dân trong kho', async () => {
    await e.DB.prepare(`UPDATE house_directory SET room_count = 9 WHERE house_id = 'TRUNG_KIM'`).run();
    await e.DB.prepare(`INSERT INTO resident_index (resident_id, phone, owner_id, house_id) VALUES (777, '0999999999', 1, 'LVC')`).run();
    const r = await reconcile(e);
    expect(r.countsFixed).toBe(1);
    expect(r.indexMismatches).toEqual([{ residentId: 777, problem: expect.stringContaining('missing from store') }]);
    expect(await e.DB.prepare(`SELECT room_count FROM house_directory WHERE house_id = 'TRUNG_KIM'`).first('room_count')).toBe(1);
    const saved = JSON.parse((await e.DB.prepare(`SELECT value FROM settings WHERE key = 'last_reconcile'`).first<{ value: string }>())!.value);
    expect(saved).toMatchObject({ countsFixed: 1, indexMismatches: [{ residentId: 777 }] });
    // The index row is kept (report only).
    expect(await e.DB.prepare(`SELECT COUNT(*) n FROM resident_index WHERE resident_id = 777`).first('n')).toBe(1);
  });

  it('purge: căn được khôi phục giữa lúc chọn và lúc xoá thì còn nguyên', async () => {
    await e.DB.prepare(`UPDATE house_directory SET status = 'inactive', delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    const purged = await purgeDeletedHouses(e, {
      beforeDelete: async (id) => {
        await e.DB.prepare(`UPDATE house_directory SET status = 'active', delete_after = NULL WHERE house_id = ?`).bind(id).run(); // restored
      },
    });
    expect(purged).toEqual([]);
    const store = await storeOf(1);
    expect(await store.prepare(`SELECT COUNT(*) n FROM houses WHERE id = 'LVC'`).first('n')).toBe(1);
    expect(await store.prepare(`SELECT COUNT(*) n FROM rooms WHERE house_id = 'LVC'`).first('n')).toBeGreaterThan(0);
    expect(await e.DB.prepare(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`).first('n')).toBe(1);
  });

  it('reconcile báo (không sửa) căn lệch giữa thư mục và kho: thiếu ở kho, thiếu ở thư mục, khác tên/trạng thái/hạn xoá/mã', async () => {
    const store = await storeOf(1);
    await e.DB.prepare(`INSERT INTO house_directory (house_id, owner_id, name) VALUES ('GHOST', 1, 'Ma')`).run();
    await store.prepare(`UPDATE houses SET name = 'Tên khác', status = 'inactive', delete_after = '2030-01-01 00:00:00', pay_no = 77 WHERE id = 'TRUNG_KIM'`).run();
    await e.DB.prepare(`DELETE FROM staff_houses WHERE house_id = 'LVC'`).run();
    await e.DB.prepare(`DELETE FROM house_directory WHERE house_id = 'LVC'`).run();
    const r = await reconcile(e);
    const byHouse = Object.fromEntries(r.houseMismatches.map((m) => [m.houseId, m.problem]));
    expect(byHouse['GHOST']).toMatch(/in directory but missing from store/);
    expect(byHouse['LVC']).toMatch(/in store but missing from directory/);
    for (const f of ['name', 'status', 'delete_after', 'pay_no']) expect(byHouse['TRUNG_KIM'], f).toContain(f);
    expect(r.houseMismatches).toHaveLength(3);
    const saved = JSON.parse((await e.DB.prepare(`SELECT value FROM settings WHERE key = 'last_reconcile'`).first<{ value: string }>())!.value);
    expect(saved.houseMismatches).toHaveLength(3);
    // Report only: nothing was changed.
    expect(await e.DB.prepare(`SELECT name FROM house_directory WHERE house_id = 'TRUNG_KIM'`).first('name')).not.toBe('Tên khác');
    expect(await e.DB.prepare(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`).first('n')).toBe(0);
  });

  it('reconcile: thư mục và kho khớp thì không có căn lệch', async () => {
    expect((await reconcile(e)).houseMismatches).toEqual([]);
  });

  it('scheduled 0 19: purge chạy xong rồi mới reconcile (reconcile không thấy căn vừa xoá là lệch)', async () => {
    await e.DB.prepare(`UPDATE house_directory SET delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    await runScheduled('0 19 * * *');
    const saved = JSON.parse((await e.DB.prepare(`SELECT value FROM settings WHERE key = 'last_reconcile'`).first<{ value: string }>())!.value);
    expect(saved.houseMismatches).toEqual([]);
  });

  it('scheduled */10 phút ghi tiền deferred, bỏ qua chủ trọ migrating', async () => {
    const ins = (id: string, house: string, room: string) =>
      e.DB.prepare(`INSERT INTO sepay_events (sepay_id, kind, amount, content, house_id, room, month, status) VALUES (?, 'rent', 3500000, 'x', ?, ?, ?, 'deferred')`)
        .bind(id, house, room, MONTH).run();
    await e.DB.prepare(`DELETE FROM sepay_events`).run();
    await e.DB.prepare(`DELETE FROM settings WHERE key IN ('legacy_sheet_id', 'legacy_sheet_houses')`).run();
    await ins('S1', 'LVC', '101');
    await ins('S2', 'NTTD', '101');
    await setStorage(e.DB, 4, 'migrating');
    await runScheduled('*/10 * * * *');
    const st = async (id: string) => (await e.DB.prepare(`SELECT status FROM sepay_events WHERE sepay_id = ?`).bind(id).first<{ status: string }>())!.status;
    expect(await st('S1')).toBe('done');
    expect(await st('S2')).toBe('deferred');
    expect(await (await storeOf(1)).prepare(`SELECT COUNT(*) n FROM payments WHERE house_id = 'LVC'`).first('n')).toBe(1);
  });

  it('scheduled 0 19 chạy purge và reconcile', async () => {
    await e.DB.prepare(`UPDATE house_directory SET delete_after = datetime('now', '-1 day') WHERE house_id = 'LVC'`).run();
    await runScheduled('0 19 * * *');
    expect(await e.DB.prepare(`SELECT COUNT(*) n FROM house_directory WHERE house_id = 'LVC'`).first('n')).toBe(0);
    expect(await e.DB.prepare(`SELECT COUNT(*) n FROM settings WHERE key = 'last_reconcile'`).first('n')).toBe(1);
  });
});
