import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ProjectGraph,
  TasteGenome,
  TasteStore,
  createNoteEvent,
  createDiffEnvelope,
  mixerToDiff,
  type NoteEvent,
  type DiffEnvelope,
  type HarmonyEntry,
  type MixerState,
  type TasteEvidence,
} from "@collinx/core";
import { Orchestrator, EngravingAgent, TeachingAgent } from "@collinx/agent";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import { createBrowserTasteFsAdapter } from "../../services/tasteFsAdapter";
import {
  isMixerDiff,
  MAX_UNDO,
  EMPTY_UI_EXPLANATION,
  type ArrangerRunResult,
  type OrchestratorRunResult,
  type EngravingRunResult,
  type ExtractPartsRunResult,
  type TeachingRunResult,
  type ProjectStoreValue,
} from "../../store/project-store";

function makeNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 1, pitchMidi: 62 }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 2, pitchMidi: 40 }),
  ];
}

// Deterministic mixer with stable track ids so tests can build diffs against
// a known track before rendering the provider.
function makeMixer(): MixerState {
  return {
    tracks: [
      {
        id: "t1",
        name: "Melody",
        sourceTrackId: "melody",
        busType: "group",
        gainDb: "0",
        pan: "0",
        mute: false,
        solo: false,
        fxChain: { id: "fx-1", name: "FX", slots: [] },
        sends: [],
        meterLevel: "0",
      },
      {
        id: "t2",
        name: "Bass",
        sourceTrackId: "bass",
        busType: "group",
        gainDb: "0",
        pan: "0",
        mute: false,
        solo: false,
        fxChain: { id: "fx-2", name: "FX", slots: [] },
        sends: [],
        meterLevel: "0",
      },
    ],
    masterTrack: {
      id: "master",
      name: "Master",
      sourceTrackId: "master",
      busType: "master",
      gainDb: "0",
      pan: "0",
      mute: false,
      solo: false,
      fxChain: { id: "fx-master", name: "FX", slots: [] },
      sends: [],
      meterLevel: "0",
    },
    routingMatrix: {},
  };
}

function setup(initialNotes?: NoteEvent[], initialMixer?: MixerState, pendingDiffs?: DiffEnvelope[]) {
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
        title="Test Project"
        initialNotes={initialNotes}
        initialMixer={initialMixer}
        pendingDiffs={pendingDiffs}
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

describe("project-store", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: ProjectProvider 初始化后 graph 非空,notes 可从 store 查询", () => {
    const notes = makeNotes();
    const s = setup(notes);

    expect(s.value.graph.getAllNodes().length).toBeGreaterThan(0);
    expect(s.value.notes.length).toBe(notes.length);
    expect(s.value.notes.map((n) => n.trackId)).toContain("melody");

    s.cleanup();
  });

  it("T02: applyDiff 使 graph 变更且 pendingDiffs 减少", () => {
    const s = setup();

    const pendingBefore = s.value.pendingDiffs.length;
    expect(pendingBefore).toBeGreaterThan(0);

    const diff = s.value.pendingDiffs[0];
    const nodesBefore = s.value.graph.getAllNodes().length;
    let token: string | undefined;

    act(() => {
      token = s.value.actions.applyDiff(diff);
    });

    expect(s.value.graph.getAllNodes().length).toBeGreaterThan(nodesBefore);
    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.appliedDiffs.length).toBe(1);
    expect(token).toBeDefined();

    s.cleanup();
  });

  it("T03: rollbackDiff 恢复 graph 快照", () => {
    const s = setup();

    const diff = s.value.pendingDiffs[0];
    const nodeIdsBefore = s.value.graph
      .getAllNodes()
      .map((n) => n.id)
      .sort();

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).not.toEqual(nodeIdsBefore);

    act(() => {
      s.value.actions.rollbackDiff(diff.rollbackToken);
    });

    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).toEqual(nodeIdsBefore);
    expect(s.value.appliedDiffs.length).toBe(0);
    expect(s.value.rollbackTokens).not.toContain(diff.rollbackToken);

    s.cleanup();
  });

  it("T04: rejectDiff 仅移除 pending,graph 不变", () => {
    const s = setup();

    const pendingBefore = s.value.pendingDiffs.length;
    const diff = s.value.pendingDiffs[0];
    const graphRef = s.value.graph;
    const nodeIdsBefore = s.value.graph
      .getAllNodes()
      .map((n) => n.id)
      .sort();

    act(() => {
      s.value.actions.rejectDiff(diff.diffId);
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.pendingDiffs.some((d) => d.diffId === diff.diffId)).toBe(false);
    expect(s.value.graph).toBe(graphRef);
    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).toEqual(nodeIdsBefore);
    expect(s.value.appliedDiffs.length).toBe(0);

    s.cleanup();
  });

  it("T05: useProjectStore 在 Provider 外抛错", () => {
    let captured: ProjectStoreValue | null = null;
    let root: Root;
    let container: HTMLDivElement;
    let threw = false;

    function Probe() {
      try {
        captured = useProjectStore();
      } catch {
        threw = true;
      }
      return null;
    }

    act(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(
        <React.Fragment>
          <Probe />
        </React.Fragment>
      );
    });

    expect(threw).toBe(true);
    expect(captured).toBeNull();

    act(() => {
      root.unmount();
      container.remove();
    });
  });

  // Stage 1 acceptance cases: real DiffEngine wiring through the store.
  it("T01: applyDiff 后 pendingDiffs 移除且 appliedDiffs 增加", () => {
    const s = setup();

    const diff = s.value.pendingDiffs[0];
    expect(diff).toBeDefined();
    const pendingBefore = s.value.pendingDiffs.length;
    const appliedBefore = s.value.appliedDiffs.length;

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.pendingDiffs.some((d) => d.diffId === diff.diffId)).toBe(false);
    expect(s.value.appliedDiffs.length).toBe(appliedBefore + 1);
    expect(s.value.appliedDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);

    s.cleanup();
  });

  it("T02: 应用含 add_note_group 的 diff 后 graph 含新 NoteSpan 节点", () => {
    const s = setup();

    const diff = s.value.pendingDiffs.find((d) =>
      d.ops.some((o) => o.op === "add_note_group")
    );
    expect(diff).toBeDefined();
    const noteSpansBefore = s.value.graph.getNodesByType("NoteSpan").length;

    act(() => {
      s.value.actions.applyDiff(diff!);
    });

    const noteSpansAfter = s.value.graph.getNodesByType("NoteSpan").length;
    expect(noteSpansAfter).toBe(noteSpansBefore + diff!.ops.filter((o) => o.op === "add_note_group").length);
    expect(noteSpansAfter).toBeGreaterThan(noteSpansBefore);
    expect(s.value.notes.length).toBe(noteSpansAfter);

    s.cleanup();
  });

  it("T03: 回滚后 graph 恢复应用前状态", () => {
    const s = setup();

    const diff = s.value.pendingDiffs[0];
    expect(diff).toBeDefined();
    const nodeIdsBefore = s.value.graph
      .getAllNodes()
      .map((n) => n.id)
      .sort();

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).not.toEqual(nodeIdsBefore);

    act(() => {
      s.value.actions.rollbackDiff(diff.rollbackToken);
    });

    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).toEqual(nodeIdsBefore);

    s.cleanup();
  });

  it("T04: rollbackDiff 对无效 token 不抛异常(返回原 state)", () => {
    const s = setup();

    const graphRef = s.value.graph;
    let threw = false;

    act(() => {
      try {
        s.value.actions.rollbackDiff("no-such-rollback-token");
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(s.value.graph).toBe(graphRef);

    s.cleanup();
  });

  // ── Stage 2: view data-source migration acceptance cases ─────────────────
  it("Stage2-T01: store.addNote 后 notes 数组更新且 graph 含新 NoteSpan 节点", () => {
    const s = setup(makeNotes());

    const noteSpansBefore = s.value.graph.getNodesByType("NoteSpan").length;
    const notesBefore = s.value.notes.length;
    expect(noteSpansBefore).toBe(notesBefore);

    act(() => {
      s.value.actions.addNote(
        createNoteEvent({ trackId: "melody", bar: 5, beat: 1, durQn: 1, pitchMidi: 72, pitchSpelling: "C5" })
      );
    });

    const noteSpansAfter = s.value.graph.getNodesByType("NoteSpan").length;
    expect(noteSpansAfter).toBe(noteSpansBefore + 1);
    expect(s.value.notes.length).toBe(notesBefore + 1);
    expect(s.value.notes.some((n) => n.bar === 5 && n.beat === 1 && n.pitchMidi === 72)).toBe(true);
    // The new NoteSpan node data round-trips to the appended note event.
    const addedNode = s.value.graph
      .getNodesByType("NoteSpan")
      .find((n) => n.data && n.data.id === s.value.notes[s.value.notes.length - 1].id);
    expect(addedNode).toBeDefined();

    s.cleanup();
  });

  it("Stage2-T02: store 编辑后的 graph 可序列化并还原且数据一致", () => {
    const s = setup(makeNotes());

    // Edit through store actions (add + move + resize + delete).
    const target = s.value.notes[0];
    act(() => {
      s.value.actions.addNote(
        createNoteEvent({ trackId: "bass", bar: 4, beat: 1, durQn: 2, pitchMidi: 41, pitchSpelling: "F2" })
      );
    });
    const movedId = s.value.notes.find((n) => n.id !== target.id)!.id;
    act(() => {
      s.value.actions.moveNote(movedId, 6, 2, 67);
    });
    act(() => {
      s.value.actions.resizeNote(movedId, 1.5);
    });
    act(() => {
      s.value.actions.deleteNote(target.id);
    });

    const json = s.value.graph.toJSON();
    const restored = ProjectGraph.fromJSON(json);
    const restoredJson = restored.toJSON();

    // Same revision, same node/edge sets. created_at is a serialization-time
    // stamp refreshed on every toJSON() call, so compare the payload fields.
    expect(restored.getRevisionId()).toBe(s.value.graph.getRevisionId());
    expect(restored.getAllNodes().length).toBe(s.value.graph.getAllNodes().length);
    expect(restored.getAllEdges().length).toBe(s.value.graph.getAllEdges().length);
    expect(restored.getNodesByType("NoteSpan").length).toBe(
      s.value.graph.getNodesByType("NoteSpan").length
    );
    expect(restoredJson.revision_id).toBe(json.revision_id);
    expect(restoredJson.meta).toEqual(json.meta);
    expect(restoredJson.nodes).toEqual(json.nodes);
    expect(restoredJson.edges).toEqual(json.edges);

    s.cleanup();
  });

  // ── Stage 4: independent edit action coverage (notes + graph stay in sync) ─
  it("Stage4-T01: store.moveNote 更新 graph NoteSpan data 且 notes 数组同步", () => {
    const s = setup(makeNotes());
    const target = s.value.notes.find((n) => n.trackId === "melody")!;
    expect(target).toBeDefined();
    const graphNodeBefore = s.value.graph
      .getNodesByType("NoteSpan")
      .find((n) => n.data?.id === target.id);
    expect(graphNodeBefore?.data.bar).toBe(target.bar);

    act(() => {
      s.value.actions.moveNote(target.id, 6, 2, 67);
    });

    const moved = s.value.notes.find((n) => n.id === target.id)!;
    expect(moved.bar).toBe(6);
    expect(moved.beat).toBe(2);
    expect(moved.pitchMidi).toBe(67);
    // Graph node data round-trips to the same values.
    const graphNodeAfter = s.value.graph
      .getNodesByType("NoteSpan")
      .find((n) => n.data?.id === target.id);
    expect(graphNodeAfter?.data.bar).toBe(6);
    expect(graphNodeAfter?.data.beat).toBe(2);
    expect(graphNodeAfter?.data.pitchMidi).toBe(67);
    expect(graphNodeAfter?.data.pitchSpelling).toBe(moved.pitchSpelling);
    // Note count unchanged; move never adds/removes nodes.
    expect(s.value.notes.length).toBe(makeNotes().length);
    expect(s.value.graph.getNodesByType("NoteSpan").length).toBe(makeNotes().length);

    s.cleanup();
  });

  it("Stage4-T02: store.resizeNote 更新 graph NoteSpan durQn 且 notes 数组同步", () => {
    const s = setup(makeNotes());
    const target = s.value.notes[0];
    const durBefore = target.durQn;

    act(() => {
      s.value.actions.resizeNote(target.id, 1.5);
    });

    const resized = s.value.notes.find((n) => n.id === target.id)!;
    expect(resized.durQn).toBe(1.5);
    expect(resized.durQn).not.toBe(durBefore);
    const graphNode = s.value.graph
      .getNodesByType("NoteSpan")
      .find((n) => n.data?.id === target.id);
    expect(graphNode?.data.durQn).toBe(1.5);
    expect(s.value.notes.length).toBe(makeNotes().length);

    s.cleanup();
  });

  it("Stage4-T03: store.deleteNote 移除 graph NoteSpan 且 notes 数组同步", () => {
    const s = setup(makeNotes());
    const target = s.value.notes[0];
    const noteCountBefore = s.value.notes.length;

    act(() => {
      s.value.actions.deleteNote(target.id);
    });

    expect(s.value.notes.length).toBe(noteCountBefore - 1);
    expect(s.value.notes.some((n) => n.id === target.id)).toBe(false);
    const graphNode = s.value.graph
      .getNodesByType("NoteSpan")
      .find((n) => n.data?.id === target.id);
    expect(graphNode).toBeUndefined();
    // All remaining notes are still backed by a NoteSpan node.
    expect(s.value.graph.getNodesByType("NoteSpan").length).toBe(s.value.notes.length);

    s.cleanup();
  });
});

// ── Stage 0: mixer state in the store + mixer diff chain ────────────────────
describe("project-store mixer (Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: updateMixerTrack 后 mixer 状态更新(gainDb 变更生效)", () => {
    const s = setup(makeNotes(), makeMixer());
    const gainBefore = s.value.mixer.tracks[0].gainDb;

    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-6.5" });
    });

    const track = s.value.mixer.tracks.find((t) => t.id === "t1")!;
    expect(track).toBeDefined();
    expect(track.gainDb).toBe("-6.5");
    expect(track.gainDb).not.toBe(gainBefore);
    // Edit is audit-logged as a DiffEnvelope.
    expect(s.value.mixerDiffLog.length).toBe(1);

    s.cleanup();
  });

  it("T02: 多次 updateMixerTrack 不丢失前序修改(track 更新是合并而非替换)", () => {
    const s = setup(makeNotes(), makeMixer());

    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-3" });
    });
    act(() => {
      s.value.actions.updateMixerTrack("t1", { mute: true });
    });
    act(() => {
      s.value.actions.updateMixerTrack("t1", { pan: "0.5" });
    });

    const track = s.value.mixer.tracks.find((t) => t.id === "t1")!;
    expect(track.gainDb).toBe("-3");
    expect(track.mute).toBe(true);
    expect(track.pan).toBe("0.5");
    // Fields that were never touched keep their defaults.
    expect(track.solo).toBe(false);
    // Untouched sibling tracks are not replaced.
    expect(s.value.mixer.tracks[1].id).toBe("t2");
    expect(s.value.mixer.tracks[1].gainDb).toBe("0");
    // Each edit produced one audit entry.
    expect(s.value.mixerDiffLog.length).toBe(3);

    s.cleanup();
  });

  it("T03: applyMixerDiff 后 mixer 变化且 pending 减少", () => {
    const diff = mixerToDiff(
      [{ trackId: "t1", changes: { gainDb: "-9" } }],
      "mixer://test-base"
    );
    const s = setup(makeNotes(), makeMixer(), [diff]);
    const pendingBefore = s.value.pendingDiffs.length;
    const gainBefore = s.value.mixer.tracks[0].gainDb;

    expect(pendingBefore).toBeGreaterThan(0);
    expect(s.value.pendingDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);

    act(() => {
      s.value.actions.applyMixerDiff(diff);
    });

    expect(s.value.mixer.tracks[0].gainDb).toBe("-9");
    expect(s.value.mixer.tracks[0].gainDb).not.toBe(gainBefore);
    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.pendingDiffs.some((d) => d.diffId === diff.diffId)).toBe(false);
    // The applied proposal lands in the mixer audit trail.
    expect(s.value.mixerDiffLog.some((d) => d.diffId === diff.diffId)).toBe(true);

    s.cleanup();
  });

  // [critical] Stage 4 gap: revertMixerTo had no coverage. The Mixing Agent /
  // Editor "undo" path restores a previously-saved mixer snapshot, so this
  // locks the value restoration (reference + fields) end to end.
  it("T04: revertMixerTo(prevMixer) 恢复 mixer 到保存快照", () => {
    const s = setup(makeNotes(), makeMixer());
    const prevMixer = s.value.mixer;
    const gainBefore = prevMixer.tracks[0].gainDb;
    const fxSlotsBefore = prevMixer.tracks[0].fxChain.slots.length;
    expect(gainBefore).toBe("0");

    // 1. Mutate a track so the mixer drifts from the saved snapshot.
    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-6.5" });
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("-6.5");
    expect(s.value.mixerDiffLog.length).toBe(1);

    // 2. Revert to the saved snapshot.
    act(() => {
      s.value.actions.revertMixerTo(prevMixer);
    });

    // The whole mixer state is replaced by the snapshot (same reference).
    expect(s.value.mixer).toBe(prevMixer);
    expect(s.value.mixer.tracks[0].gainDb).toBe("0");
    expect(s.value.mixer.tracks[0].gainDb).toBe(gainBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBe(fxSlotsBefore);
    // Untouched tracks keep their snapshot values too.
    expect(s.value.mixer.tracks[1].gainDb).toBe("0");
    expect(s.value.mixer.masterTrack.gainDb).toBe("0");

    s.cleanup();
  });
});

