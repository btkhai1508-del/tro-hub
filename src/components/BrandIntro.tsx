import { useLayoutEffect, type RefObject } from 'react';
import '../styles/brand-intro.css';

let attemptedInDocument = false;

/** A decorative brand composition: assemble, hold, then FLIP to the real header. */
export function BrandIntro({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  useLayoutEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    // The target is a later sibling: read its ref after the complete commit,
    // while still staging ready assets before the browser's next paint.
    queueMicrotask(() => { if (!cancelled) cleanup = setup(); });
    return () => { cancelled = true; cleanup?.(); };

    function setup() {
      const target = targetRef.current;
      if (!target || attemptedInDocument) return;
      attemptedInDocument = true;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      if (reduced.matches || document.hidden) return;

      let disposed = false;
      let started = false;
      let stage: HTMLDivElement | undefined;
      let timer = 0;
      let failsafe = 0;
      const tweens: Array<{ kill(): void }> = [];
      const children = Array.from(target.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
      const originals = children.map(node => ({ node, opacity: node.style.getPropertyValue('opacity'), priority: node.style.getPropertyPriority('opacity') }));
      const script = document.getElementById('gsap-cdn');
      const deadline = performance.now() + 600;

      function finish() {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer); clearTimeout(failsafe);
        tweens.forEach(tween => tween.kill());
        originals.forEach(({ node, opacity, priority }) => opacity ? node.style.setProperty('opacity', opacity, priority) : node.style.removeProperty('opacity'));
        stage?.remove();
        script?.removeEventListener('load', schedule);
        script?.removeEventListener('error', finish);
        document.removeEventListener('pointerdown', finish, true);
        document.removeEventListener('keydown', finish, true);
        document.removeEventListener('focusin', finish, true);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('resize', finish);
        window.removeEventListener('scroll', finish, true);
        window.removeEventListener('beforeprint', finish);
        window.visualViewport?.removeEventListener('resize', finish);
        window.visualViewport?.removeEventListener('scroll', finish);
        reduced.removeEventListener('change', finish);
      }
      function visibility() { if (document.hidden) finish(); }
      function start() {
        if (started) return;
        if (disposed || reduced.matches || document.hidden || !target?.isConnected || !window.gsap || performance.now() > deadline) return finish();
        if (document.activeElement?.matches('input, textarea, select, button')) return finish();
        const rects = children.map(child => child.getBoundingClientRect());
        if (rects.length < 2 || rects.some(rect => !rect.width || !rect.height)) return finish();
        const left = Math.min(...rects.map(rect => rect.left));
        const top = Math.min(...rects.map(rect => rect.top));
        const width = Math.max(...rects.map(rect => rect.right)) - left;
        const height = Math.max(...rects.map(rect => rect.bottom)) - top;
        // A scrolled or offscreen header is not a meaningful morph destination.
        if (left < 0 || top < 0 || top + height > innerHeight || left + width > innerWidth) return finish();

        started = true;
        stage = document.createElement('div');
        stage.className = 'brand-intro-stage';
        stage.dataset.introPhase = 'assemble';
        stage.setAttribute('aria-hidden', 'true');
        const veil = document.createElement('div'); veil.className = 'brand-intro-veil';
        const aura = document.createElement('div'); aura.className = 'brand-intro-aura';
        const brand = document.createElement('div'); brand.className = 'brand-intro-mark';
        const styles = getComputedStyle(target);
        Object.assign(brand.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, gap: styles.columnGap, fontFamily: styles.fontFamily, color: styles.color });
        const clones = children.map(child => {
          const clone = child.cloneNode(true) as HTMLElement;
          clone.removeAttribute('id');
          clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
          brand.append(clone);
          return clone;
        });
        const logo = clones[0];
        const title = clones[1].firstElementChild;
        const subtitle = clones[1].lastElementChild;
        stage.append(veil, aura, brand); document.body.append(stage);
        children.forEach(child => child.style.setProperty('opacity', '0'));
        const scale = Math.min(2.6, (innerWidth - 48) / width);
        const x = innerWidth / 2 - left - width / 2;
        const y = innerHeight / 2 - top - height / 2;
        const engine = window.gsap;
        try {
          // The parent keeps exact destination geometry. Only its children assemble.
          tweens.push(engine.fromTo(brand, { x, y, scale, opacity: 1, transformOrigin: '50% 50%' }, {
            x, y, scale, opacity: 1, duration: 0.01, ease: 'none'
          }));
          tweens.push(engine.fromTo(logo, { y: 8, scale: 0.76, rotation: -7, opacity: 0 }, {
            y: 0, scale: 1, rotation: 0, opacity: 1, duration: 0.46, delay: 0.08, ease: 'expo.out'
          }));
          if (title) tweens.push(engine.fromTo(title, { x: 12, opacity: 0 }, {
            x: 0, opacity: 1, duration: 0.36, delay: 0.18, ease: 'power3.out'
          }));
          if (subtitle && subtitle !== title) tweens.push(engine.fromTo(subtitle, { y: 4, opacity: 0 }, {
            y: 0, opacity: 1, duration: 0.28, delay: 0.32, ease: 'sine.out'
          }));
          tweens.push(engine.fromTo(aura, { opacity: 0, scale: 0.88 }, {
            opacity: 1, scale: 1, duration: 0.5, delay: 0.08, ease: 'sine.out'
          }));
          tweens.push(engine.to(aura, { opacity: 0, duration: 0.4, delay: 0.62, ease: 'sine.in' }));
          tweens.push(engine.to(veil, { opacity: 0, duration: 0.56, delay: 0.76, ease: 'power2.inOut' }));
          // At 760ms, the assembled mark resolves into its real place in the card.
          tweens.push(engine.to(brand, {
            x: 0, y: 0, scale: 1, duration: 0.72, delay: 0.76, ease: 'power3.inOut',
            onStart() { if (stage) stage.dataset.introPhase = 'resolve'; },
            onComplete: finish
          }));
          failsafe = window.setTimeout(finish, 1750);
        } catch {
          finish();
        }
      }
      function schedule() {
        if (disposed || started) return;
        clearTimeout(timer);
        const image = target?.querySelector('img');
        if (!window.gsap || image && (!image.complete || !image.naturalWidth)) {
          if (performance.now() >= deadline) return finish();
          timer = window.setTimeout(schedule, 40);
          return;
        }
        // Layout effects run after React commits the final header geometry.
        // Ready assets can therefore stage the mark before the first paint.
        start();
      }

      document.addEventListener('pointerdown', finish, true);
      document.addEventListener('keydown', finish, true);
      document.addEventListener('focusin', finish, true);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('resize', finish);
      window.addEventListener('scroll', finish, true);
      window.addEventListener('beforeprint', finish);
      window.visualViewport?.addEventListener('resize', finish);
      window.visualViewport?.addEventListener('scroll', finish);
      reduced.addEventListener('change', finish);
      script?.addEventListener('load', schedule, { once: true });
      script?.addEventListener('error', finish, { once: true });
      schedule();
      return finish;
    }
  }, [targetRef]);
  return null;
}
