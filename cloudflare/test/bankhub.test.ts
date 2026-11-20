import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { bankHubClient, resetBankHubTokenCache } from '../src/bankhub.ts';
import { setStorage } from '../src/central/directory.ts';
import { replayDeferred } from '../src/payments/settle.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld, type BackendName } from './helpers.ts';

const e = env as unknown as Env;
const ee = e as any;
const MONTH = '2026-11';
const IPN_KEY = 'bankhub-ipn-key-123';
const LVC_CODE = '002101112026'; // house 002 (LVC, landlord 1), room 101, 11/2026, rent 3.500.000
const TK_CODE = '001101112026'; // house 001 (landlord 1)
const NTTD_CODE = '003101112026'; // house 003 (landlord 4)
const XID_A = '11111111-aaaa-4aaa-8aaa-111111111111'; // landlord 1's linked account
const XID_B = '22222222-bbbb-4bbb-8bbb-222222222222'; // landlord 4's linked account
const CO_A = 'c0000000-0000-4000-8000-00000000000a';
const realFetch = globalThis.fetch;

interface Call { url: string; method: string; auth: string | null; body: any }
let calls: Call[] = [];
let tokenCounter = 0;
let unauthorizedOnce = false;
/** Answers Bank Hub API calls like the documented sandbox; any other URL goes to the real fetch (the Worker's own SELF calls). */
function mockBankHub(over: { companyStatus?: number; accounts?: any[] } = {}) {
  calls = []; tokenCounter = 0; unauthorizedOnce = false;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('https://bankhub-api-sandbox.sepay.vn')) return realFetch(input, init);
    const path = url.slice('https://bankhub-api-sandbox.sepay.vn'.length);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/v1/token') return json(201, { code: 201, access_token: `tok-${++tokenCounter}`, ttl: 3600 });
    if (unauthorizedOnce) { unauthorizedOnce = false; return json(401, { code: 401, message: 'Unauthenticated' }); }
    if (path === '/v1/company/create') return json(over.companyStatus ?? 201, { code: 201, message: 'ok', data: { xid: CO_A, full_name: JSON.parse(String(init!.body)).full_name } });
    if (path === '/v1/link-token/create')
      return json(201, { xid: 'lt-xid-1', hosted_link_url: 'https://hosted.sandbox.example/link/abc', link_token: 'lt-token-1', expires_at: '2026-11-20 10:00:00' });
    if (path.startsWith('/v1/bank-account'))
      return json(200, { data: over.accounts ?? [], meta: { per_page: 100, total: (over.accounts ?? []).length, has_more: false, current_page: 1, page_count: 1 } });
    return json(404, { code: 404, message: 'Resource not found' });
  }) as typeof fetch;
}

const clearBankHub = () => e.DB.batch([
  e.DB.prepare(`DELETE FROM bankhub_companies`), e.DB.prepare(`DELETE FROM bankhub_accounts`), e.DB.prepare(`DELETE FROM bankhub_link_tokens`),
  e.DB.prepare(`DELETE FROM sepay_events`), e.DB.prepare(`DELETE FROM unassigned_payments`), e.DB.prepare(`DELETE FROM audit_log`),
]);

function configure(on: boolean) {
  ee.BANKHUB_BASE = on ? 'https://bankhub-api-sandbox.sepay.vn' : undefined;
  ee.BANKHUB_CLIENT_ID = on ? 'test-client' : undefined;
  ee.BANKHUB_CLIENT_SECRET = on ? 'test-secret' : undefined;
  ee.BANKHUB_IPN_KEY = on ? IPN_KEY : undefined;
}

afterEach(() => { globalThis.fetch = realFetch; configure(false); resetBankHubTokenCache(); });

const post = (path: string, body: unknown, headers: Record<string, string> = {}, token?: string) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, token);

let seq = 0;
const ipn = async (over: Record<string, unknown>, key: string | null = IPN_KEY) => {
  const res = await post('/api/bankhub/ipn', {
    gateway: 'MBBank', transaction_date: '2026-11-17 20:10:00', account_number: '0123456789', bank_account_xid: XID_A, va: null, payment_code: null,
    content: 'x', transfer_type: 'credit', amount: 0, reference_code: `FT${++seq}`, accumulated: 0, transaction_id: `tx-${seq}`, ...over,
  }, key === null ? {} : { Authorization: `Apikey ${key}` });
  return { status: res.status, body: (await res.json()) as any };
};

