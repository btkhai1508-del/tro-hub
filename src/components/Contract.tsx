import React, { useState } from 'react';
import '../styles/resident-tahoe.css';
import { ZoomIn, ZoomOut, ChevronRight } from './AppIcons';
import { useApp } from '../context/AppContext';
import { IconContract3D, IconDeclaration3D } from './Icons3D';
import { DocumentActions, DocumentSheet, useBuiltDocument } from './DocumentSheet';
import { residentContract, residentCt01, residentDocKey } from '../lib/documents/fromProfile';

export function Contract() {
  const { profile } = useApp();
  const [activeTab, setActiveTab] = useState<'contract' | 'ct01'>('contract');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isDocumentOpen, setIsDocumentOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

  const roomNumber = profile.room?.roomNumber || '';
  const cleanRoom = roomNumber ? (roomNumber.startsWith('P.') ? roomNumber : `P. ${roomNumber}`) : 'Chưa cập nhật';

  const { doc, error } = useBuiltDocument(
    m => (activeTab === 'contract' ? residentContract(m, profile) : residentCt01(m, profile)),
    `${activeTab}|${residentDocKey(profile)}`
  );

  return (
    <div className="kit-page max-w-5xl mx-auto pb-8">
      <header data-tutorial="contract-header" className="kit-page-header home-stagger-1">
        <div className="min-w-0">
          <p className="kit-page-kicker">Tài liệu cư trú</p>
          <h1 className="kit-page-title">Hợp đồng & cư trú</h1>
          <p className="kit-page-description">Xem hợp đồng thuê phòng, tờ khai cư trú và tải đúng bản PDF khổ A4.</p>
        </div>
        <DocumentActions doc={doc} className="self-start" />
      </header>

      <div className="liquid-panel home-stagger-2 p-4 sm:p-5 space-y-4">
        <dl className="grid w-full grid-cols-2 gap-3 lg:hidden"><div><dt className="apple-callout kit-text-secondary">Người thuê</dt><dd className="mt-1 break-words apple-body font-medium kit-text-primary">{profile.name || 'Chưa cập nhật'}</dd></div><div><dt className="apple-callout kit-text-secondary">Phòng</dt><dd className="mt-1 break-words apple-body font-medium kit-text-primary">{cleanRoom}</dd></div></dl>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Loại tài liệu" className="kit-segmented flex w-full max-w-lg items-stretch gap-1">
            <button type="button" aria-pressed={activeTab === 'contract'} onClick={() => { setActiveTab('contract'); setIsDocumentOpen(true); }}
              className={`kit-segment min-w-0 flex-1 gap-2 px-3 py-2.5 apple-body ${activeTab === 'contract' ? 'kit-segment-active' : ''}`}>
              <IconContract3D size={25} />
              <span>Hợp đồng thuê phòng</span>
            </button>
            <button type="button" aria-pressed={activeTab === 'ct01'} onClick={() => { setActiveTab('ct01'); setIsDocumentOpen(true); }}
              className={`kit-segment min-w-0 flex-1 gap-2 px-3 py-2.5 apple-body ${activeTab === 'ct01' ? 'kit-segment-active' : ''}`}>
              <IconDeclaration3D size={25} />
              <span>Tờ khai cư trú (CT01)</span>
            </button>
          </div>
          <div role="group" aria-label="Thu phóng tài liệu" className="kit-inset hidden lg:flex items-center gap-1 rounded-full p-1">
            <button type="button" onClick={() => setZoomLevel(prev => Math.max(75, prev - 10))} disabled={zoomLevel <= 75}
              className="soft-button h-11 w-11" aria-label="Thu nhỏ tài liệu" title="Thu nhỏ">
              <ZoomOut size={16} />
            </button>
            <span className="font-num min-w-11 text-center apple-callout font-medium text-neutral-800 dark:text-neutral-100">{zoomLevel}%</span>
            <button type="button" onClick={() => setZoomLevel(prev => Math.min(125, prev + 10))} disabled={zoomLevel >= 125}
              className="soft-button h-11 w-11" aria-label="Phóng to tài liệu" title="Phóng to">
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
      </div>

      <details className="resident-disclosure resident-document-disclosure" open={isDocumentOpen} onToggle={event => setIsDocumentOpen(event.currentTarget.open)}>
        <summary className="resident-disclosure-summary kit-inset min-h-16 gap-3 rounded-[20px] px-4 py-3">
          <IconContract3D size={40} />
          <span className="min-w-0 flex-1"><span className="block apple-body font-semibold kit-text-primary">Đọc toàn bộ {activeTab === 'contract' ? 'hợp đồng' : 'tờ khai CT01'}</span><span className="block mt-1 apple-callout kit-text-secondary">Đúng bản PDF sẽ tải về · khổ A4</span></span>
          <ChevronRight size={20} className="resident-disclosure-chevron shrink-0" />
        </summary>
        <div className="resident-detail-body resident-document-scroll w-full overflow-x-auto py-2" tabIndex={0} role="region" aria-label="Nội dung tài liệu">
          {error && <p role="alert" className="apple-body text-red-700 dark:text-red-300">{error}</p>}
          <div className="mx-auto" style={{ width: `min(100%, ${(820 * zoomLevel) / 100}px)` }}>
            {!error && <DocumentSheet doc={doc} />}
          </div>
        </div>
      </details>
    </div>
  );
}
