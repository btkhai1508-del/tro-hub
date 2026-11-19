/**
 * SePay: the one webhook, the landlord's own SePay link (OAuth or a hand-made key), the QR image and
 * the list of transfers no house could be found for. Rent goes into the landlord's store through
 * payments/settle.ts, or is kept as 'deferred' while that store is being moved; service fees stay central
 * (routes/billing.ts). The key on the webhook decides whose houses a transfer may settle.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, fail, isOwner, type App, type Env } from '../app.ts';
import { getStorage, houseOwner } from '../central/directory.ts';
import { deferRent, recordUnassigned, settleRent, type SepayTransfer } from '../payments/settle.ts';
import { checkSepayState, disconnectSepay, finishSepayConnect, sepayConfigured, sepayConnectUrl, sepayRedirectUri, syncSepay } from '../sepayOauth.ts';
import { TenantLockedError, tenantOfOwner } from '../tenant/route.ts';
import { billingSettings, processServiceTransfer, sha256Hex } from './billing.ts';
import { page } from './integrations.ts';
import { requireAuth } from './auth.ts';

// ---------------------------------------------------------------------------
// Mã thanh toán tiền trọ XXXPPPMMYYYY: số căn (3 số), số phòng (3 số), tháng, năm.
// Số căn cấp một lần và không dùng lại (settings.house_pay_seq, tra ở house_directory). Số phòng ở kho của chủ trọ.
// ---------------------------------------------------------------------------

/**
 * Finds XXXPPPMMYYYY in a transfer memo. Tries the memo as written, then with spaces/dots/dashes between
 * digits removed (some banks split long numbers). A candidate counts only when that house exists in the
 * directory and its landlord's store has the room, and, for a transfer reported by a landlord's own
 * SePay, only among that landlord's houses.
 */
export async function findPayCode(env: Env, text: string, ownerId: number | null) {
  const squashed = text.replace(/(\d)[\s.\-]+(?=\d)/g, '$1');
  for (const source of [text, squashed]) {
    for (const m of source.matchAll(/(?<!\d)(\d{3})(\d{3})(0[1-9]|1[0-2])(20\d{2})(?!\d)/g)) {
      const house = await env.DB.prepare(
        `SELECT house_id, owner_id FROM house_directory WHERE pay_no = ? ${ownerId != null ? 'AND owner_id = ?' : ''}`
      ).bind(Number(m[1]), ...(ownerId != null ? [ownerId] : [])).first<{ house_id: string; owner_id: number }>();
      if (!house) continue;
      const db = await tenantOfOwner(env, house.owner_id);
      const room = await db.prepare(`SELECT name FROM rooms WHERE house_id = ? AND pay_no = ?`).bind(house.house_id, Number(m[2])).first<{ name: string }>();
      if (room) return { houseId: house.house_id, ownerId: house.owner_id, room: room.name, month: `${m[4]}-${m[3]}` };
    }
  }
  return null;
}

export function parseRentCode(content: string): { lvc: boolean; room: string; month: string } | null {
  const m = String(content ?? '').toUpperCase()
    .match(/(?:^|[^A-Z0-9])((?:LVC)*)-?([A-Z]?\d{2,4}[A-Z]?)[-\s.]?T(1[0-2]|0?[1-9])[-\s.]?(20\d{2})(?!\d)/);
  if (!m) return null;
  return { lvc: Boolean(m[1]), room: m[2], month: `${m[4]}-${m[3].padStart(2, '0')}` };
}

/**
 * Which house an old-style rent code belongs to: LVC by its prefix, otherwise the one house paid into that
 * account that has the room. A transfer reported through a landlord's SePay never reaches another landlord's house.
 */
