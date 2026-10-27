/** Optional CDN runtime shared by the new motion system and intro. */
export type MotionTween = { kill(): void };
export type MotionEngine = {
  to(target: Element, vars: object): MotionTween;
  fromTo(target: Element, from: object, to: object): MotionTween;
};
declare global { interface Window { gsap?: MotionEngine } }
export const canAnimate = () => Boolean(window.gsap && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches);
