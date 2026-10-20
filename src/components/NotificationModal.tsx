import { X, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import { IconWallet3D, IconAlert3D, IconSecurity3D, IconNotification3D } from './Icons3D';

const badgeColorMap = {
  invoice: 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800',
  alert: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  success: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  info: 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
};

export function NotificationModal() {
  const { activeNotification, closeNotificationModal } = useApp();
  const navigate = useNavigate();

  if (!activeNotification) return null;

  const isInvoice = activeNotification.type === 'invoice';

  const handleAction = () => {
    closeNotificationModal();
    if (isInvoice) {
      navigate('/payment');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={closeNotificationModal}
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-[#101726] rounded-3xl border border-white/90 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.3)] overflow-hidden relative animate-in zoom-in-95 duration-200 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Darker Bar & Clear Close X Button */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeColorMap[activeNotification.type]} dark:bg-slate-800 dark:border-slate-700`}>
              {activeNotification.type === 'invoice' && 'Thông báo thanh toán'}
              {activeNotification.type === 'alert' && 'Nhắc nhở cư dân'}
              {activeNotification.type === 'success' && 'Giao dịch thành công'}
              {activeNotification.type === 'info' && 'Thông báo chung'}
            </span>
          </div>

          <button 
            type="button"
            onClick={closeNotificationModal}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng thông báo"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            {activeNotification.type === 'invoice' ? (
              <IconWallet3D size={48} className="shrink-0" />
            ) : activeNotification.type === 'alert' ? (
              <IconAlert3D size={48} className="shrink-0" />
            ) : activeNotification.type === 'success' ? (
              <IconSecurity3D size={48} className="shrink-0" />
            ) : (
              <IconNotification3D size={48} className="shrink-0" />
            )}

            <div className="min-w-0 flex-1">
              <h3 className="type-h3 text-slate-900 dark:text-slate-100 leading-snug font-bold">
                {activeNotification.title}
              </h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 font-num">
                <span>{activeNotification.sender || 'Ban Quản Lý Nhà Trọ Phong Lan'}</span>
                <span>•</span>
                <span>{activeNotification.time}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50/90 dark:bg-slate-800/80 rounded-2xl p-4 border border-slate-100/90 dark:border-slate-700/80">
            <p className="type-body text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
              {activeNotification.desc}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={closeNotificationModal}
            className={isInvoice 
              ? "soft-button px-5 py-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"
              : "primary-button px-6 py-2.5 text-xs cursor-pointer font-bold"
            }
          >
            {isInvoice ? 'Để sau' : 'Đã hiểu'}
          </button>

          {isInvoice && (
            <button
              type="button"
              onClick={handleAction}
              className="primary-button px-5 py-2.5 text-xs flex items-center gap-1.5 shadow-sm cursor-pointer font-bold bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span>Thanh toán ngay</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