describe('Bank Hub: client', () => {
  beforeEach(() => { resetBankHubTokenCache(); configure(true); });

  it('gets a token with Basic auth, caches it, and refreshes once on a 401', async () => {
    mockBankHub();
    const client = bankHubClient(e);
    await client.listBankAccounts(CO_A);
    await client.listBankAccounts(CO_A);
    expect(calls.filter((c) => c.url.endsWith('/v1/token'))).toHaveLength(1);
    expect(calls[0].auth).toBe(`Basic ${btoa('test-client:test-secret')}`);
    expect(calls[1].auth).toBe('Bearer tok-1');
    expect(calls[1].url).toContain(`company_xid=${CO_A}`);
    unauthorizedOnce = true;
    await client.listBankAccounts(CO_A);
    expect(calls.filter((c) => c.url.endsWith('/v1/token'))).toHaveLength(2);
    expect(calls.at(-1)!.auth).toBe('Bearer tok-2');
  });

  it('gives up after one refresh when the API keeps answering 401', async () => {
    let n = 0;
    const fetchImpl = async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/token') ? { access_token: `t${++n}`, ttl: 3600 } : { code: 401 }), { status: url.endsWith('/v1/token') ? 201 : 401 });
    await expect(bankHubClient(e, fetchImpl).listBankAccounts(CO_A)).rejects.toMatchObject({ status: 401 });
    expect(n).toBe(2);
  });

  it('sends the documented link-token body', async () => {
    mockBankHub();
    const t = await bankHubClient(e).createLinkToken(CO_A, { completionRedirectUri: 'https://x.example/done' });
    expect(t.hostedLinkUrl).toBe('https://hosted.sandbox.example/link/abc');
    expect(calls.at(-1)!.body).toEqual({ company_xid: CO_A, purpose: 'LINK_BANK_ACCOUNT', language: 'vi', completion_redirect_uri: 'https://x.example/done' });
  });
});

