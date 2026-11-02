import React, { useEffect, useRef, useState } from 'react';
import { scanQRCode } from 'zmp-sdk/apis';
import { useDialogFocus } from '../lib/useDialogFocus';
import { isZaloMiniApp } from '../lib/platform';
import { API_BASE_URL, apiFetch } from '../lib/api';
import { CccdQrData, createQrDetector, parseCccdQr, readQrFromImage } from '../lib/cccdQr';
import { X } from './AppIcons';

interface CccdQrScannerProps {
  onClose: () => void;
  onResult: (data: CccdQrData) => void;
  /** Offer scanning with a phone instead of the webcam; off on the phone page itself. */
  phoneHandoff?: boolean;
}

/** The phone opens the app on the server that also answers the API; a local dev page falls back to itself. */
function handoffLink(id: string): string {
  const server = /^https?:\/\//.test(API_BASE_URL) && !/localhost|127\.0\.0\.1/.test(API_BASE_URL)
    ? API_BASE_URL.replace(/\/+$/, '') + '/'
    : window.location.origin + window.location.pathname;
  return `${server}#/cccd-scan/${encodeURIComponent(id)}`;
}

const NOT_CCCD = 'Mã này không phải QR trên CCCD. Vui lòng thử lại.';
const ONLY_VIRTUAL = 'Máy chỉ có camera ảo (như OBS). Hãy cắm hoặc bật webcam rồi chọn ở ô Camera, hoặc chọn ảnh có mã QR.';

/** Apps that register as a camera but show their own picture, such as OBS on a computer. */
const VIRTUAL_CAMERA = /obs|virtual|manycam|xsplit|snap camera/i;

/** Largest square handed to jsQR; bigger frames are read whole (shrunk) and by their middle (not shrunk). */
const SCAN_SIZE = 1000;

/** Scans on the device itself: no CCCD photo or frame ever leaves the phone. */
export function CccdQrScanner({ onClose, onResult, phoneHandoff = true }: CccdQrScannerProps) {
  const dialogRef = useDialogFocus(true, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [cameraError, setCameraError] = useState('');
  const [message, setMessage] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const triedZaloScanner = useRef(false);
  // A computer's webcam rarely reads the dense CCCD code, so with a mouse the phone is offered first.
  const canHandoff = phoneHandoff && !isZaloMiniApp;
  const [mode, setMode] = useState<'phone' | 'camera'>(() => canHandoff && window.matchMedia?.('(pointer: fine)').matches ? 'phone' : 'camera');
  const [handoffQr, setHandoffQr] = useState('');
  const [handoffRound, setHandoffRound] = useState(0);
  const [handoffExpired, setHandoffExpired] = useState(false);

  // Phone mode: open a session, show its link as a QR, and wait for the phone to post what it read.
  useEffect(() => {
    if (mode !== 'phone') return;
    let stopped = false;
    let timer = 0;
    setHandoffQr('');
    setHandoffExpired(false);
    setMessage('');
    (async () => {
      try {
        const res = await apiFetch('/api/cccd-handoff', { method: 'POST' });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success || !body.id) throw new Error();
        const { default: QRCode } = await import('qrcode');
        const image = await QRCode.toDataURL(handoffLink(body.id), { margin: 1, width: 440 });
        if (stopped) return;
        setHandoffQr(image);
        const poll = async () => {
          if (stopped) return;
          try {
            const reply = await apiFetch(`/api/cccd-handoff/${encodeURIComponent(body.id)}`);
            const result = await reply.json().catch(() => null);
            if (stopped) return;
            if (reply.status === 404) {
              setHandoffExpired(true);
              return;
            }
            if (result?.status === 'done' && result.data) {
              stopped = true;
              resultRef.current(result.data as CccdQrData);
              return;
            }
          } catch {}
          timer = window.setTimeout(poll, 1500);
        };
        timer = window.setTimeout(poll, 1500);
      } catch {
        if (!stopped) setMessage('Chưa tạo được mã cho điện thoại. Vui lòng kiểm tra mạng rồi thử lại.');
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [mode, handoffRound]);

  useEffect(() => {
    if (mode !== 'camera') return;
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
        const onVirtual = VIRTUAL_CAMERA.test(stream.getVideoTracks()[0]?.label || '');
        if (!deviceId && realCamera && onVirtual) {
          setDeviceId(realCamera.deviceId);
          return;
        }
        if (onVirtual && !realCamera) setMessage(ONLY_VIRTUAL);
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
  }, [deviceId, mode]);

  // A webcam or phone camera plugged in while the dialog is open shows up in the list straight away.
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.addEventListener) return;
    const refresh = () => devices.enumerateDevices()
      .then(found => {
        const videos = found.filter(device => device.kind === 'videoinput' && device.label);
        if (videos.length) setCameras(videos);
        setMessage(prev => prev === ONLY_VIRTUAL && videos.some(device => !VIRTUAL_CAMERA.test(device.label)) ? '' : prev);
      })
      .catch(() => {});
    devices.addEventListener('devicechange', refresh);
    return () => devices.removeEventListener('devicechange', refresh);
  }, []);

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
            <p className="apple-callout kit-text-secondary mt-1">
              {mode === 'phone' ? 'Dùng camera điện thoại để quét, thông tin tự điền vào đây.' : 'Đưa CCCD lại gần để mã QR nằm gọn trong ô vuông, giữ yên và tránh lóa.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="kit-dialog-close"><X size={18} /></button>
        </div>
        {canHandoff && (
          <div role="group" aria-label="Cách quét" className="mb-3 grid grid-cols-2 gap-2">
            {([['phone', 'Điện thoại'], ['camera', 'Webcam']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMessage(''); setMode(value); }}
                className={`${mode === value ? 'primary-button' : 'soft-button'} min-h-11 px-3 apple-control text-sm font-semibold`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {mode === 'phone' ? (
          <div className="flex flex-col items-center text-center">
            {handoffExpired ? (
              <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-[22px] bg-black/5 p-4 dark:bg-white/5">
                <p className="apple-callout kit-text-secondary">Mã đã hết hạn sau 5 phút.</p>
                <button type="button" onClick={() => setHandoffRound(round => round + 1)} className="primary-button min-h-11 px-4">Tạo mã mới</button>
              </div>
            ) : handoffQr ? (
              <img src={handoffQr} alt="Mã QR để mở trang quét CCCD trên điện thoại" className="aspect-square w-full max-w-[240px] rounded-2xl bg-white p-2" />
            ) : (
              <div role="status" className="flex aspect-square w-full max-w-[240px] items-center justify-center rounded-2xl bg-black/5 apple-callout kit-text-secondary dark:bg-white/5">Đang tạo mã...</div>
            )}
            <ol className="apple-callout kit-text-secondary mt-3 list-decimal space-y-1 pl-5 text-left">
              <li>Mở camera điện thoại, quét mã trên và mở liên kết.</li>
              <li>Trên điện thoại, quét QR ở mặt trước CCCD.</li>
              <li>Thông tin tự điền vào hồ sơ trên máy tính.</li>
            </ol>
          </div>
        ) : cameraError
          ? <p role="alert" className="apple-callout kit-text-secondary rounded-2xl bg-black/5 p-4 dark:bg-white/5">{cameraError}</p>
          : (
            <div className="relative overflow-hidden rounded-[22px]">
              <video ref={videoRef} muted playsInline aria-label="Hình ảnh từ camera" className="aspect-square w-full rounded-[22px] bg-black object-cover" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-[22.5%] rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
          )}
        {mode === 'camera' && cameras.length > 0 && (
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
