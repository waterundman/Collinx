import React, { useCallback } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import styles from './AgentSettings.module.css';

/** Agent解释详细程度选项 */
const EXPLANATION_LEVELS = [
  { value: 'brief', label: '简洁', description: '仅提供必要信息' },
  { value: 'normal', label: '正常', description: '提供适当详细信息' },
  { value: 'detailed', label: '详细', description: '提供完整解释和上下文' },
] as const;

/** Agent确认模式选项 */
const CONFIRMATION_MODES = [
  { value: 'always', label: '总是确认', description: '所有操作都需要用户确认', badge: 'safe' },
  { value: 'risky', label: '仅危险操作', description: '仅对不可逆操作请求确认', badge: 'warning' },
  { value: 'never', label: '从不确认', description: '自动执行所有操作', badge: 'danger' },
] as const;

export interface AgentSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * Agent设置组件
 * 包含Agent行为、权限、模型等设置
 */
export const AgentSettings: React.FC<AgentSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { settings, updateSettings, resetCategory } = useSettings();
  const { agent } = settings;

  // 处理自动建议变更
  const handleAutoSuggestChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateSettings({
      agent: {
        ...agent,
        autoSuggest: e.target.checked,
      },
    });
  }, [agent, updateSettings]);

  // 处理解释详细程度变更
  const handleExplanationLevelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLevel = e.target.value as 'brief' | 'normal' | 'detailed';
    updateSettings({
      agent: {
        ...agent,
        explanationLevel: newLevel,
      },
    });
  }, [agent, updateSettings]);

  // 处理确认模式变更
  const handleConfirmationModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as 'always' | 'risky' | 'never';
    updateSettings({
      agent: {
        ...agent,
        confirmationMode: newMode,
      },
    });
  }, [agent, updateSettings]);

  // 重置Agent设置
  const handleReset = useCallback(() => {
    if (window.confirm(t('settings.agent.resetConfirm') || '确定要重置所有Agent设置为默认值吗？')) {
      resetCategory('agent');
    }
  }, [resetCategory, t]);

  // 导出设置
  const handleExport = useCallback(() => {
    const agentSettings = JSON.stringify(settings.agent, null, 2);
    const blob = new Blob([agentSettings], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'collinx-agent-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [settings.agent]);

  // 导入设置
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target?.result as string);
            // 验证导入的数据结构
            if (imported && typeof imported === 'object') {
              updateSettings({
                agent: {
                  ...agent,
                  ...imported,
                },
              });
            }
          } catch (error) {
            console.error('Failed to import agent settings:', error);
            alert(t('settings.agent.importError') || '导入设置失败，请检查文件格式');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [agent, updateSettings, t]);

  // 获取确认模式的徽章样式
  const getConfirmationBadgeClass = (mode: string) => {
    switch (mode) {
      case 'always':
        return styles.permissionBadgeSafe;
      case 'risky':
        return styles.permissionBadgeWarning;
      case 'never':
        return styles.permissionBadgeDanger;
      default:
        return '';
    }
  };

  // 获取确认模式的徽章文本
  const getConfirmationBadgeText = (mode: string) => {
    switch (mode) {
      case 'always':
        return '安全';
      case 'risky':
        return '平衡';
      case 'never':
        return '自由';
      default:
        return '';
    }
  };

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* Agent行为设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.agent.behavior') || 'Agent行为'}</h3>
        
        {/* 自动建议 */}
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.agent.autoSuggest') || '自动建议'}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.agent.autoSuggestDesc') || 'Agent自动提供建议和帮助，无需用户主动询问'}
          </p>
          <div className={styles.settingControl}>
            <label className={styles.checkboxControl}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={agent.autoSuggest}
                onChange={handleAutoSuggestChange}
              />
              <span className={styles.checkboxLabel}>{t('settings.agent.enableAutoSuggest') || '启用自动建议'}</span>
            </label>
          </div>
        </div>

        {/* 解释详细程度 */}
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.agent.explanationLevel') || '解释详细程度'}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.agent.explanationLevelDesc') || 'Agent解释的详细程度，影响其响应的详细程度'}
          </p>
          <div className={styles.settingControl}>
            <select
              className={styles.selectControl}
              value={agent.explanationLevel}
              onChange={handleExplanationLevelChange}
            >
              {EXPLANATION_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label} - {level.description}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Agent权限设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.agent.permissions') || 'Agent权限'}</h3>
        
        {/* 确认模式 */}
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.agent.confirmationMode') || '确认模式'}</label>
            <span className={`${styles.permissionBadge} ${getConfirmationBadgeClass(agent.confirmationMode)}`}>
              {getConfirmationBadgeText(agent.confirmationMode)}
            </span>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.agent.confirmationModeDesc') || '何时需要用户确认Agent操作，平衡安全性和便利性'}
          </p>
          <div className={styles.settingControl}>
            <select
              className={styles.selectControl}
              value={agent.confirmationMode}
              onChange={handleConfirmationModeChange}
            >
              {CONFIRMATION_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label} - {mode.description}
                </option>
              ))}
            </select>
          </div>
          {/* 权限说明 */}
          <div className={styles.infoBox}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>当前模式</span>
              <span className={styles.infoValue}>
                {CONFIRMATION_MODES.find(m => m.value === agent.confirmationMode)?.label}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>安全级别</span>
              <span className={styles.infoValue}>
                {getConfirmationBadgeText(agent.confirmationMode)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.agent.actions') || '操作'}</h3>
        
        <div className={styles.actionButtons}>
          <button onClick={handleExport} className={styles.actionButton}>
            <svg className={styles.actionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7,10 12,15 17,10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t('settings.agent.export') || '导出设置'}
          </button>
          
          <button onClick={handleImport} className={styles.actionButton}>
            <svg className={styles.actionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t('settings.agent.import') || '导入设置'}
          </button>
        </div>
      </div>

      {/* 重置按钮 */}
      <div className={styles.section}>
        <button onClick={handleReset} className={styles.resetButton}>
          {t('settings.agent.reset') || '重置Agent设置'}
        </button>
      </div>
    </div>
  );
};

export default AgentSettings;