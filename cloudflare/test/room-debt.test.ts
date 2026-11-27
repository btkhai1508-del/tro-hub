import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/app.ts';
import { allocate, type OpenInvoice } from '../src/billing/roomDue.ts';
import { settleRent } from '../src/payments/settle.ts';
import { tenantOfOwner } from '../src/tenant/route.ts';
import { api, BACKENDS, login, PHONES, seedWorld } from './helpers.ts';

const e = env as unknown as Env;
const open = (id: number, month: string, remaining: number): OpenInvoice => ({ id, month, total: remaining, received: 0, remaining, sheet_row: null });

describe('allocate', () => {
  it('pays the oldest invoices first, the rest goes to the month itself', () => {
    const older = [open(1, '2026-10', 300), open(2, '2026-11', 500)];
    expect(allocate(1000, older, 9)).toEqual([{ invoiceId: 1, amount: 300 }, { invoiceId: 2, amount: 500 }, { invoiceId: 9, amount: 200 }]);
    expect(allocate(400, older, 9)).toEqual([{ invoiceId: 1, amount: 300 }, { invoiceId: 2, amount: 100 }]);
    expect(allocate(800, older, 9)).toEqual([{ invoiceId: 1, amount: 300 }, { invoiceId: 2, amount: 500 }]);
    expect(allocate(500, [], 9)).toEqual([{ invoiceId: 9, amount: 500 }]);
    expect(allocate(500, [], null)).toEqual([{ invoiceId: null, amount: 500 }]);
    expect(allocate(0, older, 9)).toEqual([{ invoiceId: 9, amount: 0 }]); // never an empty list
  });
});

for (const backend of BACKENDS) {
  describe(`payment follows "Tổng cộng" with old debt (${backend})`, () => {
    const store = () => tenantOfOwner(e, 1);
    let nov: number; // seeded: LVC 101, 11/2026, 3.500.000, issued, unpaid
    let dec: number;
    const transfer = (amount: number) => ({ transferAmount: amount, content: 'x', transactionDate: '2026-12-03 09:00:00' });
    const statusOf = async (id: number) => (await (await store()).prepare(`SELECT status, status_by FROM invoices WHERE id = ?`).bind(id).first<any>())!;
    const paysOf = async () => (await (await store()).prepare(`SELECT invoice_id, amount, reference FROM payments WHERE house_id = 'LVC' ORDER BY id`).all<any>()).results;

    beforeEach(async () => {
      await seedWorld(backend);
      await e.DB.prepare(`DELETE FROM invoice_links`).run();
      await e.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_sync:2026-12', ?)`).bind(new Date().toISOString()).run(); // no Sheet read
      const db = await store();
      nov = (await db.prepare(`SELECT id FROM invoices WHERE house_id = 'LVC' AND room_id = 3 AND month = '2026-11'`).first<{ id: number }>())!.id;
      await db.prepare(`INSERT INTO invoices (house_id, room_id, month, room_rent, total, status, issued_at) VALUES ('LVC', 3, '2026-12', 1000000, 1000000, 'unpaid', '2026-12-01 00:00:00')`).run();
      dec = (await db.prepare(`SELECT id FROM invoices WHERE house_id = 'LVC' AND room_id = 3 AND month = '2026-12'`).first<{ id: number }>())!.id;
    });

    it('the public page and the link ask for earlier debt + this month', async () => {
      const owner = await login(PHONES.owner);
      const link = (await (await api(`/api/houses/LVC/invoices/${dec}/public-link`, {}, owner)).json()) as any;
      expect(link).toMatchObject({ previousDebt: 3_500_000, amountDue: 4_500_000 });
      const page = (await (await api(`/api/public/invoice/${link.url.split('/pay/')[1]}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } })).json()) as any;
      expect(page.invoice).toMatchObject({ total: 1_000_000, previousDebt: 3_500_000, amountDue: 4_500_000, paid: false });
      // November itself has no earlier debt.
      const novLink = (await (await api(`/api/houses/LVC/invoices/${nov}/public-link`, {}, owner)).json()) as any;
      expect(novLink).toMatchObject({ previousDebt: 0, amountDue: 3_500_000 });
    });

    it('the resident app gets the same amount to pay', async () => {
      const resident = await login(PHONES.residentLvc);
      const { invoices } = (await (await api('/api/tenant/session', {}, resident)).json()) as any;
      expect(invoices.find((i: any) => i.id === `INV-${dec}`)).toMatchObject({ total: 1_000_000, previousDebt: 3_500_000, amountDue: 4_500_000 });
      expect(invoices.find((i: any) => i.id === `INV-${nov}`)).toMatchObject({ previousDebt: 0, amountDue: 3_500_000 });
    });

    it('the full amount pays both invoices, oldest first, each part with its own reference', async () => {
      const r = await settleRent(e, 1, 'LVC', '101', '2026-12', transfer(4_500_000), 'D1');
      expect(r).toMatchObject({ settled: true, invoiceId: dec, received: 1_000_000 });
      expect(await statusOf(nov)).toMatchObject({ status: 'paid', status_by: 'sepay' });
      expect(await statusOf(dec)).toMatchObject({ status: 'paid', status_by: 'sepay' });
      expect(await paysOf()).toEqual([
        { invoice_id: nov, amount: 3_500_000, reference: 'sepay-D1' },
        { invoice_id: dec, amount: 1_000_000, reference: `sepay-D1#${dec}` },
      ]);
      // The same transfer again (retry, replay) books nothing more.
      await settleRent(e, 1, 'LVC', '101', '2026-12', transfer(4_500_000), 'D1');
      expect(await paysOf()).toHaveLength(2);
    });

    it('a short transfer pays the old debt first; the month waits', async () => {
      const r = await settleRent(e, 1, 'LVC', '101', '2026-12', transfer(2_000_000), 'D2');
      expect(r).toMatchObject({ settled: false, reason: 'short', invoiceId: dec, received: 0 });
      expect(await statusOf(nov)).toMatchObject({ status: 'unpaid' });
      expect(await paysOf()).toEqual([{ invoice_id: nov, amount: 2_000_000, reference: 'sepay-D2' }]);
      const resident = await login(PHONES.residentLvc);
      const { invoices } = (await (await api('/api/tenant/session', {}, resident)).json()) as any;
      expect(invoices.find((i: any) => i.id === `INV-${dec}`)).toMatchObject({ previousDebt: 1_500_000, amountDue: 2_500_000 });
      // The rest arrives: both paid.
      await settleRent(e, 1, 'LVC', '101', '2026-12', transfer(2_500_000), 'D3');
      expect(await statusOf(nov)).toMatchObject({ status: 'paid' });
      expect(await statusOf(dec)).toMatchObject({ status: 'paid' });
    });

    it('an overpayment stays on the month it was sent for', async () => {
      await settleRent(e, 1, 'LVC', '101', '2026-12', transfer(5_000_000), 'D4');
      expect(await paysOf()).toEqual([
        { invoice_id: nov, amount: 3_500_000, reference: 'sepay-D4' },
        { invoice_id: dec, amount: 1_500_000, reference: `sepay-D4#${dec}` },
      ]);
    });

    it('paying only the old month leaves the new one alone', async () => {
      const r = await settleRent(e, 1, 'LVC', '101', '2026-11', transfer(3_500_000), 'D5');
      expect(r).toMatchObject({ settled: true, invoiceId: nov });
      expect(await statusOf(dec)).toMatchObject({ status: 'unpaid' });
      expect(await paysOf()).toEqual([{ invoice_id: nov, amount: 3_500_000, reference: 'sepay-D5' }]);
    });
  });
}
