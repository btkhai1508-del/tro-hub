import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CreditCard, 
  CheckCircle2, 
  ChevronRight,
  ShieldCheck,
  Clock,
  Printer,
  Lock
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { GlassIconInvoice } from './GlassIcons';
import { PaymentHistoryExportModal } from './PaymentHistoryExportModal';

export function InvoicesAndPayment() {
  const navigate = useNavigate();
  const { invoices, openInvoiceDetailModal, paymentGateStatus } = useApp();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('vi-VN');
  };

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
  const totalUnpaidAmount = unpaidInvoices.reduce((acc, curr) => acc + curr.total, 0);

  const handlePay = (invoiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/payment?invoiceId=${invoiceId}`);
  };

  const renderStatusBadge = (status: 'unpaid' | 'paid' | 'pending') => {
    if (status === 'paid') {
      return (
        <span className="badge-paid text-[10px] py-0.5 inline-flex items-center gap-1">
          <CheckCircle2 size={12} />
          <span>Đã thanh toán</span>
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="text-[10px] py-0.5 px-2 bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 rounded-full font-semibold inline-flex items-center gap-1 shadow-2xs">
          <Clock size={11} />
          <span>Chờ xác nhận</span>
        </span>
      );
    }
    return (
      <span className="badge-unpaid text-[10px] py-0.5 inline-flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
        <span>Chưa thanh toán</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
      
      {/* Header */}
      <div data-tutorial="invoices-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="type-label text-slate-500 dark:text-slate-400">Tài chính & Thu phí</span>
          <h1 className="type-h1 text-slate-900 dark:text-slate-100 mt-1 font-bold">Lịch sử hóa đơn</h1>
          <p className="type-body text-slate-500 dark:text-slate-400 mt-1">
            Theo dõi các khoản phí hàng tháng, trạng thái thanh toán và biên lai điện tử.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Printer size={15} />
            <span>Tải sao kê (PDF)</span>
          </button>
        </div>
      </div>

      {/* Summary Card if there are unpaid invoices */}
      {unpaidInvoices.length > 0 && (
        <div className="soft-surface p-6 relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-rose-500 dark:border-rose-500">
          <div>
            <span className="badge-unpaid text-xs">Cần thanh toán</span>
            <div className="type-display font-num text-slate-900 dark:text-slate-100 mt-1 font-bold">
              {formatCurrency(totalUnpaidAmount)} <span className="text-xl font-normal text-slate-400 dark:text-slate-500">₫</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Bạn có {unpaidInvoices.length} hóa đơn chưa thanh toán. Vui lòng hoàn tất trước ngày đến hạn.
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => handlePay(unpaidInvoices[0].id, e)}
            className="primary-button py-2.5 px-6 text-sm flex items-center gap-2 self-start sm:self-center font-bold cursor-pointer"
          >
            {paymentGateStatus === 'STOP' ? (
              <>
                <Lock size={16} className="text-amber-300" />
                <span>Thanh toán (Cổng đóng)</span>
              </>
            ) : (
              <>
                <CreditCard size={16} />
                <span>Thanh toán qua VietQR</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Invoices List */}
      <div className="space-y-3">
        <h2 className="type-h3 text-slate-800 dark:text-slate-200 font-bold px-1">Danh sách hóa đơn theo kỳ</h2>

        <div className="space-y-2.5">
          {invoices.length === 0 ? (
            <div className="soft-card p-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <GlassIconInvoice size={36} />
              </div>
              <h3 className="type-h3 text-slate-800 dark:text-slate-200 font-bold">Chưa có hóa đơn phát sinh</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Tài khoản của bạn hiện tại chưa có chi phí nào phát sinh trên hệ thống Google Sheet.
              </p>
            </div>
          ) : (
            invoices.map((invoice) => {
            const isUnpaid = invoice.status === 'unpaid';

            return (
              <div
                key={invoice.id}
                onClick={() => openInvoiceDetailModal(invoice)}
                className={cn(
                  "soft-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-all select-none group",
                  isUnpaid 
                    ? "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80" 
                    : "border-white/80 dark:border-slate-800/60 bg-white/70 dark:bg-slate-850/60"
                )}
              >
                {/* Left Column: Month, Frosted Glass Icon & Status */}
                <div className="flex items-center gap-4">
                  <GlassIconInvoice size={44} className="shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="type-h4 text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors font-bold">
                        Hóa đơn Tháng {invoice.month}
                      </h3>
                      {renderStatusBadge(invoice.status)}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-num mt-0.5">
                      Hạn nộp: {invoice.dueDate} • Mã HĐ: {invoice.id}
                    </p>
                  </div>
                </div>

                {/* Right Column: Amount & CTA */}
                <div className="flex items-center justify-between sm:justify-end gap-5 pt-3 sm:pt-0 border-t sm:border-0 border-slate-100 dark:border-slate-800">
                  <div className="text-left sm:text-right">
                    <span className="type-h3 font-num text-slate-900 dark:text-slate-100 font-bold block">
                      {formatCurrency(invoice.total)} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">₫</span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      {invoice.details.length} khoản mục phí
                    </span>
                  </div>

                  {isUnpaid ? (
                    <button
                      type="button"
                      onClick={(e) => handlePay(invoice.id, e)}
                      className="primary-button text-xs py-2 px-4 flex items-center gap-1.5 cursor-pointer font-bold"
                    >
                      {paymentGateStatus === 'STOP' ? (
                        <>
                          <Lock size={13} className="text-amber-300" />
                          <span>Tạm đóng</span>
                        </>
                      ) : (
                        <>
                          <CreditCard size={14} />
                          <span>Thanh toán</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors font-medium">
                      <span>Xem chi tiết</span>
                      <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
          )}
        </div>
      </div>

      {/* Payment History PDF Export Modal */}
      <PaymentHistoryExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />

    </div>
  );
}
