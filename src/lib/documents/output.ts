import { isZaloMiniApp } from '../platform';
import { BuiltDocument, renderPdfBlob } from './engine';

export interface DeliverResult { ok: boolean; message: string }

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Saves the generated file itself. Zalo's webview ignores `download`, so it goes through the share sheet. */
export async function saveDocument(doc: BuiltDocument): Promise<DeliverResult> {
  const blob = await renderPdfBlob(doc);
  if (isZaloMiniApp) {
    const file = new File([blob], doc.fileName, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: doc.title });
        return { ok: true, message: 'Đã mở bảng chia sẻ tệp PDF.' };
      } catch (err: any) {
        if (err?.name === 'AbortError') return { ok: false, message: '' };
      }
    }
    return { ok: false, message: 'Zalo chưa cho tải tệp trực tiếp. Vui lòng mở bằng trình duyệt trên điện thoại để tải PDF.' };
  }
  downloadBlob(blob, doc.fileName);
  return { ok: true, message: 'Đã tải tệp PDF về máy.' };
}

/** Prints only the document, from the generated PDF, so the website can never end up on paper. */
export async function printDocument(doc: BuiltDocument): Promise<void> {
  const blob = await renderPdfBlob(doc);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120000);
}

export const canPrintDocuments = !isZaloMiniApp;
