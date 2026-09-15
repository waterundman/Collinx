/**
 * v2.0.0 Stage 1（S1.5-T1）：App 级 transport 接线护栏。
 *
 * 背景：S1 的 453 条测试中，TransportBar 只有组件级单测（TransportBar.test.tsx），
 * 没有任何测试渲染真实 App → 删掉 App.tsx 里的 `<TransportBar>` 或
 * `playheadPosition={transport.position}`，全量测试照样全绿（SPEC D1-5
 * 「调用方实际传参核实」的护栏缺口）。本文件补齐该缺口。
 *
 * harness 完全照抄既有 App 级先例（app-integration.test.tsx / v122-stage1.test.tsx）：
 *   I18nProvider + SettingsProvider + ThemeProvider + ProjectProvider + 真 <App />，
 *   matchMedia / ResizeObserver / scrollIntoView 桩，createRoot + act 手写渲染。
 *
 * 播放推进：useTransport 默认时钟是 performance.now()，调度器/位置刷新用
 * setInterval。vitest 默认 fake timers **不含 performance**（advanceTimersByTime
 * 不会推进 performance.now()），故本文件显式把 "performance" 并入 toFake，
 * 使 advanceTimersByTime(ms) 真正推进播放头（已单独探针验证：fake-perf delta=200）。
 *
 * (d) playheadPosition 护栏：真实 PianoRollView 的播放头绘制证据已由
 *   PianoRollView.test.tsx 的 S1-T08 段（canvas draw-call）独立覆盖；在 App 级
 *   全量渲染里再挂 canvas 录制会与 ScorePanel/vexflow 的画布路径互相干扰，故按
 *   任务允许的降级方案：vi.mock 桩掉 PianoRollView 捕获 props，断言
 *   playheadPosition 与 TransportBar 显示的 transport.position 同源且随播放推进。
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useSettings } from "../hooks/useSettings";
import type { SettingsContextValue } from "../contexts/SettingsContext";

// 捕获 SettingsContext，便于本文件内直接改 settings（真实 Provider，非 mock）。
// S3 起 settings.midi.playback.countInBars 默认 1，使 play() 进入 count-in 阶段，
// 但 S1 本组断言均假设「起播即 playing」（无预备小节），故在其 before 里把
// countInBars 钉为 0，隔离 count-in 默认行为的影响（与基线 480 绿一致）。
let settingsCtx: SettingsContextValue | null = null;
const SettingsProbe: React.FC = () => {
  settingsCtx = useSettings();
  return null;
};

// PianoRollView 桩：捕获 App 每次渲染传入的 props（尤其 playheadPosition）。
// vi.mock 被提升到 import 之上，故捕获容器经 vi.hoisted 一并提升。
const pianoRoll = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
}));
vi.mock("../components/PianoRoll/PianoRollView", () => ({
  PianoRollView: (props: Record<string, unknown>) => {
    pianoRoll.props.push(props);
    return null;
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

  // S1 本组：钉死 countInBars=0，隔离 S3 count-in 默认行为（起播即 playing）。
  act(() => {
    settingsCtx!.updateSettings({ midi: { playback: { followPlayhead: true, countInBars: 0, metronome: false } } });
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

/** Fire a real bubbling click through React's synthetic event system. */
function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Space keydown on `window` (the globally bound shortcut target). */
function fireSpace() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

/** 最近一次 PianoRollView 收到的 props（App 每次渲染都会重新推入）。 */
function latestPianoRollProps(): Record<string, unknown> {
  return pianoRoll.props[pianoRoll.props.length - 1] ?? {};
}

