import { installMotionScenes } from './uiMotionScenes';
/** Optional GSAP CDN enhancement. Never animate a glass surface or its parent. */
type Tween = { kill(): void };
type Engine = { fromTo(target: Element, from: object, to: object): Tween; to(target: Element, vars: object): Tween };
declare global { interface Window { gsap?: Engine } }

export function installUiMotion(root: HTMLElement) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map<Element, { tween?: Tween; restore(): void }>();
  const pressed = new Set<Element>();
  const glints = new Map<HTMLElement, { tween?: Tween; restore(): void }>();
  const pending = new Set<Element>();
  let frame = 0;
  const enabled = () => Boolean(window.gsap && !media.matches && !document.hidden);
  const visible = (element: Element) => element.isConnected && element.getClientRects().length > 0;
  const safe = (element: Element) => {
    if (!visible(element) || element.closest('.ui-spinner, .sr-only, .contract-document-a4, .invoice-paper')) return false;
    return [element, ...element.querySelectorAll('*')].every(node => {
      const style = getComputedStyle(node);
      return style.backdropFilter === 'none' && style.getPropertyValue('-webkit-backdrop-filter').replace('none', '').trim() === '';
    });
  };
  function stop(element: Element) {
    const entry = active.get(element);
    if (entry) { entry.tween?.kill(); entry.restore(); active.delete(element); }
  }
  function animate(element: Element, from: object | null, vars: object, restoreOnComplete = true) {
    stop(element);
    if (!enabled() || !safe(element)) return;
    const style = (element as HTMLElement | SVGElement).style;
    const names = ['transform', 'transform-origin', 'opacity', 'visibility'];
    const saved = names.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
    const oldMarker = element.getAttribute('data-gsap-motion');
    const svgAttributes = element instanceof SVGElement ? ['transform', 'data-svg-origin'].map(name => [name, element.getAttribute(name)]) : [];
    const entry: { tween?: Tween; restore(): void } = {
      restore() {
        saved.forEach(([name, value, priority]) => value ? style.setProperty(name, value, priority) : style.removeProperty(name));
        svgAttributes.forEach(([name, value]) => value === null ? element.removeAttribute(name!) : element.setAttribute(name!, value!));
        const cache = (element as Element & { _gsap?: { uncache: number } })._gsap;
        if (cache) cache.uncache = 1;
        if (oldMarker === null) element.removeAttribute('data-gsap-motion'); else element.setAttribute('data-gsap-motion', oldMarker);
      }
    };
    element.setAttribute('data-gsap-motion', '');
    active.set(element, entry);
    const options = { ...vars, ease: 'power2.out', overwrite: 'auto', onComplete: () => {
      if (restoreOnComplete && active.get(element) === entry) { entry.restore(); active.delete(element); }
    } };
    entry.tween = from ? window.gsap!.fromTo(element, from, options) : window.gsap!.to(element, options);
  }
  function reveal(element: Element) {
    // Headings/text only. Cards, panels and entire routes keep a stable backdrop.
    animate(element, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.16 });
  }
  function sidebarEntrance(sidebar: Element) {
    const labels = [...sidebar.querySelectorAll('nav a > span, nav button span')]
      .filter(element => element.children.length === 0 && element.textContent?.trim() && !element.matches('.sr-only'));
    labels.forEach((element, index) => animate(element, { opacity: 0, x: -8 }, {
      opacity: 1, x: 0, duration: 0.22, delay: Math.min(index, 5) * 0.025
    }));
  }
  function glint(event: Event) {
    if (!enabled()) return;
    if (event instanceof PointerEvent && event.type === 'pointerover' && event.pointerType !== 'mouse') return;
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tutorial="billing-card"], .resident-room-panel, .kit-quick-action, .admin-revenue-card, .admin-room-card') : null;
    if (!card || !root.contains(card) || !visible(card)) return;
    if (event instanceof PointerEvent && event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
    if (glints.has(card) || card.classList.contains('motion-data-updated')) return;
    const previous = card.style.getPropertyValue('--card-glint');
    const hadClass = card.classList.contains('motion-card-light');
    const entry: { tween?: Tween; restore(): void } = { restore() {
      if (previous) card.style.setProperty('--card-glint', previous); else card.style.removeProperty('--card-glint');
      if (!hadClass) card.classList.remove('motion-card-light');
      glints.delete(card);
    } };
    card.classList.add('motion-card-light');
    glints.set(card, entry);
    entry.tween = window.gsap!.fromTo(card, { '--card-glint': '100%' }, {
      '--card-glint': '0%', duration: 0.55, ease: 'power2.out', overwrite: 'auto', onComplete: entry.restore
    });
  }
  const scenes = installMotionScenes(root, { enabled, safe, animate, stopGlint(card) { const entry = glints.get(card); if (entry) { entry.tween?.kill(); entry.restore(); } } });
  function scan(node: Element) {
    scenes.scan(node);
    const selector = 'h1, [role="dialog"] h2, [role="dialog"] h3, #header-notification-panel h2, [data-ui-motion="reveal"], [data-ui-motion="copied"]';
    const targets = [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
    targets.forEach(element => {
      if (element.getAttribute('data-ui-motion') === 'copied') {
        animate(element, { scale: 0.85, opacity: 0.5 }, { scale: 1, opacity: 1, duration: 0.12, transformOrigin: '50% 50%' });
      } else reveal(element);
    });
  }
  function flush() {
    frame = 0;
    active.forEach((_, element) => { if (!element.isConnected) stop(element); });
    glints.forEach((entry, element) => { if (!element.isConnected) { entry.tween?.kill(); entry.restore(); } });
    const roots = [...pending]; pending.clear();
    roots.filter(node => !roots.some(other => other !== node && other.contains(node))).forEach(scan);
  }
  function queue(element: Element) {
    pending.add(element);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  const observer = new MutationObserver(records => {
    scenes.records(records);
    records.forEach(record => {
      if (record.type === 'attributes' && record.attributeName === 'aria-expanded' && record.target instanceof Element && record.target.getAttribute('aria-expanded') === 'true' && record.target.closest('aside')) {
        sidebarEntrance(record.target.closest('aside')!);
      } else if (record.type === 'characterData') {
        const heading = record.target.parentElement;
        if (heading?.matches('h1')) queue(heading);
      } else if (record.type === 'childList') {
        record.addedNodes.forEach(node => { if (node instanceof Element) queue(node); });
        if ([...record.removedNodes].some(node => node instanceof Element) && !frame) frame = requestAnimationFrame(flush);
        // React often updates a title's text without mounting a new heading.
        if (record.target instanceof Element && record.target.matches('h1')) queue(record.target);
      } else if (record.target instanceof Element && (record.target.getAttribute('aria-pressed') === 'true' || record.target.getAttribute('aria-selected') === 'true' || record.target.getAttribute('aria-current') === 'page')) {
        const icon = contentTarget(record.target);
        if (icon) animate(icon, { opacity: 0.6 }, { opacity: 1, duration: 0.12 });
      }
    });
  });
  function contentTarget(control: Element) {
    return [...control.children].find(child => {
      const style = getComputedStyle(child);
      return child.matches('svg, span, img') && !child.matches('.sr-only, .ui-spinner') && !child.querySelector('input, button') && style.position !== 'absolute' && style.transform === 'none' && style.display !== 'inline' && safe(child);
    });
  }
  function down(event: PointerEvent | KeyboardEvent) {
    if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return;
    if (event instanceof PointerEvent && event.button !== 0) return;
    if (event instanceof PointerEvent) glint(event);
    const control = event.target instanceof Element ? event.target.closest('button, a[href], summary') : null;
    if (!control || !root.contains(control) || control.matches(':disabled, [aria-disabled="true"]')) return;
    const content = contentTarget(control);
    if (content && enabled()) {
      pressed.add(content);
      animate(content, null, { scale: 0.97, duration: 0.08, transformOrigin: '50% 50%' }, false);
    }
  }
  function release() {
    pressed.forEach(element => animate(element, { scale: 0.97 }, { scale: 1, duration: 0.12, transformOrigin: '50% 50%' }));
    pressed.clear();
  }
  function reset() {
    scenes.reset();
    active.forEach((_, element) => stop(element));
    glints.forEach(entry => { entry.tween?.kill(); entry.restore(); });
    pressed.clear(); pending.clear();
    cancelAnimationFrame(frame); frame = 0;
  }
  function visibility() { if (document.hidden) reset(); }
  function loaded() { queue(root); }
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current', 'aria-expanded', 'aria-checked', 'aria-invalid', 'data-motion-progress', 'data-motion-value'] });
  root.addEventListener('pointerover', glint);
  root.addEventListener('focusin', glint);
  root.addEventListener('pointerdown', down);
  root.addEventListener('keydown', down);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keyup', release);
  window.addEventListener('blur', reset);
  window.addEventListener('beforeprint', reset);
  media.addEventListener('change', reset);
  document.addEventListener('visibilitychange', visibility);
  const script = document.getElementById('gsap-cdn');
  script?.addEventListener('load', loaded);
  if (window.gsap) queue(root);
  return () => {
    observer.disconnect(); reset(); scenes.dispose();
    root.removeEventListener('pointerover', glint); root.removeEventListener('focusin', glint);
    root.removeEventListener('pointerdown', down); root.removeEventListener('keydown', down);
    window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
    window.removeEventListener('keyup', release); window.removeEventListener('blur', reset); window.removeEventListener('beforeprint', reset);
    media.removeEventListener('change', reset); document.removeEventListener('visibilitychange', visibility);
    script?.removeEventListener('load', loaded);
  };
}
