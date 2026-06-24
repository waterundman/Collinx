import React, { useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/hooks';
import type { SettingsCategory } from '../../types/settings';
import styles from './SettingsPage.module.css';

/** 导航项配置 */
interface NavigationItem {
  key: SettingsCategory;
  labelKey: string;
  icon: React.ReactNode;
}

/** 导航图标组件 */
const NavigationIcons: Record<SettingsCategory, React.ReactNode> = {
  general: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  audio: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  midi: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20" />
      <path d="M5 20V8l5-6 5 6v12" />
      <path d="M19 20V4l-5 6" />
      <path d="M9 12h.01" />
      <path d="M9 16h.01" />
    </svg>
  ),
  mixer: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M15 4v16" />
      <path d="M4 9h16" />
      <path d="M4 15h16" />
    </svg>
  ),
  score: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M8 3v18" />
      <path d="M16 3v18" />
      <path d="M4 3h16" />
      <path d="M4 21h16" />
    </svg>
  ),
  agent: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  ),
  taste: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
};

/** 导航分类配置 */
const NAVIGATION_ITEMS: NavigationItem[] = [
  { key: 'general', labelKey: 'settings.general', icon: NavigationIcons.general },
  { key: 'audio', labelKey: 'settings.audio', icon: NavigationIcons.audio },
  { key: 'midi', labelKey: 'settings.midi', icon: NavigationIcons.midi },
  { key: 'mixer', labelKey: 'settings.mixing', icon: NavigationIcons.mixer },
  { key: 'score', labelKey: 'settings.notation', icon: NavigationIcons.score },
  { key: 'agent', labelKey: 'settings.agent', icon: NavigationIcons.agent },
  { key: 'taste', labelKey: 'settings.taste', icon: NavigationIcons.taste },
];

export interface SettingsNavigationProps {
  /** 当前选中的分类 */
  activeCategory: SettingsCategory;
  /** 分类选择回调 */
  onCategoryChange: (category: SettingsCategory) => void;
  /** 搜索过滤文本 */
  searchFilter?: string;
}

/**
 * 设置导航组件
 * 提供左侧导航菜单，支持键盘导航和搜索过滤
 */
export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({
  activeCategory,
  onCategoryChange,
  searchFilter = '',
}) => {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<SettingsCategory, HTMLButtonElement>>(new Map());

  // 过滤导航项
  const filteredItems = NAVIGATION_ITEMS.filter((item) => {
    if (!searchFilter) return true;
    const label = t(item.labelKey).toLowerCase();
    return label.includes(searchFilter.toLowerCase());
  });

  // 设置导航项引用
  const setItemRef = useCallback(
    (category: SettingsCategory, element: HTMLButtonElement | null) => {
      if (element) {
        itemRefs.current.set(category, element);
      } else {
        itemRefs.current.delete(category);
      }
    },
    []
  );

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = filteredItems.findIndex((item) => item.key === activeCategory);
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          nextIndex = (currentIndex + 1) % filteredItems.length;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          nextIndex = (currentIndex - 1 + filteredItems.length) % filteredItems.length;
          break;
        case 'Home':
          e.preventDefault();
          nextIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          nextIndex = filteredItems.length - 1;
          break;
        default:
          return;
      }

      const nextItem = filteredItems[nextIndex];
      if (nextItem) {
        onCategoryChange(nextItem.key);
        // 聚焦到下一个导航项
        const nextElement = itemRefs.current.get(nextItem.key);
        nextElement?.focus();
      }
    },
    [activeCategory, filteredItems, onCategoryChange]
  );

  // 当活动项改变时，确保它可见
  useEffect(() => {
    const activeElement = itemRefs.current.get(activeCategory);
    if (activeElement && listRef.current) {
      const container = listRef.current;
      const elementRect = activeElement.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeCategory]);

  return (
    <div
      ref={listRef}
      className={styles.navigationList}
      role="listbox"
      aria-label={t('settings.title')}
      onKeyDown={handleKeyDown}
    >
      {filteredItems.map((item) => (
        <button
          key={item.key}
          ref={(el) => setItemRef(item.key, el)}
          className={`${styles.navigationItem} ${
            activeCategory === item.key ? styles.navigationItemActive : ''
          }`}
          onClick={() => onCategoryChange(item.key)}
          role="option"
          aria-selected={activeCategory === item.key}
          tabIndex={activeCategory === item.key ? 0 : -1}
        >
          <span className={styles.navigationIcon}>{item.icon}</span>
          <span className={styles.navigationLabel}>{t(item.labelKey)}</span>
        </button>
      ))}

      {filteredItems.length === 0 && (
        <div className={styles.emptyState} style={{ padding: 'var(--space-4)' }}>
          <p className={styles.emptyStateDescription}>
            {t('common.search')} {t('common.none')}
          </p>
        </div>
      )}
    </div>
  );
};

export default SettingsNavigation;