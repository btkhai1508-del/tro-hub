import React from 'react';
import { useTheme } from '../context/ThemeContext';

/** Original wallpapers extracted from the supplied macOS 26 material boards.
 * Render one theme at a time so hidden artwork doesn't compete with page loads. */
export function Background() {
  const { isDark } = useTheme();
  return (
    <div aria-hidden="true" className="app-wallpaper pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <img
        src={isDark ? '/backgrounds/macos26-dark.webp' : '/backgrounds/macos26-light.webp'}
        alt=""
        draggable={false}
        width={3024}
        height={1964}
        decoding="async"
        fetchPriority="high"
        data-theme={isDark ? 'dark' : 'light'}
        className="wallpaper-art"
      />
      <div className="wallpaper-overlay" />
    </div>
  );
}
