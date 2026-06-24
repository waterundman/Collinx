import { useContext } from 'react';
import { SettingsContext } from '../contexts/SettingsContext';
import type { SettingsContextValue } from '../contexts/SettingsContext';
import type { AppSettings, SettingsCategory } from '../types/settings';

/** useSettings钩子，用于访问设置状态和方法 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

/** 获取单个类别设置的钩子 */
export function useSettingCategory<K extends SettingsCategory>(
  category: K
): AppSettings[K] {
  const { settings } = useSettings();
  return settings[category];
}

export default useSettings;
