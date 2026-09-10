import React, { useState, useCallback, useEffect } from 'react';
import { useI18n } from '../../i18n/hooks';
import styles from './AudioMidiSettings.module.css';

/** 设备类型 */
export type DeviceType = 'audio' | 'midi';

/** 设备方向 */
export type DeviceDirection = 'input' | 'output';

/** 设备信息 */
export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
  isDefault?: boolean;
  isAvailable?: boolean;
}

export interface DeviceSelectorProps {
  /** 设备类型 */
  deviceType: DeviceType;
  /** 设备方向 */
  direction: DeviceDirection;
  /** 当前选中的设备ID */
  value: string;
  /** 设备列表 */
  devices?: DeviceInfo[];
  /** 选择变更回调 */
  onChange: (deviceId: string) => void;
  /** 刷新设备列表回调 */
  onRefresh?: () => Promise<void>;
  /** 自定义类名 */
  className?: string;
}

// v1.23.0 Stage 1 (D2-3): the fake-device filler (initial state + refresh
// path) has been removed. Without `externalDevices` the selector now renders
// an empty state ("no devices detected") and a refresh keeps the list empty
// rather than repopulating with fake entries. The SettingsPage is not yet
// routed into the App (only SettingsProvider lives in main.tsx), so this only
// tightens the bare-component API; routing is out of scope for S1.

/**
 * 设备选择器组件
 * 用于选择音频或MIDI设备
 */
export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  deviceType,
  direction,
  value,
  devices: externalDevices,
  onChange,
  onRefresh,
  className,
}) => {
  const { t } = useI18n();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>(
    externalDevices ?? []
  );

  // 当外部设备列表更新时同步
  useEffect(() => {
    setDevices(externalDevices ?? []);
  }, [externalDevices]);

  // 处理刷新
  const handleRefresh = useCallback(async () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
        // v1.23.0: no mock repopulation. If the host wired externalDevices via
        // props, the useEffect above syncs the new list; otherwise the panel
        // stays in the empty state (no fake devices).
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [onRefresh, isRefreshing]);

  // 获取设备状态文本
  const getDeviceStatus = useCallback((device: DeviceInfo): string => {
    if (!device.isAvailable) return t('settings.device.unavailable') || '不可用';
    if (device.isDefault) return t('settings.device.default') || '默认';
    return t('settings.device.connected') || '已连接';
  }, [t]);

  // 获取设备状态样式
  const getStatusDotClass = useCallback((device: DeviceInfo): string => {
    if (!device.isAvailable) return `${styles.statusDot} ${styles.statusDotError}`;
    return styles.statusDot;
  }, []);

  // 找到当前选中的设备
  const selectedDevice = devices.find(d => d.id === value);
  const isDeviceAvailable = selectedDevice?.isAvailable !== false;

  const label = deviceType === 'audio'
    ? (direction === 'input'
      ? t('settings.audio.inputDevice') || '输入设备'
      : t('settings.audio.outputDevice') || '输出设备')
    : (direction === 'input'
      ? t('settings.midi.inputDevice') || 'MIDI输入设备'
      : t('settings.midi.outputDevice') || 'MIDI输出设备');

  return (
    <div className={`${styles.deviceSelector} ${className ?? ''}`}>
      <div className={styles.deviceHeader}>
        <span className={styles.deviceLabel}>{label}</span>
        <div className={styles.deviceStatus}>
          <span className={getStatusDotClass(selectedDevice || { id: '', name: '' })} />
          <span>
            {selectedDevice
              ? getDeviceStatus(selectedDevice)
              : t('settings.device.notSelected') || '未选择'}
          </span>
        </div>
      </div>

      {devices.length === 0 ? (
        <div
          className={styles.deviceEmpty}
          data-testid="device-empty-state"
        >
          {t('settings.device.empty')}
        </div>
      ) : (
        <select
          className={styles.deviceSelect}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id} disabled={!device.isAvailable}>
              {device.name}
              {device.manufacturer ? ` (${device.manufacturer})` : ''}
              {device.isDefault ? ' - 默认' : ''}
              {!device.isAvailable ? ' - 不可用' : ''}
            </option>
          ))}
        </select>
      )}

      {onRefresh && (
        <button
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <svg
            className={`${styles.refreshIcon} ${isRefreshing ? styles.refreshIconSpinning : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {isRefreshing
            ? t('settings.device.refreshing') || '刷新中...'
            : t('settings.device.refresh') || '刷新设备'}
        </button>
      )}
    </div>
  );
};

export default DeviceSelector;
