export type MotionTween = {
  kill(): void;
};

export function canAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  const hasGsap = typeof (window as unknown as { gsap?: unknown }).gsap !== 'undefined';
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  return hasGsap && !prefersReduced;
}
