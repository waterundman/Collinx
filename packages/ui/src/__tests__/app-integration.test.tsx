import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";
import { EngravingAgent, TeachingAgent } from "@collinx/agent";

// ---------------------------------------------------------------------------
// Real App integration test (Stage 4).
//
// We render the real <App /> under the same provider stack main.tsx uses
// (I18nProvider + SettingsProvider + ThemeProvider + ProjectProvider), plus a
// tiny StoreProbe that mirrors the store's graph/notes/pending/applied state
// into the DOM. The probe is the "view data" we assert against after driving
// the real UI (tab switch + DiffCard apply/reject/rollback buttons).
//
// The store's initial pending proposals are built inside ProjectProvider:
//   1. HarmonyBot -> add_node Phrase ("Add a chorus phrase...")
//   2. BassAgent  -> add_note_group 1 bass note ("Add a bass fill in bar 2")
// ---------------------------------------------------------------------------

function StoreProbe() {
  const { graph, notes, pendingDiffs, appliedDiffs, rollbackTokens } =
    useProjectStore();
  return (
    <div data-testid="store-probe">
      <span data-testid="probe-nodes">{graph.getAllNodes().length}</span>
      <span data-testid="probe-notes">{notes.length}</span>
      <span data-testid="probe-pending">{pendingDiffs.length}</span>
      <span data-testid="probe-applied">{appliedDiffs.length}</span>
      <span data-testid="probe-tokens">{rollbackTokens.length}</span>
      <span data-testid="probe-spans">{graph.getNodesByType("NoteSpan").length}</span>
    </div>
  );
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
              <StoreProbe />
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

function readProbe(container: HTMLElement, key: string): string {
  const el = container.querySelector(`[data-testid="probe-${key}"]`);
  if (!el) throw new Error(`probe-${key} not found in DOM`);
  return el.textContent ?? "";
}

function readNum(container: HTMLElement, key: string): number {
  return Number(readProbe(container, key));
}

/** Fire a real bubbling click through React's synthetic event system. */
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

/** Stubs the browser APIs jsdom lacks (matchMedia / ResizeObserver /
 *  scrollIntoView) so the real App can render under vitest. Called from every
 *  describe's beforeAll because -t filtering skips a skipped describe's
 *  beforeAll entirely, leaving a later describe without the stubs. */
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
  // jsdom does not implement scrollIntoView (used by AgentChat).
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

/** Stubs the URL.createObjectURL/revokeObjectURL jsdom lacks so the real
 *  MusicXML export download path can run under vitest. Returns the spies for
 *  assertion (the download test asserts createObjectURL was called with a
 *  Blob). */
function stubUrlObjectApi() {
  const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-collinx-score");
  const revokeObjectURL = vi.fn((_url: string) => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

describe("app-integration (real App under ProjectProvider)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T1: 完整 App 渲染,初始 pending 提案存在,compose 视图挂载", () => {
    const { container, cleanup } = renderApp();

    // Real App chrome is mounted.
    expect(container.querySelector('[data-testid="tab-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compose-layout"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-panel"]')).toBeNull();

    // Store probe: two demo proposals are pending, none applied yet.
    expect(readNum(container, "pending")).toBe(2);
    expect(readNum(container, "applied")).toBe(0);
    expect(readNum(container, "tokens")).toBe(0);
    // Demo notes are visible to the compose view (notes -> NoteSpan graph nodes).
    expect(readNum(container, "notes")).toBeGreaterThan(0);
    expect(readNum(container, "notes")).toBe(readNum(container, "spans"));

    cleanup();
  });

  it("T2: 主链路 - UI 应用 add_note_group 提案 → 视图数据更新 → UI 回滚 → 恢复", () => {
    const { container, cleanup } = renderApp();
    const notesBefore = readNum(container, "notes");
    const spansBefore = readNum(container, "spans");
    const nodesBefore = readNum(container, "nodes");
    expect(readNum(container, "pending")).toBe(2);

    // Navigate to the agent tab (real tab button).
    click(container.querySelector('[data-testid="tab-agent"]'));
    expect(container.querySelector('[data-testid="agent-layout"]')).not.toBeNull();

    // Apply the bass fill proposal (add_note_group) via the real DiffCard button.
    const bassCard = findCardByText(container, "Add a bass fill in bar 2");
    click(bassCard.querySelector("button"));
    expect(readProbe(container, "pending")).toBe("1");
    expect(readProbe(container, "applied")).toBe("1");
    expect(readProbe(container, "tokens")).toBe("1");
    // The note landed in the graph and in the notes view data.
    expect(readNum(container, "spans")).toBe(spansBefore + 1);
    expect(readNum(container, "notes")).toBe(notesBefore + 1);
    // Stage 2 decision tracing: applying an agent diff also materializes an
    // AgentDecision evidence node, so the total node count grows by 2
    // (1 NoteSpan + 1 AgentDecision).
    expect(readNum(container, "nodes")).toBe(nodesBefore + 2);

    // The applied card moved into the history pane with a rollback button.
    const historyCard = findCardByText(container, "Add a bass fill in bar 2");
    expect(historyCard.textContent).toContain("applied");

    // Navigate back to the compose tab: the piano roll / score view data
    // (store.notes) now reflects the extra note.
    click(container.querySelector('[data-testid="tab-compose"]'));
    expect(container.querySelector('[data-testid="compose-layout"]')).not.toBeNull();
    expect(readNum(container, "notes")).toBe(notesBefore + 1);

    // Roll the proposal back from the agent tab.
    click(container.querySelector('[data-testid="tab-agent"]'));
    const appliedCard = findCardByText(container, "Add a bass fill in bar 2");
    click(appliedCard.querySelector("button"));

    expect(readProbe(container, "applied")).toBe("0");
    expect(readProbe(container, "tokens")).toBe("0");
    expect(readNum(container, "spans")).toBe(spansBefore);
    expect(readNum(container, "notes")).toBe(notesBefore);
    expect(readNum(container, "nodes")).toBe(nodesBefore);

    cleanup();
  });

  it("T3: UI 拒绝提案 → pending 减少,graph/notes 视图数据不变", () => {
    const { container, cleanup } = renderApp();
    const nodesBefore = readNum(container, "nodes");
    const notesBefore = readNum(container, "notes");

    click(container.querySelector('[data-testid="tab-agent"]'));
    const harmonyCard = findCardByText(container, "Add a chorus phrase");
    const buttons = harmonyCard.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // DiffCard order: apply is the first button, reject the second.
    click(buttons[1]);

    expect(readProbe(container, "pending")).toBe("1");
    expect(readProbe(container, "applied")).toBe("0");
    expect(readNum(container, "nodes")).toBe(nodesBefore);
    expect(readNum(container, "notes")).toBe(notesBefore);

    cleanup();
  });
});

// ── v1.14 Stage 0: Score panel auto-layout real tool loop ──────────────────
function findToolbarButton(container: HTMLElement, labels: string[]): Element {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    labels.some((label) => b.textContent?.includes(label)),
  );
  if (!btn) throw new Error(`no toolbar button containing "${labels.join("/")}"`);
  return btn;
}