// ── Stage 2: Mixing Agent → mixer proposal closed loop ──────────────────────
describe("project-store mixing proposal (Stage 2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: 触发 suggestMixingChain 后 pendingDiffs 增加(提案入队)", () => {
    const s = setup(makeNotes(), makeMixer());
    const pendingBefore = s.value.pendingDiffs.length;

    act(() => {
      s.value.actions.suggestMixingChain();
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore + 1);
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(proposal.actor.name).toBe("mixing");
    expect(proposal.permissionScope).toBe("proposal_only");
    // 提案必须能被 Agent Panel 展示:含领域解释(为什么选这些 FX)
    expect(proposal.domainExplanations.length).toBeGreaterThan(0);
    expect(proposal.ops.length).toBeGreaterThan(0);
    // ops 是 MixerChange 格式的 update_node,可被 diffToMixer 消费
    expect(proposal.ops.every((o) => o.op === "update_node" && o.path.startsWith("/tracks/"))).toBe(true);

    s.cleanup();
  });

  it("T02: 应用 mixing 提案后 mixer 变化(gainDb 与 fxChain)", () => {
    const s = setup(makeNotes(), makeMixer());
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    const pendingBefore = s.value.pendingDiffs.length;
    const gainBefore = s.value.mixer.tracks[0].gainDb;
    const fxSlotsBefore = s.value.mixer.tracks[0].fxChain.slots.length;

    act(() => {
      s.value.actions.applyDiff(proposal);
    });

    // Melody 轨道(sourceTrackId "melody")被分类为 melody → 建议 gain -3
    expect(s.value.mixer.tracks[0].gainDb).toBe("-3");
    expect(s.value.mixer.tracks[0].gainDb).not.toBe(gainBefore);
    // FX 链提案真正落到 mixer(空链路被追加新 slot)
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBeGreaterThan(fxSlotsBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBeGreaterThan(0);
    // 提案从 pending 移除并写入 mixer 审计日志
    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.pendingDiffs.some((d) => d.diffId === proposal.diffId)).toBe(false);
    expect(s.value.mixerDiffLog.some((d) => d.diffId === proposal.diffId)).toBe(true);

    s.cleanup();
  });

  it("T03: 拒绝 mixing 提案后 pending 减少且 mixer 不变", () => {
    const s = setup(makeNotes(), makeMixer());
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    const pendingBefore = s.value.pendingDiffs.length;
    const mixerRef = s.value.mixer;
    const gainBefore = s.value.mixer.tracks[0].gainDb;

    act(() => {
      s.value.actions.rejectDiff(proposal.diffId);
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore - 1);
    expect(s.value.pendingDiffs.some((d) => d.diffId === proposal.diffId)).toBe(false);
    expect(s.value.mixer).toBe(mixerRef);
    expect(s.value.mixer.tracks[0].gainDb).toBe(gainBefore);

    s.cleanup();
  });

  // [critical] Stage 4 gap: domainExplanations content was never asserted.
  // T01 checks the array is non-empty; this locks the actual rationale labels
  // the Agent Panel renders (gain_structure / stereo_image / fx_chain).
  it("T04: mixing 提案的 domainExplanations 含领域解释标签与文案", () => {
    const s = setup(makeNotes(), makeMixer());
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];

    const labels = proposal.domainExplanations.map((e) => e.label);
    expect(labels).toContain("gain_structure");
    expect(labels).toContain("stereo_image");
    expect(labels).toContain("fx_chain");
    // Every explanation carries human-readable text, not just a label.
    for (const exp of proposal.domainExplanations) {
      expect(exp.text.length).toBeGreaterThan(0);
    }

    s.cleanup();
  });
});

