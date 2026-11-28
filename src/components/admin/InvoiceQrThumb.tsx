import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { qrPng } from '../../lib/invoicePayment';

/**
 * A small QR of a room's public payment page in the Hoá đơn list. Hovering shows a dark gradient with "Copy";
 * pressing it opens two choices: Copy link (first) and Copy QR (the QR as an image, white background, ready
 * to paste into Zalo). The QR itself can also be scanned straight off the screen.
 */
/** `large`: about 15% bigger (the phone invoice card, next to the room number). */
export function InvoiceQrThumb({ url, room, onCopied, large = false }: { url?: string; room: string; onCopied?: (message: string, ok: boolean) => void; large?: boolean }) {
  const [src, setSrc] = useState('');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (url) qrPng(url).then((png) => alive && setSrc(png)).catch(() => {});
    else setSrc('');
    return () => { alive = false; };
  }, [url]);

  // Close the choices on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!url) return null;

  const stop = (e: MouseEvent) => e.stopPropagation();
  const copyLink = async (e: MouseEvent) => {
    stop(e);
    setOpen(false);
    try {
      await navigator.clipboard.writeText(url);
      onCopied?.('Đã sao chép link thanh toán.', true);
    } catch {
      onCopied?.('Chưa sao chép được link. Hãy mở hoá đơn và bấm Sao chép link thanh toán.', false);
    }
  };
  const copyQr = async (e: MouseEvent) => {
    stop(e);
    setOpen(false);
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported');
      // Safari wants the promise handed to ClipboardItem straight away (still inside the click).
      const blob = QRCode.toDataURL(url, { margin: 2, width: 512, color: { dark: '#000000ff', light: '#ffffffff' } })
        .then((data) => fetch(data))
        .then((res) => res.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      onCopied?.('Đã sao chép ảnh QR.', true);
    } catch {
      onCopied?.('Trình duyệt này chưa cho sao chép ảnh. Hãy dùng Copy link.', false);
    }
  };

  return (
    <div ref={box} className="relative inline-block" onClick={stop}>
      <button type="button" onClick={(e) => {
          stop(e);
          const r = e.currentTarget.getBoundingClientRect();
          // Fixed, on top of everything: a table with its own scroll cannot clip it. Kept inside the screen.
          setPos({ left: Math.min(r.left, window.innerWidth - 136), top: Math.min(r.bottom + 6, window.innerHeight - 96) });
          setOpen((v) => !v);
        }} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Sao chép link hoặc QR thanh toán phòng ${room}`} title="Copy"
        className={`group relative flex ${large ? 'h-[46px] w-[46px]' : 'h-10 w-10'} shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 ring-1 ring-neutral-200 dark:ring-neutral-600 cursor-pointer`}>
        {src ? <img src={src} alt="" className="h-full w-full" /> : <span className="ui-spinner h-3 w-3" aria-hidden="true" />}
        <span aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/85 via-black/60 to-black/30 text-[10px] font-bold text-white transition-opacity duration-150 ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
          Copy
        </span>
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" onClick={stop} style={{ left: pos.left, top: pos.top }} className="fixed z-[95] w-32 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <button type="button" role="menuitem" onClick={copyLink} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 cursor-pointer">Copy link</button>
          <button type="button" role="menuitem" onClick={copyQr} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 cursor-pointer">Copy QR</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
