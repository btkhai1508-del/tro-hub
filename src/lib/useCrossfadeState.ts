import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { canAnimate, type MotionTween } from './motionEngine';

/** A short exit/entry for local admin screens, with latest-selection wins. */
export function useCrossfadeState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const panel = useRef<HTMLElement>(null);
  const current = useRef(initial);
  const desired = useRef(initial);
  const tween = useRef<MotionTween | null>(null);
  const pending = useRef(false);
  const restore = useCallback(() => {
    tween.current?.kill(); tween.current = null;
    if (panel.current) { panel.current.style.removeProperty('opacity'); panel.current.inert = false; panel.current.removeAttribute('data-view-fading'); }
  }, []);
  const select = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(desired.current) : action;
    desired.current = next;
    restore();
    if (Object.is(next, current.current)) { pending.current = false; return; }
    if (!canAnimate() || !panel.current) { pending.current = false; setValue(next); return; }
    pending.current = true;
    panel.current.inert = true; panel.current.setAttribute('data-view-fading', '');
    tween.current = window.gsap!.to(panel.current, { opacity: 0, duration: 0.1, ease: 'power1.in', onComplete: () => setValue(desired.current) });
  }, [restore]);
  useLayoutEffect(() => {
    if (!Object.is(value, desired.current)) { setValue(desired.current); return; }
    current.current = value;
    if (!pending.current || !panel.current || !canAnimate()) { restore(); return; }
    pending.current = false;
    panel.current.inert = false;
    tween.current = window.gsap!.fromTo(panel.current, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: 'power1.out', onComplete: restore });
  }, [value, restore]);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => { restore(); pending.current = false; setValue(desired.current); };
    const hidden = () => { if (document.hidden) finish(); };
    media.addEventListener('change', finish); document.addEventListener('visibilitychange', hidden); window.addEventListener('beforeprint', finish);
    return () => { restore(); media.removeEventListener('change', finish); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeprint', finish); };
  }, [restore]);
  return [value, select, panel] as const;
}