async function houseForRent(env: Env, rent: { lvc: boolean; room: string }, accountNo: string | undefined, ownerId: number | null) {
  if (rent.lvc) {
    const owner = await houseOwner(env.DB, 'LVC');
    return owner !== null && (ownerId === null || owner === ownerId) ? { houseId: 'LVC', ownerId: owner } : null;
  }
  // Old-style codes carry no house number: guess only when exactly one house fits, never across landlords,
  // and never a house that did not declare the account the money arrived in.
  if (ownerId == null && !accountNo) return null;
  const owners = ownerId != null
    ? [ownerId]
    : (await env.DB.prepare(`SELECT DISTINCT owner_id FROM house_directory WHERE delete_after IS NULL`).all<{ owner_id: number }>()).results.map((r) => r.owner_id);
  const found: { houseId: string; ownerId: number }[] = [];
  for (const owner of owners) {
    const db = await tenantOfOwner(env, owner);
    const { results } = await db.prepare(
      `SELECT DISTINCT h.id FROM houses h JOIN rooms rm ON rm.house_id = h.id AND rm.deleted_at IS NULL AND rm.name = ?
        WHERE h.delete_after IS NULL AND h.owner_id = ? AND (? IS NOT NULL OR h.bank_account_no = ?)`
    ).bind(rent.room, owner, ownerId, accountNo ?? '').all<{ id: string }>();
    found.push(...results.map((r) => ({ houseId: r.id, ownerId: owner })));
  }
  return found.length === 1 ? found[0] : null;
}

/**
 * Giao dịch Express còn xử lý (giặt sấy): chuyển nguyên sang đó.
 * Express checks the same SePay API key (SEPAY_WEBHOOK_KEY on Render), so the header goes along.
 */
