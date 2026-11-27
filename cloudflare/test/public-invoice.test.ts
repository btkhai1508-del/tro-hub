import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { dueDateOf, lineFormula } from '../src/billing/invoiceSheet.ts';
import { receivedAtUtc } from '../src/payments/settle.ts';
import { newToken, PUBLIC_LINK_LIMITS } from '../src/routes/publicInvoice.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const tokenOf = (url: string) => url.split('/pay/')[1];
const pub = (token: string, ip = '203.0.113.7') => api(`/api/public/invoice/${token}`, { headers: { 'CF-Connecting-IP': ip } });

describe('formulas', () => {
  it('writes each line the way the resident reads it', () => {
    expect(lineFormula({ kind: 'electricity', qty: 50, unitPrice: 3500 }, 1250)).toBe('(1.250 − 1.200) × 3.500');
    expect(lineFormula({ kind: 'water', qty: 3, unitPrice: 20000 })).toBe('3 × 20.000');
    expect(lineFormula({ kind: 'service', qty: 2, unitPrice: 50000, per: 'vehicle' })).toBe('2 × 50.000');
    expect(lineFormula({ kind: 'service', qty: 1, unitPrice: 30000, per: 'room' })).toBe('1 × 30.000');
    expect(lineFormula({ kind: 'room', qty: 1, unitPrice: 3000000 })).toBe('');
  });
  it('due date is one week after issuing, Vietnam time', () => {
    expect(dueDateOf('2026-11-01 00:00:00')).toBe('08/11/2026');
    expect(dueDateOf('2026-11-30 20:00:00')).toBe('08/12/2026'); // 03:00 on 1/12 in Vietnam
    expect(dueDateOf(null)).toBe('');
  });
  it('stores the SePay time in UTC', () => {
    expect(receivedAtUtc('2026-11-17 20:10:00')).toBe('2026-11-17 13:10:00');
    expect(receivedAtUtc('2026-11-17T13:10:00Z')).toBe('2026-11-17 13:10:00');
  });
  it('tokens are 32 url-safe characters and differ', () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newToken()).not.toBe(a);
  });
});

