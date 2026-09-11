import { useCallback, useEffect, useState } from 'react';
import type { EnumerationResult } from '../services/device-enumeration';

/** 初始空状态（枚举完成前） */
const EMPTY_RESULT: EnumerationResult = {
  input: [],
  output: [],
  permission: 'unavailable',
};

export interface DeviceEnumerationState {
  /** 输入设备列表 */
  input: EnumerationResult['input'];
  /** 输出设备列表 */
  output: EnumerationResult['output'];
  /** 权限三态 */
  permission: EnumerationResult['permission'];
  /** 手动刷新（重新枚举） */
  refresh: () => Promise<void>;
}

/**
 * 设备枚举 hook (v1.24.0 Stage 0 / D2-3, D2-4)
 *
 * 挂载时枚举一次设备，暴露 refresh 供刷新按钮重新枚举。
 * enumerate 为纯函数（来自 services/device-enumeration），不 throw。
 */
export function useDeviceEnumeration(
  enumerate: () => Promise<EnumerationResult>
): DeviceEnumerationState {
  const [result, setResult] = useState<EnumerationResult>(EMPTY_RESULT);

  const refresh = useCallback(async () => {
    const next = await enumerate();
    setResult(next);
  }, [enumerate]);

  useEffect(() => {
    let active = true;
    enumerate()
      .then((next) => {
        if (active) {
          setResult(next);
        }
      })
      .catch(() => {
        // service 层保证不 throw；此处仅防御组件卸载后的状态更新
      });
    return () => {
      active = false;
    };
  }, [enumerate]);

  return {
    input: result.input,
    output: result.output,
    permission: result.permission,
    refresh,
  };
}
