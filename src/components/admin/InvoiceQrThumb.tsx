import { useEffect, useState, type MouseEvent } from 'react';
import { qrPng } from '../../lib/invoicePayment';

/**
 * A small QR of a room's public payment page in the Hoá đơn list. Tapping it copies the link (to paste into
 * Zalo or a message); the QR itself can be scanned straight off the screen.
 */
export function InvoiceQrThumb({ url, room, onCopied }: { url?: string; room: string; onCopied?: (ok: boolean) => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (url) qrPng(url).then((png) => alive && setSrc(png)).catch(() => {});
    else setSrc('');
    return () => { alive = false; };
  }, [url]);
  if (!url) return null;
  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      onCopied?.(true);
    } catch {
      onCopied?.(false);
    }
  };
  return (
    <button type="button" onClick={copy} title="Bấm để sao chép link thanh toán" aria-label={`Sao chép link thanh toán phòng ${room}`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white p-1 ring-1 ring-neutral-200 transition-transform hover:scale-105 active:scale-95 dark:ring-neutral-600 cursor-pointer">
      {src ? <img src={src} alt="" className="h-full w-full" /> : <span className="ui-spinner h-3 w-3" aria-hidden="true" />}
    </button>
  );
}