describe('Bank Hub: fail closed when not configured', () => {
  beforeEach(async () => { await seedWorld('d1'); await clearBankHub(); configure(false); });

  it('Developer routes answer 503 and the public routes reject', async () => {
    const dev = await login(PHONES.developer);
    for (const p of ['company', 'link-token', 'sync']) {
      const r = await post(`/api/dev/landlords/1/bankhub/${p}`, {}, {}, dev);
      expect(r.status).toBe(503);
      expect(((await r.json()) as any).errorCode).toBe('BANKHUB_NOT_CONFIGURED');
    }
    const status = await api('/api/dev/bankhub', {}, dev);
    expect(((await status.json()) as any)).toMatchObject({ success: true, configured: false });
    expect((await post('/api/bankhub/ipn', { transfer_type: 'credit', transaction_id: 'a' }, { Authorization: 'Apikey anything' })).status).toBe(401);
    expect((await post('/api/bankhub/ipn', { transfer_type: 'credit', transaction_id: 'a' }, { Authorization: 'Apikey ' })).status).toBe(401);
    expect((await post('/api/bankhub/events', { event: 'BANK_ACCOUNT_LINKED' }, { Authorization: 'Apikey anything' })).status).toBe(401);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM sepay_events`).first<{ n: number }>())!.n).toBe(0);
  });
});

describe('Bank Hub: Developer routes', () => {
  let dev: string;
  beforeEach(async () => {
    await seedWorld('d1'); await clearBankHub(); configure(true); mockBankHub();
    dev = await login(PHONES.developer);
  });

  it('only the Developer: 403 for owner, manager and resident, 401 anonymous', async () => {
    const paths = ['/api/dev/bankhub', '/api/dev/landlords/1/bankhub/company', '/api/dev/landlords/1/bankhub/link-token', '/api/dev/landlords/1/bankhub/sync'];
    for (const who of [PHONES.owner, PHONES.manager, PHONES.residentTk]) {
      const t = await login(who);
      for (const p of paths) {
        const res = p === paths[0] ? await api(p, {}, t) : await post(p, {}, {}, t);
        expect(res.status, `${who} ${p}`).toBe(403);
      }
    }
    for (const p of paths) {
      const res = p === paths[0] ? await api(p) : await post(p, {});
      expect(res.status, p).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('creates the company once (idempotent) with the landlord name', async () => {
    const a = await (await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev)).json() as any;
    expect(a).toMatchObject({ success: true, created: true, company: { xid: CO_A, status: 'Active' } });
    const b = await (await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev)).json() as any;
    expect(b).toMatchObject({ success: true, created: false, company: { xid: CO_A } });
    const create = calls.filter((c) => c.url.endsWith('/v1/company/create'));
    expect(create).toHaveLength(1);
    expect(create[0].body).toMatchObject({ status: 'Active' });
    expect(create[0].body.full_name).toContain('Chủ trọ');
    expect((await post('/api/dev/landlords/2/bankhub/company', {}, {}, dev)).status).toBe(404); // a manager is not a landlord
    expect((await e.DB.prepare(`SELECT action FROM audit_log WHERE action = 'bankhub_company_created'`).all()).results).toHaveLength(1);
  });

  it('link-token needs a company, then returns the hosted URL and remembers whose it is', async () => {
    expect((await post('/api/dev/landlords/1/bankhub/link-token', {}, {}, dev)).status).toBe(409);
    await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev);
    const r = await (await post('/api/dev/landlords/1/bankhub/link-token', {}, {}, dev)).json() as any;
    expect(r).toEqual({ success: true, hostedLinkUrl: 'https://hosted.sandbox.example/link/abc', expiresAt: '2026-11-20 10:00:00' });
    expect((await e.DB.prepare(`SELECT link_token_xid, owner_id FROM bankhub_link_tokens ORDER BY link_token_xid`).all<any>()).results)
      .toEqual([{ link_token_xid: 'lt-token-1', owner_id: 1 }, { link_token_xid: 'lt-xid-1', owner_id: 1 }]);
    expect(JSON.stringify((await e.DB.prepare(`SELECT * FROM audit_log`).all()).results)).not.toContain('hosted.sandbox.example');
  });

  it('sync reads the accounts into bankhub_accounts and never takes over another landlord\'s account', async () => {
    await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev);
    await e.DB.prepare(`INSERT INTO bankhub_accounts (bank_account_xid, owner_id, status) VALUES (?, 4, 'active')`).bind(XID_B).run();
    mockBankHub({ accounts: [
      { xid: XID_A, company_xid: CO_A, brand_name: 'MBBank', account_holder_name: 'NGUYEN VAN A', account_number: '0123456789', active: '1' },
      { xid: XID_B, company_xid: CO_A, brand_name: 'ACB', account_number: '9999', active: '1' },
    ] });
    const r = await (await post('/api/dev/landlords/1/bankhub/sync', {}, {}, dev)).json() as any;
    expect(r).toMatchObject({ success: true, count: 2, skipped: 1 });
    const rows = (await e.DB.prepare(`SELECT bank_account_xid, owner_id, bank, status FROM bankhub_accounts ORDER BY owner_id`).all<any>()).results;
    expect(rows).toEqual([{ bank_account_xid: XID_A, owner_id: 1, bank: 'MBBank', status: 'active' }, { bank_account_xid: XID_B, owner_id: 4, bank: null, status: 'active' }]);
    const view = await (await api('/api/dev/bankhub', {}, dev)).json() as any;
    expect(view.landlords[1].accounts[0].accountMasked).toBe('•••• 6789');
    expect(JSON.stringify(view)).not.toContain('0123456789');
  });
});

describe('Bank Hub: link events', () => {
  beforeEach(async () => {
    await seedWorld('d1'); await clearBankHub(); configure(true); mockBankHub();
    const dev = await login(PHONES.developer);
    await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev);
    await post('/api/dev/landlords/1/bankhub/link-token', {}, {}, dev);
  });
  const event = (event: string, metadata: Record<string, unknown>, headers: Record<string, string> = { Authorization: `Apikey ${IPN_KEY}` }) =>
    post('/api/bankhub/events', { timestamp: 1, xid: 'e1', version: '1.0', event, metadata }, headers);

  it('rejects a wrong or missing key', async () => {
    expect((await event('BANK_ACCOUNT_LINKED', { bank_account_xid: XID_A, link_token_xid: 'lt-xid-1' }, { Authorization: 'Apikey nope' })).status).toBe(401);
    expect((await event('BANK_ACCOUNT_LINKED', { bank_account_xid: XID_A, link_token_xid: 'lt-xid-1' }, {})).status).toBe(401);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM bankhub_accounts`).first<{ n: number }>())!.n).toBe(0);
  });

  it('link, unlink and reactivate upsert the account; the secret may also come as X-Secret-Key', async () => {
    const linked = { bank_account_xid: XID_A, brand_name: 'MBBank', account_number: '0123456789', link_token_xid: 'lt-xid-1' };
    expect((await event('BANK_ACCOUNT_LINKED', linked)).status).toBe(200);
    const row = () => e.DB.prepare(`SELECT owner_id, company_xid, bank, account_number, status FROM bankhub_accounts WHERE bank_account_xid = ?`).bind(XID_A).first<any>();
    expect(await row()).toEqual({ owner_id: 1, company_xid: CO_A, bank: 'MBBank', account_number: '0123456789', status: 'active' });
    expect((await event('BANK_ACCOUNT_INACTIVATED', { bank_account_xid: XID_A }, { 'X-Secret-Key': IPN_KEY })).status).toBe(200);
    expect((await row())!.status).toBe('inactive');
    await event('BANK_ACCOUNT_UNLINKED', { bank_account_xid: XID_A });
    expect((await row())!.status).toBe('unlinked');
    await event('BANK_ACCOUNT_REACTIVATED', { bank_account_xid: XID_A });
    expect((await row())!.status).toBe('active');
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'bankhub_bank_account_%'`).first<{ n: number }>())!.n).toBe(4);
  });

  it('progress events are acknowledged; an account with an unknown link token is not guessed', async () => {
    expect(((await (await event('LINK_SESSION_INITIALIZED', { link_token_xid: 'lt-xid-1' })).json()) as any).ignored).toBe('LINK_SESSION_INITIALIZED');
    const r = await (await event('BANK_ACCOUNT_LINKED', { bank_account_xid: XID_B, link_token_xid: 'someone-elses' })).json() as any;
    expect(r).toEqual({ success: true, ignored: 'unmapped' });
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM bankhub_accounts`).first<{ n: number }>())!.n).toBe(0);
  });

  it('a link event cannot move an account to another landlord', async () => {
    await e.DB.prepare(`INSERT INTO bankhub_accounts (bank_account_xid, owner_id, status) VALUES (?, 4, 'active')`).bind(XID_B).run();
    const r = await (await event('BANK_ACCOUNT_LINKED', { bank_account_xid: XID_B, link_token_xid: 'lt-xid-1' })).json() as any;
    expect(r.ignored).toBe('owner_mismatch');
    expect((await e.DB.prepare(`SELECT owner_id FROM bankhub_accounts WHERE bank_account_xid = ?`).bind(XID_B).first<any>())!.owner_id).toBe(4);
  });
});

