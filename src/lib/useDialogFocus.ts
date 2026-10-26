import { useEffect, useRef } from 'react';
import '../styles/dialog-tahoe.css';

const openDialogs: HTMLElement[] = [];
let previousBodyOverflow = '';
const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A small focus scope shared by existing dialogs, including nested dialogs.
 * Focus the panel first so opening a mobile sheet does not summon a keyboard. */
export function useDialogFocus(isOpen: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || !panel) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = panel.parentElement;
    if (openDialogs.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(panel);
    const isTopmost = () => openDialogs.at(-1) === panel;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    const updateViewport = () => {
      overlay?.style.setProperty('--dialog-viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
      overlay?.style.setProperty('--dialog-viewport-top', `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    panel.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusables();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) {
          event.preventDefault();
          panel.focus({ preventScroll: true });
        } else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement) || document.activeElement === panel)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isTopmost() && event.target instanceof Node && !panel.contains(event.target)) panel.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      const index = openDialogs.indexOf(panel);
      if (index >= 0) openDialogs.splice(index, 1);
      if (openDialogs.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else openDialogs.at(-1)?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  return panelRef;
}
