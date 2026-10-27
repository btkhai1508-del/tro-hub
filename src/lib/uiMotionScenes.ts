/** Task feedback layered on top of uiMotion; no business state is inferred. */
type Tween = { kill(): void };
type MotionApi = {
  enabled(): boolean;
  safe(element: Element): boolean;
  animate(element: Element, from: object | null, vars: object): void;
  stopGlint(element: HTMLElement): void;
};
export function installMotionScenes(root: HTMLElement, api: MotionApi) {
  const effects = new Map<HTMLElement, { tween?: Tween; restore(): void }>();
  const navigation = new Map<HTMLElement, Element>();
  const values = new WeakMap<Element, string>();
  const progress = new WeakMap<Element, number>();
  const jobs = new Map<Element, () => void>();
  let frame = 0;
  const selected = '[aria-current="page"], [aria-selected="true"], .kit-nav-active, .kit-segment[aria-pressed="true"]';
  const scopes = 'nav, .kit-segmented, [role="tablist"]';
  const numeric = '.font-num, [data-motion-watch], [data-motion-progress]';
  function queue(element: Element, run: () => void) {
    jobs.set(element, run);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      navigation.forEach((_, nav) => { if (!nav.isConnected) navigation.delete(nav); });
      effects.forEach((effect, node) => { if (!node.isConnected) { effect.tween?.kill(); effect.restore(); } });
      const pending = [...jobs]; jobs.clear();
      pending.forEach(([node, task]) => { if (node.isConnected) task(); });
    });
  }
  function decorate(node: HTMLElement, name: string, variable: string, from: number, duration: number) {
    if (!api.enabled() || !node.getClientRects().length) return;
    effects.get(node)?.tween?.kill(); effects.get(node)?.restore();
    const saved = node.style.getPropertyValue(variable);
    const priority = node.style.getPropertyPriority(variable);
    const hadClass = node.classList.contains(name);
    const effect: { tween?: Tween; restore(): void } = { restore() {
      if (saved) node.style.setProperty(variable, saved, priority); else node.style.removeProperty(variable);
      if (!hadClass) node.classList.remove(name);
      effects.delete(node);
    } };
    node.classList.add(name); effects.set(node, effect);
    effect.tween = window.gsap!.fromTo(node, { [variable]: from }, {
      [variable]: 1, duration, ease: 'power2.out', onComplete: effect.restore
    });
  }
  function travel(control: Element) {
    const nav = control.closest<HTMLElement>(scopes);
    if (!nav || !control.matches(selected) || control.closest('[role="dialog"]') && !nav.closest('[role="dialog"]')) return;
    const previous = navigation.get(nav); navigation.set(nav, control);
    if (!previous || previous === control || !api.enabled() || !previous.isConnected || !nav.getClientRects().length) return;
    // The outline is an absolute decorative layer, never the glass surface.
    const a = previous.getBoundingClientRect(), b = control.getBoundingClientRect(), n = nav.getBoundingClientRect();
    if (!a.width || !b.width) return;
    effects.get(nav)?.tween?.kill(); effects.get(nav)?.restore();
    const layer = document.createElement('span');
    layer.className = 'motion-nav-trail'; layer.setAttribute('aria-hidden', 'true');
    const hadScope = nav.classList.contains('motion-nav-scope');
    // An already-positioned dock must retain fixed/absolute positioning.
    const positioned = getComputedStyle(nav).position !== 'static';
    if (!positioned) nav.classList.add('motion-nav-scope');
    const offsetX = -n.left - nav.clientLeft + nav.scrollLeft;
    const offsetY = -n.top - nav.clientTop + nav.scrollTop;
    Object.assign(layer.style, { left: '0', top: '0', borderRadius: getComputedStyle(control).borderRadius });
    nav.append(layer);
    const effect: { tween?: Tween; restore(): void } = { restore() {
      layer.remove(); if (!hadScope) nav.classList.remove('motion-nav-scope'); effects.delete(nav);
    } };
    effects.set(nav, effect);
    effect.tween = window.gsap!.fromTo(layer, { x: a.left + offsetX, y: a.top + offsetY, width: a.width, height: a.height, opacity: 0.65 }, {
      x: b.left + offsetX, y: b.top + offsetY, width: b.width, height: b.height, opacity: 0,
      duration: 0.22, ease: 'power2.out', onComplete: effect.restore
    });
  }
  function seedNavigation(node: Element) {
    const navs = [...(node.matches(scopes) ? [node] : []), ...node.querySelectorAll(scopes)];
    navs.forEach(nav => {
      const item = nav.querySelector(selected);
      if (item && !navigation.has(nav as HTMLElement)) navigation.set(nav as HTMLElement, item);
    });
  }
  function enterContent(node: Element) {
    const leaves: Element[] = [];
    // Stop after eight eligible leaves; large room/history lists stay cheap.
    for (const element of node.querySelectorAll('h3, h4, p, label, dt, dd, li, .apple-headline, [data-motion-item-label]')) {
      if (leaves.length === 8) break;
      if (element.closest('[role="dialog"]') && element.matches('h2, h3')) continue;
      if (element.matches(numeric) || element.closest(numeric) || element.querySelector('input, select, textarea, button, [data-motion-progress], .font-num') || element.children.length >= 2 || leaves.some(parent => parent.contains(element)) || !api.safe(element)) continue;
      leaves.push(element);
    }
    leaves.forEach((element, index) => api.animate(element, { opacity: 0.65, y: 3 }, {
      opacity: 1, y: 0, duration: 0.16, delay: index * 0.015
    }));
  }

  function checkValue(element: Element) {
    const text = element.getAttribute('data-motion-value') ?? element.textContent?.trim() ?? '';
    const old = values.get(element); values.set(element, text);
    if (old === undefined || old === text || !api.enabled()) return;
    const card = element.closest<HTMLElement>('[data-motion-card], .liquid-panel, .soft-card, .soft-surface');
    if (card) { api.stopGlint(card); decorate(card, 'motion-data-updated', '--update-step', 0, 0.45); }
  }
  function updateProgress(element: Element) {
    const next = Math.min(100, Math.max(0, Number(element.getAttribute('data-motion-progress')) || 0));
    const old = progress.get(element); progress.set(element, next);
    if (old === undefined || old === next || next === 0) return;
    api.animate(element, { scaleX: old / next }, { scaleX: 1, transformOrigin: 'left center', duration: 0.3 });
  }
  function shake(element: Element) {
    if (element.matches('input, select, textarea') && api.safe(element)) api.animate(element, null, {
      keyframes: [{ x: -2 }, { x: 2 }, { x: -1 }, { x: 0 }], duration: 0.18
    });
  }
  function scan(node: Element) {
    seedNavigation(node);
    const watch = '[data-motion-watch], [data-motion-progress]';
    [...(node.matches(watch) ? [node] : []), ...node.querySelectorAll(watch)].forEach(element => {
      if (element.hasAttribute('data-motion-progress')) updateProgress(element); else checkValue(element);
    });
    const revealGroups = '[data-motion-list], .tahoe-dialog .kit-dialog-body';
    const lists = [...(node.matches(revealGroups) ? [node] : []), ...node.querySelectorAll(revealGroups)];
    lists.forEach(list => queue(list, () => enterContent(list)));
    const result = '[role="alert"], [role="status"], .kit-feedback, [data-motion-success]';
    [...(node.matches(result) ? [node] : []), ...node.querySelectorAll(result)].forEach(element => {
      if (element.hasAttribute('data-motion-success')) {
        if (element instanceof HTMLElement) decorate(element, 'motion-success-ring', '--success-step', 0, 0.32);
        const icon = element.querySelector('svg');
        if (icon) api.animate(icon, { opacity: 0.5, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.2, transformOrigin: 'center' });
      } else if (element.getAttribute('role') === 'status' && (!/chưa|không có|đã |thành công/i.test(element.textContent || '') || element.querySelector('.ui-spinner'))) return;
      else if (api.safe(element)) api.animate(element, { opacity: 0.7, y: 3 }, { opacity: 1, y: 0, duration: 0.16 });
    });
  }
  function records(records: MutationRecord[]) {
    navigation.forEach((_, nav) => { if (!nav.isConnected) navigation.delete(nav); });
    effects.forEach((effect, node) => { if (!node.isConnected) { effect.tween?.kill(); effect.restore(); } });
    records.forEach(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target) return;
      if (record.type === 'attributes') {
        if (target.matches(selected)) queue(target, () => travel(target));
        if (record.attributeName === 'aria-expanded' && target.getAttribute('aria-expanded') === 'true' && !target.closest('aside')) {
          const id = target.getAttribute('aria-controls'); const content = id ? document.getElementById(id) : null;
          if (content) queue(content, () => enterContent(content));
        }
        if (record.attributeName === 'data-motion-progress') queue(target, () => updateProgress(target));
        if (record.attributeName === 'data-motion-value') queue(target, () => checkValue(target));
        if (record.attributeName === 'aria-checked' && target.matches('[role="switch"]')) {
          const thumb = target.querySelector<HTMLElement>('[data-motion-thumb]');
          if (thumb) decorate(thumb, 'motion-switch-thumb', '--switch-squeeze', 0.9, 0.18);
        }
        if (record.attributeName === 'aria-invalid' && target.getAttribute('aria-invalid') === 'true') queue(target, () => shake(target));
      }
      if (record.type === 'characterData' || record.type === 'childList') {
        const value = target.closest('[data-motion-watch]');
        if (value) queue(value, () => checkValue(value));
        const button = target.closest('button');
        if (button && /đang|đã lưu|đã gửi|đã cập nhật/i.test(button.textContent || '')) {
          const label = [...button.querySelectorAll('span')].find(span => span.children.length === 0 && /đang|đã lưu|đã gửi|đã cập nhật/i.test(span.textContent || ''));
          if (label) queue(label, () => api.animate(label, { opacity: 0.6 }, { opacity: 1, duration: 0.12 }));
        }
      }
      if (record.type === 'childList') {
        const list = target.closest('[data-motion-list]');
        if (list) queue(list, () => enterContent(list));
      }
    });
  }
  function toggle(event: Event) {
    const details = event.target;
    if (details instanceof HTMLDetailsElement && details.open) queue(details, () => enterContent(details));
  }
  function invalid(event: Event) { if (event.target instanceof Element) shake(event.target); }
  function reset() {
    effects.forEach(effect => { effect.tween?.kill(); effect.restore(); });
    cancelAnimationFrame(frame); frame = 0; jobs.clear();
  }
  root.addEventListener('toggle', toggle, true); root.addEventListener('invalid', invalid, true);
  return { scan, records, reset, dispose() {
    reset(); navigation.clear(); root.removeEventListener('toggle', toggle, true); root.removeEventListener('invalid', invalid, true);
  } };
}
