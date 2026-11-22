import { useEffect, useState } from 'react';

type Phase = 'idle' | 'closing' | 'settling' | 'opening';

/** Lets sidebar text fade out before its collapsed layout replaces it, and fade back in on opening. */
export function useSidebarLabels(collapsed: boolean) {
  const [shown, setShown] = useState(collapsed);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (collapsed === shown) {
      setPhase('idle');
      return;
    }
    if (collapsed) {
      setPhase('closing');
      let settle = 0;
      const timer = window.setTimeout(() => {
        setShown(true);
        setPhase('settling');
        settle = window.setTimeout(() => setPhase('idle'), 300);
      }, 140);
      return () => { clearTimeout(timer); clearTimeout(settle); };
    }
    setShown(false);
    setPhase('opening');
    const timer = window.setTimeout(() => setPhase('idle'), 420);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  return { collapsedLayout: shown, labelPhase: phase };
}
