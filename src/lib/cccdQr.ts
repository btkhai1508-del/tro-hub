export interface CccdQrData {
  cccd: string;
  name: string;
  dob: string;
  gender: string;
  address: string;
}

/** The QR on a chip CCCD holds: số CCCD|số CMND cũ|họ tên|ngày sinh ddmmyyyy|giới tính|địa chỉ|ngày cấp. */
export function parseCccdQr(text: string): CccdQrData | null {
  const parts = String(text || '').split('|').map(part => part.trim());
  if (parts.length < 6 || !/^\d{12}$/.test(parts[0]) || !parts[2]) return null;
  const dob = /^\d{8}$/.test(parts[3]) ? `${parts[3].slice(0, 2)}/${parts[3].slice(2, 4)}/${parts[3].slice(4)}` : '';
  const gender = /^n[ữu]/i.test(parts[4]) ? 'Nữ' : /^nam/i.test(parts[4]) ? 'Nam' : '';
  return { cccd: parts[0], name: parts[2], dob, gender, address: parts[5] };
}

export interface QrDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/** The browser's own QR reader copes with glare and blur better than jsQR, where it exists. */
export function createQrDetector(): QrDetector | null {
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) return null;
  try {
    return new Detector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/** Reads a QR from a photo, retrying smaller sizes and then each part, because a whole-card photo leaves the code small. */
export async function readQrFromImage(source: Blob): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    const text = (await createQrDetector()?.detect(bitmap))?.[0]?.rawValue;
    if (text) return text;
  } catch {}
  const { default: jsQR } = await import('jsqr');
  const read = (x: number, y: number, width: number, height: number, side: number) => {
    const scale = Math.min(1, side / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data || '';
  };
  const { width, height } = bitmap;
  for (const side of [1600, 1000, 700]) {
    const text = read(0, 0, width, height, side);
    if (text) return text;
  }
  for (const [x, y] of [[0.5, 0], [0, 0], [0.5, 0.5], [0, 0.5], [0.25, 0.25]]) {
    const text = read(x * width, y * height, width / 2, height / 2, 1200);
    if (text) return text;
  }
  return '';
}
