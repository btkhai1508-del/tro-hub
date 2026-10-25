import React from 'react';

/** A quiet, layered wallpaper gives translucent controls a sense of depth. */
export function Background() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#f1f1f2] transition-colors duration-500 dark:bg-[#0b0b0c]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_4%_8%,rgba(207,207,207,0.55),transparent_48%),radial-gradient(ellipse_at_96%_18%,rgba(227,227,227,0.36),transparent_46%),radial-gradient(ellipse_at_75%_95%,rgba(216,216,216,0.4),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_4%_8%,rgba(69,69,69,0.32),transparent_48%),radial-gradient(ellipse_at_96%_18%,rgba(70,70,70,0.22),transparent_46%),radial-gradient(ellipse_at_75%_95%,rgba(55,55,55,0.2),transparent_50%)]" />
      <div className="absolute -left-[20%] top-[40%] h-[55vw] w-[100vw] -rotate-[30deg] rounded-[50%] border border-white/30 bg-gradient-to-b from-white/20 to-transparent dark:border-white/[0.025] dark:from-white/[0.015]" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/15 via-transparent to-white/25 dark:from-transparent dark:to-black/10" />
    </div>
  );
}
