import React, { useCallback, useState, useRef } from 'react';
import { useI18n } from '../../i18n/hooks';
import { useSettings } from '../../hooks/useSettings';
import { useDeviceEnumeration } from '../../hooks/useDeviceEnumeration';
import { enumerateMidiDevices } from '../../services/device-enumeration';
import { DEFAULT_SETTINGS } from '../../types/settings';
import type { MidiSettings as MidiSettingsType } from '../../types/settings';
import { DeviceSelector } from './DeviceSelector';
import styles from './AudioMidiSettings.module.css';

export interface MidiSettingsProps {
  /** 自定义类名 */
  className?: string;
}

/**
 * MIDI设置组件
 * 包含MIDI设备选择、MIDI映射管理
 */
export const MidiSettings: React.FC<MidiSettingsProps> = ({ className }) => {
  const { t } = useI18n();
  const { settings, updateSettings, resetCategory } = useSettings();
  const { midi } = settings;
  // v1.26.0 (D2-3): 录入设置块。真实 Provider 经 deepMerge 必有 recording；
  // 兜底默认值以兼容旧 settings 夹具（测试 mock 未含该块时仍可渲染）。
  const recording: MidiSettingsType['recording'] =
    midi.recording ?? DEFAULT_SETTINGS.midi.recording;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理输入设备变更
  const handleInputChange = useCallback((deviceId: string) => {
    updateSettings({
      midi: {
        ...midi,
        midiDevice: { ...midi.midiDevice, input: deviceId },
      },
    });
  }, [midi, updateSettings]);

  // 处理MIDI通道变更
  const handleChannelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const channel = parseInt(e.target.value, 10);
    updateSettings({
      midi: {
        ...midi,
        midiChannel: channel,
      },
    });
  }, [midi, updateSettings]);

  // 处理输出设备变更
  const handleOutputChange = useCallback((deviceId: string) => {
    updateSettings({
      midi: {
        ...midi,
        midiDevice: { ...midi.midiDevice, output: deviceId },
      },
    });
  }, [midi, updateSettings]);

  // v1.26.0 (D2-3): 录入设置变更（与 handleChannelChange 同构）
  const handleQuantizeGridChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const grid = parseFloat(e.target.value);
    updateSettings({
      midi: {
        ...midi,
        recording: { ...recording, quantizeGrid: grid as MidiSettingsType['recording']['quantizeGrid'] },
      },
    });
  }, [midi, recording, updateSettings]);

  const handleVelocityModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = e.target.value;
    updateSettings({
      midi: {
        ...midi,
        recording: { ...recording, velocityMode: mode as MidiSettingsType['recording']['velocityMode'] },
      },
    });
  }, [midi, recording, updateSettings]);

  const handleFixedVelocityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseInt(e.target.value, 10);
    if (Number.isNaN(raw)) return;
    const fixedVelocity = Math.min(127, Math.max(1, raw));
    updateSettings({
      midi: {
        ...midi,
        recording: { ...recording, fixedVelocity },
      },
    });
  }, [midi, recording, updateSettings]);

  // v1.24.0 (D2-4): 真实设备枚举替换假刷新（原定时器模拟已删除）。
  // 挂载时枚举一次，刷新按钮经 refresh 重新枚举。
  // 注意：enumerateMidiDevices 内部调用 requestMIDIAccess，会触发浏览器
  // MIDI 授权弹窗（预期行为）。
  const midiDevices = useDeviceEnumeration(enumerateMidiDevices);
  const handleRefreshMidiDevices = midiDevices.refresh;

  // 导出MIDI映射
  const handleExportMapping = useCallback(() => {
    const mappingData = JSON.stringify(midi.midiMapping, null, 2);
    const blob = new Blob([mappingData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'midi-mapping.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [midi.midiMapping]);

  // 导入MIDI映射
  const handleImportMapping = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 处理文件选择
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = event.target?.result;
        if (typeof result === 'string') {
          const importedMapping = JSON.parse(result);
          // 验证导入的数据格式
          if (typeof importedMapping === 'object' && importedMapping !== null) {
            updateSettings({
              midi: {
                ...midi,
                midiMapping: importedMapping,
              },
            });
            alert(t('settings.midi.importSuccess') || 'MIDI映射导入成功');
          } else {
            alert(t('settings.midi.importError') || '无效的MIDI映射文件格式');
          }
        }
      } catch (error) {
        alert(t('settings.midi.importError') || '导入MIDI映射失败');
      }
    };
    reader.readAsText(file);
    
    // 重置文件输入
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [midi, updateSettings, t]);

  // 重置MIDI映射
  const handleResetMapping = useCallback(() => {
    if (window.confirm(t('settings.midi.resetMappingConfirm') || '确定要重置所有MIDI映射吗？')) {
      updateSettings({
        midi: {
          ...midi,
          midiMapping: {},
        },
      });
    }
  }, [midi, updateSettings, t]);

  // 重置MIDI设置
  const handleReset = useCallback(() => {
    if (window.confirm(t('settings.midi.resetConfirm') || '确定要重置所有MIDI设置为默认值吗？')) {
      resetCategory('midi');
    }
  }, [resetCategory, t]);

  // 获取映射条目列表
  const mappingEntries = Object.entries(midi.midiMapping);

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* MIDI设备选择 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.midi.device') || 'MIDI设备'}</h3>

        {/* D2-4: 权限三态提示（denied/unavailable 时显示；DeviceSelector 既有空态照旧） */}
        {midiDevices.permission === 'denied' && (
          <p className={styles.settingDescription} data-testid="device-permission-warning">
            {t('settings.device.permissionDenied')}
          </p>
        )}
        {midiDevices.permission === 'unavailable' && (
          <p className={styles.settingDescription} data-testid="device-permission-warning">
            {t('settings.device.unavailableApi')}
          </p>
        )}

        <DeviceSelector
          deviceType="midi"
          direction="input"
          value={midi.midiDevice.input}
          devices={midiDevices.input}
          onChange={handleInputChange}
          onRefresh={handleRefreshMidiDevices}
        />

        <DeviceSelector
          deviceType="midi"
          direction="output"
          value={midi.midiDevice.output}
          devices={midiDevices.output}
          onChange={handleOutputChange}
          onRefresh={handleRefreshMidiDevices}
        />
      </div>

      {/* MIDI通道设置 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.midi.channel') || 'MIDI通道'}</h3>
        
        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="midiChannel">
              {t('settings.midi.channel') || 'MIDI通道'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.midi.channelDesc') || '选择MIDI接收/发送的通道 (1-16)'}
          </p>
          <div className={styles.settingControl}>
            <select
              id="midiChannel"
              className={styles.selectControl}
              value={midi.midiChannel}
              onChange={handleChannelChange}
            >
              {Array.from({ length: 16 }, (_, i) => i + 1).map((channel) => (
                <option key={channel} value={channel}>
                  {t('settings.midi.channelNumber', { channel }) || `通道 ${channel}`}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.midi.currentChannel', { channel: midi.midiChannel }) || `当前通道: ${midi.midiChannel}`}
          </p>
        </div>
      </div>

      {/* v1.26.0 (D2-3): 录入设置（量化网格 / 力度模式 / 固定力度） */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.midi.recording.title') || '录入设置'}</h3>

        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="recordingGrid">
              {t('settings.midi.recording.quantizeGrid') || '量化网格'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.midi.recording.quantizeGridDesc') || '将录入音符的落点对齐到所选网格'}
          </p>
          <div className={styles.settingControl}>
            <select
              id="recordingGrid"
              data-testid="recording-grid"
              className={styles.selectControl}
              value={String(recording.quantizeGrid)}
              onChange={handleQuantizeGridChange}
            >
              <option value="0">{t('settings.midi.recording.gridOff') || 'Off'}</option>
              <option value="0.25">{t('settings.midi.recording.gridQuarter') || '1/4 beat'}</option>
              <option value="0.5">{t('settings.midi.recording.gridHalf') || '1/2 beat'}</option>
              <option value="1">{t('settings.midi.recording.gridWhole') || '1 beat'}</option>
            </select>
          </div>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="recordingVelocityMode">
              {t('settings.midi.recording.velocityMode') || '力度模式'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.midi.recording.velocityModeDesc') || '记录实时力度或使用固定力度值'}
          </p>
          <div className={styles.settingControl}>
            <select
              id="recordingVelocityMode"
              data-testid="recording-velocity-mode"
              className={styles.selectControl}
              value={recording.velocityMode}
              onChange={handleVelocityModeChange}
            >
              <option value="live">{t('settings.midi.recording.velocityLive') || 'Live'}</option>
              <option value="fixed">{t('settings.midi.recording.velocityFixed') || 'Fixed'}</option>
            </select>
          </div>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingHeader}>
            <label className={styles.settingLabel} htmlFor="recordingFixedVelocity">
              {t('settings.midi.recording.fixedVelocity') || '固定力度'}
            </label>
          </div>
          <p className={styles.settingDescription}>
            {t('settings.midi.recording.fixedVelocityDesc') || '固定模式使用的力度值 (1-127)'}
          </p>
          <div className={styles.settingControl}>
            <input
              id="recordingFixedVelocity"
              data-testid="recording-fixed-velocity"
              type="number"
              className={styles.selectControl}
              min={1}
              max={127}
              value={recording.fixedVelocity}
              disabled={recording.velocityMode !== 'fixed'}
              onChange={handleFixedVelocityChange}
            />
          </div>
        </div>
      </div>

      {/* MIDI映射管理 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.midi.mapping') || 'MIDI映射'}</h3>
        
        <div className={styles.mappingSection}>
          <p className={styles.settingDescription}>
            {t('settings.midi.mappingDesc') || '管理MIDI控制器到软件参数的映射关系'}
          </p>
          
          <div className={styles.mappingActions}>
            <button
              className={styles.mappingButton}
              onClick={handleImportMapping}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('settings.midi.import') || '导入映射'}
            </button>
            
            <button
              className={styles.mappingButton}
              onClick={handleExportMapping}
              disabled={mappingEntries.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('settings.midi.export') || '导出映射'}
            </button>
            
            <button
              className={styles.mappingButton}
              onClick={handleResetMapping}
              disabled={mappingEntries.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              {t('settings.midi.resetMapping') || '重置映射'}
            </button>
          </div>

          {/* 映射列表 */}
          <div className={styles.mappingList}>
            {mappingEntries.length > 0 ? (
              mappingEntries.map(([source, target], index) => (
                <div key={index} className={styles.mappingItem}>
                  <span className={styles.mappingSource}>{source}</span>
                  <span className={styles.mappingTarget}>{target}</span>
                </div>
              ))
            ) : (
              <div className={styles.mappingEmpty}>
                {t('settings.midi.noMappings') || '暂无MIDI映射配置'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 重置按钮 */}
      <div className={styles.section}>
        <button onClick={handleReset} className={styles.resetButton}>
          {t('settings.midi.reset') || '重置MIDI设置'}
        </button>
      </div>
    </div>
  );
};

export default MidiSettings;
