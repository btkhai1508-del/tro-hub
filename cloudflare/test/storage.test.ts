import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { setStorage } from '../src/central/directory.ts';
import { FREE_LIMITS, storageWarnings } from '../src/routes/storage.ts';
import { tenantStub } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const runIn = runInDurableObject as unknown as (stub: unknown, fn: (instance: any, state: any) => unknown) => Promise<any>;
const tokens: Record<string, string> = {};

const ROUTES: [string, string][] = [
  ['GET', '/api/dev/storage'],
  ['GET', '/api/dev/storage/1/export'],
];

describe('storageWarnings', () => {
  const GB = 1_000_000_000; // decimal: Cloudflare measures Durable Object storage in GB, not GiB
  const quiet = { owners: [{ name: 'A', sizeBytes: 1000 }, { name: 'B', sizeBytes: null }], totalBytes: 1000, rowsWrittenToday: 10 };

  it('không cảnh báo khi dùng ít', () => {
    expect(storageWarnings(quiet)).toEqual([]);
  });
  it('giới hạn theo GB thập phân', () => {
    expect(FREE_LIMITS.perStoreBytes).toBe(1_000_000_000);
    expect(FREE_LIMITS.totalBytes).toBe(5_000_000_000);
  });
  it('một kho từ 70% của 1 GB', () => {
    expect(storageWarnings({ ...quiet, owners: [{ name: 'A', sizeBytes: 700_000_000 }] })).toHaveLength(1);
    expect(storageWarnings({ ...quiet, owners: [{ name: 'A', sizeBytes: 699_999_999 }] })).toEqual([]);
    expect(storageWarnings({ ...quiet, owners: [{ name: 'Chủ A', sizeBytes: 0.9 * GB }] })[0]).toContain('Chủ A');
  });
  it('tổng dung lượng từ 70% của 5 GB', () => {
    expect(storageWarnings({ ...quiet, totalBytes: 3_500_000_000 })).toHaveLength(1);
    expect(storageWarnings({ ...quiet, totalBytes: 3_499_999_999 })).toEqual([]);
  });
  it('tổng dòng ghi hôm nay từ 70% của 100.000', () => {
    expect(storageWarnings({ ...quiet, rowsWrittenToday: 70_000 })).toHaveLength(1);
    expect(storageWarnings({ ...quiet, rowsWrittenToday: 69_999 })).toEqual([]);
  });
  it('cộng dồn nhiều cảnh báo', () => {
    expect(storageWarnings({ owners: [{ name: 'A', sizeBytes: GB }], totalBytes: 5 * GB, rowsWrittenToday: 100_000 })).toHaveLength(3);
  });
});

