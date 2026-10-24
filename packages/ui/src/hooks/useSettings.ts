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

/**
 * 可选上下文版本（v2.9.3）。
 *
 * `ProjectProvider` 需要读自动保存/撤销设置，但它也可能被单独挂载
 * （store 单测、嵌入式用法）。那种环境下没有 SettingsProvider，
 * 用默认设置即可，不应该抛错。
 */
export function useOptionalSettings(): SettingsContextValue | null {
  return useContext(SettingsContext);
}

/** 获取单个类别设置的钩子 */
export function useSettingCategory<K extends SettingsCategory>(
  category: K
): AppSettings[K] {
  const { settings } = useSettings();
  return settings[category];
}

export default useSettings;
