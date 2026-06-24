import React from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import type { SettingsCategory } from '../../types/settings';
import { AudioSettings } from './AudioSettings';
import { MidiSettings } from './MidiSettings';
import { AgentSettings } from './AgentSettings';
import styles from './SettingsPage.module.css';

export interface SettingsContentProps {
  /** 当前选中的分类 */
  activeCategory: SettingsCategory;
}

/**
 * 设置内容组件
 * 根据选中的分类显示相应的设置内容
 */
export const SettingsContent: React.FC<SettingsContentProps> = ({
  activeCategory,
}) => {
  const { t } = useI18n();
  const { settings } = useSettings();

  // 获取分类标题和描述
  const getCategoryInfo = (category: SettingsCategory) => {
    const info: Record<SettingsCategory, { title: string; description: string }> = {
      general: {
        title: t('settings.general'),
        description: t('settings.generalDesc'),
      },
      audio: {
        title: t('settings.audio'),
        description: t('settings.audioDesc'),
      },
      midi: {
        title: t('settings.midi'),
        description: t('settings.midiDesc'),
      },
      mixer: {
        title: t('settings.mixing'),
        description: t('settings.mixingDesc'),
      },
      score: {
        title: t('settings.notation'),
        description: t('settings.notationDesc'),
      },
      agent: {
        title: t('settings.agent'),
        description: t('settings.agentDesc'),
      },
      taste: {
        title: t('settings.taste'),
        description: t('settings.tasteDesc'),
      },
    };
    return info[category];
  };

  // 渲染通用设置
  const renderGeneralSettings = () => (
    <div className={styles.settingsSection}>
      <h3 className={styles.sectionTitle}>{t('settings.appearance')}</h3>
      <div className={styles.settingsGroup}>
        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('common.language')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.general.languageDesc')}
          </p>
          <div className={styles.settingControl}>
            {/* 语言选择器将由ThemeSelector组件处理 */}
            <select defaultValue={settings.general.language}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('common.theme')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.general.themeDesc')}
          </p>
          <div className={styles.settingControl}>
            {/* 主题选择器将由ThemeSelector组件处理 */}
            <select defaultValue={settings.general.theme}>
              <option value="light">{t('common.light')}</option>
              <option value="dark">{t('common.dark')}</option>
              <option value="system">{t('common.auto')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染音频设置
  const renderAudioSettings = () => <AudioSettings />;

  // 渲染MIDI设置
  const renderMidiSettings = () => <MidiSettings />;

  // 渲染混音设置
  const renderMixerSettings = () => (
    <div className={styles.settingsSection}>
      <h3 className={styles.sectionTitle}>{t('settings.mixing.title')}</h3>
      <div className={styles.settingsGroup}>
        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.mixing.effectChain')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.mixing.effectChainDesc')}
          </p>
          <div className={styles.settingControl}>
            <input
              type="text"
              defaultValue={settings.mixer.defaultFXChain.join(', ')}
              placeholder={t('settings.mixing.noDefaultFX')}
            />
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.mixing.loudnessNormalization')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.mixing.loudnessNormalizationDesc')}
          </p>
          <div className={styles.settingControl}>
            <label>
              <input
                type="checkbox"
                defaultChecked={settings.mixer.loudnessNormalization}
              />
              {' '}{t('settings.mixing.enableLoudnessNormalization')}
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染记谱设置
  const renderScoreSettings = () => (
    <div className={styles.settingsSection}>
      <h3 className={styles.sectionTitle}>{t('settings.notation.display')}</h3>
      <div className={styles.settingsGroup}>
        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.notation.font')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.notation.fontDesc')}
          </p>
          <div className={styles.settingControl}>
            <select defaultValue={settings.score.scoreFont}>
              <option value="Bravura">Bravura</option>
              <option value="Petaluma">Petaluma</option>
              <option value="Leland">Leland</option>
            </select>
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.notation.size')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.notation.sizeDesc')}
          </p>
          <div className={styles.settingControl}>
            <input
              type="range"
              min="2"
              max="5"
              step="0.1"
              defaultValue={settings.score.scoreSize}
            />
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.notation.exportFormat')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.notation.exportFormatDesc')}
          </p>
          <div className={styles.settingControl}>
            <select defaultValue={settings.score.exportFormat}>
              <option value="pdf">PDF</option>
              <option value="musicxml">MusicXML</option>
              <option value="midi">MIDI</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染Agent设置
  const renderAgentSettings = () => <AgentSettings />;

  // 渲染Taste设置
  const renderTasteSettings = () => (
    <div className={styles.settingsSection}>
      <h3 className={styles.sectionTitle}>{t('settings.taste.title')}</h3>
      <div className={styles.settingsGroup}>
        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.taste.autoLearn')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.taste.autoLearnDesc')}
          </p>
          <div className={styles.settingControl}>
            <label>
              <input
                type="checkbox"
                defaultChecked={settings.taste.autoLearn}
              />
              {' '}{t('settings.taste.enableAutoLearn')}
            </label>
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.taste.askConfirmation')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.taste.askConfirmationDesc')}
          </p>
          <div className={styles.settingControl}>
            <label>
              <input
                type="checkbox"
                defaultChecked={settings.taste.askConfirmation}
              />
              {' '}{t('settings.taste.enableAskConfirmation')}
            </label>
          </div>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel}>{t('settings.taste.projectOverlay')}</label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.taste.projectOverlayDesc')}
          </p>
          <div className={styles.settingControl}>
            <label>
              <input
                type="checkbox"
                defaultChecked={settings.taste.projectOverlay}
              />
              {' '}{t('settings.taste.enableProjectOverlay')}
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  // 根据分类渲染内容
  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return renderGeneralSettings();
      case 'audio':
        return renderAudioSettings();
      case 'midi':
        return renderMidiSettings();
      case 'mixer':
        return renderMixerSettings();
      case 'score':
        return renderScoreSettings();
      case 'agent':
        return renderAgentSettings();
      case 'taste':
        return renderTasteSettings();
      default:
        return (
          <div className={styles.emptyState}>
            <svg
              className={styles.emptyStateIcon}
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h3 className={styles.emptyStateTitle}>{t('settings.title')}</h3>
            <p className={styles.emptyStateDescription}>
              {t('settings.selectCategory')}
            </p>
          </div>
        );
    }
  };

  const categoryInfo = getCategoryInfo(activeCategory);

  return (
    <div className={styles.content}>
      <div className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>{categoryInfo.title}</h2>
        <p className={styles.contentDescription}>{categoryInfo.description}</p>
      </div>
      <div className={styles.contentBody}>
        {renderContent()}
      </div>
    </div>
  );
};

export default SettingsContent;