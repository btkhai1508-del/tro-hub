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
import { IconWallet3D } from './Icons3D';
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
        <span>Chưa thanh toán</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
      
      {/* Header */}
      <div data-tutorial="invoices-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="type-label text-slate-400 dark:text-slate-400">Tài chính & Thu phí</span>
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
            <span>Xuất lịch sử PDF</span>
          </button>
        </div>
      </div>

      {/* 3D Glassmorphism Summary Card for Pending Payment */}
      {unpaidInvoices.length > 0 && (
        <div className="relative overflow-hidden p-5 sm:p-6 rounded-3xl backdrop-blur-xl bg-gradient-to-br from-white/90 via-white/75 to-rose-50/50 dark:from-slate-900/90 dark:via-slate-850/80 dark:to-rose-950/30 border border-white/80 dark:border-white/10 shadow-[0_12px_36px_rgba(244,63,94,0.12),_0_2px_10px_rgba(0,0,0,0.04),_inset_0_1px_2px_rgba(255,255,255,0.9)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.12)] flex flex-col sm:flex-row sm:items-center justify-between gap-5 transition-all">
          {/* Subtle 3D Glass top sheen reflection */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/90 dark:via-white/25 to-transparent" />

          {/* Left Column: 3D Wallet Icon & Payment Details */}
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <div className="shrink-0 p-1.5 rounded-2xl bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm flex items-center justify-center">
              <IconWallet3D size={52} className="shrink-0 drop-shadow-sm" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20 backdrop-blur-md font-num">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  Cần thanh toán
                </span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Kỳ Tháng {unpaidInvoices[0]?.month || '10/2026'}
                </span>
              </div>

              <div className="type-display font-num text-slate-900 dark:text-slate-100 font-bold tracking-tight">
                {formatCurrency(totalUnpaidAmount)} <span className="text-xl font-normal text-slate-400 dark:text-slate-500">₫</span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                Bạn có {unpaidInvoices.length} hóa đơn chưa thanh toán · Vui lòng hoàn tất trước ngày đến hạn.
              </p>
            </div>
          </div>

          {/* Right Column: Payment CTA Button */}
          <div className="shrink-0 self-stretch sm:self-center flex sm:flex-col justify-end pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/50 dark:border-slate-800/60">
            <button
              type="button"
              onClick={(e) => handlePay(unpaidInvoices[0].id, e)}
              className="w-full sm:w-auto primary-button py-3 px-6 text-sm flex items-center justify-center gap-2.5 font-bold cursor-pointer shadow-lg shadow-slate-900/15 active:scale-[0.98] transition-all"
            >
              {paymentGateStatus === 'STOP' ? (
                <>
                  <Lock size={16} className="text-amber-300" />
                  <span>Thanh toán (Cổng đóng)</span>
                </>
              ) : (
                <>
                  <CreditCard size={16} />
                  <span>Thanh toán ngay</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Invoices List */}
      <div className="space-y-3">
        <h2 className="type-h3 text-slate-800 dark:text-slate-200 font-bold px-1">Danh sách hóa đơn theo kỳ</h2>

        <div className="space-y-2.5">
          {invoices.length === 0 ? (
            <div className="soft-card p-10 text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                <IconWallet3D size={48} />
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
                {/* Left Column: Month, 3D Wallet Icon & Status */}
                <div className="flex items-center gap-4">
                  <IconWallet3D size={48} className="shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="type-h4 text-slate-900 dark:text-slate-100 group-hover:text-slate-950 dark:group-hover:text-white transition-colors font-bold">
                        Hóa đơn Tháng {invoice.month}
                      </h3>
                      {renderStatusBadge(invoice.status)}
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-400 font-num mt-0.5">
                      Hạn nộp: {invoice.dueDate} · Mã HĐ: {invoice.id}
                    </p>
                  </div>
                </div>

                {/* Right Column: Amount & CTA */}
                <div className="flex items-center justify-between sm:justify-end gap-5 pt-3 sm:pt-0 border-t sm:border-0 border-slate-100 dark:border-slate-800">
                  <div className="text-left sm:text-right">
                    <span className="type-h3 font-num text-slate-900 dark:text-slate-100 font-bold block">
                      {formatCurrency(invoice.total)} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">₫</span>
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-400 block">
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
                    <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors font-medium">
                      <span>Chi tiết</span>
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
