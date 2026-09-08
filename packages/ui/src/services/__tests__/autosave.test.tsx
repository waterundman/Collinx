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

// ---------------------------------------------------------------------------
// v1.18.0 Stage 1: 指纹补强测试（追加，不改既有断言）。
// T01 (critical): pendingDiffs 等量置换 —— REJECT 一个旧提案 + 注入一个新
//   提案，pendingDiffs 长度不变但 diffId 列表变化（pendingDiffSig）→ 指纹
//   变化 → interval 触发新写入。旧实现只看长度会漏写这一维。
// T02 (critical): mixer fxChain 变更（gain/pan/mute/solo 不变）→ mixerSig
//   内 JSON.stringify(t.fxChain) 变化 → 触发写入。
// ---------------------------------------------------------------------------

describe("autosave fingerprint hardening (v1.18.0 T01/T02)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("T01: pendingDiffs 等量置换（长度不变、diffId 列表变化）→ 触发新写入", async () => {
    const KEY = "collinx.test.autosave.v118.t01";
    const s = setupProvider(KEY);
    try {
      // 初始 2 条 demo 提案；apply 第一条（pending 2→1、applied 0→1、
      // graph revision 变化）→ 首次写入。
      expect(s.value.pendingDiffs).toHaveLength(2);
      const first = s.value.pendingDiffs[0];
      act(() => {
        s.value.actions.applyDiff(first);
      });
      expect(s.value.pendingDiffs).toHaveLength(1);
      expect(s.value.appliedDiffs).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
      });
      const rawA = window.localStorage.getItem(autosaveSlotKey(0));
      expect(rawA).not.toBeNull();
      const snapA = JSON.parse(rawA!) as { savedAt: string };
      expect(snapA.savedAt).toBeTruthy();

      // 等量置换：REJECT 剩余旧提案（1→0）+ suggestMixingChain 注入一条新
      // 提案（0→1）。净效果：pendingDiffs 长度与上次写入时一致（1）、
      // appliedDiffs/notes/graph/mixer/genome 全部未动 —— 旧版仅看长度的
      // 指纹会判定"无变化"而跳过；v1.18.0 的 pendingDiffSig（diffId 列表）
      // 必须识别出变化。
      const remaining = s.value.pendingDiffs[0];
      act(() => {
        s.value.actions.rejectDiff(remaining.diffId);
      });
      expect(s.value.pendingDiffs).toHaveLength(0);
      act(() => {
        s.value.actions.suggestMixingChain();
      });
      expect(s.value.pendingDiffs).toHaveLength(1);
      expect(s.value.pendingDiffs[0].diffId).not.toBe(remaining.diffId);
      // 其余指纹维度与写入 A 时一致。
      expect(s.value.appliedDiffs).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
      });

      // 新写入发生：slot0 savedAt 更新，且旧快照 A 顺移到 slot1（轮转证明
      // 写入确实发生，而非扫描读到旧值）。
      const rawB = window.localStorage.getItem(autosaveSlotKey(0));
      expect(rawB).not.toBeNull();
      const snapB = JSON.parse(rawB!) as { savedAt: string };
      expect(snapB.savedAt).not.toBe(snapA.savedAt);
      const raw1 = window.localStorage.getItem(autosaveSlotKey(1));
      expect(raw1).not.toBeNull();
      const slot1 = JSON.parse(raw1!) as { savedAt: string };
      expect(slot1.savedAt).toBe(snapA.savedAt);
    } finally {
      s.cleanup();
    }
  });

  it("T02: mixer fxChain 变更（gain/pan/mute/solo 不变）→ 触发新写入", async () => {
    const KEY = "collinx.test.autosave.v118.t02";
    const s = setupProvider(KEY);
    try {
      // 首次写入：普通编辑（notes 变化）触发。
      act(() => {
        s.value.actions.addNote(
          createNoteEvent({ trackId: "melody", bar: 2, beat: 2, durQn: 1, pitchMidi: 64 })
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
      });
      const rawA = window.localStorage.getItem(autosaveSlotKey(0));
      expect(rawA).not.toBeNull();
      const snapA = JSON.parse(rawA!) as { savedAt: string };

      // 仅替换 melody 轨 fxChain（新增一个 reverb slot），gain/pan/mute/solo
      // 均不变 —— 旧版 mixerSig 只含 gain:pan:mute:solo，会漏掉这次变更；
      // v1.18.0 将 JSON.stringify(t.fxChain) 折入 mixerSig 后必须触发写入。
      const track = s.value.mixer.tracks.find((t) => t.sourceTrackId === "melody");
      expect(track).toBeDefined();
      act(() => {
        s.value.actions.updateMixerTrack(track!.id, {
          fxChain: {
            ...track!.fxChain,
            slots: [
              {
                id: "test-fx-slot-1",
                type: "reverb",
                preset: "hall",
                params: {},
                enabled: true,
              },
            ],
          },
        });
      });
      // gain 未变（变更只针对 fxChain）。
      expect(s.value.mixer.tracks.find((t) => t.id === track!.id)!.gainDb).toBe(
        track!.gainDb
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 1000);
      });

      const rawB = window.localStorage.getItem(autosaveSlotKey(0));
      expect(rawB).not.toBeNull();
      const snapB = JSON.parse(rawB!) as { savedAt: string };
      expect(snapB.savedAt).not.toBe(snapA.savedAt);
      const raw1 = window.localStorage.getItem(autosaveSlotKey(1));
      expect(raw1).not.toBeNull();
      const slot1 = JSON.parse(raw1!) as { savedAt: string };
      expect(slot1.savedAt).toBe(snapA.savedAt);
    } finally {
      s.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// v1.18.0 Stage 1: quota 降级测试（service 级纯函数，无需 Provider）。
// ---------------------------------------------------------------------------

describe("autosave quota degradation (v1.18.0 T03)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  /** 直接预置三个内容可辨识的槽（绕过 writeAutosaveSlot，避免与其内部
   *  顺移逻辑耦合）。 */
  function seedSlots(): void {
    window.localStorage.setItem(
      autosaveSlotKey(0),
      JSON.stringify({ savedAt: TIMES[0], data: { marker: "old0" } })
    );
    window.localStorage.setItem(
      autosaveSlotKey(1),
      JSON.stringify({ savedAt: TIMES[1], data: { marker: "old1" } })
    );
    window.localStorage.setItem(
      autosaveSlotKey(2),
      JSON.stringify({ savedAt: TIMES[2], data: { marker: "old2" } })
    );
  }

  it("T03: slot0 写入配额失败 → 淘汰最旧非空槽（slot2）重试一次 → 新快照落位", () => {
    seedSlots();
    const realSetItem = Storage.prototype.setItem;
    let slot0WriteFailed = false;
    // 仅第一次对 slot0 的最终写入抛配额错误；顺移（slot1/slot2 的搬移）
    // 与淘汰后的重试均走真实实现 —— 精确命中 autosave.ts 的降级分支。
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (key === autosaveSlotKey(0) && !slot0WriteFailed) {
          slot0WriteFailed = true;
          throw new DOMException("mock quota exceeded", "QuotaExceededError");
        }
        realSetItem.call(window.localStorage, key, value);
      });
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    expect(setItemSpy).toBeDefined();

    expect(() => writeAutosaveSlot(snapshotJson("new"), TIMES[3])).not.toThrow();

    // 淘汰了最旧的非空槽（slot2）。
    expect(removeItemSpy).toHaveBeenCalledWith(autosaveSlotKey(2));
    expect(window.localStorage.getItem(autosaveSlotKey(2))).toBeNull();
    // 重试成功：新快照落位 slot0。
    const raw0 = window.localStorage.getItem(autosaveSlotKey(0));
    expect(raw0).not.toBeNull();
    const parsed0 = JSON.parse(raw0!) as { savedAt: string; data: { marker: string } };
    expect(parsed0.savedAt).toBe(TIMES[3]);
    expect(parsed0.data.marker).toBe("new");
    // 顺移仍正常：slot1 承接原 slot0 内容。
    const raw1 = window.localStorage.getItem(autosaveSlotKey(1));
    expect(raw1).not.toBeNull();
    const parsed1 = JSON.parse(raw1!) as { data: { marker: string } };
    expect(parsed1.data.marker).toBe("old0");
  });

  it("T03b: 全部 setItem 持续失败 → 不抛错，已有快照保留（仅淘汰最旧槽腾位）", () => {
    seedSlots();
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("mock quota exceeded", "QuotaExceededError");
      });
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    expect(setItemSpy).toBeDefined();

    // 顺移与最终写入全部失败：静默淘汰最旧槽后重试仍失败 → 放弃本次
    // 写入，绝不向上抛错。
    expect(() => writeAutosaveSlot(snapshotJson("new"), TIMES[3])).not.toThrow();

    // 依赖 L98-107 的淘汰逻辑：removeItem 被调用以腾位。
    expect(removeItemSpy).toHaveBeenCalledWith(autosaveSlotKey(2));
    // 放弃写入：slot0 原有快照原样保留。
    const raw0 = window.localStorage.getItem(autosaveSlotKey(0));
    expect(raw0).not.toBeNull();
    const parsed0 = JSON.parse(raw0!) as { savedAt: string; data: { marker: string } };
    expect(parsed0.savedAt).toBe(TIMES[0]);
    expect(parsed0.data.marker).toBe("old0");
  });
});
