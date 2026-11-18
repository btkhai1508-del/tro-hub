/**
 * Helper to download or save QR code images directly to the device,
 * and share via Zalo / native sheet.
 */
import { saveImageToGallery, openShareSheet, showToast } from 'zmp-sdk/apis';
import { isZaloMiniApp } from './platform';
import { WORKER_API_URL } from './api';

/** A real PNG with a white margin: gallery apps reject the SVG the QR service can return, and scanners need the margin. */
async function buildQrPng(qrUrl: string): Promise<Blob> {
  // SePay's vietqr.app sends no CORS header, so the page reads the same image through the Worker.
  // (The old img.vietqr.io redirected .png to .svg without CORS, so only .svg could be read there.)
  const source = qrUrl.startsWith('https://vietqr.app/img?')
    ? `${WORKER_API_URL}/qr.png?${qrUrl.slice(qrUrl.indexOf('?') + 1)}`
    : qrUrl.replace(/\.png(?=\?|$)/, '.svg');
  const response = await fetch(source);
  if (!response.ok) throw new Error('Fetch failed');
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image failed'));
      element.src = objectUrl;
    });
    // Keep the image's own shape: SePay's QR with account info underneath is taller than wide.
    const width = 1024;
    const margin = 64;
    const inner = width - margin * 2;
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 1;
    const height = Math.round(inner * ratio) + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, margin, margin, inner, height - margin * 2);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Encode failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const prepared = new Map<string, Promise<Blob>>();

/** Build ahead of the tap: iPhone only opens the share sheet if it comes straight from the tap. */
export function prepareQrImage(qrUrl: string): Promise<Blob> {
  let pending = prepared.get(qrUrl);
  if (!pending) {
    pending = buildQrPng(qrUrl);
    pending.catch(() => prepared.delete(qrUrl));
    prepared.set(qrUrl, pending);
  }
  return pending;
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/**
 * Only Zalo can write to the photo library directly. A browser cannot, so phones get the
 * share sheet, whose "Lưu hình ảnh" puts the QR in Photos; computers get a normal download.
 */
export async function saveQrToDevice(
  qrUrl: string,
  fileName: string = 'VietQR_PhongLan.png'
): Promise<{ success: boolean; message: string }> {
  if (!qrUrl) {
    return { success: false, message: 'Không tìm thấy đường dẫn mã QR' };
  }

  let blob: Blob | null = null;
  try {
    blob = await prepareQrImage(qrUrl);
  } catch (err) {
    console.warn('[QR] could not build PNG', err);
  }

  if (isZaloMiniApp) {
    try {
      await saveImageToGallery(blob ? { imageBase64Data: await blobToDataUrl(blob) } : { imageUrl: qrUrl });
      try {
        await showToast({ message: 'Đã lưu mã QR vào Thư viện ảnh thành công!' });
      } catch {}
      return { success: true, message: 'Đã lưu mã QR vào thư viện ảnh.' };
    } catch (err: any) {
      console.warn('[QR] saveImageToGallery failed, attempting browser fallback:', err);
    }
  }

  if (!blob) {
    return { success: false, message: 'Chưa tạo được ảnh QR. Bạn có thể nhấn giữ vào mã để lưu ảnh.' };
  }

  const file = new File([blob], fileName, { type: 'image/png' });
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (isTouchDevice && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return { success: true, message: 'Chọn "Lưu hình ảnh" để đưa mã QR vào kho ảnh.' };
    } catch (err: any) {
      if (err?.name === 'AbortError') return { success: false, message: '' };
      console.warn('[QR] share failed, downloading instead:', err);
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  return { success: true, message: isTouchDevice ? 'Đã tải mã QR về máy. Mở thư mục Tải về để lưu vào kho ảnh.' : 'Đã tải mã QR về máy.' };
}
