import React, { useState } from 'react';
import { 
  KeyRound, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';
import { GlassIconLock, GlassIconSecurity } from './GlassIcons';

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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={handlePostpone}
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-[#101726] rounded-[32px] border border-white/80 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.45)] overflow-hidden relative animate-in zoom-in-95 duration-200 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        {/* Background ambient glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-[80px] pointer-events-none" />

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5 relative z-10">
          
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-800/50 shadow-sm">
                <GlassIconLock size={38} />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Cập nhật mật khẩu
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Bạn đang sử dụng mật khẩu mặc định. Bạn có muốn cập nhật mật khẩu mới để bảo mật tài khoản hơn không?
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handlePostpone}
              className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 -mt-1 -mr-1"
              aria-label="Đóng"
            >
              <X size={18} />
            </button>
          </div>

          {/* Alert Messages */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in duration-200 font-bold">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Input Fields */}
          <div className="space-y-3.5 pt-1">
            
            {/* Field 1: Mật khẩu hiện tại */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Mật khẩu hiện tại
              </label>
              <div className="relative">
                <input
                  type={showCurPass ? 'text' : 'password'}
                  value={curPass}
                  onChange={e => setCurPass(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-mono font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                  placeholder="Mật khẩu hiện tại (1)"
                />
                <button
                  type="button"
                  onClick={() => setShowCurPass(!showCurPass)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label={showCurPass ? "Ẩn mật khẩu hiện tại" : "Hiện mật khẩu hiện tại"}
                >
                  {showCurPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Field 2: Mật khẩu mới */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Mật khẩu mới
              </label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPass}
                  onChange={e => setNewPass(e.target.value)}
                  required
                  placeholder="Nhập ít nhất 6 ký tự"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-mono font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label={showNewPass ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                >
                  {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Field 3: Xác nhận mật khẩu mới */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Xác nhận mật khẩu mới
              </label>
              <div className="relative">
                <input
                  type={showConfirmPass ? 'text' : 'password'}
                  value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  required
                  placeholder="Nhập lại mật khẩu mới"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-mono font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPass(!showConfirmPass)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label={showConfirmPass ? "Ẩn xác nhận mật khẩu" : "Hiện xác nhận mật khẩu"}
                >
                  {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex flex-col-reverse sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={handlePostpone}
              className="w-full sm:flex-1 py-3 px-4 rounded-2xl soft-button text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer text-center"
            >
              Nhắc lại sau
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:flex-1 py-3 px-4 rounded-2xl primary-button text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer text-center"
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
