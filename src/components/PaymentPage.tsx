import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from 'jspdf';
import { useApp, getTransferContent } from '../context/AppContext';
import { apiFetch } from '../lib/api';
import { saveQrToDevice } from '../lib/qrHelper';
import { ChevronLeft, Download, Check, Home, Copy, CheckCircle2, ImageDown, Lock, PhoneCall, ShieldAlert } from 'lucide-react';

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

  // Single-execution flag to prevent repeated looping
  const isCompletedRef = useRef(isAlreadyPaid || paymentMode === 'success');

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

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
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

  const handleDownloadInvoicePDF = () => {
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
  };

  const recipientName = 'Bùi Trung Khải';
  const bankName = 'MB Bank (Ngân hàng Quân Đội)';
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
      <div className="w-full flex items-center justify-center p-4">
        <div className="soft-card max-w-md p-8 text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Chưa có hóa đơn để thanh toán</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Không tìm thấy hóa đơn trong dữ liệu Google Sheets.</p>
          <button type="button" onClick={() => navigate('/invoices')} className="primary-button px-4 py-2 text-sm inline-flex items-center gap-2">
            <ChevronLeft size={16} />
            <span>Quay lại hóa đơn</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-center p-2 sm:p-4 select-none">
      
      <AnimatePresence mode="wait">
        {paymentMode === 'processing' ? (
          /* =========================================================================
             PROCESSING TRANSITION SCREEN
             ========================================================================= */
          <motion.div
            key="processing-mode"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-6"
          >
            <main className="w-full max-w-[500px] bg-white dark:bg-[#101726] rounded-2xl border border-gray-100 dark:border-slate-800 shadow-[0_4px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-8 sm:p-10 flex flex-col items-center text-center transition-colors">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5 animate-pulse">
                <CheckCircle2 size={36} />
              </div>

              <h1 className="text-[24px] font-bold text-slate-900 dark:text-white mb-2">
                Đã ghi nhận chuyển khoản
              </h1>

              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
                Hệ thống ngân hàng đã nhận giao dịch của bạn. Đang cập nhật trạng thái hóa đơn...
              </p>

              <div className="w-full bg-slate-50 dark:bg-[#162032] rounded-xl p-4 border border-slate-100 dark:border-slate-800 text-left space-y-2 text-xs mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Kỳ hóa đơn:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Tháng {targetInvoice.month}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Số tiền:</span>
                  <span className="font-bold text-slate-900 dark:text-white font-num">{formatCurrency(targetInvoice.total)} ₫</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPaymentMode('success')}
                className="w-full primary-button py-3 text-sm font-semibold cursor-pointer"
              >
                Xem biên lai chi tiết
              </button>
            </main>
          </motion.div>
        ) : paymentMode === 'success' ? (
          /* =========================================================================
             PAYMENT SUCCESS SCREEN
             ========================================================================= */
          <motion.div
            key="success-mode"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-6"
          >
            <main className="w-full max-w-[500px] bg-white dark:bg-[#101726] rounded-2xl border border-gray-100 dark:border-slate-800 shadow-[0_4px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-6 sm:p-10 flex flex-col items-center relative transition-colors">
              
              {/* Success Badge Icon */}
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-white mb-5 shadow-lg bg-emerald-500 shadow-emerald-500/25">
                <Check size={40} strokeWidth={3.5} />
              </div>

              {/* Title */}
              <div className="text-center mb-6">
                <h1 className="text-[28px] sm:text-[32px] leading-tight font-bold text-slate-900 dark:text-white tracking-tight">
                  Hoàn Tất Thanh Toán!
                </h1>
              </div>

              {/* Amount Display Centerpiece */}
              <div className="w-full py-4 px-6 flex flex-col items-center justify-center mb-6">
                <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold mb-2">
                  SỐ TIỀN ĐÃ THANH TOÁN
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[36px] sm:text-[42px] leading-none font-bold tracking-tight font-num text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(targetInvoice.total)}
                  </span>
                  <span className="text-sm uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">
                    VNĐ
                  </span>
                </div>
              </div>

              {/* Transaction Details Table */}
              <div className="w-full divide-y divide-gray-100 dark:divide-slate-800 mb-6 text-[14px]">
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Phòng</span>
                  <span className="font-bold text-slate-900 dark:text-white">{profile.room?.roomNumber || '—'}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Kỳ hóa đơn</span>
                  <span className="font-bold text-slate-900 dark:text-white">Tháng {targetInvoice.month}</span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Phương thức</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Chuyển khoản / VietQR
                  </span>
                </div>
                <div className="py-3 flex items-center justify-between">
                  <span className="text-gray-500 dark:text-slate-400">Trạng thái</span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
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
                  className="w-full sm:flex-1 h-12 rounded-xl bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-100 text-white dark:text-black font-semibold text-[14px] flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99] cursor-pointer"
                >
                  <Home size={18} />
                  <span>Về trang chủ</span>
                </button>

                <button 
                  type="button"
                  onClick={handleDownloadInvoicePDF}
                  className="w-full sm:flex-1 h-12 rounded-xl bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-gray-200 dark:border-slate-700 font-semibold text-[14px] flex items-center justify-center gap-2 transition-colors active:scale-[0.99] cursor-pointer"
                >
                  <Download size={18} />
                  <span>Tải biên lai (PDF)</span>
                </button>
              </div>

            </main>
          </motion.div>
        ) : paymentGateStatus === 'STOP' ? (
          /* =========================================================================
             PAYMENT GATE CLOSED SCREEN (When Admin turns off payment gate)
             ========================================================================= */
          <motion.div
            key="gate-closed-mode"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-6"
          >
            <main className="w-full max-w-[540px] bg-white dark:bg-[#101726] rounded-[28px] border border-slate-200/90 dark:border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-6 sm:p-8 flex flex-col items-center text-center transition-colors">
              <div className="w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 shadow-xs">
                <Lock size={32} strokeWidth={2.2} />
              </div>

              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/80 px-2.5 py-0.5 rounded-full mb-2">
                Cổng thanh toán tạm khóa
              </span>

              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Cổng thanh toán đang tạm đóng
              </h1>

              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
                Ban Quản Lý đang tạm dừng nhận thanh toán trực tuyến qua mã VietQR cho kỳ Tháng {targetInvoice.month}. Quý cư dân vui lòng không chuyển khoản trong thời gian này.
              </p>

              {/* Manager Contact Box */}
              <div className="w-full bg-slate-50 dark:bg-[#162032] rounded-2xl p-4 border border-slate-100 dark:border-slate-800 text-left space-y-3 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Ban Quản Lý:</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">Bùi Trung Khải</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Hotline hỗ trợ:</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('0902371800', 'gate-bql-phone')}
                    className="text-xs font-bold font-num text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5 cursor-pointer"
                    title="Bấm để sao chép số điện thoại"
                  >
                    <span>0902 371 800</span>
                    {copiedKey === 'gate-bql-phone' ? (
                      <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded">Đã chép</span>
                    ) : (
                      <Copy size={13} className="text-slate-400" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Tòa nhà:</span>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                  className="flex-1 py-3 px-4 rounded-xl bg-[#0068FF] hover:bg-[#0055d4] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <span>Nhắn tin Zalo với Quản lý</span>
                </a>
                <button
                  type="button"
                  onClick={() => navigate('/invoices')}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-all cursor-pointer"
                >
                  Quay lại Hóa đơn
                </button>
              </div>
            </main>
          </motion.div>
        ) : (
          /* =========================================================================
             QR PAYMENT SCREEN
             ========================================================================= */
          <motion.div
            key="qr-mode"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full flex justify-center py-2"
          >
            {/* 1. DESKTOP / LAPTOP VIEW (lg and above): 2-Column Container */}
            <main className="hidden lg:block w-full max-w-5xl bg-white dark:bg-[#101726] rounded-[28px] border border-slate-200/90 dark:border-slate-800 p-8 lg:p-10 relative shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)] transition-colors">
              {/* Top Bar: Back button */}
              <div className="mb-4 flex items-center justify-start">
                <button 
                  type="button"
                  aria-label="Quay lại" 
                  onClick={() => navigate('/invoices')}
                  className="w-10 h-10 flex items-center justify-center text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-slate-800 active:scale-95 rounded-full transition-all duration-150 cursor-pointer -ml-2"
                >
                  <ChevronLeft size={26} strokeWidth={2.2} />
                </button>
              </div>

              {/* 2-Column Grid Layout */}
              <div className="grid grid-cols-12 gap-8 items-center pt-1">
                {/* Left Column: Title, Subtitles, Straight Square Pure QR Code */}
                <div className="col-span-6 flex flex-col items-center text-center">
                  <div className="mb-3">
                    <h1 className="text-[28px] font-bold tracking-tight text-black dark:text-white leading-tight">
                      QR Thanh toán
                    </h1>
                    <p className="text-[14px] text-neutral-500 dark:text-slate-400 font-normal mt-1 leading-relaxed">
                      Quét mã để thanh toán tự động
                    </p>
                  </div>

                  {/* Sharp Straight Square Pure QR Container */}
                  <div className="bg-white p-3.5 rounded-2xl shadow-sm inline-block">
                    {qrUrl ? (
                      <img 
                        src={qrUrl} 
                        alt="VietQR Matrix"
                        className="w-[280px] h-[280px] object-contain rounded-none select-none"
                      />
                    ) : (
                      <div className="w-[280px] h-[280px] flex items-center justify-center text-xs text-slate-500">
                        Đang tạo mã QR...
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-[285px] flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleSaveQR}
                      disabled={isSavingQR}
                      className="w-full py-2.5 px-3 rounded-xl bg-black hover:bg-neutral-900 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                    >
                      <ImageDown size={15} />
                      <span>{isSavingQR ? 'Đang lưu ảnh...' : 'Lưu ảnh QR'}</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Transaction Details, Total Amount */}
                <div className="col-span-6 flex flex-col justify-center pl-6 border-l border-[#ebebed] dark:border-slate-800 space-y-4">
                  {/* Transaction Information List */}
                  <div>
                    <h2 className="text-[16px] font-semibold text-black dark:text-white tracking-tight mb-3">
                      Chi tiết giao dịch
                    </h2>
                    <div className="bg-[#f8f9fa] dark:bg-[#162032] rounded-2xl p-4 sm:p-5 border border-[#ededf0] dark:border-slate-750 space-y-3">
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-slate-400 font-normal">Người nhận</span>
                        <span 
                          onClick={() => handleCopy(recipientName, 'd-recipient')}
                          className="font-bold text-black dark:text-white cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {recipientName}
                          {copiedKey === 'd-recipient' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-slate-400 font-normal">Ngân hàng</span>
                        <span 
                          onClick={() => handleCopy(bankName, 'd-bank')}
                          className="font-medium text-black dark:text-white cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {bankName}
                          {copiedKey === 'd-bank' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-slate-400 font-normal">Số tài khoản</span>
                        <span 
                          onClick={() => handleCopy(accountNumber, 'd-acc')}
                          className="font-bold text-black dark:text-white tracking-wider font-mono cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {accountNumber}
                          {copiedKey === 'd-acc' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="text-neutral-500 dark:text-slate-400 font-normal">Nội dung CK</span>
                        <span 
                          onClick={() => handleCopy(transferContent, 'd-content')}
                          className="font-bold text-indigo-600 dark:text-indigo-400 font-mono text-xs cursor-pointer hover:underline flex items-center gap-1"
                        >
                          {transferContent}
                          {copiedKey === 'd-content' && <span className="text-xs text-emerald-600 font-bold">✓</span>}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Subtle Divider */}
                  <hr className="border-t border-[#ebebed] dark:border-slate-800 w-full" />

                  {/* Total Amount */}
                  <div className="flex items-baseline justify-between py-1">
                    <span className="text-[15px] font-medium text-neutral-500 dark:text-slate-400">Tổng tiền</span>
                    <span className="text-[32px] font-bold text-black dark:text-white tracking-tight leading-none font-num">
                      {formatCurrency(targetInvoice.total)} ₫
                    </span>
                  </div>
                </div>
              </div>
            </main>

            {/* 2. MOBILE VIEW (under lg): Compact, Straight Pure QR Code */}
            <div className="lg:hidden w-full max-w-[390px] bg-white dark:bg-[#101726] rounded-[26px] border border-gray-200/80 dark:border-slate-800 shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex flex-col justify-between px-4 pt-3.5 pb-4 relative transition-colors">
              {/* Mobile Top Navigation */}
              <header className="w-full flex items-center justify-between mb-1.5">
                <button 
                  type="button"
                  aria-label="Quay lại" 
                  onClick={() => navigate('/invoices')}
                  className="w-8 h-8 flex items-center justify-center text-black dark:text-white active:opacity-60 transition-opacity cursor-pointer"
                >
                  <ChevronLeft size={22} strokeWidth={2.2} />
                </button>
                
                <div className="text-center">
                  <h1 className="text-[17px] font-bold text-black dark:text-white leading-tight">
                    QR Thanh toán
                  </h1>
                </div>

                <div className="w-8" />
              </header>

              {/* Mobile Straight Pure QR Code Section */}
              <section aria-label="Mã QR thanh toán" className="flex flex-col items-center justify-center my-1">
                <div className="bg-white p-3 rounded-2xl shadow-sm inline-block">
                  {qrUrl ? (
                    <img 
                      src={qrUrl} 
                      alt="VietQR Matrix"
                      className="w-[240px] h-[240px] object-contain rounded-none select-none"
                    />
                  ) : (
                    <div className="w-[240px] h-[240px] flex items-center justify-center text-xs text-slate-500">
                      Đang tạo mã QR...
                    </div>
                  )}
                </div>

                <div className="w-full max-w-[260px] flex flex-col gap-2 mt-1 mb-2">
                  <button
                    type="button"
                    onClick={handleSaveQR}
                    disabled={isSavingQR}
                    className="w-full py-2 px-2.5 rounded-xl bg-black hover:bg-neutral-900 active:scale-[0.98] text-white font-semibold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <ImageDown size={14} />
                    <span>{isSavingQR ? 'Đang lưu...' : 'Lưu ảnh QR'}</span>
                  </button>
                </div>
              </section>

              {/* Mobile Payment Details */}
              <section aria-label="Thông tin thanh toán" className="w-full flex flex-col space-y-1.5 my-1 text-xs">
                <div className="bg-[#f8f9fa] dark:bg-[#162032] rounded-xl p-2.5 border border-[#ededf0] dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-slate-400">Người nhận</span>
                    <span 
                      onClick={() => handleCopy(recipientName, 'm-rec')}
                      className="font-bold text-black dark:text-white tracking-tight cursor-pointer"
                    >
                      {recipientName}
                      {copiedKey === 'm-rec' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-slate-400">Ngân hàng</span>
                    <span 
                      onClick={() => handleCopy(bankName, 'm-bank')}
                      className="font-medium text-black dark:text-white truncate max-w-[200px] text-right cursor-pointer"
                    >
                      {bankName}
                      {copiedKey === 'm-bank' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-slate-400">Số TK</span>
                    <span 
                      onClick={() => handleCopy(accountNumber, 'm-acc')}
                      className="font-bold text-black dark:text-white font-mono cursor-pointer"
                    >
                      {accountNumber}
                      {copiedKey === 'm-acc' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500 dark:text-slate-400">Nội dung CK</span>
                    <span 
                      onClick={() => handleCopy(transferContent, 'm-content')}
                      className="font-bold text-indigo-600 dark:text-indigo-400 font-mono text-[11px] cursor-pointer"
                    >
                      {transferContent}
                      {copiedKey === 'm-content' && <span className="ml-1 text-[10px] text-emerald-600 font-bold">✓</span>}
                    </span>
                  </div>
                </div>

                {/* Total Line */}
                <div className="flex items-center justify-between px-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[13px] font-medium text-neutral-500 dark:text-slate-400">Tổng tiền</span>
                  <span className="text-[20px] font-bold text-black dark:text-white tracking-tight font-num">
                    {formatCurrency(targetInvoice.total)} ₫
                  </span>
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
