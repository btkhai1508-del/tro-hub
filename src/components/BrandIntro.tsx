import { useLayoutEffect } from 'react';
import { KIT_ASSETS } from './KitIcons';
import '../styles/brand-intro.css';

let attemptedInDocument = false;
const TITLE = 'Trọ-Hub';
const SUBTITLE = 'Nhà trọ Phong Lan';
type Box = { left: number; top: number; width: number; height: number };
type TextBox = Box & { text: string; fontSize: number; letterSpacing: number; fontFamily: string; fontWeight: string; color: string };
const visible = (node: Element | null): node is HTMLElement => Boolean(node?.getClientRects().length && node.getBoundingClientRect().width && node.getBoundingClientRect().height && getComputedStyle(node).visibility !== 'hidden');
const box = (node: Element): Box => { const { left, top, width, height } = node.getBoundingClientRect(); return { left, top, width, height }; };

/** One launch intro for public and restored sessions, outside route Suspense.
 * Text and SVG are laid out at their real large size, never enlarged bitmaps. */
export function BrandIntro() {
  useLayoutEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    queueMicrotask(() => { if (!cancelled) cleanup = setup(); });
    return () => { cancelled = true; cleanup?.(); };

    function setup() {
      if (attemptedInDocument) return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      if (reduced.matches || document.hidden) { attemptedInDocument = true; return; }
      let disposed = false;
      let started = false;
      let stage: HTMLDivElement | undefined;
      let destination: HTMLElement | undefined;
      let readinessDeadline = 0;
      let timer = 0;
      let failsafe = 0;
      const startupDeadline = performance.now() + 4000;
      const tweens: Array<{ kill(): void }> = [];
      const originals: Array<{ node: HTMLElement; opacity: string; priority: string }> = [];
      const script = document.getElementById('gsap-cdn');
      const observer = new MutationObserver(() => {
        if (started) { if (destination && !destination.isConnected) finish(); }
        else schedule();
      });

      function finish() {
        if (disposed) return;
        disposed = true; attemptedInDocument = true;
        clearTimeout(timer); clearTimeout(failsafe); observer.disconnect();
        tweens.forEach(tween => tween.kill());
        originals.forEach(({ node, opacity, priority }) => opacity ? node.style.setProperty('opacity', opacity, priority) : node.style.removeProperty('opacity'));
        stage?.remove();
        destination?.removeAttribute('data-brand-destination');
        script?.removeEventListener('load', schedule); script?.removeEventListener('error', finish);
        document.removeEventListener('pointerdown', finish, true); document.removeEventListener('keydown', finish, true); document.removeEventListener('focusin', finish, true);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('resize', finish); window.removeEventListener('scroll', finish, true); window.removeEventListener('beforeprint', finish);
        window.visualViewport?.removeEventListener('resize', finish); window.visualViewport?.removeEventListener('scroll', finish);
        reduced.removeEventListener('change', finish);
      }
      function visibility() { if (document.hidden) finish(); }
      function slots(target: HTMLElement) {
        const logoSlot = target.querySelector('[data-brand-logo]');
        const logo = logoSlot?.querySelector('img,svg') ?? logoSlot;
        const title = target.querySelector('[data-brand-title]');
        const subtitle = target.querySelector('[data-brand-subtitle]');
        return { logo: visible(logo) ? logo : null, title: visible(title) ? title : null, subtitle: visible(subtitle) ? subtitle : null };
      }
      function selectTarget() {
        const targets = [...document.querySelectorAll<HTMLElement>('[data-brand-target]')].filter(visible);
        return targets.find(target => target.dataset.brandTarget === 'brand' && Object.values(slots(target)).some(Boolean))
          ?? targets.find(target => target.dataset.brandTarget === 'anchor');
      }
      function hide(node: HTMLElement | null) {
        if (!node) return;
        originals.push({ node, opacity: node.style.getPropertyValue('opacity'), priority: node.style.getPropertyPriority('opacity') });
        node.style.setProperty('opacity', '0');
      }
      function start(target: HTMLElement) {
        if (started || disposed) return;
        const engine = window.gsap;
        if (!engine || reduced.matches || document.hidden || !target.isConnected) return finish();
        if (document.activeElement?.matches('input,textarea,select,button')) return finish();
        const source = slots(target);
        const actual = [source.logo, source.title, source.subtitle].filter((node): node is HTMLElement => Boolean(node));
        const anchor = box(target);
        const rects = actual.map(box);
        const left = rects.length ? Math.min(...rects.map(rect => rect.left)) : anchor.left;
        const top = rects.length ? Math.min(...rects.map(rect => rect.top)) : anchor.top;
        const endWidth = rects.length ? Math.max(...rects.map(rect => rect.left + rect.width)) - left : Math.min(anchor.width, 220);
        const endHeight = rects.length ? Math.max(...rects.map(rect => rect.top + rect.height)) - top : Math.min(anchor.height, 56);
        if (left < 0 || top < 0 || left + endWidth > innerWidth || top + endHeight > innerHeight) return finish();
        const rootStyle = getComputedStyle(document.documentElement);
        const color = rootStyle.getPropertyValue('--text-primary').trim() || (document.documentElement.classList.contains('dark') ? '#f5f5f7' : '#1d1d1f');
        const family = rootStyle.fontFamily;
        const logoBox: Box = source.logo ? box(source.logo) : { left, top, width: 56, height: 56 };
        logoBox.left -= left; logoBox.top -= top;
        function textBox(node: HTMLElement | null, text: string, size: number, y: number): TextBox {
          if (!node) return { left: logoBox.left + logoBox.width + 12, top: y, width: 165, height: size + 6, text, fontSize: size, letterSpacing: 0, fontFamily: family, fontWeight: size === 18 ? '650' : '400', color };
          const style = getComputedStyle(node);
          const rect = box(node);
          return { ...rect, left: rect.left - left, top: rect.top - top, text: node.textContent?.trim() || text, fontSize: parseFloat(style.fontSize), letterSpacing: parseFloat(style.letterSpacing) || 0, fontFamily: style.fontFamily, fontWeight: style.fontWeight, color: style.color };
        }
        const titleBox = textBox(source.title, TITLE, 18, 5);
        const canvas = document.createElement('canvas').getContext('2d');
        function widthFor(text: string, metrics: TextBox) {
          if (!canvas) return metrics.width;
          canvas.font = `${metrics.fontWeight} ${metrics.fontSize}px ${metrics.fontFamily}`;
          return canvas.measureText(text).width + Math.max(0, text.length - 1) * metrics.letterSpacing + 2;
        }
        const titleWidth = Math.max(titleBox.width, widthFor(TITLE, titleBox));
        // Intro displays logo and title without the subtitle line underneath
        const baseWidth = Math.max(logoBox.left + logoBox.width, titleBox.left + titleWidth);
        const baseHeight = Math.max(logoBox.top + logoBox.height, titleBox.top + titleBox.height);
        const factor = Math.max(1, Math.min(2.6, (innerWidth - 48) / baseWidth, (innerHeight - 80) / baseHeight));
        const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
        const centerX = snap((innerWidth - baseWidth * factor) / 2) - left;
        const centerY = snap((innerHeight - baseHeight * factor) / 2) - top;

        started = true; attemptedInDocument = true; clearTimeout(timer);
        destination = target; target.setAttribute('data-brand-destination', '');
        stage = document.createElement('div'); stage.className = 'brand-intro-stage'; stage.dataset.introPhase = 'assemble'; stage.dataset.introTarget = target.dataset.brandTarget; stage.setAttribute('aria-hidden', 'true');
        const veil = document.createElement('div'); veil.className = 'brand-intro-veil';
        const aura = document.createElement('div'); aura.className = 'brand-intro-aura';
        const brand = document.createElement('div'); brand.className = 'brand-intro-mark';
        Object.assign(brand.style, { left: `${left}px`, top: `${top}px`, width: `${baseWidth * factor}px`, height: `${baseHeight * factor}px` });
        const logo = document.createElement('img'); logo.className = 'brand-intro-logo'; logo.alt = ''; logo.draggable = false;
        logo.src = source.logo instanceof HTMLImageElement ? source.logo.currentSrc || source.logo.src : KIT_ASSETS.Home;
        Object.assign(logo.style, { left: `${logoBox.left * factor}px`, top: `${logoBox.top * factor}px`, width: `${logoBox.width * factor}px`, height: `${logoBox.height * factor}px` });
        brand.append(logo);
        function makeText(className: string, text: string, metrics: TextBox, width: number) {
          const node = document.createElement('div'); node.className = className; node.textContent = text;
          Object.assign(node.style, { left: `${metrics.left * factor}px`, top: `${metrics.top * factor}px`, width: `${width * factor}px`, height: `${metrics.height * factor}px`, fontSize: `${metrics.fontSize * factor}px`, lineHeight: `${metrics.height * factor}px`, letterSpacing: `${metrics.letterSpacing * factor}px`, fontFamily: metrics.fontFamily, fontWeight: metrics.fontWeight, color: metrics.color });
          brand.append(node); return node;
        }
        const title = makeText('brand-intro-title', TITLE, titleBox, titleWidth);
        stage.append(veil, aura, brand); document.body.append(stage);
        
        // Hide destination elements and the card initially
        hide(source.logo); 
        hide(source.title); 
        hide(source.subtitle);

        // Hide enclosing card/panel at the beginning of intro
        const card = target.closest<HTMLElement>('.kit-login-window, .auth-panel, .liquid-panel') 
          || document.querySelector<HTMLElement>('.kit-login-window')
          || document.querySelector<HTMLElement>('.resident-home, .admin-workspace');
        if (card) {
          hide(card);
        }

        try {
          const ease = 'power3.inOut';
          const moveDelay = 1.48; // Hold title & logo in center for ~1s
          const moveDuration = 0.68;

          tweens.push(engine.fromTo(brand, { x: centerX, y: centerY }, { x: centerX, y: centerY, duration: .01, force3D: false }));
          tweens.push(engine.fromTo(logo, { y: 10, scale: .76, rotation: -7, opacity: 0 }, { y: 0, scale: 1, rotation: 0, opacity: 1, duration: .46, delay: .08, ease: 'expo.out', force3D: false }));
          tweens.push(engine.fromTo(title, { x: 12, opacity: 0 }, { x: 0, opacity: 1, duration: .36, delay: .18, ease: 'power3.out', force3D: false }));
          tweens.push(engine.fromTo(aura, { opacity: 0, scale: .88 }, { opacity: 1, scale: 1, duration: .5, delay: .08, ease: 'sine.out' }));
          
          // Aura and veil fade out as transition starts
          tweens.push(engine!.to(aura, { opacity: 0, duration: .38, delay: moveDelay - 0.22, ease: 'sine.in' }));
          tweens.push(engine!.to(veil, { opacity: 0, duration: .56, delay: moveDelay, ease: 'power2.inOut' }));

          // Glide logo to destination
          tweens.push(engine!.to(logo, { autoRound: false, left: logoBox.left, top: logoBox.top, width: source.logo ? logoBox.width : 32, height: source.logo ? logoBox.height : 32, opacity: source.logo ? 1 : 0, duration: moveDuration, delay: moveDelay, ease, force3D: false }));
          
          function resolveText(node: HTMLDivElement, metrics: TextBox, original: HTMLElement | null, className: string) {
            const native = { autoRound: false, left: metrics.left, top: metrics.top, width: metrics.width, height: metrics.height, fontSize: `${metrics.fontSize}px`, lineHeight: `${metrics.height}px`, letterSpacing: `${metrics.letterSpacing}px`, duration: moveDuration, delay: moveDelay, ease, force3D: false };
            tweens.push(engine!.to(node, native));
            if (!original) {
              tweens.push(engine!.to(node, { opacity: 0, duration: .36, delay: moveDelay + 0.2, ease: 'sine.in' }));
            } else if (metrics.text !== node.textContent) {
              const landing = makeText(className, metrics.text, metrics, metrics.width);
              landing.style.opacity = '0';
              tweens.push(engine!.to(landing, native));
              tweens.push(engine!.to(node, { opacity: 0, duration: .18, delay: moveDelay + 0.4, ease: 'sine.in' }));
              tweens.push(engine!.to(landing, { opacity: 1, duration: .18, delay: moveDelay + 0.4, ease: 'sine.out' }));
            }
          }
          resolveText(title, titleBox, source.title, 'brand-intro-title-destination');

          // Transition brand container to target coordinates
          tweens.push(engine!.to(brand, { 
            autoRound: false, 
            x: 0, 
            y: 0, 
            width: endWidth, 
            height: endHeight, 
            opacity: actual.length ? 1 : 0, 
            duration: moveDuration, 
            delay: moveDelay, 
            ease, 
            force3D: false, 
            onStart() { 
              if (stage) stage.dataset.introPhase = 'resolve'; 
            }, 
            onComplete: finish 
          }));

          // When returning to title, card fades in
          if (card) {
            tweens.push(engine!.to(card, {
              opacity: 1,
              duration: 0.48,
              delay: moveDelay + 0.12,
              ease: 'power2.out'
            }));
          }
          if (source.subtitle) {
            tweens.push(engine!.to(source.subtitle, {
              opacity: 1,
              duration: 0.48,
              delay: moveDelay + 0.16,
              ease: 'power2.out'
            }));
          }

          failsafe = window.setTimeout(finish, 2750);
        } catch { finish(); }
      }

      function schedule() {
        if (disposed || started) return;
        clearTimeout(timer);
        const target = selectTarget();
        if (!target) {
          if (performance.now() >= startupDeadline) return finish();
          timer = window.setTimeout(schedule, 40); return;
        }
        if (!readinessDeadline) readinessDeadline = performance.now() + 600;
        const logo = slots(target).logo;
        if (!window.gsap || logo instanceof HTMLImageElement && (!logo.complete || !logo.naturalWidth)) {
          if (performance.now() >= readinessDeadline) return finish();
          timer = window.setTimeout(schedule, 40); return;
        }
        start(target);
      }
      document.addEventListener('pointerdown', finish, true); document.addEventListener('keydown', finish, true); document.addEventListener('focusin', finish, true);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('resize', finish); window.addEventListener('scroll', finish, true); window.addEventListener('beforeprint', finish);
      window.visualViewport?.addEventListener('resize', finish); window.visualViewport?.addEventListener('scroll', finish);
      reduced.addEventListener('change', finish);
      script?.addEventListener('load', schedule, { once: true }); script?.addEventListener('error', finish, { once: true });
      observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
      schedule();
      return finish;
    }
  }, []);
  return null;
}
