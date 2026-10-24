import React, { useCallback, useState, useEffect } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import styles from './GeneralSettings.module.css';

/**
 * 间隔选项。**value 是秒**（设置字段与 provider 都以秒为准，v2.9.3 统一），
 * label 才是分钟 —— 此前 value 直接写 1/2/5 被当成秒，选「30 分钟」实际是 30 秒。
 */
const INTERVAL_OPTIONS = [
  { value: 60, label: '1 分钟' },
  { value: 120, label: '2 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 1800, label: '30 分钟' },
] as const;

export interface AutoSaveSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * 自动保存设置组件
 * 控制自动保存的开关、间隔时间，显示下次保存时间
 */
export const AutoSaveSettings: React.FC<AutoSaveSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { settings, updateCategory } = useSettings();
  const { enabled, interval } = settings.general.autoSave;

  const [nextSaveTime, setNextSaveTime] = useState<Date | null>(null);

  // 计算下次保存时间
  useEffect(() => {
    if (!enabled) {
      setNextSaveTime(null);
      return;
    }

    const now = new Date();
    const next = new Date(now.getTime() + interval * 1000);
    setNextSaveTime(next);

    const timer = setInterval(() => {
      const currentTime = new Date();
      const nextTime = new Date(currentTime.getTime() + interval * 1000);
      setNextSaveTime(nextTime);
    }, interval * 1000);

    return () => clearInterval(timer);
  }, [enabled, interval]);

  const handleToggle = useCallback(() => {
    updateCategory('general', {
      autoSave: { ...settings.general.autoSave, enabled: !enabled },
    });
  }, [enabled, settings.general.autoSave, updateCategory]);

  const handleIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newInterval = parseInt(e.target.value, 10);
      updateCategory('general', {
        autoSave: { ...settings.general.autoSave, interval: newInterval },
      });
    },
    [settings.general.autoSave, updateCategory]
  );

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`${styles.section} ${className ?? ''}`}>
      <h3 className={styles.sectionTitle}>{t('settings.general.autoSave', { defaultValue: '自动保存' })}</h3>

      {/* 自动保存开关 */}
      <div className={styles.settingRow}>
        <div className={styles.settingHeader}>
          <label className={styles.settingLabel}>自动保存</label>
        </div>
        <p className={styles.settingDescription}>
          定期自动保存工程文件，防止数据丢失
        </p>
        <div className={styles.toggleContainer}>
          <button
            className={`${styles.toggle} ${enabled ? styles.toggleActive : ''}`}
            onClick={handleToggle}
            role="switch"
            aria-checked={enabled}
          >
            <div className={styles.toggleKnob} />
          </button>
          <span className={styles.toggleLabel}>
            {enabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      {/* 保存间隔 */}
      {enabled && (
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="autosave-interval">
              保存间隔
            </label>
          </div>
          <p className={styles.settingDescription}>
            设置自动保存的时间间隔
          </p>
          <div className={styles.settingControl}>
            <select
              id="autosave-interval"
              className={styles.selectControl}
              value={interval}
              onChange={handleIntervalChange}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 下次保存时间 */}
      {enabled && nextSaveTime && (
        <div className={styles.settingRow}>
          <div className={styles.statusInfo}>
            <div className={styles.statusDot} />
            <span className={styles.statusText}>
              下次保存: {formatTime(nextSaveTime)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoSaveSettings;
