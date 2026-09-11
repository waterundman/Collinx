/**
 * S0-T03~T06: useMidiInput hook 单测
 * mock navigator.requestMIDIAccess（vi.stubGlobal）与 useSettings
 * （vi.mock，沿用 v1.24 DeviceSettingsWiring 模式），验证绑定、
 * 直调 handler 分发、不绑定守卫、清理与重绑、reject 静默与 statechange。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMidiInput, type UseMidiInputOptions } from '../useMidiInput';

vi.mock('../useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '../useSettings';

const mockUseSettings = vi.mocked(useSettings);

interface MockPort {
  id: string;
  state: string;
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

interface MockAccess {
  inputs: { values(): Iterable<MockPort> };
  onstatechange: (() => void) | null;
}

function makeMockPort(id: string): MockPort {
  return { id, state: 'connected', onmidimessage: null };
}

function makeMockAccess(ports: MockPort[]): MockAccess {
  const map = new Map(ports.map((p) => [p.id, p] as const));
  return { inputs: { values: () => map.values() }, onstatechange: null };
}

/** 手写 flush（无 testing-library）：microtask + macrotask 双清 */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

interface Harness {
  rerender: (deviceId: string, enabled?: boolean) => void;
  unmount: () => void;
}

function renderHookHarness(
  options: Omit<UseMidiInputOptions, 'enabled'> & { enabled?: boolean },
  deviceId: string
): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  // 闭包 props：rerender 时更新，Harness 重读
  const current = {
    enabled: options.enabled ?? true,
    onNoteOn: options.onNoteOn,
    onNoteOff: options.onNoteOff,
  };

  const applySettings = (devId: string) => {
    mockUseSettings.mockImplementation(
      () =>
        ({
          settings: {
            midi: { midiDevice: { input: devId, output: '' } },
          },
        }) as unknown as ReturnType<typeof useSettings>
    );
  };

  function Harness() {
    useMidiInput({
      enabled: current.enabled,
      onNoteOn: current.onNoteOn,
      onNoteOff: current.onNoteOff,
    });
    return null;
  }

  act(() => {
    applySettings(deviceId);
    root = createRoot(container);
    root.render(React.createElement(Harness));
  });

  return {
    rerender(devId: string, enabled = true) {
      act(() => {
        applySettings(devId);
        current.enabled = enabled;
        root.render(React.createElement(Harness));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── D1-2: useMidiInput ──
describe('useMidiInput (S0-T03~T06)', () => {
  it('S0-T03: deviceId 匹配 → onmidimessage 绑定; 直调 handler → onNoteOn(60,100) (critical)', async () => {
    const onNoteOn = vi.fn();
    const port1 = makeMockPort('dev-1');
    const access = makeMockAccess([port1]);
    const requestMIDIAccess = vi.fn().mockResolvedValue(access);
    vi.stubGlobal('navigator', { requestMIDIAccess });

    const h = renderHookHarness({ onNoteOn }, 'dev-1');
    await flush();

    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(port1.onmidimessage).toBeTypeOf('function');

    // 直调 handler（伪造 MIDIMessageEvent.data，无 timeStamp → 走兜底路径）
    (port1.onmidimessage as (e: { data: Uint8Array }) => void)({
      data: new Uint8Array([0x90, 0x3c, 0x64]),
    });
    expect(onNoteOn).toHaveBeenCalledWith(60, 100, expect.any(Number));

    h.unmount();
  });

  it('S0-T04: 空 deviceId / enabled=false / 无匹配端口 → 不绑定、不 throw (critical)', async () => {
    const requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(makeMockAccess([makeMockPort('dev-1')]));
    vi.stubGlobal('navigator', { requestMIDIAccess });

    // 空 deviceId：不发起授权请求
    const h1 = renderHookHarness({}, '');
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    h1.unmount();

    // enabled=false：不发起授权请求
    const h2 = renderHookHarness({ enabled: false }, 'dev-1');
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    h2.unmount();

    // inputs 无匹配端口：请求发出但目标 port 保持未绑定
    const h3 = renderHookHarness({}, 'dev-404');
    await flush();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    const access = await (
      requestMIDIAccess.mock.results[0]!.value as Promise<MockAccess>
    );
    const [onlyPort] = Array.from(access.inputs.values());
    expect(onlyPort.onmidimessage).toBeNull();
    h3.unmount();
  });

  it('S0-T05: unmount → 解绑; deviceId 变更 → 旧 port 解绑 + 新 port 绑定 (critical)', async () => {
    const port1 = makeMockPort('dev-1');
    const port2 = makeMockPort('dev-2');
    const requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(makeMockAccess([port1, port2]));
    vi.stubGlobal('navigator', { requestMIDIAccess });

    // unmount 清理
    const h1 = renderHookHarness({}, 'dev-1');
    await flush();
    expect(port1.onmidimessage).toBeTypeOf('function');
    h1.unmount();
    expect(port1.onmidimessage).toBeNull();

    // deviceId 'dev-1' → 'dev-2'（rerender）
    const h2 = renderHookHarness({}, 'dev-1');
    await flush();
    expect(port1.onmidimessage).toBeTypeOf('function');
    h2.rerender('dev-2');
    await flush();
    expect(port1.onmidimessage).toBeNull();
    expect(port2.onmidimessage).toBeTypeOf('function');
    h2.unmount();
  });

  it('S0-T06: requestMIDIAccess reject → 静默不 throw; statechange 断连 → 解绑、重连 → 重绑 (non-critical)', async () => {
    // reject 路径：静默 catch，无未处理异常
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi
        .fn()
        .mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    });
    const h1 = renderHookHarness({}, 'dev-1');
    await flush();
    h1.unmount();

    // statechange 路径
    const port = makeMockPort('dev-1');
    const access = makeMockAccess([port]);
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(access),
    });
    const h2 = renderHookHarness({}, 'dev-1');
    await flush();
    expect(port.onmidimessage).toBeTypeOf('function');
    expect(access.onstatechange).toBeTypeOf('function');

    // 断连 → 解绑
    port.state = 'disconnected';
    access.onstatechange!();
    expect(port.onmidimessage).toBeNull();

    // 重连 → 重绑
    port.state = 'connected';
    access.onstatechange!();
    expect(port.onmidimessage).toBeTypeOf('function');

    // statechange 监听在清理时移除
    h2.unmount();
    expect(access.onstatechange).toBeNull();
  });

  // ── v1.26.0 D1-2: timeStamp 透传与兜底 ──
  it('S0-T07 (v1.26): handler 注入 timeStamp=1234 → 第三参透传 noteon/noteoff (critical)', async () => {
    const onNoteOn = vi.fn();
    const onNoteOff = vi.fn();
    const port = makeMockPort('dev-1');
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(makeMockAccess([port])),
    });

    const h = renderHookHarness({ onNoteOn, onNoteOff }, 'dev-1');
    await flush();

    const handler = port.onmidimessage as (e: {
      data: Uint8Array;
      timeStamp?: number;
    }) => void;

    // noteon：{ data, timeStamp: 1234 } → onNoteOn(60, 100, 1234)
    handler({ data: new Uint8Array([0x90, 60, 100]), timeStamp: 1234 });
    expect(onNoteOn).toHaveBeenCalledTimes(1);
    expect(onNoteOn).toHaveBeenCalledWith(60, 100, 1234);

    // noteoff：同样透传 timeStamp
    handler({ data: new Uint8Array([0x80, 60, 64]), timeStamp: 2345 });
    expect(onNoteOff).toHaveBeenCalledTimes(1);
    expect(onNoteOff).toHaveBeenCalledWith(60, 2345);

    h.unmount();
  });

  it('S0-T08 (v1.26): 事件无 timeStamp 字段 → performance.now() 兜底，不 throw (critical)', async () => {
    const onNoteOn = vi.fn();
    const onNoteOff = vi.fn();
    const port = makeMockPort('dev-1');
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(makeMockAccess([port])),
    });

    const h = renderHookHarness({ onNoteOn, onNoteOff }, 'dev-1');
    await flush();

    const handler = port.onmidimessage as (e: { data: Uint8Array }) => void;

    // jsdom / 异常事件对象无 timeStamp → 兜底 performance.now()（有限数）
    handler({ data: new Uint8Array([0x90, 60, 100]) });
    expect(onNoteOn).toHaveBeenCalledTimes(1);
    const ts = onNoteOn.mock.calls[0]![2] as number;
    expect(Number.isFinite(ts)).toBe(true);

    handler({ data: new Uint8Array([0x80, 60, 64]) });
    expect(onNoteOff).toHaveBeenCalledTimes(1);
    expect(Number.isFinite(onNoteOff.mock.calls[0]![1] as number)).toBe(true);

    h.unmount();
  });
});
