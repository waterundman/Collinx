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
import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
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

// ── v1.27.0 Stage 1 (S1-T01/T02): App 接线 cursorPosition / quantizeGridHint ──
//
// 断言策略（选 a，canvas mock）：S0 已在组件级验证 createRecordingCtx +
// vi.spyOn(HTMLCanvasElement.prototype, "getContext") 模式可行；App 渲染下
// PianoRollView 仍是唯一 canvas 消费方，把同一 spy 提到 App 全量渲染层即可
// 直接断言 draw call（accent 竖线 x 值 / m 标签 / globalAlpha），比 prop 层
// spy（方案 b，只能证明"传了值"）多覆盖"值 → 绘制"整段链路，且复用 S0
// harness 成本低。app 初始 cursor(1,1) 第一帧即画 m1.1，落盘后断言 m1.2
// 出现且 fillText 调用顺序在 m1.1 之后（位置前进）。
describe("v1.27 App cursor wiring (S1-T01/T02)", () => {
  type DrawCall = { op: string; args: unknown[] };

  // 与 S0 PianoRollView.test.tsx 同款记录型 ctx（跨测试文件 import 会执行
  // 其 describe 注册，故复制）
  function createRecordingCtx() {
    const calls: DrawCall[] = [];
    const methods = [
      "scale",
      "clearRect",
      "fillRect",
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "fill",
      "fillText",
      "closePath",
      "quadraticCurveTo",
    ];
    const target: Record<string, unknown> = {};
    for (const m of methods) {
      target[m] = (...args: unknown[]) => {
        calls.push({ op: m, args });
      };
    }
    target.createLinearGradient = (...args: unknown[]) => {
      calls.push({ op: "createLinearGradient", args });
      return { addColorStop: () => {} };
    };
    const ctx = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === "string" && prop in t) return t[prop];
        return undefined;
      },
      set(t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, args: [value] });
        Reflect.set(t, prop, value);
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

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

  // 默认 canvasSize {width:800, height:600}、pixelsPerBeat 40、scrollX 0
  //（ResizeObserver stub 不触发回调）。App 侧 viewRange={startBar:1, endBar:8}。
  const CANVAS_H = 600;

  const { ctx, calls } = createRecordingCtx();

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** 竖线绘制集合：moveTo(x, 0) + lineTo(x, CANVAS_H) 的 x 值序列（同 S0） */
  function verticalLineXs(): number[] {
    const xs: number[] = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        calls[i + 1]?.op === "lineTo" &&
        calls[i + 1].args[0] === c.args[0] &&
        calls[i + 1].args[1] === CANVAS_H
      ) {
        xs.push(Number(c.args[0]));
      }
    }
    return xs;
  }

  const fillTexts = (): string[] =>
    calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));

  const propSets = (name: string): unknown[] =>
    calls.filter((c) => c.op === `set:${name}`).map((c) => c.args[0]);

  it("S1-T01: 落盘步进 → cursor 竖线 x 前进(-0.5→39.5→79.5) + m 标签顺序 (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { readNotes, cleanup } = renderAppWithRecording({
      quantizeGrid: 0,
    });
    await flush();

    const before = readNotes();

    // 初始 cursor (1,1)：首帧已画 accent 竖线（2px）+ m1.1 标签
    expect(fillTexts()).toContain("m1.1");
    expect(verticalLineXs()).toContain(-0.5);
    expect(propSets("lineWidth")).toContain(2);

    // 音1: 500ms=1拍 → 落(1,1) → cursor 前进到 (1,2)（ticks=1 → x=40 → 39.5）
    dispatchMidi(port, [0x90, 60, 90], 1000);
    dispatchMidi(port, [0x80, 60, 0], 1500);
    await waitFor(() => readNotes().length === before.length + 1);
    await waitFor(() => fillTexts().includes("m1.2"));

    // 音2 → cursor 前进到 (1,3)（ticks=2 → x=80 → 79.5）
    dispatchMidi(port, [0x90, 62, 90], 3000);
    dispatchMidi(port, [0x80, 62, 0], 3500);
    await waitFor(() => readNotes().length === before.length + 2);
    await waitFor(() => fillTexts().includes("m1.3"));

    // 标签按落盘顺序前进：m1.1 → m1.2 → m1.3
    const texts = fillTexts();
    expect(texts.indexOf("m1.2")).toBeGreaterThan(texts.indexOf("m1.1"));
    expect(texts.indexOf("m1.3")).toBeGreaterThan(texts.indexOf("m1.2"));
    // 竖线 x 随步进前进（Math.round(x)+0.5-1 取整，与 S0-T01 同式）
    const xs = verticalLineXs();
    expect(xs).toContain(-0.5);
    expect(xs).toContain(39.5);
    expect(xs).toContain(79.5);

    cleanup();
  });

  it("S1-T02: grid=0.25 → cursor 前进=量化落点+durQn(整数拍步进) + hint 传递(zoom 后细分线) (non-critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { container, readNotes, cleanup } = renderAppWithRecording({
      quantizeGrid: 0.25,
    });
    await flush();

    const before = readNotes();

    // 音1: 500ms=1拍 → landing snap(1)=1, durQn=1 → 落(1,1) → cursor (1,2)
    dispatchMidi(port, [0x90, 60, 90], 1000);
    dispatchMidi(port, [0x80, 60, 0], 1500);
    await waitFor(() => readNotes().length === before.length + 1);
    await waitFor(() => fillTexts().includes("m1.2"));

    // 音2: landing snap(2)=2, durQn=1 → 落(1,2) → cursor (1,3)
    dispatchMidi(port, [0x90, 62, 90], 3000);
    dispatchMidi(port, [0x80, 62, 0], 3500);
    await waitFor(() => readNotes().length === before.length + 2);
    await waitFor(() => fillTexts().includes("m1.3"));

    // cursor x 随量化落点+durQn 整数拍步进：39.5 → 79.5
    const xs = verticalLineXs();
    expect(xs).toContain(39.5);
    expect(xs).toContain(79.5);

    // quantizeGridHint 传递断言：默认 pixelsPerBeat=40 → 40*0.25=10<12
    // 密度不足零绘制；zoom-in 后 48*0.25=12 达标 → 细分线出现。若 App 未把
    // recording.quantizeGrid 传给 quantizeGridHint，两条断言均不成立。
    expect(propSets("globalAlpha")).not.toContain(0.25);
    expect(verticalLineXs()).not.toContain(12.5);
    act(() => {
      container
        .querySelector('[data-testid="piano-roll-zoom-in"]')!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
    });
    expect(propSets("globalAlpha")).toContain(0.25);
    // beat0 内 k=1 细分线：sx = 1*0.25*48 = 12 → 12.5
    expect(verticalLineXs()).toContain(12.5);

    cleanup();
  });
});

