import React, { useEffect, useState } from 'react';
import { BuiltDocument, getMeasurer, Measurer, pageSize } from '../lib/documents/engine';
import { canPrintDocuments, printDocument, saveDocument } from '../lib/documents/output';
import { Download, Printer } from './AppIcons';

/** Builds a document once the fonts are ready; `key` rebuilds it when its data changes. */
export function useBuiltDocument(build: (m: Measurer) => BuiltDocument, key: string) {
  const [doc, setDoc] = useState<BuiltDocument | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    getMeasurer()
      .then(m => {
        if (active) setDoc(build(m));
      })
      .catch(err => {
        console.error('[documents] build failed', err);
        if (active) setError('Chưa tạo được tài liệu. Vui lòng thử lại.');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { doc, error };
}

/** Draws the same operations the PDF is made from, on a sheet that scales to the screen. */
export function DocumentSheet({ doc, className }: { doc: BuiltDocument | null; className?: string }) {
  if (!doc) {
    return <div className="flex min-h-64 items-center justify-center" role="status"><span aria-hidden="true" className="ui-spinner h-5 w-5" /><span className="sr-only">Đang tạo tài liệu…</span></div>;
  }
  const { width, height } = pageSize(doc);
  return (
    <div className={className} style={{ display: 'grid', gap: 12, width: '100%' }}>
      {doc.pages.map((ops, pageIndex) => (
        <svg key={pageIndex} role="img" aria-label={`${doc.title}, trang ${pageIndex + 1}`} viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,.18)', fontFamily: 'Tinos, "Times New Roman", serif', fontKerning: 'none', fontVariantLigatures: 'none', textRendering: 'geometricPrecision' }}>
          {ops.map((op, i) => {
            if (op.t === 'text') {
              return <text key={i} x={op.x} y={op.y} fontSize={op.size} fill="#000" xmlSpace="preserve"
                letterSpacing={op.cs} fontWeight={op.style.includes('bold') ? 700 : 400} fontStyle={op.style.includes('italic') ? 'italic' : 'normal'}>{op.s}</text>;
            }
            if (op.t === 'line') {
              return <line key={i} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke="#000" strokeWidth={op.w} strokeDasharray={op.dash?.join(' ')} />;
            }
            return <rect key={i} x={op.x} y={op.y} width={op.w} height={op.h} fill="none" stroke="#000" strokeWidth={op.lw} />;
          })}
        </svg>
      ))}
    </div>
  );
}

/** Download and print actions; both work from the generated PDF and never from the page. */
export function DocumentActions({ doc, downloadLabel = 'Tải PDF', className = '' }: { doc: BuiltDocument | null; downloadLabel?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (!doc || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      console.error('[documents] export failed', err);
      setMessage({ ok: false, text: 'Chưa tạo được PDF. Vui lòng thử lại.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {canPrintDocuments && (
          <button type="button" disabled={!doc || busy} onClick={() => run(() => printDocument(doc!))} className="soft-button min-h-11 px-4 py-2.5">
            <Printer size={16} />
            <span>In</span>
          </button>
        )}
        <button type="button" disabled={!doc || busy} aria-busy={busy}
          onClick={() => run(async () => {
            const result = await saveDocument(doc!);
            if (result.message) setMessage({ ok: result.ok, text: result.message });
          })}
          className="primary-button min-h-11 px-4 py-2.5">
          <Download size={16} />
          <span>{busy ? 'Đang tạo PDF…' : downloadLabel}</span>
        </button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{message.text}</p>}
    </div>
  );
}
