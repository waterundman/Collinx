/**
 * S0-T04~T07: useTransport 状态机单测 (v2.0.0 Stage 0 / D0-4~D0-7)
 *
 * 测试策略（对齐 useMidiOutput.test.tsx）：
 * - 无 @testing-library/react → createRoot + act 手写 harness
 * - 注入假 port（记录所有 send(data, ts) / clear() 调用），不依赖真实 Web MIDI
 * - 注入可控时钟 now = () => clock；vi.useFakeTimers() 驱动调度器 setInterval
 * - 断言的时间戳均为注入时钟域（默认生产路径为 performance.now()），
 *   期望值由公式推导：timestamp = startPerfNow + (atSeconds - startSeconds) * 1000
 *
 * 时间轴基准：TempoMap.default() = 120bpm / 4/4 → 1 beat = 0.5s。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createNoteEvent, TempoMap, type NoteEvent } from '@collinx/core';
import {
  useTransport,
  type MidiOutputPortLike,
  type UseTransportOptions,
  type UseTransportResult,
} from '../useTransport';

// ── 可控时钟（注入 now，与 vi.useFakeTimers 联动） ──
let clock = 0;

// ── 假输出端口 ──
interface FakePort extends MidiOutputPortLike {
  send: Mock<[data: Uint8Array | number[], timestamp?: number], void>;
  clear: Mock<[], void>;
}

function makeFakePort(id = 'fake-out'): FakePort {
  return {
    id,
    send: vi.fn<[data: Uint8Array | number[], timestamp?: number], void>(),
    clear: vi.fn<[], void>(),
  };
}

function mkNote(
  partial: Partial<NoteEvent> & Pick<NoteEvent, 'trackId' | 'bar' | 'beat'>
): NoteEvent {
  return createNoteEvent(partial);
}

/** 时间推进：clock 与假定时器同步前进（每 tick 回调读到推进后的 clock） */
function advance(ms: number): void {
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });
}

interface Harness {
  getResult: () => UseTransportResult;
  rerender: (next: Partial<UseTransportOptions>) => void;
  unmount: () => void;
}

