import { useDialogFocus } from '../lib/useDialogFocus';
import React, { useState } from 'react';
import { X } from './AppIcons';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { IconContract3D } from './Icons3D';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';
import { residentDocKey, residentHistory } from '../lib/documents/fromProfile';

interface PaymentHistoryExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentHistoryExportModal({ isOpen, onClose }: PaymentHistoryExportModalProps) {
  const { invoices, profile } = useApp();
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'paid' | 'unpaid'>('all');

  const dialogRef = useDialogFocus(isOpen, onClose);

  const filteredInvoices = invoices.filter(inv => {
    if (selectedFilter === 'paid') return inv.status === 'paid';
    if (selectedFilter === 'unpaid') return inv.status === 'unpaid' || inv.status === 'pending';
    return true;
  });
  const paidCount = invoices.filter(i => i.status === 'paid').length;

  const { doc, error } = useBuiltDocument(
    m => residentHistory(m, profile, filteredInvoices),
    `${isOpen}|${selectedFilter}|${residentDocKey(profile)}|${filteredInvoices.map(i => `${i.id}:${i.status}:${i.total}`).join(',')}`
  );

  if (!isOpen) return null;

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/65 backdrop-blur-md duration-200 select-none"
      onClick={onClose}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="payment-history-dialog-title"
        className="tahoe-dialog w-full max-w-4xl bg-white dark:bg-[#101726] rounded-[28px] border border-white/80 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] flex flex-col max-h-[92vh] overflow-hidden relative duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            <IconContract3D size={40} className="shrink-0" />
            <div>
              <h2 id="payment-history-dialog-title" className="text-base font-bold text-slate-900 dark:text-white">
                Xuất Lịch Sử Thanh Toán (PDF)
              </h2>
              <p className="text-xs text-slate-400">
                Bảng kê thanh toán theo thể thức văn bản, khổ A4
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Filter */}
            <div className="order-last sm:order-none flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-xl p-0.5 text-xs font-bold">
              <button
                onClick={() => setSelectedFilter('all')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'all' ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs" : "text-slate-500"
                )}
              >
                Tất cả ({invoices.length})
              </button>
              <button
                onClick={() => setSelectedFilter('paid')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'paid' ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs" : "text-slate-500"
                )}
              >
                Đã thanh toán ({paidCount})
              </button>
              <button
                onClick={() => setSelectedFilter('unpaid')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'unpaid' ? "bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-2xs" : "text-slate-500"
                )}
              >
                Chưa thanh toán ({invoices.length - paidCount})
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Scrollable Document Preview */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70 dark:bg-slate-950/60">

          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <div className="mx-auto w-full max-w-[780px]">
            {!error && <DocumentSheet doc={doc} />}
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <p className="text-xs text-slate-400">Khổ in: <span className="font-bold text-slate-700 dark:text-slate-300">A4</span></p>
          <DocumentActions doc={doc} downloadLabel="Tải tệp PDF về máy" />
        </div>

      </div>
    </div>
  );
}