// ── v1.15 Stage 1: single-track mixing suggestion ──────────────────────────
describe("project-store single-track mixing suggestion (v1.15 Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: suggestMixingChain(trackId) 仅生成该轨的 FX 链提案(ops 全指向该 trackId)", () => {
    const s = setup(makeNotes(), makeMixer());
    const pendingBefore = s.value.pendingDiffs.length;

    act(() => {
      s.value.actions.suggestMixingChain("t2");
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore + 1);
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(proposal.actor.name).toBe("mixing");
    expect(proposal.permissionScope).toBe("proposal_only");
    // 关键约束:单轨 diff 必须能被 applyDiff 的 isMixerDiff 检测识别
    // (ops 全在 /tracks/<id> 命名空间 + data.trackId),否则提案无法应用。
    expect(isMixerDiff(proposal)).toBe(true);
    expect(proposal.ops.length).toBeGreaterThan(0);
    for (const op of proposal.ops) {
      expect(op.op).toBe("update_node");
      expect(op.path).toBe("/tracks/t2");
      expect((op as { data: Record<string, unknown> }).data.trackId).toBe("t2");
    }
    // 提案只覆盖 t2,不触碰 t1 / master
    const trackIds = proposal.ops.map(
      (o) => (o as { data?: { trackId?: string } }).data?.trackId ?? ""
    );
    expect(trackIds.every((id) => id === "t2")).toBe(true);

    s.cleanup();
  });

  it("T02: 不带 trackId 保持向后兼容(全混音提案覆盖多轨)", () => {
    const s = setup(makeNotes(), makeMixer());
    const pendingBefore = s.value.pendingDiffs.length;

    act(() => {
      s.value.actions.suggestMixingChain();
    });

    expect(s.value.pendingDiffs.length).toBe(pendingBefore + 1);
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(isMixerDiff(proposal)).toBe(true);
    const trackIds = proposal.ops.map(
      (o) => (o as { data?: { trackId?: string } }).data?.trackId ?? ""
    );
    expect(trackIds).toContain("t1");
    expect(trackIds).toContain("t2");
    expect(trackIds).toContain("master");

    s.cleanup();
  });

  it("T04: toolRegistry.call 收到正确 trackId(时间线出现单轨 suggestChain 记录)", async () => {
    const s = setup(makeNotes(), makeMixer());

    act(() => {
      s.value.actions.suggestMixingChain("t2");
    });
    // Flush microtasks so the async ToolRegistry.call success record lands.
    await act(async () => {});

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "mixing.suggestChain"
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("mixing");
    expect(calls[0].params).toHaveProperty("trackId", "t2");

    s.cleanup();
  });
});

// ── Stage 1: TasteStore in the store + browser fs adapter ───────────────────
describe("project-store taste (Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  const PARAM_KEY = "harmony.chromatic_color";

  it("T01: updateTasteParameter 后 genome 参数值变化", () => {
    const s = setup();

    const taste = s.value.tasteStore;
    const before = taste
      .getCurrentGenome()!
      .getParameter(PARAM_KEY)!.value;
    const versionCounterBefore = s.value.genomeVersion;
    expect(before).toBeDefined();

    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.85");
    });

    const after = taste
      .getCurrentGenome()!
      .getParameter(PARAM_KEY)!.value;
    expect(after).toBe("0.85");
    expect(after).not.toBe(before);
    // The counter advanced so consumers re-read the genome.
    expect(s.value.genomeVersion).toBe(versionCounterBefore + 1);
    // A save happened inside the TasteStore as well (version history grew).
    expect(taste.getVersion()).toBeGreaterThan(1);

    s.cleanup();
  });

  it("T02: 浏览器适配器在 jsdom 构造 TasteStore 且 save/getCurrentGenome 可用(不依赖 require(fs))", () => {
    const adapter = createBrowserTasteFsAdapter();
    const store = new TasteStore("taste", adapter);

    const genome = TasteGenome.createDefault();
    const param = genome.getParameter(PARAM_KEY)!;
    genome.setParameter(PARAM_KEY, { ...param, value: "0.42" });
    store.save(genome);

    const current = store.getCurrentGenome()!;
    expect(current.getParameter(PARAM_KEY)?.value).toBe("0.42");
    // Files are persisted into the virtual (localStorage-backed) fs.
    expect(adapter.exists("taste/genome.json")).toBe(true);
    expect(adapter.readFile("taste/genome.json", "utf-8")).toContain("0.42");
    // Versions are persisted too.
    expect(adapter.exists("taste/versions.jsonl")).toBe(true);
  });

  it("T03: revertTasteTo 恢复历史版本(genomeVersion 递增)", () => {
    const s = setup();

    const taste = s.value.tasteStore;
    const original = taste
      .getCurrentGenome()!
      .getParameter(PARAM_KEY)!.value;

    // Advance the genome so an older version exists to revert to.
    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.95");
    });
    expect(taste.getVersion()).toBeGreaterThan(1);
    const versionCounterAfterEdit = s.value.genomeVersion;

    // Revert to the very first saved version (the default genome).
    act(() => {
      s.value.actions.revertTasteTo(1);
    });

    const reverted = taste
      .getCurrentGenome()!
      .getParameter(PARAM_KEY)!.value;
    expect(reverted).toBe(original);
    expect(s.value.genomeVersion).toBe(versionCounterAfterEdit + 1);

    s.cleanup();
  });

  // [critical] Stage 4 gap: deleteTasteEvidence had no coverage. It is the
  // GDPR/cleanup path that removes a single evidence entry from a parameter,
  // so this locks both the removal and the re-render counter bump.
  it("T04: deleteTasteEvidence 移除对应 evidence(genomeVersion 递增)", () => {
    const s = setup();
    const taste = s.value.tasteStore;

    // Seed evidence directly on the shared genome instance (same pattern the
    // provider's updateTasteParameter uses: mutate + save).
    const evidenceId = "ev-stage4-1";
    const ev: TasteEvidence = {
      id: evidenceId,
      type: "manual_keep",
      paramKey: PARAM_KEY,
      context: { genre: ["jazz"] },
      sourceQuality: 0.9,
      timestamp: new Date().toISOString(),
      ref: "test://evidence-1",
      confirmed: true,
    };
    const genome = taste.getCurrentGenome()!;
    const param = genome.getParameter(PARAM_KEY)!;
    genome.setParameter(PARAM_KEY, { ...param, evidence: [...param.evidence, ev] });
    taste.save(genome);
    const versionCounterBefore = s.value.genomeVersion;

    // Precondition: the evidence is present and persisted.
    const seeded = taste.getCurrentGenome()!.getParameter(PARAM_KEY)!;
    expect(seeded.evidence.some((e) => e.id === evidenceId)).toBe(true);
    expect(seeded.evidence.length).toBeGreaterThan(0);

    act(() => {
      s.value.actions.deleteTasteEvidence(PARAM_KEY, evidenceId);
    });

    // The evidence is gone; sibling evidence is untouched.
    const after = taste.getCurrentGenome()!.getParameter(PARAM_KEY)!;
    expect(after.evidence.some((e) => e.id === evidenceId)).toBe(false);
    expect(after.evidence.length).toBe(seeded.evidence.length - 1);
    // The mutation bumped the re-render counter so consumers re-read.
    expect(s.value.genomeVersion).toBe(versionCounterBefore + 1);

    s.cleanup();
  });
});

