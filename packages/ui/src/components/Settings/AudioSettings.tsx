import React, { useCallback, useMemo } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import { DeviceSelector } from './DeviceSelector';
import styles from './AudioMidiSettings.module.css';

/** 支持的采样率列表 */
const SAMPLE_RATES = [
  { value: 44100, label: '44,100 Hz', description: 'CD音质标准' },
  { value: 48000, label: '48,000 Hz', description: '视频/流媒体标准' },
  { value: 96000, label: '96,000 Hz', description: '高解析度音频' },
  { value: 192000, label: '192,000 Hz', description: '专业录音室级别' },
] as const;

/** 支持的缓冲区大小列表 */
const BUFFER_SIZES = [
  { value: 64, label: '64 样本', latency: '1.5ms' },
  { value: 128, label: '128 样本', latency: '2.9ms' },
  { value: 256, label: '256 样本', latency: '5.8ms' },
  { value: 512, label: '512 样本', latency: '11.6ms' },
  { value: 1024, label: '1,024 样本', latency: '23.2ms' },
  { value: 2048, label: '2,048 样本', latency: '46.4ms' },
] as const;

export interface AudioSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * 音频设置组件
 * 包含音频设备选择、采样率、缓冲区大小、延迟设置
 */
export const AudioSettings: React.FC<AudioSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { settings, updateSettings, resetCategory } = useSettings();
  const { audio } = settings;

  // 计算当前延迟
  const calculatedLatency = useMemo(() => {
    const latencyMs = (audio.bufferSize / audio.sampleRate) * 1000;
    return latencyMs.toFixed(1);
  }, [audio.bufferSize, audio.sampleRate]);

  // 判断延迟是否良好（< 10ms为良好）
  const isLatencyGood = useMemo(() => {
    return parseFloat(calculatedLatency) < 10;
  }, [calculatedLatency]);

  // 处理输入设备变更
  const handleInputChange = useCallback((deviceId: string) => {
    updateSettings({
      audio: {
        ...audio,
        audioDevice: { ...audio.audioDevice, input: deviceId },
      },
    });
  }, [audio, updateSettings]);

  // 处理输出设备变更
  const handleOutputChange = useCallback((deviceId: string) => {
    updateSettings({
      audio: {
        ...audio,
        audioDevice: { ...audio.audioDevice, output: deviceId },
      },
    });
  }, [audio, updateSettings]);

  // 处理采样率变更
  const handleSampleRateChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSampleRate = parseInt(e.target.value, 10);
    updateSettings({
      audio: {
        ...audio,
        sampleRate: newSampleRate,
      },
    });
  }, [audio, updateSettings]);

  // 处理缓冲区大小变更
  const handleBufferSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBufferSize = parseInt(e.target.value, 10);
    updateSettings({
      audio: {
        ...audio,
        bufferSize: newBufferSize,
      },
    });
  }, [audio, updateSettings]);

  // 处理延迟补偿变更
  const handleLatencyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLatency = parseInt(e.target.value, 10);
    updateSettings({
      audio: {
        ...audio,
        latency: isNaN(newLatency) ? 0 : newLatency,
      },
    });
  }, [audio, updateSettings]);

  // 刷新音频设备
  const handleRefreshAudioDevices = useCallback(async () => {
    // 在Web环境中，实际获取音频设备需要使用Web Audio API
    // 这里模拟刷新操作
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('Audio devices refreshed');
  }, []);

  // 重置音频设置
  const handleReset = useCallback(() => {
    if (window.confirm(t('settings.audio.resetConfirm') || '确定要重置所有音频设置为默认值吗？')) {
      resetCategory('audio');
    }
  }, [resetCategory, t]);

  // 获取采样率描述
  const getSampleRateDescription = useCallback((rate: number): string => {
    const found = SAMPLE_RATES.find(r => r.value === rate);
    return found?.description || '';
  }, []);

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* 音频设备选择 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.audio.device') || '音频设备'}</h3>
        
        <DeviceSelector
          deviceType="audio"
          direction="input"
          value={audio.audioDevice.input}
          onChange={handleInputChange}
          onRefresh={handleRefreshAudioDevices}
        />
        
        <DeviceSelector
          deviceType="audio"
          direction="output"
          value={audio.audioDevice.output}
          onChange={handleOutputChange}
          onRefresh={handleRefreshAudioDevices}
        />
      </div>

      {/* 采样率设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.audio.sampleRate') || '采样率'}</h3>
        
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="sampleRate">
              {t('settings.audio.sampleRate') || '采样率'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.audio.sampleRateDesc') || '音频采样率，影响音质和CPU使用率'}
          </p>
          <div className={styles.settingControl}>
            <select
              id="sampleRate"
              className={styles.selectControl}
              value={audio.sampleRate}
              onChange={handleSampleRateChange}
            >
              {SAMPLE_RATES.map((rate) => (
                <option key={rate.value} value={rate.value}>
                  {rate.label} - {rate.description}
                </option>
              ))}
            </select>
          </div>
          {audio.sampleRate && (
            <p className={styles.settingDescription}>
              {getSampleRateDescription(audio.sampleRate)}
            </p>
          )}
        </div>
      </div>

      {/* 缓冲区大小设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.audio.bufferSize') || '缓冲区大小'}</h3>
        
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="bufferSize">
              {t('settings.audio.bufferSize') || '缓冲区大小'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.audio.bufferSizeDesc') || '缓冲区大小，较小的值降低延迟但可能增加CPU负载'}
          </p>
          <div className={styles.settingControl}>
            <select
              id="bufferSize"
              className={styles.selectControl}
              value={audio.bufferSize}
              onChange={handleBufferSizeChange}
            >
              {BUFFER_SIZES.map((size) => (
                <option key={size.value} value={size.value}>
                  {size.label} (~{size.latency})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 延迟信息 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.audio.latency') || '延迟信息'}</h3>
        
        <div className={styles.latencyInfo}>
          <div className={styles.latencyRow}>
            <span className={styles.latencyLabel}>
              {t('settings.audio.estimatedLatency') || '预估延迟'}
            </span>
            <span className={styles.latencyValue}>{calculatedLatency} ms</span>
          </div>
          
          <div className={styles.latencyRow}>
            <span className={styles.latencyLabel}>
              {t('settings.audio.latencyCompensation') || '延迟补偿'}
            </span>
            <span className={styles.latencyValue}>{audio.latency} ms</span>
          </div>
          
          <div className={`${styles.latencyRow} ${isLatencyGood ? styles.latencyGood : styles.latencyWarning}`}>
            <span className={styles.latencyLabel}>
              {isLatencyGood
                ? (t('settings.audio.latencyGood') || '延迟表现良好')
                : (t('settings.audio.latencyHigh') || '延迟较高，可能影响实时演奏')}
            </span>
            <span>{isLatencyGood ? '✓' : '⚠'}</span>
          </div>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="latencyCompensation">
              {t('settings.audio.latencyCompensation') || '延迟补偿 (ms)'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.audio.latencyCompensationDesc') || '手动调整延迟补偿值，用于同步音频和MIDI'}
          </p>
          <div className={styles.settingControl}>
            <input
              id="latencyCompensation"
              type="range"
              min="0"
              max="100"
              value={audio.latency}
              onChange={handleLatencyChange}
              className={styles.selectControl}
              style={{ cursor: 'pointer' }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 'var(--space-1)',
            }}>
              <span className={styles.settingDescription}>0 ms</span>
              <span className={styles.settingDescription}>{audio.latency} ms</span>
              <span className={styles.settingDescription}>100 ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* 重置按钮 */}
      <div className={styles.section}>
        <button onClick={handleReset} className={styles.resetButton}>
          {t('settings.audio.reset') || '重置音频设置'}
        </button>
      </div>
    </div>
  );
};

export default AudioSettings;
