import { useDialogFocus } from '../lib/useDialogFocus';
import { useState } from 'react';
import { X, Download, QrCode, Lock } from './AppIcons';
import { Bike, Building2, Droplet, Landmark, ReceiptText, Trash2, Wallet, Wifi, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { getMeasurer } from '../lib/documents/engine';
import { saveDocument } from '../lib/documents/output';
import { residentInvoice } from '../lib/documents/fromProfile';
import { isDeposit } from '../lib/documents/stateFormat';

// Flat 2D icons, imported from lucide directly because AppIcons maps these names to 3D artwork.
const getCategoryIcon = (detail: { type: string; name: string }) => {
  if (isDeposit(detail)) return <Landmark size={16} className="text-slate-700" />;
  switch (detail.type) {
    case 'room':
      return <Building2 size={16} className="text-slate-700" />;
    case 'electricity':
      return <Zap size={16} className="text-slate-700" />;
    case 'water':
      return <Droplet size={16} className="text-slate-700" />;
    case 'internet':
      return <Wifi size={16} className="text-slate-700" />;
    case 'service':
      return <Trash2 size={16} className="text-slate-700" />;
    case 'parking':
      return <Bike size={16} className="text-slate-700" />;
    default:
      return <ReceiptText size={16} className="text-slate-700" />;
  }
};

export function InvoiceDetailModal() {
  const navigate = useNavigate();
  const { viewingInvoice, closeInvoiceDetailModal, profile, invoices, paymentGateStatus } = useApp();

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const dialogRef = useDialogFocus(Boolean(viewingInvoice), closeInvoiceDetailModal);

  if (!viewingInvoice) return null;

  const isPaid = viewingInvoice.status === 'paid';
  const isPending = viewingInvoice.status === 'pending';
  const isUnpaid = viewingInvoice.status === 'unpaid';

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('vi-VN');
  };

  const handleDownloadInvoicePDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError('');
    try {
      const measurer = await getMeasurer();
      const result = await saveDocument(residentInvoice(measurer, profile, viewingInvoice, invoices));
      if (!result.ok && result.message) setExportError(result.message);
    } catch {
      setExportError('Chưa tạo được PDF. Vui lòng thử lại.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePayNow = () => {
    const id = viewingInvoice.id;
    closeInvoiceDetailModal();
    navigate(`/payment?invoiceId=${id}`);
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/25 backdrop-blur-md duration-200"
      onClick={closeInvoiceDetailModal}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title"
        className="tahoe-dialog w-full max-w-lg invoice-paper bg-white rounded-3xl flex flex-col max-h-[82dvh] sm:max-h-[86dvh] mb-14 sm:mb-0 overflow-hidden relative duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100"><Wallet size={21} className="text-slate-700" /></span>
            <div>
              <h3 id="invoice-detail-title" className="type-h3 text-slate-900 font-bold">Hóa đơn Tháng {viewingInvoice.month}</h3>
              <p className="type-caption text-neutral-600 font-num">Mã số: {viewingInvoice.id}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeInvoiceDetailModal}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/35 text-neutral-700 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 text-xs">

          {/* Summary Box */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-white border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-xs uppercase font-bold text-neutral-600 block">Tổng tiền</span>
              <span className="type-h2 font-num font-bold text-slate-900">
                {formatCurrency(viewingInvoice.total)} ₫
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs uppercase font-bold text-neutral-600 block">Hạn thanh toán</span>
              <span className="font-semibold text-slate-800 font-num">{viewingInvoice.dueDate}</span>
            </div>
          </div>

          {/* Details breakdown */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-neutral-600 uppercase tracking-wider block">Chi tiết khoản phí</span>

            <div className="divide-y divide-neutral-200 border border-slate-100 rounded-2xl overflow-hidden bg-white">
              {viewingInvoice.details.map((detail, idx) => {
                return (
                  <div key={idx} className="p-2.5 sm:p-3 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        {getCategoryIcon(detail)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate leading-tight">{detail.name}</p>
                        {detail.metric && (
                          <p className="text-xs text-neutral-600 font-num mt-0.5">{detail.metric}</p>
                        )}
                        {isDeposit(detail) && (
                          <p className="text-xs text-neutral-600 mt-0.5">Không tính vào tổng tiền</p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 font-num">
                        {formatCurrency(detail.amount)} ₫
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}

          {/* Note */}
          <div className="p-3 rounded-xl bg-white border border-transparent text-xs text-neutral-700">
            {isPaid && (
              <p className="text-emerald-700 font-medium">✓ Đã thanh toán đầy đủ ({viewingInvoice.paidAt || 'Đã ghi nhận trên Google Sheet'}).</p>
            )}
            {isPending && (
              <p className="text-amber-700 font-medium">⏳ Đã ghi nhận giao dịch. Đang chờ Ban Quản Lý đối soát và cập nhật trên Google Sheet.</p>
            )}
            {isUnpaid && (
              <p>• Hóa đơn đã được gửi qua ứng dụng. Vui lòng thanh toán trước hạn {viewingInvoice.dueDate}.</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-3.5 border-t border-slate-100 bg-white flex items-center justify-between gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={handleDownloadInvoicePDF}
            disabled={isExporting}
            className="flex-1 sm:flex-initial soft-button text-xs py-2.5 px-3 sm:px-4 flex items-center justify-center gap-1.5 text-slate-700 cursor-pointer font-semibold transition-all"
            title="Tải hóa đơn dạng tệp PDF"
          >
            <Download size={14} />
            <span className="truncate">{isExporting ? 'Đang tạo PDF…' : 'Tải hóa đơn (PDF)'}</span>
          </button>

          {isUnpaid ? (
            <button
              type="button"
              onClick={handlePayNow}
              className="flex-1 sm:flex-initial primary-button text-xs py-2.5 px-3 sm:px-4 flex items-center justify-center gap-1.5 shadow-sm font-bold cursor-pointer transition-all"
              title={paymentGateStatus === 'STOP' ? 'Cổng thanh toán đang tạm đóng' : 'Quét mã VietQR thanh toán'}
            >
              {paymentGateStatus === 'STOP' ? (
                <>
                  <Lock size={14} className="text-amber-300" />
                  <span className="truncate">Thanh toán (Cổng đóng)</span>
                </>
              ) : (
                <>
                  <QrCode size={14} />
                  <span className="truncate">Thanh toán ngay</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={closeInvoiceDetailModal}
              className="soft-button text-xs py-2.5 px-5 text-slate-700 cursor-pointer font-medium"
            >
              Đóng
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
