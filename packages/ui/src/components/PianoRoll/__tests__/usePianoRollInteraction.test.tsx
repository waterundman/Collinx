/**
 * v1.29.0 Stage 1 (S1-T01 / S1-T04): PianoRoll 交互——clean click 试听回调。
 *
 * 断言策略（无 @testing-library/react，沿用 S0 useMidiOutput.test.tsx 的
 * createRoot + act 手写 harness）：直渲 hook（Probe 组件把最近一次返回值
 * 暴露给测试），手工调用 updateNoteRects 注入命中矩形，再按
 * mousedown → (mousemove) → mouseup 顺序驱动交互。
 *
 * 命中矩形与坐标推导（禁魔法数）：
 *   NOTE_RECT = { x:10, y:10, w:40, h:17 }，正文点击点 (20,15) 落在
 *   [x-2, x+w+2]×[y, y+h] = [8,52]×[10,27] 内，且 20 < x+w-6（=44，右缘
 *   resize 阈值 6）→ edge='body'，进入 move 拖拽模式。
 *
 * 关键背景（D2-1）：hasMoved 原先恒为 false（handleMouseMove 从未置位），
 * 导致任何 mousedown+mouseup 都走 clean-click 分支。S1-T01 要求"带 mousemove
 * 的拖拽不试听"，故实现同步补置 hasMoved（见实现文件注释）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteEvent } from "@collinx/core";
import {
  usePianoRollInteraction,
  type UsePianoRollInteractionParams,
} from "../usePianoRollInteraction";

type Interaction = ReturnType<typeof usePianoRollInteraction>;

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: "n1",
    trackId: "default",
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1,
    pitchMidi: 60,
    pitchSpelling: "",
    velocity: 0.8,
    voice: "rh",
    tags: [],
    ...overrides,
  } as NoteEvent;
}

/** 命中矩形：宽 40 → 正文 x∈[10,44)，右缘 resize 阈值 6px。 */
const NOTE_RECT = { x: 10, y: 10, w: 40, h: 17 };
const BODY_X = 20; // ∈ [10,44) → body
const BODY_Y = 15; // ∈ [10,27)
const OUTSIDE_X = 500; // 空白区
const OUTSIDE_Y = 500;

interface Harness {
  get: () => Interaction;
  unmount: () => void;
}

