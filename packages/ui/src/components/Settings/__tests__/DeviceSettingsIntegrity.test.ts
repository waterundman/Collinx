/**
 * S0-T09 (non-critical): 完整性守卫
 * 1. i18n en/zh 的 settings.device 块递归键对称（missing:[]）
 * 2. AudioSettings / MidiSettings 假刷新零残留（grep setTimeout 零命中，
 *    同时守卫模拟用的 console.log 残留）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const uiSrc = join(__dirname, '..', '..', '..');

const en = JSON.parse(
  readFileSync(join(uiSrc, 'i18n', 'locales', 'en.json'), 'utf-8')
);
const zh = JSON.parse(
  readFileSync(join(uiSrc, 'i18n', 'locales', 'zh-CN.json'), 'utf-8')
);

/** 递归对比 a 相对 b 缺失的叶子键路径 */
function missingKeys(a: unknown, b: unknown, prefix = ''): string[] {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === undefined ? [prefix] : [];
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return a === undefined ? [prefix] : [];
  }
  const missing: string[] = [];
  for (const key of Object.keys(a as Record<string, unknown>)) {
    missing.push(
      ...missingKeys(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key
      )
    );
  }
  return missing;
}

describe('S0-T09: i18n 对称 + 假刷新零残留', () => {
  it('settings.device 块 en/zh 递归对称 — missing:[] (non-critical)', () => {
    const deviceEn = (en.settings as Record<string, unknown>).device;
    const deviceZh = (zh.settings as Record<string, unknown>).device;

    expect(missingKeys(deviceEn, deviceZh)).toEqual([]);
    expect(missingKeys(deviceZh, deviceEn)).toEqual([]);

    // 新键嵌套于 settings.device 内（非顶层 flat key），且两侧均有值
    for (const key of ['permissionDenied', 'unavailableApi']) {
      expect(typeof (deviceEn as Record<string, unknown>)[key]).toBe('string');
      expect(typeof (deviceZh as Record<string, unknown>)[key]).toBe('string');
    }
  });

  it('AudioSettings / MidiSettings 无 setTimeout / 假刷新 console.log 残留 (non-critical)', () => {
    const files = [
      join(uiSrc, 'components', 'Settings', 'AudioSettings.tsx'),
      join(uiSrc, 'components', 'Settings', 'MidiSettings.tsx'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      expect(source.match(/setTimeout/g), `${file}: setTimeout 残留`).toBeNull();
      expect(
        source.match(/devices refreshed/g),
        `${file}: 假刷新 console.log 残留`
      ).toBeNull();
      // 接线必需：真实枚举已引入
      expect(source).toMatch(/device-enumeration/);
      expect(source).toMatch(/useDeviceEnumeration/);
    }
  });
});