// ── Stage 0: mixer proposal rollback chain ──────────────────────────────────
describe("project-store mixer rollback (Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // [critical] The Agent Panel rollback button calls rollbackDiff(token).
  // Mixer proposals are applied through applyDiff's isMixerDiff branch, which
  // previously registered no rollback snapshot, so the button silently no-oped.
  it("T01: 应用 mixer 提案 → rollbackDiff(token) → mixer 恢复到应用前状态", () => {
    const s = setup(makeNotes(), makeMixer());
    const gainBefore = s.value.mixer.tracks[0].gainDb;
    const fxSlotsBefore = s.value.mixer.tracks[0].fxChain.slots.length;
    const masterGainBefore = s.value.mixer.masterTrack.gainDb;

    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(isMixerDiff(proposal)).toBe(true);

    act(() => {
      s.value.actions.applyDiff(proposal);
    });

    // Proposal landed on the mixer (gainDb + FX chain + master).
    expect(s.value.mixer.tracks[0].gainDb).not.toBe(gainBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBeGreaterThan(fxSlotsBefore);
    expect(s.value.mixer.masterTrack.gainDb).not.toBe(masterGainBefore);
    // A pre-apply snapshot is registered under the proposal's rollback token.
    expect(s.value.mixerRollbackSnapshots[proposal.rollbackToken]).toBeDefined();

    act(() => {
      s.value.actions.rollbackDiff(proposal.rollbackToken);
    });

    // Mixer restored to its exact pre-proposal state (gainDb + FX chain一致).
    expect(s.value.mixer.tracks[0].gainDb).toBe(gainBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBe(fxSlotsBefore);
    expect(s.value.mixer.masterTrack.gainDb).toBe(masterGainBefore);
    // The rolled-back proposal leaves the applied history + mixer audit log.
    expect(
      s.value.appliedDiffs.some((d) => d.rollbackToken === proposal.rollbackToken)
    ).toBe(false);
    expect(
      s.value.mixerDiffLog.some((d) => d.rollbackToken === proposal.rollbackToken)
    ).toBe(false);

    s.cleanup();
  });

  // [critical] Mixer snapshots live in a separate namespace (their own record
  // keyed by the mixer diff's token) and must not shadow graph rollback tokens.
  it("T02: graph diff 回滚不受 mixer 快照影响", () => {
    const s = setup(makeNotes(), makeMixer());

    // Seed a mixer snapshot so the store holds both namespaces at once.
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    act(() => {
      s.value.actions.applyDiff(proposal);
    });
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(1);

    const graphDiff = s.value.pendingDiffs.find((d) => !isMixerDiff(d));
    expect(graphDiff).toBeDefined();
    const nodeIdsBefore = s.value.graph
      .getAllNodes()
      .map((n) => n.id)
      .sort();

    act(() => {
      s.value.actions.applyDiff(graphDiff!);
    });
    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).not.toEqual(nodeIdsBefore);

    act(() => {
      s.value.actions.rollbackDiff(graphDiff!.rollbackToken);
    });

    // Graph restored; the mixer snapshot is untouched by the graph rollback.
    expect(
      s.value.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort()
    ).toEqual(nodeIdsBefore);
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(1);
    expect(s.value.mixerRollbackSnapshots[proposal.rollbackToken]).toBeDefined();

    s.cleanup();
  });

  it("T03: mixer 回滚后 mixerRollbackSnapshots 清理且重复回滚不抛错", () => {
    const s = setup(makeNotes(), makeMixer());

    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    act(() => {
      s.value.actions.applyDiff(proposal);
    });
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(1);

    act(() => {
      s.value.actions.rollbackDiff(proposal.rollbackToken);
    });

    // Snapshot is consumed: no leak after a successful mixer rollback.
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(0);
    expect(s.value.mixerRollbackSnapshots[proposal.rollbackToken]).toBeUndefined();

    // Rolling back the same token again is a silent no-op (matches the graph
    // path for unknown tokens).
    const mixerRef = s.value.mixer;
    let threw = false;
    act(() => {
      try {
        s.value.actions.rollbackDiff(proposal.rollbackToken);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(s.value.mixer).toBe(mixerRef);

    s.cleanup();
  });

  // [critical] Stage 4 gap: a rollback restores the pre-proposal mixer, but a
  // NEW proposal minted afterwards must be based on the mixer state that
  // exists after the rollback (and any further edits), never the stale
  // pre-rollback state. This locks the "rollback -> mixer keeps moving ->
  // re-propose" loop end to end.
  it("T04: 回滚后 mixer 继续变化,新提案基于新状态(快照反映回滚后状态)", () => {
    const s = setup(makeNotes(), makeMixer());
    expect(s.value.mixer.tracks[0].gainDb).toBe("0");

    // 1. Apply a proposal, then roll it back -> mixer back to M0.
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const p1 = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    act(() => {
      s.value.actions.applyDiff(p1);
    });
    act(() => {
      s.value.actions.rollbackDiff(p1.rollbackToken);
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("0");
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(0);

    // 2. Mixer keeps changing after the rollback (M0 -> M1).
    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-1" });
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("-1");

    // 3. A brand-new proposal is minted against the post-rollback mixer.
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const p2 = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(p2.diffId).not.toBe(p1.diffId);
    act(() => {
      s.value.actions.applyDiff(p2);
    });

    // The new proposal's pre-apply snapshot is M1 (post-rollback mixer with
    // the -1 edit), not the stale M0 that predated the first proposal.
    const snapshot = s.value.mixerRollbackSnapshots[p2.rollbackToken];
    expect(snapshot).toBeDefined();
    expect(snapshot.tracks[0].gainDb).toBe("-1");
    // And applying it actually moved the mixer away from M1 (melody -> -3).
    expect(s.value.mixer.tracks[0].gainDb).toBe("-3");

    s.cleanup();
  });
});

// ── Stage 2: Agent decision -> Knowledge Graph evidence node ────────────────
describe("project-store decision evidence (Stage 2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Builds an agent diff that updates an existing NoteSpan node. */
  function makeAgentUpdateDiff(nodeId: string): DiffEnvelope {
    return createDiffEnvelope({
      baseRevision: "graph://stage2-base",
      actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
      permissionScope: "write_direct",
      summary: "Move chord to second inversion for smoother voice leading",
      ops: [{ op: "update_node", path: "/", nodeId, data: { inversion: 2 } }],
      domainExplanations: [
        { label: "voice_leading", text: "Second inversion minimizes the bass leap." },
      ],
      evidenceRefs: ["chord://analysis/abc123", "corpus://bass-lines/jazz"],
    });
  }

  it("T01: 应用 Agent diff 后 graph 含决策证据节点(type 正确)", () => {
    const s = setup();
    const target = s.value.graph
      .getAllNodes()
      .find((n) => n.type === "NoteSpan");
    expect(target).toBeDefined();
    const diff = makeAgentUpdateDiff(target!.id);

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    const evidence = s.value.graph.getNodesByType("AgentDecision");
    expect(evidence.length).toBe(1);
    expect(evidence[0].type).toBe("AgentDecision");

    s.cleanup();
  });

  it("T02: 证据节点 data 含 actor/summary/domainExplanations/evidenceRefs", () => {
    const s = setup();
    const target = s.value.graph
      .getAllNodes()
      .find((n) => n.type === "NoteSpan");
    expect(target).toBeDefined();
    const diff = makeAgentUpdateDiff(target!.id);

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    const evidence = s.value.graph.getNodesByType("AgentDecision");
    expect(evidence.length).toBe(1);
    const data = evidence[0].data as Record<string, unknown>;
    expect(data.diffId).toBe(diff.diffId);
    expect((data.actor as { type: string; name: string }).type).toBe("agent");
    expect((data.actor as { type: string; name: string }).name).toBe("HarmonyBot");
    expect(data.summary).toBe(diff.summary);
    expect(data.domainExplanations).toEqual(diff.domainExplanations);
    expect(data.evidenceRefs).toEqual(diff.evidenceRefs);
    expect(typeof data.appliedAt).toBe("string");
    expect((data.appliedAt as string).length).toBeGreaterThan(0);

    s.cleanup();
  });

  it("T03: 证据节点与影响目标有 suggested_by_agent 边(若有目标节点)", () => {
    const s = setup();
    const target = s.value.graph
      .getAllNodes()
      .find((n) => n.type === "NoteSpan");
    expect(target).toBeDefined();
    const diff = makeAgentUpdateDiff(target!.id);

    act(() => {
      s.value.actions.applyDiff(diff);
    });

    const evidence = s.value.graph.getNodesByType("AgentDecision");
    expect(evidence.length).toBe(1);
    const { outgoing } = s.value.graph.getEdgesForNode(evidence[0].id);
    expect(
      outgoing.some(
        (e) => e.type === "suggested_by_agent" && e.target_id === target!.id
      )
    ).toBe(true);
    // Edge carries the diffId so the decision trace is queryable.
    const edge = outgoing.find((e) => e.type === "suggested_by_agent");
    expect(edge?.data.diffId).toBe(diff.diffId);

    s.cleanup();
  });

  it("T04: 显式 recordDecisionEvidence 也可在 graph 记录证据节点", () => {
    const s = setup();
    const target = s.value.graph
      .getAllNodes()
      .find((n) => n.type === "NoteSpan");
    expect(target).toBeDefined();
    const diff = makeAgentUpdateDiff(target!.id);
    expect(s.value.graph.getNodesByType("AgentDecision").length).toBe(0);

    act(() => {
      s.value.actions.recordDecisionEvidence(diff);
    });

    expect(s.value.graph.getNodesByType("AgentDecision").length).toBe(1);

    s.cleanup();
  });

  // [critical] Stage 4 gap: mixer proposals (applied through the isMixerDiff
  // branch of APPLY_DIFF) must also leave a decision trace. Their track ids
  // ("t1"/"t2"/"master") never resolve to graph nodes, so the evidence node
  // exists node-only (no suggested_by_agent edge) — this locks that shape.
  it("T05: 应用 mixing 提案(mixer diff)后 graph 记录证据节点且无目标边", () => {
    const s = setup(makeNotes(), makeMixer());
    expect(s.value.graph.getNodesByType("AgentDecision").length).toBe(0);

    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(isMixerDiff(proposal)).toBe(true);

    act(() => {
      s.value.actions.applyDiff(proposal);
    });

    // Mixer proposals also leave a decision evidence node.
    const evidence = s.value.graph.getNodesByType("AgentDecision");
    expect(evidence.length).toBe(1);
    const data = evidence[0].data as Record<string, unknown>;
    expect(data.diffId).toBe(proposal.diffId);
    expect((data.actor as { type: string; name: string }).name).toBe("mixing");

    // Mixer track ids do not resolve to graph nodes -> node-only trace.
    const { outgoing } = s.value.graph.getEdgesForNode(evidence[0].id);
    expect(outgoing.filter((e) => e.type === "suggested_by_agent")).toHaveLength(0);

    s.cleanup();
  });
});

// ── Stage 0: Agent tool-call event model ────────────────────────────────────
describe("project-store tool calls (Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: recordToolCall 追加记录(含 toolName/status/时间戳)", () => {
    const s = setup();

    expect(s.value.toolCalls).toEqual([]);

    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1", genre: "jazz" },
        resultSummary: "建议 3 段 FX 链",
        status: "success",
        agentName: "mixing",
        correlationId: "corr-1",
      });
    });

    expect(s.value.toolCalls.length).toBe(1);
    const rec = s.value.toolCalls[0];
    expect(rec.toolName).toBe("mixing.suggestChain");
    expect(rec.params).toEqual({ trackId: "t1", genre: "jazz" });
    expect(rec.resultSummary).toBe("建议 3 段 FX 链");
    expect(rec.status).toBe("success");
    expect(rec.agentName).toBe("mixing");
    expect(rec.correlationId).toBe("corr-1");
    // id and timestamp are auto-minted by the store.
    expect(rec.id.length).toBeGreaterThan(0);
    expect(typeof rec.timestamp).toBe("string");
    expect(new Date(rec.timestamp).getTime()).not.toBeNaN();

    s.cleanup();
  });

  it("T02: clearToolCalls 清空记录", () => {
    const s = setup();

    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: {},
        resultSummary: "建议 3 段 FX 链",
        status: "running",
        agentName: "mixing",
      });
      s.value.actions.recordToolCall({
        toolName: "graph.query",
        params: { nodeType: "NoteSpan" },
        resultSummary: "找到 2 个节点",
        status: "success",
        agentName: "compose",
      });
    });
    expect(s.value.toolCalls.length).toBe(2);

    act(() => {
      s.value.actions.clearToolCalls();
    });

    expect(s.value.toolCalls).toEqual([]);

    s.cleanup();
  });

  it("T03: 超过上限(100)时丢弃最旧", () => {
    const s = setup();

    act(() => {
      for (let i = 0; i < 105; i++) {
        s.value.actions.recordToolCall({
          toolName: `tool.${i}`,
          params: { i },
          resultSummary: `调用 ${i}`,
          status: "success",
          agentName: "mixing",
        });
      }
    });

    // Cap holds at 100 records.
    expect(s.value.toolCalls.length).toBe(100);
    // The 5 oldest (tool.0..tool.4) were evicted; newest 100 survive.
    expect(s.value.toolCalls[0].toolName).toBe("tool.5");
    expect(s.value.toolCalls[1].toolName).toBe("tool.6");
    expect(s.value.toolCalls[99].toolName).toBe("tool.104");
    expect(s.value.toolCalls.some((r) => r.toolName === "tool.0")).toBe(false);

    s.cleanup();
  });

  it("T04: undo/redo 不触碰 toolCalls 审计记录(redo 后记录原样保留)", () => {
    const s = setup(makeNotes());

    // 1. Leave a couple of audit records before any undoable edit.
    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1" },
        resultSummary: "建议 3 段 FX 链",
        status: "success",
        agentName: "mixing",
      });
      s.value.actions.recordToolCall({
        toolName: "graph.query",
        params: { nodeType: "NoteSpan" },
        resultSummary: "找到 2 个节点",
        status: "success",
        agentName: "compose",
      });
    });
    expect(s.value.toolCalls.length).toBe(2);

    // 2. An undoable edit (note move) pushes a composite snapshot onto the
    //    undo stack. The snapshot deliberately excludes toolCalls.
    const target = s.value.notes[0];
    act(() => {
      s.value.actions.moveNote(target.id, 6, 2, 67);
    });
    expect(s.value.undoStack.length).toBe(1);
    expect(s.value.undoStack[0]).not.toHaveProperty("toolCalls");

    // 3. undo() restores graph/mixer state only; the audit trace is carried
    //    over untouched.
    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.toolCalls.length).toBe(2);
    expect(s.value.toolCalls.map((r) => r.toolName)).toEqual([
      "mixing.suggestChain",
      "graph.query",
    ]);

    // 4. redo() re-applies the edit; the audit trace must still be intact.
    act(() => {
      s.value.actions.redo();
    });
    expect(s.value.notes.find((n) => n.id === target.id)?.bar).toBe(6);
    expect(s.value.toolCalls.length).toBe(2);
    expect(s.value.toolCalls.map((r) => r.toolName)).toEqual([
      "mixing.suggestChain",
      "graph.query",
    ]);

    s.cleanup();
  });
});

