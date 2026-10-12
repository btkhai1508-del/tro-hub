import React from 'react';

export function Background() {
  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-[#fdfcfb] dark:bg-[#070b14] transition-colors duration-300">
      {/* Soft pastel blobs in light mode / glowing orbs in dark mode */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-indigo-200/40 dark:bg-indigo-600/15 blur-[100px] md:blur-[140px] mix-blend-multiply dark:mix-blend-screen opacity-70 animate-pulse duration-[10000ms]" />
      <div className="absolute top-[20%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-rose-200/40 dark:bg-purple-600/12 blur-[100px] md:blur-[140px] mix-blend-multiply dark:mix-blend-screen opacity-60" />
      <div className="absolute bottom-[-10%] left-[20%] w-[60vw] h-[60vw] rounded-full bg-blue-100/50 dark:bg-blue-600/15 blur-[100px] md:blur-[140px] mix-blend-multiply dark:mix-blend-screen opacity-70" />
      
      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
    </div>
  );
}
