/**
 * Helper to download or save QR code images directly to the device,
 * and share via Zalo / native sheet.
 */
import { saveImageToGallery, openShareSheet, showToast } from 'zmp-sdk/apis';
import { isZaloMiniApp } from './platform';

export async function saveQrToDevice(
  qrUrl: string,
  fileName: string = 'VietQR_EcoStay.png'
): Promise<{ success: boolean; message: string }> {
  if (!qrUrl) {
    return { success: false, message: 'Không tìm thấy đường dẫn mã QR' };
  }

  // 1. Zalo Mini App Native Storage to Gallery
  if (isZaloMiniApp) {
    try {
      await saveImageToGallery({ imageUrl: qrUrl });
      try {
        await showToast({ message: 'Đã lưu mã QR vào Thư viện ảnh thành công!' });
      } catch {}
      return { success: true, message: 'Đã lưu mã QR vào thư viện ảnh!' };
    } catch (err: any) {
      console.warn('[QR] saveImageToGallery failed, attempting browser fallback:', err);
    }
  }

  // 2. Standard Web Browser Download
  try {
    const response = await fetch(qrUrl);
    if (!response.ok) throw new Error('Fetch failed');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return { success: true, message: 'Đã tải mã QR về máy thành công!' };
  } catch (err) {
    // 3. Fallback: Open in new window/tab
    const a = document.createElement('a');
    a.href = qrUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { success: true, message: 'Đang mở mã QR để lưu ảnh!' };
  }
}

/**
 * Share QR image or document image directly via Zalo chat / friends / My Cloud.
 */
export async function shareViaZalo(
  qrUrl: string,
  description: string = 'Mã VietQR thanh toán tiền phòng EcoStay'
): Promise<{ success: boolean; message: string }> {
  if (!qrUrl) {
    return { success: false, message: 'Không tìm thấy hình ảnh để gửi' };
  }

  // 1. In Zalo Mini App: use native openShareSheet
  if (isZaloMiniApp) {
    try {
      await openShareSheet({
        type: 'image',
        data: {
          imageUrls: [qrUrl],
        },
      });
      return { success: true, message: 'Đã mở bảng chia sẻ Zalo!' };
    } catch (err: any) {
      console.warn('[Share] openShareSheet image failed, trying link share:', err);
      try {
        await openShareSheet({
          type: 'link',
          data: {
            link: qrUrl,
            chatOnly: true,
          },
        });
        return { success: true, message: 'Đã mở bảng chia sẻ Zalo!' };
      } catch (e) {
        console.warn('[Share] fallback failed:', e);
      }
    }
  }

  // 2. Browser Web Share API fallback
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: 'Mã QR EcoStay',
        text: description,
        url: qrUrl,
      });
      return { success: true, message: 'Đã chia sẻ thành công!' };
    } catch (e) {
      // User cancelled
    }
  }

  // 3. Fallback: Copy link and inform user
  try {
    await navigator.clipboard.writeText(qrUrl);
    alert('Đã sao chép link ảnh mã QR! Bạn có thể dán vào khung chat Zalo để gửi.');
    return { success: true, message: 'Đã sao chép link ảnh QR!' };
  } catch {
    window.open(qrUrl, '_blank');
    return { success: true, message: 'Đang mở ảnh QR!' };
  }
}

/**
 * Share contract or administrative document directly via Zalo
 */
export async function shareContractViaZalo(
  docTitle: string,
  docText: string
): Promise<{ success: boolean; message: string }> {
  // 1. In Zalo Mini App: use native openShareSheet with text
  if (isZaloMiniApp) {
    try {
      await openShareSheet({
        type: 'text',
        data: {
          text: `${docTitle}\n\n${docText}`,
        },
      });
      return { success: true, message: 'Đã mở bảng chia sẻ Zalo!' };
    } catch (err: any) {
      console.warn('[Contract Share] openShareSheet failed:', err);
    }
  }

  // 2. Web Share API fallback
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: docTitle,
        text: docText,
      });
      return { success: true, message: 'Đã chia sẻ thành công!' };
    } catch (e) {
      // User cancelled
    }
  }

  // 3. Clipboard fallback
  try {
    await navigator.clipboard.writeText(`${docTitle}\n\n${docText}`);
    alert('Đã sao chép toàn bộ nội dung văn bản! Bạn có thể dán vào Zalo để gửi.');
    return { success: true, message: 'Đã sao chép nội dung văn bản!' };
  } catch {
    return { success: false, message: 'Không thể sao chép văn bản' };
  }
}