type Mode = BackendName | 'migrating';
const MODES: Mode[] = [...BACKENDS, 'migrating'];

describe.each(MODES)('Bank Hub: balance-change IPN (%s)', (mode) => {
  const backend: BackendName = mode === 'do' ? 'do' : 'd1';
  const storeOf = async (owner = 1) => (backend === 'do' ? tenantOfOwner(e, owner) : e.DB);
  const payments = async (owner = 1) => (await (await storeOf(owner)).prepare(`SELECT house_id, invoice_id, amount, reference FROM payments ORDER BY id`).all<any>()).results;
  const lvcInvoice = async () => (await storeOf()).prepare(`SELECT status FROM invoices WHERE room_id = 3 AND month = ?`).bind(MONTH).first<{ status: string }>();
  const events = async () => (await e.DB.prepare(`SELECT sepay_id, kind, status, house_id, owner_id FROM sepay_events ORDER BY rowid`).all<any>()).results;

  beforeEach(async () => {
    await seedWorld(backend); await clearBankHub(); configure(true);
    for (const owner of [1, 4]) await (await storeOf(owner)).prepare(`UPDATE rooms SET pay_no = CAST(name AS INTEGER)`).run();
    await e.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(`legacy_sync:${MONTH}`, new Date().toISOString()).run();
    await e.DB.batch([
      e.DB.prepare(`INSERT INTO bankhub_accounts (bank_account_xid, owner_id, status, account_number) VALUES (?, 1, 'active', '0123456789')`).bind(XID_A),
      e.DB.prepare(`INSERT INTO bankhub_accounts (bank_account_xid, owner_id, status, account_number) VALUES (?, 4, 'active', '9876543210')`).bind(XID_B),
    ]);
    if (mode === 'migrating') await setStorage(e.DB, 1, 'migrating');
  });

  it('wrong or missing key: 401, key unset rejects everything', async () => {
    expect((await ipn({ amount: 3_500_000, content: LVC_CODE }, 'wrong')).status).toBe(401);
    expect((await ipn({ amount: 3_500_000, content: LVC_CODE }, null)).status).toBe(401);
    configure(false);
    expect((await ipn({ amount: 3_500_000, content: LVC_CODE }, IPN_KEY)).status).toBe(401);
    expect(await events()).toEqual([]);
    expect(await payments()).toEqual([]);
  });

  it('a debit is acknowledged and ignored', async () => {
    const r = await ipn({ transfer_type: 'debit', amount: 3_500_000, content: LVC_CODE });
    expect(r).toEqual({ status: 200, body: { success: true, ignored: 'debit' } });
    expect(await events()).toEqual([]);
  });

  it('a credit with a valid pay code books the right room for the right landlord', async () => {
    const r = await ipn({ amount: 3_500_000, content: `CHUYEN TIEN ${LVC_CODE}` });
    expect(r).toMatchObject({ status: 200, body: { success: true, kind: 'rent', houseId: 'LVC', room: '101', month: MONTH } });
    if (mode === 'migrating') {
      expect(await payments('d1' as any)).toEqual([]);
      expect(await events()).toMatchObject([{ sepay_id: 'bh-sbx-tx-' + seq, kind: 'rent', status: 'deferred', house_id: 'LVC', owner_id: 1 }]);
      expect((await lvcInvoice())!.status).toBe('unpaid');
      // When the move ends the cron replay books it exactly once.
      await setStorage(e.DB, 1, 'd1');
      expect(await replayDeferred(e, 1)).toBe(1);
      expect(await replayDeferred(e, 1)).toBe(0);
      expect(await payments()).toMatchObject([{ house_id: 'LVC', amount: 3_500_000, reference: `sepay-bh-sbx-tx-${seq}` }]);
    } else {
      expect(await payments()).toMatchObject([{ house_id: 'LVC', amount: 3_500_000 }]);
      expect(await events()).toMatchObject([{ kind: 'rent', status: 'done', house_id: 'LVC', owner_id: 1 }]);
    }
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(0);
    expect((await lvcInvoice())!.status).toBe('paid');
    if (mode !== 'migrating') expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bankhub_ipn_settled'`).first<{ n: number }>())!.n).toBe(1);
  });

  it('migrating: a deferred credit is counted by the status API until it is booked', async () => {
    if (mode !== 'migrating') return;
    await ipn({ amount: 3_500_000, content: LVC_CODE });
    const owner = await login(PHONES.owner);
    const res = await api(`/api/payment/status?month=11/2026&room=LVC-101`, {}, owner);
    expect(((await res.json()) as any).paymentStatus).toBe('paid');
  });

  it('a code of landlord B on landlord A\'s account never settles B, and the other way round', async () => {
    const r1 = await ipn({ amount: 2_500_000, content: NTTD_CODE });
    expect(r1.body).toMatchObject({ success: true, unassigned: true });
    const r2 = await ipn({ amount: 3_000_000, content: TK_CODE, bank_account_xid: XID_B, account_number: '9876543210' });
    expect(r2.body).toMatchObject({ success: true, unassigned: true });
    expect(await payments(1)).toEqual([]);
    expect(await payments(4)).toEqual([]);
    expect((await events()).map((x) => [x.kind, x.house_id, x.owner_id])).toEqual([['none', null, 1], ['none', null, 4]]);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(2);
    // The same code on its own landlord's account does settle.
    await (await storeOf(4)).prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, status, issued_at) VALUES ('NTTD', 5, ?, 2500000, 2500000, 'unpaid', '2026-11-01 00:00:00')`).bind(MONTH).run();
    const ok = await ipn({ amount: 2_500_000, content: NTTD_CODE, bank_account_xid: XID_B, account_number: '9876543210' });
    expect(ok.body).toMatchObject({ kind: 'rent', houseId: 'NTTD' });
    if (mode !== 'migrating') expect(await payments(4)).toMatchObject([{ house_id: 'NTTD', amount: 2_500_000 }]);
  });

  it('an unknown bank_account_xid is not settled', async () => {
    const r = await ipn({ amount: 3_500_000, content: LVC_CODE, bank_account_xid: 'ffffffff-0000-4000-8000-000000000000' });
    expect(r).toEqual({ status: 200, body: { success: true, ignored: 'unknown_account', unassigned: true } });
    // Kept in the same unassigned-payments mechanism as the SePay webhook, for a hand assignment.
    expect((await e.DB.prepare(`SELECT amount, account_no, sepay_id FROM unassigned_payments`).all<any>()).results)
      .toEqual([{ amount: 3_500_000, account_no: '0123456789', sepay_id: `bh-sbx-tx-${seq}` }]);
    expect(await payments()).toEqual([]);
    expect((await lvcInvoice())!.status).toBe('unpaid');
    expect(await events()).toMatchObject([{ kind: 'none', owner_id: null }]);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bankhub_ipn_unknown_account'`).first<{ n: number }>())!.n).toBe(1);
    const missing = await ipn({ amount: 3_500_000, content: LVC_CODE, bank_account_xid: undefined });
    expect(missing.body.ignored).toBe('unknown_account');
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM unassigned_payments`).first<{ n: number }>())!.n).toBe(2);
  });

  it('the same transaction_id books once', async () => {
    const one = { transaction_id: 'dup-1', amount: 3_500_000, content: LVC_CODE };
    expect((await ipn(one)).body).toMatchObject({ kind: 'rent' });
    expect((await ipn(one)).body).toEqual({ success: true, ignored: 'duplicate' });
    expect(await events()).toHaveLength(1);
    if (mode !== 'migrating') expect(await payments()).toHaveLength(1);
  });

  it('partial and over payments behave like the SePay webhook', async () => {
    if (mode === 'migrating') return;
    await ipn({ amount: 1_000_000, content: LVC_CODE });
    expect((await lvcInvoice())!.status).toBe('unpaid');
    await ipn({ amount: 2_499_999, content: LVC_CODE });
    expect((await lvcInvoice())!.status).toBe('unpaid');
    await ipn({ amount: 1, content: LVC_CODE });
    expect((await lvcInvoice())!.status).toBe('paid');
    expect(await payments()).toHaveLength(3);
    await ipn({ amount: 4_000_000, content: LVC_CODE }); // over: recorded, invoice stays paid
    expect((await lvcInvoice())!.status).toBe('paid');
    expect(await payments()).toHaveLength(4);
  });

  it('VietinBank SEVQR prefix and a code split by spaces still match', async () => {
    const r = await ipn({ amount: 3_500_000, content: 'SEVQR 002 101 11 2026 chuyen tien phong' });
    expect(r.body).toMatchObject({ kind: 'rent', houseId: 'LVC', room: '101', month: MONTH });
    const r2 = await ipn({ amount: 100, content: `SEVQR${LVC_CODE}` });
    expect(r2.body).toMatchObject({ kind: 'rent', houseId: 'LVC' });
  });

  it('a content with no code is kept as unassigned for that landlord', async () => {
    const r = await ipn({ amount: 500_000, content: 'tien an trua' });
    expect(r.body).toEqual({ success: true, unassigned: true });
    expect(await events()).toMatchObject([{ kind: 'none', owner_id: 1 }]);
    expect(await payments()).toEqual([]);
  });

  it('rejects amounts that are not a positive whole number of đồng: 200 ignored, audited, never booked', async () => {
    for (const amount of [-3_500_000, 0, 'abc', '3500000', 1e30, 1.5, null, 100_000_000_001, Number.NaN]) {
      const r = await ipn({ amount, content: LVC_CODE });
      expect(r, String(amount)).toEqual({ status: 200, body: { success: true, ignored: 'bad_amount' } });
    }
    expect(await events()).toEqual([]);
    expect(await payments()).toEqual([]);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bankhub_ipn_bad_amount'`).first<{ n: number }>())!.n).toBe(9);
    expect((await ipn({ amount: 100_000_000_000, content: 'tien an' })).body).toEqual({ success: true, unassigned: true }); // the cap itself is allowed
  });

  it('a failure after the event is stored still answers 200 and keeps the money for hand assignment', async () => {
    await e.DB.prepare(`ALTER TABLE bankhub_accounts RENAME TO bankhub_accounts_off`).run();
    try {
      const r = await ipn({ amount: 3_500_000, content: LVC_CODE });
      expect(r).toEqual({ status: 200, body: { success: true, deferred: true } });
    } finally {
      await e.DB.prepare(`ALTER TABLE bankhub_accounts_off RENAME TO bankhub_accounts`).run();
    }
    expect(await payments()).toEqual([]);
    expect((await e.DB.prepare(`SELECT amount FROM unassigned_payments`).all<any>()).results).toEqual([{ amount: 3_500_000 }]);
    expect(await events()).toMatchObject([{ kind: 'none', status: 'done' }]);
    expect((await ipn({ amount: 3_500_000, content: LVC_CODE, transaction_id: `tx-${seq}` })).body.ignored).toBe('duplicate');
  });

  it('old-style codes stay inside the account owner\'s houses (room 102 exists only at landlord 4)', async () => {
    // Landlord 4's house declares the very account number landlord 1's linked account reports.
    await (await storeOf(4)).prepare(`UPDATE houses SET bank_account_no = '0123456789' WHERE id = 'NTTD'`).run();
    const r = await ipn({ amount: 2_500_000, content: '102-T11-2026' });
    expect(r.body).toEqual({ success: true, unassigned: true });
    expect(await payments(4)).toEqual([]);
    expect(await payments(1)).toEqual([]);
    // On landlord 4's own account the same code books his house.
    const ok = await ipn({ amount: 2_500_000, content: '102-T11-2026', bank_account_xid: XID_B, account_number: '0123456789' });
    expect(ok.body).toMatchObject({ kind: 'rent', houseId: 'NTTD', room: '102' });
  });
});