const q = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-testid="${id}"]`);

/** Stubs the browser APIs jsdom lacks so the real App renders under vitest
 *  (same set as app-integration.test.tsx / v122-stage1.test.tsx). */
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

describe("v2.0.0 Stage 1: App transport wiring (S1.5-T1)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  beforeEach(() => {
    pianoRoll.props.length = 0;
    // 关键：并入 "performance"，否则 advanceTimersByTime 不推进 useTransport 的时钟。
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
      ],
    });
  });

  afterEach(() => {
    if (mounted) {
      mounted.cleanup();
      mounted = null;
    }
    vi.useRealTimers();
    pianoRoll.props.length = 0;
    settingsCtx = null;
    document.body.innerHTML = "";
  });

  it("S1-T01: 真实 App 渲染出 TransportBar；idle 态仅 Play（无 Pause） (critical)", () => {
    const { container } = renderApp();

    // (a) 删掉 App 里的 <TransportBar> 即红。
    expect(q(container, "transport-bar")).not.toBeNull();

    // (b) idle 互斥显示：有 Play、无 Pause；Stop 始终在。
    expect(q(container, "transport-play")).not.toBeNull();
    expect(q(container, "transport-pause")).toBeNull();
    expect(q(container, "transport-stop")).not.toBeNull();
  });

  it("S1-T02: 点击 Play → Pause 互斥反转；再点 Pause → 回到 Play（onPlay/onPause/isPlaying 接线） (critical)", () => {
    const { container } = renderApp();

    click(q(container, "transport-play"));
    expect(q(container, "transport-pause")).not.toBeNull();
    expect(q(container, "transport-play")).toBeNull();

    click(q(container, "transport-pause"));
    expect(q(container, "transport-play")).not.toBeNull();
    expect(q(container, "transport-pause")).toBeNull();
  });

  it("S1-T03: 窗口 Space 键 → 播放/暂停往返（onPlayPause 接线，读最新 isPlaying） (critical)", () => {
    const { container } = renderApp();
    expect(q(container, "transport-play")).not.toBeNull();

    fireSpace();
    expect(q(container, "transport-pause")).not.toBeNull();
    expect(q(container, "transport-play")).toBeNull();

    fireSpace();
    expect(q(container, "transport-play")).not.toBeNull();
    expect(q(container, "transport-pause")).toBeNull();
  });

  it("S1-T04: PianoRollView 收到 playheadPosition === transport.position 且随播放推进同步 (critical)", () => {
    const { container } = renderApp();

    // idle：与 useTransport 初值一致（删掉 playheadPosition 属性 → undefined 即红）。
    expect(latestPianoRollProps().playheadPosition).toEqual({ bar: 1, beat: 1 });

    // 起播并推进 2.5s（120bpm 4/4 → 2.5s = m2.2）。若 App 传的是硬编码常量，
    // 下面的值与 TransportBar 显示会分叉。
    click(q(container, "transport-play"));
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    const pp = latestPianoRollProps().playheadPosition as
      | { bar: number; beat: number }
      | undefined;
    expect(pp).toBeDefined();
    expect(pp).toEqual({ bar: 2, beat: 2 });

    // 同源核验：App 显示的小节/拍（transport-bar-beat）来自同一个 transport.position。
    const barBeat = q(container, "transport-bar-beat")?.textContent ?? "";
    expect(barBeat).toBe("m2.2");
    const m = /^m(\d+)\.(\d+)$/.exec(barBeat);
    expect(m).not.toBeNull();
    expect(pp!.bar).toBe(Number(m![1]));
    expect(Math.floor(pp!.beat)).toBe(Number(m![2]));

    // positionSeconds 同步推进（TransportBar time 锚点）。
    expect(q(container, "transport-time")?.textContent).toBe("0:02.5");
  });
});

// ---------------------------------------------------------------------------
// v2.1.0 S3 (T38)：App 级接线护栏——TransportBar 的 tempo/meter/loop 控件
// 经真实 App 链路（控件 → store → 派生 TempoMap → PianoRollView props）。
// ---------------------------------------------------------------------------
describe("v2.1.0 S3 (T38) App-level tempo/meter/loop wiring", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  it("T38: BPM 输入/拍号选择/loop 按钮 → store → 派生 TempoMap → 视图 props", () => {
    const { container, cleanup } = renderApp();
    // ① BPM 输入 90 → App 派生的 TempoMap.bpmAt(1,1) 变 90
    const bpmInput = q(container, "transport-bpm") as HTMLInputElement;
    expect(bpmInput).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    act(() => {
      setter.call(bpmInput, "90");
      bpmInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const tm1 = latestPianoRollProps().tempoMap as {
      bpmAt: (bar: number, beat: number) => number;
      meterAt: (bar: number) => { numerator: number; denominator: number };
    };
    expect(tm1.bpmAt(1, 1)).toBe(90);

    // ② 拍号选择 3/4 → meterAt(1) 变 {3,4}
    const meterSelect = q(container, "transport-meter") as HTMLSelectElement;
    act(() => {
      meterSelect.value = "3/4";
      meterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const tm2 = latestPianoRollProps().tempoMap as typeof tm1;
    expect(tm2.meterAt(1)).toEqual({ numerator: 3, denominator: 4 });

    // ③ loop 按钮 → PianoRollView 收到 enabled 的 loopRegion（默认 bar1→bar2）
    click(q(container, "transport-loop"));
    const lr = latestPianoRollProps().loopRegion as {
      enabled: boolean;
      start: { bar: number; beat: number };
      end: { bar: number; beat: number };
    };
    expect(lr.enabled).toBe(true);
    expect(lr.start).toEqual({ bar: 1, beat: 1 });
    expect(lr.end).toEqual({ bar: 2, beat: 1 });
    cleanup();
  });
});
