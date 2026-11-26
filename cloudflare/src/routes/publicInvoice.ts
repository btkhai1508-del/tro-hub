/**
 * Public payment page of one invoice (no login). `GET /api/public/invoice/:token` reads that invoice only:
 * house name, room, month, fee lines, total, the bank account and the pay code. Never a phone number, a
 * CCCD or anything else about the resident, and the token opens no other route. A draft answers exactly
 * like an unknown token (404). Once paid there is no bank account and no QR: only the payment day.
 * Wrong tokens are counted per IP: after PUBLIC_LINK_LIMITS.maxMisses in the window the IP gets 429.
 *
 * Staff and the room's own resident get (and create on first use) the link of an issued invoice;
 * staff rotate it, which kills the old link at once.
 */
import type { Context, Hono } from 'hono';
import { actorOf, audit, fail, staffOnly, type App } from '../app.ts';
import { houseOwner } from '../central/directory.ts';
import type { InvoiceStatus } from '../central/deferred.ts';
import { dueDateOf, sheetLines } from '../billing/invoiceSheet.ts';
import { ipKey, registerHit } from '../loginLimit.ts';
import { toSheetMonth } from '../sheetSync.ts';
import type { TenantDb } from '../tenant/db.ts';
import { tenantFor, tenantOfOwner } from '../tenant/route.ts';
import { assignPayNumbers } from './houses.ts';
import { statusView, vnDate } from './rent.ts';

export const PUBLIC_LINK_LIMITS = { maxMisses: 20, windowSec: 3600 } as const;
const DEFAULT_ORIGIN = 'https://tro-hub.onrender.com';
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** 24 random bytes as base64url: 32 characters, 192 bits. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The app uses a hash router (and relative assets), so the page lives at /#/pay/<token>.
const linkUrl = (c: Context<App>, token: string) => `${(c.env.PUBLIC_APP_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '')}/#/pay/${token}`;
const pad3 = (n: number) => String(n).padStart(3, '0');

interface InvoiceHead { id: number; house_id: string; room_id: number; room: string; month: string; total: number; status: InvoiceStatus; paid_at: string | null; issued_at: string | null }

const headOf = (db: TenantDb, houseId: string, invoiceId: number) =>
  db.prepare(
    `SELECT i.id, i.house_id, i.room_id, rm.name AS room, i.month, i.total, i.status, i.paid_at, i.issued_at
       FROM invoices i JOIN rooms rm ON rm.id = i.room_id WHERE i.id = ? AND i.house_id = ?`
  ).bind(invoiceId, houseId).first<InvoiceHead>();

/** What a payer needs besides the lines: pay code and the house's bank account (null when the house has none). */
async function payInfo(db: TenantDb, inv: InvoiceHead) {
  const house = await db.prepare(
    `SELECT name, bank_bin, bank_name, bank_account_no, bank_account_name, landlord_name, pay_no FROM houses WHERE id = ?`
  ).bind(inv.house_id).first<{ name: string; bank_bin: string | null; bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null; landlord_name: string | null; pay_no: number | null }>();
  const roomNo = await db.prepare(`SELECT pay_no FROM rooms WHERE id = ?`).bind(inv.room_id).first<{ pay_no: number | null }>();
  const [yyyy, mm] = inv.month.split('-');
  const payCode = house?.pay_no != null && roomNo?.pay_no != null ? `${pad3(house.pay_no)}${pad3(roomNo.pay_no)}${mm}${yyyy}` : null;
  const bank = !house?.bank_bin || !house.bank_account_no ? null : {
    bin: house.bank_bin,
    name: house.bank_name,
    accountNo: house.bank_account_no,
    accountName: house.bank_account_name || house.landlord_name || '',
  };
  return { houseName: house?.name ?? '', payCode, bank };
}

/** The link of an invoice, created on first use. */
async function linkFor(c: Context<App>, db: TenantDb, ownerId: number, inv: InvoiceHead): Promise<string> {
  const found = await c.env.DB.prepare(`SELECT token FROM invoice_links WHERE house_id = ? AND invoice_id = ?`).bind(inv.house_id, inv.id).first<{ token: string }>();
  if (found) return found.token;
  await assignPayNumbers(c.env, db, inv.house_id); // the page shows the pay code, so it must exist
  const token = newToken();
  await c.env.DB.prepare(`INSERT OR IGNORE INTO invoice_links (token, owner_id, house_id, invoice_id, created_by) VALUES (?, ?, ?, ?, ?)`)
    .bind(token, ownerId, inv.house_id, inv.id, actorOf(c.get('viewer'))).run();
  // Two first uses at once: one insert wins, both answer the stored token.
  return (await c.env.DB.prepare(`SELECT token FROM invoice_links WHERE house_id = ? AND invoice_id = ?`).bind(inv.house_id, inv.id).first<{ token: string }>())!.token;
}

