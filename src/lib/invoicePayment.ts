/**
 * The payment block of a printed invoice (worker mode only): a QR that LINKS to the invoice's public
 * payment page (no login, that page only), next to the landlord's account and the pay code. In the app
 * itself the payment page keeps the bank QR. A paid invoice never gets a block. Google Sheet mode is
 * unchanged: no block at all.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ensureSource, workerFetch } from './api';
import type { InvoicePayment } from './documents/stateFormat';
import { DEFAULT_PORTAL } from './paymentPortal';

/** The Worker id of an invoice from the app's `INV-<id>`; null for anything else. */
export function workerInvoiceId(id: string | number | null | undefined): number | null {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0 ? id : null;
  const m = String(id ?? '').match(/^INV-(\d+)$/);
  return m ? Number(m[1]) : null;
}

const linkPath = (houseId: string, invoiceId: number) => `/api/houses/${encodeURIComponent(houseId)}/invoices/${invoiceId}/public-link`;

export interface PublicLink { url: string; payCode: string | null; bank: { name: string | null; accountNo: string; accountName: string } | null; previousDebt?: number }

async function readLink(res: Response): Promise<PublicLink> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || typeof body.url !== 'string') throw new Error(body?.error || 'Chưa lấy được link thanh toán.');
  return { url: body.url, payCode: body.payCode ?? null, bank: body.bank ?? null, previousDebt: typeof body.previousDebt === 'number' ? body.previousDebt : undefined };
}

/** The public link of an issued invoice (created on first use), with its pay code and the house's bank account. */
export async function fetchPublicLink(houseId: string, invoiceId: number): Promise<PublicLink> {
  return readLink(await workerFetch(linkPath(houseId, invoiceId)));
}

/** Staff: a new link; the old one stops working at once. */
export async function rotatePublicLink(houseId: string, invoiceId: number): Promise<PublicLink> {
  return readLink(await workerFetch(`${linkPath(houseId, invoiceId)}/rotate`, { method: 'POST' }));
}

/** A QR of `text` as a PNG data URL with a transparent background and no quiet zone. */
export function qrPng(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000ff', light: '#00000000' } });
}

export interface PaymentBlockInput {
  houseId?: string | null;
  invoiceId?: number | null;
  paid: boolean;
  /** Bumped after "Tạo lại link" so the QR is drawn again from the new link. */
  revision?: number;
}

/**
 * `undefined` while it is being prepared, `null` when the invoice gets no block (paid, sheet mode,
 * draft, no link), else the block. Callers wait for a non-undefined value before drawing the PDF, so
 * the document never flashes without (then with) its QR.
 */
export function usePaymentBlock({ houseId, invoiceId, paid, revision = 0 }: PaymentBlockInput): InvoicePayment | null | undefined {
  const [state, setState] = useState<{ key: string; value: InvoicePayment | null } | null>(null);
  const key = [houseId, invoiceId, paid, revision].join('|');

  useEffect(() => {
    let alive = true;
    const done = (value: InvoicePayment | null) => alive && setState({ key, value });
    if (paid || !houseId || !invoiceId) {
      done(null);
    } else {
      ensureSource()
        .then(async (source) => {
          if (source !== 'worker') return done(null);
          const link = await fetchPublicLink(houseId, invoiceId);
          // A house without its own account still pays into the old one (same rule as the app and the public page).
          const bank = link.bank ?? { name: DEFAULT_PORTAL.bankName, accountNo: DEFAULT_PORTAL.accountNo, accountName: DEFAULT_PORTAL.accountName };
          done({ qrPng: await qrPng(link.url), accountNo: bank.accountNo, bankName: bank.name, accountName: bank.accountName, payCode: link.payCode, previousDebt: link.previousDebt });
        })
        .catch(() => done(null)); // no link (draft, offline): the invoice prints without the QR, as before
    }
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return state?.key === key ? state.value : undefined;
}

/** Staff: the public link of every issued invoice of a house in a month, by invoice id. */
export async function fetchMonthLinks(houseId: string, month: string): Promise<Record<number, string>> {
  const res = await workerFetch(`/api/houses/${encodeURIComponent(houseId)}/public-links?month=${encodeURIComponent(month)}`);
  const body = await res.json().catch(() => null);
  return res.ok && body?.success ? body.links ?? {} : {};
}

/**
 * The links of the given houses for a month, keyed "houseId|invoiceId"; reloads when the month or the set of
 * houses changes. Worker mode only (pass enabled = false otherwise).
 */
export function useMonthLinks(enabled: boolean, month: string, houseIds: string[]): Record<string, string> {
  const [links, setLinks] = useState<Record<string, string>>({});
  const key = enabled ? `${month}|${[...new Set(houseIds)].sort().join(',')}` : '';
  useEffect(() => {
    if (!key) { setLinks({}); return; }
    let alive = true;
    const ids = key.split('|')[1].split(',').filter(Boolean);
    Promise.all(ids.map(async (h) => [h, await fetchMonthLinks(h, month).catch(() => ({}))] as const)).then((all) => {
      if (!alive) return;
      const out: Record<string, string> = {};
      for (const [h, map] of all) for (const [id, url] of Object.entries(map)) out[`${h}|${id}`] = url;
      setLinks(out);
    });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return links;
}
