import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import { Check, X } from './AppIcons';

const VIEW = 280;
const OUTPUT = 512;
const MAX_ZOOM = 4;

interface AvatarCropperProps {
  src: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}

/** Drag and zoom a photo inside the avatar frame, then export just the framed square. */
export function AvatarCropper({ src, onCancel, onApply }: AvatarCropperProps) {
  const dialogRef = useDialogFocus(true, onCancel);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const base = size ? Math.max(VIEW / size.w, VIEW / size.h) : 1;
  const scale = base * zoom;
  const clamp = (next: { x: number; y: number }, z = zoom) => {
    if (!size) return next;
    const s = base * z;
    return {
      x: Math.min(0, Math.max(VIEW - size.w * s, next.x)),
      y: Math.min(0, Math.max(VIEW - size.h * s, next.y)),
    };
  };

  useEffect(() => {
    if (!size) return;
    const s = Math.max(VIEW / size.w, VIEW / size.h);
    setOffset({ x: (VIEW - size.w * s) / 2, y: (VIEW - size.h * s) / 2 });
  }, [size]);

  // Zoom around the middle of the frame so the framed subject stays put.
  const zoomTo = (value: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, value));
    const ratio = next / zoom;
    setOffset(prev => clamp({ x: VIEW / 2 - (VIEW / 2 - prev.x) * ratio, y: VIEW / 2 - (VIEW / 2 - prev.y) * ratio }, next));
    setZoom(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      setOffset(prev => clamp({ x: prev.x + e.clientX - last.x, y: prev.y + e.clientY - last.y }));
    } else if (pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img || !size) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    canvas.getContext('2d')!.drawImage(img, -offset.x / scale, -offset.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT);
    onApply(canvas.toDataURL('image/jpeg', 0.88));
  };

  return (
    <div className="tahoe-dialog-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 sm:p-4 select-none" onClick={e => { e.stopPropagation(); onCancel(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" onClick={e => e.stopPropagation()}
        className="tahoe-dialog kit-dialog w-full max-w-sm overflow-y-auto p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="avatar-crop-title" className="apple-title2 kit-text-primary font-semibold">Chỉnh ảnh đại diện</h2>
            <p className="apple-callout kit-text-secondary mt-1">Kéo ảnh để chọn khung, dùng thanh trượt để phóng to.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Đóng" className="kit-dialog-close"><X size={18} /></button>
        </div>
        <div
          className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-[26px] bg-black/20 active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW, maxWidth: '100%' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onWheel={e => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 0.93))}
        >
          <img ref={imgRef} src={src} alt="" draggable={false}
            onLoad={e => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute left-0 top-0 max-w-none origin-top-left"
            style={size ? { width: size.w, height: size.h, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` } : { opacity: 0 }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[26px] ring-2 ring-inset ring-white/80" />
        </div>
        <label className="apple-callout kit-text-secondary mt-4 block">
          Phóng to
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => zoomTo(Number(e.target.value))} className="mt-1 block w-full" />
        </label>
        <div className="mt-5 flex gap-2.5">
          <button type="button" onClick={onCancel} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={apply} disabled={!size} className="primary-button min-h-11 flex-1 px-4"><Check size={16} /><span>Dùng ảnh</span></button>
        </div>
      </div>
    </div>
  );
}
