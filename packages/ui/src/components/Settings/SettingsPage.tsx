import React, { useState, useCallback } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import type { SettingsCategory, AppSettings } from '../../types/settings';
import { SettingsSearch } from './SettingsSearch';
import { SettingsNavigation } from './SettingsNavigation';
import { SettingsContent } from './SettingsContent';
import styles from './SettingsPage.module.css';

export interface SettingsPageProps {
  /** 初始选中的分类 */
  initialCategory?: SettingsCategory;
  /** 页面关闭回调 */
  onClose?: () => void;
}

/**
 * 设置页面主组件
 * 提供左侧导航+右侧内容的布局，支持搜索和键盘导航
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({
  initialCategory = 'general',
  onClose,
}) => {
  const { t } = useI18n();
  const { settings, resetAll, updateSettings } = useSettings();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');

  // 处理分类切换
  const handleCategoryChange = useCallback((category: SettingsCategory) => {
    setActiveCategory(category);
  }, []);

  // 处理搜索
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // 处理重置设置
  const handleResetSettings = useCallback(() => {
    const confirmed = window.confirm(t('settings.resetConfirm') || '确定要重置所有设置到默认值吗？此操作不可撤销。');
    if (!confirmed) return;
    try {
      resetAll();
      window.alert(t('settings.resetSuccess') || '设置已重置为默认值。');
    } catch (err) {
      console.error('Failed to reset settings:', err);
      window.alert(t('settings.resetFailed') || '重置设置失败，请重试。');
    }
  }, [t, resetAll]);

  // 处理导入设置
  const handleImportSettings = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Partial<AppSettings>;

        const validKeys: (keyof AppSettings)[] = [
          'general', 'audio', 'midi', 'mixer', 'score', 'agent', 'taste',
        ];
        const hasValidKey = validKeys.some((key) => key in imported);
        if (!hasValidKey) {
          window.alert(t('settings.importInvalid') || '导入的文件格式无效，请选择正确的设置文件。');
          return;
        }

        updateSettings(imported);
        window.alert(t('settings.importSuccess') || '设置导入成功。');
      } catch (err) {
        console.error('Failed to import settings:', err);
        window.alert(t('settings.importFailed') || '导入设置失败，请检查文件格式。');
      }
    };
    input.click();
  }, [t, updateSettings]);

  // 处理导出设置
  const handleExportSettings = useCallback(() => {
    try {
      const json = JSON.stringify(settings, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `collinx-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.alert(t('settings.exportSuccess') || '设置导出成功。');
    } catch (err) {
      console.error('Failed to export settings:', err);
      window.alert(t('settings.exportFailed') || '导出设置失败，请重试。');
    }
  }, [t, settings]);

  // 处理键盘快捷键
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className={styles.container}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label={t('settings.title')}
      aria-modal="true"
    >
      {/* 侧边栏 */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>{t('settings.title')}</h1>
        </div>

        {/* 搜索 */}
        <SettingsSearch
          value={searchQuery}
          onChange={handleSearchChange}
          autoFocus
        />

        {/* 导航 */}
        <SettingsNavigation
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          searchFilter={searchQuery}
        />

        {/* 侧边栏底部操作 */}
        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterActions}>
            <button
              type="button"
              className={styles.sidebarFooterButton}
              onClick={handleResetSettings}
              title={t('settings.reset')}
            >
              {t('common.reset')}
            </button>
            <button
              type="button"
              className={styles.sidebarFooterButton}
              onClick={handleImportSettings}
              title={t('settings.import')}
            >
              {t('common.import')}
            </button>
            <button
              type="button"
              className={styles.sidebarFooterButton}
              onClick={handleExportSettings}
              title={t('settings.export')}
            >
              {t('common.export')}
            </button>
          </div>
        </div>
      </aside>

      {/* 内容区域 */}
      <SettingsContent activeCategory={activeCategory} />
    </div>
  );
};

export default SettingsPage;