function renderTransportHarness(initial: UseTransportOptions): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  const latest: { result: UseTransportResult | null } = { result: null };
  let currentOptions = initial;

  function Harness() {
    latest.result = useTransport(currentOptions);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Harness));
  });

  return {
    getResult() {
      return latest.result!;
    },
    rerender(next) {
      currentOptions = { ...currentOptions, ...next };
      act(() => {
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

const tempoMap = TempoMap.default();
// 单音符：on@0s / off@0+1*0.5=0.5s；velocity 0.8 → round(0.8*127)=102
const singleNote = mkNote({
  trackId: 't',
  bar: 1,
  beat: 1,
  durQn: 1,
  pitchMidi: 60,
  velocity: 0.8,
});

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('useTransport (S0-T04~T07)', () => {
  it('T04: play() → phase playing、position 推进、假 port 收到 now 域时间戳的 noteOn (critical)', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000; // 用非零基准证明时间戳来自注入时钟
    const t0 = clock;

    act(() => {
      h.getResult().play();
    });

    expect(h.getResult().phase).toBe('playing');
    expect(h.getResult().isPlaying).toBe(true);

    // 起始即排程 lookahead 窗口内的 on（atSeconds 0 <= 0 + 180ms）
    expect(port.send).toHaveBeenCalledTimes(1);
    const onCall = port.send.mock.calls[0]!;
    // channel 1（人类语义）→ 编码前 -1 → status 0x90|0
    expect(Array.from(onCall[0] as Uint8Array)).toEqual([0x90, 60, 102]);
    // timestamp = startPerfNow + (0 - 0)*1000 = t0（注入时钟域）
    expect(onCall[1]).toBe(t0);

    // 推进 600ms：120bpm 下 1 beat=0.5s → 0.6s = 1.2 beats → beat 2.2
    advance(600);

    const pos = h.getResult().position;
    expect(pos.bar).toBe(1);
    expect(pos.beat).toBeGreaterThan(1);
    expect(pos.beat).toBeCloseTo(1 + 600 / 1000 / 0.5, 6); // 1 + 1.2 = 2.2

    // off@0.5s 落入窗口 → timestamp = t0 + 0.5*1000 = t0 + 500
    const offCall = port.send.mock.calls[1]!;
    expect(Array.from(offCall[0] as Uint8Array)).toEqual([0x80, 60, 0]);
    expect(offCall[1]).toBe(t0 + 500);

    h.unmount();
  });

  it('T05: pause() → phase paused、position 保持不变、在鸣音收到 noteOff (critical)', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    act(() => {
      h.getResult().play();
    });
    advance(600);
    const beforePause = h.getResult().position;
    expect(beforePause.beat).toBeGreaterThan(1);

    act(() => {
      h.getResult().pause();
    });

    expect(h.getResult().phase).toBe('paused');
    expect(h.getResult().isPlaying).toBe(false);

    // position 保持不变（冻结）：继续推进时钟不动
    advance(600);
    expect(h.getResult().position).toEqual(beforePause);

    // 抗卡音：clear() + 补发 noteOff（无 timestamp = 立即发送）
    expect(port.clear).toHaveBeenCalled();
    const calls = port.send.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(Array.from(last[0] as Uint8Array)).toEqual([0x80, 60, 0]);
    expect(last[1]).toBeUndefined();

    h.unmount();
  });

  it('T06: stop() → phase idle、position 归零 {1,1}、在鸣音收到 noteOff (critical)', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    act(() => {
      h.getResult().play();
    });
    advance(600);

    act(() => {
      h.getResult().stop();
    });

    expect(h.getResult().phase).toBe('idle');
    expect(h.getResult().isPlaying).toBe(false);
    expect(h.getResult().position).toEqual({ bar: 1, beat: 1 });

    expect(port.clear).toHaveBeenCalled();
    const calls = port.send.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(Array.from(last[0] as Uint8Array)).toEqual([0x80, 60, 0]);
    expect(last[1]).toBeUndefined();

    h.unmount();
  });

  it('T07: 卸载/通道变更 → clear() 被调用且在鸣音逐条重发 noteOff (critical)', () => {
    // (a) 卸载
    const port = makeFakePort('out-a');
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });
    act(() => {
      h.getResult().play();
    });
    advance(600); // noteOn 已发出（进入 soundingNotes）
    const beforeA = port.send.mock.calls.length;

    h.unmount();

    expect(port.clear).toHaveBeenCalled();
    const resentA = port.send.mock.calls
      .slice(beforeA)
      .map((c) => Array.from(c[0] as Uint8Array));
    expect(resentA).toContainEqual([0x80, 60, 0]); // 补发 noteOff，通道取已发出的 0

    // (b) 播放中通道变更：旧通道补发 noteOff + 后续按新通道排程
    clock = 0;
    const portB = makeFakePort('out-b');
    const notesB = [
      singleNote, // on@0 / off@0.5
      mkNote({ trackId: 't', bar: 1, beat: 3, durQn: 1, pitchMidi: 64, velocity: 0.8 }), // on@1.0
    ];
    const hB = renderTransportHarness({
      notes: notesB,
      tempoMap,
      channel: 1,
      getOutputPort: () => portB,
      now: () => clock,
    });

    act(() => {
      hB.getResult().play();
    });
    advance(600);
    const beforeB = portB.send.mock.calls.length;

    // 通道 1 → 2（人类语义）；仍在播放 → 补发旧通道 noteOff 后从当前位置重排程
    hB.rerender({ channel: 2 });

    expect(portB.clear).toHaveBeenCalled();
    const resentB = portB.send.mock.calls
      .slice(beforeB)
      .map((c) => Array.from(c[0] as Uint8Array));
    expect(resentB).toContainEqual([0x80, 60, 0]);

    // 新通道生效：新排程的 noteOn 状态字节 = 0x90 | (2-1) = 0x91
    advance(500);
    const onBytes = portB.send.mock.calls.map((c) => Array.from(c[0] as Uint8Array));
    expect(onBytes).toContainEqual([0x91, 64, 102]);

    hB.unmount();
  });

  it('T08: seek() 停止在鸣音并重定位；播放中从新位置继续排程（净增，验证 D0-4 seek 语义）', () => {
    clock = 0;
    const port = makeFakePort();
    // noteA：on@0 / off@0.5；noteB：bar2 起点 on@2.0 / off@2.5
    const noteA = singleNote; // pitch 60
    const noteB = mkNote({
      trackId: 't',
      bar: 2,
      beat: 1,
      durQn: 1,
      pitchMidi: 67,
      velocity: 0.8,
    });
    const h = renderTransportHarness({
      notes: [noteA, noteB],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    act(() => {
      h.getResult().play();
    });
    advance(600); // noteA 已起音（进入 soundingNotes）

    act(() => {
      h.getResult().seek({ bar: 2, beat: 1 });
    });

    // 播放中 seek → 仍 playing，位置重定位
    expect(h.getResult().phase).toBe('playing');
    expect(h.getResult().position).toEqual({ bar: 2, beat: 1 });

    // 抗卡音：对 seek 前的在鸣音补发 noteOff（note 60，已换算通道 0）
    expect(port.clear).toHaveBeenCalled();
    const bytes = port.send.mock.calls.map((c) => Array.from(c[0] as Uint8Array));
    expect(bytes).toContainEqual([0x80, 60, 0]);

    // 从新位置排程：noteB on@2.0 落入 lookahead 窗口
    // timestamp = startPerfNow + (2.0 - startSeconds 2.0)*1000 = 600
    const bCallIdx = port.send.mock.calls.findIndex(
      (c) =>
        Array.from(c[0] as Uint8Array)[0] === 0x90 &&
        (c[0] as Uint8Array)[1] === 67
    );
    expect(bCallIdx).toBeGreaterThanOrEqual(0);
    expect(Array.from(port.send.mock.calls[bCallIdx]![0] as Uint8Array)).toEqual([
      0x90, 67, 102,
    ]);
    expect(port.send.mock.calls[bCallIdx]![1]).toBe(600);

    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 1（S1）：S0 登记债清偿 + positionSeconds 净增。
//   T07b — P3-3：用统一调用日志证明 allSoundOff 的 clear() 先于补发 noteOff
//          （S0 假 port 的 clear/send 为独立 mock，跨调用顺序不可观测）。
//   T12′ — D1-8：positionSeconds 与 position 同源同步（tick 推进 / pause 冻结 /
//          seek=timeAt / stop 归 0）。
// 仅追加，不修改既有 T04~T08。
// ---------------------------------------------------------------------------

describe("useTransport v2.0.0 S1 (T07b / T12′)", () => {
  it("T07b: clear() 在统一调用日志中先于补发 noteOff（跨调用顺序，S0 P3-3 清偿） (critical)", () => {
    const log: string[] = [];
    const port: MidiOutputPortLike = {
      id: "log-port",
      send: (data) => {
        log.push(`send:${Array.from(data as Uint8Array).join(",")}`);
      },
      clear: () => {
        log.push("clear");
      },
    };

    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    act(() => {
      h.getResult().play();
    });
    advance(600); // noteOn 已发出 → 进入 soundingNotes

    log.length = 0; // 仅观察 pause() 触发的 allSoundOff 顺序
    act(() => {
      h.getResult().pause();
    });

    const clearIdx = log.indexOf("clear");
    // 0x80 = 128 → 补发 noteOff [128,60,0]
    const offIdx = log.indexOf("send:128,60,0");
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(offIdx).toBeGreaterThanOrEqual(0);
    // 顺序裁决：clear() 必须先于补发 noteOff（否则补发可能被 clear 一并取消）。
    expect(clearIdx).toBeLessThan(offIdx);

    h.unmount();
  });

  it("T12′: positionSeconds 随 tick 推进 / pause 冻结 / seek=timeAt / stop 归 0 (critical)", () => {
    // 基准：120bpm / 4/4 → 1 beat = 0.5s；timeAt(2,1) = 2.0s。
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    // idle 初始 0
    expect(h.getResult().positionSeconds).toBe(0);

    act(() => {
      h.getResult().play();
    });
    // play 从 {1,1} 起 → startSeconds = timeAt(1,1) = 0
    expect(h.getResult().positionSeconds).toBe(0);

    advance(600); // 0.6s
    expect(h.getResult().positionSeconds).toBeCloseTo(0.6, 6);

    // pause 冻结在暂停时刻
    act(() => {
      h.getResult().pause();
    });
    const frozen = h.getResult().positionSeconds;
    expect(frozen).toBeCloseTo(0.6, 6);
    advance(600);
    expect(h.getResult().positionSeconds).toBe(frozen);

    // seek → tempoMap.timeAt(bar, beat)
    act(() => {
      h.getResult().seek({ bar: 2, beat: 1 });
    });
    expect(h.getResult().positionSeconds).toBeCloseTo(2.0, 6);

    // 从暂停位置续播并推进 → 2.0 + 0.2 = 2.2
    act(() => {
      h.getResult().play();
    });
    expect(h.getResult().positionSeconds).toBeCloseTo(2.0, 6);
    advance(200);
    expect(h.getResult().positionSeconds).toBeCloseTo(2.2, 6);

    // stop → 归 0
    act(() => {
      h.getResult().stop();
    });
    expect(h.getResult().positionSeconds).toBe(0);

    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 3（S3）：count-in 状态机（D3-2，T20/T21/T22）。
//   T20 — play({countInBars:1}) → 先 count-in 且 click 投递，推进 1 小节后 →
//         playing 且音符事件开始（同一时间轴，channel 9 / 0x99 字节）。
//   T21 — count-in 期间 stop() → 立即 idle、无后续 click/音符（负控）。
//   T22 — countInBars=0（含无参 play()）→ 直进 playing（无 count-in 阶段）。
//   时间轴基准：TempoMap.default() = 120bpm / 4/4 → 1 beat = 0.5s、1 小节 = 2.0s。
// ---------------------------------------------------------------------------

describe("useTransport v2.0.0 S3 (T20/T21/T22)", () => {
  // 0x99 = 0x90 | 9：noteOn + GM 打击乐通道 10（0-based 9），节拍器 click 专属。
  const NOTE_ON_CLICK = 0x99;
  const NOTE_ON_NOTE = 0x90;

  it("T20: play({countInBars:1}) → count-in 且 click 经 0x99 投递；推进 1 小节 → playing + 音符开始 (critical)", () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote], // pitch 60，on@0 / off@0.5
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000; // t0（非零基准，证明时间戳来自注入时钟）
    const t0 = clock;

    act(() => {
      h.getResult().play({ countInBars: 1 });
    });

    // 立即进入 count-in（非 playing）
    expect(h.getResult().phase).toBe("count-in");
    expect(h.getResult().isPlaying).toBe(false);

    // 首批 click 已投递：强拍 note 34、通道 9 → 字节 [0x99, 34, 120]
    expect(port.send).toHaveBeenCalled();
    const firstClick = port.send.mock.calls[0]!;
    expect(Array.from(firstClick[0] as Uint8Array)).toEqual([NOTE_ON_CLICK, 34, 120]);
    // timestamp = t0 + (click0.atSeconds - sessionStartSeconds)*1000
    //   click0.atSeconds = sessionStartSeconds（count-in 起点）→ t0
    expect(firstClick[1]).toBe(t0);

    // 推进 1 小节（2.0s）→ count-in 结束、转 playing
    advance(2000);

    expect(h.getResult().phase).toBe("playing");
    expect(h.getResult().isPlaying).toBe(true);

    // 转场瞬间 position/positionSeconds 精确等于 from={1,1}（无漂移不变量）
    expect(h.getResult().position).toEqual({ bar: 1, beat: 1 });
    expect(h.getResult().positionSeconds).toBeCloseTo(0, 6);

    // click 弱拍也经 0x99 投递（note 33、通道 9）
    const clickBytes = port.send.mock.calls.map((c) =>
      Array.from(c[0] as Uint8Array)
    );
    expect(clickBytes).toContainEqual([NOTE_ON_CLICK, 34, 120]); // 强拍
    expect(clickBytes).toContainEqual([NOTE_ON_CLICK, 33, 90]); // 弱拍

    // 音符事件已开始（正片）：note 60 经音符通道 1（0-based 0）→ [0x90, 60, 102]
    const noteOnCall = port.send.mock.calls.find(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_NOTE && (c[0] as Uint8Array)[1] === 60
    );
    expect(noteOnCall).toBeDefined();
    expect(Array.from(noteOnCall![0] as Uint8Array)).toEqual([NOTE_ON_NOTE, 60, 102]);
    // 音符 on 时间戳 = t0 + (timeAt(from) - sessionStartSeconds)*1000 = t0 + 2000
    expect(noteOnCall![1]).toBe(t0 + 2000);

    h.unmount();
  });

  it("T21: count-in 期间 stop() → 立即 idle、无后续 click/音符（负控） (critical)", () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000;
    act(() => {
      h.getResult().play({ countInBars: 1 });
    });
    expect(h.getResult().phase).toBe("count-in");

    // 推进 600ms：已投递部分 click（强拍 34 + 首个弱拍 33）
    advance(600);
    const clickCountBeforeStop = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_CLICK
    ).length;
    expect(clickCountBeforeStop).toBeGreaterThan(0); // count-in 确实在发声

    // 中断 count-in
    act(() => {
      h.getResult().stop();
    });
    expect(h.getResult().phase).toBe("idle");
    expect(h.getResult().position).toEqual({ bar: 1, beat: 1 });
    expect(h.getResult().positionSeconds).toBe(0);

    // stop 当时已清在鸣 Map（抗卡音）：记录 stop 后的 send 数
    const afterStopCount = port.send.mock.calls.length;

    // 继续推进 2.0s：调度器 sessionRef 已为 null → 不再有新 click/音符事件
    advance(2000);

    // 负控：stop 之后 send 调用数不增（无新排程的 click/note）
    expect(port.send.mock.calls.length).toBe(afterStopCount);
    // 具体确认：不再出现新的 0x99（click）或 0x90（音符）on 事件
    const clickCountAfter = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_CLICK
    ).length;
    const noteOnCountAfter = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_NOTE
    ).length;
    expect(clickCountAfter).toBe(clickCountBeforeStop);
    // 音符 on 在 count-in 期间从未投递（正片未开始），stop 后仍为 0
    expect(noteOnCountAfter).toBe(0);

    h.unmount();
  });

  it("T22: countInBars=0（含无参 play()）→ 直进 playing（无 count-in 阶段） (critical)", () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000;
    // 向后兼容：无参 play() = countInBars 0 → 直进 playing
    act(() => {
      h.getResult().play();
    });
    expect(h.getResult().phase).toBe("playing");
    expect(h.getResult().phase).not.toBe("count-in");
    expect(h.getResult().isPlaying).toBe(true);
    // 音符事件立即开始（无 count-in 前置）
    expect(port.send).toHaveBeenCalled();
    const onCall = port.send.mock.calls[0]!;
    expect(Array.from(onCall[0] as Uint8Array)).toEqual([NOTE_ON_NOTE, 60, 102]);

    // 显式传 countInBars:0 同样直进 playing（无 count-in）
    act(() => {
      h.getResult().stop();
    });
    act(() => {
      h.getResult().play({ countInBars: 0 });
    });
    expect(h.getResult().phase).toBe("playing");
    expect(h.getResult().phase).not.toBe("count-in");

    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 4（S4 — D1/D3/D2）：S3 验证期登记的 3 处 defect 修复。
//   D1 — 在鸣表键升为 `${pitchMidi}:${evChannel}` 复合键：两通道并存后单 pitch
//        键已不诚实（click ch9 / 音符 ch0 同 pitch 会互相覆盖），导致 stop()
//        漏补一条 noteOff（卡音）。修复后跨通道同 pitch 各占一条，stop() 补发两条。
//   D3 — pause() 后 play() 不得重走 count-in（count-in 仅从 idle 有意义）；引擎侧
//        在 paused 态强制 countInBars=0，立即 playing、不再投递 click。
//   D2 — buildClickEvents + beginPlayback 的拍号网格由单 `meter` 改为逐拍
//        `tempoMap.meterAt(bar)` 推导，正确处理变拍（count-in 前导小节按实际
//        meter 推导拍数）。4/4 结果字节级不变（T19/T19b 不受影响）。
// ---------------------------------------------------------------------------

describe("useTransport v2.0.0 S4 (D1/D3/D2)", () => {
  // 0x99 = 0x90 | 9：click noteOn（GM 打击乐通道 10）；0x89 = 0x80 | 9：click
  // noteOff；0x80：音符通道 0（人类语义 ch1）的 noteOff。
  const NOTE_ON_CLICK = 0x99;
  const NOTE_OFF_CLICK = 0x89; // 0x80 | 9：click noteOff
  const NOTE_OFF = 0x80;

  it("D1: 跨通道同 pitch（click ch9 / 音符 ch0，pitch 34）在鸣表互不覆盖；stop() 补发两条 noteOff (critical)", () => {
    const port = makeFakePort();
    // 与 click 强拍同 pitch(34) 的音符（设置通道 1 → 已换算通道 0）。
    const overlapping = mkNote({
      trackId: "t",
      bar: 1,
      beat: 1,
      durQn: 4,
      pitchMidi: 34,
      velocity: 0.8,
    });
    const h = renderTransportHarness({
      notes: [overlapping],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000;
    act(() => {
      h.getResult().play({ countInBars: 1 });
    });
    expect(h.getResult().phase).toBe("count-in");

    // 推进过 count-in 进入 playing，并越过音符 on（pitch 34）的投递时刻，使
    // click(pitch34,ch9) 与 音符(pitch34,ch0) 都进入在鸣 Map。
    advance(2020);
    expect(h.getResult().phase).toBe("playing");

    act(() => {
      h.getResult().stop();
    });

    // 抗卡音：stop() 经 allSoundOff 按复合键逐条补发 noteOff。
    const bytes = port.send.mock.calls.map((c) => Array.from(c[0] as Uint8Array));
    // click（pitch 34，通道 9）的 noteOff：0x80|9 = 0x89（非 NOTE_ON_CLICK=0x99）
    expect(bytes).toContainEqual([NOTE_OFF_CLICK, 34, 0]);
    // 音符（pitch 34，通道 0）的 noteOff：0x80
    expect(bytes).toContainEqual([NOTE_OFF, 34, 0]);

    h.unmount();
  });

  it("D3: pause() 后 play() 不得重走 count-in（立即 playing、不再投递 click） (critical)", () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [singleNote],
      tempoMap,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000;
    act(() => {
      h.getResult().play({ countInBars: 1 });
    });
    advance(2000);
    expect(h.getResult().phase).toBe("playing");

    act(() => {
      h.getResult().pause();
    });
    expect(h.getResult().phase).toBe("paused");

    // pause 前的 click 投递数
    const clickBefore = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_CLICK
    ).length;

    // 从 paused 续播（App 仍传 countInBars:1）—— 引擎侧须强制 countInBars=0。
    act(() => {
      h.getResult().play({ countInBars: 1 });
    });
    expect(h.getResult().phase).toBe("playing");
    expect(h.getResult().phase).not.toBe("count-in");

    const clickAfter = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_CLICK
    ).length;
    // 不得再有新的 click 投递（无重走 count-in）
    expect(clickAfter).toBe(clickBefore);

    h.unmount();
  });

  it("D2: 变拍 TempoMap — count-in 前导小节按实际 meter 推导 click 拍数 (critical)", () => {
    const port = makeFakePort();
    // bar1=4/4，bar2=3/4（120bpm）；from={2,1} 的 count-in 前导小节为 bar1(4/4)。
    const tm = new TempoMap(
      [],
      [
        { bar: 1, numerator: 4, denominator: 4 },
        { bar: 2, numerator: 3, denominator: 4 },
      ],
      []
    );
    const h = renderTransportHarness({
      notes: [],
      tempoMap: tm,
      channel: 1,
      getOutputPort: () => port,
      now: () => clock,
    });

    clock = 1000;
    // 定位到 from={2,1}（count-in 前导为 bar1=4/4 → 应 4 拍，而非按 bar2 的 3 拍）
    act(() => {
      h.getResult().seek({ bar: 2, beat: 1 });
    });
    act(() => {
      h.getResult().play({ countInBars: 1 });
    });
    expect(h.getResult().phase).toBe("count-in");

    advance(2000);

    const clickSends = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON_CLICK
    );
    // 前导小节 bar1=4/4 → 4 拍（旧单 meter 实现按 from.bar=2 的 3/4 只产 3 拍，错）。
    expect(clickSends).toHaveLength(4);
    const stamps = clickSends.map((c) => c[1] as number).sort((a, b) => a - b);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeCloseTo(500, 6);
    }

    // ---- v2.0.0 S5 (D5-6 / 清偿 S4-F2)：补绑**重音位置**与**起点绝对秒** ----
    // 原断言只验「数量 + 间隔」⇒ 把重音映射改成恒弱（全部 pitch 33）也能通过
    // （S4 验证登记为 DIM3 缺口）。此处补两处：
    // ① 按时间戳升序后，第 1 击必须是强拍 pitch 34（Metronome Bell），其余 33；
    // ② 首击落在 count-in 起点：sessionStartSeconds = timeAt({2,1}) - countInDuration
    //    = 2.0 - 2.0 = 0 ⇒ 绝对时间戳 = 1000 + (0 - 0) * 1000 = 1000。
    const ordered = clickSends
      .slice()
      .sort((a, b) => (a[1] as number) - (b[1] as number));
    expect(ordered.map((c) => (c[0] as Uint8Array)[1])).toEqual([34, 33, 33, 33]);
    expect(ordered[0]![1]).toBe(1000);

    h.unmount();
  });
});


// ---------------------------------------------------------------------------
// v2.1.0 S2：loop 折返（D12-1/2）+ 播放期节拍器（D12-4）
//   T32 折返重放 / T33 无 loop 负控 / T36 节拍器开关 / T37 不双触发 + stop 补 noteOff
// ---------------------------------------------------------------------------

describe('useTransport v2.1.0 S2 (loop + metronome)', () => {
  const CLICK_ON = 0x99;  // 0x90|9：click noteOn（GM ch10）
  const CLICK_OFF = 0x89; // 0x80|9：click noteOff
  const NOTE_ON = 0x90;   // 0x90|0：音符通道 noteOn（设置通道 1）

  it('T32: loop 折返——播放到 loopEnd 回 loopStart，区间内事件重放（同一会话）', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })],
      tempoMap, channel: 1, getOutputPort: () => port, now: () => clock,
    });
    act(() => {
      h.getResult().setLoop({
        enabled: true, start: { bar: 1, beat: 1 }, end: { bar: 2, beat: 1 },
      });
    });
    clock = 1000;
    act(() => { h.getResult().play({ countInBars: 0 }); });
    expect(h.getResult().phase).toBe('playing');

    advance(2500); // 越过 loopEnd（2.0s @120bpm 4/4）→ 折返一次

    // 折返不重启会话：phase 仍 playing
    expect(h.getResult().phase).toBe('playing');
    // 区间内音符在两轮循环各投递一次 noteOn
    const noteOns = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON
    );
    expect(noteOns.length).toBeGreaterThanOrEqual(2);
    // 播放头已回到 loop 内（bar 1）
    expect(h.getResult().position.bar).toBe(1);
    h.unmount();
  });

  it('T33: loopEnabled=false 时无折返（负控：越过 loopEnd 继续前进）', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })],
      tempoMap, channel: 1, getOutputPort: () => port, now: () => clock,
    });
    clock = 1000;
    act(() => { h.getResult().play({ countInBars: 0 }); });
    advance(2500);
    expect(h.getResult().phase).toBe('playing');
    // 无 loop：播放头前进到 bar 2（2.5s @120bpm 4/4 → bar 2）
    expect(h.getResult().position.bar).toBe(2);
    // 音符只投递一次
    const noteOns = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === NOTE_ON
    );
    expect(noteOns.length).toBe(1);
    h.unmount();
  });

  it('T36: metronome=true 播放期每拍 click（34 强/33 弱，GM ch10）；=false 无', () => {
    const portOn = makeFakePort();
    const h = renderTransportHarness({
      notes: [], tempoMap, channel: 1, getOutputPort: () => portOn,
      now: () => clock, metronome: true,
    });
    const t0 = clock;
    act(() => { h.getResult().play({ countInBars: 0 }); });
    advance(2000); // 2s = 4 拍 @120bpm
    // 只统计起播刻 +2s 以内的 click（lookahead 窗口边缘的排程不含在内，保证确定性）
    const clicks = portOn.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === 0x99 && (c[1] as number) < t0 + 2000
    );
    expect(clicks.length).toBe(4);
    const pitches = clicks.map((c) => (c[0] as Uint8Array)[1]);
    expect(pitches).toEqual([34, 33, 33, 33]);
    expect(clicks.every((c) => (c[0] as Uint8Array)[0] === 0x99)).toBe(true);
    h.unmount();

    // 负控：metronome=false → 无 click
    const portOff = makeFakePort();
    const h2 = renderTransportHarness({
      notes: [], tempoMap, channel: 1, getOutputPort: () => portOff,
      now: () => clock, metronome: false,
    });
    clock = 6000;
    act(() => { h2.getResult().play({ countInBars: 0 }); });
    advance(2000);
    const clicksOff = portOff.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === 0x99
    );
    expect(clicksOff.length).toBe(0);
    h2.unmount();
  });

  it('T37: count-in 与播放期 click 不双触发；stop() 补发在鸣 click 的 noteOff', () => {
    const port = makeFakePort();
    const h = renderTransportHarness({
      notes: [], tempoMap, channel: 1, getOutputPort: () => port,
      now: () => clock, metronome: true,
    });
    clock = 1000;
    act(() => { h.getResult().play({ countInBars: 1 }); });
    advance(3000); // count-in 2s + 播放 1s
    const clickStamps = port.send.mock.calls
      .filter((c) => (c[0] as Uint8Array)[0] === CLICK_ON)
      .map((c) => c[1] as number);
    // 无同拍双触发：click 时间戳严格递增（count-in 段与播放段无缝衔接）
    for (let i = 1; i < clickStamps.length; i++) {
      expect(clickStamps[i]!).toBeGreaterThan(clickStamps[i - 1]!);
    }
    // stop() → 在鸣 click 全部补 noteOff（0x89，复合键路径）
    act(() => { h.getResult().stop(); });
    const offs = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === CLICK_OFF
    );
    expect(offs.length).toBeGreaterThan(0);
    h.unmount();
  });
});

  it("T31: 7/8（beatsPerBar=3.5）count-in——3 click 整数拍、强拍命中、不越界 bar<0（S4-F1 闭合）", () => {
    const port = makeFakePort();
    const tm78 = new TempoMap([], [{ bar: 1, numerator: 7, denominator: 8 }]);
    const h = renderTransportHarness({
      notes: [], tempoMap: tm78, channel: 1, getOutputPort: () => port,
      now: () => clock, metronome: false,
    });
    clock = 1000;
    act(() => { h.getResult().seek({ bar: 2, beat: 1 }); });
    act(() => { h.getResult().play({ countInBars: 1 }); });
    expect(h.getResult().phase).toBe("count-in");
    advance(2000); // 推进过 count-in 窗口（1.75s），让调度器投递全部 click
    // from={2,1} → count-in 覆盖 7/8 的 bar 1（beatsPerBar=3.5）：floor(3.5)=3 click
    // 且 walk 进 bar 1 时 floor(3.5)=3 → 落整数拍 {1,3},{1,2},{1,1}（修复前走
    // 3.5/2.5/1.5/0.5 → beat===1 永不命中 → 无强拍；且第 4 步越界 bar 0）
    const clicks = port.send.mock.calls.filter(
      (c) => (c[0] as Uint8Array)[0] === 0x99
    );
    expect(clicks.length).toBe(3);
    const pitches = clicks.map((c) => (c[0] as Uint8Array)[1]);
    expect(pitches).toContain(34); // 强拍命中（S4-F1 核心断言）
    // 时间单调（无塌缩）
    const stamps = clicks.map((c) => c[1] as number);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
    }
    // 不越界：所有 click 时刻 ≥ 会话锚点（bar<-1 的 click 会给出 < startPerfNow 的时间戳）
    expect(Math.min(...stamps)).toBeGreaterThanOrEqual(1000);
    h.unmount();
  });
