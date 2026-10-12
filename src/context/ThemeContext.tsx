import React, { createContext, useContext, useState, useEffect } from 'react';
import { storage } from '../lib/storage';
import { isZaloMiniApp } from '../lib/platform';
import { setNavigationBarColor } from 'zmp-sdk/apis';

type ThemeMode = 'auto' | 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (storage.getItem('ecostay_theme_mode') as ThemeMode) || 'auto';
  });

  const [isDark, setIsDark] = useState<boolean>(() => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    // Auto: Real-time clock check (Night from 18:00 to 06:00)
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
  });

  useEffect(() => {
    storage.setItem('ecostay_theme_mode', mode);

    const evaluateTheme = () => {
      let isDarkTheme = false;
      if (mode === 'dark') {
        isDarkTheme = true;
      } else if (mode === 'light') {
        isDarkTheme = false;
      } else {
        // Auto real-time check (Night from 18:00 to 06:00)
        const hour = new Date().getHours();
        isDarkTheme = hour >= 18 || hour < 6;
      }

      setIsDark(isDarkTheme);
      if (isDarkTheme) {
        document.documentElement.classList.add('dark');
        document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('dark');
      }

      // Synchronize Zalo Mini App navigation bar color if inside Zalo
      if (isZaloMiniApp) {
        try {
          setNavigationBarColor({
            color: isDarkTheme ? '#0b0f14' : '#ffffff',
            textColor: isDarkTheme ? 'white' : 'black'
          });
        } catch {
          // Ignore if unsupported in environment
        }
      }
    };

    evaluateTheme();
    const interval = setInterval(evaluateTheme, 30000);
    return () => clearInterval(interval);
  }, [mode]);

  const toggleTheme = () => {
    setMode(prev => {
      if (prev === 'auto') return 'light';
      if (prev === 'light') return 'dark';
      return 'auto';
    });
  };

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
