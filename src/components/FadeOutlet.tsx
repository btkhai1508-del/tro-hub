import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

export interface FadeOutletProps {
  fallback?: React.ReactNode;
}

export function FadeOutlet({ fallback = null }: FadeOutletProps) {
  const location = useLocation();

  return (
    <Suspense fallback={fallback}>
      <div key={location.pathname} className="route-stage-enter min-w-0">
        <Outlet />
      </div>
    </Suspense>
  );
}
