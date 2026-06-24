import React, { useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useSettings } from '../hooks/useSettings';
import type { GeneralSettings } from '../types/settings';

import '../styles/themes/light.css';
import '../styles/themes/dark.css';

type ThemeMode = GeneralSettings['theme'];

export interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
}

export const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { settings, updateCategory } = useSettings();
  const themeMode = settings.general.theme;

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      updateCategory('general', { theme: mode });
    },
    [updateCategory]
  );

  useEffect(() => {
    const resolved = resolveTheme(themeMode);
    applyTheme(resolved);

    if (themeMode !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      applyTheme(e.matches ? 'dark' : 'light');
    };

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      resolvedTheme: resolveTheme(themeMode),
      setTheme,
    }),
    [themeMode, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export default ThemeProvider;
