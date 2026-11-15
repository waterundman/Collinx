/**
 * v3.2.0 S2：乐段结构编辑的存储层行为。
 *
 * 保护的用户可见行为：
 *   1. 一次结构编辑 = 一条 undo（拖动一万次像素也只产生一次 graph 更新）；
 *   2. 区间只接受正整数、startBar <= endBar、且不与其它乐段重叠 ——
 *      被拒绝的输入既不改变图，也不产生一条"空 undo"（否则撤销一次没反应）；
 *   3. 删除乐段只删结构节点，绝不级联删除落在该区间里的音符
 *      （乐段是分组，不是音符的所有者）。
 *
 * 复用 undo-limit 测试的 provider 探针写法（真 ProjectProvider + 真 Settings）。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNoteEvent } from "@collinx/core";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { SettingsProvider } from "../../contexts/SettingsContext";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

function setup() {
  localStorage.setItem(
    "collinx_settings",
    JSON.stringify({
      general: { autoSave: { enabled: false, interval: 300 } },
    }),
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
        <ProjectProvider title="Phrase" pendingDiffs={[]}>
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
    /** 图里所有 Phrase 节点，按 startBar 排序 */
    phrases() {
      return this.value.graph
        .getNodesByType("Phrase")
        .map((n) => ({
          id: n.id,
          startBar: Number(n.data.startBar),
          endBar: Number(n.data.endBar),
          formRole: String(n.data.formRole),
        }))
        .sort((a, b) => a.startBar - b.startBar);
    },
    undoDepth() {
      return this.value.undoStack.length;
    },
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("v3.2.0 S2: 乐段结构编辑写入 graph", () => {
  it("addPhrase 写入真实 Phrase 节点，并产生一条 undo", () => {
    const h = setup();
    const before = h.undoDepth();

    act(() => {
      h.value.actions.addPhrase({
        name: "Intro",
        formRole: "intro",
        startBar: 1,
        endBar: 4,
      });
    });

    expect(h.phrases()).toEqual([
      { id: expect.any(String), startBar: 1, endBar: 4, formRole: "intro" },
    ]);
    expect(h.undoDepth()).toBe(before + 1);

    h.cleanup();
  });

  it("updatePhrase 移动乐段 → 一次编辑一条 undo，undo 一步回到原位", () => {
    const h = setup();
    act(() => {
      h.value.actions.addPhrase({
        name: "Intro",
        formRole: "intro",
        startBar: 1,
        endBar: 4,
      });
    });
    const id = h.phrases()[0].id;
    const depth = h.undoDepth();

    act(() => {
      h.value.actions.updatePhrase(id, { startBar: 3, endBar: 6 });
    });

    // 结构真的改了（不是只有 store 计数变了）
    expect(h.phrases()[0]).toMatchObject({ startBar: 3, endBar: 6 });
    // 一次结构更新只压一条 undo
    expect(h.undoDepth()).toBe(depth + 1);

    act(() => {
      h.value.actions.undo();
    });
    expect(h.phrases()[0]).toMatchObject({ startBar: 1, endBar: 4 });
    expect(h.undoDepth()).toBe(depth);

    h.cleanup();
  });

  it("区间非法（与相邻乐段重叠）→ 图不变且不产生 undo 记录", () => {
    const h = setup();
    act(() => {
      h.value.actions.addPhrase({
        name: "Intro",
        formRole: "intro",
        startBar: 1,
        endBar: 4,
      });
      h.value.actions.addPhrase({
        name: "Verse",
        formRole: "verse",
        startBar: 10,
        endBar: 13,
      });
    });
    const introId = h.phrases()[0].id;
    const depth = h.undoDepth();
    const snapshot = JSON.stringify(h.phrases());

    // 9-12 会侵入 Verse（10-13）
    act(() => {
      h.value.actions.updatePhrase(introId, { startBar: 9, endBar: 12 });
    });

    expect(JSON.stringify(h.phrases())).toBe(snapshot);
    // 关键：被拒的输入不能留下一条"撤销了也没变化"的记录
    expect(h.undoDepth()).toBe(depth);

    h.cleanup();
  });

  it("区间非法（0 或非整数）→ 图不变且不产生 undo 记录", () => {
    const h = setup();
    act(() => {
      h.value.actions.addPhrase({
        name: "Intro",
        formRole: "intro",
        startBar: 1,
        endBar: 4,
      });
    });
    const id = h.phrases()[0].id;
    const depth = h.undoDepth();

    act(() => {
      h.value.actions.updatePhrase(id, { startBar: 0, endBar: 3 });
    });
    act(() => {
      h.value.actions.updatePhrase(id, { startBar: 1.5, endBar: 4 });
    });

    expect(h.phrases()[0]).toMatchObject({ startBar: 1, endBar: 4 });
    expect(h.undoDepth()).toBe(depth);

    h.cleanup();
  });

  it("deletePhrase 只删结构节点，不级联删除区间内的音符；undo 可复原", () => {
    const h = setup();
    act(() => {
      h.value.actions.addPhrase({
        name: "Intro",
        formRole: "intro",
        startBar: 1,
        endBar: 8,
      });
    });
    const id = h.phrases()[0].id;

    act(() => {
      h.value.actions.addNote(
        createNoteEvent({
          trackId: "melody",
          bar: 2,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
        }),
      );
    });
    const notesBefore = h.value.notes.length;
    // 默认工程自带种子音符 —— 这里只关心"删乐段不会动音符"，不假设具体条数
    expect(notesBefore).toBeGreaterThan(0);

    act(() => {
      h.value.actions.deletePhrase(id);
    });

    expect(h.phrases()).toHaveLength(0);
    // 乐段不是音符所有者：音符必须还在
    expect(h.value.notes).toHaveLength(notesBefore);

    act(() => {
      h.value.actions.undo();
    });
    expect(h.phrases()).toHaveLength(1);
    expect(h.value.notes).toHaveLength(notesBefore);

    h.cleanup();
  });
});