// ── v1.13 Stage 2: tool-call upsert by correlationId ────────────────────────
describe("project-store tool call upsert (v1.13 Stage 2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: 同 correlationId 的 running→success 合并为一条(长度不变,status/resultSummary 更新) (critical)", () => {
    const s = setup();

    const correlationId = "stage2-upsert-corr";
    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1" },
        resultSummary: "执行中",
        status: "running",
        agentName: "mixing",
        correlationId,
      });
    });
    expect(s.value.toolCalls.length).toBe(1);
    expect(s.value.toolCalls[0].status).toBe("running");
    const runningId = s.value.toolCalls[0].id;

    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1", genre: "jazz" },
        resultSummary: "建议 3 段 FX 链",
        status: "success",
        agentName: "mixing",
        correlationId,
      });
    });

    // The success record merged into the running entry: still one card.
    expect(s.value.toolCalls.length).toBe(1);
    const rec = s.value.toolCalls[0];
    expect(rec.status).toBe("success");
    expect(rec.resultSummary).toBe("建议 3 段 FX 链");
    expect(rec.params).toEqual({ trackId: "t1", genre: "jazz" });
    // Identity fields are preserved from the original running record.
    expect(rec.id).toBe(runningId);
    expect(rec.toolName).toBe("mixing.suggestChain");
    expect(rec.agentName).toBe("mixing");
    expect(rec.correlationId).toBe(correlationId);
    expect(typeof rec.timestamp).toBe("string");

    s.cleanup();
  });

  it("T02: 无 correlationId 仍追加(append-only 兼容) (critical)", () => {
    const s = setup();

    act(() => {
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1" },
        resultSummary: "执行中",
        status: "running",
        agentName: "mixing",
      });
      s.value.actions.recordToolCall({
        toolName: "mixing.suggestChain",
        params: { trackId: "t1" },
        resultSummary: "建议 3 段 FX 链",
        status: "success",
        agentName: "mixing",
      });
    });

    // No correlationId -> both entries coexist (the old append-only contract).
    expect(s.value.toolCalls.length).toBe(2);
    expect(s.value.toolCalls[0].status).toBe("running");
    expect(s.value.toolCalls[1].status).toBe("success");
    expect(s.value.toolCalls[0].correlationId).toBeUndefined();

    s.cleanup();
  });

  it("T03: 合并后上限仍生效(100 条 FIFO)", () => {
    const s = setup();

    // Fill the trace to the cap with append-only records.
    act(() => {
      for (let i = 0; i < 100; i++) {
        s.value.actions.recordToolCall({
          toolName: `tool.${i}`,
          params: { i },
          resultSummary: `调用 ${i}`,
          status: "success",
          agentName: "mixing",
        });
      }
    });
    expect(s.value.toolCalls.length).toBe(100);

    // A fresh correlationId appends -> the oldest entry is evicted (FIFO).
    act(() => {
      s.value.actions.recordToolCall({
        toolName: "tool.100",
        params: { i: 100 },
        resultSummary: "调用 100",
        status: "success",
        agentName: "mixing",
        correlationId: "corr-new",
      });
    });
    expect(s.value.toolCalls.length).toBe(100);
    expect(s.value.toolCalls[0].toolName).toBe("tool.1");
    expect(s.value.toolCalls[99].toolName).toBe("tool.100");

    // An upsert of an existing correlationId never grows the array.
    act(() => {
      s.value.actions.recordToolCall({
        toolName: "tool.100",
        params: { i: 100 },
        resultSummary: "更新后",
        status: "success",
        agentName: "mixing",
        correlationId: "corr-new",
      });
    });
    expect(s.value.toolCalls.length).toBe(100);
    expect(s.value.toolCalls[99].resultSummary).toBe("更新后");
    expect(s.value.toolCalls[0].toolName).toBe("tool.1");

    s.cleanup();
  });
});

