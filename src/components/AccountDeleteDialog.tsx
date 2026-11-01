import React from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

export type AccountDeleteMode = 'resident' | 'account';

interface AccountDeleteDialogProps {
  name: string;
  room: string;
  mode: AccountDeleteMode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AccountDeleteDialog({ name, room, mode, busy, onCancel, onConfirm }: AccountDeleteDialogProps) {
  const dialogRef = useDialogFocus(true, () => { if (!busy) onCancel(); });
  const isAccount = mode === 'account';
  return (
    <div className="tahoe-dialog-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!busy) onCancel(); }}>
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="account-delete-title" onClick={e => e.stopPropagation()} className="tahoe-dialog kit-dialog w-full max-w-md p-5 sm:p-6">
        <h2 id="account-delete-title" className="apple-title2 font-semibold kit-text-primary">{isAccount ? 'Xoá tài khoản?' : 'Xoá người ở?'}</h2>
        <p className="apple-body kit-text-primary mt-2 font-medium">{name}{room ? ` · Phòng ${room}` : ''}</p>
        <p className="apple-callout kit-text-secondary mt-2 leading-relaxed">
          {isAccount
            ? 'Xoá hẳn dòng này ở tab cá nhân và bỏ khỏi phòng ở tháng hiện tại. Người này sẽ không đăng nhập được nữa. Không thể hoàn tác trong app.'
            : 'Bỏ người này khỏi phòng từ tháng hiện tại. Tài khoản và thông tin cá nhân vẫn được giữ, có thể xếp lại phòng ở cột J.'}
        </p>
        <p className="apple-callout kit-text-secondary mt-2">Các tháng đã qua được giữ nguyên.</p>
        <div className="mt-5 flex gap-2.5">
          <button type="button" onClick={onCancel} disabled={busy} className="soft-button min-h-11 flex-1 px-4">Huỷ</button>
          <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy} className="min-h-11 flex-1 rounded-2xl bg-rose-600 px-4 font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{busy ? 'Đang xoá…' : isAccount ? 'Xoá tài khoản' : 'Xoá người ở'}</button>
        </div>
      </div>
    </div>
  );
}
