import React, { useState } from 'react';
import { X, Copy, Check, CheckCircle2, ShieldCheck, Download, ImageDown, Lock } from 'lucide-react';
import { useApp, getTransferContent } from '../context/AppContext';
import { saveQrToDevice } from '../lib/qrHelper';

export function PaymentModal() {
  const { isPaymentModalOpen, closePaymentModal, activeInvoice, processPayment, profile, paymentGateStatus } = useApp();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [lastTxnCode, setLastTxnCode] = useState('');

  if (!isPaymentModalOpen || !activeInvoice) return null;

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleConfirm = () => {
    processPayment(activeInvoice.id, 'qr');
    const code = `TXN-${Math.floor(1000000 + Math.random() * 9000000)}`;
    setLastTxnCode(code);
    setIsSuccess(true);
  };

  const handleClose = () => {
    setIsSuccess(false);
    closePaymentModal();
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('vi-VN');
  };

  const transferContent = getTransferContent(profile.room?.roomNumber || '203', activeInvoice.month || '10/2026');
  const bankAccount = '0902371800';
  const bankName = 'MB Bank (Ngân hàng TMCP Quân Đội)';
  const accountHolder = 'Bùi Trung Khải';
  const qrUrl = `https://img.vietqr.io/image/mbbank-0902371800-qr_only.png?amount=${activeInvoice.total}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(accountHolder)}`;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-md animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div 
        className="w-full max-w-lg bg-white/95 dark:bg-[#101726]/95 backdrop-blur-2xl rounded-[31px] border border-white dark:border-slate-800 shadow-[12px_12px_36px_rgba(166,175,195,0.35),-12px_-12px_36px_rgba(255,255,255,0.95)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)] flex flex-col max-h-[92vh] overflow-hidden relative animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Modal Header with Close Button */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 bg-white/90 dark:bg-[#101726]/90 backdrop-blur-md z-20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-slate-900 dark:bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              ₫
            </div>
            <div>
              <span className="type-label text-slate-400 dark:text-slate-400 block text-[10px]">Cổng thanh toán điện tử</span>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Hóa đơn Tháng {activeInvoice.month}
              </h2>
            </div>
          </div>

          <button 
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-xs"
            aria-label="Đóng cửa sổ thanh toán"
          >
            <X size={18} className="stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          
          {isSuccess ? (
            /* Success Screen */
            <div className="p-4 text-center space-y-5 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/15 border border-emerald-100 dark:border-emerald-800/50">
                <CheckCircle2 size={36} className="stroke-[2.5]" />
              </div>

              <div>
                <span className="type-label text-emerald-600 dark:text-emerald-400">Thanh toán hoàn tất</span>
                <h3 className="type-h3 text-slate-900 dark:text-white mt-1">Giao dịch đã được ghi nhận</h3>
                <p className="type-body text-slate-500 dark:text-slate-400 text-xs mt-1.5 max-w-xs mx-auto">
                  Hệ thống đã nhận thông tin chuyển khoản và cập nhật trạng thái hóa đơn.
                </p>
              </div>

              <div className="bg-slate-50/80 dark:bg-[#162032] border border-slate-100 dark:border-slate-800 rounded-2xl p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 dark:text-slate-400">Kỳ thanh toán:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Tháng {activeInvoice.month}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 dark:text-slate-400">Số tiền:</span>
                  <span className="font-bold text-slate-900 dark:text-white font-num">{formatCurrency(activeInvoice.total)} ₫</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 dark:text-slate-400">Hình thức:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">Quét mã VietQR</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 dark:text-slate-400">Mã GD:</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    {lastTxnCode}
                  </span>
                </div>
              </div>

              <button 
                type="button"
                onClick={handleClose}
                className="w-full primary-button py-3 text-center text-sm font-semibold cursor-pointer"
              >
                Đóng và hoàn tất
              </button>
            </div>
          ) : (
            <>
              {/* Payment Card Banner */}
              <div className="relative rounded-[24px] overflow-hidden p-5 text-white shadow-[6px_6px_20px_rgba(15,23,42,0.18)] bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 border border-white/20">
                {/* Background ambient lighting */}
                <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-br from-indigo-500/20 via-purple-500/15 to-transparent rounded-full blur-[35px] pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-36 h-36 bg-emerald-500/10 rounded-full blur-[30px] pointer-events-none" />

                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium block">Hóa đơn căn hộ</span>
                      <p className="font-bold text-sm text-white tracking-wide mt-0.5">{profile.room.roomNumber} - {profile.room.building}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-emerald-300 border border-white/15 font-num">
                      Hạn: {activeInvoice.dueDate}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Price Total / Tổng thanh toán</span>
                    <div className="type-h1 text-white font-num font-bold tracking-tight mt-0.5 flex items-baseline gap-1">
                      {formatCurrency(activeInvoice.total)}
                      <span className="text-sm font-normal text-slate-400">₫</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block">Người thụ hưởng</span>
                      <span className="font-medium text-white">{profile.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block">Kỳ thanh toán</span>
                      <span className="font-mono text-white font-medium">T{activeInvoice.month}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Gate Closed Warning OR QR Payment Details */}
              {paymentGateStatus === 'STOP' ? (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-5 text-center space-y-3.5 animate-in fade-in duration-200">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-xs">
                    <Lock size={24} />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-200/60 dark:bg-amber-900/60 px-2 py-0.5 rounded-full">
                      Cổng thanh toán tạm khóa
                    </span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1.5">
                      Cổng thanh toán đang tạm đóng
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                      Ban Quản Lý đang tạm khóa cổng thanh toán QR cho kỳ Tháng {activeInvoice.month}. Quý cư dân vui lòng không quét mã chuyển khoản trong thời gian này.
                    </p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-amber-200/60 dark:border-amber-900/40 text-left space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Ban Quản Lý:</span>
                      <span className="font-bold text-slate-900 dark:text-white">Bùi Trung Khải</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">SĐT hỗ trợ:</span>
                      <button
                        type="button"
                        onClick={() => handleCopy('0902371800', 'gate-modal-phone')}
                        className="font-bold font-num text-slate-900 dark:text-white hover:text-indigo-600 flex items-center gap-1 cursor-pointer"
                        title="Sao chép SĐT"
                      >
                        <span>0902 371 800</span>
                        {copiedField === 'gate-modal-phone' ? (
                          <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1 py-0.2 rounded">Đã chép</span>
                        ) : (
                          <Copy size={12} className="text-slate-400" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <a
                      href="https://zalo.me/0902371800"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2.5 rounded-xl bg-[#0068FF] hover:bg-[#0055d4] text-white text-xs font-bold flex items-center justify-center transition-all cursor-pointer"
                    >
                      Nhắn tin Zalo với Quản lý
                    </a>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              ) : (
                /* QR Payment Details */
                <div className="space-y-3 animate-in fade-in duration-200">
                  <div className="bg-slate-50/80 dark:bg-[#162032] border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
                    
                    {/* QR Code Container */}
                    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200/90 dark:border-slate-700 shrink-0 text-center flex flex-col items-center">
                      {qrUrl ? (
                        <img
                          src={qrUrl}
                          alt="Mã VietQR MB Bank"
                          className="w-32 h-32 rounded-lg object-contain mx-auto"
                        />
                      ) : (
                        <div className="w-32 h-32 rounded-lg bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                          Đang tạo mã QR...
                        </div>
                      )}
                      <span className="text-[10px] text-emerald-600 font-bold block mt-1">Mã VietQR MB Bank</span>
                      <div className="mt-2 flex flex-col gap-1 w-full">
                        <button
                          type="button"
                          onClick={() => saveQrToDevice(qrUrl, `VietQR_PhongLan_${transferContent}.png`)}
                          className="py-1.5 px-2 rounded-lg bg-black hover:bg-neutral-900 text-white text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs active:scale-95 transition-all cursor-pointer"
                        >
                          <ImageDown size={12} />
                          <span>Lưu ảnh QR</span>
                        </button>
                      </div>
                    </div>

                    {/* Bank Transfer Specs */}
                    <div className="flex-1 w-full space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Ngân hàng thụ hưởng:</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">{bankName}</span>
                      </div>

                      <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200/90 dark:border-slate-700 shadow-2xs">
                        <div>
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-medium">Số tài khoản</span>
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{bankAccount}</span>
                        </div>
                        <button 
                          type="button"
                          onClick={() => handleCopy(bankAccount, 'account')}
                          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                        >
                          {copiedField === 'account' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          <span>{copiedField === 'account' ? 'Đã chép' : 'Sao chép'}</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200/90 dark:border-slate-700 shadow-2xs">
                        <div>
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-medium">Nội dung CK</span>
                          <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{transferContent}</span>
                        </div>
                        <button 
                          type="button"
                          onClick={() => handleCopy(transferContent, 'content')}
                          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                        >
                          {copiedField === 'content' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          <span>{copiedField === 'content' ? 'Đã chép' : 'Sao chép'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="w-full primary-button py-3.5 text-sm flex items-center justify-center gap-2 shadow-sm font-bold cursor-pointer"
                  >
                    <ShieldCheck size={17} />
                    <span>Xác nhận đã chuyển khoản thành công</span>
                  </button>
                </div>
              )}

              {/* Exit Link */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium py-1 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Hủy và quay lại
                </button>
              </div>
            </>
          )}

        </div>
      </div>

    </div>
  );
}
