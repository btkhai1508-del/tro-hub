import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/utils';

interface StepItem {
  id: string;
  path: string;
  selector: string;
  fallbackSelector?: string;
  badge: string;
  title: string;
  text: string;
}

const TOUR_STEPS: StepItem[] = [
  {
    id: 'step-welcome',
    path: '/',
    selector: '[data-tutorial="resident-welcome"]',
    badge: '1/10 • Trang chủ',
    title: 'Phòng của bạn & Lời chào',
    text: 'Hiển thị mã số căn hộ, tòa nhà và lời chào cá nhân mỗi khi đăng nhập.'
  },
  {
    id: 'step-billing',
    path: '/',
    selector: '[data-tutorial="billing-card"]',
    badge: '2/10 • Tiền phòng',
    title: 'Hóa đơn tháng hiện tại',
    text: 'Theo dõi tổng số tiền cần đóng, hạn thanh toán và trạng thái nộp tiền minh bạch.'
  },
  {
    id: 'step-pay-btn',
    path: '/',
    selector: '[data-tutorial="billing-pay-btn"]',
    badge: '3/10 • VietQR',
    title: 'Thanh toán & Xem chi tiết',
    text: 'Chạm vào đây để quét mã VietQR tự động điền sẵn số tiền và cú pháp phòng.'
  },
  {
    id: 'step-notif',
    path: '/',
    selector: '[data-tutorial="header-notifications"]',
    badge: '4/10 • Thông báo',
    title: 'Chuông thông báo BQL',
    text: 'Nhận tin tức bảo dưỡng điện nước, nhắc phí và thông báo khẩn cấp từ Ban quản lý.'
  },
  {
    id: 'step-invoices',
    path: '/invoices',
    selector: '[data-tutorial="invoices-header"]',
    fallbackSelector: 'main',
    badge: '5/10 • Hóa đơn',
    title: 'Lịch sử hóa đơn các tháng',
    text: 'Nơi lưu trữ đầy đủ hóa đơn các tháng trước, tra cứu biên lai và xuất file PDF.'
  },
  {
    id: 'step-contract',
    path: '/contract',
    selector: '[data-tutorial="contract-header"]',
    fallbackSelector: 'main',
    badge: '6/10 • Hợp đồng',
    title: 'Hợp đồng thuê & Pháp lý',
    text: 'Văn bản hợp đồng thuê phòng số phông Times New Roman chuẩn hành chính và in/tải PDF.'
  },
  {
    id: 'step-utilities',
    path: '/utilities',
    selector: '[data-tutorial="utilities-grid"]',
    fallbackSelector: 'main',
    badge: '7/10 • Tiền ích',
    title: 'Dịch vụ & Đổi mật khẩu',
    text: 'Tra cứu các dịch vụ tiện ích cư dân, chủ động thay đổi mật khẩu bảo mật tài khoản.'
  },
  {
    id: 'step-profile-id',
    path: '/profile',
    selector: '[data-tutorial="profile-id-card"]',
    fallbackSelector: 'main',
    badge: '8/10 • Cá nhân',
    title: 'Hồ sơ định danh & Xe máy',
    text: 'Quản lý thông tin cá nhân CCCD, số điện thoại và danh sách xe máy đã đăng ký gửi xe.'
  },
  {
    id: 'step-bql-contact',
    path: '/',
    selector: '[data-tutorial="sidebar-bql-contact"]',
    fallbackSelector: 'main',
    badge: '9/10 • Liên hệ BQL',
    title: 'Liên hệ BQL & Zalo Bùi Trung Khải',
    text: 'Nhấn vào số điện thoại 0902 371 800 để sao chép nhanh, hoặc bấm nút Zalo để nhắn tin trực tiếp với BQL Bùi Trung Khải.'
  },
  {
    id: 'step-finish',
    path: '/',
    selector: '[data-tutorial="resident-welcome"]',
    badge: '10/10 • Hoàn tất',
    title: 'Sẵn sàng trải nghiệm Trọ-Hub!',
    text: 'Bạn đã xem trọn vẹn toàn bộ tính năng từ A-Z. Bắt đầu sử dụng ngay!'
  }
];