function renderInteraction(params: UsePianoRollInteractionParams): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  const latest: { value: Interaction | null } = { value: null };

  function Probe() {
    latest.value = usePianoRollInteraction(params);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    get: () => latest.value!,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function makeParams(
  overrides: Partial<UsePianoRollInteractionParams> = {}
): UsePianoRollInteractionParams {
  return {
    notes: [makeNote()],
    viewRange: { startBar: 1, endBar: 8 },
    pixelsPerBeat: 40,
    scrollX: 0,
    scrollY: 0,
    selectedNoteIds: [],
    ...overrides,
  };
}

/** 注入命中矩形（hitTest 依赖 noteRectsRef，正常由 drawCanvas 写入）。 */
function setNoteRects(h: Harness) {
  act(() => {
    h.get().updateNoteRects(new Map([["n1", NOTE_RECT]]));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("usePianoRollInteraction onNoteAudition (v1.29 S1-T01)", () => {
  it("S1-T01a: clean click（无 mousemove）→ onNoteAudition 调一次，参数 (pitchMidi, velocity) (critical)", () => {
    const onNoteAudition = vi.fn();
    const onNoteSelect = vi.fn();
    const h = renderInteraction(makeParams({ onNoteAudition, onNoteSelect }));
    setNoteRects(h);

    act(() => {
      h.get().handleMouseDown(BODY_X, BODY_Y);
    });
    act(() => {
      h.get().handleMouseUp(BODY_X, BODY_Y);
    });

    // 试听恰好一次，参数为 note 的 pitchMidi / 归一化 velocity(0-1)
    expect(onNoteAudition).toHaveBeenCalledTimes(1);
    expect(onNoteAudition).toHaveBeenCalledWith(60, 0.8);
    // 既有选中路径保持不变（clean click 仍二次确认选中）
    expect(onNoteSelect).toHaveBeenCalledWith(["n1"]);

    h.unmount();
  });

  it("S1-T01b: 带 mousemove 的拖拽 → onNoteAudition 不触发（仅 onNoteMove） (critical)", () => {
    const onNoteAudition = vi.fn();
    const onNoteMove = vi.fn();
    const h = renderInteraction(makeParams({ onNoteAudition, onNoteMove }));
    setNoteRects(h);

    act(() => {
      h.get().handleMouseDown(BODY_X, BODY_Y);
    });
    // 拖动 40px：deltaX=40 ≥ 命中矩形经度 → hasMoved=true
    act(() => {
      h.get().handleMouseMove(BODY_X + 40, BODY_Y);
    });
    expect(onNoteMove).toHaveBeenCalledTimes(1);
    act(() => {
      h.get().handleMouseUp(BODY_X + 40, BODY_Y);
    });

    expect(onNoteAudition).not.toHaveBeenCalled();

    h.unmount();
  });

  it("S1-T01c: 空白区点击（无 hit，走 else 分支）→ onNoteAudition 不触发 (critical)", () => {
    const onNoteAudition = vi.fn();
    const onNoteSelect = vi.fn();
    const h = renderInteraction(makeParams({ onNoteAudition, onNoteSelect }));
    setNoteRects(h);

    act(() => {
      h.get().handleMouseDown(OUTSIDE_X, OUTSIDE_Y);
    });
    act(() => {
      h.get().handleMouseUp(OUTSIDE_X, OUTSIDE_Y);
    });

    expect(onNoteAudition).not.toHaveBeenCalled();
    // 空白点击清空选中（既有行为）
    expect(onNoteSelect).toHaveBeenCalledWith([]);

    h.unmount();
  });

  it("S1-T01d: 双击添加音符 → onNoteAudition 不触发 (non-critical)", () => {
    const onNoteAudition = vi.fn();
    const onNoteAdd = vi.fn();
    const h = renderInteraction(makeParams({ onNoteAudition, onNoteAdd }));
    setNoteRects(h);

    act(() => {
      h.get().handleDoubleClick(OUTSIDE_X, OUTSIDE_Y);
    });

    expect(onNoteAdd).toHaveBeenCalledTimes(1);
    expect(onNoteAudition).not.toHaveBeenCalled();

    h.unmount();
  });
});

describe("usePianoRollInteraction 零行为变化 (v1.29 S1-T04)", () => {
  it("S1-T04: 不传 onNoteAudition → 选中/拖拽/删除/双击添加既有路径零变化 (non-critical)", () => {
    const onNoteSelect = vi.fn();
    const onNoteMove = vi.fn();
    const onNoteResize = vi.fn();
    const onNoteDelete = vi.fn();
    const onNoteAdd = vi.fn();

    // (1) clean click → 选中；不传 onNoteAudition 不抛错
    const h = renderInteraction(
      makeParams({
        onNoteSelect,
        onNoteMove,
        onNoteResize,
        onNoteDelete,
        onNoteAdd,
        selectedNoteIds: ["n1"],
      })
    );
    setNoteRects(h);

    act(() => {
      h.get().handleMouseDown(BODY_X, BODY_Y);
    });
    act(() => {
      h.get().handleMouseUp(BODY_X, BODY_Y);
    });
    expect(onNoteSelect).toHaveBeenCalledWith(["n1"]);

    // (2) 拖拽正文 → onNoteMove（pitch 越界 clamp 后仍是 60）
    act(() => {
      h.get().handleMouseDown(BODY_X, BODY_Y);
    });
    act(() => {
      h.get().handleMouseMove(BODY_X + 40, BODY_Y);
    });
    expect(onNoteMove).toHaveBeenCalledTimes(1);

    // (3) Delete 键 → onNoteDelete（selectedNoteIds=['n1']）
    act(() => {
      h.get().handleKeyDown({
        key: "Delete",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    expect(onNoteDelete).toHaveBeenCalledWith("n1");

    // (4) 空白双击 → onNoteAdd
    act(() => {
      h.get().handleDoubleClick(OUTSIDE_X, OUTSIDE_Y);
    });
    expect(onNoteAdd).toHaveBeenCalledTimes(1);

    h.unmount();
  });
});
