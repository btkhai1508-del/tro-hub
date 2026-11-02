import React, { useEffect, useRef, useState } from 'react';
import { scanQRCode } from 'zmp-sdk/apis';
import { useDialogFocus } from '../lib/useDialogFocus';
import { isZaloMiniApp } from '../lib/platform';
import { CccdQrData, createQrDetector, parseCccdQr, readQrFromImage } from '../lib/cccdQr';
import { X } from './AppIcons';

interface CccdQrScannerProps {
  onClose: () => void;
  onResult: (data: CccdQrData) => void;
}

const NOT_CCCD = 'Mã này không phải QR trên CCCD. Vui lòng thử lại.';

/** Apps that register as a camera but show their own picture, such as OBS on a computer. */
const VIRTUAL_CAMERA = /obs|virtual|manycam|xsplit|snap camera/i;

/** Largest square handed to jsQR; bigger frames are read whole (shrunk) and by their middle (not shrunk). */
const SCAN_SIZE = 1000;

/** Scans on the device itself: no CCCD photo or frame ever leaves the phone. */
export function CccdQrScanner({ onClose, onResult }: CccdQrScannerProps) {
  const dialogRef = useDialogFocus(true, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [cameraError, setCameraError] = useState('');
  const [message, setMessage] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const triedZaloScanner = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let lastScan = 0;
    let pass = 0;
    const canvas = document.createElement('canvas');

    const handleText = (text: string) => {
      const data = parseCccdQr(text);
      if (data) {
        stopped = true;
        resultRef.current(data);
      } else {
        setMessage(NOT_CCCD);
      }
    };

    const start = async () => {
      // Zalo's own scanner reads small codes best. Cancelling or being refused falls through to the camera below.
      if (isZaloMiniApp && !triedZaloScanner.current) {
        triedZaloScanner.current = true;
        try {
          const { content } = await scanQRCode({});
          if (stopped) return;
          handleText(content);
          if (stopped) return;
        } catch {
          if (stopped) return;
        }
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Thiết bị này chưa mở được camera. Bạn có thể chọn ảnh CCCD bên dưới.');
        return;
      }
      try {
        // The CCCD code is dense, so ask for more than the 640x480 a phone gives by default.
        setCameraError('');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false
        });
        if (stopped) return;
        // Device names are only readable once the camera is allowed.
        const found = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
        if (stopped) return;
        setCameras(found);
        const realCamera = found.find(device => !VIRTUAL_CAMERA.test(device.label));
        if (!deviceId && realCamera && VIRTUAL_CAMERA.test(stream.getVideoTracks()[0]?.label || '')) {
          setDeviceId(realCamera.deviceId);
          return;
        }
        stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = createQrDetector();
        const { default: jsQR } = await import('jsqr');
        const scan = async (time: number) => {
          if (stopped) return;
          // A few reads a second is enough and keeps the phone cool.
          if (time - lastScan > 200 && video.videoWidth) {
            lastScan = time;
            // Alternate the whole square the user sees with its middle at the camera's own pixels.
            // Shrinking a large frame loses the dots of the dense CCCD code; enlarging adds nothing.
            const whole = pass++ % 2 === 0;
            const square = Math.min(video.videoWidth, video.videoHeight);
            const side = whole ? square : Math.min(square, SCAN_SIZE);
            const size = Math.min(side, SCAN_SIZE);
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
            let text = '';
            if (detector) {
              try {
                text = (await detector.detect(whole ? video : canvas))[0]?.rawValue || '';
              } catch {}
              if (stopped) return;
            }
            if (!text) {
              text = jsQR(context.getImageData(0, 0, size, size).data, size, size)?.data || '';
            }
            if (text) {
              handleText(text);
              if (stopped) return;
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
  }, [deviceId]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage('');
    try {
      const text = await readQrFromImage(file);
      const data = parseCccdQr(text);
      if (data) onResult(data);
      else setMessage(text ? NOT_CCCD : 'Chưa đọc được QR trong ảnh này. Hãy chụp rõ và gần mã QR hơn.');
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
            <p className="apple-callout kit-text-secondary mt-1">Đưa CCCD lại gần để mã QR nằm gọn trong ô vuông, giữ yên và tránh lóa.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="kit-dialog-close"><X size={18} /></button>
        </div>
        {cameraError
          ? <p role="alert" className="apple-callout kit-text-secondary rounded-2xl bg-black/5 p-4 dark:bg-white/5">{cameraError}</p>
          : (
            <div className="relative overflow-hidden rounded-[22px]">
              <video ref={videoRef} muted playsInline aria-label="Hình ảnh từ camera" className="aspect-square w-full rounded-[22px] bg-black object-cover" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-[22.5%] rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
          )}
        {cameras.length > 1 && (
          <label className="apple-callout kit-text-secondary mt-3 block">
            Camera
            <select value={deviceId} onChange={event => setDeviceId(event.target.value)} className="kit-field mt-1 w-full px-3">
              {!deviceId && <option value="">Tự động</option>}
              {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
            </select>
          </label>
        )}
        {message && <p role="alert" className="apple-callout mt-3 text-red-700 dark:text-red-400">{message}</p>}
        <label className="soft-button mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center px-4 focus-within:ring-2">
          Chọn ảnh có mã QR
          <input type="file" accept="image/*" onChange={handleFile} className="sr-only" />
        </label>
      </div>
    </div>
  );
}