// ── v1.28.0 Stage 1 (S1-T01/T02): App 接线 autoScrollFollow（录入跟随） ──
//
// 断言策略：沿用上段 v1.27 App 级 canvas spy harness（getContext → 记录型 ctx），
// 在 App 全量渲染下断言 draw call —— 滚动是否发生、滚动量是否为推导值。
//
// harness 实态（读后确认；数值全部由公式推导，禁止魔法数）：
//   - canvasSize = { width: 800, height: 600 }：PianoRollView 的 useState 初值，
//     ResizeObserver stub 不回调 → 恒为初值；
//   - pixelsPerBeat = 40（useState 初值）、BEATS_PER_BAR = 4；
//   - App 调用点 viewRange = { startBar: 1, endBar: 8 }（App.tsx:911）
//     → totalBeats = (8-1+1)*4 = 32 → totalWidth = 32*40 = 1280
//     → maxScrollX = 1280 - 800 = 480；
//   - FOLLOW_EDGE_MARGIN = 48（PianoRollView.tsx:45）→ 右缘阈值 = 800 - 48 = 752。
//
// cursor 步进推导（120bpm；每音 noteon→noteoff 相隔 500ms = 1 拍 → durQn=1，
// 与 v1.25/v1.26 既有锚点一致）：
//   第 N 音后 inputCursor = bar 1+floor(N/4) / beat (N mod 4)+1
//   → cursorTicks = (bar-1)*4 + (beat-1) = N；未滚动时 cursorX = N*40。
//   N ≤ 18 → cursorX ≤ 720 ≤ 752 不触发；
//   N = 19 → cursorX = 760 > 752 → newScrollX = 760-752 = 8（0 ≤ 8 ≤ 480 未钳制）；
//   N = 20 → cursorX = 800-8 = 792 > 752 → newScrollX = 800-752 = 48。
//   故取 N = 20：末帧 scrollX = 48，cursor 竖线 x = 20*40 - 48 = 752 → 751.5。
//
// S1-T02 对照方案选择：App 现无条件传 autoScrollFollow=true，App 级"关闭跟随"
// 场景不可得（新增测试专用 prop 会污染生产接口，违反"既有接线零变化"）。故采用
// 同文件组件级直渲 PianoRollView 作对照：同一 canvas harness、同 viewRange /
// cursorPosition，仅缺 autoScrollFollow 一项 → 唯一差异即该 flag，可隔离因果因子。
describe("v1.28.0 App autoScrollFollow wiring (S1-T01/T02)", () => {
  type DrawCall = { op: string; args: unknown[] };

  // 与 S0 PianoRollView.test.tsx / 上段 v1.27 同款记录型 ctx（跨测试文件 import
  // 会执行其 describe 注册，故复制）。
  function createRecordingCtx() {
    const calls: DrawCall[] = [];
    const methods = [
      "scale",
      "clearRect",
      "fillRect",
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "fill",
      "fillText",
      "closePath",
      "quadraticCurveTo",
    ];
    const target: Record<string, unknown> = {};
    for (const m of methods) {
      target[m] = (...args: unknown[]) => {
        calls.push({ op: m, args });
      };
    }
    target.createLinearGradient = (...args: unknown[]) => {
      calls.push({ op: "createLinearGradient", args });
      return { addColorStop: () => {} };
    };
    const ctx = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === "string" && prop in t) return t[prop];
        return undefined;
      },
      set(t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, args: [value] });
        Reflect.set(t, prop, value);
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

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

  // harness 实态常量（见上方推导）
  const CANVAS_W = 800;
  const CANVAS_H = 600;
  const PPB = 40;
  const BEATS_PER_BAR = 4;
  const FOLLOW_EDGE_MARGIN = 48;
  const RIGHT_EDGE = CANVAS_W - FOLLOW_EDGE_MARGIN; // 752
  /** 触发跟随所需音数：cursorX = N*PPB > RIGHT_EDGE → N ≥ 19；取 20 使滚动量确定。 */
  const NOTE_COUNT = 20;
  /** 未越缘音数：cursorX = 18*40 = 720 ≤ 752。 */
  const PRE_EDGE = 18;

  const { ctx, calls } = createRecordingCtx();

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** 每帧以 drawCanvas 起手的 ctx.scale(dpr,dpr) 为界切分（同 S0 frames()）。 */
  function frames(): DrawCall[][] {
    const out: DrawCall[][] = [];
    let cur: DrawCall[] | null = null;
    for (const c of calls) {
      if (c.op === "scale") {
        cur = [];
        out.push(cur);
      }
      if (cur) cur.push(c);
    }
    return out;
  }

  function lastFrame(): DrawCall[] {
    const fs = frames();
    return fs.length > 0 ? fs[fs.length - 1] : [];
  }

  /** 竖线绘制（moveTo(x, 0) + lineTo(x, CANVAS_H)）：网格线与 cursor 竖线共用。 */
  function verticalLineXsIn(frame: DrawCall[]): number[] {
    const xs: number[] = [];
    for (let i = 0; i < frame.length; i++) {
      const c = frame[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        frame[i + 1]?.op === "lineTo" &&
        frame[i + 1].args[0] === c.args[0] &&
        frame[i + 1].args[1] === CANVAS_H
      ) {
        xs.push(Number(c.args[0]));
      }
    }
    return xs;
  }

  /** cursor 位置标签（m{bar}.{beat}）及其 x/y。 */
  function cursorLabelsIn(frame: DrawCall[]) {
    return frame
      .filter((c) => c.op === "fillText" && /^m\d+\.\d+$/.test(String(c.args[0])))
      .map((c) => ({
        text: String(c.args[0]),
        x: Number(c.args[1]),
        y: Number(c.args[2]),
      }));
  }

  it("S1-T01: App 接线后同步进序列 → cursor 越右缘(752) 触发跟随，末帧竖线落回视口内 (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { readNotes, cleanup } = renderAppWithRecording({ quantizeGrid: 0 });
    await flush();

    const before = readNotes();

    // 音高循环取用（仅避免同 pitch 叠加；pitchMidi 不参与 cursor 推导）
    const PITCHES = Array.from({ length: NOTE_COUNT }, (_, i) => 60 + (i % 12));

    // 前 18 音：cursorTicks ≤ 18 → cursorX ≤ 720 ≤ 752 → 不触发跟随
    PITCHES.slice(0, PRE_EDGE).forEach((pitch, i) => {
      const tOn = 1000 + i * 2000;
      dispatchMidi(port, [0x90, pitch, 90], tOn);
      dispatchMidi(port, [0x80, pitch, 0], tOn + 500);
    });
    await waitFor(() => readNotes().length === before.length + PRE_EDGE);

    // 未越缘：末帧 scrollX=0 → beat0 在 0.5、cursor 竖线在 719.5
    const preLines = verticalLineXsIn(lastFrame());
    expect(preLines).toContain(Math.round(0 * PPB) + 0.5);
    expect(preLines).toContain(Math.round(PRE_EDGE * PPB) + 0.5 - 1);
    expect(preLines).not.toContain(RIGHT_EDGE - 0.5); // 751.5 = 跟随后的位置

    // 第 19、20 音：越过右缘 → 跟随滚动
    PITCHES.slice(PRE_EDGE).forEach((pitch, i) => {
      const idx = PRE_EDGE + i;
      const tOn = 1000 + idx * 2000;
      dispatchMidi(port, [0x90, pitch, 90], tOn);
      dispatchMidi(port, [0x80, pitch, 0], tOn + 500);
    });
    await waitFor(() => readNotes().length === before.length + NOTE_COUNT);

    // 推导末帧：scrollX = 20*40 - 752 = 48；cursorX = 800 - 48 = 752
    const EXPECTED_SCROLL_X = NOTE_COUNT * PPB - RIGHT_EDGE;
    expect(EXPECTED_SCROLL_X).toBe(48);
    const expectedCursorX = NOTE_COUNT * PPB - EXPECTED_SCROLL_X;
    expect(expectedCursorX).toBe(752);

    // 滚动发生 → 至少一次 setScrollX 引发的第二帧
    expect(frames().length).toBeGreaterThanOrEqual(2);

    const lines = verticalLineXsIn(lastFrame());
    const cursorLine = Math.round(expectedCursorX) + 0.5 - 1; // 751.5
    expect(lines).toContain(cursorLine);
    expect(cursorLine).toBeGreaterThanOrEqual(0);
    expect(cursorLine).toBeLessThanOrEqual(CANVAS_W);
    // 网格同步平移：beat2 → 2*40 - 48 = 32 → 32.5
    expect(lines).toContain(Math.round(2 * PPB - EXPECTED_SCROLL_X) + 0.5);
    // 反证未滚动：cursor 竖线会是 799.5、beat0 会是 0.5（scrollX=0 才出现）
    expect(lines).not.toContain(Math.round(NOTE_COUNT * PPB) + 0.5 - 1);
    expect(lines).not.toContain(Math.round(0 * PPB) + 0.5);

    // 标签右移 6px：x = 752 + 6 = 758；落点 bar6 beat1（N=20 → ticks 20）
    const labels = cursorLabelsIn(lastFrame());
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      text: "m6.1",
      x: expectedCursorX + 6,
      y: 12,
    });
    expect(labels[0].x).toBeLessThanOrEqual(CANVAS_W);

    cleanup();
  });

  it("S1-T02: 对照——同 viewRange/cursor 但不传 autoScrollFollow → 不滚动 (non-critical)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <PianoRollView
            notes={[]}
            tempoMap={tempoMapStub}
            viewRange={{ startBar: 1, endBar: 8 }}
            cursorPosition={{ bar: 6, beat: 1 }} // = S1-T01 第 20 音后的 App inputCursor
          />
        </I18nProvider>
      );
    });

    // 未传 autoScrollFollow（默认 false）→ 无滚动副作用 → 仅一帧
    expect(frames()).toHaveLength(1);
    const lines = verticalLineXsIn(lastFrame());
    expect(lines).toContain(Math.round(0 * PPB) + 0.5); // beat0 → 0.5（scrollX=0）
    // cursor ticks = (6-1)*4 + (1-1) = 20 → cursorX = 800 → 799.5（未跟随）
    expect(lines).toContain(Math.round(20 * PPB) + 0.5 - 1);
    expect(lines).not.toContain(RIGHT_EDGE - 0.5); // 751.5（仅跟随开启才出现）
    expect(cursorLabelsIn(lastFrame())[0]).toMatchObject({
      text: "m6.1",
      x: 800 + 6,
    });

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
