/**
 * v2.9.3：撤销栈上限跟随设置。
 *
 * 旧行为：`MAX_UNDO = 50` 写死，设置页的 100/500/1000/不限制全是摆设。
 * 新行为：设置 → `state.undoLimit` → `withUndo` 按它裁剪。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { SettingsProvider } from "../../contexts/SettingsContext";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";
import { resolveUndoLimit, MAX_UNDO, UNDO_HARD_CAP } from "../../store/project-store";

function setup(maxLevels: number | "unlimited") {
  localStorage.setItem(
    "collinx_settings",
    JSON.stringify({ general: { undoHistory: { maxLevels }, autoSave: { enabled: false, interval: 300 } } }),
  );

  let current: ProjectStoreValue | null = null;
  let root: Root;
  let container: HTMLDivElement;
  function Probe() {
    current = useProjectStore();
    return null;
  }
  act(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <SettingsProvider>
        <ProjectProvider title="Undo" pendingDiffs={[]}>
          <Probe />
        </ProjectProvider>
      </SettingsProvider>,
    );
  });
  return {
    get value(): ProjectStoreValue {
      if (!current) throw new Error("not mounted");
      return current;
    },
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

describe("resolveUndoLimit", () => {
  it("数字直接采用；unlimited 用硬上限；非法值回退默认", () => {
    expect(resolveUndoLimit(100)).toBe(100);
    expect(resolveUndoLimit("unlimited")).toBe(UNDO_HARD_CAP);
    expect(resolveUndoLimit(undefined)).toBe(MAX_UNDO);
    expect(resolveUndoLimit(0)).toBe(MAX_UNDO);
    expect(resolveUndoLimit(99_999)).toBe(UNDO_HARD_CAP);
  });
});

describe("设置 → 撤销栈上限", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("初始状态读设置（100 步）", () => {
    const s = setup(100);
    expect(s.value.undoLimit).toBe(100);
    s.cleanup();
  });

  it("超出上限的旧快照被裁掉（3 步上限，做 5 次编辑）", () => {
    const s = setup(3);
    for (let i = 0; i < 5; i++) {
      act(() => {
        s.value.actions.addMixerTrack(`T${i}`, `t${i}`);
      });
    }
    expect(s.value.undoLimit).toBe(3);
    expect(s.value.undoStack).toHaveLength(3);
    s.cleanup();
  });

  it("不限制 → 硬上限，且不因默认值退回 50", () => {
    const s = setup("unlimited");
    expect(s.value.undoLimit).toBe(UNDO_HARD_CAP);
    s.cleanup();
  });
});
