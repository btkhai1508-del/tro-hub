import React, { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { routeLoaders } from './lib/routePreload';
import { Layout } from './components/Layout';
import { Icons3DDefs } from './components/Icons3D';
import { BrandIntro } from './components/BrandIntro';

const Home = lazy(() => routeLoaders.home().then(module => ({ default: module.Home })));
const Utilities = lazy(() => routeLoaders.utilities().then(module => ({ default: module.Utilities })));
const InvoicesAndPayment = lazy(() => routeLoaders.invoices().then(module => ({ default: module.InvoicesAndPayment })));
const Contract = lazy(() => routeLoaders.contract().then(module => ({ default: module.Contract })));
const Profile = lazy(() => routeLoaders.profile().then(module => ({ default: module.Profile })));
const PaymentPage = lazy(() => routeLoaders.payment().then(module => ({ default: module.PaymentPage })));
const LaundryPage = lazy(() => routeLoaders.laundry().then(module => ({ default: module.LaundryPage })));
const LoginPage = lazy(() => routeLoaders.login().then(module => ({ default: module.LoginPage })));
const AdminPortal = lazy(() => routeLoaders.admin().then(module => ({ default: module.AdminPortal })));

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
        <BrandIntro />
        <HashRouter>
          {/* Match the intro veil while the first route chunk loads. */}
          <Suspense fallback={<div aria-hidden="true" className="fixed inset-0 bg-[#f7f8fa] dark:bg-[#101114]" />}>
            <AppRoutes />
          </Suspense>
        </HashRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
