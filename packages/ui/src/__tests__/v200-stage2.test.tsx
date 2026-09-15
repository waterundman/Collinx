/**
 * v2.0.0 Stage 2（S2-T18 App 级 + D2-4 接线护栏）。
 *
 * 背景（S1 验证教训，本项目第 4 度复发）：主 session 亲读 diff 确认接线正确
 * ≠ 有自动化护栏。本文件为 S2 新增/变化的「两处 App 接线」补护栏：
 *   (a) settings.midi.playback.followPlayhead → PianoRollView 的 autoScrollFollow
 *       随之变化（删掉该绑定即红）；
 *   (b) transportRunId 接线：点 transport-play / transport-stop 后传给
 *       PianoRollView 的 transportRunId 递增；Space 起播也走同一包装（自增），
 *       而 pause 不自增（Ableton 语义只提 stop/restart）。
 *
 * harness 照抄 v200-stage1.test.tsx：I18nProvider + SettingsProvider +
 * ThemeProvider + ProjectProvider + 真 <App />，matchMedia / ResizeObserver /
 * scrollIntoView 桩，createRoot + act 手写渲染；vi.hoisted + vi.mock 捕获
 * PianoRollView props。useTransport 使用 setInterval + performance.now()，
 * 故 fake timers 把 "performance" 一并并入（与先例一致）。
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

// PianoRollView 桩：捕获 App 每次渲染传入的 props。
const pianoRoll = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
}));
vi.mock("../components/PianoRoll/PianoRollView", () => ({
  PianoRollView: (props: Record<string, unknown>) => {
    pianoRoll.props.push(props);
    return null;
  },
}));

// 捕获 SettingsContext，便于测试内直接改 settings（真实 Provider，非 mock）。
let settingsCtx: SettingsContextValue | null = null;
const SettingsProbe: React.FC = () => {
  settingsCtx = useSettings();
  return null;
};

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

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

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

function latestPianoRollProps(): Record<string, unknown> {
  return pianoRoll.props[pianoRoll.props.length - 1] ?? {};
}

const q = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-testid="${id}"]`);

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

describe("v2.0.0 Stage 2: App follow/runId wiring (S2-T18)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  beforeEach(() => {
    localStorage.clear();
    settingsCtx = null;
    pianoRoll.props.length = 0;
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

  it("S2-T18g: 改 settings.midi.playback.followPlayhead → PianoRollView autoScrollFollow 随之变化 (critical)", () => {
    renderApp();

    // 默认 DEFAULT_SETTINGS.midi.playback.followPlayhead = true（与 v1.28 硬编码一致）。
    expect(latestPianoRollProps().autoScrollFollow).toBe(true);

    act(() => {
      settingsCtx!.updateSettings({
        midi: { playback: { followPlayhead: false, countInBars: 1, metronome: false } },
      });
    });
    expect(latestPianoRollProps().autoScrollFollow).toBe(false);

    act(() => {
      settingsCtx!.updateSettings({
        midi: { playback: { followPlayhead: true, countInBars: 1, metronome: false } },
      });
    });
    expect(latestPianoRollProps().autoScrollFollow).toBe(true);
  });

  it("S2-T18h: transportRunId —— transport-play/stop 自增；Space 起播自增、pause 不增 (critical)", () => {
    const { container } = renderApp();
    // 钉死 countInBars=0：隔离 S3 count-in 默认行为，本组断言假设「起播即 playing」，
    // 与基线 480 绿（S3 前）的 immediate-playing 语义一致。
    act(() => {
      settingsCtx!.updateSettings({ midi: { playback: { followPlayhead: true, countInBars: 0, metronome: false } } });
    });
    const runId = () => latestPianoRollProps().transportRunId;

    expect(runId()).toBe(0);

    click(q(container, "transport-play"));
    expect(runId()).toBe(1);

    click(q(container, "transport-stop"));
    expect(runId()).toBe(2);

    // Space 起播（idle → playing）也走包装 → 自增（否则手动平移后无法恢复跟随）。
    fireSpace();
    expect(runId()).toBe(3);

    // Space 暂停（playing → paused）：按 SPEC 不自增。
    fireSpace();
    expect(runId()).toBe(3);
  });

  it("S2-T18i: followPlayhead 随 transport 运行态切换（idle=false / playing=true / paused=false / stop 后 false） (critical)", () => {
    const { container } = renderApp();
    // 钉死 countInBars=0：隔离 S3 count-in 默认行为，与 S2 基线 immediate-playing 语义一致。
    act(() => {
      settingsCtx!.updateSettings({ midi: { playback: { followPlayhead: true, countInBars: 0, metronome: false } } });
    });
    const follow = () => latestPianoRollProps().followPlayhead;

    // idle（S2.1 裁决核心）：transport 未运行 → 跟录入光标，忽略停在 m1.1 的播放头。
    expect(follow()).toBe(false);

    // 起播 → 运行中 → 跟播放头（v2.0 新功能）。
    click(q(container, "transport-play"));
    expect(follow()).toBe(true);

    // Space 暂停 → paused 亦属「未运行」→ 回退跟录入光标（验证否定式推导含 paused）。
    fireSpace();
    expect(follow()).toBe(false);

    // Space 再起播 → 运行中 → 跟播放头。
    fireSpace();
    expect(follow()).toBe(true);

    // stop → 回 idle → 跟录入光标（保 v1.28）。
    click(q(container, "transport-stop"));
    expect(follow()).toBe(false);
  });
});
