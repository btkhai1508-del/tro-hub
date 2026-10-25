import React from 'react';

/** Uploaded Gradient Background #4, paired light/dark artwork at 90% opacity. */
export function Background() {
  return (
    <div aria-hidden="true" className="app-wallpaper pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <img
        src="/backgrounds/gradient-04-light.svg"
        alt=""
        draggable={false}
        className="wallpaper-art wallpaper-art-light"
      />
      <img
        src="/backgrounds/gradient-04-dark.svg"
        alt=""
        draggable={false}
        className="wallpaper-art wallpaper-art-dark"
      />
    </div>
  );
}
