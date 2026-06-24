import React from 'react';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../i18n/hooks';
import type { GeneralSettings } from '../../types/settings';
import styles from './ThemeSelector.module.css';

type ThemeMode = GeneralSettings['theme'];

export const ThemeSelector: React.FC = () => {
  const { themeMode, setTheme } = useTheme();
  const { t } = useI18n();

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: t('common.light') },
    { value: 'dark', label: t('common.dark') },
    { value: 'system', label: t('common.auto') },
  ];

  return (
    <div className={styles.container}>
      <label className={styles.label}>{t('common.theme')}</label>
      <div className={styles.options}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            className={`${styles.option} ${themeMode === option.value ? styles.optionActive : ''}`}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSelector;
