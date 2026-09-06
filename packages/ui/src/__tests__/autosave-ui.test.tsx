import { describe, it, expect, beforeAll, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";
import type { ProjectStoreValue } from "../store/project-store";
import {
  DiffEngine,
  ProjectGraph,
  TasteGenome,
  TasteStore,
  createDiffEnvelope,
  createNoteEvent,
  createTrack,
  type DiffEnvelope,
  type MixerState,
  type NoteEvent,
} from "@collinx/core";
import { collectAgentMusicData } from "../services/agentmusic-bridge";
import {
  autosaveSlotKey,
  writeAutosaveSlot,
  scanAutosaveSlots,
} from "../services/autosave";
import { createDemoNotes } from "../data/demoData";

// ---------------------------------------------------------------------------
// v1.17.0 Stage 1: 崩溃恢复入口（TopBar）测试。
// T03 (critical): 恢复往返 —— 自动保存槽（含 appliedDiffs/rollbackSnapshots）
// → 主状态缺失 → 恢复 → 状态一致且历史 diff 可回滚。
// T04: 无快照不渲染恢复入口；有快照且用户未点击前 store 不被修改。
// ---------------------------------------------------------------------------

const RECOVERY_SAVED_AT = "2026-09-05T06:32:00.000Z";

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
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
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

function makeMixer(): MixerState {
  return {
    tracks: [createTrack("Lead", "lead")],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

/** 构造一份带 diff 历史（appliedDiffs + rollbackSnapshots）的快照并写入
 *  自动保存槽。返回 diff 供恢复断言使用。 */
function seedAutosaveSlot(): DiffEnvelope {
  const note = createNoteEvent({
    trackId: "lead",
    bar: 1,
    beat: 1,
    durQn: 2,
    pitchMidi: 72,
    pitchSpelling: "C5",
    velocity: 0.9,
    voice: "rh",
  });
  const graph = ProjectGraph.create("Crash Recovery Project");
  graph.addNode("NoteSpan", { ...note });

  const diff = createDiffEnvelope({
    baseRevision: graph.getRevisionId(),
    actor: { type: "system", name: "test" },
    permissionScope: "write_direct",
    summary: "Add crash phrase",
    ops: [
      {
        op: "add_node",
        path: "/",
        nodeType: "Phrase",
        data: { name: "CrashPhrase", formRole: "chorus", startBar: 4, endBar: 5, motifIds: [] },
      },
    ],
  });
  const engine = new DiffEngine();
  const applied = engine.apply(diff, graph);

  const tasteStore = new TasteStore();
  tasteStore.save(TasteGenome.createDefault());

  const data = collectAgentMusicData({
    graph: applied.graph,
    notes: [note],
    mixer: makeMixer(),
    tasteStore,
    appliedDiffs: [diff],
    rollbackSnapshots: engine.exportSnapshots(),
  });

  writeAutosaveSlot(JSON.stringify(data), RECOVERY_SAVED_AT);
  return diff;
}

function renderAppWithProbe(key: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let liveStore: ProjectStoreValue | null = null;
  function Probe() {
    liveStore = useProjectStore();
    return null;
  }
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <ThemeProvider>
            <ProjectProvider persistenceKey={key}>
              <App />
              <Probe />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
      </I18nProvider>
    );
  });
  return {
    container,
    getStore: () => liveStore!,
    cleanup: () => {
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

describe("autosave crash recovery UI (T03)", () => {
  beforeAll(() => stubBrowserApis());
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("T03: 恢复往返 —— 槽快照 → 恢复 → 状态一致且历史 diff 可回滚", async () => {
    const KEY = "collinx.test.autosave.t03";
    window.localStorage.clear();
    const diff = seedAutosaveSlot();

    const { container, getStore, cleanup } = renderAppWithProbe(KEY);
    try {
      // 恢复入口可见，文本含时间（HH:MM，时区无关断言）。
      const btn = container.querySelector('[data-testid="restore-autosave"]');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toMatch(/恢复自动保存|Restore autosave/);
      expect(btn!.textContent).toMatch(/\d{2}:\d{2}/);

      // 用户主动点击 = 确认恢复。
      click(btn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const restored = getStore();
      // graph/notes 来自快照（单条 lead 音符 + 1 个 Phrase 节点）。
      expect(restored.notes).toHaveLength(1);
      expect(restored.notes[0].trackId).toBe("lead");
      expect(restored.notes[0].pitchMidi).toBe(72);
      expect(restored.graph.getNodesByType("Phrase")).toHaveLength(1);
      // appliedDiffs 完整重建。
      expect(restored.appliedDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);
      expect(restored.rollbackTokens).toContain(diff.rollbackToken);

      // 历史 diff 可回滚（DiffEngine 快照经 restoreDiffHistory 重建）。
      act(() => {
        restored.actions.rollbackDiff(diff.rollbackToken);
      });
      const afterRollback = getStore();
      expect(afterRollback.graph.getNodesByType("Phrase")).toHaveLength(0);
      expect(
        afterRollback.appliedDiffs.some((d) => d.diffId === diff.diffId)
      ).toBe(false);

      // 恢复后：提示消失 + 槽被清空（避免提示残留）。
      expect(
        container.querySelector('[data-testid="restore-autosave"]')
      ).toBeNull();
      expect(scanAutosaveSlots()).toHaveLength(0);
      expect(window.localStorage.getItem(autosaveSlotKey(0))).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("autosave crash recovery UI (T04)", () => {
  beforeAll(() => stubBrowserApis());
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("T04: 无快照不渲染恢复入口；有快照且用户未点击前 store 不被修改", () => {
    const KEY = "collinx.test.autosave.t04";
    window.localStorage.clear();

    // 无快照：无恢复按钮，demo 工程正常加载。
    const s1 = renderAppWithProbe(KEY);
    try {
      expect(s1.container.querySelector('[data-testid="restore-autosave"]')).toBeNull();
      expect(s1.getStore().notes.length).toBe(createDemoNotes().length);
      expect(s1.getStore().appliedDiffs).toEqual([]);
    } finally {
      s1.cleanup();
    }

    // 有快照：按钮出现，但未点击前 store 保持当前（demo）状态。
    seedAutosaveSlot();
    const s2 = renderAppWithProbe(KEY);
    try {
      expect(
        s2.container.querySelector('[data-testid="restore-autosave"]')
      ).not.toBeNull();
      expect(s2.getStore().notes.length).toBe(createDemoNotes().length);
      expect(s2.getStore().graph.getNodesByType("Phrase")).toHaveLength(0);
      expect(
        s2.getStore().appliedDiffs.some((d) => d.summary === "Add crash phrase")
      ).toBe(false);
    } finally {
      s2.cleanup();
    }
  });
});
