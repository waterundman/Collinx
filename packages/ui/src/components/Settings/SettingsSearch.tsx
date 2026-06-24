import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/hooks';
import styles from './SettingsPage.module.css';

export interface SettingsSearchProps {
  /** 搜索值 */
  value: string;
  /** 搜索值变化回调 */
  onChange: (value: string) => void;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否自动聚焦 */
  autoFocus?: boolean;
}

/**
 * 设置搜索组件
 * 提供搜索输入框和清除按钮
 */
export const SettingsSearch: React.FC<SettingsSearchProps> = ({
  value,
  onChange,
  placeholder,
  autoFocus = false,
}) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);

  // 同步外部值
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // 处理输入变化
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);
      onChange(newValue);
    },
    [onChange]
  );

  // 清除搜索
  const handleClear = useCallback(() => {
    setLocalValue('');
    onChange('');
    inputRef.current?.focus();
  }, [onChange]);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear();
      }
    },
    [handleClear]
  );

  return (
    <div className={styles.searchContainer}>
      <div className={styles.searchInputWrapper}>
        {/* 搜索图标 */}
        <svg
          className={styles.searchIcon}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>

        {/* 搜索输入框 */}
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t('common.search')}
          autoFocus={autoFocus}
          aria-label={t('common.search')}
        />

        {/* 清除按钮 */}
        {localValue && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={handleClear}
            aria-label={t('common.clear')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default SettingsSearch;