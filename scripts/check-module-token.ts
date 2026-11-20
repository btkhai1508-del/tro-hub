// Scratch check for the Express tiện ích claim (the root has no test runner). Run: npx tsx scripts/check-module-token.ts
import assert from 'node:assert/strict';
import { MODULE_DISABLED_BODY, requireModule, signTenantToken, tokenAllowsModule, verifyTenantToken } from '../src/server/authToken.ts';

// A token with a claim is strict; without one it is allowed (older / sheet-mode tokens).
assert.equal(tokenAllowsModule({ modules: ['invoices', 'laundry'] }, 'laundry'), true);
assert.equal(tokenAllowsModule({ modules: ['invoices'] }, 'laundry'), false);
assert.equal(tokenAllowsModule({ modules: [] }, 'laundry'), false);
assert.equal(tokenAllowsModule({}, 'laundry'), true);
assert.equal(tokenAllowsModule(undefined, 'laundry'), false);

// The claim survives sign / verify.
const t = signTenantToken({ phone: '0900000001', room: 'admin', isAdmin: true, modules: ['meter'] });
assert.deepEqual(verifyTenantToken(t)?.modules, ['meter']);
assert.equal(verifyTenantToken(signTenantToken({ phone: '0900000001', room: '101' }))?.modules, undefined);

// The middleware answers 403 MODULE_DISABLED or calls next.
const run = (modules?: string[]) => {
  let status = 0, body: unknown, nexted = false;
  const res: any = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; } };
  requireModule('laundry')({ tenant: { phone: '', room: '', modules } } as any, res, () => { nexted = true; });
  return { status, body, nexted };
};
assert.deepEqual(run(['meter']), { status: 403, body: MODULE_DISABLED_BODY, nexted: false });
assert.deepEqual(run(['laundry']), { status: 0, body: undefined, nexted: true });
assert.deepEqual(run(undefined), { status: 0, body: undefined, nexted: true });
console.log('module token: all checks passed');