// ── Stage 2: composite undo/redo stack (graph + mixer + taste counter) ──────
describe("project-store undo/redo (Stage 2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: 编辑音符 → undo 状态恢复 → redo 状态恢复(往返)", () => {
    const s = setup(makeNotes());
    const target = s.value.notes[0];
    const originalBar = target.bar;
    const originalPitch = target.pitchMidi;
    expect(originalBar).not.toBe(6);

    // Edit: move the note.
    act(() => {
      s.value.actions.moveNote(target.id, 6, 2, 67);
    });
    const moved = s.value.notes.find((n) => n.id === target.id)!;
    expect(moved.bar).toBe(6);
    expect(moved.pitchMidi).toBe(67);
    expect(s.value.undoStack.length).toBe(1);
    expect(s.value.redoStack.length).toBe(0);

    // Undo: restore the pre-edit state (graph + derived notes).
    act(() => {
      s.value.actions.undo();
    });
    const restored = s.value.notes.find((n) => n.id === target.id)!;
    expect(restored.bar).toBe(originalBar);
    expect(restored.pitchMidi).toBe(originalPitch);
    expect(s.value.undoStack.length).toBe(0);
    expect(s.value.redoStack.length).toBe(1);

    // Redo: re-apply the edit.
    act(() => {
      s.value.actions.redo();
    });
    const redone = s.value.notes.find((n) => n.id === target.id)!;
    expect(redone.bar).toBe(6);
    expect(redone.pitchMidi).toBe(67);
    expect(s.value.undoStack.length).toBe(1);
    expect(s.value.redoStack.length).toBe(0);

    s.cleanup();
  });

  it("T02: 应用 Agent graph diff → undo 等效回滚(graph 与 applied 历史恢复)", () => {
    const s = setup(makeNotes(), makeMixer());
    const diff = s.value.pendingDiffs.find((d) => !isMixerDiff(d))!;
    expect(diff).toBeDefined();
    const nodesBefore = s.value.graph.getAllNodes().length;
    const appliedBefore = s.value.appliedDiffs.length;

    act(() => {
      s.value.actions.applyDiff(diff);
    });
    expect(s.value.graph.getAllNodes().length).toBeGreaterThan(nodesBefore);
    expect(s.value.appliedDiffs.length).toBe(appliedBefore + 1);

    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.graph.getAllNodes().length).toBe(nodesBefore);
    expect(s.value.appliedDiffs.length).toBe(appliedBefore);
    expect(s.value.rollbackTokens).not.toContain(diff.rollbackToken);
    // The undone applied diff can be re-applied via redo.
    act(() => {
      s.value.actions.redo();
    });
    expect(s.value.graph.getAllNodes().length).toBeGreaterThan(nodesBefore);
    expect(s.value.appliedDiffs.length).toBe(appliedBefore + 1);

    s.cleanup();
  });

  it("T02: 应用 mixer 提案 → undo 等效回滚(mixer 恢复,mixerDiffLog 清空)", () => {
    const s = setup(makeNotes(), makeMixer());
    act(() => {
      s.value.actions.suggestMixingChain();
    });
    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(isMixerDiff(proposal)).toBe(true);
    const gainBefore = s.value.mixer.tracks[0].gainDb;
    const masterGainBefore = s.value.mixer.masterTrack.gainDb;
    const fxSlotsBefore = s.value.mixer.tracks[0].fxChain.slots.length;

    act(() => {
      s.value.actions.applyDiff(proposal);
    });
    expect(s.value.mixer.tracks[0].gainDb).not.toBe(gainBefore);
    expect(s.value.mixer.masterTrack.gainDb).not.toBe(masterGainBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBeGreaterThan(fxSlotsBefore);
    expect(s.value.appliedDiffs.length).toBe(1);

    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe(gainBefore);
    expect(s.value.mixer.masterTrack.gainDb).toBe(masterGainBefore);
    expect(s.value.mixer.tracks[0].fxChain.slots.length).toBe(fxSlotsBefore);
    expect(s.value.appliedDiffs.length).toBe(0);
    expect(s.value.mixerDiffLog.length).toBe(0);
    expect(Object.keys(s.value.mixerRollbackSnapshots).length).toBe(0);

    s.cleanup();
  });

  it("T03: undo 栈上限(MAX_UNDO)防膨胀", () => {
    const s = setup();
    expect(s.value.undoStack.length).toBe(0);

    act(() => {
      for (let i = 0; i < MAX_UNDO + 10; i++) {
        s.value.actions.addNote(
          createNoteEvent({
            trackId: "melody",
            bar: 1,
            beat: 1,
            durQn: 1,
            pitchMidi: 60 + i,
          })
        );
      }
    });

    // The cap holds at MAX_UNDO; the oldest 10 steps were evicted.
    expect(s.value.undoStack.length).toBe(MAX_UNDO);
    expect(s.value.redoStack.length).toBe(0);
    // The graph itself keeps every note (edits are never lost by eviction).
    expect(s.value.notes.length).toBeGreaterThan(MAX_UNDO);

    s.cleanup();
  });

  it("T04: undo/redo 空栈时不崩溃(no-op)", () => {
    const s = setup();
    const graphRef = s.value.graph;
    let threw = false;

    act(() => {
      try {
        s.value.actions.undo();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(s.value.graph).toBe(graphRef);
    expect(s.value.undoStack.length).toBe(0);

    act(() => {
      try {
        s.value.actions.redo();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(s.value.graph).toBe(graphRef);
    expect(s.value.redoStack.length).toBe(0);

    s.cleanup();
  });

  it("T05: 直接修改 mixer 轨道 → undo/redo 往返", () => {
    const s = setup(makeNotes(), makeMixer());

    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-6.5" });
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("-6.5");
    expect(s.value.mixerDiffLog.length).toBe(1);

    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("0");
    expect(s.value.mixerDiffLog.length).toBe(0);

    act(() => {
      s.value.actions.redo();
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("-6.5");
    expect(s.value.mixerDiffLog.length).toBe(1);

    s.cleanup();
  });

  it("T06: 新编辑使 redo 栈失效", () => {
    const s = setup(makeNotes());
    const target = s.value.notes[0];

    act(() => {
      s.value.actions.moveNote(target.id, 6, 2, 67);
    });
    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.redoStack.length).toBe(1);

    // A fresh edit after undo invalidates the redo history.
    act(() => {
      s.value.actions.moveNote(target.id, 7, 1, 60);
    });
    expect(s.value.redoStack.length).toBe(0);

    s.cleanup();
  });

  it("T07: UPDATE_MIXER_TRACK 高频编辑合并为单个 undo 步骤(节流)", () => {
    const s = setup(makeNotes(), makeMixer());

    // Three rapid slider events within the 500ms guard window.
    act(() => {
      s.value.actions.updateMixerTrack("t1", { gainDb: "-1" });
      s.value.actions.updateMixerTrack("t1", { gainDb: "-2" });
      s.value.actions.updateMixerTrack("t1", { gainDb: "-3" });
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("-3");
    // The whole drag coalesced into exactly one undo step.
    expect(s.value.undoStack.length).toBe(1);

    // One undo restores the pre-drag mixer, not an intermediate value.
    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.mixer.tracks[0].gainDb).toBe("0");
    expect(s.value.mixerDiffLog.length).toBe(0);

    s.cleanup();
  });

  it("T08: taste 编辑记录到 undo 快照且 undo 恢复 genome 值(Stage 2)", () => {
    const s = setup();
    const PARAM_KEY = "harmony.chromatic_color";
    const before = s.value.tasteStore
      .getCurrentGenome()!
      .getParameter(PARAM_KEY)!.value;
    const genomeVersionBefore = s.value.genomeVersion;

    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.85");
    });
    expect(s.value.genomeVersion).toBe(genomeVersionBefore + 1);
    expect(
      s.value.tasteStore
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!.value
    ).toBe("0.85");

    // Undo restores the recorded genomeVersion counter AND the genome values
    // recorded in the snapshot (Stage 2: Ctrl+Z covers taste edits).
    act(() => {
      s.value.actions.undo();
    });
    expect(s.value.genomeVersion).toBe(genomeVersionBefore);
    expect(
      s.value.tasteStore
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!.value
    ).toBe(before);
    expect(
      s.value.tasteStore
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!.value
    ).not.toBe("0.85");

    s.cleanup();
  });
});

// ── Stage 1: ToolRegistry -> store wiring ──────────────────────────────────
describe("project-store tool registry wiring (Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: suggestMixingChain 经 ToolRegistry 调用后时间线出现合并后的 mixing.suggestChain 记录(success)", async () => {
    const s = setup(makeNotes(), makeMixer());

    expect(s.value.toolCalls).toEqual([]);

    act(() => {
      s.value.actions.suggestMixingChain();
    });

    // Flush microtasks so the async ToolRegistry.call success record lands.
    await act(async () => {});

    // v1.13 Stage 2: the registry emits running + success with the same
    // correlationId, so the store upserts them into ONE record instead of
    // two independent timeline cards.
    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "mixing.suggestChain"
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("mixing");
    expect(calls[0].params).toHaveProperty("trackId");
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  it("T02: suggestMixingChain 仍生成 mixer 提案(现有行为不被 registry 调用破坏)", async () => {
    const s = setup(makeNotes(), makeMixer());

    act(() => {
      s.value.actions.suggestMixingChain();
    });
    await act(async () => {});

    const proposal = s.value.pendingDiffs[s.value.pendingDiffs.length - 1];
    expect(isMixerDiff(proposal)).toBe(true);
    expect(s.value.toolCalls.filter((r) => r.toolName === "mixing.suggestChain").length).toBe(1);

    s.cleanup();
  });
});

// ── Stage 2: taste genome restore on undo/redo (Ctrl+Z covers taste edits) ──
describe("project-store taste genome undo/redo (Stage 2)", () => {
  beforeEach(() => {
    // The TasteStore built on the browser adapter persists into localStorage;
    // clear it so every case starts from a fresh default genome.
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  const PARAM_KEY = "harmony.chromatic_color";
  /** Default value seeded by TasteGenome.createDefault(). */
  const DEFAULT_VALUE = "0.33";

  function currentValue(s: { value: ProjectStoreValue }): string {
    return s.value.tasteStore.getCurrentGenome()!.getParameter(PARAM_KEY)!.value;
  }

  // [critical] T01: one taste edit -> undo -> genome value restored to the
  // pre-edit value.
  it("T01: 修改品味参数 → undo → genome 参数值恢复(修改前值)", () => {
    const s = setup();
    expect(currentValue(s)).toBe(DEFAULT_VALUE);

    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.85");
    });
    expect(currentValue(s)).toBe("0.85");
    expect(s.value.genomeVersion).toBe(1);

    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe(DEFAULT_VALUE);
    expect(currentValue(s)).not.toBe("0.85");
    expect(s.value.genomeVersion).toBe(0);

    s.cleanup();
  });

  // [critical] T02: multiple edits -> multiple undos walk back through every
  // intermediate value.
  it("T02: 多次修改 → 多步 undo 正确往返(每次恢复上一状态)", () => {
    const s = setup();
    const v0 = currentValue(s);
    expect(v0).toBe(DEFAULT_VALUE);

    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.5");
    });
    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.7");
    });
    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.9");
    });
    expect(currentValue(s)).toBe("0.9");
    expect(s.value.undoStack.length).toBe(3);

    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe("0.7");
    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe("0.5");
    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe(v0);

    s.cleanup();
  });

  it("T03: redo 后 genome 恢复(与 undo 对称)", () => {
    const s = setup();
    const v0 = currentValue(s);
    expect(v0).toBe(DEFAULT_VALUE);

    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.85");
    });
    expect(currentValue(s)).toBe("0.85");

    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe(v0);

    act(() => {
      s.value.actions.redo();
    });
    expect(currentValue(s)).toBe("0.85");
    expect(s.value.genomeVersion).toBe(1);

    // Symmetric round-trip: undo again, redo again.
    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe(v0);
    act(() => {
      s.value.actions.redo();
    });
    expect(currentValue(s)).toBe("0.85");

    s.cleanup();
  });

  // [critical] Stage 4 gap: revertTasteTo dispatches TASTE_GENOME_CHANGED with
  // a beforeGenome (the pre-revert live genome), so undo() must restore the
  // genome the user edited before the revert — not the reverted-away value.
  // This locks the Ctrl+Z path for "revert to version" end to end.
  it("T04: revertTasteTo 后 undo 恢复回退前的 genome 值(与 redo 对称)", () => {
    const s = setup();
    expect(currentValue(s)).toBe(DEFAULT_VALUE);

    // 1. Edit -> undo step 1 records the default genome as beforeGenome.
    act(() => {
      s.value.actions.updateTasteParameter(PARAM_KEY, "0.85");
    });
    expect(currentValue(s)).toBe("0.85");
    expect(s.value.genomeVersion).toBe(1);

    // 2. Revert to version 1 (the default genome) -> undo step 2 records the
    //    0.85 genome as beforeGenome.
    act(() => {
      s.value.actions.revertTasteTo(1);
    });
    expect(currentValue(s)).toBe(DEFAULT_VALUE);
    expect(currentValue(s)).not.toBe("0.85");
    expect(s.value.genomeVersion).toBe(2);

    // 3. undo() pops step 2 -> the 0.85 genome (pre-revert) is restored.
    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe("0.85");
    expect(s.value.genomeVersion).toBe(1);

    // 4. undo() pops step 1 -> the default genome is restored.
    act(() => {
      s.value.actions.undo();
    });
    expect(currentValue(s)).toBe(DEFAULT_VALUE);
    expect(s.value.genomeVersion).toBe(0);

    // 5. redo() walks forward: the edit, then the revert, both re-applied.
    act(() => {
      s.value.actions.redo();
    });
    expect(currentValue(s)).toBe("0.85");
    expect(s.value.genomeVersion).toBe(1);
    act(() => {
      s.value.actions.redo();
    });
    expect(currentValue(s)).toBe(DEFAULT_VALUE);
    expect(s.value.genomeVersion).toBe(2);

    s.cleanup();
  });

  // [critical] Stage 4 gap: deleteTasteEvidence dispatches TASTE_GENOME_CHANGED
  // with a beforeGenome that still carries the removed evidence, so undo()
  // must restore the deleted evidence onto the genome. This locks the Ctrl+Z
  // path for evidence cleanup (GDPR flow) end to end.
  it("T05: deleteTasteEvidence 后 undo 恢复被删 evidence(redo 再次删除)", () => {
    const s = setup();
    const taste = s.value.tasteStore;
    const evidenceId = "ev-undo-stage4";
    expect(s.value.genomeVersion).toBe(0);

    // 1. Seed evidence directly on the shared genome + save (same mutate-then-
    //    save pattern the provider's action creators use). No dispatch, so the
    //    genomeVersion counter stays at 0.
    const ev: TasteEvidence = {
      id: evidenceId,
      type: "manual_keep",
      paramKey: PARAM_KEY,
      context: { genre: ["jazz"] },
      sourceQuality: 0.9,
      timestamp: new Date().toISOString(),
      ref: "test://evidence-undo-stage4",
      confirmed: true,
    };
    const seeded = taste.getCurrentGenome()!;
    const seededParam = seeded.getParameter(PARAM_KEY)!;
    seeded.setParameter(PARAM_KEY, { ...seededParam, evidence: [...seededParam.evidence, ev] });
    taste.save(seeded);
    expect(
      taste
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!
        .evidence.some((e) => e.id === evidenceId)
    ).toBe(true);

    // 2. deleteTasteEvidence -> undo step records the with-evidence genome.
    act(() => {
      s.value.actions.deleteTasteEvidence(PARAM_KEY, evidenceId);
    });
    expect(
      taste
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!
        .evidence.some((e) => e.id === evidenceId)
    ).toBe(false);
    expect(s.value.genomeVersion).toBe(1);

    // 3. undo() restores the deleted evidence (genome values restored).
    act(() => {
      s.value.actions.undo();
    });
    const restored = taste.getCurrentGenome()!.getParameter(PARAM_KEY)!;
    expect(restored.evidence.some((e) => e.id === evidenceId)).toBe(true);
    expect(s.value.genomeVersion).toBe(0);

    // 4. redo() deletes it again (symmetric).
    act(() => {
      s.value.actions.redo();
    });
    expect(
      taste
        .getCurrentGenome()!
        .getParameter(PARAM_KEY)!
        .evidence.some((e) => e.id === evidenceId)
    ).toBe(false);
    expect(s.value.genomeVersion).toBe(1);

    s.cleanup();
  });
});

