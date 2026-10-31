import { useDialogFocus } from '../lib/useDialogFocus';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ExternalLink } from './AppIcons';
import { useApp } from '../context/AppContext';
import { IconContract3D, IconDeclaration3D } from './Icons3D';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';
import { residentContract, residentCt01, residentDocKey } from '../lib/documents/fromProfile';

export function ContractModal() {
  const { profile, isContractModalOpen, closeContractModal } = useApp();
  const [activeTab, setActiveTab] = useState<'contract' | 'ct01'>('contract');
  const navigate = useNavigate();

  const dialogRef = useDialogFocus(isContractModalOpen, closeContractModal);

  const { doc, error } = useBuiltDocument(
    m => (activeTab === 'contract' ? residentContract(m, profile) : residentCt01(m, profile)),
    `${isContractModalOpen}|${activeTab}|${residentDocKey(profile)}`
  );

  if (!isContractModalOpen) return null;

  const roomNumber = profile.room?.roomNumber || '';

  const handleOpenFull = () => {
    closeContractModal();
    navigate('/contract');
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-md duration-200"
      onClick={closeContractModal}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="contract-dialog-title"
        className="tahoe-dialog w-full max-w-3xl bg-white dark:bg-[#0f172a] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] flex flex-col max-h-[92vh] overflow-hidden relative duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <IconContract3D size={40} className="shrink-0" />
            <div>
              <h3 id="contract-dialog-title" className="text-base font-bold text-slate-900 dark:text-white">
                Văn bản Pháp lý & Hợp đồng
              </h3>
              {roomNumber && <p className="text-xs text-slate-400">Phòng {roomNumber}</p>}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenFull}
              className="p-2 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Mở toàn màn hình"
            >
              <ExternalLink size={18} />
            </button>
            <button
              type="button"
              onClick={closeContractModal}
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Đóng"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab selection */}
        <div className="shrink-0 px-5 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/40 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('contract')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'contract'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <IconContract3D size={18} />
            <span>Hợp đồng thuê phòng</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ct01')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'ct01'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <IconDeclaration3D size={18} />
            <span>Tờ khai cư trú (CT01)</span>
          </button>
        </div>

        {/* Body Container: Scrollable A4 Document Sheet */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-100 dark:bg-[#070b14]">
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          {!error && <DocumentSheet doc={doc} />}
        </div>

        {/* Footer */}
        <div className="shrink-0 p-3 sm:p-3.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0f172a] flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={closeContractModal}
            className="soft-button min-h-11 text-xs py-2 px-3 text-slate-600 dark:text-slate-300 cursor-pointer"
          >
            Đóng
          </button>
          <DocumentActions doc={doc} />
        </div>

      </div>
    </div>
  );
}
