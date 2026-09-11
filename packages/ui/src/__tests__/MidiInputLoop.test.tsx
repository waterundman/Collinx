/**
 * v1.25.0 Stage 1 (S1-T01~T03) + v1.26.0 Stage 1 (S1-T01~T05): MIDI 输入闭环测试
 *
 * v1.25 遗留（保留为零回归锚点）：
 * - S1-T01: PianoRollView activePitches 键位高亮（undefined/空集零行为变化）
 * - S1-T02: App 全量渲染录入闭环（noteon 高亮 → noteoff 落盘 + 高亮清除）
 *   v1.26 起注入 timeStamp（on=1000/off=1500 → 120bpm 下 500ms=1 拍），
 *   断言 durQn=1 与字段映射不变（零回归锚点）。
 * - S1-T03: 连续多音 cursor 步进（beat 累计；beat>4 → bar+1 / beat 回绕，4/4）
 *   v1.26 起逐音注入 500ms timeStamp，语义保持 1 拍/音。
 *
 * v1.26 新增：
 * - S1-T02(quantize): grid=0.25 时落盘 beat 是 grid 倍数（cursor 非对齐场景）
 *   + 连续 1.3 拍音符驱动 cursor 越过小节边界 → 下一音落点回绕到下一小节
 * - computeNoteOffPlacement 纯函数直测（landing>4 防御分支：cursor.beat=4.9
 *   场景在 cursor 每次步进后 while 归位的运行时不变量下不可经公开 MIDI API
 *   到达，故抽出纯函数直测；集成层用 1.3 拍序列覆盖 cursor 回绕→落盘下一小节）
 * - S1-T03(velocity): velocityMode='fixed' → 落盘 velocity=fixedVelocity/127
 * - S1-T04: 实测 durQn 变体（250ms=0.5 拍 / 5ms→clamp 0.25 / 2000ms=4 拍）
 * - S1-T05: MidiSettings 录入设置接线（真实 SettingsProvider + 探针读
 *   settings 状态；不 mock useSettings，因本文件 App 用例需要真实 Provider，
 *   文件级 vi.mock 会污染 App 用例）
 *
 * harness 约定（项目无 @testing-library/react）：createRoot + act 手写，
 * 沿用 S0 useMidiInput.test.tsx（flush）与 v1.24 SettingsModalWiring.test.tsx
 * （App 全量渲染 + waitFor）模式。mock navigator.requestMIDIAccess 用
 * Object.defineProperty（App 全量渲染下不能整只替换 navigator，避免破坏
 * 其他 Web API 读取方；语义与 vi.stubGlobal 一致，测试后删除属性还原）。
 *
 * settings 注入方式：SettingsProvider 从 localStorage 加载
 * （loadSettings → deepMerge 自动补缺失块），测试先 seed localStorage 再
 * 挂载 Provider，afterEach 清理。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PianoRollView } from "../components/PianoRoll/PianoRollView";
import { App } from "../App";
import { MidiSettings } from "../components/Settings/MidiSettings";
import { I18nProvider } from "../providers/I18nProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { useProjectStore } from "../hooks/useProjectStore";
import { useSettings } from "../hooks/useSettings";
import { SETTINGS_STORAGE_KEY } from "../types/settings";
import styles from "../components/PianoRoll/PianoRoll.module.css";

// jsdom 缺失 Web API（PianoRollView 布局依赖，与被测语义无关）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver =
  globalThis.ResizeObserver ?? ResizeObserverStub;

const tempoMapStub = {
  bpmAt: () => 120,
  meterAt: () => ({ numerator: 4, denominator: 4 }),
  keyAt: () => ({ tonic: "C", mode: "major" }),
  timeAt: () => 0,
  barBeatAt: () => ({ bar: 1, beat: 1 }),
  getBarsDuration: () => 16,
  getTotalSeconds: () => 60,
} as never;

/** 手写 flush：microtask + macrotask 双清（requestMIDIAccess promise 链） */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 手写 waitFor：轮询谓词直到成立或超时（外层不包 act 的轮询体，见 S0 模式） */
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timeout");
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