async function forwardToExpress(env: Env, body: SepayTransfer, authorization: string) {
  const origin = (env.EXPRESS_ORIGIN || 'https://tro-hub.onrender.com').replace(/\/+$/, '');
  await fetch(`${origin}/api/sepay/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) })
    .catch((err) => console.warn('[sepay] forward laundry', err));
}

/**
 * The one SePay webhook. In SePay set the URL to /api/sepay/webhook and the auth to "API Key"; SePay then
 * sends "Authorization: Apikey <key>" (only the key's SHA-256 is stored). Each SePay transaction is handled
 * once: a service-fee code settles that invoice; a rent code is booked into its landlord's store (or kept
 * 'deferred' while that store is being moved); a transfer no house can be found for is kept as unassigned.
 */
async function sepayWebhook(c: Context<App>) {
  const env = c.env;
  const { keySha } = await billingSettings(env.DB);
  const sent = (c.req.header('Authorization') ?? '').replace(/^Apikey\s+/i, '').trim();
  const sentSha = sent ? await sha256Hex(sent) : '';
  // The Developer's own webhook, one Trọ Hub created on a landlord's SePay account through OAuth,
  // or one the landlord made by hand with the key Trọ Hub gave them.
  const landlord = sentSha && sentSha !== keySha
    ? await env.DB.prepare(
        `SELECT owner_id FROM sepay_connections WHERE webhook_key_sha256 = ?1
         UNION ALL SELECT owner_id FROM sepay_manual_webhooks WHERE key_sha256 = ?1 LIMIT 1`
      ).bind(sentSha).first<{ owner_id: number }>()
    : null;
  if (landlord)
    c.executionCtx.waitUntil(
      env.DB.prepare(`UPDATE sepay_manual_webhooks SET last_event_at = datetime('now') WHERE key_sha256 = ?`).bind(sentSha).run()
    );
  if (!sentSha || (sentSha !== keySha && !landlord)) {
    await audit(c, 'anonymous', 'sepay_webhook_rejected');
    return c.json({ success: false, error: 'Sai API key.' }, 401);
  }
  const body = await c.req.json<SepayTransfer>().catch(() => null);
  if (!body) return c.json({ success: false, error: 'Dữ liệu không hợp lệ.' }, 400);
  if (body.transferType && body.transferType !== 'in') return c.json({ success: true, ignored: 'outgoing' });

  const sepayId = String(body.id ?? `noid-${body.referenceCode ?? Date.now()}`);
  if (await env.DB.prepare(`SELECT 1 FROM sepay_events WHERE sepay_id = ?`).bind(sepayId).first())
    return c.json({ success: true, ignored: 'duplicate' });

  const text = `${body.content ?? ''} ${body.description ?? ''}`;
  // Service fees are paid into the Developer's account only, so a landlord's webhook never settles an invoice.
  const service = landlord ? { matched: false } : await processServiceTransfer(env.DB, { ...body, id: sepayId }, false, false);
  const keyOwner = landlord?.owner_id ?? null;
  const payCode = service.matched ? null : await findPayCode(env, text, keyOwner);
  const oldCode = service.matched || payCode ? null : parseRentCode(text);
  const place = payCode
    ? { houseId: payCode.houseId, ownerId: payCode.ownerId }
    : oldCode ? await houseForRent(env, oldCode, body.accountNumber, keyOwner) : null;
  const rent = payCode ?? (oldCode ? { room: oldCode.room, month: oldCode.month } : null);
  const laundry = !service.matched && !rent && /(?:^|[^A-Z0-9])(MG|MS)\d{1,2}(?![0-9])/.test(text.toUpperCase());
  const kind = service.matched ? 'service' : rent ? 'rent' : laundry ? 'laundry' : 'none';
  const houseId = place?.houseId ?? null;
  // The state is read once: a transfer that meets a landlord being moved waits centrally.
  const migrating = Boolean(place && rent) && (await getStorage(env.DB, place!.ownerId)).backend === 'migrating';

  // A rent event starts as 'deferred' (the status APIs already count it, minus what is booked) and
  // becomes 'done' only after it was booked: whatever fails in between, a SePay retry finds the event
  // and the cron's replay books it. It is never 'done' without being booked.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sepay_events (sepay_id, kind, amount, content, account_no, house_id, room, month, paid_at, owner_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sepayId, kind, Math.round(Number(body.transferAmount) || 0), String(body.content ?? '').slice(0, 300), body.accountNumber ?? null,
      houseId, rent?.room ?? null, rent?.month ?? null, body.transactionDate ?? null, keyOwner, place && rent ? 'deferred' : 'done')
    .run();

  let settled: Record<string, unknown> | null = null;
  if (place && rent) {
    let booked = false;
    if (!migrating) {
      try {
        const r = await settleRent(env, place.ownerId, place.houseId, rent.room, rent.month, body, sepayId);
        if (!r.settled && r.reason === 'room') await recordUnassigned(env, body, sepayId);
        await env.DB.prepare(`UPDATE sepay_events SET status = 'done' WHERE sepay_id = ?`).bind(sepayId).run();
        settled = r;
        booked = true;
      } catch (e) {
        // A lock that began just now wrote nothing; any other failure may have written part of it.
        // Either way the event stays 'deferred' and is booked later (the reference makes that safe).
        if (!(e instanceof TenantLockedError)) console.warn('[sepay] settle failed, kept for replay', sepayId, e);
      }
    }
    if (!booked) {
      await deferRent(env, place.ownerId, place.houseId, rent.room, rent.month, sepayId).catch((e) => console.warn('[sepay] defer', sepayId, e));
      settled = { settled: false, deferred: true };
    }
  } else if (!service.matched && !laundry) {
    await recordUnassigned(env, body, sepayId); // nobody to give the money to yet
  }
  // Giặt sấy vẫn chạy trên Express: chuyển nguyên giao dịch sang đó.
  if (laundry) c.executionCtx.waitUntil(forwardToExpress(env, body, c.req.header('Authorization') ?? ''));
  return c.json({ success: true, kind, ...(service.matched ? service : {}), ...(rent ? { houseId, room: rent.room, month: rent.month, rent: settled } : {}), ...(!place && !service.matched && !laundry ? { unassigned: true } : {}) });
}

// ---------------------------------------------------------------------------
// SePay OAuth2: a landlord links their own SePay account. The Developer makes the consent link and
// sends it to the landlord (or opens it on the landlord's device); the landlord signs in to SePay
// and agrees. Trọ Hub then reads their bank accounts and creates its webhook on their account.
// ---------------------------------------------------------------------------

type SepayConnRow = { owner_id: number; company: string | null; bank_accounts: string | null; webhook_id: string | null; connected_at: string; updated_at: string };

const sepayStatus = (row: SepayConnRow | null) =>
  row
    ? { connected: true, company: row.company, bankAccounts: JSON.parse(row.bank_accounts || '[]'), webhookId: row.webhook_id, since: row.connected_at, updatedAt: row.updated_at }
    : { connected: false };

async function ownerExists(db: D1Database, id: number) {
  return Boolean(await db.prepare(`SELECT 1 FROM staff WHERE id = ? AND role = 'owner'`).bind(id).first());
}

type ManualRow = { owner_id: number; key_hint: string; created_at: string; last_event_at: string | null };
const manualStatus = (r: ManualRow) => ({ keyHint: r.key_hint, createdAt: r.created_at, lastEventAt: r.last_event_at });
const sepayWebhookUrl = (c: Context<App>) => `${(c.env.SEPAY_WEBHOOK_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '')}/api/sepay/webhook`;

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);


export function registerSepay(app: Hono<App>): void {
  /** Bank transfers not yet tied to a house, limited to accounts used by this Admin Tổng's houses. */
  app.use('/api/payments/unassigned', requireAuth);
  app.get('/api/payments/unassigned', async (c) => {
    const viewer = c.get('viewer');
    if (!isOwner(viewer) || viewer.kind !== 'staff' || !viewer.houseIds.length) return fail(c, 403, 'OWNER_ONLY', 'Chỉ Admin Tổng xem được mục này.');
    const db = await tenantOfOwner(c.env, viewer.id);
    const marks = viewer.houseIds.map(() => '?').join(',');
    const { results: houses } = await db.prepare(`SELECT bank_account_no FROM houses WHERE id IN (${marks}) AND bank_account_no IS NOT NULL`)
      .bind(...viewer.houseIds).all<{ bank_account_no: string }>();
    const accounts = [...new Set(houses.map((h) => h.bank_account_no))];
    const central = accounts.length
      ? (await c.env.DB.prepare(
          `SELECT id, amount, 'bank' AS method, bank_name, reference, content, paid_at FROM unassigned_payments
            WHERE account_no IN (${accounts.map(() => '?').join(',')})`
        ).bind(...accounts).all<Record<string, unknown>>()).results
      : [];
    const { results: stored } = await db.prepare(
      `SELECT id, amount, method, bank_name, reference, content, paid_at FROM payments
        WHERE house_id IS NULL AND account_no IN (SELECT bank_account_no FROM houses WHERE id IN (${marks}))`
    ).bind(...viewer.houseIds).all<Record<string, unknown>>();
    const payments = [...central, ...stored].sort((a, b) => String(b.paid_at ?? '').localeCompare(String(a.paid_at ?? '')));
    return c.json({ success: true, payments });
  });

  app.post('/api/sepay/webhook', sepayWebhook);
  // Same handler under the first name the Developer page showed.
  app.post('/api/sepay/service-webhook', sepayWebhook);

  app.get('/api/dev/sepay', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT owner_id, company, bank_accounts, webhook_id, connected_at, updated_at FROM sepay_connections`
    ).all<SepayConnRow>();
    const manual = await c.env.DB.prepare(`SELECT owner_id, key_hint, created_at, last_event_at FROM sepay_manual_webhooks`).all<ManualRow>();
    const origin = new URL(c.req.url).origin;
    return c.json({
      success: true,
      configured: sepayConfigured(c.env),
      redirectUri: sepayRedirectUri(origin),
      webhookUrl: sepayWebhookUrl(c),
      connections: Object.fromEntries(results.map((r) => [r.owner_id, sepayStatus(r)])),
      manual: Object.fromEntries(manual.results.map((r) => [r.owner_id, manualStatus(r)])),
    });
  });
  
  // ── Webhook tự tạo: chủ trọ dán URL + API key Trọ Hub cấp vào my.sepay.vn của họ (không cần OAuth) ──
  
  /** A new key for this landlord's hand-made webhook. The old key stops working at once; the new one is shown only here. */
  app.post('/api/dev/landlords/:id/sepay/manual-key', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = 'th_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const row = await c.env.DB.prepare(
      `INSERT INTO sepay_manual_webhooks (owner_id, key_sha256, key_hint) VALUES (?, ?, ?)
       ON CONFLICT (owner_id) DO UPDATE SET key_sha256 = excluded.key_sha256, key_hint = excluded.key_hint,
         created_at = datetime('now'), last_event_at = NULL
       RETURNING owner_id, key_hint, created_at, last_event_at`
    )
      .bind(id, await sha256Hex(key), key.slice(-4))
      .first<ManualRow>();
    await audit(c, actorOf(c.get('viewer')), 'sepay_manual_key', null, `staff:${id}`);
    return c.json({ success: true, key, webhookUrl: sepayWebhookUrl(c), manual: manualStatus(row!) });
  });
  
  app.post('/api/dev/landlords/:id/sepay/manual-key/delete', async (c) => {
    const id = Number(c.req.param('id'));
    await c.env.DB.prepare(`DELETE FROM sepay_manual_webhooks WHERE owner_id = ?`).bind(id).run();
    await audit(c, actorOf(c.get('viewer')), 'sepay_manual_key_delete', null, `staff:${id}`);
    return c.json({ success: true });
  });
  
  app.post('/api/dev/landlords/:id/sepay/connect-url', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await ownerExists(c.env.DB, id))) return fail(c, 404, 'LANDLORD_NOT_FOUND', 'Không tìm thấy chủ trọ.');
    try {
      const url = await sepayConnectUrl(c.env, new URL(c.req.url).origin, id);
      await audit(c, actorOf(c.get('viewer')), 'sepay_connect_link', null, `staff:${id}`);
      return c.json({ success: true, url, expiresInMinutes: 30 });
    } catch (e: any) {
      return fail(c, 400, 'SEPAY_NOT_CONFIGURED', e.message);
    }
  });
  
  app.post('/api/dev/landlords/:id/sepay/sync', async (c) => {
    const id = Number(c.req.param('id'));
    try {
      await syncSepay(c.env, new URL(c.req.url).origin, id);
      const row = await c.env.DB.prepare(`SELECT * FROM sepay_connections WHERE owner_id = ?`).bind(id).first<SepayConnRow>();
      return c.json({ success: true, sepay: sepayStatus(row) });
    } catch (e: any) {
      return fail(c, 400, 'SEPAY_ERROR', e.message);
    }
  });
  
  app.post('/api/dev/landlords/:id/sepay/disconnect', async (c) => {
    const id = Number(c.req.param('id'));
    try {
      const r = await disconnectSepay(c.env, id);
      await audit(c, actorOf(c.get('viewer')), 'sepay_disconnect', null, `staff:${id}`);
      return c.json({ success: true, ...r });
    } catch (e: any) {
      return fail(c, 400, 'SEPAY_ERROR', e.message);
    }
  });
  
  app.get('/api/sepay/oauth/callback', async (c) => {
    const ownerId = await checkSepayState(c.env, c.req.query('state') ?? '');
    const code = c.req.query('code');
    if (c.req.query('error')) return c.html(page('Chưa kết nối SePay', 'Bạn đã không đồng ý cấp quyền. Có thể đóng trang này.'), 400);
    if (!ownerId || !code) return c.html(page('Không kết nối được', 'Link đã hết hạn hoặc không hợp lệ. Vui lòng xin link mới.'), 400);
    const origin = new URL(c.req.url).origin;
    try {
      await finishSepayConnect(c.env, origin, code, ownerId);
      await audit(c, `staff:${ownerId}`, 'sepay_connect');
    } catch (e: any) {
      return c.html(page('Không kết nối được', escapeHtml(String(e.message))), 400);
    }
    try {
      const r = await syncSepay(c.env, origin, ownerId);
      const list = r.bankAccounts.map((a) => `${escapeHtml(a.bank)} ••${escapeHtml(a.last4)}`).join(', ') || 'chưa có tài khoản ngân hàng nào';
      return c.html(page('Đã kết nối SePay', `Trọ Hub sẽ nhận thông báo tiền vào từ: <b>${list}</b>. Tiền vẫn vào thẳng tài khoản của bạn. Bạn có thể đóng trang này.`));
    } catch (e: any) {
      return c.html(page('Đã kết nối SePay', `Đã cấp quyền, nhưng chưa đọc được tài khoản ngân hàng: ${escapeHtml(String(e.message))}. Developer sẽ đồng bộ lại sau.`));
    }
  });

  /**
   * SePay's QR image (vietqr.app) with a CORS header, so the app can turn it into a PNG to save.
   * Only the QR parameters pass through and only that one host is fetched: this is not an open proxy.
   */
  app.get('/qr.png', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const acc = q.get('acc') ?? '';
    const bank = q.get('bank') ?? '';
    if (!/^[A-Za-z0-9]{4,30}$/.test(acc) || !/^[A-Za-z0-9]{2,20}$/.test(bank)) return fail(c, 400, 'QR_INVALID', 'Thiếu số tài khoản hoặc ngân hàng.');
    const out = new URLSearchParams({ acc, bank });
    const amount = q.get('amount');
    if (amount && /^\d{1,12}$/.test(amount)) out.set('amount', amount);
    const des = q.get('des');
    if (des) out.set('des', des.slice(0, 100));
    const template = q.get('template');
    if (template && ['qronly', 'compact'].includes(template)) out.set('template', template);
    const res = await fetch(`https://vietqr.app/img?${out}`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit).catch(() => null);
    if (!res || !res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return c.json({ success: false, errorCode: 'QR_UPSTREAM', error: 'Chưa tạo được mã QR.' }, 502);
    return new Response(res.body, {
      headers: { 'Content-Type': res.headers.get('content-type')!, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
    });
  });
}
