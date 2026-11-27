import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WORKER_API_URL } from '../lib/api';
import { DEFAULT_PORTAL, vietQrUrl } from '../lib/paymentPortal';
import { prepareQrImage, saveQrToDevice } from '../lib/qrHelper';
import { PaymentDoneCard, PaymentQrPortal } from './PaymentPortalViews';

/**
 * Public payment page of one invoice, opened from the QR on the printed invoice (no login). It is the
 * resident's own payment portal, copied as is (same components), without back buttons or app links.
 * It never sends or reads the app's session: a plain fetch to the Worker, which answers only what paying
 * needs. Once paid it shows the same "paid" card, with no QR and no account.
 */
interface PublicInvoice {
  room: string;
  month: string;
  total: number;
  /** Earlier months still owed + this month: what the QR asks for ("Tổng cộng"). */
  amountDue?: number;
  payCode: string | null;
  paid: boolean;
  paidDate: string | null;
  bank: { bin: string; name: string | null; accountNo: string; accountName: string } | null;
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; invoice: PublicInvoice };

export function PublicInvoicePage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    // No Authorization header on purpose: a signed-in session is never involved.
    fetch(`${WORKER_API_URL}/api/public/invoice/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (!alive) return;
        if (res.ok && body?.success) setState({ kind: 'ready', invoice: body.invoice });
        else setState({ kind: 'error', message: body?.error || 'Link thanh toán không đúng hoặc đã được tạo lại.' });
      })
      .catch(() => alive && setState({ kind: 'error', message: 'Mất kết nối internet, vui lòng thử lại.' }));
    return () => { alive = false; };
  }, [token]);

  // While the page shows an unpaid invoice, ask again every 15 seconds: once the money arrives it turns into
  // the same "Thanh toán hoàn tất" card the resident sees. A paid invoice is final, so polling stops there.
  const waiting = state.kind === 'ready' && !state.invoice.paid;
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      fetch(`${WORKER_API_URL}/api/public/invoice/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => { if (alive && body?.success && body.invoice?.paid) setState({ kind: 'ready', invoice: body.invoice }); })
        .catch(() => {});
    }, 15000); // every 15 s, only while the tab is visible: a light load on the database
    return () => { alive = false; window.clearInterval(timer); };
  }, [waiting, token]);

  useEffect(() => {
    document.title = state.kind === 'ready' ? `Thanh toán phòng ${state.invoice.room} · Tháng ${state.invoice.month}` : 'Thanh toán tiền phòng';
  }, [state]);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-[#f7f8fa] px-3 py-4 sm:px-6 sm:py-8 dark:bg-[#101114]">
      {state.kind === 'loading' && (
        <div role="status" aria-label="Đang tải" className="flex items-center justify-center"><span aria-hidden="true" className="ui-spinner h-6 w-6" /></div>
      )}
      {state.kind === 'error' && (
        <div className="flex w-full justify-center py-6">
          <div className="soft-card max-w-md p-8 text-center">
            <h1 className="apple-title2 font-semibold kit-text-primary">Không mở được hoá đơn</h1>
            <p role="alert" className="mt-2 apple-body kit-text-secondary">{state.message}</p>
          </div>
        </div>
      )}
      {state.kind === 'ready' && <Portal invoice={state.invoice} />}
    </div>
  );
}

function Portal({ invoice }: { invoice: PublicInvoice }) {
  // A house without its own account still pays into the old one (same rule as the resident app).
  const bank = invoice.bank ?? { bin: DEFAULT_PORTAL.bankBin, name: DEFAULT_PORTAL.bankName, accountNo: DEFAULT_PORTAL.accountNo, accountName: DEFAULT_PORTAL.accountName };
  const due = invoice.amountDue || invoice.total; // pay the "Tổng cộng": earlier debt included
  const qrUrl = !invoice.paid && invoice.payCode
    ? vietQrUrl({ bankBin: bank.bin, accountNo: bank.accountNo, accountName: bank.accountName }, due, invoice.payCode)
    : '';
  const [isSavingQR, setIsSavingQR] = useState(false);
  const [qrSaveResult, setQrSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (qrUrl) prepareQrImage(qrUrl).catch(() => {});
  }, [qrUrl]);

  if (invoice.paid) {
    return (
      <div className="flex w-full justify-center py-6">
        <PaymentDoneCard total={invoice.total} room={invoice.room} month={invoice.month}
          statusText={invoice.paidDate ? `Đã thanh toán ngày ${invoice.paidDate}` : 'Đã thanh toán'} />
      </div>
    );
  }

  const handleSaveQR = async () => {
    if (isSavingQR || !qrUrl) return;
    setIsSavingQR(true);
    try {
      const result = await saveQrToDevice(qrUrl, `VietQR_${invoice.payCode}.png`);
      setQrSaveResult(result.message ? result : null);
    } finally {
      setIsSavingQR(false);
    }
  };

  return (
    <div className="flex w-full justify-center py-2">
      <PaymentQrPortal
        qrUrl={qrUrl}
        recipientName={bank.accountName}
        bankName={bank.name || ''}
        accountNumber={bank.accountNo}
        transferContent={invoice.payCode || ''}
        total={due}
        onSaveQR={handleSaveQR}
        isSavingQR={isSavingQR}
        qrSaveResult={qrSaveResult}
      />
    </div>
  );
}
