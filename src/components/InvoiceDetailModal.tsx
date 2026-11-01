import { useDialogFocus } from '../lib/useDialogFocus';
import { X, QrCode, Lock } from './AppIcons';
import { useNavigate } from 'react-router-dom';
import { Invoice, useApp } from '../context/AppContext';
import { residentDocKey, residentInvoice } from '../lib/documents/fromProfile';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';

export function InvoiceDetailModal() {
  const { viewingInvoice } = useApp();
  if (!viewingInvoice) return null;
  return <InvoiceDocumentDialog invoice={viewingInvoice} />;
}

/** Shows the same administrative notice the PDF is made from. */
function InvoiceDocumentDialog({ invoice }: { invoice: Invoice }) {
  const navigate = useNavigate();
  const { closeInvoiceDetailModal, profile, invoices, paymentGateStatus } = useApp();
  const dialogRef = useDialogFocus(true, closeInvoiceDetailModal);
  const { doc, error } = useBuiltDocument(
    m => residentInvoice(m, profile, invoice, invoices),
    [residentDocKey(profile), JSON.stringify(invoice), invoices.map(item => `${item.id}:${item.status}:${item.total}`).join(',')].join('|')
  );

  const handlePayNow = () => {
    closeInvoiceDetailModal();
    navigate(`/payment?invoiceId=${invoice.id}`);
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/25 backdrop-blur-md duration-200"
      onClick={closeInvoiceDetailModal}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title"
        className="tahoe-dialog w-full max-w-3xl invoice-paper bg-white rounded-3xl flex flex-col max-h-[82dvh] sm:max-h-[90dvh] mb-14 sm:mb-0 overflow-hidden relative duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 sm:px-6 py-3 border-b border-neutral-200 bg-white">
          <h3 id="invoice-detail-title" className="type-h3 text-slate-900 font-bold">Hóa đơn tháng {invoice.month}</h3>
          <button
            type="button"
            onClick={closeInvoiceDetailModal}
            className="w-9 h-9 shrink-0 rounded-full text-neutral-700 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 p-3 sm:p-5">
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <DocumentSheet doc={doc} />}
        </div>

        <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-neutral-200 bg-white flex flex-wrap items-center justify-between gap-2.5">
          <DocumentActions doc={doc} />
          {invoice.status === 'unpaid' ? (
            <button
              type="button"
              onClick={handlePayNow}
              className="primary-button min-h-11 px-4 py-2.5 flex items-center justify-center gap-1.5 font-bold cursor-pointer"
              title={paymentGateStatus === 'STOP' ? 'Cổng thanh toán đang tạm đóng' : 'Quét mã VietQR thanh toán'}
            >
              {paymentGateStatus === 'STOP' ? <Lock size={16} className="text-amber-300" /> : <QrCode size={16} />}
              <span className="truncate">{paymentGateStatus === 'STOP' ? 'Thanh toán (Cổng đóng)' : 'Thanh toán ngay'}</span>
            </button>
          ) : (
            <button type="button" onClick={closeInvoiceDetailModal} className="soft-button min-h-11 px-5 py-2.5 cursor-pointer font-medium">Đóng</button>
          )}
        </div>
      </div>
    </div>
  );
}
