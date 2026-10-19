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
    <div className="min-h-screen flex flex-col lg:flex-row relative">
      <OfflineBanner />
      <Background />
      
      {/* Desktop Fixed Side Navigation (Floating Capsule with Neumorphism & Glass) */}
      <Sidebar />
      
      {/* Main Content Area: dynamic left margin aligning with floating sidebar on desktop */}
      <main className={cn(
        "flex-1 p-3 sm:p-5 md:p-6 pb-[90px] lg:pb-6 min-h-screen relative z-10 w-full max-w-[1260px] mx-auto page-transition transition-all duration-300 ease-out",
        isPaymentPage ? "overflow-hidden" : "overflow-x-hidden",
        isSidebarCollapsed ? "lg:ml-[137px]" : "lg:ml-[292px]"
      )}>
        {/* On /payment, hide the detached TopHeader so there is no empty gap above the return button */}
        {!isPaymentPage && <TopHeader />}

        <Outlet />
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
      <BottomNav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-2xl border-t border-slate-200/80 dark:border-slate-800 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-4px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.7)] rounded-t-3xl transition-colors duration-200 pointer-events-auto" />
    </div>
  );
}
