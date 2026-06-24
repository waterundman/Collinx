import React, { useCallback, useState, useEffect } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import styles from './GeneralSettings.module.css';

/** 预设撤销级别 */
const UNDO_LEVELS = [
  { value: 100, label: '100 步' },
  { value: 200, label: '200 步' },
  { value: 500, label: '500 步' },
  { value: 1000, label: '1000 步' },
] as const;

export interface UndoSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * 撤销设置组件
 * 控制撤销历史的最大级别，支持无限制选项
 */
export const UndoSettings: React.FC<UndoSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { settings, updateCategory } = useSettings();
  const { maxLevels } = settings.general.undoHistory;

  const [isUnlimited, setIsUnlimited] = useState(maxLevels === 'unlimited');
  const [customLevel, setCustomLevel] = useState<number>(
    typeof maxLevels === 'number' ? maxLevels : 500
  );

  // 同步状态
  useEffect(() => {
    if (maxLevels === 'unlimited') {
      setIsUnlimited(true);
    } else {
      setIsUnlimited(false);
      setCustomLevel(maxLevels);
    }
  }, [maxLevels]);

  const handleToggleUnlimited = useCallback(() => {
    const newIsUnlimited = !isUnlimited;
    setIsUnlimited(newIsUnlimited);
    updateCategory('general', {
      undoHistory: {
        maxLevels: newIsUnlimited ? 'unlimited' : customLevel,
      },
    });
  }, [isUnlimited, customLevel, updateCategory]);

  const handleLevelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === 'custom') return;

      const newLevel = parseInt(value, 10);
      setCustomLevel(newLevel);
      if (!isUnlimited) {
        updateCategory('general', {
          undoHistory: { maxLevels: newLevel },
        });
      }
    },
    [isUnlimited, updateCategory]
  );

  const handleCustomLevelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 10 && value <= 10000) {
        setCustomLevel(value);
        if (!isUnlimited) {
          updateCategory('general', {
            undoHistory: { maxLevels: value },
          });
        }
      }
    },
    [isUnlimited, updateCategory]
  );

  return (
    <div className={`${styles.section} ${className ?? ''}`}>
      <h3 className={styles.sectionTitle}>撤销设置</h3>

      {/* 无限制开关 */}
      <div className={styles.settingRow}>
        <div className={styles.settingHeader}>
          <label className={styles.settingLabel}>无限制撤销</label>
        </div>
        <p className={styles.settingDescription}>
          启用后撤销历史将不限制步数，可能占用更多内存
        </p>
        <div className={styles.toggleContainer}>
          <button
            className={`${styles.toggle} ${isUnlimited ? styles.toggleActive : ''}`}
            onClick={handleToggleUnlimited}
            role="switch"
            aria-checked={isUnlimited}
          >
            <div className={styles.toggleKnob} />
          </button>
          <span className={styles.toggleLabel}>
            {isUnlimited ? '无限制' : '有限制'}
          </span>
        </div>
      </div>

      {/* 撤销级别选择 */}
      {!isUnlimited && (
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="undo-level-select">
              撤销级别
            </label>
          </div>
          <p className={styles.settingDescription}>
            设置最大撤销步数，数值越大占用内存越多
          </p>
          <div className={styles.settingControl}>
            <select
              id="undo-level-select"
              className={styles.selectControl}
              value={customLevel}
              onChange={handleLevelChange}
            >
              {UNDO_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
              <option value="custom">自定义...</option>
            </select>
          </div>
        </div>
      )}

      {/* 自定义级别输入 */}
      {!isUnlimited && (
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="undo-custom-level">
              自定义步数
            </label>
          </div>
          <p className={styles.settingDescription}>
            输入自定义撤销步数 (10-10000)
          </p>
          <div className={styles.settingControl}>
            <input
              id="undo-custom-level"
              type="number"
              className={styles.numberInput}
              min={10}
              max={10000}
              value={customLevel}
              onChange={handleCustomLevelChange}
            />
          </div>
        </div>
      )}

      {/* 当前状态 */}
      <div className={styles.settingRow}>
        <div className={styles.statusInfo}>
          <div className={`${styles.statusDot} ${isUnlimited ? '' : styles.statusDotInactive}`} />
          <span className={styles.statusText}>
            当前撤销深度: {isUnlimited ? '无限制' : `${customLevel} 步`}
          </span>
        </div>
      </div>
    </div>
  );
};

export default UndoSettings;
