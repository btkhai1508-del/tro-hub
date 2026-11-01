import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import { CccdQrData, parseCccdQr, readQrFromImage } from '../lib/cccdQr';
import { X } from './AppIcons';

interface CccdQrScannerProps {
  onClose: () => void;
  onResult: (data: CccdQrData) => void;
}

const NOT_CCCD = 'Mã này không phải QR trên CCCD. Vui lòng thử lại.';

/** Scans on the device itself: no CCCD photo or frame ever leaves the phone. */
export function CccdQrScanner({ onClose, onResult }: CccdQrScannerProps) {
  const dialogRef = useDialogFocus(true, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [cameraError, setCameraError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let lastScan = 0;
    const canvas = document.createElement('canvas');

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Thiết bị này chưa mở được camera. Bạn có thể chọn ảnh CCCD bên dưới.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const { default: jsQR } = await import('jsqr');
        const scan = (time: number) => {
          if (stopped) return;
          // A few reads a second is enough and keeps the phone cool.
          if (time - lastScan > 200 && video.videoWidth) {
            lastScan = time;
            const scale = Math.min(1, 900 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) {
              const data = parseCccdQr(code.data);
              if (data) {
                resultRef.current(data);
                return;
              }
              setMessage(NOT_CCCD);
            }
          }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch {
        setCameraError('Chưa mở được camera. Hãy cho phép quyền camera, hoặc chọn ảnh CCCD bên dưới.');
      }
    };
    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage('');
    try {
      const data = parseCccdQr(await readQrFromImage(file));
      if (data) onResult(data);
      else setMessage('Chưa đọc được QR trong ảnh này. Hãy chụp rõ và gần mã QR hơn.');
    } catch {
      setMessage('Chưa đọc được ảnh này. Vui lòng chọn ảnh khác.');
    }
  };

  return (
    <div className="tahoe-dialog-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 sm:p-4" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cccd-qr-title" onClick={e => e.stopPropagation()}
        className="tahoe-dialog kit-dialog w-full max-w-sm overflow-y-auto p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="cccd-qr-title" className="apple-title2 kit-text-primary font-semibold">Quét QR CCCD</h2>
            <p className="apple-callout kit-text-secondary mt-1">Đưa mã QR ở mặt trước CCCD vào khung hình.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="kit-dialog-close"><X size={18} /></button>
        </div>
        {cameraError
          ? <p role="alert" className="apple-callout kit-text-secondary rounded-2xl bg-black/5 p-4 dark:bg-white/5">{cameraError}</p>
          : <video ref={videoRef} muted playsInline aria-label="Hình ảnh từ camera" className="aspect-square w-full rounded-[22px] bg-black object-cover" />}
        {message && <p role="alert" className="apple-callout mt-3 text-red-700 dark:text-red-400">{message}</p>}
        <label className="soft-button mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center px-4 focus-within:ring-2">
          Chọn ảnh có mã QR
          <input type="file" accept="image/*" onChange={handleFile} className="sr-only" />
        </label>
      </div>
    </div>
  );
}
