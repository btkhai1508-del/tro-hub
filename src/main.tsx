// Global guard against third-party SDK unhandled rejections and non-critical environment errors
function isSuppressed(err: any): boolean {
  if (!err) return false;
  if (typeof err === 'object' && (err.code === -2000 || err.api === 'login')) return true;
  const str = String(err?.message || err || '');
  return str.includes('-2000') || str.includes('Unknown error') || str.includes('createWebSocketModuleRunnerTransport') || str.includes('@vite/client');
}

window.addEventListener('unhandledrejection', (event) => {
  if (isSuppressed(event?.reason)) {
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    event.preventDefault?.();
  }
}, true);

window.addEventListener('error', (event) => {
  if (isSuppressed(event?.error || event?.message)) {
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    event.preventDefault?.();
  }
}, true);

import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root') || document.getElementById('app');
if (container) {
  createRoot(container).render(<App />);
}
