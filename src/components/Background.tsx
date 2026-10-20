import React from 'react';

/**
 * Clean architectural background canvas.
 * Eradicates typical AI gradient orbs, neon glows, and pulsating blobs in favor of
 * a calm, high-legibility surface adhering to strict WCAG 2.2 contrast principles.
 */
export function Background() {
  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-[#f8fafc] dark:bg-[#0b0f19] transition-colors duration-300">
      {/* Subtle architectural tactile grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.035]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '24px 24px'
        }}
      />
    </div>
  );
}