// ── Stage 0: Orchestrator panel -> real Orchestrator tool ───────────────────
describe("project-store orchestrator (Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // [critical] The panel previously rendered a hardcoded sampleConflicts array
  // in App.tsx. This locks the closed loop: runOrchestrator must return real
  // conflicts produced by the agent's RegisterConflictDetector (which is the
  // same detection a fresh Orchestrator instance performs), never the sample.
  // v1.22.0 Stage 1: the tool is harmony-driven — the run forwards the
  // HarmonyEntry[] (App derives them from the chords track) and the returned
  // conflicts must equal a fresh Orchestrator.orchestrate() on the same input.
  it("T01: runOrchestrator 调用真实 Orchestrator(conflicts 非 sampleConflicts)", async () => {
    const s = setup(makeNotes(), makeMixer());
    const config = {
      players: ["violin", "viola", "cello"],
      style: "classical" as const,
      playabilityPolicy: "moderate" as const,
    };
    const harmony: HarmonyEntry[] = [
      { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      { bar: 2, beat: 1, chord: { root: "G", quality: "dom7" }, durationQn: 4 },
    ];
    let result: OrchestratorRunResult | undefined;

    await act(async () => {
      result = await s.value.actions.runOrchestrator(config, harmony);
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe("ok");
    expect(Array.isArray(result!.conflicts)).toBe(true);

    // The hardcoded sample conflicts from the old handleOrchestrate must not
    // appear in a real run (real detection emits its own descriptions).
    const sampleDescriptions = [
      "Violin: note 50 below lowest register 55",
      "Violin and Viola register overlap (28 semitones)",
    ];
    for (const c of result!.conflicts) {
      expect(sampleDescriptions).not.toContain(c.description);
      expect(c.type).toMatch(/^(overlap|spacing|range_violation|crossing)$/);
      expect(c.severity === "warning" || c.severity === "error").toBe(true);
      expect(typeof c.suggestion).toBe("string");
      expect(typeof c.bar).toBe("number");
      expect(typeof c.beat).toBe("number");
    }

    // Strongest proof of a real call: the returned conflicts are exactly the
    // deterministic output of a fresh Orchestrator instance for the same
    // harmony input (orchestrate() replaced the removed voicingPlan()).
    const orchestrator = new Orchestrator();
    const direct = orchestrator.orchestrate(harmony, {
      players: config.players,
      style: config.style,
      playabilityPolicy: config.playabilityPolicy,
    });
    expect(result!.conflicts).toEqual(direct.conflicts);

    // v1.22.0 Stage 1: perPlayerNotes arrives as [pid, count] pairs from the
    // real run (drives the panel's voice preview).
    expect(Array.isArray(result!.perPlayerNotes)).toBe(true);

    s.cleanup();
  });

  // [critical] The panel's "编排" click must leave a visible trace in the
  // Agent tool timeline: the registry emits running while the handler runs,
  // then success; the store upserts them into one record (v1.13 Stage 2).
  it("T02: 时间线出现 orchestrator.voicingPlan 工具调用(合并为一条 success 记录)", async () => {
    const s = setup(makeNotes(), makeMixer());
    expect(s.value.toolCalls).toEqual([]);

    const harmony: HarmonyEntry[] = [
      { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      { bar: 2, beat: 1, chord: { root: "G", quality: "dom7" }, durationQn: 4 },
    ];
    await act(async () => {
      await s.value.actions.runOrchestrator(
        {
          players: ["violin", "cello"],
          playabilityPolicy: "moderate",
        },
        harmony,
      );
    });

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "orchestrator.voicingPlan",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("orchestrate-panel");
    expect(calls[0].params).toHaveProperty("players");
    expect(calls[0].params.players).toEqual(["violin", "cello"]);
    expect(calls[0].params).toHaveProperty("phraseRef");
    // v1.22.0 Stage 1: the harmony entries ride along as a required param.
    expect(calls[0].params).toHaveProperty("harmony");
    expect(calls[0].params.harmony).toEqual(harmony);
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  // Real Orchestrator proposals (DiffEnvelope[] from result.diffs) must land
  // in pendingDiffs so the Agent Panel can review/apply them.
  it("T03: 真实提案 diffs 入 pendingDiffs(agent panel 可审批)", async () => {
    const s = setup(makeNotes(), makeMixer());
    const pendingBefore = s.value.pendingDiffs.length;
    const harmony: HarmonyEntry[] = [
      { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      { bar: 2, beat: 1, chord: { root: "G", quality: "dom7" }, durationQn: 4 },
    ];

    await act(async () => {
      await s.value.actions.runOrchestrator(
        {
          players: ["violin", "cello"],
          playabilityPolicy: "moderate",
        },
        harmony,
      );
    });

    const added = s.value.pendingDiffs.slice(pendingBefore);
    expect(added.length).toBeGreaterThan(0);
    // Every added proposal was authored by the real Orchestrator agent and is
    // reviewable under the proposal-only permission scope.
    expect(added.every((d) => d.actor.name === "orchestrator")).toBe(true);
    expect(added.every((d) => d.permissionScope === "proposal_only")).toBe(true);
    expect(
      added.some((d) => d.ops.some((o) => o.op === "add_note_group")),
    ).toBe(true);
    expect(added.every((d) => d.summary.length > 0)).toBe(true);

    s.cleanup();
  });
});

// ── Stage 1: Arranger panel -> real Arranger tool ─────────────────────────
describe("project-store arranger (Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: runArranger 调用真实 Arranger(variants 非 stub 消息)", async () => {
    const s = setup(makeNotes());
    let result: ArrangerRunResult | undefined;

    await act(async () => {
      result = await s.value.actions.runArranger({
        source: makeNotes(),
        bars: 4,
        style: "pop",
        formTemplate: "pop_ababcb",
        variantCount: 3,
      });
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe("ok");
    // Real Arranger output, not the stub's fixed { message } payload.
    expect(result!.variants.length).toBeGreaterThan(0);
    for (const v of result!.variants) {
      expect(v.id).toBeTruthy();
      expect(Array.isArray(v.notes)).toBe(true);
      expect(Array.isArray(v.operations)).toBe(true);
      expect(typeof v.variationScore).toBe("number");
      expect(typeof v.description).toBe("string");
    }
    expect(result!.selectedVariant).not.toBeNull();
    expect(result!.formStructure).toBeDefined();
    expect(Array.isArray(result!.energyCurvePoints)).toBe(true);
    expect(typeof result!.confidence).toBe("number");
    // Proposal diffs are authored by the real Arranger agent.
    expect(result!.diffs.length).toBeGreaterThan(0);
    expect(result!.diffs.every((d) => d.actor.name === "arranger")).toBe(true);
    expect(result!.diffs.every((d) => d.permissionScope === "proposal_only")).toBe(true);

    s.cleanup();
  });

  // [critical] The panel's "生成编排" click must leave a visible trace in the
  // Agent tool timeline: the registry emits running while the handler runs,
  // then success; the store upserts them into one record (v1.13 Stage 2).
  it("T02: 时间线出现 arranger.expandSection 工具调用(合并为一条 success 记录) (critical)", async () => {
    const s = setup(makeNotes());
    expect(s.value.toolCalls).toEqual([]);
    const source = makeNotes();

    await act(async () => {
      await s.value.actions.runArranger({
        source,
        bars: 4,
        formTemplate: "pop_ababcb",
      });
    });

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "arranger.expandSection",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("arrange-panel");
    expect(calls[0].params).toHaveProperty("source");
    expect(calls[0].params.source).toEqual(source);
    expect(calls[0].params).toHaveProperty("formTemplate");
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  // Real Arranger proposals (DiffEnvelope[] from result.diffs) must land in
  // pendingDiffs so the Agent Panel can review/apply them.
  it("T03: 真实提案 diffs 入 pendingDiffs(agent panel 可审批)", async () => {
    const s = setup(makeNotes());
    const pendingBefore = s.value.pendingDiffs.length;

    await act(async () => {
      await s.value.actions.runArranger({
        source: makeNotes(),
        bars: 4,
        variantCount: 2,
      });
    });

    const added = s.value.pendingDiffs.slice(pendingBefore);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((d) => d.actor.name === "arranger")).toBe(true);
    expect(added.every((d) => d.permissionScope === "proposal_only")).toBe(true);
    expect(
      added.some((d) => d.ops.some((o) => o.op === "add_note_group")),
    ).toBe(true);
    expect(added.every((d) => d.summary.length > 0)).toBe(true);

    s.cleanup();
  });
});

// ── v1.14 Stage 0: Score panel -> real Engraving tool bridge ───────────────
describe("project-store engraving (v1.14 Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // T02 (unit, critical): runEngraving routes through the real
  // engraving.reportCollisions tool and converts the agent collisions into the
  // UI ScorePanel shape (not the raw agent shape).
  it("T02: runEngraving 调用真实 reportCollisions 并转换为 UI 形状 (critical)", async () => {
    const s = setup(makeNotes());
    let result: EngravingRunResult | undefined;

    await act(async () => {
      result = await s.value.actions.runEngraving("main");
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe("ok");
    // Real EngravingEngine output on the demo layout: collisions exist.
    expect(result!.collisions.length).toBeGreaterThan(0);
    // Every collision is fully converted to the UI shape.
    for (const c of result!.collisions) {
      expect([
        "symbol_overlap",
        "slur_cross",
        "dynamic_clash",
        "articulation_conflict",
      ]).toContain(c.type);
      expect(c.staveIndex).toBe(0); // agent 无谱表索引 -> 默认 0
      expect(typeof c.bar).toBe("number");
      expect(typeof c.beat).toBe("number");
      expect(typeof c.description).toBe("string");
      expect(["warning", "error"]).toContain(c.severity);
      expect(typeof c.fixSuggestion).toBe("string");
      expect(c.fixSuggestion.length).toBeGreaterThan(0);
    }
    // Suggestions are passed through unchanged.
    expect(Array.isArray(result!.suggestions)).toBe(true);
    expect(result!.suggestions.length).toBeGreaterThan(0);
    expect(typeof result!.confidence).toBe("number");
    // raw payload preserved for debugging/audit.
    expect(result!.raw).toBeDefined();

    s.cleanup();
  });

  // T02 (critical) part 2: the score-panel invocation leaves a visible trace in
  // the Agent tool timeline (running + success upserted into one record).
  it("T02b: 时间线出现 engraving.reportCollisions 工具调用(合并为一条 success)", async () => {
    const s = setup(makeNotes());
    expect(s.value.toolCalls).toEqual([]);

    await act(async () => {
      await s.value.actions.runEngraving("main");
    });

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "engraving.reportCollisions",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("score-panel");
    expect(calls[0].params).toEqual({ layoutId: "main" });
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  // T04 (unit, non-critical): a failing tool must surface as status:"error"
  // without crashing the store action or the UI.
  it("T04: reportCollisions 工具失败时 runEngraving 返回 status:error 不抛异常", async () => {
    const s = setup(makeNotes());
    const spy = vi.spyOn(EngravingAgent.prototype, "reportCollisions");
    spy.mockImplementation(() => {
      throw new Error("engraving engine down");
    });

    let result: EngravingRunResult | undefined;
    let threw = false;
    try {
      await act(async () => {
        try {
          result = await s.value.actions.runEngraving("main");
        } catch {
          threw = true;
        }
      });
    } finally {
      spy.mockRestore();
    }

    expect(threw).toBe(false);
    expect(result!.status).toBe("error");
    expect(result!.collisions).toEqual([]);
    expect(result!.suggestions).toEqual([]);
    // The failure is recorded in the tool timeline as an error entry.
    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "engraving.reportCollisions",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("error");

    s.cleanup();
  });
});

// ── v1.15 Stage 0: Score panel -> real part-extraction tool bridge ─────────
describe("project-store extract parts (v1.15 Stage 0)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // T02 (unit, critical): runExtractParts routes through the real
  // engraving.extractParts tool and parses the extracted part list from the
  // tool payload (not a stub).
  it("T02: runExtractParts 调用真实 extractParts 并解析声部列表 (critical)", async () => {
    const s = setup(makeNotes());
    let result: ExtractPartsRunResult | undefined;

    await act(async () => {
      result = await s.value.actions.runExtractParts("main");
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe("ok");
    // Real EngravingAgent demo layout yields violin/viola/cello groups.
    expect(result!.parts.length).toBe(3);
    expect(result!.parts.map((p) => p.instrumentId)).toEqual([
      "violin",
      "viola",
      "cello",
    ]);
    for (const p of result!.parts) {
      expect(typeof p.instrumentId).toBe("string");
      expect(typeof p.instrumentName).toBe("string");
      expect(p.instrumentName.length).toBeGreaterThan(0);
      expect(typeof p.barCount).toBe("number");
      expect(p.barCount).toBeGreaterThan(0);
    }
    expect(typeof result!.confidence).toBe("number");
    // raw payload preserved for debugging/audit.
    expect(result!.raw).toBeDefined();

    s.cleanup();
  });

  // T02 (critical) part 2: the score-panel invocation leaves a visible trace
  // in the Agent tool timeline (running + success upserted into one record).
  it("T02b: 时间线出现 engraving.extractParts 工具调用(合并为一条 success)", async () => {
    const s = setup(makeNotes());
    expect(s.value.toolCalls).toEqual([]);

    await act(async () => {
      await s.value.actions.runExtractParts("main");
    });

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "engraving.extractParts",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("score-panel");
    expect(calls[0].params).toEqual({ layoutId: "main" });
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  // The PartLayout proposal diffs must land in pendingDiffs so the Agent Panel
  // can review/apply them (same convention as orchestrator/arranger).
  it("T02c: extractParts 提案 diffs 入 pendingDiffs(agent panel 可审批)", async () => {
    const s = setup(makeNotes());
    const pendingBefore = s.value.pendingDiffs.length;

    await act(async () => {
      await s.value.actions.runExtractParts("main");
    });

    const added = s.value.pendingDiffs.slice(pendingBefore);
    expect(added.length).toBe(3);
    expect(added.every((d) => d.actor.name === "engraving")).toBe(true);
    expect(added.every((d) => d.permissionScope === "proposal_only")).toBe(true);
    expect(
      added.every((d) =>
        d.ops.some((o) => o.op === "add_node" && o.nodeType === "PartLayout"),
      ),
    ).toBe(true);

    s.cleanup();
  });

  // T02 (unit, non-critical): a failing tool must surface as status:"error"
  // with an empty parts list and never throw.
  it("T02d: extractParts 工具失败时 runExtractParts 返回 status:error 不抛异常", async () => {
    const s = setup(makeNotes());
    const spy = vi.spyOn(EngravingAgent.prototype, "extractParts");
    spy.mockImplementation(() => {
      throw new Error("engraving engine down");
    });

    let result: ExtractPartsRunResult | undefined;
    let threw = false;
    try {
      await act(async () => {
        try {
          result = await s.value.actions.runExtractParts("main");
        } catch {
          threw = true;
        }
      });
    } finally {
      spy.mockRestore();
    }

    expect(threw).toBe(false);
    expect(result!.status).toBe("error");
    expect(result!.parts).toEqual([]);
    expect(result!.confidence).toBeUndefined();
    // The failure is recorded in the tool timeline as an error entry.
    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "engraving.extractParts",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("error");

    s.cleanup();
  });
});

// ── v1.14 Stage 1: Teaching panel -> real Teaching tool bridge ──────────────
describe("project-store teaching (v1.14 Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // T02 (unit, critical): runTeaching routes through the real
  // teaching.explainDecision tool and converts the agent Explanation into the
  // UI UiExplanation shape (overview/conceptTags/alternatives.name).
  it("T02: runTeaching 调用真实 explainDecision 并转换为 UI 形状 (critical)", async () => {
    const s = setup(makeNotes());
    let result: TeachingRunResult | undefined;

    await act(async () => {
      result = await s.value.actions.runTeaching({
        diffId: "reflow-layout-main",
        userLevel: "intermediate",
        compareWithAlt: true,
      });
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe("ok");
    // Conversion layer output: agent summary -> UI overview.
    expect(result!.explanation.overview.length).toBeGreaterThan(0);
    expect(result!.explanation.detail.length).toBeGreaterThan(0);
    expect(Array.isArray(result!.explanation.conceptTags)).toBe(true);
    expect(Array.isArray(result!.explanation.examples)).toBe(true);
    // compareWithAlt=true on a reflow diff -> real alternatives with a name.
    expect(result!.explanation.alternatives.length).toBeGreaterThan(0);
    for (const alt of result!.explanation.alternatives) {
      expect(typeof alt.name).toBe("string");
      expect(Array.isArray(alt.pros)).toBe(true);
      expect(Array.isArray(alt.cons)).toBe(true);
    }
    // agent level is NOT written back to the UI explanation.
    expect(result!.explanation).not.toHaveProperty("level");
    expect(typeof result!.confidence).toBe("number");
    expect(result!.raw).toBeDefined();

    s.cleanup();
  });

  // T02 (critical) part 2: the teaching-panel invocation leaves a visible
  // trace in the Agent tool timeline (running + success upserted into one).
  it("T02b: 时间线出现 teaching.explainDecision 工具调用(合并为一条 success)", async () => {
    const s = setup(makeNotes());
    expect(s.value.toolCalls).toEqual([]);

    await act(async () => {
      await s.value.actions.runTeaching({
        diffId: "motif-compose-1",
        userLevel: "beginner",
        compareWithAlt: false,
      });
    });

    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "teaching.explainDecision",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("success");
    expect(calls[0].agentName).toBe("teaching-panel");
    expect(calls[0].params).toEqual({
      diffId: "motif-compose-1",
      userLevel: "beginner",
      compareWithAlt: false,
    });
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].resultSummary.length).toBeGreaterThan(0);

    s.cleanup();
  });

  // T02 (unit, non-critical): a failing tool must surface as status:"error"
  // with the empty explanation (never template content) and never throw.
  it("T02c: explainDecision 失败时 runTeaching 返回 status:error(空解释,不抛异常)", async () => {
    const s = setup(makeNotes());
    const spy = vi.spyOn(TeachingAgent.prototype, "explainDecision");
    spy.mockImplementation(() => {
      throw new Error("teaching engine down");
    });

    let result: TeachingRunResult | undefined;
    let threw = false;
    try {
      await act(async () => {
        try {
          result = await s.value.actions.runTeaching({
            diffId: "reflow-layout-main",
            userLevel: "advanced",
          });
        } catch {
          threw = true;
        }
      });
    } finally {
      spy.mockRestore();
    }

    expect(threw).toBe(false);
    expect(result!.status).toBe("error");
    expect(result!.explanation).toEqual(EMPTY_UI_EXPLANATION);
    // The failure is recorded in the tool timeline as an error entry.
    const calls = s.value.toolCalls.filter(
      (r) => r.toolName === "teaching.explainDecision",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].status).toBe("error");

    s.cleanup();
  });
});
