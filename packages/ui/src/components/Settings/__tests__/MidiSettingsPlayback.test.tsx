/**
 * v2.0.0 Stage 2（S2-T18，组件侧）：MidiSettings「播放」section 接线 + i18n 嵌套。
 *
 * 覆盖 D2-5：
 *  - playback.followPlayhead checkbox 渲染并反映 settings 值；切换 → updateSettings
 *    传入的 midi.playback.followPlayhead 随之翻转；
 *  - playback.countInBars select 渲染三档（0/1/2）；切换 → updateSettings 同步；
 *  - 旧 settings 夹具缺 playback 块时回落 DEFAULT_SETTINGS（followPlayhead=true /
 *    countInBars=1）。
 * D2-6：新键嵌套于 top-level `settings.midi` 对象内的 `playback` 子对象，
 *   且 **无** top-level flat key `settings.midi.playback.*`（v1.23 陷阱）；
 *   en/zh 键结构对称。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MidiSettings } from '../MidiSettings';
import { I18nProvider } from '../../../providers/I18nProvider';
import en from '../../../i18n/locales/en.json';
import zh from '../../../i18n/locales/zh-CN.json';

vi.mock('../../../services/device-enumeration', () => ({
  enumerateAudioDevices: vi.fn(),
  enumerateMidiDevices: vi.fn().mockResolvedValue({
    input: [],
    output: [],
    permission: 'unavailable',
  }),
}));

vi.mock('../../../hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '../../../hooks/useSettings';

const mockUseSettings = vi.mocked(useSettings);

function makeSettings(playback?: { followPlayhead: boolean; countInBars: 0 | 1 | 2 }) {
  const updateSettings = vi.fn();
  const settings = {
    audio: {
      audioDevice: { input: '', output: '' },
      sampleRate: 48000,
      bufferSize: 512,
      latency: 0,
    },
    midi: {
      midiDevice: { input: '', output: '' },
      midiMapping: {},
      midiChannel: 1,
      ...(playback ? { playback } : {}),
    },
  };
  mockUseSettings.mockReturnValue({
    settings,
    updateSettings,
    resetCategory: vi.fn(),
  } as unknown as ReturnType<typeof useSettings>);
  return { updateSettings };
}

function renderComponent(element: React.ReactElement): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<I18nProvider>{element}</I18nProvider>);
  });
  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('MidiSettings playback section (S2-T18)', () => {
  it('S2-T18a: 渲染 followPlayhead checkbox + countInBars select，值反映 settings (critical)', () => {
    makeSettings({ followPlayhead: false, countInBars: 2 });
    const { container, cleanup } = renderComponent(<MidiSettings />);

    const checkbox = container.querySelector(
      '[data-testid="playback-follow-playhead"]'
    ) as HTMLInputElement | null;
    const select = container.querySelector(
      '[data-testid="playback-count-in"]'
    ) as HTMLSelectElement | null;
    expect(checkbox).not.toBeNull();
    expect(select).not.toBeNull();

    expect(checkbox!.checked).toBe(false);
    expect(select!.value).toBe('2');
    expect(Array.from(select!.options).map((o) => o.value)).toEqual([
      '0',
      '1',
      '2',
    ]);

    cleanup();
  });

  it('S2-T18b: 勾选 followPlayhead → updateSettings 传入 midi.playback.followPlayhead (critical)', () => {
    const { updateSettings } = makeSettings({ followPlayhead: false, countInBars: 1 });
    const { container, cleanup } = renderComponent(<MidiSettings />);

    const checkbox = container.querySelector(
      '[data-testid="playback-follow-playhead"]'
    ) as HTMLInputElement;
    act(() => {
      checkbox.click();
    });

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings.mock.calls[0][0]).toMatchObject({
      midi: { playback: { followPlayhead: true } },
    });

    cleanup();
  });

  it('S2-T18c: 切换 countInBars → updateSettings 传入 midi.playback.countInBars (critical)', () => {
    const { updateSettings } = makeSettings({ followPlayhead: true, countInBars: 1 });
    const { container, cleanup } = renderComponent(<MidiSettings />);

    const select = container.querySelector(
      '[data-testid="playback-count-in"]'
    ) as HTMLSelectElement;
    act(() => {
      select.value = '0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings.mock.calls[0][0]).toMatchObject({
      midi: { playback: { countInBars: 0 } },
    });

    cleanup();
  });

  it('S2-T18d: 旧 settings 缺 playback 块 → 回落默认值 followPlayhead=true / countInBars=1', () => {
    makeSettings(undefined); // 无 playback
    const { container, cleanup } = renderComponent(<MidiSettings />);

    expect(
      (container.querySelector('[data-testid="playback-follow-playhead"]') as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(
      (container.querySelector('[data-testid="playback-count-in"]') as HTMLSelectElement)
        .value
    ).toBe('1');

    cleanup();
  });
});

describe('i18n settings.midi.playback nesting + symmetry (S2-T18)', () => {
  const enRoot = en as unknown as Record<string, { playback?: Record<string, string> }>;
  const zhRoot = zh as unknown as Record<string, { playback?: Record<string, string> }>;

  it('S2-T18e: playback 键嵌套于 `settings.midi` 对象内，无顶层 flat key', () => {
    // 顶层键 "settings.midi" 是对象，playback 为其子对象（非顶层 dotted flat key）。
    const enMidi = enRoot['settings.midi'];
    const zhMidi = zhRoot['settings.midi'];
    expect(enMidi?.playback).toBeDefined();
    expect(zhMidi?.playback).toBeDefined();

    // 反证：不存在顶层键 "settings.midi.playback.*"（v1.23 陷阱）。
    expect((en as Record<string, unknown>)['settings.midi.playback.followPlayhead']).toBeUndefined();
    expect((zh as Record<string, unknown>)['settings.midi.playback.followPlayhead']).toBeUndefined();

    // 文案已解析（非 raw key）：显式断言嵌套路径取值。
    expect(enMidi!.playback!.followPlayhead).toBe('Follow Playhead');
    expect(zhMidi!.playback!.followPlayhead).toBe('跟随播放头');
  });

  it('S2-T18f: playback 子键 en/zh 结构对称', () => {
    const enKeys = Object.keys(enRoot['settings.midi']!.playback!).sort();
    const zhKeys = Object.keys(zhRoot['settings.midi']!.playback!).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys.length).toBeGreaterThan(0);
  });
});
