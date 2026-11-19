/**
 * Phí dịch vụ Trọ Hub: the Developer bills each landlord once a month (rooms × tiện ích prices) and
 * is paid by bank transfer into the Developer's own SePay account. The shared webhook (routes/sepay.ts)
 * calls `processServiceTransfer`; the invoice code in the transfer content tells which invoice was paid.
 * Rent never passes here. Room counts are asked of each landlord's own store when an invoice is made.
 */
import type { Hono } from 'hono';
import { actorOf, audit, fail, type App, type Env } from '../app.ts';
import { allHouses } from '../central/directory.ts';
import type { SepayTransfer } from '../payments/settle.ts';
import { tenantOfOwner } from '../tenant/route.ts';
import { houseModules, moduleCatalog, monthlyPerRoom } from './houses.ts';
import { vietQrBanks } from './integrations.ts';

const BILLING_KEYS = ['billing_bank_bin', 'billing_bank_name', 'billing_account_no', 'billing_account_name', 'sepay_key_sha256'] as const;

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function billingSettings(db: D1Database) {
  const { results } = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${BILLING_KEYS.map(() => '?').join(',')})`)
    .bind(...BILLING_KEYS)
    .all<{ key: string; value: string }>();
  const get = (k: (typeof BILLING_KEYS)[number]) => results.find((r) => r.key === k)?.value ?? '';
  return {
    bankBin: get('billing_bank_bin'),
    bankName: get('billing_bank_name'),
    accountNo: get('billing_account_no'),
    accountName: get('billing_account_name'),
    keySha: get('sepay_key_sha256'),
  };
}

/** This month in Vietnam, 'YYYY-MM'. */
const vnMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);

/** 'TH' + 6 letters/digits without look-alikes (0/O, 1/I). */
function invoiceCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `TH${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** What each landlord owes for a month: every active house they own (not waiting to be deleted), rooms counted in their own store. */
async function landlordFees(env: Env) {
  const catalog = await moduleCatalog(env.DB);
  const { results: owners } = await env.DB.prepare(`SELECT id FROM staff WHERE role = 'owner' AND status = 'active' ORDER BY id`).all<{ id: number }>();
  const houses = (await allHouses(env.DB)).filter((h) => h.delete_after === null);
  const byOwner = new Map<number, { houses: { id: string; name: string; rooms: number; fee: number }[]; total: number }>();
  for (const { id: ownerId } of owners) {
    const mine = houses.filter((h) => h.owner_id === ownerId);
    if (!mine.length) continue;
    const db = await tenantOfOwner(env, ownerId);
    const { results } = await db.prepare(
      `SELECT house_id, COUNT(*) AS n FROM rooms WHERE deleted_at IS NULL AND house_id IN (${mine.map(() => '?').join(',')}) GROUP BY house_id`
    ).bind(...mine.map((h) => h.house_id)).all<{ house_id: string; n: number }>();
    const rooms = new Map(results.map((r) => [r.house_id, r.n]));
    const entry = { houses: [] as { id: string; name: string; rooms: number; fee: number }[], total: 0 };
    for (const h of mine) {
      const n = rooms.get(h.house_id) ?? 0;
      const fee = n * monthlyPerRoom(houseModules(h.modules, catalog), catalog);
      entry.houses.push({ id: h.house_id, name: h.name, rooms: n, fee });
      entry.total += fee;
    }
    byOwner.set(ownerId, entry);
  }
  return byOwner;
}

/**
 * Records one SePay transfer and marks the invoice whose code appears in the content as paid once the
 * money received for it reaches the amount. The same SePay id twice is ignored.
 */
export async function processServiceTransfer(db: D1Database, t: SepayTransfer, simulated: boolean, keepUnmatched = true) {
  if (t.transferType && t.transferType !== 'in') return { matched: false, ignored: 'outgoing' as const };
  const amount = Math.round(Number(t.transferAmount) || 0);
  const sepayId = t.id != null ? String(t.id) : null;
  if (sepayId && (await db.prepare(`SELECT 1 FROM service_payments WHERE sepay_id = ?`).bind(sepayId).first()))
    return { matched: false, ignored: 'duplicate' as const };

  // Banks add, drop or split spaces, so look for each open invoice code in the content squashed to A–Z0–9.
  const squashed = `${t.content ?? ''} ${t.description ?? ''}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { results: open } = await db.prepare(`SELECT id, code, amount FROM service_invoices WHERE status = 'unpaid'`).all<{ id: number; code: string; amount: number }>();
  const invoice = open.find((i) => squashed.includes(i.code)) ?? null;
  // The shared webhook logs every transfer in sepay_events; here only fee payments are kept.
  if (!invoice && !keepUnmatched) return { matched: false };

  await db.prepare(
    `INSERT INTO service_payments (sepay_id, invoice_id, amount, content, account_no, gateway, reference, paid_at, simulated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sepayId, invoice?.id ?? null, amount, String(t.content ?? '').slice(0, 300), t.accountNumber ?? null, t.gateway ?? null,
      t.referenceCode ?? null, t.transactionDate ?? new Date().toISOString(), simulated ? 1 : 0)
    .run();
  if (!invoice) return { matched: false };

  const paid = await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM service_payments WHERE invoice_id = ?`).bind(invoice.id).first<{ total: number }>();
  const settled = (paid?.total ?? 0) >= invoice.amount;
  if (settled) await db.prepare(`UPDATE service_invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).bind(invoice.id).run();
  return { matched: true, code: invoice.code, settled, received: paid?.total ?? 0, due: invoice.amount };
}

