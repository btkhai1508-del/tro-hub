/**
 * SePay Bank Hub (sandbox trial). Developer routes create a landlord's Bank Hub company, hand out the
 * Hosted Link and re-read the linked accounts; two public routes, protected by the Apikey SePay sends
 * (BANKHUB_IPN_KEY), receive link events and balance-change IPNs. An IPN settles rent through the same
 * pay-code matching and settle/defer/unassigned path as the SePay webhook, restricted to the houses of
 * the landlord who owns the bank account. The feature is off (everything fails closed) while unset.
 */
import type { Context, Hono } from 'hono';
import { audit, developerOnly, fail, type App } from '../app.ts';
import { getStorage } from '../central/directory.ts';
import { BankHubError, bankHubBase, bankHubClient, bankHubConfigured, type BankHubAccount } from '../bankhub.ts';
import { deferRent, recordUnassigned, settleRent, unassignedStatement, type SepayTransfer } from '../payments/settle.ts';
import { TenantLockedError } from '../tenant/route.ts';
import { requireAuth } from './auth.ts';
import { sha256Hex } from './billing.ts';
import { findPayCode, houseForRent, parseRentCode } from './sepay.ts';

/** Constant-time check of the Apikey SePay sends. An unset key rejects everything. */
async function sameSecret(sent: string, expected: string | undefined): Promise<boolean> {
  if (!expected || !sent) return false;
  const a = await sha256Hex(sent);
  const b = await sha256Hex(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** IPNs carry "Authorization: Apikey <key>"; link events may carry the webhook secret as X-Secret-Key (same value). */
async function authorized(c: Context<App>): Promise<boolean> {
  const bearer = (c.req.header('Authorization') ?? '').replace(/^Apikey\s+/i, '').trim();
  const secret = (c.req.header('X-Secret-Key') ?? '').trim();
  const key = c.env.BANKHUB_IPN_KEY;
  return (await sameSecret(bearer, key)) || (await sameSecret(secret, key));
}

const notConfigured = (c: Context<App>) => fail(c, 503, 'BANKHUB_NOT_CONFIGURED', 'Chưa cài đặt SePay Bank Hub (BANKHUB_CLIENT_ID / BANKHUB_CLIENT_SECRET).');
const upstream = (c: Context<App>, e: unknown) => {
  if (!(e instanceof BankHubError)) throw e;
  console.warn('[bankhub] api', e.status);
  return fail(c, e.status === 503 ? 503 : 502, 'BANKHUB_ERROR', `Bank Hub báo lỗi (${e.status}). Thử lại sau.`);
};

const maskAccount = (n: string | null) => (n ? `•••• ${n.slice(-4)}` : null);
const ownerExists = async (db: D1Database, id: number) =>
  db.prepare(`SELECT full_name FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first<{ full_name: string }>();

interface AccountRow { bank_account_xid: string; owner_id: number; company_xid: string | null; bank: string | null; account_number: string | null; account_name: string | null; status: string; linked_at: string; updated_at: string }

/** Upserts an account for an owner; an account that already belongs to another landlord is never taken over. Returns false then. */
async function upsertAccount(
  db: D1Database, ownerId: number,
  a: { xid: string; companyXid: string | null; bank: string | null; accountNumber: string | null; accountName: string | null; status: string },
): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO bankhub_accounts (bank_account_xid, owner_id, company_xid, bank, account_number, account_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (bank_account_xid) DO UPDATE SET
       company_xid = COALESCE(bankhub_accounts.company_xid, excluded.company_xid),
       bank = COALESCE(excluded.bank, bankhub_accounts.bank),
       account_number = COALESCE(excluded.account_number, bankhub_accounts.account_number),
       account_name = COALESCE(excluded.account_name, bankhub_accounts.account_name),
       status = excluded.status, updated_at = datetime('now')
     WHERE bankhub_accounts.owner_id = excluded.owner_id`
  ).bind(a.xid, ownerId, a.companyXid, a.bank, a.accountNumber, a.accountName, a.status).run();
  return (r.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Public: link events
// ---------------------------------------------------------------------------

const LINK_STATUS: Record<string, string> = {
  BANK_ACCOUNT_LINKED: 'active',
  BANK_ACCOUNT_REACTIVATED: 'active',
  BANK_ACCOUNT_UNLINKED: 'unlinked',
  BANK_ACCOUNT_INACTIVATED: 'inactive',
};

async function bankHubEvents(c: Context<App>) {
  if (!(await authorized(c))) {
    await audit(c, 'anonymous', 'bankhub_event_rejected');
    return c.json({ success: false, error: 'Sai API key.' }, 401);
  }
  const body = await c.req.json<{ event?: string; xid?: string; metadata?: Record<string, any> }>().catch(() => null);
  if (!body || typeof body.event !== 'string') return c.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, 400);
  const status = LINK_STATUS[body.event];
  const m = body.metadata ?? {};
  const accountXid = typeof m.bank_account_xid === 'string' ? m.bank_account_xid : '';
  if (!status || !accountXid) return c.json({ success: true, ignored: body.event }); // session progress events need no action

  const existing = await c.env.DB.prepare(`SELECT owner_id, company_xid FROM bankhub_accounts WHERE bank_account_xid = ?`).bind(accountXid).first<{ owner_id: number; company_xid: string | null }>();
  const token = typeof m.link_token_xid === 'string'
    ? await c.env.DB.prepare(`SELECT owner_id, company_xid FROM bankhub_link_tokens WHERE link_token_xid = ?`).bind(m.link_token_xid).first<{ owner_id: number; company_xid: string }>()
    : null;
  if (existing && token && existing.owner_id !== token.owner_id) {
    await audit(c, 'bankhub', 'bankhub_link_event_owner_mismatch', null, accountXid);
    return c.json({ success: true, ignored: 'owner_mismatch' });
  }
  const owner = existing?.owner_id ?? token?.owner_id ?? null;
  if (owner === null) {
    // Neither the account nor the link token is known: never guess a landlord. "Đồng bộ tài khoản" recovers it.
    await audit(c, 'bankhub', 'bankhub_link_event_unmapped', null, accountXid);
    return c.json({ success: true, ignored: 'unmapped' });
  }
  const ok = await upsertAccount(c.env.DB, owner, {
    xid: accountXid, companyXid: existing?.company_xid ?? token?.company_xid ?? null,
    bank: typeof m.brand_name === 'string' ? m.brand_name : null,
    accountNumber: typeof m.account_number === 'string' ? m.account_number : null,
    accountName: null, status,
  });
  await audit(c, 'bankhub', `bankhub_${body.event.toLowerCase()}`, null, `${owner}:${accountXid}${ok ? '' : ':kept'}`);
  return c.json({ success: true });
}

// ---------------------------------------------------------------------------
// Public: balance-change IPN
// ---------------------------------------------------------------------------

interface Ipn {
  gateway?: string; transaction_date?: string; account_number?: string; bank_account_xid?: string; va?: string | null;
  payment_code?: string | null; content?: string; transfer_type?: string; amount?: number | string;
  reference_code?: string | null; accumulated?: number; transaction_id?: string | number;
}

async function bankHubIpn(c: Context<App>) {
  const env = c.env;
  if (!(await authorized(c))) {
    await audit(c, 'anonymous', 'bankhub_ipn_rejected');
    return c.json({ success: false, error: 'Sai API key.' }, 401);
  }
  const body = await c.req.json<Ipn>().catch(() => null);
  if (!body) return c.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, 400);
  if (body.transfer_type !== 'credit') return c.json({ success: true, ignored: 'debit' });
  const txId = String(body.transaction_id ?? '').trim();
  if (!txId) return c.json({ success: false, error: 'Thiếu transaction_id.' }, 400);

  const sepayId = `bh-${txId}`;
  if (await env.DB.prepare(`SELECT 1 FROM sepay_events WHERE sepay_id = ?`).bind(sepayId).first())
    return c.json({ success: true, ignored: 'duplicate' });

  const transfer: SepayTransfer = {
    id: sepayId, gateway: body.gateway, transactionDate: body.transaction_date, accountNumber: body.account_number,
    content: body.content ?? '', transferType: 'in', transferAmount: Number(body.amount) || 0, referenceCode: body.reference_code ?? undefined,
  };
  const amount = Math.round(Number(body.amount) || 0);
  const account = typeof body.bank_account_xid === 'string' && body.bank_account_xid
    ? await env.DB.prepare(`SELECT owner_id FROM bankhub_accounts WHERE bank_account_xid = ?`).bind(body.bank_account_xid).first<{ owner_id: number }>()
    : null;

  const insertPlain = (owner: number | null) => env.DB.prepare(
    `INSERT OR IGNORE INTO sepay_events (sepay_id, kind, amount, content, account_no, house_id, room, month, paid_at, owner_id, status)
     VALUES (?, 'none', ?, ?, ?, NULL, NULL, NULL, ?, ?, 'done')`
  ).bind(sepayId, amount, String(body.content ?? '').slice(0, 300), body.account_number ?? null, body.transaction_date ?? null, owner);

  if (!account) {
    // Unknown bank account: nobody to give the money to and no guessing. Kept as an ignored event for the Developer.
    await insertPlain(null).run();
    await audit(c, 'bankhub', 'bankhub_ipn_unknown_account', null, `${sepayId}:${String(body.bank_account_xid ?? '').slice(0, 40)}`);
    return c.json({ success: true, ignored: 'unknown_account' });
  }

  const ownerId = account.owner_id;
  const text = `${body.content ?? ''} ${body.payment_code ?? ''}`;
  const payCode = await findPayCode(env, text, ownerId);
  const oldCode = payCode ? null : parseRentCode(text);
  const place = payCode
    ? { houseId: payCode.houseId, ownerId: payCode.ownerId }
    : oldCode ? await houseForRent(env, oldCode, body.account_number, ownerId) : null;
  const rent = payCode ?? (oldCode ? { room: oldCode.room, month: oldCode.month } : null);
  const migrating = Boolean(place && rent) && (await getStorage(env.DB, ownerId)).backend === 'migrating';

  // Same ordering as the SePay webhook: a rent event is 'deferred' until it is booked, so a failure in
  // between is picked up by the retry or the cron replay and never counted twice.
  const insertEvent = env.DB.prepare(
    `INSERT OR IGNORE INTO sepay_events (sepay_id, kind, amount, content, account_no, house_id, room, month, paid_at, owner_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sepayId, rent ? 'rent' : 'none', amount, String(body.content ?? '').slice(0, 300), body.account_number ?? null,
    place?.houseId ?? null, rent?.room ?? null, rent?.month ?? null, body.transaction_date ?? null, ownerId, place && rent ? 'deferred' : 'done');
  if (!(place && rent)) {
    await env.DB.batch([insertEvent, unassignedStatement(env, transfer, sepayId)]);
    await audit(c, 'bankhub', 'bankhub_ipn_unassigned', null, `${sepayId}:${ownerId}`);
    return c.json({ success: true, unassigned: true });
  }
  await insertEvent.run();

  let settled: Record<string, unknown>;
  let booked = false;
  if (!migrating) {
    try {
      const r = await settleRent(env, place.ownerId, place.houseId, rent.room, rent.month, transfer, sepayId);
      if (!r.settled && r.reason === 'room') await recordUnassigned(env, transfer, sepayId);
      await env.DB.prepare(`UPDATE sepay_events SET status = 'done' WHERE sepay_id = ?`).bind(sepayId).run();
      settled = r;
      booked = true;
    } catch (e) {
      if (!(e instanceof TenantLockedError)) console.warn('[bankhub] settle failed, kept for replay', sepayId, e);
      settled = { settled: false, deferred: true };
    }
  } else {
    settled = { settled: false, deferred: true };
  }
  if (!booked) await deferRent(env, place.ownerId, place.houseId, rent.room, rent.month, sepayId).catch((e) => console.warn('[bankhub] defer', sepayId, e));
  await audit(c, 'bankhub', booked ? 'bankhub_ipn_settled' : 'bankhub_ipn_deferred', place.houseId, `${sepayId}:${rent.room}:${rent.month}`);
  return c.json({ success: true, kind: 'rent', houseId: place.houseId, room: rent.room, month: rent.month, rent: settled });
}

// ---------------------------------------------------------------------------
// Developer
// ---------------------------------------------------------------------------

export function registerBankHub(app: Hono<App>): void {
  // Explicit, independent of /api/dev/* in routes/houses.ts.
  app.use('/api/dev/bankhub', requireAuth, developerOnly);
  app.use('/api/dev/landlords/:id/bankhub/*', requireAuth, developerOnly);

  app.post('/api/bankhub/events', bankHubEvents);
  app.post('/api/bankhub/ipn', bankHubIpn);

  app.get('/api/dev/bankhub', async (c) => {
    const companies = (await c.env.DB.prepare(`SELECT owner_id, company_xid, full_name, status, created_at FROM bankhub_companies`).all<any>()).results;
    const accounts = (await c.env.DB.prepare(`SELECT * FROM bankhub_accounts ORDER BY linked_at`).all<AccountRow>()).results;
    const landlords: Record<number, unknown> = {};
    for (const co of companies)
      landlords[co.owner_id] = { company: { xid: co.company_xid, fullName: co.full_name, status: co.status, createdAt: co.created_at }, accounts: [] };
    for (const a of accounts) {
      const entry = (landlords[a.owner_id] ??= { company: null, accounts: [] }) as { accounts: unknown[] };
      entry.accounts.push({ xid: a.bank_account_xid, bank: a.bank, accountMasked: maskAccount(a.account_number), accountName: a.account_name, status: a.status, linkedAt: a.linked_at, updatedAt: a.updated_at });
    }
    const origin = new URL(c.req.url).origin;
    return c.json({
      success: true, configured: bankHubConfigured(c.env), ipnKeySet: Boolean(c.env.BANKHUB_IPN_KEY), base: bankHubBase(c.env),
      ipnUrl: `${origin}/api/bankhub/ipn`, eventsUrl: `${origin}/api/bankhub/events`, landlords,
    });
  });

  app.post('/api/dev/landlords/:id/bankhub/company', async (c) => {
    if (!bankHubConfigured(c.env)) return notConfigured(c);
    const id = Number(c.req.param('id'));
    const owner = await ownerExists(c.env.DB, id);
    if (!owner) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const have = await c.env.DB.prepare(`SELECT company_xid, full_name, status FROM bankhub_companies WHERE owner_id = ?`).bind(id).first<any>();
    if (have) return c.json({ success: true, created: false, company: { xid: have.company_xid, fullName: have.full_name, status: have.status } });
    // Company names are unique per merchant: the landlord id keeps two landlords with the same name apart.
    const name = `${owner.full_name} - Trọ Hub #${id}`;
    try {
      const co = await bankHubClient(c.env).createCompany(name);
      await c.env.DB.prepare(`INSERT OR IGNORE INTO bankhub_companies (owner_id, company_xid, full_name, status) VALUES (?, ?, ?, 'Active')`).bind(id, co.xid, co.fullName).run();
      await audit(c, `staff:${c.get('viewer').id}`, 'bankhub_company_created', null, `${id}:${co.xid}`);
      return c.json({ success: true, created: true, company: { xid: co.xid, fullName: co.fullName, status: 'Active' } });
    } catch (e) {
      return upstream(c, e);
    }
  });

  app.post('/api/dev/landlords/:id/bankhub/link-token', async (c) => {
    if (!bankHubConfigured(c.env)) return notConfigured(c);
    const id = Number(c.req.param('id'));
    if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const co = await c.env.DB.prepare(`SELECT company_xid FROM bankhub_companies WHERE owner_id = ?`).bind(id).first<{ company_xid: string }>();
    if (!co) return fail(c, 409, 'NO_COMPANY', 'Chủ trọ chưa có công ty Bank Hub. Tạo công ty trước.');
    const sent = await c.req.json<{ completionRedirectUri?: string }>().catch(() => ({} as { completionRedirectUri?: string }));
    const redirect = typeof sent.completionRedirectUri === 'string' && /^https?:\/\//i.test(sent.completionRedirectUri) ? sent.completionRedirectUri : undefined;
    try {
      const t = await bankHubClient(c.env).createLinkToken(co.company_xid, { completionRedirectUri: redirect });
      // Events name the link token only; remember whose it is (under both ids the docs show, xid and link_token).
      await c.env.DB.batch([t.xid, t.linkToken].filter((x): x is string => Boolean(x)).map((x) =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO bankhub_link_tokens (link_token_xid, owner_id, company_xid, purpose, expires_at) VALUES (?, ?, ?, 'LINK_BANK_ACCOUNT', ?)`)
          .bind(x, id, co.company_xid, t.expiresAt)));
      await audit(c, `staff:${c.get('viewer').id}`, 'bankhub_link_token_created', null, `${id}:${t.xid}`);
      return c.json({ success: true, hostedLinkUrl: t.hostedLinkUrl, expiresAt: t.expiresAt });
    } catch (e) {
      return upstream(c, e);
    }
  });

  app.post('/api/dev/landlords/:id/bankhub/sync', async (c) => {
    if (!bankHubConfigured(c.env)) return notConfigured(c);
    const id = Number(c.req.param('id'));
    if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const co = await c.env.DB.prepare(`SELECT company_xid FROM bankhub_companies WHERE owner_id = ?`).bind(id).first<{ company_xid: string }>();
    if (!co) return fail(c, 409, 'NO_COMPANY', 'Chủ trọ chưa có công ty Bank Hub. Tạo công ty trước.');
    let accounts: BankHubAccount[];
    try {
      accounts = await bankHubClient(c.env).listBankAccounts(co.company_xid);
    } catch (e) {
      return upstream(c, e);
    }
    let kept = 0;
    for (const a of accounts) {
      const ok = await upsertAccount(c.env.DB, id, { xid: a.xid, companyXid: co.company_xid, bank: a.bank, accountNumber: a.accountNumber, accountName: a.accountName, status: a.active ? 'active' : 'inactive' });
      if (!ok) kept++;
    }
    await audit(c, `staff:${c.get('viewer').id}`, 'bankhub_accounts_synced', null, `${id}:${accounts.length}`);
    return c.json({ success: true, count: accounts.length, skipped: kept });
  });
}