/** The invoice behind an /api/houses/:houseId/invoices/:invoiceId/public-link call, after the access checks. */
async function invoiceForLink(c: Context<App>) {
  const houseId = c.req.param('houseId') ?? '';
  const invoiceId = Number(c.req.param('invoiceId'));
  const db = await tenantFor(c, houseId);
  const ownerId = await houseOwner(c.env.DB, houseId);
  const inv = Number.isInteger(invoiceId) && invoiceId > 0 ? await headOf(db, houseId, invoiceId) : null;
  const viewer = c.get('viewer');
  // A resident only reaches their own room's issued invoices; anything else reads as missing.
  if (!inv || ownerId === null || (viewer.kind === 'resident' && (inv.room_id !== viewer.roomId || inv.issued_at === null)))
    return { error: fail(c, 404, 'INVOICE_NOT_FOUND', 'Không tìm thấy hoá đơn.') } as const;
  if (inv.issued_at === null) return { error: fail(c, 409, 'INVOICE_DRAFT', 'Hoá đơn nháp chưa có link thanh toán. Hãy phát hành hoá đơn trước.') } as const;
  return { db, ownerId, inv } as const;
}

const notFound = (c: Context<App>) => fail(c, 404, 'LINK_NOT_FOUND', 'Link thanh toán không đúng hoặc đã được tạo lại.');

export function registerPublicInvoice(app: Hono<App>): void {
  app.get('/api/houses/:houseId/invoices/:invoiceId/public-link', async (c) => {
    const r = await invoiceForLink(c);
    if ('error' in r) return r.error;
    const token = await linkFor(c, r.db, r.ownerId, r.inv);
    const info = await payInfo(r.db, r.inv);
    return c.json({ success: true, url: linkUrl(c, token), payCode: info.payCode, bank: info.bank });
  });

  app.post('/api/houses/:houseId/invoices/:invoiceId/public-link/rotate', staffOnly, async (c) => {
    const r = await invoiceForLink(c);
    if ('error' in r) return r.error;
    await c.env.DB.prepare(`DELETE FROM invoice_links WHERE house_id = ? AND invoice_id = ?`).bind(r.inv.house_id, r.inv.id).run();
    const token = await linkFor(c, r.db, r.ownerId, r.inv);
    await audit(c, actorOf(c.get('viewer')), 'invoice_link_rotated', r.inv.house_id, `invoice:${r.inv.id}`);
    const info = await payInfo(r.db, r.inv);
    return c.json({ success: true, url: linkUrl(c, token), payCode: info.payCode, bank: info.bank });
  });

  app.get('/api/public/invoice/:token', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const ip = ipKey(c.req.header('CF-Connecting-IP'));
    const now = Math.floor(Date.now() / 1000);
    if (ip) {
      const row = await c.env.DB.prepare(`SELECT count, window_start FROM login_attempts WHERE scope = 'pay_miss' AND key = ?`).bind(ip).first<{ count: number; window_start: number }>();
      if (row && row.window_start + PUBLIC_LINK_LIMITS.windowSec > now && row.count >= PUBLIC_LINK_LIMITS.maxMisses)
        return fail(c, 429, 'TOO_MANY_TRIES', 'Bạn đã thử quá nhiều link sai. Vui lòng thử lại sau.');
    }
    const miss = async () => {
      if (ip) await registerHit(c.env.DB, 'pay_miss', ip, PUBLIC_LINK_LIMITS.maxMisses, PUBLIC_LINK_LIMITS.windowSec, now);
      return notFound(c);
    };

    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return miss();
    const link = await c.env.DB.prepare(`SELECT owner_id, house_id, invoice_id FROM invoice_links WHERE token = ?`).bind(token).first<{ owner_id: number; house_id: string; invoice_id: number }>();
    if (!link || (await houseOwner(c.env.DB, link.house_id)) !== link.owner_id) return miss();
    const db = await tenantOfOwner(c.env, link.owner_id);
    const inv = await headOf(db, link.house_id, link.invoice_id);
    if (!inv || inv.issued_at === null) return miss(); // a draft reads exactly like a wrong link

    const status = await (await statusView(c.env.DB, db, [inv.house_id], inv.month))(inv);
    const paid = status === 'paid' || status === 'cash';
    const info = await payInfo(db, inv);
    const lines = (await sheetLines(db, [inv.id])).get(inv.id) ?? [];

    return c.json({
      success: true,
      invoice: {
        houseName: info.houseName,
        room: inv.room,
        month: toSheetMonth(inv.month),
        lines: lines.map((l) => ({ name: l.name, formula: l.formula, amount: l.amount })),
        total: inv.total,
        payCode: info.payCode,
        dueDate: dueDateOf(inv.issued_at),
        paid,
        paidDate: paid ? vnDate(inv.paid_at) || null : null,
        // Paid: no account and no QR. Unpaid: what the bank QR needs.
        bank: paid ? null : info.bank,
      },
    });
  });
}