export function InteractiveOnboardingTutorial() {
  const { isTourGuideOpen, closeTourGuide, profile } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [arrowPosition, setArrowPosition] = useState<'top' | 'bottom'>('top');
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; arrowLeft: number }>({ left: 16, arrowLeft: 30 });

  // Disabled for Admin & /admin route
  const isEnabled = isTourGuideOpen && !profile.isAdmin && !location.pathname.startsWith('/admin');
  const currentStep = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  // Reposition tooltip immediately adjacent to element with auto-scroll
  const updatePosition = useCallback(() => {
    if (!isEnabled || !currentStep) return;

    const el = document.querySelector(currentStep.selector) || 
      (currentStep.fallbackSelector ? document.querySelector(currentStep.fallbackSelector) : null);

    if (el) {
      // Snappy instantaneous scroll (not slow smooth)
      el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);

      const tooltipWidth = Math.min(300, window.innerWidth - 32);
      const isBottomHalf = rect.bottom + 140 > window.innerHeight;

      // Horizontal alignment: center over element, clamped to viewport margins
      const elementCenterX = rect.left + rect.width / 2;
      let left = elementCenterX - tooltipWidth / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

      // Arrow position relative to tooltip box
      const arrowLeft = Math.max(16, Math.min(elementCenterX - left, tooltipWidth - 16));

      // Allow full height for all cards except profile personal info (too big)
      const isProfileId = currentStep.id === 'step-profile-id';
      const effectiveHeight = isProfileId ? Math.min(rect.height, 160) : rect.height;

      const spaceBelow = window.innerHeight - (rect.top + effectiveHeight);
      const spaceAbove = rect.top;

      if (spaceBelow >= 160) {
        // Space below target
        const top = Math.max(12, rect.top + effectiveHeight + 10);
        setArrowPosition('top');
        setCoords({ top, left, arrowLeft });
      } else if (spaceAbove >= 160) {
        // Space above target
        const bottom = Math.max(12, window.innerHeight - rect.top + 10);
        setArrowPosition('bottom');
        setCoords({ bottom, left, arrowLeft });
      } else {
        // For very tall cards or small screens, anchor comfortably
        const bottom = 20;
        setArrowPosition('bottom');
        setCoords({ bottom, left, arrowLeft });
      }
    } else {
      setTargetRect(null);
      // Fallback center of screen
      const tooltipWidth = Math.min(300, window.innerWidth - 32);
      setCoords({
        top: Math.max(20, window.innerHeight / 2 - 70),
        left: (window.innerWidth - tooltipWidth) / 2,
        arrowLeft: tooltipWidth / 2
      });
    }
  }, [isEnabled, currentStep]);

  // Navigate to step path if different, then update position instantaneously
  useEffect(() => {
    if (!isEnabled || !currentStep) return;

    if (location.pathname !== currentStep.path) {
      navigate(currentStep.path);
      const timer = setTimeout(updatePosition, 100);
      return () => clearTimeout(timer);
    } else {
      updatePosition();
      const timer = setTimeout(updatePosition, 50);
      return () => clearTimeout(timer);
    }
  }, [isEnabled, stepIndex, currentStep, location.pathname, navigate, updatePosition]);

  // Handle window resize and scroll
  useEffect(() => {
    if (!isEnabled) return;

    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isEnabled, updatePosition]);

  const handleDismiss = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setStepIndex(0);
    closeTourGuide();
  };

  // Clicking anywhere advances to the next step
  const handleNext = () => {
    if (isLastStep) {
      handleDismiss();
    } else {
      setStepIndex(prev => Math.min(prev + 1, TOUR_STEPS.length - 1));
    }
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStepIndex(prev => Math.max(prev - 1, 0));
  };

  if (!isEnabled || profile.isAdmin || location.pathname.startsWith('/admin')) {
    return null;
  }

  // Constrain highlight box dimensions: Full natural size for all cards except Profile personal info
  const isProfileId = currentStep?.id === 'step-profile-id';
  const highlightTop = targetRect ? Math.max(0, targetRect.top - 4) : 0;
  const highlightLeft = targetRect ? Math.max(0, targetRect.left - 4) : 0;
  const highlightWidth = targetRect ? Math.min(targetRect.width + 8, window.innerWidth - 16) : 0;
  const highlightHeight = targetRect 
    ? (isProfileId ? Math.min(targetRect.height + 8, 160) : (targetRect.height + 8)) 
    : 0;

  return (
    <div 
      onClick={handleNext}
      className="fixed inset-0 z-[9999] pointer-events-auto select-none cursor-pointer"
    >
      
      {/* 1. Target Element Spotlight Cutout (Khung highlight tinh tế, tối nền xung quanh) */}
      {targetRect ? (
        <div 
          className="fixed rounded-2xl pointer-events-none transition-all duration-150 ease-out ring-2 ring-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] z-[9998]"
          style={{
            top: `${highlightTop}px`,
            left: `${highlightLeft}px`,
            width: `${highlightWidth}px`,
            height: `${highlightHeight}px`,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70 z-[9998] transition-opacity duration-150" />
      )}

      {/* 2. Pure Frosted Glass Translucent Card (Hoàn toàn KHÔNG border, nguyên card trong suốt kính mờ) */}
      <div 
        style={{
          top: coords.top !== undefined ? `${coords.top}px` : undefined,
          bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
          left: `${coords.left}px`,
          width: `${Math.min(320, window.innerWidth - 32)}px`,
        }}
        className="fixed z-[9999] pointer-events-none transition-all duration-150 ease-out"
      >
        <div className="relative">

          {/* Frosted Glass Card: Không viền (border-none), nguyên card trong suốt kính mờ chuẩn */}
          <div className="bg-black/40 backdrop-blur-md rounded-2xl p-4 text-white shadow-xl border-none">
            
            {/* Top row: Step badge & Dismiss button */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-md">
                {currentStep.badge}
              </span>
              
              <button
                type="button"
                onClick={handleDismiss}
                className="pointer-events-auto text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/20 text-sm transition-colors cursor-pointer"
                title="Bỏ qua hướng dẫn"
              >
                ✕
              </button>
            </div>

            {/* Title - Cỡ chữ to rõ ràng */}
            <h4 className="text-base sm:text-[17px] font-bold text-white leading-snug drop-shadow-sm">
              {currentStep.title}
            </h4>

            {/* Inline Guidance Text - Phông to hơn dễ đọc */}
            <p className="text-sm sm:text-[14.5px] text-white/90 mt-1.5 leading-relaxed drop-shadow-sm">
              {currentStep.text}
            </p>

            {/* Bottom Row: Tap Hint + Optional Back button */}
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
              <div>
                {!isFirstStep && (
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="pointer-events-auto px-2.5 py-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors cursor-pointer font-medium"
                  >
                    ← Quay lại
                  </button>
                )}
              </div>

              {/* Tap to continue indicator */}
              <div className="text-white/85 font-medium flex items-center gap-1.5 drop-shadow-sm">
                <span>{isLastStep ? 'Chạm bất kỳ để hoàn tất' : 'Chạm bất kỳ để tiếp tục'}</span>
                <span>→</span>
              </div>
            </div>

          </div>

        </div>
      </div>

    </div>
  );
}
