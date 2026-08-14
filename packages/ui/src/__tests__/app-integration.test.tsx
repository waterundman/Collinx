import { describe, it, expect, afterEach, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";

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

describe("app-integration (real App under ProjectProvider)", () => {
  beforeAll(() => {
    // jsdom lacks working implementations of these browser APIs used by
    // ThemeProvider / PianoRollView. jsdom declares matchMedia but it is not a
    // callable function, so force-replace both unconditionally.
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
