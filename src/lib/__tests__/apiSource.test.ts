import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The Zalo SDK needs a real WebView at import time; stub it out for Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'zmp-sdk/apis') {
      return {
        url: 'data:text/javascript,export const nativeStorage={getItem(){},setItem(){},removeItem(){}};',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

console.warn = () => {}; // storage warns when it has to use its memory fallback
// No `window`: storage falls back to its in-memory map, and platform detection reports "browser".
const api = await import('../api');
const { storage, STORAGE_KEYS } = await import('../storage');
const store = {
  set: (k: string, v: string) => storage.setItem(k, v),
  clear: () => {
    storage.removeItem(STORAGE_KEYS.TOKEN);
    storage.removeItem(STORAGE_KEYS.WORKER_TOKEN);
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  store.clear();
  api.resetSource();
});

test('apiFetch retries once on the Worker after Express answers SOURCE_CHANGED', async () => {
  store.set(STORAGE_KEYS.WORKER_TOKEN, 'wtok');
  store.set(STORAGE_KEYS.TOKEN, 'etok');
  const calls: string[] = [];
  let sourceCalls = 0;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/api/source')) {
      sourceCalls++;
      // first probe says sheet (stale), after reset it says worker
      return json(200, { source: sourceCalls === 1 ? 'sheet' : 'worker' });
    }
    if (u.startsWith(api.WORKER_API_URL)) return json(200, { success: true, from: 'worker' });
    return json(409, { success: false, code: 'SOURCE_CHANGED' });
  }) as typeof fetch;

  const res = await api.apiFetch('/api/admin/room-detail', { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, from: 'worker' });
  const workerWrites = calls.filter((u) => u === `${api.WORKER_API_URL}/api/admin/room-detail`);
  assert.equal(workerWrites.length, 1);
});

test('apiFetch does not loop when Worker also says 409', async () => {
  store.set(STORAGE_KEYS.WORKER_TOKEN, 'wtok');
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/api/source')) return json(200, { source: 'sheet' });
    return json(409, { success: false, code: 'SOURCE_CHANGED' });
  }) as typeof fetch;
  const res = await api.apiFetch('/api/admin/room-detail', { method: 'POST', body: '{}' });
  assert.equal(res.status, 409);
  assert.equal(calls.filter((u) => u.endsWith('/api/admin/room-detail')).length, 2);
});

test('ensureSource retries a failed probe when a Worker token exists', async () => {
  store.set(STORAGE_KEYS.WORKER_TOKEN, 'wtok');
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    if (n === 1) throw new Error('timeout');
    return json(200, { source: 'worker' });
  }) as typeof fetch;
  assert.equal(await api.ensureSource(), 'worker');
  assert.equal(n, 2);
});

test('ensureSource without Worker token does not retry', async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    throw new Error('down');
  }) as typeof fetch;
  assert.equal(await api.ensureSource(), 'sheet');
  assert.equal(n, 1);
});
