/**
 * S0-T07/T08: AudioSettings / MidiSettings 真实设备枚举接线测试
 * mock services/device-enumeration 与 hooks/useSettings，验证：
 * - DeviceSelector 渲染真实设备名（非空态）
 * - 点击刷新 → 重新枚举（计数断言），假刷新行为（console.log 模拟）已消失
 * - permission denied / unavailable → 权限提示 + DeviceSelector 空态
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AudioSettings } from '../AudioSettings';
import { MidiSettings } from '../MidiSettings';
import { I18nProvider } from '../../../providers/I18nProvider';
import type { EnumerationResult } from '../../../services/device-enumeration';

vi.mock('../../../services/device-enumeration', () => ({
  enumerateAudioDevices: vi.fn(),
  enumerateMidiDevices: vi.fn(),
}));

vi.mock('../../../hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import {
  enumerateAudioDevices,
  enumerateMidiDevices,
} from '../../../services/device-enumeration';
import { useSettings } from '../../../hooks/useSettings';

const mockEnumerateAudio = vi.mocked(enumerateAudioDevices);
const mockEnumerateMidi = vi.mocked(enumerateMidiDevices);
const mockUseSettings = vi.mocked(useSettings);

function makeSettings() {
  return {
    settings: {
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
      },
    },
    updateSettings: vi.fn(),
    resetCategory: vi.fn(),
  } as unknown as ReturnType<typeof useSettings>;
}

/** 手写 waitFor（无 testing-library）：轮询谓词直到成立或超时 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

interface Harness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderComponent(element: React.ReactElement): Harness {
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
  mockUseSettings.mockImplementation(makeSettings as never);
});

// ── D2-3: AudioSettings 接线 ──
describe('AudioSettings device enumeration wiring (S0-T07)', () => {
  it('S0-T07a: 枚举结果渲染真实设备名（非空态）; 刷新按钮触发重新枚举; 假刷新行为消失 (critical)', async () => {
    mockUseSettings.mockImplementation(makeSettings as never);
    const granted: EnumerationResult = {
      input: [
        { id: 'in-1', name: 'Scarlett 2i2 Input', isDefault: true },
        { id: 'in-2', name: 'Built-in Microphone' },
      ],
      output: [{ id: 'out-1', name: 'System Speakers' }],
      permission: 'granted',
    };
    mockEnumerateAudio.mockResolvedValue(granted);
    const consoleSpy = vi.spyOn(console, 'log');

    const { container, cleanup } = renderComponent(<AudioSettings />);

    // 挂载时枚举一次；等待真实设备名渲染（静态采样率/缓冲区 select 也有
    // option，故不能以 option 数量为信号，须等枚举结果落地）
    await waitFor(() => container.textContent!.includes('Scarlett 2i2 Input'));

    // 空态消失，select 渲染真实设备名
    expect(
      container.querySelector('[data-testid="device-empty-state"]')
    ).toBeNull();
    const optionTexts = Array.from(container.querySelectorAll('option')).map(
      (o) => o.textContent
    );
    // 默认设备带 " - 默认" 后缀，用前缀匹配
    expect(
      optionTexts.some((t) => t!.startsWith('Scarlett 2i2 Input'))
    ).toBe(true);
    expect(optionTexts).toContain('Built-in Microphone');
    expect(optionTexts).toContain('System Speakers');
    expect(mockEnumerateAudio).toHaveBeenCalledTimes(1);

    // 点击第一个刷新按钮 → 重新枚举（计数 1 → 2）
    const refreshButtons = Array.from(
      container.querySelectorAll('button')
    ).filter((b) => b.textContent!.includes('刷新') || b.textContent!.toLowerCase().includes('refresh'));
    expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      refreshButtons[0].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await waitFor(() => mockEnumerateAudio.mock.calls.length >= 2);
    expect(mockEnumerateAudio).toHaveBeenCalledTimes(2);

    // 假刷新行为已消失：无 "Audio devices refreshed" console.log
    expect(
      consoleSpy.mock.calls.some(
        (args) => args[0] === 'Audio devices refreshed'
      )
    ).toBe(false);

    consoleSpy.mockRestore();
    cleanup();
  });
});

// ── D2-4: MidiSettings 接线 ──
describe('MidiSettings device enumeration wiring (S0-T07)', () => {
  it('S0-T07b: 枚举结果渲染真实设备名（非空态）; 刷新按钮触发重新枚举; 假刷新行为消失 (critical)', async () => {
    mockUseSettings.mockImplementation(makeSettings as never);
    const granted: EnumerationResult = {
      input: [{ id: 'p1', name: 'AKM320', manufacturer: 'MIDIPLUS', isAvailable: true }],
      output: [{ id: 'p3', name: 'UM-1 OUT', isAvailable: true }],
      permission: 'granted',
    };
    mockEnumerateMidi.mockResolvedValue(granted);
    const consoleSpy = vi.spyOn(console, 'log');

    const { container, cleanup } = renderComponent(<MidiSettings />);

    // 等待真实设备名渲染（枚举结果落地信号；MidiSettings 静态通道 select
    // 自带 16 个 option，不能以 option 数量为信号）
    await waitFor(() => container.textContent!.includes('AKM320'));

    expect(
      container.querySelector('[data-testid="device-empty-state"]')
    ).toBeNull();
    const optionTexts = Array.from(container.querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(optionTexts).toContain('AKM320 (MIDIPLUS)');
    expect(optionTexts).toContain('UM-1 OUT');
    expect(mockEnumerateMidi).toHaveBeenCalledTimes(1);

    const refreshButtons = Array.from(
      container.querySelectorAll('button')
    ).filter((b) => b.textContent!.includes('刷新') || b.textContent!.toLowerCase().includes('refresh'));
    expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      refreshButtons[0].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await waitFor(() => mockEnumerateMidi.mock.calls.length >= 2);
    expect(mockEnumerateMidi).toHaveBeenCalledTimes(2);

    expect(
      consoleSpy.mock.calls.some((args) => args[0] === 'MIDI devices refreshed')
    ).toBe(false);

    consoleSpy.mockRestore();
    cleanup();
  });
});

// ── D2-3/D2-4: 权限三态 UI ──
describe('Permission state UI (S0-T08)', () => {
  it('S0-T08a: AudioSettings denied → 权限提示 + DeviceSelector 空态 (critical)', async () => {
    mockUseSettings.mockImplementation(makeSettings as never);
    mockEnumerateAudio.mockResolvedValue({
      input: [],
      output: [],
      permission: 'denied',
    });

    const { container, cleanup } = renderComponent(<AudioSettings />);
    // 等待 denied 文案落地（初始 'unavailable' 也会渲染 warning，不能只判存在）
    await waitFor(() => {
      const w = container.querySelector('[data-testid="device-permission-warning"]');
      return w !== null && !w.textContent!.includes('HTTPS');
    });

    // 权限提示文案已解析（非 raw key fallback）
    const warning = container.querySelector('[data-testid="device-permission-warning"]')!;
    expect(warning.textContent).not.toBe('settings.device.permissionDenied');
    expect(warning.textContent!.trim().length).toBeGreaterThan(0);

    // 两处 DeviceSelector 均空态（共 2 个 empty-state）
    const emptyStates = container.querySelectorAll(
      '[data-testid="device-empty-state"]'
    );
    expect(emptyStates.length).toBe(2);

    // denied 不应显示 unavailable 提示
    expect(warning.textContent).not.toContain('HTTPS');

    cleanup();
  });

  it('S0-T08b: AudioSettings unavailable → 不可用提示 + DeviceSelector 空态 (critical)', async () => {
    mockUseSettings.mockImplementation(makeSettings as never);
    mockEnumerateAudio.mockResolvedValue({
      input: [],
      output: [],
      permission: 'unavailable',
    });

    const { container, cleanup } = renderComponent(<AudioSettings />);
    await waitFor(() => {
      const w = container.querySelector('[data-testid="device-permission-warning"]');
      return w !== null && w.textContent!.includes('HTTPS');
    });

    const warning = container.querySelector('[data-testid="device-permission-warning"]')!;
    expect(warning.textContent).not.toBe('settings.device.unavailableApi');
    expect(warning.textContent).toContain('HTTPS');

    expect(
      container.querySelectorAll('[data-testid="device-empty-state"]').length
    ).toBe(2);

    cleanup();
  });

  it('S0-T08c: MidiSettings denied → 权限提示 + DeviceSelector 空态 (critical)', async () => {
    mockUseSettings.mockImplementation(makeSettings as never);
    mockEnumerateMidi.mockResolvedValue({
      input: [],
      output: [],
      permission: 'denied',
    });

    const { container, cleanup } = renderComponent(<MidiSettings />);
    // 等待 denied 文案落地（初始 'unavailable' 也会渲染 warning，不能只判存在）
    await waitFor(() => {
      const w = container.querySelector('[data-testid="device-permission-warning"]');
      return w !== null && !w.textContent!.includes('HTTPS');
    });

    const warning = container.querySelector('[data-testid="device-permission-warning"]')!;
    expect(warning.textContent).not.toBe('settings.device.permissionDenied');
    expect(
      container.querySelectorAll('[data-testid="device-empty-state"]').length
    ).toBe(2);

    cleanup();
  });
});
