import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, ChevronRight, Clock3, CreditCard, Download, LockKeyhole, ReceiptText, WalletCards } from 'lucide-react';
import { useApp, type Invoice } from '../context/AppContext';
import { PaymentHistoryExportModal } from './PaymentHistoryExportModal';

export function InvoicesAndPayment() {
  const navigate = useNavigate();
  const { invoices, openInvoiceDetailModal, paymentGateStatus } = useApp();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const unpaidInvoices = invoices.filter(invoice => invoice.status === 'unpaid');
  const totalUnpaidAmount = unpaidInvoices.reduce((total, invoice) => total + invoice.total, 0);
  const paidCount = invoices.filter(invoice => invoice.status === 'paid').length;
  const pendingCount = invoices.filter(invoice => invoice.status === 'pending').length;
  const currency = (amount: number) => amount.toLocaleString('vi-VN');
  const handlePay = (invoiceId: string) => navigate(`/payment?invoiceId=${invoiceId}`);

  const statusBadge = (status: Invoice['status']) => {
    if (status === 'paid') return <span className="badge-paid"><CheckCircle2 size={13} />Đã thanh toán</span>;
    if (status === 'pending') return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><Clock3 size={13} />Chờ xác nhận</span>;
    return <span className="badge-unpaid">Chưa thanh toán</span>;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-7 pb-6">
      <header data-tutorial="invoices-header" className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="liquid-eyebrow">TÀI CHÍNH CỦA BẠN</span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">Hóa đơn & thanh toán</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">Mọi khoản phí, rõ ràng trong một nơi.</p>
        </div>
        <button type="button" onClick={() => setIsExportModalOpen(true)} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 self-start px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
          <Download size={16} />Xuất lịch sử PDF
        </button>
      </header>

      <section aria-label="Tổng quan hóa đơn" className="liquid-panel overflow-hidden">
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl" />
          <div className="relative">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="glass-icon text-blue-600 dark:text-blue-400"><WalletCards size={21} /></span>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{unpaidInvoices.length ? 'Tổng cần thanh toán' : 'Tổng quan thanh toán'}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2 text-slate-900 dark:text-white">
              <span className="font-num text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{currency(totalUnpaidAmount)}</span>
              <span className="text-xl text-slate-400">₫</span>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {unpaidInvoices.length ? `${unpaidInvoices.length} hóa đơn đang chờ thanh toán` : invoices.length ? 'Bạn không có hóa đơn chưa thanh toán.' : 'Hóa đơn sẽ xuất hiện khi được phát hành.'}
            </p>
          </div>
          {unpaidInvoices.length > 0 && (
            <button type="button" onClick={() => handlePay(unpaidInvoices[0].id)} className="primary-button relative inline-flex min-h-12 items-center justify-center gap-2.5 px-6 py-3.5 text-sm md:self-end">
              {paymentGateStatus === 'STOP' ? <LockKeyhole size={17} /> : <CreditCard size={17} />}
              {paymentGateStatus === 'STOP' ? 'Xem thông tin thanh toán' : 'Thanh toán ngay'}<ArrowUpRight size={17} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-200/60 border-t border-white/70 bg-white/25 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.02]">
          {[{ label: 'Tất cả', value: invoices.length }, { label: 'Đã thanh toán', value: paidCount }, { label: 'Chờ xác nhận', value: pendingCount }].map(item => (
            <div key={item.label} className="px-3 py-4 text-center sm:px-6 sm:text-left">
              <span className="font-num text-xl font-semibold text-slate-900 dark:text-white">{item.value}</span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="invoice-list-heading" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 id="invoice-list-heading" className="liquid-section-title">Hóa đơn theo kỳ</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">{invoices.length} hóa đơn</span>
        </div>
        {invoices.length === 0 ? (
          <div className="liquid-panel flex flex-col items-center px-6 py-14 text-center">
            <span className="glass-icon mb-5 h-16 w-16 text-blue-500"><ReceiptText size={28} strokeWidth={1.5} /></span>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Chưa có hóa đơn</h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">Khi có khoản phí mới, bạn có thể xem chi tiết và theo dõi thanh toán tại đây.</p>
          </div>
        ) : invoices.map(invoice => (
          <article key={invoice.id} className="liquid-panel-subtle group flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center">
            <button type="button" onClick={() => openInvoiceDetailModal(invoice)} aria-label={`Xem chi tiết hóa đơn tháng ${invoice.month}`} className="flex min-w-0 flex-1 items-start gap-3.5 rounded-2xl text-left sm:items-center">
              <span className="glass-icon shrink-0 text-blue-600 dark:text-blue-400"><ReceiptText size={22} strokeWidth={1.6} /></span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">Tháng {invoice.month}</span>
                  {statusBadge(invoice.status)}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">Hạn nộp {invoice.dueDate} · {invoice.details.length} khoản phí</span>
              </span>
            </button>
            <div className="flex items-center justify-between gap-4 border-t border-slate-200/50 pt-4 dark:border-white/10 md:border-0 md:pt-0">
              <span className="font-num text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{currency(invoice.total)} <span className="text-sm font-normal text-slate-400">₫</span></span>
              {invoice.status === 'unpaid' ? (
                <button type="button" onClick={() => handlePay(invoice.id)} className="primary-button inline-flex min-h-11 items-center gap-2 px-4 py-2.5 text-xs">
                  {paymentGateStatus === 'STOP' ? <LockKeyhole size={14} /> : <CreditCard size={14} />}{paymentGateStatus === 'STOP' ? 'Xem thanh toán' : 'Thanh toán'}
                </button>
              ) : (
                <button type="button" onClick={() => openInvoiceDetailModal(invoice)} className="soft-button inline-flex min-h-11 items-center gap-1 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">Chi tiết<ChevronRight size={15} /></button>
              )}
            </div>
          </article>
        ))}
      </section>
      <PaymentHistoryExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
    </div>
  );
}
