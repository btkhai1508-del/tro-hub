import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WORKER_API_URL } from '../lib/api';
import { DEFAULT_PORTAL, vietQrUrl } from '../lib/paymentPortal';
import { Check, CheckCircle2, Copy } from './AppIcons';

/**
 * Public payment page of one invoice, opened from the QR on the printed invoice (no login).
 * Read-only and self-contained: no sidebar, no menu, no link into the app, and it never sends or reads
 * the app's session. The Worker answers only what paying needs (house, room, month, fees, total, bank
 * account, pay code); once paid there is no account and no QR.
 */
export interface PublicInvoice {
  houseName: string;
  room: string;
  month: string;
  lines: { name: string; formula: string; amount: number }[];
  total: number;
  payCode: string | null;
  dueDate: string;
  paid: boolean;
  paidDate: string | null;
  bank: { bin: string; name: string | null; accountNo: string; accountName: string } | null;
}

const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`;

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; invoice: PublicInvoice };

export function PublicInvoicePage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    // A plain fetch on purpose: no Authorization header, so a signed-in session is never involved.
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

  useEffect(() => {
    document.title = state.kind === 'ready' ? `Thanh toán phòng ${state.invoice.room} · Tháng ${state.invoice.month}` : 'Thanh toán tiền phòng';
  }, [state]);

  return (
    <main className="min-h-[100dvh] bg-[#f5f5f7] px-4 py-6 sm:py-10 dark:bg-[#101114]">
      <div className="mx-auto w-full max-w-3xl">
        <p className="mb-3 text-center apple-footnote kit-text-secondary">Trọ Hub · Trang thanh toán</p>
        {state.kind === 'loading' && (
          <section className="liquid-panel p-6 text-center" role="status">
            <p className="apple-body kit-text-secondary">Đang tải hoá đơn…</p>
          </section>
        )}
        {state.kind === 'error' && (
          <section className="liquid-panel p-6 text-center">
            <h1 className="apple-title3 font-semibold kit-text-primary">Không mở được hoá đơn</h1>
            <p role="alert" className="mt-2 apple-body kit-text-secondary">{state.message}</p>
          </section>
        )}
        {state.kind === 'ready' && <InvoiceCard invoice={state.invoice} />}
      </div>
    </main>
  );
}

function InvoiceCard({ invoice }: { invoice: PublicInvoice }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  // A house without its own account still pays into the old one (same rule as the resident app).
  const bank = invoice.paid ? null : invoice.bank ?? { bin: DEFAULT_PORTAL.bankBin, name: DEFAULT_PORTAL.bankName, accountNo: DEFAULT_PORTAL.accountNo, accountName: DEFAULT_PORTAL.accountName };
  const qr = bank && invoice.payCode ? vietQrUrl({ bankBin: bank.bin, accountNo: bank.accountNo, accountName: bank.accountName }, invoice.total, invoice.payCode) : null;

  const copy = async (text: string, key: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError('Chưa sao chép được. Bạn có thể nhấn giữ để chọn chữ.');
    }
  };

  const CopyRow = ({ label, value, id, mono }: { label: string; value: string; id: string; mono?: boolean }) => (
    <div className="flex items-center justify-between gap-3 py-2.5 apple-body">
      <span className="kit-text-secondary">{label}</span>
      <button type="button" aria-label={`Sao chép ${label.toLowerCase()}`} onClick={() => copy(value, id)}
        className="group inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2 text-right hover:bg-black/5 dark:hover:bg-white/10">
        <span className={`font-semibold kit-text-primary ${mono ? 'font-num tracking-wide' : ''}`}>{value}</span>
        {copied === id
          ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Copy size={13} strokeWidth={2} className="shrink-0 text-neutral-400 group-hover:text-neutral-800 dark:text-neutral-500 dark:group-hover:text-white" />}
      </button>
    </div>
  );

  return (
    <article className="liquid-panel overflow-hidden" aria-labelledby="public-invoice-title">
      <header className="border-b border-black/5 px-5 py-4 dark:border-white/10 sm:px-6">
        <h1 id="public-invoice-title" className="apple-title2 font-semibold kit-text-primary">{invoice.houseName}</h1>
        <p className="mt-1 apple-body kit-text-secondary">Phòng {invoice.room} · Tháng {invoice.month}</p>
        {invoice.paid ? (
          <p role="status" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 apple-callout font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <CheckCircle2 size={16} />
            {invoice.paidDate ? `Đã thanh toán ngày ${invoice.paidDate}` : 'Đã thanh toán'}
          </p>
        ) : invoice.dueDate ? (
          <p className="mt-2 apple-callout kit-text-secondary">Hạn thanh toán: <span className="font-semibold kit-text-primary">{invoice.dueDate}</span></p>
        ) : null}
      </header>

      <div className="px-5 py-4 sm:px-6">
        <table className="w-full apple-body">
          <thead>
            <tr className="text-left apple-footnote kit-text-secondary">
              <th className="pb-2 font-medium">Khoản</th>
              <th className="pb-2 font-medium">Chi tiết</th>
              <th className="pb-2 text-right font-medium">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-t border-black/5 dark:border-white/10">
                <td className="py-2.5 pr-2 kit-text-primary">{l.name}</td>
                <td className="py-2.5 pr-2 apple-callout kit-text-secondary font-num">{l.formula}</td>
                <td className="py-2.5 text-right font-num kit-text-primary">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-black/10 bg-black/[0.035] dark:border-white/15 dark:bg-white/[0.06]">
              <td colSpan={2} className="px-2 py-3 font-semibold kit-text-primary">Tổng cộng</td>
              <td className="px-2 py-3 text-right text-[20px] font-semibold font-num kit-text-primary">{money(invoice.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {bank && (
        <section aria-label="Chuyển khoản" className="grid gap-5 border-t border-black/5 px-5 py-5 dark:border-white/10 sm:grid-cols-[auto_1fr] sm:items-center sm:px-6">
          {qr ? (
            <figure className="mx-auto flex flex-col items-center">
              <img src={qr} alt={`Mã QR chuyển khoản ${money(invoice.total)}`} width={208} height={208} className="h-52 w-52 rounded-xl bg-white p-2" />
              <figcaption className="mt-2 apple-footnote kit-text-secondary">Quét bằng app ngân hàng</figcaption>
            </figure>
          ) : null}
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {bank.name ? <CopyRow label="Ngân hàng" value={bank.name} id="bank" /> : null}
            <CopyRow label="Số tài khoản" value={bank.accountNo} id="acc" mono />
            {bank.accountName ? <div className="flex items-center justify-between gap-3 py-2.5 apple-body"><span className="kit-text-secondary">Chủ tài khoản</span><span className="pr-2 font-semibold kit-text-primary">{bank.accountName}</span></div> : null}
            {invoice.payCode ? <CopyRow label="Mã đơn" value={invoice.payCode} id="code" mono /> : null}
            <CopyRow label="Số tiền" value={String(invoice.total)} id="amount" mono />
          </div>
          {copyError ? <p role="alert" className="apple-footnote text-red-700 dark:text-red-300 sm:col-span-2">{copyError}</p> : null}
          <p className="apple-footnote kit-text-secondary sm:col-span-2">Ghi đúng mã đơn ở nội dung chuyển khoản để hệ thống tự xác nhận.</p>
        </section>
      )}
    </article>
  );
}