// ── settings 注入（localStorage seed → loadSettings deepMerge 补缺失块） ──

function seedRecordingSettings(recording: Record<string, unknown>): void {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const midi = (parsed.midi as Record<string, unknown>) ?? {};
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ ...parsed, midi: { ...midi, recording } })
  );
}

// ── MIDI access mock（port id 用 'default'：命中默认 settings.midi.midiDevice.input） ──

interface MockPort {
  id: string;
  state: string;
  onmidimessage: ((event: { data: Uint8Array; timeStamp?: number }) => void) | null;
}

function makeMockPort(id: string): MockPort {
  return { id, state: "connected", onmidimessage: null };
}

function makeMockAccess(ports: MockPort[]) {
  const map = new Map(ports.map((p) => [p.id, p] as const));
  return { inputs: { values: () => map.values() }, onstatechange: null };
}

function stubRequestMidiAccess(access: ReturnType<typeof makeMockAccess>) {
  const requestMIDIAccess = vi.fn().mockResolvedValue(access);
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: requestMIDIAccess,
    configurable: true,
    writable: true,
  });
  return requestMIDIAccess;
}

/** dispatchMidi：直调 onmidimessage；timeStamp 可选（Web MIDI 接收时刻 ms） */
function dispatchMidi(
  port: MockPort,
  bytes: [number, number, number],
  timeStamp?: number
) {
  act(() => {
    port.onmidimessage?.(
      timeStamp !== undefined
        ? { data: new Uint8Array(bytes), timeStamp }
        : { data: new Uint8Array(bytes) }
    );
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  // 还原 navigator（defineProperty 注入的 requestMIDIAccess）
  Reflect.deleteProperty(navigator, "requestMIDIAccess");
  // 清理 settings seed（SettingsProvider 挂载后会把状态写回 localStorage）
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
});

// ── S1-T01: PianoRollView activePitches 键位高亮 ──
describe("PianoRollView activePitches highlight (S1-T01)", () => {
  interface Harness {
    container: HTMLElement;
    cleanup: () => void;
  }

  function renderPianoRoll(
    props: Partial<React.ComponentProps<typeof PianoRollView>> = {}
  ): Harness {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    const base = {
      notes: [],
      tempoMap: tempoMapStub,
      viewRange: { startBar: 1, endBar: 8 },
    };
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <PianoRollView {...base} {...props} />
        </I18nProvider>
      );
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

  function queryActiveKeys(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll(
        `[data-testid="piano-roll"] .${styles.keyActive}`
      )
    );
  }

  it("S1-T01a: activePitches=Set([60]) → 对应键位渲染 keyActive 高亮 (critical)", () => {
    const { container, cleanup } = renderPianoRoll({
      activePitches: new Set([60]),
    });

    // 60 = C4 白键：恰一个高亮键，且落在白键层
    const active = queryActiveKeys(container);
    expect(active.length).toBe(1);
    expect(active[0]!.title).toBe("C4");
    expect(active[0]!.classList.contains(styles.whiteKey)).toBe(true);

    cleanup();
  });

  it("S1-T01b: 黑键 pitch 同样高亮；多 pitch 数量与集合一致 (critical)", () => {
    const { container, cleanup } = renderPianoRoll({
      activePitches: new Set([60, 61]),
    });

    const active = queryActiveKeys(container);
    expect(active.length).toBe(2);
    // 60=C4 白键，61=C#4 黑键（黑键无 title，用 class 区分）
    const whites = active.filter((el) =>
      el.classList.contains(styles.whiteKey)
    );
    const blacks = active.filter((el) =>
      el.classList.contains(styles.blackKey)
    );
    expect(whites.length).toBe(1);
    expect(whites[0]!.title).toBe("C4");
    expect(blacks.length).toBe(1);

    cleanup();
  });

  it("S1-T01c: 不传 activePitches / 空集 → 无高亮、键位 DOM 零行为变化 (critical)", () => {
    // 基线：既有渲染路径
    const base = renderPianoRoll({});
    const baseKeys = base.container.querySelectorAll(
      `[data-testid="piano-roll"] .${styles.whiteKey}, [data-testid="piano-roll"] .${styles.blackKey}`
    );
    expect(queryActiveKeys(base.container).length).toBe(0);

    // undefined / 空集：键位数量一致、无任何 keyActive
    const h1 = renderPianoRoll({ activePitches: undefined });
    const h2 = renderPianoRoll({ activePitches: new Set<number>() });
    for (const h of [h1, h2]) {
      const keys = h.container.querySelectorAll(
        `[data-testid="piano-roll"] .${styles.whiteKey}, [data-testid="piano-roll"] .${styles.blackKey}`
      );
      expect(keys.length).toBe(baseKeys.length);
      expect(queryActiveKeys(h.container).length).toBe(0);
      h.cleanup();
    }

    base.cleanup();
  });
});

