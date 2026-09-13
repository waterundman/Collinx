/**
 * v2.0.0 Stage 3（S3）：App 级护栏——settings.countInBars → useTransport 接线。
 *
 * 背景（同 S1/S2 教训）：主 session 亲读 diff ≠ 有自动化护栏。本文件为 S3 新增的
 * App 接线补护栏：点 transport-play / Space 时，App 把 settings.midi.playback.
 * countInBars 传给 transport.play({countInBars})；countInBars=1 → phase 进入
 * count-in → TransportBar 渲染锚点 `transport-count-in`；countInBars=0 → 直进
 * playing → 不渲染该锚点。
 *
 * harness 照抄 v200-stage2.test.tsx：I18nProvider + SettingsProvider +
 * ThemeProvider + ProjectProvider + 真 <App />，mock PianoRollView 避免 canvas，
 * fake timers 并入 "performance"（useTransport 用 setInterval + performance.now()）。
 *
 * 变异自证（报告内）：把 App.tsx 中传给 play 的 countInBars 硬编码为 0 →
 * 本文件的 countInBars=1 用例必须变红；Edit 还原 → 复绿（证据见收尾报告）。
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

// PianoRollView 桩（避免真实 canvas 录制与 vexflow 互相干扰）。
vi.mock("../components/PianoRoll/PianoRollView", () => ({
  PianoRollView: () => null,
}));

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

describe("v2.0.0 Stage 3: App count-in wiring (S3-TcountIn)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  beforeEach(() => {
    localStorage.clear();
    settingsCtx = null;
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
    document.body.innerHTML = "";
  });

  it("S3-TcountInA: settings.countInBars=1 → 点 transport-play → 出现 transport-count-in 锚点 (critical)", () => {
    const { container } = renderApp();
    // 默认 DEFAULT_SETTINGS.midi.playback.countInBars = 1。
    expect(settingsCtx!.settings.midi.playback.countInBars).toBe(1);

    click(q(container, "transport-play"));

    // phase 进入 count-in → TransportBar 渲染锚点。
    const anchor = q(container, "transport-count-in");
    expect(anchor).not.toBeNull();
    // 锚点渲染 i18n 文案（语言无关：zh=预备… / en=Count-in…）。
    expect(anchor!.textContent).toMatch(/预备|Count-in/);
  });

  it("S3-TcountInB: settings.countInBars=0 → 点 transport-play → 不出现 transport-count-in 锚点 (critical)", () => {
    const { container } = renderApp();

    act(() => {
      settingsCtx!.updateSettings({
        midi: { playback: { followPlayhead: true, countInBars: 0 } },
      });
    });
    expect(settingsCtx!.settings.midi.playback.countInBars).toBe(0);

    click(q(container, "transport-play"));

    // 直进 playing → 无 count-in 锚点。
    expect(q(container, "transport-count-in")).toBeNull();
  });

  it("S3-TcountInC: settings.countInBars=1 → Space 起播 → 出现 transport-count-in 锚点 (critical)", () => {
    const { container } = renderApp();
    expect(settingsCtx!.settings.midi.playback.countInBars).toBe(1);

    fireSpace();

    const anchor = q(container, "transport-count-in");
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toMatch(/预备|Count-in/);
  });
});
