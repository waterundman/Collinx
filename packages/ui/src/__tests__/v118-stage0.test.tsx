import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { TeachingAgent } from "@collinx/agent";

// ---------------------------------------------------------------------------
// v1.18.0 Stage 0: ArrangementView real-data wiring + teaching harmony loop.
//
// Real App under the same provider stack main.tsx uses. No demo data:
//   - ArrangementView phrases derive from the graph's Phrase nodes
//     (storePhrases); without Phrase nodes an explicit empty state shows.
//   - The teaching harmony block routes through the real
//     teaching.explainHarmony tool on the shared ToolRegistry.
//
// The default ProjectProvider seeds two pending proposals; #1 ("Add a chorus
// phrase") adds a real Phrase node when applied — that is the T01 setup.
// ---------------------------------------------------------------------------

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
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
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

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function findCardByText(container: HTMLElement, text: string): Element {
  const cards = container.querySelectorAll('[data-testid^="diff-card-"]');
  for (const card of Array.from(cards)) {
    if (card.textContent?.includes(text)) return card;
  }
  throw new Error(`no diff card containing "${text}"`);
}

function findToolbarButton(container: HTMLElement, labels: string[]): Element {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    labels.some((label) => b.textContent?.includes(label)),
  );
  if (!btn) throw new Error(`no button containing "${labels.join("/")}"`);
  return btn;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("v1.18.0 Stage 0: ArrangementView real phrases (no demo data)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  // T01 (critical): after applying the real Phrase proposal, the compose tab's
  // ArrangementView renders the DERIVED phrase (graph Phrase node "Chorus",
  // formRole "chorus") — not any demo template content.
  it("T01: 应用 Phrase 提案后 ArrangementView 渲派生乐段而非 demo 数据 (critical)", () => {
    const { container, cleanup } = renderApp();

    // Initial graph has no Phrase nodes: the empty state is shown.
    expect(container.querySelector('[data-testid="arrangement-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="arrangement-empty"]')).not.toBeNull();

    // Apply the HarmonyBot "Add a chorus phrase" proposal via the agent tab.
    click(container.querySelector('[data-testid="tab-agent"]'));
    const harmonyCard = findCardByText(container, "Add a chorus phrase");
    click(harmonyCard.querySelector("button")); // first button = apply

    // Back on compose: the derived phrase appears with its real name + role.
    click(container.querySelector('[data-testid="tab-compose"]'));
    const view = container.querySelector('[data-testid="arrangement-view"]');
    expect(view).not.toBeNull();
    expect(view!.textContent).toContain("Chorus");
    expect(view!.textContent).toContain("副歌"); // ROLE_LABELS["chorus"]
    // Empty state gone; demo template content never leaks.
    expect(container.querySelector('[data-testid="arrangement-empty"]')).toBeNull();
    expect(container.textContent).not.toContain("Verse A");
    expect(container.textContent).not.toContain("Final Chorus");

    cleanup();
  });

  // T01 part 2: double-clicking the derived phrase block navigates to compose
  // (the storePhrases-validated handler).
  it("T01b: 双击派生乐段块 → 跳转 compose tab (critical)", () => {
    const { container, cleanup } = renderApp();

    click(container.querySelector('[data-testid="tab-agent"]'));
    const harmonyCard = findCardByText(container, "Add a chorus phrase");
    click(harmonyCard.querySelector("button"));

    click(container.querySelector('[data-testid="tab-arrange"]'));
    const block = Array.from(
      container.querySelectorAll('[data-testid="arrangement-view"] div'),
    ).find((el) => el.textContent === "Chorus副歌");
    expect(block).toBeDefined();
    act(() => {
      block!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="compose-layout"]')).not.toBeNull();

    cleanup();
  });

  // T02 (critical): with no Phrase nodes the explicit empty state renders on
  // all three ArrangementView tabs and tab switching never crashes.
  it("T02: 无 Phrase 节点 → 三个 tab 均渲染空态且切换不崩溃 (critical)", () => {
    const { container, cleanup } = renderApp();

    for (const tab of ["compose", "arrange", "orchestrate"]) {
      click(container.querySelector(`[data-testid="tab-${tab}"]`));
      expect(
        container.querySelector(`[data-testid="${tab}-layout"]`),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="arrangement-view"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="arrangement-empty"]'),
      ).not.toBeNull();
      // Demo template content must NOT appear anywhere in the arrangement.
      expect(container.textContent).not.toContain("Verse A");
      expect(container.textContent).not.toContain("Bridge");
    }

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// v1.18.0 Stage 0: teaching harmony real tool loop.
// ---------------------------------------------------------------------------

describe("v1.18.0 Stage 0: teaching harmony loop", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  // T03 (critical): clicking the harmony trigger runs the real
  // teaching.explainHarmony tool with chordProgression/key/userLevel derived
  // from the store (chords track + graph key_map), renders the real
  // explanation, and leaves a visible tool trace in the timeline.
  it("T03: harmony 触发 → teaching.explainHarmony 真实调用 + 结果渲染 (critical)", async () => {
    const spy = vi.spyOn(TeachingAgent.prototype, "explainHarmony");

    try {
      const { container, cleanup } = renderApp();

      click(container.querySelector('[data-testid="tab-teaching"]'));
      const trigger = container.querySelector(
        '[data-testid="teaching-harmony-trigger"]',
      ) as HTMLButtonElement | null;
      // Demo chords-track notes exist -> button enabled.
      expect(trigger).not.toBeNull();
      expect(trigger!.disabled).toBe(false);

      click(trigger);
      await act(async () => {}); // flush the async tool call + setState

      // Tool called with the store-derived params:
      //   chordProgression: chords track grouped by bar, pitch-name sequence
      //     per bar (demo notes: bar1 E3/G#3/B3, bar2 D3/G3/B3, bar3 F#3/A3)
      //   key: graph meta key_map[0] -> "C major"
      //   userLevel: default UI level "intermediate" passes through
      expect(spy).toHaveBeenCalledTimes(1);
      const [progression, key, level] = spy.mock.calls[0];
      expect(progression).toEqual(["E-G#-B", "D-G-B", "F#-A"]);
      expect(key).toBe("C major");
      expect(level).toBe("intermediate");

      // Real explanation rendered in the harmony block (agent title carries
      // the key + the joined progression).
      const result = container.querySelector('[data-testid="teaching-harmony-result"]');
      expect(result).not.toBeNull();
      expect(result!.textContent).toContain("和声进行分析");
      expect(result!.textContent).toContain("C major");
      expect(
        container.querySelector('[data-testid="teaching-harmony-error"]'),
      ).toBeNull();

      // Tool trace visible in the agent timeline.
      click(container.querySelector('[data-testid="tab-agent"]'));
      const timeline = container.querySelector('[data-testid="tool-call-timeline"]');
      expect(timeline).not.toBeNull();
      expect(timeline!.textContent).toContain("teaching.explainHarmony");

      cleanup();
    } finally {
      spy.mockRestore();
    }
  });

  // T04 (app-level, non-critical): with chords-track notes the button is
  // enabled (the disabled branch is covered by the component tests).
  it("T04: 默认工程含和弦音符 → 触发按钮可用 (non-critical)", () => {
    const { container, cleanup } = renderApp();

    click(container.querySelector('[data-testid="tab-teaching"]'));
    const trigger = container.querySelector(
      '[data-testid="teaching-harmony-trigger"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    // The harmony section header + button labels come from i18n
    // (en env renders "Harmony Explainer"; zh-CN falls back / renders natively).
    expect(
      container.textContent.includes("和声讲解") ||
        container.textContent.includes("Harmony Explainer"),
    ).toBe(true);

    cleanup();
  });
});
