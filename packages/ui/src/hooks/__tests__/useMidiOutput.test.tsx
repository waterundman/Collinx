/**
 * S0-T02~T05: useMidiOutput hook 单测 (v1.29.0 Stage 0 / D1-4)
 *
 * mock navigator.requestMIDIAccess（vi.stubGlobal）与 useSettings（vi.mock，
 * 沿用 useMidiInput.test.tsx / v1.24 DeviceSettingsWiring 模式）。
 *
 * mock access 同时暴露可写属性 onstatechange（带 setter 计数，用于断言实现
 * 未以属性方式注册）与 addEventListener/removeEventListener（记录监听器），
 * 以复现 Chrome 多次 requestMIDIAccess 返回同一 MIDIAccess 对象的场景。
 */
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMidiOutput, type UseMidiOutputResult } from '../useMidiOutput';

vi.mock('../useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '../useSettings';

const mockUseSettings = vi.mocked(useSettings);

interface MockOutputPort {
  id: string;
  state: string;
  send: Mock<[data: Uint8Array, timestamp?: number], void>;
  clear: Mock<[], void>;
}

type StateChangeHandler = () => void;

interface MockAccess {
  outputs: { values(): Iterable<MockOutputPort> };
  addEventListener: Mock<[type: string, handler: StateChangeHandler], void>;
  removeEventListener: Mock<[type: string, handler: StateChangeHandler], void>;
  /** 触发已注册的 statechange 监听器（模拟浏览器事件分发） */
  dispatchStateChange: () => void;
  /** 录制到 onstatechange 属性注册次数；实现必须为 0 */
  getOnstatechangeWrites: () => number;
  /** 可写属性（getter/setter 覆写，见 makeMockAccess）；实现不得赋值 */
  onstatechange: StateChangeHandler | null;
}

function makeMockPort(id: string): MockOutputPort {
  return {
    id,
    state: 'connected',
    send: vi.fn<[data: Uint8Array, timestamp?: number], void>(),
    clear: vi.fn<[], void>(),
  };
}

function makeMockAccess(
  ports: MockOutputPort[],
  listenerLog: Map<string, Set<StateChangeHandler>>
): MockAccess {
  const map = new Map(ports.map((p) => [p.id, p] as const));

  const addEventListener = vi.fn<
    [type: string, handler: StateChangeHandler],
    void
  >((type, handler) => {
    if (!listenerLog.has(type)) {
      listenerLog.set(type, new Set());
    }
    listenerLog.get(type)!.add(handler);
  });

  const removeEventListener = vi.fn<
    [type: string, handler: StateChangeHandler],
    void
  >((type, handler) => {
    listenerLog.get(type)?.delete(handler);
  });

  let onstatechangeWrites = 0;
  let onstatechangeValue: (() => void) | null = null;

  const access: MockAccess = {
    outputs: { values: () => map.values() },
    addEventListener,
    removeEventListener,
    dispatchStateChange: () => {
      // 拷贝为数组后再遍历：监听器可能在回调里被移除
      for (const handler of Array.from(listenerLog.get('statechange') ?? [])) {
        handler();
      }
    },
    getOnstatechangeWrites: () => onstatechangeWrites,
    onstatechange: null,
  };

  // 可写属性 onstatechange：实现若写此属性则计数 +1（用于 T04 断言）
  Object.defineProperty(access, 'onstatechange', {
    get: () => onstatechangeValue,
    set: (value: (() => void) | null) => {
      onstatechangeWrites += 1;
      onstatechangeValue = value;
    },
    configurable: true,
  });

  return access;
}

/** 手写 flush（无 testing-library）：microtask + macrotask 双清 */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

interface Harness {
  rerender: (deviceId: string, channel: number) => void;
  unmount: () => void;
  /** 最近一次渲染返回的 hook 结果 */
  getResult: () => UseMidiOutputResult;
}

function renderHookHarness(deviceId: string, channel = 1): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  const latest: { result: UseMidiOutputResult | null } = { result: null };

  const applySettings = (devId: string, chan: number) => {
    mockUseSettings.mockImplementation(
      () =>
        ({
          settings: {
            midi: {
              midiDevice: { input: '', output: devId },
              midiChannel: chan,
            },
          },
        }) as unknown as ReturnType<typeof useSettings>
    );
  };

  function Harness() {
    latest.result = useMidiOutput();
    return null;
  }

  act(() => {
    applySettings(deviceId, channel);
    root = createRoot(container);
    root.render(React.createElement(Harness));
  });

  return {
    rerender(devId: string, chan: number) {
      act(() => {
        applySettings(devId, chan);
        root.render(React.createElement(Harness));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    getResult() {
      return latest.result!;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── D1-2: useMidiOutput ──
describe('useMidiOutput (S0-T02~T05)', () => {
  it('S0-T02: 绑定输出设备后 playNote(60,100,300) → 立即 noteOn + 调度 noteOff (critical)', async () => {
    const port = makeMockPort('dev-out-1');
    const listenerLog = new Map<string, Set<() => void>>();
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(makeMockAccess([port], listenerLog)),
    });

    const h = renderHookHarness('dev-out-1', 1);
    await flush();

    expect(h.getResult().isAvailable).toBe(true);

    // 调用前取时间基准：offAt = playNote 内部 performance.now() + durationMs，
    // 必然 >= before + 300（内部取值晚于 before，durationMs 为正）
    const before = performance.now();
    act(() => {
      h.getResult().playNote(60, 100, 300);
    });

    expect(port.send).toHaveBeenCalledTimes(2);

    // 第一次：note on，data = [0x90 | (channel1→0), 0x3C, 0x64]，无 timestamp → 立即发送
    const firstCall = port.send.mock.calls[0]!;
    expect(Array.from(firstCall[0] as Uint8Array)).toEqual([0x90, 0x3c, 0x64]);
    expect(firstCall[1]).toBeUndefined();

    // 第二次：note off，data = [0x80 | 0, 0x3C, 0x00]，timestamp 为绝对时刻（DOMHighResTimeStamp）
    const secondCall = port.send.mock.calls[1]!;
    expect(Array.from(secondCall[0] as Uint8Array)).toEqual([0x80, 0x3c, 0x00]);
    const offAt = secondCall[1] as number;
    expect(typeof offAt).toBe('number');
    expect(Number.isFinite(offAt)).toBe(true);
    // offAt = (playNote 内 performance.now()) + 300 >= before + 300；
    // 容差 5ms 仅吸收浮点/时钟粒度偏差，非放宽语义
    expect(offAt).toBeGreaterThanOrEqual(before + 300 - 5);

    h.unmount();

    // channel 换算（settings 1-16 → 编码 0-15）：channel 16 → status 0x9F
    const port2 = makeMockPort('dev-out-2');
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(makeMockAccess([port2], new Map())),
    });
    const h2 = renderHookHarness('dev-out-2', 16);
    await flush();
    act(() => {
      h2.getResult().playNote(60, 100, 100);
    });
    expect(Array.from(port2.send.mock.calls[0]![0] as Uint8Array)).toEqual([
      0x9f, 0x3c, 0x64,
    ]);
    h2.unmount();
  });

  it('S0-T03: 无 requestMIDIAccess / reject / 无匹配 id → isAvailable false 且 playNote no-op 不 throw (critical)', async () => {
    // (a) navigator 无 requestMIDIAccess（不支持 Web MIDI / jsdom）
    vi.stubGlobal('navigator', {});
    const h1 = renderHookHarness('dev-out-1', 1);
    await flush();
    expect(h1.getResult().isAvailable).toBe(false);
    expect(() => h1.getResult().playNote(60, 100, 300)).not.toThrow();
    h1.unmount();

    // (b) requestMIDIAccess reject → 静默 catch
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi
        .fn()
        .mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    });
    const h2 = renderHookHarness('dev-out-1', 1);
    await flush();
    expect(h2.getResult().isAvailable).toBe(false);
    expect(() => h2.getResult().playNote(60, 100, 300)).not.toThrow();
    h2.unmount();

    // (c) 空 deviceId → 不发起授权请求
    const requestMIDIAccess = vi
      .fn()
      .mockResolvedValue(makeMockAccess([makeMockPort('dev-out-1')], new Map()));
    vi.stubGlobal('navigator', { requestMIDIAccess });
    const h3 = renderHookHarness('', 1);
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    expect(h3.getResult().isAvailable).toBe(false);
    h3.unmount();

    // (d) outputs 无匹配 id → 请求发出但不绑定
    const port = makeMockPort('dev-out-1');
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(makeMockAccess([port], new Map())),
    });
    const h4 = renderHookHarness('dev-404', 1);
    await flush();
    expect(h4.getResult().isAvailable).toBe(false);
    expect(() => h4.getResult().playNote(60, 100, 300)).not.toThrow();
    expect(port.send).not.toHaveBeenCalled();
    h4.unmount();
  });

  it('S0-T04: statechange 经 addEventListener 注册（严禁写 onstatechange 属性）→ 断连解绑、重连重绑 (critical)', async () => {
    const port = makeMockPort('dev-out-1');
    const listenerLog = new Map<string, Set<() => void>>();
    const access = makeMockAccess([port], listenerLog);
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(access),
    });

    const h = renderHookHarness('dev-out-1', 1);
    await flush();

    expect(h.getResult().isAvailable).toBe(true);
    // 必须用 addEventListener：Chrome 多次 requestMIDIAccess 返回同一 MIDIAccess，
    // 写属性会覆盖 useMidiInput 的 handler → 输入热插拔重绑失效
    expect(access.addEventListener).toHaveBeenCalledWith(
      'statechange',
      expect.any(Function)
    );
    expect(access.getOnstatechangeWrites()).toBe(0);
    expect(access.onstatechange).toBeNull();

    // 断连 → 解绑
    act(() => {
      port.state = 'disconnected';
      access.dispatchStateChange();
    });
    expect(h.getResult().isAvailable).toBe(false);

    // 重连 → 重绑
    act(() => {
      port.state = 'connected';
      access.dispatchStateChange();
    });
    expect(h.getResult().isAvailable).toBe(true);

    h.unmount();
  });

  it('S0-T05: 卸载 → removeEventListener + clear() + 补发 noteOff 防卡音 (non-critical)', async () => {
    const port = makeMockPort('dev-out-1');
    const listenerLog = new Map<string, Set<() => void>>();
    const access = makeMockAccess([port], listenerLog);
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(access),
    });

    const h = renderHookHarness('dev-out-1', 1);
    await flush();

    act(() => {
      h.getResult().playNote(64, 100, 1000);
    });
    expect(port.send).toHaveBeenCalledTimes(2);

    h.unmount();

    // 监听器移除（同一 handler 引用）
    expect(access.removeEventListener).toHaveBeenCalledWith(
      'statechange',
      expect.any(Function)
    );
    // clear() 只取消"已调度未发出"的消息，已发出的 noteOn 无法被取消 → 必须补发 noteOff
    expect(port.clear).toHaveBeenCalled();
    const calls = port.send.mock.calls;
    const lastData = calls[calls.length - 1]![0] as Uint8Array;
    expect(Array.from(lastData)).toEqual([0x80, 0x40, 0x00]); // 0x40 = 64
  });
});

