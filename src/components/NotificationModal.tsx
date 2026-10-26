import { useDialogFocus } from '../lib/useDialogFocus';
import { X, ArrowRight } from './AppIcons';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import { IconWallet3D, IconAlert3D, IconSecurity3D, IconNotification3D } from './Icons3D';

const badgeColorMap = {
  invoice: 'bg-neutral-100/70 text-neutral-700 border-neutral-200/70 dark:bg-white/10 dark:text-neutral-100 dark:border-white/10',
  alert: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  success: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  info: 'bg-neutral-100/70 text-neutral-700 border-neutral-200/70 dark:bg-white/10 dark:text-neutral-100 dark:border-white/10',
};

export function NotificationModal() {
  const { activeNotification, closeNotificationModal } = useApp();
  const navigate = useNavigate();

  const dialogRef = useDialogFocus(Boolean(activeNotification), closeNotificationModal);

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
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 dark:bg-black/45 duration-200"
      onClick={closeNotificationModal}
    >
      <div ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="notification-dialog-title" className="tahoe-dialog kit-dialog w-full max-w-md max-h-[90svh] overflow-y-auto relative duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Darker Bar & Clear Close X Button */}
        <div className="kit-window-toolbar flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeColorMap[activeNotification.type]} dark:bg-neutral-800 dark:border-neutral-700`}>
              {activeNotification.type === 'invoice' && 'Thông báo thanh toán'}
              {activeNotification.type === 'alert' && 'Nhắc nhở cư dân'}
              {activeNotification.type === 'success' && 'Giao dịch thành công'}
              {activeNotification.type === 'info' && 'Thông báo chung'}
            </span>
          </div>

          <button
            type="button"
            onClick={closeNotificationModal}
            className="kit-dialog-close h-11 w-11 shrink-0 rounded-full bg-white/20 dark:bg-white/5 hover:bg-white/35 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng thông báo"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="kit-dialog-body p-5 sm:p-6 space-y-4">
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
              <h3 id="notification-dialog-title" className="type-h3 text-neutral-900 dark:text-neutral-100 leading-snug font-bold">
                {activeNotification.title}
              </h3>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-600 dark:text-neutral-300 font-num">
                <span>{activeNotification.sender || 'Ban Quản Lý Nhà Trọ Phong Lan'}</span>
                <span>•</span>
                <span>{activeNotification.time}</span>
              </div>
            </div>
          </div>

          <div className="kit-inset p-4">
            <p className="type-body text-neutral-600 dark:text-neutral-300 text-sm leading-relaxed">
              {activeNotification.desc}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="kit-dialog-footer px-5 py-4 sm:px-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={closeNotificationModal}
            className={isInvoice
              ? "soft-button px-5 py-2.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer"
              : "primary-button px-6 py-2.5 text-xs cursor-pointer font-bold"
            }
          >
            {isInvoice ? 'Để sau' : 'Đã hiểu'}
          </button>

          {isInvoice && (
            <button
              type="button"
              onClick={handleAction}
              className="min-h-11 primary-button px-5 py-2.5 text-xs flex items-center gap-1.5 shadow-sm cursor-pointer font-bold"
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
