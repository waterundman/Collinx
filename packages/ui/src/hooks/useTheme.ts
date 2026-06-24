import { useContext } from 'react';
import { ThemeContext } from '../providers/ThemeProvider';
import type { ThemeContextValue } from '../providers/ThemeProvider';

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default useTheme;
