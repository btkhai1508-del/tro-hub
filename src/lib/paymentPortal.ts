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
}

export const DEFAULT_PORTAL: PaymentPortal = {
  ready: true,
  bankBin: '970422',
  bankCode: 'mbbank',
  bankName: 'MB BANK',
  accountNo: '0902371800',
  accountName: 'Bùi Trung Khải',
  zaloCheckout: true,
};

/** VietQR draws the code from bank BIN + account; amount and content are filled in for the resident. */
export function vietQrUrl(portal: Pick<PaymentPortal, 'bankBin' | 'accountNo' | 'accountName'>, amount?: number, addInfo?: string) {
  const params = new URLSearchParams();
  if (amount) params.set('amount', String(amount));
  if (addInfo) params.set('addInfo', addInfo);
  if (portal.accountName) params.set('accountName', portal.accountName);
  return `https://img.vietqr.io/image/${portal.bankBin}-${portal.accountNo}-qr_only.png?${params}`;
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
        if (alive && result?.portal.ready) setPortal(result.portal);
      });
    return () => { alive = false; };
  }, []);
  return portal;
}
