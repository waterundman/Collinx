import React, { createContext, useState, useCallback, useEffect, useMemo } from 'react';
import type {
  AppSettings,
  SettingsCategory,
  PartialSettings,
} from '../types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../types/settings';

/** SettingsContext接口 */
export interface SettingsContextValue {
  /** 完整设置对象 */
  settings: AppSettings;
  /** 更新单个类别设置 */
  updateCategory: <K extends SettingsCategory>(
    category: K,
    partial: Partial<AppSettings[K]>
  ) => void;
  /** 批量更新多个类别 */
  updateSettings: (partial: PartialSettings) => void;
  /** 重置单个类别到默认值 */
  resetCategory: (category: SettingsCategory) => void;
  /** 重置所有设置到默认值 */
  resetAll: () => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

/** 深度合并对象 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result: Record<string, any> = { ...target };
  for (const key in source) {
    if (
      source[key] !== undefined &&
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(
        (target[key] ?? {}) as Record<string, any>,
        (source[key] ?? {}) as Record<string, any>
      );
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result as T;
}

/** 从localStorage加载设置 */
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as PartialSettings;
      const settings: AppSettings = { ...DEFAULT_SETTINGS };
      if (parsed.general) settings.general = deepMerge(settings.general, parsed.general);
      if (parsed.audio) settings.audio = deepMerge(settings.audio, parsed.audio);
      if (parsed.midi) settings.midi = deepMerge(settings.midi, parsed.midi);
      if (parsed.mixer) settings.mixer = deepMerge(settings.mixer, parsed.mixer);
      if (parsed.score) settings.score = deepMerge(settings.score, parsed.score);
      if (parsed.agent) settings.agent = deepMerge(settings.agent, parsed.agent);
      if (parsed.taste) settings.taste = deepMerge(settings.taste, parsed.taste);
      return settings;
    }
  } catch {
    console.warn('Failed to load settings from localStorage');
  }
  return { ...DEFAULT_SETTINGS };
}

/** 保存设置到localStorage */
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Failed to save settings to localStorage');
  }
}

interface SettingsProviderProps {
  children: React.ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateCategory = useCallback(
    <K extends SettingsCategory>(category: K, partial: Partial<AppSettings[K]>) => {
      setSettings((prev) => ({
        ...prev,
        [category]: deepMerge(prev[category], partial),
      }));
    },
    []
  );

  const updateSettings = useCallback((partial: PartialSettings) => {
    setSettings((prev) => {
      const next = { ...prev };
      for (const category of Object.keys(partial) as SettingsCategory[]) {
        if (partial[category]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          next[category] = deepMerge(prev[category] as any, partial[category] as any);
        }
      }
      return next;
    });
  }, []);

  const resetCategory = useCallback((category: SettingsCategory) => {
    setSettings((prev) => ({
      ...prev,
      [category]: { ...DEFAULT_SETTINGS[category] },
    }));
  }, []);

  const resetAll = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      updateCategory,
      updateSettings,
      resetCategory,
      resetAll,
    }),
    [settings, updateCategory, updateSettings, resetCategory, resetAll]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export default SettingsProvider;
