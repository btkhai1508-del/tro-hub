/**
 * Runtime platform detection: Zalo Mini App vs normal web browser.
 */

declare global {
  interface Window {
    ZJSBridge?: unknown;
  }
}

function detectZaloMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_FORCE_ZALO === 'true') return true;

  const host = window.location.hostname || '';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

  return (
    host.endsWith('zdn.vn') ||           // h5.zdn.vn (Mini App hosting)
    host.endsWith('zadn.vn') ||
    window.location.pathname.startsWith('/zapps/') ||
    typeof window.ZJSBridge !== 'undefined' ||
    /Zalo/i.test(ua)
  );
}

/** true when running inside the Zalo app as a Mini App */
export const isZaloMiniApp: boolean = detectZaloMiniApp();
