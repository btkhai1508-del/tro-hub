/**
 * Picks a photo from the phone. Browsers open the system photo picker without a permission prompt;
 * Zalo Mini App asks through its own chooseImage API.
 */
import { chooseImage } from 'zmp-sdk/apis';
import { isZaloMiniApp } from './platform';

const MAX_SIDE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = src;
  });
}

/** Shrinks a photo so it fits browser storage (a phone photo is several MB). */
export async function imageToAvatarDataUrl(src: string): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await imageToAvatarDataUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Zalo only: returns null when the user cancels. */
export async function pickImageInZalo(source: 'album' | 'camera'): Promise<string | null> {
  const { filePaths } = await chooseImage({ count: 1, sourceType: [source], cameraType: 'front' });
  if (!filePaths?.[0]) return null;
  return imageToAvatarDataUrl(filePaths[0]);
}

export const usesZaloImagePicker = isZaloMiniApp;
