import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { Layout } from './components/Layout';
import { Home } from './components/Home';
import { Utilities } from './components/Utilities';
import { InvoicesAndPayment } from './components/InvoicesAndPayment';
import { Contract } from './components/Contract';
import { Profile } from './components/Profile';
import { PaymentPage } from './components/PaymentPage';
import { LaundryPage } from './components/LaundryPage';
import { LoginPage } from './components/LoginPage';
import { AdminPortal } from './components/AdminPortal';
import { Icons3DDefs } from './components/Icons3D';

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
          <AppRoutes />
        </HashRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