describe.each(BACKENDS)('API kho lưu trữ (%s)', (backend) => {
  beforeAll(async () => {
    await seedWorld(backend);
    for (const [k, p] of Object.entries({ dev: PHONES.developer, owner: PHONES.owner, other: PHONES.otherOwner, manager: PHONES.manager, resident: PHONES.residentLvc })) tokens[k] = await login(p);
  });

  it('chỉ Developer gọi được: 403 cho chủ trọ, quản lý, cư dân; 401 khi chưa đăng nhập', async () => {
    for (const t of [tokens.owner, tokens.other, tokens.manager, tokens.resident]) {
      for (const [m, p] of ROUTES) expect((await api(p, { method: m }, t)).status, p).toBe(403);
    }
    for (const [m, p] of ROUTES) expect((await api(p, { method: m })).status, p).toBe(401);
  });

  it('danh sách có đủ trường mức sử dụng', async () => {
    const body = (await (await api('/api/dev/storage', {}, tokens.dev)).json()) as any;
    expect(body.freeLimits).toEqual(FREE_LIMITS);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body).toHaveProperty('lastReconcile');
    expect(typeof body.totalBytes).toBe('number');
    expect(typeof body.rowsWrittenToday).toBe('number');
    const one = body.owners.find((o: any) => o.ownerId === 1);
    expect(one.backend).toBe(backend);
    if (backend === 'do') expect(one.sizeBytes).toBeGreaterThan(0);
    else expect(one.sizeBytes).toBeNull(); // a store that is not in use is not woken
    expect(body.totalBytes).toBe(body.owners.reduce((n: number, o: any) => n + (o.sizeBytes ?? 0), 0));
  });

  it('lastReconcile đọc từ settings, JSON hỏng thì null', async () => {
    const put = (v: string) => e.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('last_reconcile', ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(v).run();
    await put(JSON.stringify({ ranAt: 'x', indexMismatches: [] }));
    expect(((await (await api('/api/dev/storage', {}, tokens.dev)).json()) as any).lastReconcile).toMatchObject({ ranAt: 'x' });
    await put('{not json');
    expect(((await (await api('/api/dev/storage', {}, tokens.dev)).json()) as any).lastReconcile).toBeNull();
    await e.DB.prepare(`DELETE FROM settings WHERE key = 'last_reconcile'`).run();
    expect(((await (await api('/api/dev/storage', {}, tokens.dev)).json()) as any).lastReconcile).toBeNull();
  });

  it('xuất dữ liệu chỉ chứa dòng của chủ trọ đó', async () => {
    const res = await api('/api/dev/storage/1/export', {}, tokens.dev);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=/);
    const body = (await res.json()) as any;
    expect(body.ownerId).toBe(1);
    expect(typeof body.exportedAt).toBe('string');
    expect(Object.keys(body.tables).sort()).toEqual(['house_rates', 'house_services', 'houses', 'invoice_lines', 'invoices', 'meter_readings', 'notifications', 'payment_gates', 'payments', 'residents', 'room_service_optouts', 'rooms'].sort());
    expect(body.tables.houses.map((h: any) => h.id).sort()).toEqual(['LVC', 'TRUNG_KIM']);
    expect(body.tables.rooms.map((r: any) => r.house_id).every((h: string) => h !== 'NTTD')).toBe(true);
    expect(body.tables.rooms.length).toBe(2);
    expect(body.tables.residents.length).toBe(2);
    expect(JSON.stringify(body)).not.toContain('NTTD');
    const other = (await (await api('/api/dev/storage/4/export', {}, tokens.dev)).json()) as any;
    expect(other.tables.houses.map((h: any) => h.id)).toEqual(['NTTD']);
    expect(other.tables.rooms.length).toBe(2);
    expect(other.tables.residents.length).toBe(0);
  });

  it('xuất dữ liệu: chủ trọ không có thật thì 404', async () => {
    expect((await api('/api/dev/storage/999/export', {}, tokens.dev)).status).toBe(404);
    expect((await api('/api/dev/storage/3/export', {}, tokens.dev)).status).toBe(404); // a Developer is not a landlord
  });

  it('đang chuyển dữ liệu thì xuất trả 409', async () => {
    await setStorage(e.DB, 1, 'migrating', { expect: backend, note: 'test' });
    try {
      const res = await api('/api/dev/storage/1/export', {}, tokens.dev);
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).errorCode).toBe('TENANT_MIGRATING');
    } finally {
      await setStorage(e.DB, 1, backend, { expect: 'migrating', note: 'test' });
    }
  });
});

describe('một kho lỗi không làm hỏng danh sách', () => {
  beforeEach(async () => {
    await seedWorld('do');
    tokens.dev = await login(PHONES.developer);
  });

  it('kho lỗi → trường null và có cảnh báo, kho khác vẫn đọc được', async () => {
    await runIn(tenantStub(e, 4), (_i, state) => state.storage.sql.exec('DROP TABLE meta'));
    try {
      const res = await api('/api/dev/storage', {}, tokens.dev);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const [one, four] = body.owners;
      expect(one.sizeBytes).toBeGreaterThan(0);
      expect(four).toMatchObject({ ownerId: 4, sizeBytes: null, rowsWrittenToday: null, store: null });
      expect(body.warnings.some((w: string) => w.includes('Chủ trọ khác'))).toBe(true);
    } finally {
      await runIn(tenantStub(e, 4), (_i, state) => state.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)'));
    }
  });
});
