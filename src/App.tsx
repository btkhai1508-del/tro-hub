import React, { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { Layout } from './components/Layout';
import { Icons3DDefs } from './components/Icons3D';

const Home = lazy(() => import('./components/Home').then(module => ({ default: module.Home })));
const Utilities = lazy(() => import('./components/Utilities').then(module => ({ default: module.Utilities })));
const InvoicesAndPayment = lazy(() => import('./components/InvoicesAndPayment').then(module => ({ default: module.InvoicesAndPayment })));
const Contract = lazy(() => import('./components/Contract').then(module => ({ default: module.Contract })));
const Profile = lazy(() => import('./components/Profile').then(module => ({ default: module.Profile })));
const PaymentPage = lazy(() => import('./components/PaymentPage').then(module => ({ default: module.PaymentPage })));
const LaundryPage = lazy(() => import('./components/LaundryPage').then(module => ({ default: module.LaundryPage })));
const LoginPage = lazy(() => import('./components/LoginPage').then(module => ({ default: module.LoginPage })));
const AdminPortal = lazy(() => import('./components/AdminPortal').then(module => ({ default: module.AdminPortal })));


function AppLoading() {
  return (
    <main role="status" aria-live="polite" aria-label="Đang tải giao diện" className="flex min-h-svh items-center justify-center px-5 py-10">
      <div className="liquid-panel w-full max-w-sm space-y-5 p-7">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="ui-spinner" />
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Đang mở không gian của bạn…</p>
        </div>
        <div aria-hidden="true" className="space-y-3">
          <div className="h-3 w-2/3 rounded-full bg-black/5 dark:bg-white/10" />
          <div className="h-3 w-full rounded-full bg-black/5 dark:bg-white/10" />
          <div className="h-24 rounded-2xl border border-white/50 bg-white/20 dark:border-white/10 dark:bg-white/5" />
        </div>
      </div>
    </main>
  );
}

function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useApp();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function AdminRoleRoute() {
  const { profile } = useApp();
  return profile.isAdmin ? <AdminPortal /> : <Navigate to="/" replace />;
}

function AuthenticatedHomeRoute() {
  const { isAuthenticated, profile } = useApp();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profile.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <Home />;
}

function PublicAuthRoute({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, profile } = useApp();
  if (isAuthenticated) {
    return <Navigate to={profile.isAdmin ? "/admin" : "/"} replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Login & Registration Gateway */}
      <Route 
        path="/login" 
        element={
          <PublicAuthRoute>
            <LoginPage />
          </PublicAuthRoute>
        } 
      />

      {/* Admin Landlord Management Portal */}
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute>
            <AdminRoleRoute />
          </ProtectedRoute>
        } 
      />

      <Route path="/user/*" element={<Navigate to="/" replace />} />

      {/* Main Authenticated Layout matching root / */}
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AuthenticatedHomeRoute />} />
        
        {/* Tiện ích (VNeID Grid Style Hub) */}
        <Route path="utilities" element={<Utilities />} />
        
        {/* Hóa đơn & Thanh toán */}
        <Route path="invoices" element={<InvoicesAndPayment />} />
        
        {/* Dedicated QR Payment Window */}
        <Route path="payment" element={<PaymentPage />} />

        {/* Giặt Sấy Tự Động 24/7 (LaundryFlow) */}
        <Route path="laundry" element={<LaundryPage />} />
        
        {/* Notifications redirect to Home */}
        <Route path="notifications" element={<Navigate to="/" replace />} />
        
        {/* Hợp đồng */}
        <Route path="contract" element={<Contract />} />
        
        {/* Cá nhân */}
        <Route path="profile" element={<Profile />} />
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Icons3DDefs />
        <HashRouter>
          <Suspense fallback={<AppLoading />}>
            <AppRoutes />
          </Suspense>
        </HashRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