// ── v1.25 S1-T02 / S1-T03（v1.26 零回归锚点）: App MIDI 录入闭环 ──
describe("App MIDI input loop (v1.25 S1-T02/T03, v1.26 零回归锚点)", () => {
  /** 共享 store 探针：把 notes 序列化到 DOM，供断言差集与字段映射 */
  function NotesProbe() {
    const { notes } = useProjectStore();
    return (
      <div
        data-testid="probe-notes"
        data-count={String(notes.length)}
        data-notes={JSON.stringify(notes)}
      />
    );
  }

  interface AppHarness {
    container: HTMLElement;
    readNotes: () => Array<Record<string, unknown>>;
    cleanup: () => void;
  }

  function renderApp(): AppHarness {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <ProjectProvider>
            <SettingsProvider>
              <App />
              <NotesProbe />
            </SettingsProvider>
          </ProjectProvider>
        </I18nProvider>
      );
    });
    const readNotes = () => {
      const probe = container.querySelector('[data-testid="probe-notes"]');
      if (!probe) throw new Error("probe-notes not found");
      return JSON.parse(probe.getAttribute("data-notes")!) as Array<
        Record<string, unknown>
      >;
    };
    return {
      container,
      readNotes,
      cleanup() {
        act(() => {
          root.unmount();
          container.remove();
        });
      },
    };
  }

  function queryActiveKeys(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll(
        `[data-testid="piano-roll"] .${styles.keyActive}`
      )
    );
  }

  it("S1-T02: 注入 timeStamp(1000/1500) → durQn=1(500ms@120bpm) + trackId/pitchMidi/velocity/bar/beat 映射不变 (v1.26 S1-T01 零回归锚点, critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { container, readNotes, cleanup } = renderApp();
    await flush(); // 等待 requestMIDIAccess promise → 端口绑定

    expect(port.onmidimessage).toBeTypeOf("function");
    expect(queryActiveKeys(container).length).toBe(0);

    const before = readNotes();

    // noteon 60 velocity 100, timeStamp 1000 → C4 键位高亮
    dispatchMidi(port, [0x90, 60, 100], 1000);
    expect(queryActiveKeys(container).length).toBe(1);
    expect(queryActiveKeys(container)[0]!.title).toBe("C4");

    // noteoff timeStamp 1500 → 按住 500ms = 1 拍 @120bpm
    dispatchMidi(port, [0x80, 60, 0], 1500);
    await waitFor(() => readNotes().length === before.length + 1);
    expect(queryActiveKeys(container).length).toBe(0);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(1);
    const note = added[0]!;
    expect(note.trackId).toBe("default");
    expect(note.pitchMidi).toBe(60);
    expect(note.velocity).toBeCloseTo(100 / 127, 10);
    expect(note.bar).toBe(1);
    expect(note.beat).toBe(1);
    expect(note.durQn).toBe(1);

    cleanup();
  });

  it("S1-T03: 连续 5 音(逐音注入 500ms) cursor 步进 — beat 累计, beat>4 → bar+1 / beat 回绕 (v1.26 零回归锚点, critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { container, readNotes, cleanup } = renderApp();
    await flush();

    const before = readNotes();

    // 5 个音：每音按住 500ms = 1 拍 → (1,1)(1,2)(1,3)(1,4) → 第 5 音
    // beat 4+1=5 > 4 → bar+1 / beat 回绕 → (2,1)
    const pitches = [60, 62, 64, 65, 67];
    pitches.forEach((pitch, i) => {
      const tOn = 1000 + i * 2000;
      dispatchMidi(port, [0x90, pitch, 90], tOn);
      dispatchMidi(port, [0x80, pitch, 0], tOn + 500);
    });
    await waitFor(() => readNotes().length === before.length + 5);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(5);
    const byPitch = new Map(added.map((n) => [n.pitchMidi, n]));
    const positions = pitches.map((p) => {
      const n = byPitch.get(p)!;
      return { bar: n.bar, beat: n.beat };
    });
    expect(positions).toEqual([
      { bar: 1, beat: 1 },
      { bar: 1, beat: 2 },
      { bar: 1, beat: 3 },
      { bar: 1, beat: 4 },
      { bar: 2, beat: 1 },
    ]);
    // 高亮全部清除（最后一个音 noteoff 后无残留）
    expect(queryActiveKeys(container).length).toBe(0);

    cleanup();
  });
});

