import React from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import { LanguageSelector } from './LanguageSelector';
import { AutoSaveSettings } from './AutoSaveSettings';
import { UndoSettings } from './UndoSettings';
import { ThemeSelector } from './ThemeSelector';
import styles from './GeneralSettings.module.css';

export interface GeneralSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * 通用设置主组件
 * 包含语言选择、主题设置、自动保存、撤销设置
 */
export const GeneralSettings: React.FC<GeneralSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { resetCategory } = useSettings();

  const handleReset = React.useCallback(() => {
    if (window.confirm('确定要重置所有通用设置为默认值吗？')) {
      resetCategory('general');
      // 重置后刷新页面以应用语言更改
      window.location.reload();
    }
  }, [resetCategory]);

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* 外观设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.appearance', { defaultValue: '外观设置' })}</h3>
        <LanguageSelector />
        <ThemeSelector />
      </div>

      {/* 自动保存设置 */}
      <AutoSaveSettings />

      {/* 撤销设置 */}
      <UndoSettings />

      {/* 重置按钮 */}
      <div className={styles.section}>
        <button onClick={handleReset} className={styles.resetBtn}>
          {t('settings.reset', { defaultValue: '重置通用设置' })}
        </button>
      </div>
    </div>
  );
};

export default GeneralSettings;
