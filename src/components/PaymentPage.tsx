import { useContactPhone, formatPhoneSpaced } from '../lib/paymentPortal';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Payment } from 'zmp-sdk/apis';
import { useApp, transferContentFor } from '../context/AppContext';
import { apiFetch } from '../lib/api';
import { usePaymentPortal, vietQrUrl } from '../lib/paymentPortal';
import { prepareQrImage, saveQrToDevice } from '../lib/qrHelper';
import { isZaloMiniApp } from '../lib/platform';
import { soundFx } from '../lib/soundFx';
import { getMeasurer } from '../lib/documents/engine';
import { saveDocument } from '../lib/documents/output';
import { residentInvoice } from '../lib/documents/fromProfile';
import { PaymentDoneCard, PaymentQrPortal } from './PaymentPortalViews';
import { useResidentInvoicePayment } from './useResidentInvoicePayment';
import { Home as HomeLine } from 'lucide-react';
import { ChevronLeft, Download, Check, Home, Copy, CheckCircle2, ImageDown, Landmark, Lock, PhoneCall, ShieldAlert } from './AppIcons';

import { getCurrentMonthStr, isSameMonth, paidDay } from '../lib/utils';

export function PaymentPage() {
  const contactPhone = useContactPhone();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceIdParam = searchParams.get('invoiceId');

  const { invoices, setInvoices, profile, paymentGateStatus } = useApp();

  // Active targeted invoice
  const selectedInvoice = (invoiceIdParam
    ? invoices.find(i => i.id === invoiceIdParam)
    : invoices.find(i => isSameMonth(i.month, getCurrentMonthStr())));
  const hasInvoice = Boolean(selectedInvoice);
  const targetInvoice = selectedInvoice || {
    id: '', month: '', issueDate: '', dueDate: '', total: 0,
    status: 'unpaid' as const, details: []
  };

  // Strict payment check: ONLY paid if status is 'paid'
  const isAlreadyPaid = targetInvoice.status === 'paid';

  const [paymentMode, setPaymentMode] = useState<'qr' | 'processing' | 'success'>(() => {
    return isAlreadyPaid ? 'success' : 'qr';
  });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const invoicePayment = useResidentInvoicePayment(hasInvoice ? targetInvoice : null);
  const [pdfError, setPdfError] = useState('');

  // Single-execution flag to prevent repeated looping
  const isCompletedRef = useRef(isAlreadyPaid || paymentMode === 'success');
  const hasPlayedSuccessSound = useRef(false);

  useEffect(() => {
    if (paymentMode === 'success') {
      if (!hasPlayedSuccessSound.current) {
        hasPlayedSuccessSound.current = true;
        soundFx.success();
      }
    } else {
      hasPlayedSuccessSound.current = false;
    }
  }, [paymentMode]);

  useEffect(() => {
    if (targetInvoice.status === 'paid') {
      isCompletedRef.current = true;
      setPaymentMode('success');
    } else if (targetInvoice.status === 'unpaid') {
      isCompletedRef.current = false;
      setPaymentMode(prev => prev === 'success' ? 'qr' : prev);
    }
  }, [targetInvoice.status]);

  // Format currency
  const formatCurrency = (val: number) => {
    return val.toLocaleString('vi-VN');
  };

  const handleCopy = async (text: string, key: string) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setCopyError('Chưa thể sao chép. Bạn có thể nhấn giữ để chọn nội dung chuyển khoản.');
    }
  };

  // Real-time automatic polling: checks Google Sheet Column P live status directly
  // GOOGLE SHEET IS SOURCE OF TRUTH (No Logs tab, no cache, no history inference)
  useEffect(() => {
    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const roomNum = profile.room?.roomNumber;
    if (!hasInvoice || !roomNum) return;

    const checkLiveStatus = async () => {
      try {
        const res = await apiFetch(`/api/payment/status?room=${encodeURIComponent(roomNum)}&t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data && data.success && isMounted) {
          if (data.paymentStatus === 'paid') {
            isCompletedRef.current = true;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            // Sync invoices in local context
            setInvoices(prev => prev.map(inv =>
              (inv.id === targetInvoice.id || inv.month === targetInvoice.month)
                ? {
                    ...inv,
                    status: 'paid' as const,
                    paymentMethod: 'qr' as const,
                    paidAt: inv.paidAt || paidDay(data.label) || undefined
                  }
                : inv
            ));

            setPaymentMode('success');
          } else if (data.paymentStatus === 'unpaid') {
            // Sheet is RED: Must be unpaid!
            isCompletedRef.current = false;
            setInvoices(prev => prev.map(inv =>
              (inv.id === targetInvoice.id || inv.month === targetInvoice.month)
                ? {
                    ...inv,
                    status: 'unpaid' as const,
                    paidAt: undefined
                  }
                : inv
            ));
            if (paymentMode === 'success') {
              setPaymentMode('qr');
            }
          }
        }
      } catch (err) {
        console.warn('Payment status polling error:', err);
      }
    };

    // Run immediately on mount
    checkLiveStatus();

    // Poll every 3 seconds while unpaid
    pollInterval = setInterval(checkLiveStatus, 3000);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [hasInvoice, profile.room?.roomNumber, targetInvoice.id, targetInvoice.month, setInvoices]);

  const handleDownloadInvoicePDF = async () => {
    if (isExportingPDF || invoicePayment === undefined) return;
    setIsExportingPDF(true);
    setPdfError('');
    try {
      const measurer = await getMeasurer();
      const result = await saveDocument(residentInvoice(measurer, profile, targetInvoice, invoices, invoicePayment));
      if (!result.ok && result.message) setPdfError(result.message);
    } catch {
      setPdfError('Chưa tạo được PDF. Vui lòng thử lại.');
    } finally {
      setIsExportingPDF(false);
    }
  };

  // The house's own bank account, set by Chủ trọ in the payment portal.
  const portal = usePaymentPortal();
  const recipientName = portal.accountName;
  const bankName = portal.bankName;
  const accountNumber = portal.accountNo;

  // Transfer content: the numeric pay code (XXXPPPMMYYYY) once the portal answered. Nothing is drawn before
  // that, so the old room-name format never flashes first.
  const portalLoaded = portal.loaded !== false;
  const transferContent = portalLoaded ? transferContentFor(targetInvoice, profile.room?.roomNumber || '', portal.payPrefix) : '';

  // Pure QR code matrix without borders or background
  const qrUrl = transferContent ? vietQrUrl(portal, targetInvoice.total, transferContent) : '';

  const [isSavingQR, setIsSavingQR] = useState(false);
  const [isOpeningTransfer, setIsOpeningTransfer] = useState(false);
  const [qrSaveResult, setQrSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (qrUrl && hasInvoice && paymentGateStatus !== 'STOP') prepareQrImage(qrUrl).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrUrl, hasInvoice, paymentGateStatus]);

  const handleSaveQR = async () => {
    if (isSavingQR || !qrUrl) return;
    setIsSavingQR(true);
    try {
      const result = await saveQrToDevice(qrUrl, `VietQR_PhongLan_${transferContent}.png`);
      setQrSaveResult(result.message ? result : null);
    } finally {
      setIsSavingQR(false);
    }
  };

  /** Opens Zalo's own bank transfer. The server signs the order, because the signing key must not ship in the app. */
  const handleQuickTransfer = async () => {
    if (isOpeningTransfer || !transferContent) return;
    setIsOpeningTransfer(true);
    setQrSaveResult(null);
    try {
      const res = await apiFetch('/api/payment/zalo-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: targetInvoice.total, desc: transferContent, invoiceId: targetInvoice.id }),
      });
      const order = await res.json();
      if (!order?.success) throw new Error(order?.error);
      await Payment.createOrder(order.order);
    } catch (err: any) {
      console.warn('[payment] Zalo bank transfer failed', err);
      if (!/cancel|hủy|huỷ/i.test(String(err?.message))) setQrSaveResult({ success: false, message: err?.message || 'Chưa mở được chuyển khoản nhanh. Bạn có thể dùng mã QR.' });
    } finally {
      setIsOpeningTransfer(false);
    }
  };

  if (!hasInvoice) {
    return (
      <div data-brand-target="anchor" className="w-full flex items-center justify-center p-4">
        <div className="soft-card max-w-md p-8 text-center space-y-4">
          <h1 className="apple-title2 font-semibold kit-text-primary">Chưa có hóa đơn để thanh toán</h1>
          <p className="apple-body kit-text-secondary">Hóa đơn của bạn sẽ xuất hiện tại đây khi được phát hành.</p>
          <button type="button" onClick={() => navigate('/invoices')} className="primary-button px-4 py-2 apple-control inline-flex items-center gap-2">
            <ChevronLeft size={16} />
            <span>Quay lại hóa đơn</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-brand-target="anchor" className="w-full space-y-4 pb-4">
      {copiedKey && <span role="status" className="sr-only">Đã sao chép.</span>}
      {copyError && <p role="alert" className="kit-feedback mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{copyError}</p>}
      {pdfError && <p role="alert" className="mx-auto max-w-5xl apple-body text-red-700 dark:text-red-300">{pdfError}</p>}
      <>
        {paymentMode === 'processing' ? (
          /* =========================================================================
             PROCESSING TRANSITION SCREEN
             ========================================================================= */
          <div
            key="processing-mode"
            className="w-full flex justify-center py-6"
          >
            <main className="liquid-panel w-full max-w-[500px] p-8 sm:p-10 flex flex-col items-center text-center transition-colors">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5 icon-plate">
                <CheckCircle2 size={36} />
              </div>

              <h2 className="apple-title1 font-semibold kit-text-primary mb-2">
                Đã ghi nhận chuyển khoản
              </h2>

              <p className="apple-body kit-text-secondary max-w-sm mb-6">
                Hệ thống ngân hàng đã nhận giao dịch của bạn. Đang cập nhật trạng thái hóa đơn...
              </p>

              <div className="w-full kit-inset kit-group rounded-xl p-4 border border-neutral-100 dark:border-neutral-800 text-left space-y-2 apple-callout mb-6">
                <div className="flex justify-between items-center">
                  <span className="kit-text-secondary">Kỳ hóa đơn:</span>
                  <span className="font-semibold kit-text-primary">Tháng {targetInvoice.month}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="kit-text-secondary">Số tiền:</span>
                  <span className="font-semibold kit-text-primary font-num">{formatCurrency(targetInvoice.total)} ₫</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPaymentMode('success')}
                className="w-full primary-button py-3 apple-control font-semibold cursor-pointer"
              >
                Xem biên lai chi tiết
              </button>
            </main>
          </div>
        ) : paymentMode === 'success' ? (
          /* =========================================================================
             PAYMENT SUCCESS SCREEN
             ========================================================================= */
          <div
            key="success-mode"
            className="w-full flex justify-center py-6"
          >
            <PaymentDoneCard total={targetInvoice.total} room={profile.room?.roomNumber} month={targetInvoice.month} statusText={paidDay(targetInvoice.paidAt) ? `Đã thanh toán ngày ${paidDay(targetInvoice.paidAt)}` : 'Đã thanh toán'}>
              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="primary-button w-full sm:flex-1 min-h-12 px-4"
                >
                  <HomeLine size={18} />
                  <span>Về trang chủ</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadInvoicePDF}
                  disabled={isExportingPDF}
                  className="soft-button w-full sm:flex-1 min-h-12 px-4"
                >
                  <Download size={18} />
                  <span>{isExportingPDF ? 'Đang tạo PDF…' : 'Tải biên lai (PDF)'}</span>
                </button>
              </div>

            </PaymentDoneCard>
          </div>
        ) : paymentGateStatus === 'STOP' ? (
          /* =========================================================================
             PAYMENT GATE CLOSED SCREEN (When Admin turns off payment gate)
             ========================================================================= */
          <div
            key="gate-closed-mode"
            className="w-full flex justify-center py-6"
          >
            <main className="liquid-panel w-full max-w-[540px] p-6 sm:p-8 flex flex-col items-center text-center transition-colors">
              <img
                src="/lock.svg"
                alt="Cổng thanh toán đang tạm đóng"
                className="w-28 h-28 sm:w-36 sm:h-36 mb-4 shrink-0 select-none pointer-events-none"
              />

              <h2 className="apple-title1 font-semibold kit-text-primary mb-2">
                Cổng thanh toán đang tạm đóng
              </h2>

              <p className="apple-body kit-text-secondary max-w-md mb-6 leading-relaxed">
                Ban Quản Lý đang tạm dừng nhận thanh toán trực tuyến, xin cảm ơn
              </p>

              {/* Manager Contact Box */}
              <div className="w-full kit-inset kit-group rounded-2xl p-4 border border-neutral-100 dark:border-neutral-800 text-left space-y-3 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <span className="apple-callout kit-text-secondary">Ban Quản Lý:</span>
                  <span className="apple-callout font-semibold kit-text-primary">Bùi Trung Khải</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <span className="apple-callout kit-text-secondary">Hotline hỗ trợ:</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(contactPhone, 'gate-bql-phone')}
                    className="apple-callout font-semibold font-num kit-text-primary hover:text-neutral-600 dark:hover:text-neutral-400 flex items-center gap-1.5 cursor-pointer"
                    title="Bấm để sao chép số điện thoại"
                  >
                    <span>{formatPhoneSpaced(contactPhone)}</span>
                    {copiedKey === 'gate-bql-phone' ? (
                      <span className="apple-caption text-emerald-600 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded">Đã chép</span>
                    ) : (
                      <Copy size={13} className="kit-text-secondary" />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <span className="apple-callout kit-text-secondary">Tòa nhà:</span>
                  <span className="apple-callout font-semibold kit-text-secondary">
                    {profile.room?.building || 'Trung Kim'} - Phòng {profile.room?.roomNumber}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row gap-2.5">
                <a
                  href={`https://zalo.me/${contactPhone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-button flex-1 min-h-12 px-4"
                >
                  <span>Nhắn tin Zalo với Quản lý</span>
                </a>
                <button
                  type="button"
                  onClick={() => navigate('/invoices')}
                  className="soft-button flex-1 min-h-12 px-4"
                >
                  Quay lại Hóa đơn
                </button>
              </div>
            </main>
          </div>
        ) : (
          /* =========================================================================
             QR PAYMENT SCREEN
             ========================================================================= */
          <div
            key="qr-mode"
            className="w-full flex justify-center py-2"
          >
            <PaymentQrPortal
              qrUrl={qrUrl}
              recipientName={recipientName}
              bankName={bankName}
              accountNumber={accountNumber}
              transferContent={transferContent}
              total={targetInvoice.total}
              onSaveQR={handleSaveQR}
              isSavingQR={isSavingQR}
              qrSaveResult={qrSaveResult}
              quickTransfer={isZaloMiniApp && portal.zaloCheckout ? { onClick: handleQuickTransfer, busy: isOpeningTransfer } : null}
              onBack={() => navigate('/invoices')}
            />
          </div>
        )}
      </>

    </div>
  );
}
