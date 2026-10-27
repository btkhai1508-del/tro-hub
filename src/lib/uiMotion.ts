import { canAnimate, type MotionTween } from './motionEngine';

/** New task motion grammar. Page opacity is owned exclusively by FadeOutlet. */
export function installUiMotion(root: HTMLElement) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map<Element, { tween?: MotionTween; restore(): void }>();
  const totals = new WeakMap<Element, string>();
  const progress = new WeakMap<Element, number>();
  const queue = new Set<Element>();
  const held = new Set<Element>();
  const drawn = new WeakSet<Element>();
  const listItems = new WeakMap<Element, Set<Element>>();
  const pendingLists = new Set<Element>();
  let frame = 0;
  let filterTimer = 0;
  function cancel(node: Element) { const task = running.get(node); task?.tween?.kill(); task?.restore(); }
  const visible = (node: Element) => node.isConnected && node.getClientRects().length > 0;
  function leaf(node: Element) {
    if (!visible(node) || node.closest('.ui-spinner,.animate-spin,.sr-only,.invoice-paper,.contract-document-a4') || node.querySelector('.ui-spinner,.animate-spin')) return false;
    return [node, ...node.querySelectorAll('*')].every(child => {
      const style = getComputedStyle(child);
      return !style.backdropFilter || style.backdropFilter === 'none';
    });
  }
  function play(node: Element, from: object | null, to: object, duration = .16, delay = 0, hold = false) {
    cancel(node);
    if (!canAnimate() || !leaf(node)) return;
    const style = (node as HTMLElement).style;
    const saved = ['transform','transform-origin','opacity','stroke-dasharray','stroke-dashoffset'].map(key => [key,style.getPropertyValue(key),style.getPropertyPriority(key)]);
    const attributes = node instanceof SVGElement ? ['transform','data-svg-origin'].map(key => [key,node.getAttribute(key)]) : [];
    const task: { tween?: MotionTween; restore(): void } = { restore() {
      saved.forEach(([key,value,priority]) => value ? style.setProperty(key,value,priority) : style.removeProperty(key));
      attributes.forEach(([key,value]) => value === null ? node.removeAttribute(key!) : node.setAttribute(key!,value!));
      const cache = (node as Element & { _gsap?: { uncache: number } })._gsap; if (cache) cache.uncache = 1;
      node.removeAttribute('data-motion-active'); running.delete(node);
    } };
    running.set(node,task); node.setAttribute('data-motion-active','');
    const vars = { ...to, duration, delay, ease: 'power2.out', overwrite: 'auto', onComplete: () => { if (!hold) task.restore(); } };
    task.tween = from ? window.gsap!.fromTo(node,from,vars) : window.gsap!.to(node,vars);
  }
  function stage(group: Element, only?: Set<Element>) {
    for (const path of group.querySelectorAll('svg[role="img"] path[stroke]:not([stroke="none"])')) {
      if (!(path instanceof SVGGeometryElement) || drawn.has(path) || !canAnimate() || !leaf(path)) continue;
      drawn.add(path); const length = path.getTotalLength();
      play(path,{ strokeDasharray:length,strokeDashoffset:length },{ strokeDashoffset:0 },.45);
    }
    let i = 0;
    for (const node of group.querySelectorAll('h2,h3,h4,p,label,dt,[data-stage="item"]')) {
      if (i === 6) break;
      if (only && !only.has(node) || node.closest('.font-num,[data-stage="amount"]') || node.querySelector('input,select,textarea,button,.font-num') || !leaf(node)) continue;
      play(node,{ opacity: .65,y: 5 },{ opacity: 1,y: 0 },.2,i++*.025);
    }
  }
  function feedback(group: Element) {
    // Toast hosts keep their centering and glass material; only safe leaves enter.
    const nodes = [...(group.matches('p') ? [group] : []), ...group.querySelectorAll('h2,h3,p,span:not(:has(*)),svg')];
    nodes.filter(node => leaf(node) && !node.closest('.sr-only') && !nodes.some(other => other !== node && other.contains(node))).slice(0,4).forEach((node,i) => {
      play(node,{ opacity: .45,y: 4 },{ opacity: 1,y: 0 },.18,i*.025);
    });
  }
  function content(control: Element) {
    return [...control.children].find(node => node.matches('svg,.kit-asset-icon,span') && getComputedStyle(node).display !== 'inline' && !node.querySelector('input,button') && !node.matches('.ui-spinner') && leaf(node));
  }
  function inspect(node: Element) {
    const amounts = [...(node.matches('[data-stage="amount"]') ? [node] : []), ...node.querySelectorAll('[data-stage="amount"]')];
    amounts.forEach(amount => {
      const value = amount.getAttribute('data-stage-value') ?? amount.textContent ?? '';
      const old = totals.get(amount); totals.set(amount,value);
      if (old !== undefined && old !== value && canAnimate()) {
        amount.classList.remove('motion-value-signal'); void amount.getBoundingClientRect(); amount.classList.add('motion-value-signal');
      }
    });
    const bars = [...(node.matches('[data-stage="progress"]') ? [node] : []), ...node.querySelectorAll('[data-stage="progress"]')];
    bars.forEach(bar => {
      const next = Number(bar.getAttribute('aria-valuenow')) || 0, old = progress.get(bar); progress.set(bar,next);
      if (old !== undefined && next !== old && next > 0) play(bar,{ scaleX: old/next,transformOrigin:'left center' },{ scaleX: 1,transformOrigin:'left center' },.3);
    });
    const dialog = node.matches('[role="dialog"]') ? node : null;
    if (dialog || node.matches('[data-stage="popover"]')) stage(node);
    if (node.matches('[role="alert"],[role="status"]') && !node.querySelector('.ui-spinner')) feedback(node);
    const tick = node.matches('[data-stage="copied"]') ? node : null;
    if (tick) play(tick,{ opacity: .3,scale: .8 },{ opacity: 1,scale: 1,transformOrigin:'center' },.18);
    const success = node.matches('[data-stage="success"],[role="checkbox"][aria-checked="true"]') ? node : node.querySelector('[data-stage="success"]');
    if (success) {
      const path = success.querySelector('svg path,svg polyline');
      if (path instanceof SVGGeometryElement) {
        const length = path.getTotalLength(); play(path,{ strokeDasharray: length,strokeDashoffset: length },{ strokeDashoffset: 0 },.35);
      }
    }
  }
  function flush() {
    frame = 0;
    running.forEach((_,node) => { if (!node.isConnected) cancel(node); });
    const nodes = [...queue]; queue.clear();
    nodes.filter(node => !nodes.some(other => other !== node && other.contains(node))).forEach(node => {
      inspect(node);
      node.querySelectorAll('[role="dialog"],[data-stage="popover"],[data-stage="copied"],[role="alert"],[role="status"]').forEach(inspect);
    });
  }
  function schedule(node: Element) { queue.add(node); if (!frame) frame = requestAnimationFrame(flush); }
  const observer = new MutationObserver(records => records.forEach(record => {
    const node = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!node) return;
    if (record.type === 'childList') {
      record.addedNodes.forEach(added => { if (added instanceof Element) schedule(added); });
      if (record.removedNodes.length && !frame) frame = requestAnimationFrame(flush);
    }
    const amount = node.closest('[data-stage="amount"],[data-stage="progress"]'); if (amount) schedule(amount);
    if (record.type === 'attributes') {
      if (record.attributeName === 'aria-expanded' && node.getAttribute('aria-expanded') === 'true' && !node.closest('aside')) {
        const id = node.getAttribute('aria-controls'), body = id ? document.getElementById(id) : null; if (body) stage(body);
      }
      if (record.attributeName === 'aria-pressed' && node.matches('.kit-segment[aria-pressed="true"]')) {
        const icon = content(node); if (icon) play(icon,{ y: 2,opacity:.7 },{ y:0,opacity:1 },.16);
      }
      if (record.attributeName === 'aria-checked' && node.matches('[role="checkbox"][aria-checked="true"]')) inspect(node);
    }
    const label = node.closest('button span');
    if (label && label.children.length === 0 && /đang|đã lưu|đã gửi/i.test(label.textContent || '')) play(label,{ opacity:.6 },{ opacity:1 },.12);
  }));
  function down(event: PointerEvent | KeyboardEvent) {
    if (event instanceof KeyboardEvent && (event.repeat || !['Enter',' '].includes(event.key))) return;
    if (event instanceof PointerEvent && event.button !== 0) return;
    const button = event.target instanceof Element ? event.target.closest('button,a[href],summary') : null;
    if (!button || button.matches(':disabled,[aria-disabled="true"]')) return;
    const node = content(button); if (node && canAnimate()) { held.add(node); play(node,null,{ scale:.985,transformOrigin:'center' },.08,0,true); }
  }
  function release() { held.forEach(node => play(node,{ scale:.985 },{ scale:1,transformOrigin:'center' },.12)); held.clear(); }
  function toggle(event: Event) { if (event.target instanceof HTMLDetailsElement && event.target.open) stage(event.target); }
  function filter(event: Event) {
    const control = event.target instanceof Element ? event.target.closest('[data-stage-filter]') : null;
    const id = control?.getAttribute('data-stage-filter');
    const list = id ? document.getElementById(id) : null;
    if (!list || !root.contains(list)) return;
    const candidates = () => new Set(list.querySelectorAll('h2,h3,h4,p,label,dt,[data-stage="item"]'));
    if (!listItems.has(list)) listItems.set(list,candidates());
    pendingLists.add(list);
    clearTimeout(filterTimer);
    // Let React commit and rapid typing settle; only newly revealed rows enter.
    filterTimer = window.setTimeout(() => {
      filterTimer = 0;
      pendingLists.forEach(group => {
        if (!group.isConnected) return;
        const next = new Set(group.querySelectorAll('h2,h3,h4,p,label,dt,[data-stage="item"]'));
        const previous = listItems.get(group) ?? new Set();
        listItems.set(group,next);
        const added = new Set([...next].filter(node => !previous.has(node)));
        if (added.size) stage(group,added);
      });
      pendingLists.clear();
    },100);
  }
  function invalid(event: Event) {
    if (event.target instanceof Element) play(event.target,null,{ keyframes:[{x:-2},{x:2},{x:0}] },.18);
  }
  function reset() {
    clearTimeout(filterTimer); filterTimer = 0; pendingLists.clear();
    running.forEach((_,node) => cancel(node)); held.clear(); queue.clear(); cancelAnimationFrame(frame); frame = 0;
    root.querySelectorAll('.motion-value-signal').forEach(node => node.classList.remove('motion-value-signal'));
  }
  function hidden() { if (document.hidden) reset(); }
  const ended = (event: AnimationEvent) => { if (event.animationName === 'value-signal' && event.target instanceof Element) event.target.classList.remove('motion-value-signal'); };
  observer.observe(root,{ subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-pressed','aria-checked','aria-expanded','aria-valuenow','data-stage-value'] });
  root.addEventListener('pointerdown',down); root.addEventListener('keydown',down); window.addEventListener('pointerup',release); window.addEventListener('pointercancel',release); window.addEventListener('keyup',release);
  root.addEventListener('toggle',toggle,true); root.addEventListener('change',filter); root.addEventListener('input',filter); root.addEventListener('click',filter); root.addEventListener('invalid',invalid,true); root.addEventListener('animationend',ended);
  media.addEventListener('change',reset); document.addEventListener('visibilitychange',hidden); window.addEventListener('beforeprint',reset); window.addEventListener('blur',reset);
  return () => {
    observer.disconnect(); reset(); root.removeEventListener('pointerdown',down); root.removeEventListener('keydown',down); window.removeEventListener('pointerup',release); window.removeEventListener('pointercancel',release); window.removeEventListener('keyup',release);
    root.removeEventListener('toggle',toggle,true); root.removeEventListener('change',filter); root.removeEventListener('input',filter); root.removeEventListener('click',filter); root.removeEventListener('invalid',invalid,true); root.removeEventListener('animationend',ended);
    media.removeEventListener('change',reset); document.removeEventListener('visibilitychange',hidden); window.removeEventListener('beforeprint',reset); window.removeEventListener('blur',reset);
  };
}
