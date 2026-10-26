import React from 'react';
import { useI18n } from '../../i18n/hooks';
import i18n from '../../i18n';
import { useSettings } from '../../hooks/useSettings';
import { ThemeContext } from '../../providers/ThemeProvider';
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
  const { settings, updateSettings } = useSettings();
  // v2.4.0 S5: 主题经 ThemeProvider 生效；其余控件一律写回 settings（localStorage）。
  const themeCtx = React.useContext(ThemeContext);

  const setGeneral = (patch: Partial<typeof settings.general>) =>
    updateSettings({ general: { ...settings.general, ...patch } });

  const handleLanguageChange = (value: string) => {
    setGeneral({ language: value });
    void i18n.changeLanguage(value);
  };

  const handleThemeChange = (value: 'light' | 'dark' | 'system') => {
    setGeneral({ theme: value });
    themeCtx?.setTheme(value);
  };

  const setMixer = (patch: Partial<typeof settings.mixer>) =>
    updateSettings({ mixer: { ...settings.mixer, ...patch } });

  const setScore = (patch: Partial<typeof settings.score>) =>
    updateSettings({ score: { ...settings.score, ...patch } });

  const setTaste = (patch: Partial<typeof settings.taste>) =>
    updateSettings({ taste: { ...settings.taste, ...patch } });

  // 获取分类标题和描述
  const getCategoryInfo = (category: SettingsCategory) => {
    const info: Record<SettingsCategory, { title: string; description: string }> = {
      general: {
        title: t('settings.general.title'),
        description: t('settings.generalDesc'),
      },
      audio: {
        title: t('settings.audio.title'),
        description: t('settings.audioDesc'),
      },
      midi: {
        title: t('settings.midi.title'),
        description: t('settings.midiDesc'),
      },
      mixer: {
        title: t('settings.mixing.title'),
        description: t('settings.mixingDesc'),
      },
      score: {
        title: t('settings.notation.title'),
        description: t('settings.notationDesc'),
      },
      agent: {
        title: t('settings.agent.title'),
        description: t('settings.agentDesc'),
      },
      taste: {
        title: t('settings.taste.title'),
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
            <select
              data-testid="settings-language"
              value={settings.general.language}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
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
            <select
              data-testid="settings-theme"
              value={settings.general.theme}
              onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'system')}
            >
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
              data-testid="settings-default-fx-chain"
              value={settings.mixer.defaultFXChain.join(', ')}
              placeholder={t('settings.mixing.noDefaultFX')}
              onChange={(e) =>
                setMixer({
                  defaultFXChain: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                })
              }
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
                data-testid="settings-loudness-normalization"
                checked={settings.mixer.loudnessNormalization}
                onChange={(e) => setMixer({ loudnessNormalization: e.target.checked })}
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
            <select
              data-testid="settings-score-font"
              value={settings.score.scoreFont}
              onChange={(e) => setScore({ scoreFont: e.target.value })}
            >
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
              data-testid="settings-score-size"
              min="2"
              max="5"
              step="0.1"
              value={settings.score.scoreSize}
              onChange={(e) => setScore({ scoreSize: Number(e.target.value) })}
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
            <select
              data-testid="settings-export-format"
              value={settings.score.exportFormat}
              onChange={(e) => setScore({ exportFormat: e.target.value as 'pdf' | 'musicxml' | 'midi' })}
            >
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
                data-testid="settings-taste-auto-learn"
                checked={settings.taste.autoLearn}
                onChange={(e) => setTaste({ autoLearn: e.target.checked })}
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
                data-testid="settings-taste-ask-confirmation"
                checked={settings.taste.askConfirmation}
                onChange={(e) => setTaste({ askConfirmation: e.target.checked })}
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
                data-testid="settings-taste-project-overlay"
                checked={settings.taste.projectOverlay}
                onChange={(e) => setTaste({ projectOverlay: e.target.checked })}
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
            {/* v3.0.0 S4：去掉 48px 装饰齿轮，空态只留一句话 */}
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