// ── S0 验证登记的 P2 缺陷清偿（v1.29 D2-4）: 多音 noteOff 补发 ──
//
// 缺陷：lastNoteRef 单值 + 清理时 clear() 取消全部"已调度未发出"noteOff，
// 却只补发最后一个 → 300ms 内连点多个音后立刻卸载/切设备，前面各音的
// noteOff 被 clear 取消且未补发 → 卡音。
//
// 本用例为纯追加，既有 4 用例零改动；hook 用例数 4 → 5。
describe('useMidiOutput 多音 noteOff 补发 (S0 缺陷清偿)', () => {
  it('S0-T06: 连续 playNote 3 个不同 note → 卸载补发 3 条 noteOff（各一次，通道正确） (critical)', async () => {
    const port = makeMockPort('dev-out-1');
    const access = makeMockAccess([port], new Map());
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn().mockResolvedValue(access),
    });

    // channel 3（人类语义 1-16）→ 编码前 -1 → 2 → status 0x80|2 = 0x82
    const h = renderHookHarness('dev-out-1', 3);
    await flush();
    expect(h.getResult().isAvailable).toBe(true);

    const notes = [60, 64, 67];
    act(() => {
      for (const n of notes) {
        h.getResult().playNote(n, 100, 300);
      }
    });
    // 每音 2 条：noteOn 立即 + noteOff 以 performance.now()+300 调度
    expect(port.send).toHaveBeenCalledTimes(notes.length * 2);
    // 调度 noteOff 在 300ms 后；这里立即卸载，模拟"连点后马上切设备/卸载"
    const beforeUnmount = port.send.mock.calls.length;

    h.unmount();

    // 卸载时 clear() 取消全部已调度 noteOff → 必须逐条补发（每个 note 恰一条）
    const resent = port.send.mock.calls
      .slice(beforeUnmount)
      .map((c) => Array.from(c[0] as Uint8Array));

    expect(resent).toHaveLength(notes.length);
    // 补发顺序 = Map 插入顺序 = playNote 调用顺序
    expect(resent.map((d) => d[1])).toEqual([60, 64, 67]);
    // 每条均为 noteOff（status 0x82、velocity byte 0x00）
    for (const data of resent) {
      expect(data[0]).toBe(0x82);
      expect(data[2]).toBe(0x00);
    }
    // 通道正确性对照：noteOn status = 0x90|2 = 0x92
    expect(Array.from(port.send.mock.calls[0]![0] as Uint8Array)[0]).toBe(0x92);
  });
});