export function registerBilling(app: Hono<App>): void {
  app.get('/api/dev/billing', async (c) => {
    const s = await billingSettings(c.env.DB);
    const month = c.req.query('month') || vnMonth();
    const { results: invoices } = await c.env.DB.prepare(
      `SELECT i.id, i.owner_id, i.month, i.amount, i.code, i.detail, i.status, i.paid_at, s.full_name, s.phone,
              (SELECT COALESCE(SUM(p.amount), 0) FROM service_payments p WHERE p.invoice_id = i.id) AS received
         FROM service_invoices i JOIN staff s ON s.id = i.owner_id WHERE i.month = ? ORDER BY s.full_name`
    )
      .bind(month)
      .all<Record<string, any>>();
    const { results: payments } = await c.env.DB.prepare(
      `SELECT p.id, p.amount, p.content, p.paid_at, p.simulated, p.created_at, i.code, s.full_name
         FROM service_payments p LEFT JOIN service_invoices i ON i.id = p.invoice_id LEFT JOIN staff s ON s.id = i.owner_id
        ORDER BY p.id DESC LIMIT 20`
    ).all();
    const { results: events } = await c.env.DB.prepare(
      `SELECT e.sepay_id, e.kind, e.amount, e.content, e.house_id, e.room, e.month, e.paid_at, e.created_at, s.full_name AS landlord
         FROM sepay_events e LEFT JOIN staff s ON s.id = e.owner_id ORDER BY e.created_at DESC, e.rowid DESC LIMIT 30`
    ).all();
    const fees = await landlordFees(c.env);
    const billed = new Set(invoices.map((i) => i.owner_id));
    const unbilled = [...fees].filter(([id, f]) => f.total > 0 && !billed.has(id)).length;
    return c.json({
      success: true,
      month,
      settings: {
        bankBin: s.bankBin, bankName: s.bankName, accountNo: s.accountNo, accountName: s.accountName,
        keySet: Boolean(s.keySha),
        webhookUrl: `${new URL(c.req.url).origin}/api/sepay/webhook`,
      },
      invoices: invoices.map((i) => ({ ...i, detail: i.detail ? JSON.parse(i.detail) : [] })),
      payments,
      events,
      unbilled,
    });
  });
  
  /** The account landlords pay into, and the SePay API key (send an empty key to keep the current one). */
  app.put('/api/dev/billing/settings', async (c) => {
    const body = await c.req.json<{ bankBin?: string; accountNo?: string; accountName?: string; apiKey?: string }>().catch(() => ({}) as Record<string, string>);
    const accountNo = String(body.accountNo ?? '').replace(/\s/g, '');
    if (!/^[0-9A-Za-z]{6,19}$/.test(accountNo)) return fail(c, 400, 'ACCOUNT_INVALID', 'Số tài khoản phải có 6–19 chữ số.');
    const bank = (await vietQrBanks()).find((b) => b.bin === String(body.bankBin ?? ''));
    if (!bank) return fail(c, 400, 'BANK_INVALID', 'Vui lòng chọn ngân hàng trong danh sách.');
    const apiKey = String(body.apiKey ?? '').trim();
    if (apiKey && apiKey.length < 8) return fail(c, 400, 'KEY_INVALID', 'API key quá ngắn.');
  
    const values: [string, string][] = [
      ['billing_bank_bin', bank.bin],
      ['billing_bank_name', bank.shortName],
      ['billing_account_no', accountNo],
      ['billing_account_name', String(body.accountName ?? '').trim().toUpperCase().slice(0, 60)],
    ];
    if (apiKey) values.push(['sepay_key_sha256', await sha256Hex(apiKey)]);
    await c.env.DB.batch(values.map(([k, v]) =>
      c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).bind(k, v)
    ));
    await audit(c, actorOf(c.get('viewer')), 'billing_settings', null, `${bank.shortName} ****${accountNo.slice(-4)}${apiKey ? ', key' : ''}`);
    return c.json({ success: true });
  });
  
  /** One invoice per landlord for the month, from today's rooms and prices. Landlords already billed are skipped. */
  app.post('/api/dev/billing/invoices', async (c) => {
    const body = await c.req.json<{ month?: string }>().catch(() => ({}) as { month?: string });
    const month = String(body.month || vnMonth());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(c, 400, 'MONTH_INVALID', 'Tháng không hợp lệ.');
    const fees = await landlordFees(c.env);
    const { results: done } = await c.env.DB.prepare(`SELECT owner_id FROM service_invoices WHERE month = ?`).bind(month).all<{ owner_id: number }>();
    const billed = new Set(done.map((d) => d.owner_id));
    const rows = [...fees].filter(([id, f]) => f.total > 0 && !billed.has(id));
    if (!rows.length) return c.json({ success: true, created: 0 });
    await c.env.DB.batch(rows.map(([ownerId, f]) =>
      c.env.DB.prepare(`INSERT INTO service_invoices (owner_id, month, amount, code, detail) VALUES (?, ?, ?, ?, ?)`)
        .bind(ownerId, month, f.total, invoiceCode(), JSON.stringify(f.houses))
    ));
    await audit(c, actorOf(c.get('viewer')), 'service_invoices_create', null, `${month}: ${rows.length}`);
    return c.json({ success: true, created: rows.length });
  });
  
  /** Runs the webhook logic with a made-up SePay transfer, to try the whole flow without real money. */
  app.post('/api/dev/billing/simulate', async (c) => {
    const body = await c.req.json<{ invoiceId?: number; amount?: number }>().catch(() => ({}) as { invoiceId?: number; amount?: number });
    const invoice = await c.env.DB.prepare(`SELECT id, code, amount FROM service_invoices WHERE id = ?`).bind(Number(body.invoiceId)).first<{ id: number; code: string; amount: number }>();
    if (!invoice) return fail(c, 404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hoá đơn.');
    const s = await billingSettings(c.env.DB);
    const result = await processServiceTransfer(c.env.DB, {
      id: `SIM-${Date.now()}`,
      gateway: s.bankName || 'SIMULATED',
      accountNumber: s.accountNo,
      content: `CT TU NGUOI THU ${invoice.code} THANH TOAN PHI TRO HUB`,
      transferType: 'in',
      transferAmount: Number(body.amount) > 0 ? Math.round(Number(body.amount)) : invoice.amount,
      referenceCode: `SIM${Date.now()}`,
      transactionDate: new Date(Date.now() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 19),
    }, true);
    await audit(c, actorOf(c.get('viewer')), 'service_payment_simulated', null, invoice.code);
    return c.json({ success: true, ...result });
  });
}
