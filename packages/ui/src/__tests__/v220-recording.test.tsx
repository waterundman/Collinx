/**
 * v2.2.0 S2 (T44)：实时录制 App 级护栏。
 *
 * 真实 App（真实 Provider 链）+ mock useMidiInput（测试注入硬件事件）
 * + mock PianoRollView（捕获 props）。链路：
 *   Record 按钮 → transport.startRecording + play
 *   → 注入 onNoteOn/onNoteOff（硬件事件）
 *   → 再点 Record（stopRecording 提交 take）
 *   → convertTakeToNotes → addNotes（一条 undo）
 *   → PianoRollView 收到含新音符的 notes。
 *
 * ⚠️ 时钟：transport 用 performance.now()（App 未注入 now）→ 必须 fake
 * performance 才能推时钟（v2.0.0 实测：toFake 必须含 "performance"）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useSettings } from "../hooks/useSettings";
import type { SettingsContextValue } from "../contexts/SettingsContext";

let settingsCtx: SettingsContextValue | null = null;
const SettingsProbe: React.FC = () => {
  settingsCtx = useSettings();
  return null;
};

const pianoRoll = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
}));
vi.mock("../components/PianoRoll/PianoRollView", () => ({
  PianoRollView: (props: Record<string, unknown>) => {
    pianoRoll.props.push(props);
    return null;
  },
}));

// mock useMidiInput：捕获 App 注册的硬件事件回调，供测试注入
const midiInput = vi.hoisted(() => ({
  handlers: null as null | {
    onNoteOn: (note: number, velocity: number, timeStamp: number) => void;
    onNoteOff: (note: number, timeStamp: number) => void;
  },
}));
vi.mock("../hooks/useMidiInput", () => ({
  useMidiInput: (options: {
    onNoteOn?: (note: number, velocity: number, timeStamp: number) => void;
    onNoteOff?: (note: number, timeStamp: number) => void;
  }) => {
    midiInput.handlers = {
      onNoteOn: options.onNoteOn ?? (() => {}),
      onNoteOff: options.onNoteOff ?? (() => {}),
    };
  },
}));

let mounted: { container: HTMLElement; cleanup: () => void } | null = null;

function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <ThemeProvider>
            <ProjectProvider>
              <SettingsProbe />
              <App />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
      </I18nProvider>
    );
  });
  // 钉 countInBars=0（起播即 playing，隔离 count-in 默认行为）
  act(() => {
    settingsCtx!.updateSettings({
      midi: { playback: { followPlayhead: true, countInBars: 0, metronome: false } },
    });
  });
  mounted = {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
  return mounted;
}

const q = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-testid="${id}"]`);

function click(el: Element | null): void {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  });
}

function latestPianoRollProps(): Record<string, unknown> {
  return pianoRoll.props[pianoRoll.props.length - 1] ?? {};
}

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

describe("v2.2.0 S2 (T44) 实时录制 App 级护栏", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  beforeEach(() => {
    // transport 用 performance.now()（App 未注入 now）→ fake performance 才能推时钟
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    mounted?.cleanup();
    mounted = null;
    vi.useRealTimers();
  });

  it("T44: Record → 演奏（注入硬件事件）→ 再点 Record 提交 → store 出现录制音符（真实链路）", () => {
    const { container } = renderApp();

    // ① 点 Record：armed + 起播（countInBars=0 → 立即 playing）
    click(q(container, "transport-record"));
    const recordBtn = q(container, "transport-record") as HTMLElement;
    expect(recordBtn.getAttribute("aria-pressed")).toBe("true");

    // ② 演奏：100ms 处 noteOn（60, velocity 100）→ 400ms 处 noteOff
    act(() => {
      vi.advanceTimersByTime(100);
      midiInput.handlers!.onNoteOn(60, 100, performance.now());
    });
    act(() => {
      vi.advanceTimersByTime(300);
      midiInput.handlers!.onNoteOff(60, performance.now());
    });

    // ③ 再点 Record：提交 take
    click(q(container, "transport-record"));

    // ④ store 出现录制音符（notes 数组序非追加序 → 按特征匹配：
    //    pitch 60 + durQn 0.6（300ms @120bpm）+ velocity 100/127）
    type Rec = { pitchMidi: number; velocity: number; durQn: number };
    const after = (latestPianoRollProps().notes as Rec[]) ?? [];
    const isMine = (n: Rec) =>
      n.pitchMidi === 60 &&
      Math.abs(n.durQn - 0.6) < 1e-6 &&
      Math.abs(n.velocity - 100 / 127) < 1e-6;
    expect(after.filter(isMine).length).toBe(1);
    // 录制态已退出
    expect(recordBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("T45 负控：不开录制时硬件事件走既有步进录入（+1 音符，录制路径未干扰）", () => {
    const { container } = renderApp();
    const before = (latestPianoRollProps().notes as unknown[]) ?? [];
    act(() => {
      vi.advanceTimersByTime(100);
      midiInput.handlers!.onNoteOn(60, 100, performance.now());
    });
    act(() => {
      vi.advanceTimersByTime(300);
      midiInput.handlers!.onNoteOff(60, performance.now());
    });
    const after = (latestPianoRollProps().notes as unknown[]) ?? [];
    // 硬件事件走既有步进录入（+1 音符）——录制关闭时无额外录制音符，
    // 即录制路径未干扰既有行为（负控核心）。
    expect(after.length).toBe(before.length + 1);
  });
});
