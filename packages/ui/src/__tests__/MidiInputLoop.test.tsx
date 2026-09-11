/**
 * v1.25.0 Stage 1 (S1-T01~T03): MIDI 输入闭环测试
 *
 * - S1-T01: PianoRollView activePitches 键位高亮（undefined/空集零行为变化）
 * - S1-T02: App 全量渲染录入闭环（noteon 高亮 → noteoff 落盘 + 高亮清除）
 * - S1-T03: 连续多音 cursor 步进（beat 累计；beat>4 → bar+1 / beat 回绕，4/4）
 *
 * harness 约定（项目无 @testing-library/react）：createRoot + act 手写，
 * 沿用 S0 useMidiInput.test.tsx（flush）与 v1.24 SettingsModalWiring.test.tsx
 * （App 全量渲染 + waitFor）模式。mock navigator.requestMIDIAccess 用
 * Object.defineProperty（App 全量渲染下不能整只替换 navigator，避免破坏
 * 其他 Web API 读取方；语义与 vi.stubGlobal 一致，测试后删除属性还原）。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PianoRollView } from "../components/PianoRoll/PianoRollView";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { useProjectStore } from "../hooks/useProjectStore";
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

// ── MIDI access mock（port id 用 'default'：命中默认 settings.midi.midiDevice.input） ──

interface MockPort {
  id: string;
  state: string;
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
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

function dispatchMidi(
  port: MockPort,
  bytes: [number, number, number]
) {
  act(() => {
    port.onmidimessage?.({ data: new Uint8Array(bytes) });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  // 还原 navigator（defineProperty 注入的 requestMIDIAccess）
  Reflect.deleteProperty(navigator, "requestMIDIAccess");
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

// ── S1-T02 / S1-T03: App MIDI 录入闭环（integration） ──
describe("App MIDI input loop (S1-T02/T03)", () => {
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

  it("S1-T02: noteon → 高亮出现; noteoff → 落盘(pitchMidi/velocity/bar/beat 映射) + 高亮清除 (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { container, readNotes, cleanup } = renderApp();
    await flush(); // 等待 requestMIDIAccess promise → 端口绑定

    expect(port.onmidimessage).toBeTypeOf("function");
    expect(queryActiveKeys(container).length).toBe(0);

    const before = readNotes();

    // noteon 60 velocity 100 → C4 键位高亮
    dispatchMidi(port, [0x90, 60, 100]);
    expect(queryActiveKeys(container).length).toBe(1);
    expect(queryActiveKeys(container)[0]!.title).toBe("C4");

    // noteoff → 高亮清除 + 落盘
    dispatchMidi(port, [0x80, 60, 0]);
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

  it("S1-T03: 连续多音 cursor 步进 — beat 累计, beat>4 → bar+1 / beat 回绕 (critical)", async () => {
    const port = makeMockPort("default");
    stubRequestMidiAccess(makeMockAccess([port]));

    const { container, readNotes, cleanup } = renderApp();
    await flush();

    const before = readNotes();

    // 5 个音：cursor (1,1) → 每音 dur 1 拍步进 → (1,1)(1,2)(1,3)(1,4) → 第 5 音
    // beat 4+1=5 > 4 → bar+1 / beat 回绕 → (2,1)
    const pitches = [60, 62, 64, 65, 67];
    for (const pitch of pitches) {
      dispatchMidi(port, [0x90, pitch, 90]);
      dispatchMidi(port, [0x80, pitch, 0]);
    }
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
