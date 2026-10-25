import React from 'react';
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
import { cn } from '../lib/utils';

export function Layout() {
  const { isSidebarCollapsed, profile } = useApp();
  const location = useLocation();
  const isPaymentPage = location.pathname.startsWith('/payment');

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
        "min-h-screen min-w-0 relative z-10 px-4 pt-5 sm:px-7 sm:pt-7 lg:px-8 lg:pt-7 pb-[calc(env(safe-area-inset-bottom)+7rem)] lg:pb-10 page-transition transition-[margin] duration-300 ease-out",
        isSidebarCollapsed ? "lg:ml-[128px]" : "lg:ml-[280px]"
      )}>
        {/* On /payment, hide the detached TopHeader so there is no empty gap above the return button */}
        <div className="mx-auto w-full max-w-[1180px]">
          {!isPaymentPage && <TopHeader />}
          <Outlet />
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
