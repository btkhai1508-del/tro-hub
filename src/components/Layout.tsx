import React, { Suspense, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { Background } from './Background';
import { TopHeader } from './TopHeader';
import { NotificationModal } from './NotificationModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { ContractModal } from './ContractModal';
import { ProfileEditModal } from './ProfileEditModal';
import { GoogleSheetModal } from './GoogleSheetModal';
import { InteractiveOnboardingTutorial } from './InteractiveOnboardingTutorial';
import { OfflineBanner } from './OfflineBanner';
import { useApp } from '../context/AppContext';
import { warmResidentRoutes } from '../lib/routePreload';
import { cn } from '../lib/utils';

function PageLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Đang tải trang" className="space-y-5 py-2">
      <div className="flex items-center gap-3 text-sm font-medium text-neutral-800 dark:text-neutral-100">
        <span aria-hidden="true" className="ui-spinner h-5 w-5 shrink-0" />
        <span>Đang mở trang…</span>
      </div>
      <div aria-hidden="true" className="liquid-panel space-y-5 p-6 sm:p-8">
        <div className="ui-skeleton h-7 w-44 max-w-full rounded-xl" />
        <div className="ui-skeleton h-4 w-64 max-w-full rounded-lg" />
        <div className="ui-skeleton h-32 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function Layout() {
  const { isSidebarCollapsed, profile } = useApp();
  const location = useLocation();
  const isPaymentPage = location.pathname.startsWith('/payment');

  useEffect(() => {
    if (!profile.isAdmin) return warmResidentRoutes();
  }, [profile.isAdmin]);

  // Admin users are strictly redirected to /admin with zero resident UI exposure
  if (profile.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="min-h-screen relative isolate">
      <OfflineBanner />
      <Background />
      
      {/* Desktop Fixed Side Navigation (Floating Capsule with Neumorphism & Glass) */}
      <Sidebar />
      
      {/* Main Content Area: dynamic left margin aligning with floating sidebar on desktop */}
      <main className={cn(
        "min-h-screen min-w-0 relative z-10 px-4 pt-5 sm:px-7 sm:pt-7 lg:px-8 lg:pt-7 pb-[calc(env(safe-area-inset-bottom)+7rem)] lg:pb-10 transition-[margin] duration-300 ease-out",
        isSidebarCollapsed ? "lg:ml-[128px]" : "lg:ml-[280px]"
      )}>
        {/* On /payment, hide the detached TopHeader so there is no empty gap above the return button */}
        <div className="mx-auto w-full max-w-[1180px]">
          {!isPaymentPage && <TopHeader />}
          <Suspense key={location.pathname} fallback={<PageLoading />}>
            <div className="route-content">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </main>

      {/* Pop-up Modals for quick views */}
      <NotificationModal />
      <InvoiceDetailModal />
      <ContractModal />
      <ProfileEditModal />
      <GoogleSheetModal />
      
      {/* Interactive Resident Onboarding Tour Guide */}
      <InteractiveOnboardingTutorial />

      {/* Mobile & Tablet Bottom Navigation with complete Dark Mode styling - Permanently pinned to viewport */}
      <BottomNav className="lg:hidden fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-50 w-[calc(100%_-_1.5rem)] max-w-[460px] -translate-x-1/2 pointer-events-auto" />
    </div>
  );
}
