import { useEffect, useState } from 'react';

type Phase = 'idle' | 'closing' | 'opening';

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
      const timer = window.setTimeout(() => { setShown(true); setPhase('idle'); }, 140);
      return () => clearTimeout(timer);
    }
    setShown(false);
    setPhase('opening');
    const timer = window.setTimeout(() => setPhase('idle'), 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  return { collapsedLayout: shown, labelPhase: phase };
}
