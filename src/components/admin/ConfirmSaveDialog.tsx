import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/useDialogFocus';

/** The one confirmation before a save: a summary of what will be saved, then Xác nhận / Huỷ. */
export default function ConfirmSaveDialog({ open, title, lines, onConfirm, onCancel, message, confirmLabel = 'Xác nhận' }: {
  open: boolean;
  title: string;
  lines: string[];
  /** Optional sentence under the list. */
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus(open, onCancel);
  if (!open) return null;
  return createPortal(
    <div className="tahoe-dialog-overlay fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="confirm-save-title"
        className="tahoe-dialog w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h4 id="confirm-save-title" className="font-bold text-neutral-900 dark:text-white">{title}</h4>
        {lines.length > 0 && (
          <ul className="space-y-1 text-sm text-neutral-700 dark:text-neutral-200 list-disc pl-5">
            {lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        )}
        {message && <p className="text-sm text-neutral-700 dark:text-neutral-200">{message}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end pt-1">
          <button type="button" onClick={onCancel} className="soft-button min-h-11 px-5 text-sm font-bold cursor-pointer">Huỷ</button>
          <button type="button" onClick={onConfirm} className="primary-button min-h-11 px-5 text-sm font-bold cursor-pointer">{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
