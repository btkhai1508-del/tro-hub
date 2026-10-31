import { useState, useRef, useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';

export function useCrossfadeState<T>(
  initialState: T | (() => T)
): [T, Dispatch<SetStateAction<T>>, RefObject<HTMLElement | null>] {
  const [state, setStateInternal] = useState<T>(initialState);
  const ref = useRef<HTMLElement | null>(null);

  const setState: Dispatch<SetStateAction<T>> = useCallback((nextValue) => {
    setStateInternal((prev) => {
      const resolved = typeof nextValue === 'function' ? (nextValue as (p: T) => T)(prev) : nextValue;
      if (resolved !== prev && typeof window !== 'undefined') {
        const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (!prefersReduced) {
          requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            el.classList.remove('admin-section-enter');
            void el.offsetWidth;
            el.classList.add('admin-section-enter');
          });
        }
      }
      return resolved;
    });
  }, []);

  return [state, setState, ref];
}
