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

/** Reads a QR from a photo, retrying smaller sizes because large photos often hide the code. */
export async function readQrFromImage(source: Blob): Promise<string> {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await createImageBitmap(source);
  const longest = Math.max(bitmap.width, bitmap.height);
  for (const side of [1600, 1000, 700]) {
    const scale = Math.min(1, side / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (result?.data) return result.data;
  }
  return '';
}
