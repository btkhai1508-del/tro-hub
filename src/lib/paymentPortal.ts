/**
 * Who is signed in on the Cloudflare Worker, and the payment portal of their house: the bank
 * and account rent is paid into. Admin Tổng sets it per house; residents read their own house's.
 * Sessions without a Worker token (Zalo login, older sessions) fall back to the account the app
 * used before the portal existed.
 */
import { useEffect, useState } from 'react';
import { onWorkerSessionChange, workerFetch } from './api';

export interface WorkerViewer {
  kind: 'resident' | 'staff';
  id: number;
  name: string;
  role?: 'owner' | 'manager';
  houseId?: string;
  houseIds?: string[];
  roomName?: string | null;
}

export interface PaymentPortal {
  ready: boolean;
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  zaloCheckout: boolean;
  /** Số căn + số phòng của cư dân (6 số). Nội dung chuyển khoản = payPrefix + MMYYYY. Null khi chưa biết. */
  payPrefix?: string | null;
}

export const DEFAULT_PORTAL: PaymentPortal = {
  ready: true,
  bankBin: '970422',
  bankCode: 'mbbank',
  bankName: 'MB BANK',
  accountNo: '0902371800',
  accountName: 'Bùi Trung Khải',
  zaloCheckout: true,
  payPrefix: null,
};

const VIETINBANK_BIN = '970415';

/** SePay prints the holder without accents: "Bùi Trung Khải" → "BUI TRUNG KHAI". */
const plainName = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 50);

/**
 * The transfer QR, drawn by SePay's VietQR service (vietqr.app) from bank BIN + account, with amount
 * and content filled in for the resident. VietinBank personal / household accounts only report a
 * transfer to SePay when the content carries "SEVQR", so it goes first there.
 * Docs: https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
 */
export function vietQrUrl(portal: Pick<PaymentPortal, 'bankBin' | 'accountNo' | 'accountName'>, amount?: number, addInfo?: string) {
  const params = new URLSearchParams({ acc: portal.accountNo, bank: portal.bankBin });
  if (amount) params.set('amount', String(Math.round(amount)));
  const des = portal.bankBin === VIETINBANK_BIN && addInfo && !/SEVQR/i.test(addInfo) ? `SEVQR ${addInfo}` : addInfo;
  if (des) params.set('des', des);
  // "Chỉ QR": no VietQR logo, with the holder, masked account, amount and content printed under the code.
  params.set('template', 'qronly');
  params.set('showinfo', 'true');
  const holder = plainName(portal.accountName);
  if (holder) params.set('holder', holder);
  return `https://vietqr.app/img?${params}`;
}

let viewerRequest: Promise<WorkerViewer | null> | null = null;

/** One /api/me per page load; a new login reloads the app state anyway. */
export function loadWorkerViewer(): Promise<WorkerViewer | null> {
  viewerRequest ??= workerFetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => data?.viewer ?? null)
    .catch(() => null);
  return viewerRequest;
}

onWorkerSessionChange(() => {
  viewerRequest = null;
});

export function useWorkerViewer(): WorkerViewer | null {
  const [viewer, setViewer] = useState<WorkerViewer | null>(null);
  useEffect(() => {
    let alive = true;
    loadWorkerViewer().then((v) => alive && setViewer(v));
    return () => { alive = false; };
  }, []);
  return viewer;
}

export async function fetchPaymentPortal(houseId: string): Promise<{ portal: PaymentPortal; canEdit: boolean } | null> {
  const res = await workerFetch(`/api/houses/${encodeURIComponent(houseId)}/payment-portal`).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  return data?.success ? { portal: data.portal, canEdit: Boolean(data.canEdit) } : null;
}

/** The portal of the signed-in resident's house, or the old default until (or unless) it loads. */
export function usePaymentPortal(): PaymentPortal {
  const [portal, setPortal] = useState<PaymentPortal>(DEFAULT_PORTAL);
  useEffect(() => {
    let alive = true;
    loadWorkerViewer()
      .then((viewer) => (viewer?.kind === 'resident' && viewer.houseId ? fetchPaymentPortal(viewer.houseId) : null))
      .then((result) => {
        if (!alive || !result) return;
        // A house without its own account still pays into the old one, but with its own transfer code.
        setPortal(result.portal.ready ? result.portal : { ...DEFAULT_PORTAL, payPrefix: result.portal.payPrefix ?? null });
      });
    return () => { alive = false; };
  }, []);
  return portal;
}