// ── v1.26 S1-T02: quantize 集成 + computeNoteOffPlacement 纯函数直测 ──
describe("v1.26 quantize recording (S1-T02)", () => {
  function NotesProbe() {
    const { notes } = useProjectStore();
    return (
      <div
        data-testid="probe-notes"
        data-count={String(notes.length)}
        data-notes={JSON.stringify(notes)}
      />
    );
  }

  function renderAppWithRecording(recording: Record<string, unknown>) {
    seedRecordingSettings({
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 100,
      ...recording,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <ProjectProvider>
            <SettingsProvider>
              <App />
              <NotesProbe />
            </SettingsProvider>
          </ProjectProvider>
        </I18nProvider>
      );
    });
    const readNotes = () => {
      const probe = container.querySelector('[data-testid="probe-notes"]');
      if (!probe) throw new Error("probe-notes not found");
      return JSON.parse(probe.getAttribute("data-notes")!) as Array<
        Record<string, unknown>
      >;
    };
    return {
      container,
      readNotes,
      cleanup() {
        act(() => {
          root.unmount();
          container.remove();
        });
      },
    };
  }

  it("computeNoteOffPlacement unit: landing>4 防御分支 — cursor.beat=4.9 → bar 回绕到下一小节 (critical)", async () => {
    // 纯函数直测（动态 import，避免实现前模块级引用污染其他用例的 RED）
    const { computeNoteOffPlacement } = await import("../App");
    // cursor.beat=4.9（1 + 1.3*3）：落盘点 4.9 越过小节 → 回绕 (2, 0.9)
    const p = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 4.9 },
      elapsedMs: 500,
      bpm: 120,
      grid: 0,
    });
    expect(p.bar).toBe(2);
    expect(p.beat).toBeCloseTo(0.9, 10);
    expect(p.durQn).toBe(1);
    expect(p.nextCursor.bar).toBe(2);
    expect(p.nextCursor.beat).toBeCloseTo(1.9, 10);
  });

  it("computeNoteOffPlacement unit: grid=0.25 → landing 是 grid 倍数; clamp 上下界; cursor 步进回绕 (critical)", async () => {
    const { computeNoteOffPlacement } = await import("../App");

    // 量化：cursor.beat=1.1（非 grid 值）→ landing 量化到 1.0
    const q = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 1.1 },
      elapsedMs: 500,
      bpm: 120,
      grid: 0.25,
    });
    expect(q.beat).toBe(1);
    expect(q.durQn).toBe(1);
    expect(q.nextCursor).toEqual({ bar: 1, beat: 2 });

    // clamp 下界：5ms ≈ 0.01 拍 → 0.25；elapsed<=0 → 0.25
    const lo = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 1 },
      elapsedMs: 5,
      bpm: 120,
      grid: 0,
    });
    expect(lo.durQn).toBe(0.25);
    const zero = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 1 },
      elapsedMs: 0,
      bpm: 120,
      grid: 0,
    });
    expect(zero.durQn).toBe(0.25);

    // clamp 上界：5000ms @120bpm = 10 拍 → 8
    const hi = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 1 },
      elapsedMs: 5000,
      bpm: 120,
      grid: 0,
    });
    expect(hi.durQn).toBe(8);

    // cursor 步进回绕：landing 3.5 + durQn 4 = 7.5 > 4 → 下一小节 3.5
    const wrap = computeNoteOffPlacement({
      cursor: { bar: 1, beat: 3.5 },
      elapsedMs: 2000,
      bpm: 120,
      grid: 0,
    });
    expect(wrap.beat).toBe(3.5);
    expect(wrap.nextCursor).toEqual({ bar: 2, beat: 3.5 });
  });

  it("integration: grid=0.25 + cursor 非对齐(1.82) → 落盘 beat 是 grid 倍数(1.75) (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { readNotes, cleanup } = renderAppWithRecording({
      quantizeGrid: 0.25,
    });
    await flush();

    const before = readNotes();

    // 第一音 410ms = 0.82 拍 → 落盘 (1,1)，cursor 前进到 1.82（非 grid 值）
    dispatchMidi(port, [0x90, 60, 90], 1000);
    dispatchMidi(port, [0x80, 60, 0], 1410);
    // 第二音 500ms = 1 拍 → landing = snap(1.82, 0.25) = 1.75（grid 倍数）
    dispatchMidi(port, [0x90, 62, 90], 2000);
    dispatchMidi(port, [0x80, 62, 0], 2500);
    await waitFor(() => readNotes().length === before.length + 2);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(2);
    const byPitch = new Map(added.map((n) => [n.pitchMidi, n]));
    const n1 = byPitch.get(60)!;
    const n2 = byPitch.get(62)!;
    expect(n1.bar).toBe(1);
    expect(n1.beat).toBe(1);
    expect(n1.durQn).toBeCloseTo(0.82, 10);
    // 1.82 非对齐 → snap 到 1.75（7 * 0.25，浮点精确可表示）
    expect(n2.bar).toBe(1);
    expect(n2.beat).toBe(1.75);
    expect(n2.durQn).toBe(1);

    cleanup();
  });

  it("integration: 三个 1.3 拍音驱动 cursor 越过小节 → 第四音落点回绕到下一小节 (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { readNotes, cleanup } = renderAppWithRecording({
      quantizeGrid: 0.25,
    });
    await flush();

    const before = readNotes();

    // 每音 650ms = 1.3 拍 @120bpm：
    // 音1 落 (1,1)         cursor → 2.3
    // 音2 落 (1,2.25)      cursor → 3.55
    // 音3 落 (1,3.5)       cursor → 4.8 → 回绕 (2,0.8)
    // 音4 landing=snap(0.8)=0.75 → 落点在下一小节 (2,0.75)
    const pitches = [60, 62, 64, 65];
    pitches.forEach((pitch, i) => {
      const tOn = 1000 + i * 2000;
      dispatchMidi(port, [0x90, pitch, 90], tOn);
      dispatchMidi(port, [0x80, pitch, 0], tOn + 650);
    });
    await waitFor(() => readNotes().length === before.length + 4);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(4);
    const byPitch = new Map(added.map((n) => [n.pitchMidi, n]));
    const n1 = byPitch.get(60)!;
    const n2 = byPitch.get(62)!;
    const n3 = byPitch.get(64)!;
    const n4 = byPitch.get(65)!;
    expect(n1.bar).toBe(1);
    expect(n1.beat).toBe(1);
    expect(n2.bar).toBe(1);
    expect(n2.beat).toBe(2.25);
    expect(n3.bar).toBe(1);
    expect(n3.beat).toBe(3.5);
    // cursor 回绕后第四音落点在下一小节
    expect(n4.bar).toBe(2);
    expect(n4.beat).toBe(0.75);
    for (const n of [n1, n2, n3, n4]) {
      expect(n.durQn).toBeCloseTo(1.3, 10);
    }

    cleanup();
  });
});

