// Global guard against third-party SDK unhandled rejections in web environments
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  if (
    reason &&
    (reason.code === -2000 ||
      reason.api === 'login' ||
      (typeof reason.message === 'string' && reason.message.includes('Unknown error. Please try again later.')))
  ) {
    event.preventDefault();
    console.warn('[Zalo Mini App SDK] Handled non-native container error:', reason);
  }
});

import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root') || document.getElementById('app');
if (container) {
  createRoot(container).render(<App />);
}
