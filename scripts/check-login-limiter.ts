// Scratch check for the Express login limiter (the root has no test runner). Run: npx tsx scripts/check-login-limiter.ts
import assert from 'node:assert/strict';
import { createLoginLimiter, lockedMessage } from '../src/server/loginLimiter.ts';

let t = 1_000_000;
const lim = createLoginLimiter({ now: () => t });
const K = '0900000001';

for (let i = 0; i < 4; i++) assert.equal(lim.fail(K).locked, false, `failure ${i + 1} does not lock`);
assert.deepEqual(lim.fail(K), { locked: true, minutes: 15 }, '5th failure locks for 15 minutes');
assert.equal(lockedMessage(15), 'Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.');
t += 5 * 60_000 + 30_000;
assert.deepEqual(lim.check(K), { locked: true, minutes: 10 }, 'minutes left, rounded up (9.5 -> 10)');
t += 10 * 60_000;
assert.equal(lim.check(K).locked, false, 'lock expires');
assert.equal(lim.fail(K).locked, false, 'window restarted after expiry');

// success resets
for (let i = 0; i < 3; i++) lim.fail('b');
lim.success('b');
for (let i = 0; i < 4; i++) assert.equal(lim.fail('b').locked, false);

// window expiry
for (let i = 0; i < 4; i++) lim.fail('c');
t += 15 * 60_000 + 1;
assert.equal(lim.fail('c').locked, false, 'old failures stop counting');

// unknown phone is just another key
for (let i = 0; i < 5; i++) lim.fail('0999999999');
assert.equal(lim.check('0999999999').locked, true);

// memory bound
const small = createLoginLimiter({ now: () => t, maxKeys: 10 });
for (let i = 0; i < 100; i++) small.fail('k' + i);
assert.ok(small.size() <= 11, 'map stays bounded');
// a flood of random phones cannot erase a lock
const flood = createLoginLimiter({ now: () => t, maxKeys: 10 });
for (let i = 0; i < 5; i++) flood.fail('victim');
for (let i = 0; i < 200; i++) flood.fail('r' + i);
assert.equal(flood.check('victim').locked, true, 'lock survives eviction');
console.log('login limiter: all checks passed');
