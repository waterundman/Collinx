/**
 * v2.9.0 App 级护栏：混音台控件真的接到了音频与 store。
 *
 * 这一层**不能**只靠纯函数测试：此前 M/S/pan/FX 的判定函数都「正确」，
 * 但它们从未被调用 —— 组件渲染正常、单测全绿、点了没反应。
 * 所以这里点真实按钮，断言**音频入口被以正确参数调用**。
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";
import { AudioPreview } from "../services/audio-preview";

function Probe() {
  const { mixer, notes } = useProjectStore();
  return (
    <div>
      <span data-testid="probe-mixer-tracks">{mixer.tracks.length}</span>
      <span data-testid="probe-notes">{notes.length}</span>
      {/* 混音条 id 是 uuid，测试需要从 sourceTrackId 反查真实 id */}
      <span data-testid="probe-track-ids">
        {mixer.tracks.map((t) => `${t.sourceTrackId}=${t.id}`).join(",")}
      </span>
    </div>
  );
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
            <ProjectProvider pendingDiffs={[]}>
              <App />
              <Probe />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
      </I18nProvider>,
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

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function num(container: HTMLElement, key: string): number {
  return Number(container.querySelector(`[data-testid="probe-${key}"]`)?.textContent ?? "");
}

/** 从 probe 里按 sourceTrackId 查混音条 uuid（组件 testid 用的是 uuid） */
function mixerIdOf(container: HTMLElement, sourceTrackId: string): string {
  const raw = container.querySelector('[data-testid="probe-track-ids"]')?.textContent ?? "";
  for (const pair of raw.split(",")) {
    const [src, id] = pair.split("=");
    if (src === sourceTrackId) return id;
  }
  throw new Error(`no mixer track for ${sourceTrackId} (probe: ${raw})`);
}

describe("v2.9.0 App 级混音接线", () => {
  const gainSpy = vi.spyOn(AudioPreview.prototype, "setTrackGain");
  const panSpy = vi.spyOn(AudioPreview.prototype, "setTrackPan");
  const fxSpy = vi.spyOn(AudioPreview.prototype, "setTrackFx");

  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    gainSpy.mockClear();
    panSpy.mockClear();
    fxSpy.mockClear();
  });

  afterAll(() => {
    gainSpy.mockRestore();
    panSpy.mockRestore();
    fxSpy.mockRestore();
  });

  it("混音页挂载性能面板（v2.9.2：从零引用组件接上真实指标）", () => {
    const { container, cleanup } = renderApp();
    click(container.querySelector('[data-testid="tab-mixer"]'));

    const panel = container.querySelector('[data-testid="performance-dashboard"]');
    expect(panel).not.toBeNull();
    // 默认收起，不显示任何数字
    expect(container.querySelector('[data-testid="perf-voices"]')).toBeNull();

    cleanup();
  });

  it("挂载即把整份混音推给音频（gain/pan/fx 三条都有调用）", () => {
    const { cleanup } = renderApp();

    expect(panSpy).toHaveBeenCalled();
    expect(fxSpy).toHaveBeenCalled();
    // 每条轨都有一次增益写入
    expect(new Set(gainSpy.mock.calls.map(([key]) => key)).size).toBeGreaterThan(0);

    cleanup();
  });

  it("点击 M 后该轨以 -Infinity 静音（不是只改 UI 状态）", () => {
    const { container, cleanup } = renderApp();
    click(container.querySelector('[data-testid="tab-mixer"]'));

    gainSpy.mockClear();
    click(container.querySelector(`[data-testid="mixer-mute-${mixerIdOf(container, "melody")}"]`));

    const melodyCalls = gainSpy.mock.calls.filter(([key]) => key === "melody");
    expect(melodyCalls.length).toBeGreaterThan(0);
    expect(melodyCalls[melodyCalls.length - 1][1]).toBe(-Infinity);

    cleanup();
  });

  it("点击 S 后非 solo 轨被静音（独奏真的落到音频）", () => {
    const { container, cleanup } = renderApp();
    click(container.querySelector('[data-testid="tab-mixer"]'));

    gainSpy.mockClear();
    click(container.querySelector(`[data-testid="mixer-solo-${mixerIdOf(container, "melody")}"]`));

    const bassCalls = gainSpy.mock.calls.filter(([key]) => key === "bass");
    expect(bassCalls[bassCalls.length - 1][1]).toBe(-Infinity);

    cleanup();
  });

  it("点击删除按钮：混音条与音符一起减少（onRemoveTrack 真的传进了组件）", () => {
    const { container, cleanup } = renderApp();
    click(container.querySelector('[data-testid="tab-mixer"]'));

    const tracksBefore = num(container, "mixer-tracks");
    const notesBefore = num(container, "notes");
    expect(tracksBefore).toBeGreaterThan(1);

    click(container.querySelector(`[data-testid="mixer-remove-${mixerIdOf(container, "melody")}"]`));

    expect(num(container, "mixer-tracks")).toBe(tracksBefore - 1);
    expect(num(container, "notes")).toBeLessThan(notesBefore);

    cleanup();
  });
});