// ── v1.26 S1-T03: fixed velocity ──
describe("v1.26 fixed velocity recording (S1-T03)", () => {
  function NotesProbe() {
    const { notes } = useProjectStore();
    return (
      <div
        data-testid="probe-notes"
        data-count={String(notes.length)}
        data-notes={JSON.stringify(notes)}
      />
    );
  }

  it("velocityMode=fixed + fixedVelocity=100 → 落盘 velocity=100/127，不随实时 velocity(40) 变化 (critical)", async () => {
    seedRecordingSettings({
      quantizeGrid: 0,
      velocityMode: "fixed",
      fixedVelocity: 100,
    });
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <ProjectProvider>
            <SettingsProvider>
              <App />
              <NotesProbe />
            </SettingsProvider>
          </ProjectProvider>
        </I18nProvider>
      );
    });
    await flush();

    const readNotes = () => {
      const probe = container.querySelector('[data-testid="probe-notes"]');
      if (!probe) throw new Error("probe-notes not found");
      return JSON.parse(probe.getAttribute("data-notes")!) as Array<
        Record<string, unknown>
      >;
    };
    const before = readNotes();

    // noteon 实时 velocity 40 → fixed 模式下落盘仍为 fixedVelocity/127
    dispatchMidi(port, [0x90, 60, 40], 1000);
    dispatchMidi(port, [0x80, 60, 0], 1500);
    await waitFor(() => readNotes().length === before.length + 1);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(1);
    expect(added[0]!.velocity).toBeCloseTo(100 / 127, 10);

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});

