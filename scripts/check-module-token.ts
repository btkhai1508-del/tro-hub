// Scratch check for the Express tiện ích claim (the root has no test runner). Run: npx tsx scripts/check-module-token.ts
import assert from 'node:assert/strict';
import { MODULE_DISABLED_BODY, signTenantToken, tokenAllowsModule, verifyTenantToken } from '../src/server/authToken.ts';
import { createModuleGate } from '../src/server/moduleGate.ts';

// A token with a claim is strict; without one it is allowed (older / sheet-mode tokens).
assert.equal(tokenAllowsModule({ modules: ['invoices', 'laundry'] }, 'laundry'), true);
assert.equal(tokenAllowsModule({ modules: ['invoices'] }, 'laundry'), false);
assert.equal(tokenAllowsModule({ modules: [] }, 'laundry'), false);
assert.equal(tokenAllowsModule({}, 'laundry'), true);
assert.equal(tokenAllowsModule(undefined, 'laundry'), false);

// The claim survives sign / verify.
const signed = signTenantToken({ phone: '0900000001', room: 'admin', isAdmin: true, modules: ['meter'] });
assert.deepEqual(verifyTenantToken(signed)?.modules, ['meter']);
assert.equal(verifyTenantToken(signTenantToken({ phone: '0900000001', room: '101' }))?.modules, undefined);

// Live gate: Worker answer cached 60 s, so enabling / revoking shows within a minute.
let t = 0, calls = 0, mode: 'ok' | '401' | 'down' = 'ok', list = ['invoices'];
const gate = createModuleGate('http://worker', {
  now: () => t, warn: () => {},
  fetchImpl: async () => {
    calls++;
    if (mode === 'down') throw new Error('down');
    return { ok: mode === 'ok', status: mode === 'ok' ? 200 : 401, json: async () => ({ success: true, modules: list }) };
  },
});
const tok = { phone: '', room: '', wt: 'worker-token', modules: ['invoices', 'laundry'] };
(async () => {
  assert.equal(await gate.check(tok, 'laundry'), 'disabled', 'live list wins over the stale claim');
  list = ['invoices', 'laundry'];
  assert.equal(await gate.check(tok, 'laundry'), 'disabled', 'cached within 60 s');
  assert.equal(calls, 1);
  t += 61_000;
  assert.equal(await gate.check(tok, 'laundry'), 'allowed', 'enabled tool works after the TTL');
  list = ['invoices'];
  t += 61_000;
  assert.equal(await gate.check(tok, 'laundry'), 'disabled', 'revoked tool stops after the TTL');
  mode = 'down'; t += 61_000;
  assert.equal(await gate.check(tok, 'laundry'), 'allowed', 'Worker unreachable: falls back to the claim');
  assert.equal(await gate.check({ ...tok, modules: ['invoices'] }, 'laundry'), 'disabled', 'fallback claim is strict');
  assert.equal(await gate.check({ phone: '', room: '', wt: 'x' }, 'laundry'), 'allowed', 'no claim, Worker down: allowed (logged)');
  mode = '401'; t += 61_000;
  assert.equal(await gate.check(tok, 'laundry'), 'expired', 'Worker session over');
  assert.equal(await gate.check({ phone: '', room: '', modules: ['laundry'] }, 'laundry'), 'allowed', 'no wt: claim');
  assert.equal(await gate.check({ phone: '', room: '', modules: [] }, 'laundry'), 'disabled');
  assert.equal(await gate.check({ phone: '', room: '' }, 'laundry'), 'allowed', 'no wt, no claim: allowed');
  console.log('module token + live gate: all checks passed');
})();