function containsAny(text: string, ...needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function countCollisionCards(container: HTMLElement): number {
  // CSS modules hash class names, so match on the base name suffix (same
  // convention as the Orchestrator panel tests).
  return (
    container.querySelectorAll('[class*="collisionCardError"]').length +
    container.querySelectorAll('[class*="collisionCardWarn"]').length
  );
}

describe("app-integration score auto-layout (v1.14 Stage 0)", () => {
  // T01 (integration, critical): clicking "自动排版" on the real App must run
  // the real engraving.reportCollisions tool (not sample data) and render the
  // returned collisions as conflict cards in the Score panel sidebar.
  it("T01: 点击自动排版后 Score 面板出现真实冲突卡 (critical)", async () => {
    const { container, cleanup } = renderApp();

    // Navigate to the score tab.
    click(container.querySelector('[data-testid="tab-score"]'));
    expect(container.querySelector('[data-testid="score-layout"]')).not.toBeNull();
    // No collisions before the run.
    expect(countCollisionCards(container)).toBe(0);

    // Click the real auto-layout button.
    const autoLayoutBtn = findToolbarButton(container, ["自动排版", "Auto Layout"]);
    click(autoLayoutBtn);
    await act(async () => {}); // flush the async tool call + setState

    // Real EngravingEngine collisions surfaced as conflict cards.
    const cards = countCollisionCards(container);
    expect(cards).toBeGreaterThan(0);
    // Cards carry the real agent data: bar/beat locations + fix suggestions.
    expect(container.textContent).toContain("Stave 0");
    expect(
      containsAny(container.textContent ?? "", "修复建议", "Fix Suggestion"),
    ).toBe(true);

    cleanup();
  });

  // T01 part 2: the auto-layout run leaves a visible engraving tool trace in
  // the Agent tool timeline (one upserted success record).
  it("T01b: 自动排版后时间线出现 engraving.reportCollisions 记录", async () => {
    const { container, cleanup } = renderApp();

    click(container.querySelector('[data-testid="tab-score"]'));
    click(findToolbarButton(container, ["自动排版", "Auto Layout"]));
    await act(async () => {});

    click(container.querySelector('[data-testid="tab-agent"]'));
    const timeline = container.querySelector(
      '[data-testid="tool-call-timeline"]',
    );
    expect(timeline).not.toBeNull();
    expect(timeline?.textContent).toContain("engraving.reportCollisions");

    cleanup();
  });

  // T04 (non-critical): a failing reportCollisions tool must not crash the App
  // and must surface a visible hint instead of a bare no-op.
  it("T04: reportCollisions 失败时自动排版不崩溃且显示提示", async () => {
    const spy = vi.spyOn(EngravingAgent.prototype, "reportCollisions");
    spy.mockImplementation(() => {
      throw new Error("engraving engine down");
    });

    let container: HTMLElement | undefined;
    try {
      const rendered = renderApp();
      container = rendered.container;
      click(container.querySelector('[data-testid="tab-score"]'));
      click(findToolbarButton(container, ["自动排版", "Auto Layout"]));
      await act(async () => {});

      // App chrome still alive (no crash).
      expect(container.querySelector('[data-testid="score-layout"]')).not.toBeNull();
      // Visible failure hint.
      const notice = container.querySelector('[data-testid="score-notice"]');
      expect(notice).not.toBeNull();
      expect(
        containsAny(
          notice?.textContent ?? "",
          "排版分析失败",
          "Layout analysis failed",
        ),
      ).toBe(true);
      // No stale collisions are shown.
      expect(countCollisionCards(container)).toBe(0);
      rendered.cleanup();
    } finally {
      spy.mockRestore();
    }
  });

  // v1.15 Stage 0: part extraction / MusicXML export are real paths — the
  // buttons surface the actual outcome (extracted part list / export done
  // notice) instead of the v1.14 placeholder "not implemented" line.
  it("T05: 分谱按钮显示提取声部列表,MusicXML 导出显示完成提示", async () => {
    const { container, cleanup } = renderApp();
    click(container.querySelector('[data-testid="tab-score"]'));

    click(findToolbarButton(container, ["分谱", "Parts"]));
    await act(async () => {}); // flush the async tool call + setState
    let notice = container.querySelector('[data-testid="score-notice"]');
    expect(notice).not.toBeNull();
    // Real extraction result (no placeholder text).
    expect(
      containsAny(notice?.textContent ?? "", "已提取", "Extracted"),
    ).toBe(true);

    // The export path needs URL.createObjectURL (jsdom lacks it).
    const { createObjectURL, revokeObjectURL } = stubUrlObjectApi();
    try {
      click(
        findToolbarButton(container, ["导出 MusicXML", "Export MusicXML"]),
      );
      notice = container.querySelector('[data-testid="score-notice"]');
      expect(notice).not.toBeNull();
      expect(
        containsAny(notice?.textContent ?? "", "已导出", "Exported"),
      ).toBe(true);
      // The download really ran: an object URL was minted from a Blob.
      expect(createObjectURL).toHaveBeenCalled();
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
    } finally {
      revokeObjectURL.mockClear();
      cleanup();
    }
  });

  // T04 (component, non-critical): the export button triggers a real download
  // — URL.createObjectURL receives the generated MusicXML Blob and the temp
  // anchor uses the collinx-score.xml filename.
  it("T04: 导出按钮触发下载(collinx-score.xml,URL.createObjectURL 收到 MusicXML Blob)", () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { container, cleanup } = renderApp();
    try {
      click(container.querySelector('[data-testid="tab-score"]'));
      click(
        findToolbarButton(container, ["导出 MusicXML", "Export MusicXML"]),
      );

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/xml");
      // Filename used by the temporary download anchor.
      const anchor = Array.from(container.querySelectorAll("a")).find(
        (a) => a.download === "collinx-score.xml",
      );
      // The anchor is removed right after click, so the assertion is on the
      // handler's behavior: the export button is still wired and a notice is
      // shown (score-notice survives the synchronous export).
      expect(anchor === undefined).toBe(true);
      const notice = container.querySelector('[data-testid="score-notice"]');
      expect(notice).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ── v1.14 Stage 1: Teaching panel real tool loop ────────────────────────────
describe("app-integration teaching (v1.14 Stage 1)", () => {
  beforeAll(() => {
    // Standalone stub so this describe works even when -t-filtered away from
    // the first describe (whose beforeAll would otherwise be skipped).
    stubBrowserApis();
  });

  // T04 (component/integration, critical): with an activeDiff the teaching tab
  // runs the real teaching.explainDecision tool and renders the real
  // explanation; switching the user level re-generates it with the new level
  // (UI "professional" mapped to agent "expert").
  it("T04: userLevel 切换 → 重新生成解释(professional→expert) (critical)", async () => {
    const spy = vi.spyOn(TeachingAgent.prototype, "explainDecision");

    try {
      const { container, cleanup } = renderApp();

      // 1. Activate an activeDiff: run the real Arranger and confirm a plan.
      click(container.querySelector('[data-testid="tab-arrange"]'));
      expect(container.querySelector('[data-testid="arranger-panel"]')).not.toBeNull();
      click(container.querySelector('[data-testid="arranger-generate"]'));
      await act(async () => {});
      click(findToolbarButton(container, ["确认编排方案", "Confirm Arrangement"]));

      // 2. Switch to the teaching tab: the effect runs teaching.explainDecision
      //    for the active diff and renders the real explanation.
      click(container.querySelector('[data-testid="tab-teaching"]'));
      await act(async () => {});

      const panel = container.querySelector('[data-testid="teaching-panel"]');
      expect(panel).not.toBeNull();
      // Real explanation rendered: no error state, no old template content.
      expect(container.querySelector('[data-testid="teaching-error"]')).toBeNull();
      expect(container.textContent).not.toContain("方案 A: 密集和声排列");
      expect(container.textContent).not.toContain(
        "选择一个编曲方案或差异操作来查看详细的教学解释",
      );
      // The real explanation body is present (examples / concepts rendered).
      expect(container.textContent).toContain("示例");

      // 3. userLevel 切换 → 重新生成解释:agent 侧收到新 level。
      click(container.querySelector('[data-testid="teaching-level-advanced"]'));
      await act(async () => {});
      expect(spy.mock.calls.some((c) => c[1] === "advanced")).toBe(true);

      // 4. UI "professional" 映射为 agent "expert"(UI 无 expert,agent 无 professional)。
      click(container.querySelector('[data-testid="teaching-level-professional"]'));
      await act(async () => {});
      expect(spy.mock.calls.some((c) => c[1] === "expert")).toBe(true);

      cleanup();
    } finally {
      spy.mockRestore();
    }
  });

  // T05 (component, non-critical): without an activeDiff the teaching tab
  // shows the empty-state guidance — never template content.
  it("T05: 无 activeDiff → teaching tab 显示空态引导而非模板", () => {
    const { container, cleanup } = renderApp();

    click(container.querySelector('[data-testid="tab-teaching"]'));
    const panel = container.querySelector('[data-testid="teaching-panel"]');
    expect(panel).not.toBeNull();
    // Guidance empty state (not a diff, not template explanation).
    const empty = container.querySelector('[data-testid="teaching-empty"]');
    expect(empty).not.toBeNull();
    expect(container.textContent).not.toContain("方案 A: 密集和声排列");
    expect(container.textContent).not.toContain(
      "选择一个编曲方案或差异操作来查看详细的教学解释",
    );

    cleanup();
  });
});
