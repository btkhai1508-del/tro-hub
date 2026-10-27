import { useDialogFocus } from '../lib/useDialogFocus';
import React, { useState } from 'react';
import {
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X
} from './AppIcons';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { IconKey3D } from './Icons3D';

interface PasswordUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PasswordUpdateModal({ isOpen, onClose, onSuccess }: PasswordUpdateModalProps) {
  const { currentPassword, updatePassword, profile } = useApp();

  const [curPass, setCurPass] = useState('1');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showCurPass, setShowCurPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogRef = useDialogFocus(isOpen, () => { localStorage.setItem(`ecostay_pw_postponed_${profile.phone || 'default'}`, 'true'); onClose(); });

  if (!isOpen) return null;

  const handlePostpone = () => {
    // IMPORTANT: "Để sau" is 100% OPTIONAL
    // 1. Close modal
    // 2. Allow user to continue using application normally
    // 3. Do not block any feature or force change
    // 4. Keep password as "1" so testing continues smoothly
    localStorage.setItem(`ecostay_pw_postponed_${profile.phone || 'default'}`, 'true');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!newPass.trim()) {
      setErrorMsg('Vui lòng nhập mật khẩu mới');
      return;
    }

    if (newPass.length < 6) {
      setErrorMsg('Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }

    if (newPass !== confirmPass) {
      setErrorMsg('Xác nhận mật khẩu mới không khớp');
      return;
    }

    if (newPass === '1') {
      setErrorMsg('Vui lòng chọn mật khẩu mới khác mật khẩu mặc định "1"');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updatePassword(curPass, newPass);
      setIsSubmitting(false);

      if (res.success) {
        setSuccessMsg('Cập nhật mật khẩu thành công!');
        localStorage.setItem(`ecostay_pw_updated_${profile.phone || 'default'}`, 'true');
        setTimeout(() => {
          if (onSuccess) onSuccess();
          onClose();
        }, 1000);
      } else {
        setErrorMsg(res.error || 'Mật khẩu hiện tại không chính xác');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg('Lỗi cập nhật: ' + (err.message || 'Vui lòng thử lại'));
    }
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30 dark:bg-black/45 duration-200 select-none"
      onClick={handlePostpone}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" className="tahoe-dialog kit-dialog w-full max-w-md max-h-[90svh] overflow-y-auto relative duration-200"
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="kit-dialog-body p-5 sm:p-7 space-y-5 relative z-10">

          {/* Header */}
          <div className="flex items-start gap-4">
            <IconKey3D size={48} className="shrink-0" />
            <div>
              <h2 id="password-dialog-title" className="text-[20px] font-semibold tracking-tight text-neutral-900 dark:text-white">
                Cập nhật mật khẩu
              </h2>
              <p className="text-xs text-neutral-700 dark:text-neutral-200 mt-1 leading-relaxed">
                Bạn đang sử dụng mật khẩu mặc định. Bạn có muốn cập nhật mật khẩu mới để bảo mật tài khoản hơn không?
              </p>
            </div>
          </div>

          {/* Alert Messages */}
          {errorMsg && (
            <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2 duration-200">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div role="status" className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2 duration-200 font-bold">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Input Fields */}
          <div className="space-y-3.5 pt-1">

            {/* Field 1: Mật khẩu hiện tại */}
            <div>
              <label htmlFor="password-curPass" className="block text-[13px] font-semibold text-neutral-700 dark:text-neutral-200 mb-1">
                Mật khẩu hiện tại
              </label>
              <div className="relative">
                <input
                  type={showCurPass ? 'text' : 'password'}
                  id="password-curPass" value={curPass}
                  onChange={e => setCurPass(e.target.value)}
                  required
                  className="kit-field w-full px-3.5 py-2.5 rounded-xl bg-white/25 dark:bg-white/5 border border-neutral-200 dark:border-neutral-700 text-xs font-mono font-medium text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-700 dark:focus:ring-white pr-10"
                  placeholder="Mật khẩu hiện tại (1)"
                />
                <button
                  type="button"
                  onClick={() => setShowCurPass(!showCurPass)}
                  aria-label={showCurPass ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
                  className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                >
                  {showCurPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Field 2: Mật khẩu mới */}
            <div>
              <label htmlFor="password-newPass" className="block text-[13px] font-semibold text-neutral-700 dark:text-neutral-200 mb-1">
                Mật khẩu mới
              </label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  id="password-newPass" value={newPass}
                  onChange={e => setNewPass(e.target.value)}
                  required
                  placeholder="Nhập ít nhất 6 ký tự"
                  className="kit-field w-full px-3.5 py-2.5 rounded-xl bg-white/25 dark:bg-white/5 border border-neutral-200 dark:border-neutral-700 text-xs font-mono font-medium text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-700 dark:focus:ring-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  aria-label={showNewPass ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                  className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                >
                  {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Field 3: Xác nhận mật khẩu mới */}
            <div>
              <label htmlFor="password-confirmPass" className="block text-[13px] font-semibold text-neutral-700 dark:text-neutral-200 mb-1">
                Xác nhận mật khẩu mới
              </label>
              <div className="relative">
                <input
                  type={showConfirmPass ? 'text' : 'password'}
                  id="password-confirmPass" value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  required
                  placeholder="Nhập lại mật khẩu mới"
                  className="kit-field w-full px-3.5 py-2.5 rounded-xl bg-white/25 dark:bg-white/5 border border-neutral-200 dark:border-neutral-700 text-xs font-mono font-medium text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-700 dark:focus:ring-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPass(!showConfirmPass)}
                  aria-label={showConfirmPass ? 'Ẩn xác nhận mật khẩu mới' : 'Hiện xác nhận mật khẩu mới'}
                  className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                >
                  {showConfirmPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex flex-col-reverse sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={handlePostpone}
              className="min-h-11 w-full sm:flex-1 py-3 px-4 rounded-2xl soft-button text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-all cursor-pointer text-center"
            >
              Để sau
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 w-full sm:flex-1 py-3 px-4 rounded-2xl primary-button text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer text-center"
            >
              {isSubmitting ? (
                <span>Đang cập nhật...</span>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Cập nhật mật khẩu</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