for (const backend of BACKENDS) {
  describe(`public payment link (${backend})`, () => {
    let owner: string;
    let invoiceId: number;
    const store = () => tenantOfOwner(e, 1);

    beforeEach(async () => {
      await seedWorld(backend);
      await e.DB.prepare(`DELETE FROM invoice_links`).run();
      owner = await login(PHONES.owner);
      invoiceId = (await (await store()).prepare(`SELECT id FROM invoices WHERE house_id = 'LVC' AND room_id = 3`).first<{ id: number }>())!.id;
    });

    const linkAs = async (token: string, id = invoiceId, house = 'LVC') => api(`/api/houses/${house}/invoices/${id}/public-link`, {}, token);

    it('opens one invoice without login and shows only what paying needs', async () => {
      const res = await linkAs(owner);
      expect(res.status).toBe(200);
      const { url } = (await res.json()) as { url: string };
      expect(url).toMatch(/^https:\/\/tro-hub\.onrender\.com\/#\/pay\/[A-Za-z0-9_-]{32}$/);
      // The resident of the room gets the same link; asking again does not change it.
      const resident = await login(PHONES.residentLvc);
      expect(((await (await linkAs(resident)).json()) as { url: string }).url).toBe(url);
      expect(((await (await linkAs(owner)).json()) as { url: string }).url).toBe(url);

      const page = await pub(tokenOf(url));
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-store');
      const body = (await page.json()) as any;
      expect(body.invoice).toMatchObject({ houseName: 'NHÀ TRỌ 109/6', room: '101', month: '11/2026', total: 3500000, paid: false, paidDate: null, dueDate: '08/11/2026' });
      expect(body.invoice.payCode).toMatch(/^002\d{3}112026$/);
      // An invoice from the old Sheet has no invoice_lines: its money columns are listed instead.
      expect(body.invoice.lines[0]).toEqual({ name: 'Tiền phòng', formula: '', amount: 3500000 });
      expect(Object.keys(body.invoice).sort()).toEqual(['bank', 'dueDate', 'houseName', 'lines', 'month', 'paid', 'paidDate', 'payCode', 'room', 'total']);
      const text = JSON.stringify(body);
      expect(text).not.toContain(PHONES.residentLvc);
      expect(text).not.toContain(PHONES.owner);
      expect(text).not.toContain('Cư dân LVC');
    });

    it('a resident cannot reach another room or rotate a link', async () => {
      const other = await login(PHONES.residentTk);
      expect((await linkAs(other)).status).toBe(403);
      const resident = await login(PHONES.residentLvc);
      expect((await api(`/api/houses/LVC/invoices/${invoiceId}/public-link/rotate`, { method: 'POST' }, resident)).status).toBe(403);
    });

    it('a draft has no link and reads like a wrong one', async () => {
      const { url } = (await (await linkAs(owner)).json()) as { url: string };
      await (await store()).prepare(`UPDATE invoices SET issued_at = NULL WHERE id = ?`).bind(invoiceId).run();
      const res = await pub(tokenOf(url));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ success: false, errorCode: 'LINK_NOT_FOUND' });
      const draft = await linkAs(owner);
      expect(draft.status).toBe(409);
      expect(await draft.json()).toMatchObject({ success: false, errorCode: 'INVOICE_DRAFT' });
    });

    it('once paid: the payment day, no bank account and no QR', async () => {
      const { url } = (await (await linkAs(owner)).json()) as { url: string };
      await (await store()).prepare(`UPDATE invoices SET status = 'paid', paid_at = '2026-11-20 13:10:00' WHERE id = ?`).bind(invoiceId).run();
      const body = (await (await pub(tokenOf(url))).json()) as any;
      expect(body.invoice).toMatchObject({ paid: true, paidDate: '20/11/2026', bank: null });
    });

    it('rotating kills the old link at once', async () => {
      const { url: before } = (await (await linkAs(owner)).json()) as { url: string };
      const rot = await api(`/api/houses/LVC/invoices/${invoiceId}/public-link/rotate`, { method: 'POST' }, owner);
      expect(rot.status).toBe(200);
      const { url: after } = (await rot.json()) as { url: string };
      expect(after).not.toBe(before);
      expect((await pub(tokenOf(before))).status).toBe(404);
      expect((await pub(tokenOf(after))).status).toBe(200);
    });

    it('staff get every link of a month at once; residents cannot', async () => {
      const res = await api('/api/houses/LVC/public-links?month=11/2026', {}, owner);
      expect(res.status).toBe(200);
      const { links } = (await res.json()) as { links: Record<string, string> };
      expect(Object.keys(links)).toEqual([String(invoiceId)]);
      // Same link as the single-invoice API, and asking again changes nothing.
      expect(((await (await linkAs(owner)).json()) as { url: string }).url).toBe(links[invoiceId]);
      expect(((await (await api('/api/houses/LVC/public-links?month=11/2026', {}, owner)).json()) as any).links).toEqual(links);
      expect((await api('/api/houses/LVC/public-links?month=11/2026', {}, await login(PHONES.residentLvc))).status).toBe(403);
    });

    it('the link is not a login', async () => {
      const { url } = (await (await linkAs(owner)).json()) as { url: string };
      for (const path of ['/api/houses/LVC/invoices', '/api/payment/status', '/api/me', '/api/tenant/session'])
        expect((await api(path, {}, tokenOf(url))).status, path).toBe(401);
    });

    it('locks an IP that keeps guessing', async () => {
      const { url } = (await (await linkAs(owner)).json()) as { url: string };
      for (let i = 0; i < PUBLIC_LINK_LIMITS.maxMisses; i++) expect((await pub(newToken())).status).toBe(404);
      const locked = await pub(tokenOf(url));
      expect(locked.status).toBe(429);
      expect(await locked.json()).toMatchObject({ success: false, errorCode: 'TOO_MANY_TRIES' });
      expect((await pub(tokenOf(url), '198.51.100.9')).status).toBe(200); // another address is not affected
    });
  });
}