// ── v1.26 S1-T04: 实测 durQn 变体 ──
describe("v1.26 measured durQn variants (S1-T04)", () => {
  function NotesProbe() {
    const { notes } = useProjectStore();
    return (
      <div
        data-testid="probe-notes"
        data-count={String(notes.length)}
        data-notes={JSON.stringify(notes)}
      />
    );
  }

  it("250ms→0.5 拍; 5ms→clamp 0.25; 2000ms→4 拍 (grid=0 off) (critical)", async () => {
    seedRecordingSettings({
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 100,
    });
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <ProjectProvider>
            <SettingsProvider>
              <App />
              <NotesProbe />
            </SettingsProvider>
          </ProjectProvider>
        </I18nProvider>
      );
    });
    await flush();

    const readNotes = () => {
      const probe = container.querySelector('[data-testid="probe-notes"]');
      if (!probe) throw new Error("probe-notes not found");
      return JSON.parse(probe.getAttribute("data-notes")!) as Array<
        Record<string, unknown>
      >;
    };
    const before = readNotes();

    // 音1: 250ms @120bpm = 0.5 拍 → 落 (1,1)，cursor → 1.5
    dispatchMidi(port, [0x90, 60, 90], 1000);
    dispatchMidi(port, [0x80, 60, 0], 1250);
    // 音2: 5ms → clamp 下限 0.25 → 落 (1,1.5)，cursor → 1.75
    dispatchMidi(port, [0x90, 62, 90], 2000);
    dispatchMidi(port, [0x80, 62, 0], 2005);
    // 音3: 2000ms = 4 拍（clamp 内）→ 落 (1,1.75)，cursor → 5.75 → (2,1.75)
    dispatchMidi(port, [0x90, 64, 90], 3000);
    dispatchMidi(port, [0x80, 64, 0], 5000);
    await waitFor(() => readNotes().length === before.length + 3);

    const added = readNotes().filter(
      (n) => !before.some((b) => b.id === n.id)
    );
    expect(added.length).toBe(3);
    const byPitch = new Map(added.map((n) => [n.pitchMidi, n]));
    expect(byPitch.get(60)!.durQn).toBe(0.5);
    expect(byPitch.get(62)!.durQn).toBe(0.25);
    expect(byPitch.get(64)!.durQn).toBe(4);
    expect(byPitch.get(60)!.beat).toBe(1);
    expect(byPitch.get(62)!.beat).toBe(1.5);
    expect(byPitch.get(64)!.beat).toBe(1.75);

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});