describe('Bank Hub: base URL, id namespaces, probes', () => {
  beforeEach(async () => { await seedWorld('d1'); await clearBankHub(); });

  it('BANKHUB_BASE must be https on sepay.vn; otherwise the feature stays off and no credentials are sent', async () => {
    configure(true);
    mockBankHub();
    const dev = await login(PHONES.developer);
    for (const bad of ['http://bankhub-api-sandbox.sepay.vn', 'https://evil.example', 'https://sepay.vn.evil.example', 'https://user@bankhub-api.sepay.vn.evil.com', 'http://localhost:8787', 'not a url']) {
      ee.BANKHUB_BASE = bad;
      const r = await post('/api/dev/landlords/1/bankhub/company', {}, {}, dev);
      expect(r.status, bad).toBe(503);
    }
    expect(calls).toHaveLength(0);
    ee.BANKHUB_BASE = 'http://localhost:8787';
    ee.BANKHUB_ALLOW_LOCAL = '1';
    expect(((await (await api('/api/dev/bankhub', {}, dev)).json()) as any).configured).toBe(true);
    ee.BANKHUB_ALLOW_LOCAL = undefined;
    ee.BANKHUB_BASE = 'https://bankhub-api.sepay.vn';
    expect(((await (await api('/api/dev/bankhub', {}, dev)).json()) as any).configured).toBe(true);
  });

  it('sandbox and production transaction ids do not collide', async () => {
    configure(true);
    await e.DB.prepare(`INSERT INTO bankhub_accounts (bank_account_xid, owner_id, status) VALUES (?, 1, 'active')`).bind(XID_A).run();
    await ipn({ transaction_id: 'same', amount: 100, content: 'a' });
    ee.BANKHUB_BASE = 'https://bankhub-api.sepay.vn';
    expect((await ipn({ transaction_id: 'same', amount: 100, content: 'a' })).body).not.toMatchObject({ ignored: 'duplicate' });
    expect((await e.DB.prepare(`SELECT sepay_id FROM sepay_events ORDER BY rowid`).all<any>()).results.map((r) => r.sepay_id)).toEqual(['bh-sbx-same', 'bh-same']);
  });

  it('with the key unset a probe is rejected without writing an audit row', async () => {
    configure(false);
    await e.DB.prepare(`DELETE FROM audit_log`).run();
    expect((await post('/api/bankhub/ipn', {}, { Authorization: 'Apikey x' })).status).toBe(401);
    expect((await post('/api/bankhub/events', {}, { Authorization: 'Apikey x' })).status).toBe(401);
    expect((await e.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log`).first<{ n: number }>())!.n).toBe(0);
  });
});
