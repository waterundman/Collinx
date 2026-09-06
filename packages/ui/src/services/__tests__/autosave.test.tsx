import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNoteEvent } from "@collinx/core";
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_SLOT_COUNT,
  autosaveSlotKey,
  writeAutosaveSlot,
  scanAutosaveSlots,
  clearAutosaveSlots,
} from "../autosave";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

// ---------------------------------------------------------------------------
// v1.17.0 Stage 1: 自动保存轮转槽 service 测试。
// T01 (critical): 定时快照轮转语义 —— 由 writeAutosaveSlot 直接验证（定时器
// 触发逻辑由 T02 经真实 ProjectProvider interval 覆盖）。
// T02 (critical): 脏检测 —— 状态无变更时 interval 触发不写槽；状态变更后
// 下一个 interval 写入最新快照。
// ---------------------------------------------------------------------------

const TIMES = [
  "2026-09-05T10:00:00.000Z",
  "2026-09-05T10:05:00.000Z",
  "2026-09-05T10:10:00.000Z",
  "2026-09-05T10:15:00.000Z",
];

function snapshotJson(marker: string): string {
  // 最小可解析的 data 对象（scan 只校验结构存在，不校验完整 manifest）。
  return JSON.stringify({ marker, graph: { meta: { title: marker } } });
}

describe("autosave service (T01)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("T01: 写 4 次后最旧被淘汰，scanAutosaveSlots 返回最新 3 条按时间降序", () => {
    for (let i = 0; i < 4; i++) {
      writeAutosaveSlot(snapshotJson(`s${i + 1}`), TIMES[i]);
    }

    const slots = scanAutosaveSlots();
    expect(slots).toHaveLength(3);
    // 降序：最新在前。
    expect(slots[0].savedAt).toBe(TIMES[3]);
    expect(slots[1].savedAt).toBe(TIMES[2]);
    expect(slots[2].savedAt).toBe(TIMES[1]);
    // 淘汰的 s1 不在任何槽中。
    const allRaw = Array.from({ length: AUTOSAVE_SLOT_COUNT }, (_, i) =>
      window.localStorage.getItem(autosaveSlotKey(i))
    );
    expect(allRaw.join("")).not.toContain("s1");

    // payload 是 { savedAt, data } 信封，data 与写入的快照 JSON 一致。
    const parsed = JSON.parse(slots[0].payload) as {
      savedAt: string;
      data: { marker: string };
    };
    expect(parsed.savedAt).toBe(TIMES[3]);
    expect(parsed.data.marker).toBe("s4");
  });

  it("T01b: 损坏/结构缺失的槽被跳过（不抛错），clearAutosaveSlots 清空全部", () => {
    writeAutosaveSlot(snapshotJson("good"), TIMES[0]);
    // 直接写入垃圾 JSON + 结构缺失条目。
    window.localStorage.setItem(autosaveSlotKey(1), "{not json");
    window.localStorage.setItem(autosaveSlotKey(2), JSON.stringify({ foo: 1 }));

    const slots = scanAutosaveSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].savedAt).toBe(TIMES[0]);

    clearAutosaveSlots();
    for (let i = 0; i < AUTOSAVE_SLOT_COUNT; i++) {
      expect(window.localStorage.getItem(autosaveSlotKey(i))).toBeNull();
    }
    expect(scanAutosaveSlots()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T02: 脏检测 —— 经真实 ProjectProvider 的 autosave interval 验证。
// ---------------------------------------------------------------------------

function setupProvider(key: string) {
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
      <ProjectProvider
        title="Autosave Dirty Test"
        persistenceKey={key}
        initialNotes={[
          createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
        ]}
      >
        <Probe />
      </ProjectProvider>
    );
  });

  return {
    get value(): ProjectStoreValue {
      if (!current) throw new Error("Store not initialized");
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

describe("autosave dirty detection (T02)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("T02: 状态无变更时 interval 触发不写槽；变更后下一个 interval 写入且后续无变更不覆盖", async () => {
    const KEY = "collinx.test.autosave.t02";
    const s = setupProvider(KEY);

    // 无编辑：推进 2 个周期，任何槽都不应被写入。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 2 + 1000);
    });
    expect(window.localStorage.getItem(autosaveSlotKey(0))).toBeNull();

    // 编辑 notes（fingerprint 变化）→ 下一个 interval 写入 slot0。
    act(() => {
      s.value.actions.addNote(
        createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 1, pitchMidi: 62 })
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
    });

    const raw0 = window.localStorage.getItem(autosaveSlotKey(0));
    expect(raw0).not.toBeNull();
    const first = JSON.parse(raw0!) as { savedAt: string; data: { graph?: unknown } };
    expect(first.savedAt).toBeTruthy();
    expect(first.data.graph).toBeDefined();

    // 再推进一个周期（期间无任何编辑）：savedAt 不变（未被覆盖）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
    });
    const second = JSON.parse(
      window.localStorage.getItem(autosaveSlotKey(0))!
    ) as { savedAt: string };
    expect(second.savedAt).toBe(first.savedAt);

    s.cleanup();
  });
});
