import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseIdCache, registerAdminRefresh, refreshRooms, refreshBilling, refreshDashboard, refreshGate } from '../adminRefresh';

test('house cache is per token and never keeps an empty list', () => {
  const c = createHouseIdCache();
  assert.equal(c.get('a'), null);
  c.set('a', []);
  assert.equal(c.get('a'), null);
  c.set('a', ['X', 'Y']);
  assert.deepEqual(c.get('a'), ['X', 'Y']);
  assert.equal(c.get('b'), null);
  c.clear();
  assert.equal(c.get('a'), null);
});

test('refresh functions reach the registered screen only while it is open', () => {
  const calls: string[] = [];
  const off = registerAdminRefresh({
    rooms: (m) => calls.push('rooms:' + m),
    billing: (m) => calls.push('billing:' + m),
    dashboard: (m) => calls.push('dashboard:' + m),
    gate: (m) => calls.push('gate:' + m),
  });
  refreshRooms('2026-11'); refreshBilling('2026-11'); refreshDashboard('2026-11'); refreshGate('2026-11');
  assert.deepEqual(calls, ['rooms:2026-11', 'billing:2026-11', 'dashboard:2026-11', 'gate:2026-11']);
  off();
  refreshRooms('2026-11');
  assert.equal(calls.length, 4);
});
