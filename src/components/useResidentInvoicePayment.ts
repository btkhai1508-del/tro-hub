import type { Invoice } from '../context/AppContext';
import { usePaymentBlock, workerInvoiceId } from '../lib/invoicePayment';
import { useWorkerViewer } from '../lib/paymentPortal';

/**
 * The QR-link block of a resident's own printed invoice (worker mode, unpaid only). `undefined` while
 * it is being prepared; wait for it before drawing so the PDF never changes under the reader.
 */
export function useResidentInvoicePayment(invoice: Invoice | null | undefined) {
  const viewer = useWorkerViewer();
  const invoiceId = workerInvoiceId(invoice?.id);
  const paid = !invoice || invoice.status === 'paid';
  const block = usePaymentBlock({ houseId: viewer?.kind === 'resident' ? viewer.houseId : null, invoiceId, paid });
  if (paid || !invoiceId) return null; // paid: never a QR; not a Worker invoice: as before
  return viewer === null ? undefined : block; // the viewer is still loading
}
