import React, { useCallback } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import styles from './GeneralSettings.module.css';

/** 支持的语言列表 */
const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
] as const;

export interface LanguageSelectorProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * 语言选择器组件
 * 支持10+语言，显示中英文名称，实时保存设置
 */
export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ className }) => {
  const { t, changeLanguage, currentLanguage } = useI18n();
  const { settings, updateCategory } = useSettings();

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newLanguage = e.target.value;
      updateCategory('general', { language: newLanguage });
      changeLanguage(newLanguage);
    },
    [updateCategory, changeLanguage]
  );

  return (
    <div className={`${styles.settingRow} ${className ?? ''}`}>
      <div className={styles.settingHeader}>
        <label className={styles.settingLabel} htmlFor="language-select">
          {t('common.language')}
        </label>
      </div>
      <p className={styles.settingDescription}>
        选择界面显示语言 / Select interface language
      </p>
      <div className={styles.settingControl}>
        <select
          id="language-select"
          className={styles.languageSelect}
          value={settings.general.language || currentLanguage}
          onChange={handleLanguageChange}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.native} ({lang.name})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default LanguageSelector;
