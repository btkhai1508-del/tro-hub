import React, { useState } from 'react';
import { Check, CheckCircle2, ChevronLeft, Copy, ImageDown, Landmark } from './AppIcons';

/**
 * The resident payment portal (QR screen and "paid" card), shared as is by the resident payment page and
 * the public payment page (/#/pay/:token), so both look exactly the same.
 */
const formatCurrency = (val: number) => val.toLocaleString('vi-VN');

export interface PaymentQrPortalProps {
  qrUrl: string;
  recipientName: string;
  bankName: string;
  accountNumber: string;
  transferContent: string;
  total: number;
  onSaveQR: () => void;
  isSavingQR: boolean;
  qrSaveResult: { success: boolean; message: string } | null;
  quickTransfer?: { onClick: () => void; busy: boolean } | null;
  /** Shown as the back buttons; the public page has none. */
  onBack?: () => void;
}

export function PaymentQrPortal({
  qrUrl, recipientName, bankName, accountNumber, transferContent, total, onSaveQR, isSavingQR, qrSaveResult, quickTransfer, onBack,
}: PaymentQrPortalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
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

  return (
    <>
      {copiedKey && <span role="status" className="sr-only">Đã sao chép.</span>}
      {copyError && <p role="alert" className="kit-feedback mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{copyError}</p>}
      {/* 1. DESKTOP / LAPTOP VIEW (lg and above): 2-Column Container */}
      <main className="liquid-panel hidden lg:block w-full max-w-5xl p-8 lg:p-10 relative">
        {/* Top Bar: Back button */}
        {onBack && (
        <div className="mb-4 flex items-center justify-start">
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            className="soft-button w-11 h-11 flex items-center justify-center kit-text-secondary transition-all cursor-pointer"
          >
            <ChevronLeft size={26} strokeWidth={2.2} />
          </button>
        </div>
        )}

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
                  className="w-[280px] max-w-full h-auto object-contain rounded-none select-none"
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
                onClick={onSaveQR}
                disabled={isSavingQR}
                className="primary-button min-h-11 w-full py-3 px-4 apple-control flex items-center justify-center gap-2 cursor-pointer"
              >
                <ImageDown size={15} />
                <span>{isSavingQR ? 'Đang lưu ảnh...' : 'Lưu ảnh QR'}</span>
              </button>
              {quickTransfer && (
                <button type="button" onClick={quickTransfer.onClick} disabled={quickTransfer.busy} className="soft-button min-h-11 w-full py-3 px-4 apple-control flex items-center justify-center gap-2 cursor-pointer">
                  <Landmark size={15} />
                  <span>{quickTransfer.busy ? 'Đang mở...' : 'Chuyển khoản nhanh'}</span>
                </button>
              )}
              {qrSaveResult && <p role={qrSaveResult.success ? 'status' : 'alert'} className="mt-2 max-w-[260px] text-center apple-callout kit-text-secondary">{qrSaveResult.message}</p>}
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
                    onClick={() => transferContent && handleCopy(transferContent, 'd-content')}
                    className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                  >
                    <span className="font-semibold kit-text-secondary font-num apple-callout">{transferContent || '…'}</span>
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
                {formatCurrency(total)} ₫
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Fixed Floating Back Button - Always follows user screen on phones */}
      {onBack && (
      <div className="fixed top-3 left-3 z-50 lg:hidden">
        <button
          type="button"
          aria-label="Quay lại hóa đơn"
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 dark:bg-neutral-900/90 text-neutral-800 dark:text-neutral-100 shadow-md backdrop-blur-md border border-white/70 dark:border-white/15 transition-transform active:scale-95 cursor-pointer"
        >
          <ChevronLeft size={24} strokeWidth={2.4} />
        </button>
      </div>
      )}

      {/* 2. MOBILE VIEW (under lg): Matches desktop layout identically */}
      <div className="liquid-panel lg:hidden w-full max-w-[400px] flex flex-col px-4 pt-3.5 pb-4 relative">
        {/* Header Title & Subtitle */}
        <div className="w-full text-center mb-2.5">
          <h2 className="apple-title3 font-semibold kit-text-primary">
            QR Thanh toán
          </h2>
          <p className="apple-footnote kit-text-secondary font-normal mt-0.5">
            Quét mã để thanh toán tự động
          </p>
        </div>

        {/* Straight Square Pure QR Container */}
        <section aria-label="Mã QR thanh toán" className="flex flex-col items-center justify-center">
          <div className="bg-white p-2 rounded-xl shadow-sm inline-block max-w-full">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="VietQR Matrix"
                className="w-[168px] max-w-full h-auto object-contain rounded-none select-none"
              />
            ) : (
              <div className="w-[168px] max-w-full aspect-square flex items-center justify-center apple-callout text-neutral-700">
                Đang tạo mã QR...
              </div>
            )}
          </div>

          {/* Save and quick transfer, one above the other */}
          <div className="w-full max-w-[260px] grid grid-cols-1 gap-2 mt-3 mb-3">
            <button
              type="button"
              onClick={onSaveQR}
              disabled={isSavingQR}
              className="primary-button min-h-11 w-full py-2 px-3 apple-control flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
            >
              <ImageDown size={15} />
              <span>{isSavingQR ? 'Đang lưu...' : 'Lưu ảnh QR'}</span>
            </button>
            {quickTransfer && (
              <button type="button" onClick={quickTransfer.onClick} disabled={quickTransfer.busy} className="soft-button min-h-11 w-full py-2 px-3 apple-control flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer">
                <Landmark size={15} />
                <span>{quickTransfer.busy ? 'Đang mở...' : 'Chuyển khoản nhanh'}</span>
              </button>
            )}
            {qrSaveResult && <p role={qrSaveResult.success ? 'status' : 'alert'} className="col-span-full text-center apple-footnote kit-text-secondary">{qrSaveResult.message}</p>}
          </div>
        </section>

        {/* Transaction Details - Exactly matching desktop template */}
        <div className="space-y-2.5">
          <div>
            <h3 className="sr-only">
              Chi tiết giao dịch
            </h3>
            <div className="border-t border-[#ebebed] dark:border-neutral-800 pt-2.5 space-y-1.5">
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
                  onClick={() => transferContent && handleCopy(transferContent, 'm-content')}
                  className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer text-right"
                >
                  <span className="font-semibold kit-text-secondary font-num apple-callout">{transferContent || '…'}</span>
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
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-medium kit-text-secondary">Tổng tiền</span>
            <span className="text-[26px] font-semibold kit-text-primary tracking-tight leading-none font-num">
              {formatCurrency(total)} ₫
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export interface PaymentDoneCardProps {
  total: number;
  room?: string;
  month: string;
  statusText: string;
  children?: React.ReactNode;
}

/** The "Thanh toán hoàn tất" card; `children` are the action buttons (none on the public page). */
export function PaymentDoneCard({ total, room, month, statusText, children }: PaymentDoneCardProps) {
  return (
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
            {formatCurrency(total)}
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
          <span className="font-semibold kit-text-primary">{room || '—'}</span>
        </div>
        <div className="py-3 flex items-center justify-between">
          <span className="kit-text-secondary">Kỳ hóa đơn</span>
          <span className="font-semibold kit-text-primary">Tháng {month}</span>
        </div>
        <div className="py-3 flex items-center justify-between">
          <span className="kit-text-secondary">Phương thức</span>
          <span className="font-semibold kit-text-primary">
            Chuyển khoản / VietQR
          </span>
        </div>
        <div className="py-3 flex items-center justify-between">
          <span className="kit-text-secondary shrink-0 whitespace-nowrap pr-3">Trạng thái</span>
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={16} />
            <span>{statusText}</span>
          </span>
        </div>
      </div>
      {children}
    </main>
  );
}
