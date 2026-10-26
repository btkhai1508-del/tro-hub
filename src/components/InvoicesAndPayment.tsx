import React, { useState } from 'react';
import '../styles/resident-tahoe.css';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, ChevronRight, Clock3, CreditCard, Download, LockKeyhole, ReceiptText, WalletCards } from './AppIcons';
import { IconWallet3D } from './Icons3D';
import { useApp, type Invoice } from '../context/AppContext';
import { PaymentHistoryExportModal } from './PaymentHistoryExportModal';

export function InvoicesAndPayment() {
  const navigate = useNavigate();
  const { invoices, openInvoiceDetailModal, paymentGateStatus } = useApp();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | Invoice['status']>('all');
  const [visibleCount, setVisibleCount] = useState(6);
  const filteredInvoices = invoices.filter(invoice => statusFilter === 'all' || invoice.status === statusFilter);
  const unpaidInvoices = invoices.filter(invoice => invoice.status === 'unpaid');
  const totalUnpaidAmount = unpaidInvoices.reduce((total, invoice) => total + invoice.total, 0);
  const currency = (amount: number) => amount.toLocaleString('vi-VN');
  const handlePay = (invoiceId: string) => navigate(`/payment?invoiceId=${invoiceId}`);

  const statusBadge = (status: Invoice['status']) => {
    if (status === 'paid') return <span className="badge-paid"><CheckCircle2 size={13} />Đã thanh toán</span>;
    if (status === 'pending') return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 apple-callout font-semibold text-amber-700 dark:text-amber-300"><Clock3 size={13} />Chờ xác nhận</span>;
    return <span className="badge-unpaid">Chưa thanh toán</span>;
  };

  return (
    <div className="kit-page mx-auto max-w-5xl pb-6">
      <header data-tutorial="invoices-header" className="kit-page-header">
        <div>
          <p className="kit-page-kicker">Quản lý chi phí</p>
          <h1 className="kit-page-title">Hóa đơn & thanh toán</h1>
          <p className="kit-page-description">Xem từng khoản phí và theo dõi lịch sử thanh toán.</p>
        </div>
        <button type="button" onClick={() => setIsExportModalOpen(true)} className="soft-button inline-flex min-h-11 items-center justify-center gap-2 self-start px-4 py-3 apple-control kit-text-secondary">
          <Download size={16} />Xuất lịch sử PDF
        </button>
      </header>

      <section aria-label="Tổng quan hóa đơn" className="liquid-panel overflow-hidden">
        <div className="relative flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-center md:justify-between">
          <div className="relative">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="glass-icon kit-text-secondary icon-plate"><IconWallet3D size={48} /></span>
              <span className="apple-body font-medium kit-text-secondary">{unpaidInvoices.length ? 'Tổng cần thanh toán' : 'Tổng quan thanh toán'}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2 kit-text-primary">
              <span className="font-num text-[38px] leading-none font-semibold tracking-[-0.04em] sm:text-[40px]">{currency(totalUnpaidAmount)}</span>
              <span className="apple-title1 kit-text-secondary">₫</span>
            </div>
            <p className="mt-3 apple-body kit-text-secondary">
              {unpaidInvoices.length ? `${unpaidInvoices.length} hóa đơn đang chờ thanh toán` : invoices.length ? 'Bạn không có hóa đơn chưa thanh toán.' : 'Hóa đơn sẽ xuất hiện khi được phát hành.'}
            </p>
          </div>
          {unpaidInvoices.length > 0 && (
            <button type="button" onClick={() => handlePay(unpaidInvoices[0].id)} className="primary-button relative inline-flex min-h-12 items-center justify-center gap-2.5 px-6 py-3.5 apple-control md:self-end">
              {paymentGateStatus === 'STOP' ? <LockKeyhole size={17} /> : <CreditCard size={17} />}
              {paymentGateStatus === 'STOP' ? 'Xem thông tin thanh toán' : 'Thanh toán ngay'}<ArrowUpRight size={17} />
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="invoice-list-heading" className="liquid-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-4 dark:border-white/10 sm:px-6">
          <h2 id="invoice-list-heading" className="kit-card-heading">Hóa đơn theo kỳ</h2>
          <label className="resident-invoice-filter flex min-h-11 items-center gap-2 apple-callout kit-text-secondary">
            <span className="sr-only">Lọc hóa đơn</span>
            <select aria-label="Lọc hóa đơn" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setVisibleCount(6); }} className="kit-field min-h-11 max-w-full px-3 py-2 apple-callout">
              <option value="all">Tất cả kỳ</option><option value="unpaid">Chưa thanh toán</option><option value="pending">Chờ xác nhận</option><option value="paid">Đã thanh toán</option>
            </select>
          </label>
        </div>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="glass-icon mb-5 h-16 w-16 text-neutral-700 icon-plate"><IconWallet3D size={64} /></span>
            <h3 className="apple-title2 font-semibold kit-text-primary">Chưa có hóa đơn</h3>
            <p className="mt-2 max-w-xs apple-body leading-relaxed kit-text-secondary">Khi có khoản phí mới, bạn có thể xem chi tiết và theo dõi thanh toán tại đây.</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div role="status" className="px-5 py-9 text-center">
            <p className="apple-body font-medium kit-text-primary">Không có hóa đơn ở trạng thái này.</p>
            <button type="button" onClick={() => setStatusFilter('all')} className="soft-button mt-4 min-h-11 px-4">Xem tất cả kỳ</button>
          </div>
        ) : filteredInvoices.slice(0, visibleCount).map(invoice => (
          <article key={invoice.id} className="kit-list-row group flex flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row md:items-center">
            <button type="button" onClick={() => openInvoiceDetailModal(invoice)} aria-label={`Xem chi tiết hóa đơn tháng ${invoice.month}`} className="flex min-h-12 min-w-0 flex-1 items-start gap-3.5 rounded-2xl text-left sm:items-center">
              <span className="glass-icon shrink-0 kit-text-secondary icon-plate"><IconWallet3D size={52} /></span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="apple-title3 font-semibold tracking-tight kit-text-primary">Tháng {invoice.month}</span>
                  {statusBadge(invoice.status)}
                </span>
                <span className="mt-1.5 block apple-callout leading-relaxed kit-text-secondary">Hạn nộp {invoice.dueDate} · {invoice.details.length} khoản phí</span>
              </span>
            </button>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200/50 pt-4 dark:border-white/10 md:border-0 md:pt-0">
              <span className="font-num apple-title1 font-semibold tracking-tight kit-text-primary">{currency(invoice.total)} <span className="apple-body font-normal kit-text-secondary">₫</span></span>
              {invoice.status === 'unpaid' ? (
                <button type="button" onClick={() => handlePay(invoice.id)} className="primary-button inline-flex min-h-11 items-center gap-2 px-4 py-2.5 apple-control">
                  {paymentGateStatus === 'STOP' ? <LockKeyhole size={14} /> : <CreditCard size={14} />}{paymentGateStatus === 'STOP' ? 'Xem thanh toán' : 'Thanh toán'}
                </button>
              ) : (
                <button type="button" onClick={() => openInvoiceDetailModal(invoice)} className="soft-button inline-flex min-h-11 items-center gap-1 px-4 py-2.5 apple-control kit-text-secondary">Chi tiết<ChevronRight size={15} /></button>
              )}
            </div>
          </article>
        ))}
        {filteredInvoices.length > visibleCount && <div className="border-t border-[var(--separator)] p-4 text-center"><button type="button" onClick={() => setVisibleCount(count => count + 6)} className="soft-button min-h-11 px-5">Xem thêm hóa đơn</button></div>}
      </section>
      <PaymentHistoryExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
    </div>
  );
}
