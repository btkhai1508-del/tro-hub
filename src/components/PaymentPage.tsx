import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, getTransferContent } from '../context/AppContext';
import { apiFetch } from '../lib/api';
import { saveQrToDevice } from '../lib/qrHelper';
import { soundFx } from '../lib/soundFx';
import { ChevronLeft, Download, Check, Home, Copy, CheckCircle2, ImageDown, Lock, PhoneCall, ShieldAlert } from './AppIcons';

export function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceIdParam = searchParams.get('invoiceId');

  const { invoices, setInvoices, profile, paymentGateStatus } = useApp();

  // Active targeted invoice
  const selectedInvoice = (invoiceIdParam
    ? invoices.find(i => i.id === invoiceIdParam) || invoices[0]
    : invoices.find(i => i.status === 'unpaid') || invoices[0]);
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
                    paidAt: data.label || 'Đã thanh toán'
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
    if (isExportingPDF) return;
    setIsExportingPDF(true);
    setPdfError('');
    try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text('NHA TRO PHONG LAN', 105, 22, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${profile.room?.building || 'Trung Kim'} | Hotline BQL: 0902 371 800`, 105, 28, { align: 'center' });

    // Divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(20, 33, 190, 33);

    // Title
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(`BIEN LAI THANH TOAN - THANG ${targetInvoice.month}`, 105, 43, { align: 'center' });

    // Details
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Ma hoa don: ${targetInvoice.id}`, 20, 54);
    doc.text(`Ngay: Hom nay`, 190, 54, { align: 'right' });
    doc.text(`Khach thue: ${profile.name}`, 20, 61);
    doc.text(`Can ho: ${profile.room?.roomNumber || '203'}`, 190, 61, { align: 'right' });
    doc.text(`Hinh thuc: Chuyen khoan VietQR (Tu dong)`, 20, 68);
    doc.text(`Trang thai: DA HOAN TAT THANH TOAN`, 190, 68, { align: 'right' });

    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(20, 75, 170, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('KHOAN MUC PHI', 24, 80.5);
    doc.text('SO TIEN (VND)', 186, 80.5, { align: 'right' });

    // Rows
    let y = 90;
    (targetInvoice.details || []).forEach((item: any) => {
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(item.name, 24, y);
      doc.text(`${item.amount.toLocaleString('vi-VN')} VND`, 186, y, { align: 'right' });
      y += 8;
      doc.setDrawColor(241, 245, 249);
      doc.line(20, y - 2, 190, y - 2);
    });

    // Total Box
    y += 5;
    doc.setFillColor(248, 250, 252);
    doc.rect(20, y, 170, 14, 'F');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('TONG CONG THANH TOAN:', 24, y + 9);
    doc.setFontSize(12);
    doc.text(`${targetInvoice.total.toLocaleString('vi-VN')} VND`, 186, y + 9, { align: 'right' });

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Cam on quy cu dan da su dung dich vu cua Nha Tro Phong Lan.', 105, 275, { align: 'center' });

    doc.save(`HoaDon_PhongLan_${targetInvoice.month.replace('/', '_')}.pdf`);
    } catch {
      setPdfError('Chưa tạo được PDF. Vui lòng thử lại.');
    } finally {
      setIsExportingPDF(false);
    }
  };

  const recipientName = 'Bùi Trung Khải';
  const bankName = 'MB BANK';
  const accountNumber = '0902371800';

  // Format transfer syntax: Room with LVC -> LVC{room}-T{m}-{y}, Room without LVC -> {room}-T{m}-{y}
  const transferContent = getTransferContent(profile.room?.roomNumber || '', targetInvoice.month);

  // Pure QR code matrix without borders or background
  const qrUrl = `https://img.vietqr.io/image/mbbank-0902371800-qr_only.png?amount=${targetInvoice.total}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(recipientName)}`;

  const [isSavingQR, setIsSavingQR] = useState(false);

  const handleSaveQR = async () => {
    if (isSavingQR) return;
    setIsSavingQR(true);
    try {
      await saveQrToDevice(qrUrl, `VietQR_PhongLan_${transferContent}.png`);
    } finally {
      setIsSavingQR(false);
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
            <main className="liquid-panel w-full max-w-[500px] p-6 sm:p-10 flex flex-col items-center relative transition-colors">

              {/* Success Badge Icon */}
              <div data-stage="success" className="w-16 h-16 rounded-full flex items-center justify-center text-white mb-5 shadow-lg bg-emerald-500 shadow-emerald-500/25">
                <Check size={40} strokeWidth={3.5} />
              </div>

              {/* Title */}
              <div className="text-center mb-6">
                <h2 className="apple-large-title font-semibold kit-text-primary tracking-tight">
                  Thanh toán hoàn tất
                </h2>
              </div>

              {/* Amount Display Centerpiece */}
              <div className="w-full py-4 px-6 flex flex-col items-center justify-center mb-6">
                <span className="apple-headline kit-text-secondary mb-2">
                  Số tiền đã thanh toán
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[36px] sm:text-[40px] leading-none font-semibold tracking-tight font-num text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(targetInvoice.total)}
                  </span>
                  <span className="apple-callout font-semibold text-emerald-600 dark:text-emerald-400">
                    VNĐ
                  </span>
                </div>
              </div>

              {/* Transaction Details Table */}
              <div className="kit-inset kit-group w-full divide-y divide-gray-100 dark:divide-neutral-800 mb-6 px-4 apple-body">
                <div className="py-3 flex items-center justify-between">
                  <span className="kit-text-secondary">Phòng</span>
                  <span className="font-semibold kit-text-primary">{profile.room?.roomNumber || '—'}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="kit-text-secondary">Kỳ hóa đơn</span>
                  <span className="font-semibold kit-text-primary">Tháng {targetInvoice.month}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="kit-text-secondary">Phương thức</span>
                  <span className="font-semibold kit-text-primary">
                    Chuyển khoản / VietQR
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="kit-text-secondary">Trạng thái</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={16} />
                    <span>Đã thanh toán</span>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="primary-button w-full sm:flex-1 min-h-12 px-4"
                >
                  <Home size={18} />
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

            </main>
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
                className="w-28 h-28 sm:w-36 sm:h-36 mb-4 shrink-0 drop-shadow-[0_10px_25px_rgba(239,68,68,0.22)] select-none pointer-events-none"
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
                    onClick={() => handleCopy('0902371800', 'gate-bql-phone')}
                    className="apple-callout font-semibold font-num kit-text-primary hover:text-neutral-600 dark:hover:text-neutral-400 flex items-center gap-1.5 cursor-pointer"
                    title="Bấm để sao chép số điện thoại"
                  >
                    <span>0902 371 800</span>
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
                  href="https://zalo.me/0902371800"
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
            {/* 1. DESKTOP / LAPTOP VIEW (lg and above): 2-Column Container */}
            <main className="liquid-panel hidden lg:block w-full max-w-5xl p-8 lg:p-10 relative">
              {/* Top Bar: Back button */}
              <div className="mb-4 flex items-center justify-start">
                <button
                  type="button"
                  aria-label="Quay lại"
                  onClick={() => navigate('/invoices')}
                  className="soft-button w-11 h-11 flex items-center justify-center kit-text-secondary transition-all cursor-pointer"
                >
                  <ChevronLeft size={26} strokeWidth={2.2} />
                </button>
              </div>

              {/* 2-Column Grid Layout */}
              <div className="grid grid-cols-12 gap-8 items-center pt-1">
                {/* Left Column: Title, Subtitles, Straight Square Pure QR Code */}
                <div className="col-span-6 flex flex-col items-center text-center">
                  <div className="mb-3">
                    <h2 className="apple-title1 font-semibold kit-text-primary">
                      QR Thanh toán
                    </h2>
                    <p className="apple-body kit-text-secondary font-normal mt-1 leading-relaxed">
                      Quét mã để thanh toán tự động
                    </p>
                  </div>

                  {/* Sharp Straight Square Pure QR Container */}
                  <div className="bg-white p-3.5 rounded-2xl shadow-sm inline-block max-w-full">
                    {qrUrl ? (
                      <img
                        src={qrUrl}
                        alt="VietQR Matrix"
                        className="w-[280px] max-w-full aspect-square object-contain rounded-none select-none"
                      />
                    ) : (
                      <div className="w-[280px] max-w-full aspect-square flex items-center justify-center apple-callout text-neutral-700">
                        Đang tạo mã QR...
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-[285px] flex flex-col gap-2 mt-4 sm:mt-5">
                    <button
                      type="button"
                      onClick={handleSaveQR}
                      disabled={isSavingQR}
                      className="primary-button min-h-11 w-full py-3 px-4 apple-control flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ImageDown size={15} />
                      <span>{isSavingQR ? 'Đang lưu ảnh...' : 'Lưu ảnh QR'}</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Transaction Details, Total Amount */}
                <div className="col-span-6 flex flex-col justify-center pl-6 border-l border-[#ebebed] dark:border-neutral-800 space-y-4">
                  {/* Transaction Information List */}
                  <div>
                    <h2 className="apple-title2 font-semibold kit-text-primary tracking-tight mb-3">
                      Chi tiết giao dịch
                    </h2>
                    <div className="kit-inset kit-group p-4 sm:p-5 space-y-4">
                      <div className="flex items-center justify-between apple-body">
                        <span className="kit-text-secondary font-normal">Người nhận</span>
                        <button type="button" aria-label="Sao chép người nhận"
                          onClick={() => handleCopy(recipientName, 'd-recipient')}
                          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                        >
                          <span className="font-semibold kit-text-primary">{recipientName}</span>
                          {copiedKey === 'd-recipient' ? (
                            <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between apple-body">
                        <span className="kit-text-secondary font-normal">Ngân hàng</span>
                        <button type="button" aria-label="Sao chép tên ngân hàng"
                          onClick={() => handleCopy(bankName, 'd-bank')}
                          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                        >
                          <span className="font-medium kit-text-primary">{bankName}</span>
                          {copiedKey === 'd-bank' ? (
                            <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between apple-body">
                        <span className="kit-text-secondary font-normal">Số tài khoản</span>
                        <button type="button" aria-label="Sao chép số tài khoản"
                          onClick={() => handleCopy(accountNumber, 'd-acc')}
                          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                        >
                          <span className="font-semibold kit-text-primary tracking-wider font-num">{accountNumber}</span>
                          {copiedKey === 'd-acc' ? (
                            <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between apple-body">
                        <span className="kit-text-secondary font-normal">Nội dung CK</span>
                        <button type="button" aria-label="Sao chép nội dung chuyển khoản"
                          onClick={() => handleCopy(transferContent, 'd-content')}
                          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                        >
                          <span className="font-semibold kit-text-secondary font-num apple-callout">{transferContent}</span>
                          {copiedKey === 'd-content' ? (
                            <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Subtle Divider */}
                  <hr className="border-t border-[#ebebed] dark:border-neutral-800 w-full" />

                  {/* Total Amount */}
                  <div className="flex items-baseline justify-between py-1">
                    <span className="text-[15px] font-medium kit-text-secondary">Tổng tiền</span>
                    <span className="text-[32px] font-semibold kit-text-primary tracking-tight leading-none font-num">
                      {formatCurrency(targetInvoice.total)} ₫
                    </span>
                  </div>
                </div>
              </div>
            </main>

            {/* Mobile Fixed Floating Back Button - Always follows user screen on phones */}
            <div className="fixed top-3 left-3 z-50 lg:hidden">
              <button
                type="button"
                aria-label="Quay lại hóa đơn"
                onClick={() => navigate('/invoices')}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 dark:bg-neutral-900/90 text-neutral-800 dark:text-neutral-100 shadow-md backdrop-blur-md border border-white/70 dark:border-white/15 transition-transform active:scale-95 cursor-pointer"
              >
                <ChevronLeft size={24} strokeWidth={2.4} />
              </button>
            </div>

            {/* 2. MOBILE VIEW (under lg): Matches desktop layout identically */}
            <div className="liquid-panel lg:hidden w-full max-w-[420px] flex flex-col p-4 sm:p-5 relative">
              {/* Header Title & Subtitle */}
              <div className="w-full text-center mb-3">
                <h2 className="apple-title1 font-semibold kit-text-primary">
                  QR Thanh toán
                </h2>
                <p className="apple-body kit-text-secondary font-normal mt-1 leading-relaxed">
                  Quét mã để thanh toán tự động
                </p>
              </div>

              {/* Straight Square Pure QR Container */}
              <section aria-label="Mã QR thanh toán" className="flex flex-col items-center justify-center">
                <div className="bg-white p-3 rounded-2xl shadow-sm inline-block max-w-full">
                  {qrUrl ? (
                    <img
                      src={qrUrl}
                      alt="VietQR Matrix"
                      className="w-[200px] max-w-full aspect-square object-contain rounded-none select-none"
                    />
                  ) : (
                    <div className="w-[200px] max-w-full aspect-square flex items-center justify-center apple-callout text-neutral-700">
                      Đang tạo mã QR...
                    </div>
                  )}
                </div>

                {/* Spacing between QR image and save button */}
                <div className="w-full max-w-[240px] flex flex-col gap-2 mt-4 mb-4">
                  <button
                    type="button"
                    onClick={handleSaveQR}
                    disabled={isSavingQR}
                    className="primary-button min-h-11 w-full py-2.5 px-4 apple-control flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer"
                  >
                    <ImageDown size={15} />
                    <span>{isSavingQR ? 'Đang lưu...' : 'Lưu ảnh QR'}</span>
                  </button>
                </div>
              </section>

              {/* Transaction Details - Exactly matching desktop template */}
              <div className="space-y-4 pt-1">
                <div>
                  <h3 className="apple-title2 font-semibold kit-text-primary tracking-tight mb-2.5">
                    Chi tiết giao dịch
                  </h3>
                  <div className="kit-inset kit-group p-3.5 sm:p-4 space-y-3.5">
                    <div className="flex items-center justify-between apple-body text-xs sm:text-sm">
                      <span className="kit-text-secondary font-normal">Người nhận</span>
                      <button
                        type="button"
                        aria-label="Sao chép người nhận"
                        onClick={() => handleCopy(recipientName, 'm-rec')}
                        className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                      >
                        <span className="font-semibold kit-text-primary break-words">{recipientName}</span>
                        {copiedKey === 'm-rec' ? (
                          <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between apple-body text-xs sm:text-sm">
                      <span className="kit-text-secondary font-normal">Ngân hàng</span>
                      <button
                        type="button"
                        aria-label="Sao chép tên ngân hàng"
                        onClick={() => handleCopy(bankName, 'm-bank')}
                        className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                      >
                        <span className="font-semibold kit-text-primary">{bankName}</span>
                        {copiedKey === 'm-bank' ? (
                          <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between apple-body text-xs sm:text-sm">
                      <span className="kit-text-secondary font-normal">Số tài khoản</span>
                      <button
                        type="button"
                        aria-label="Sao chép số tài khoản"
                        onClick={() => handleCopy(accountNumber, 'm-acc')}
                        className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                      >
                        <span className="font-semibold kit-text-primary tracking-wider font-num">{accountNumber}</span>
                        {copiedKey === 'm-acc' ? (
                          <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-between apple-body text-xs sm:text-sm">
                      <span className="kit-text-secondary font-normal">Nội dung CK</span>
                      <button
                        type="button"
                        aria-label="Sao chép nội dung chuyển khoản"
                        onClick={() => handleCopy(transferContent, 'm-content')}
                        className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                      >
                        <span className="font-semibold kit-text-secondary font-num apple-callout">{transferContent}</span>
                        {copiedKey === 'm-content' ? (
                          <Check data-stage="copied" size={14} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <Copy size={13} strokeWidth={2} className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-white shrink-0 transition-colors" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Subtle Divider */}
                <hr className="border-t border-[#ebebed] dark:border-neutral-800 w-full" />

                {/* Total Amount - Exactly like desktop with large font */}
                <div className="flex items-baseline justify-between py-1">
                  <span className="text-[15px] font-medium kit-text-secondary">Tổng tiền</span>
                  <span className="text-[28px] sm:text-[32px] font-semibold kit-text-primary tracking-tight leading-none font-num">
                    {formatCurrency(targetInvoice.total)} ₫
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </>

    </div>
  );
}
