import React, { Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

function PaintedRoute({ id, onPaint, children }: { id: string; onPaint: (id: string) => void; children: React.ReactNode }) {
  useLayoutEffect(() => onPaint(id), [id, onPaint]);
  return <>{children}</>;
}

/** Hold the outgoing outlet for a short fade, then paint only the latest route.
 * The auth/role guards remain outside this component and can unmount it at once. */
export function FadeOutlet({ fallback }: { fallback: React.ReactNode }) {
  const location = useLocation();
  const outlet = useOutlet();
  const id = location.pathname + location.search;
  const latest = useRef({ id, outlet });
  latest.current = { id, outlet };
  const [displayed, setDisplayed] = useState(latest.current);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const panelRef = useRef<HTMLDivElement>(null);
  const tween = useRef<{ kill(): void } | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const entered = useRef(displayed.id);
  const [busy, setBusy] = useState(false);
  const media = useRef<MediaQueryList | null>(null);
  if (!media.current && typeof window !== 'undefined') media.current = matchMedia('(prefers-reduced-motion: reduce)');

  const available = () => Boolean(window.gsap && !media.current?.matches && !document.hidden);
  const restore = useCallback(() => {
    const panel = panelRef.current;
    if (panel) { panel.style.removeProperty('opacity'); panel.inert = false; }
  }, []);
  const cancel = useCallback(() => {
    revision.current++;
    tween.current?.kill(); tween.current = null;
  }, []);
  const immediate = useCallback(() => {
    cancel(); restore();
    entered.current = latest.current.id;
    if (alive.current) { setBusy(false); setDisplayed(latest.current); }
  }, [cancel, restore]);

  const onPaint = useCallback((paintedId: string) => {
    if (!alive.current || paintedId !== latest.current.id || paintedId !== displayedRef.current.id) return;
    if (entered.current === paintedId) return;
    entered.current = paintedId;
    const panel = panelRef.current;
    if (!panel || !available()) { restore(); setBusy(false); return; }
    cancel();
    const ticket = revision.current;
    panel.inert = false;
    // Both the real page and a suspended page's fallback can paint here. The
    // first visible paint fades in; a late module never leaves a blank panel.
    tween.current = window.gsap!.fromTo(panel, { opacity: 0 }, {
      opacity: 1, duration: 0.16, ease: 'power1.out', overwrite: 'auto',
      onComplete: () => {
        if (!alive.current || ticket !== revision.current) return;
        tween.current = null; restore(); setBusy(false);
        window.dispatchEvent(new CustomEvent('trohub:page-entered', { detail: { path: paintedId } }));
      }
    });
  }, [cancel, restore]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    cancel();
    if (id === displayedRef.current.id) { restore(); setBusy(false); return; }
    if (!panel || !available()) { immediate(); return; }
    const ticket = revision.current;
    setBusy(true); panel.inert = true;
    tween.current = window.gsap!.to(panel, {
      opacity: 0, duration: 0.10, ease: 'power1.in', overwrite: 'auto',
      onComplete: () => {
        if (!alive.current || ticket !== revision.current) return;
        tween.current = null;
        setDisplayed(latest.current);
      }
    });
    return cancel;
  }, [id, cancel, immediate, restore]);

  useLayoutEffect(() => {
    alive.current = true;
    const preference = () => { if (media.current?.matches) immediate(); };
    const hidden = () => { if (document.hidden) immediate(); };
    media.current?.addEventListener('change', preference);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeprint', immediate);
    return () => {
      alive.current = false; cancel(); restore();
      media.current?.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeprint', immediate);
    };
  }, [cancel, immediate, restore]);

  return <div ref={panelRef} className="route-content" data-route-motion={displayed.id} aria-busy={busy || undefined}>
    <Suspense key={displayed.id} fallback={<PaintedRoute id={displayed.id} onPaint={onPaint}>{fallback}</PaintedRoute>}>
      <PaintedRoute id={displayed.id} onPaint={onPaint}>{displayed.outlet}</PaintedRoute>
    </Suspense>
  </div>;
}