// ── v1.26 S1-T05: MidiSettings 录入设置接线 ──
describe("v1.26 MidiSettings recording wiring (S1-T05)", () => {
  /** settings 探针：把 midi 块序列化到 DOM，断言 updateSettings 后的真实状态 */
  function SettingsProbe() {
    const { settings } = useSettings();
    return (
      <div data-testid="probe-settings" data-midi={JSON.stringify(settings.midi)} />
    );
  }

  function renderMidiSettingsWithProbe() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <SettingsProvider>
            <MidiSettings />
            <SettingsProbe />
          </SettingsProvider>
        </I18nProvider>
      );
    });
    const readMidi = () => {
      const probe = container.querySelector('[data-testid="probe-settings"]');
      if (!probe) throw new Error("probe-settings not found");
      return JSON.parse(probe.getAttribute("data-midi")!) as {
        recording: {
          quantizeGrid: number;
          velocityMode: string;
          fixedVelocity: number;
        };
      };
    };
    return {
      container,
      readMidi,
      cleanup() {
        act(() => {
          root.unmount();
          container.remove();
        });
      },
    };
  }

  /** select 变更：原生 setter + change 事件（React 受控组件模式） */
  async function setSelectValue(el: HTMLSelectElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  /** input 变更：原生 setter + input 事件 */
  async function setInputValue(el: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("recording-grid 变更 → quantizeGrid=0.25; velocity-mode → fixed; fixed-velocity 1-127 clamp (critical)", async () => {
    const { container, readMidi, cleanup } = renderMidiSettingsWithProbe();

    const gridSelect = container.querySelector(
      '[data-testid="recording-grid"]'
    ) as HTMLSelectElement;
    expect(gridSelect).not.toBeNull();
    expect(gridSelect.value).toBe("0");

    const modeSelect = container.querySelector(
      '[data-testid="recording-velocity-mode"]'
    ) as HTMLSelectElement;
    expect(modeSelect).not.toBeNull();
    expect(modeSelect.value).toBe("live");

    // live 模式下 fixed velocity 输入禁用
    const fixedInput = container.querySelector(
      '[data-testid="recording-fixed-velocity"]'
    ) as HTMLInputElement;
    expect(fixedInput).not.toBeNull();
    expect(fixedInput.disabled).toBe(true);

    // grid 变更 → 设置状态落地 quantizeGrid=0.25（真实 Provider，语义等同
    // updateSettings({midi:{recording:{quantizeGrid:0.25}}})）
    await setSelectValue(gridSelect, "0.25");
    expect(readMidi().recording.quantizeGrid).toBe(0.25);

    // velocity 模式变更 → fixed；输入解除禁用
    await setSelectValue(modeSelect, "fixed");
    expect(readMidi().recording.velocityMode).toBe("fixed");
    expect(fixedInput.disabled).toBe(false);

    // fixed velocity 正常值
    await setInputValue(fixedInput, "64");
    expect(readMidi().recording.fixedVelocity).toBe(64);

    // clamp 上界：200 → 127
    await setInputValue(fixedInput, "200");
    expect(readMidi().recording.fixedVelocity).toBe(127);

    // clamp 下界：0 → 1
    await setInputValue(fixedInput, "0");
    expect(readMidi().recording.fixedVelocity).toBe(1);

    cleanup();
  });
});
