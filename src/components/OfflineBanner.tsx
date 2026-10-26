import React, { useState, useEffect } from 'react';
import { WifiOff } from './AppIcons';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div 
      role="status" 
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-xs sm:text-sm font-semibold px-4 py-2 flex items-center justify-center gap-2 shadow-md animate-in slide-in-from-top duration-200"
    >
      <WifiOff size={16} className="shrink-0" />
      <span>Bạn đang offline. Một số dữ liệu có thể chưa được đồng bộ mới nhất.</span>
    </div>
  );
}
