import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DiffEngine,
  ProjectGraph,
  createDiffEnvelope,
  createNoteEvent,
  deserializeGraph,
  serializeGraph,
  type NoteEvent,
  type MixerState,
} from "@collinx/core";
import {
  deserializeProjectState,
  loadProjectState,
  serializeProjectState,
  PROJECT_PERSISTENCE_KEY,
  MAX_PERSISTED_ROLLBACK_SNAPSHOTS,
} from "../../services/persistence";
import {
  createInitialState,
  type ProjectStoreValue,
} from "../project-store";
import { createDemoMixer, createDemoNotes } from "../../data/demoData";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";

// ---------------------------------------------------------------------------
// Stage 1: cross-refresh persistence. T01/T02 are critical.
// ---------------------------------------------------------------------------

function makeNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 1, pitchMidi: 62 }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 2, pitchMidi: 40 }),
  ];
}

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

function setupProvider(key: string, initialNotes?: NoteEvent[], initialMixer?: MixerState) {
  let current: ProjectStoreValue | null = null;
  let root: Root;
  let container: HTMLDivElement;

  function Probe({ setCurrent }: { setCurrent: (v: ProjectStoreValue) => void }) {
    setCurrent(useProjectStore());
    return null;
  }

  act(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <ProjectProvider
        title="Persist Test"
        initialNotes={initialNotes}
        initialMixer={initialMixer}
        persistenceKey={key}
      >
        <Probe setCurrent={(v) => { current = v; }} />
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

describe("persistence (Stage 1)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  // [critical] Round-trip must preserve graph (nodes/edges/revision) and the
  // full mixer state through serialize → JSON → deserialize.
  it("T01: serializeProjectState → deserializeProjectState round-trip:graph/mixer 数据一致", () => {
    const graph = ProjectGraph.create("RoundTrip");
    graph.addNode("NoteSpan", {
      ...createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
    });

    const mixer = makeMixer();
    mixer.tracks[0].gainDb = "-6.5";
    mixer.tracks[1].mute = true;

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
      permissionScope: "proposal_only",
      summary: "Add chorus",
      ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "Chorus" } }],
    });

    const persisted = serializeProjectState({
      graph,
      mixer,
      pendingDiffs: [diff],
      appliedDiffs: [],
    });
    const restored = deserializeProjectState(JSON.stringify(persisted));

    expect(restored).not.toBeNull();
    expect(restored!.version).toBe(1);

    // Graph round-trips node-for-node; toJSON() refreshes the envelope-level
    // created_at stamp, so compare payload fields individually.
    const restoredGraph = deserializeGraph(restored!.graphJson);
    const originalJson = graph.toJSON();
    const restoredJson = restoredGraph.toJSON();
    expect(restoredGraph.getRevisionId()).toBe(graph.getRevisionId());
    expect(restoredJson.meta).toEqual(originalJson.meta);
    expect(restoredJson.nodes).toEqual(originalJson.nodes);
    expect(restoredJson.edges).toEqual(originalJson.edges);

    // Mixer + proposal queue round-trip field-for-field.
    expect(restored!.mixer).toEqual(mixer);
    expect(restored!.pendingDiffs).toEqual([diff]);
    expect(restored!.appliedDiffs).toEqual([]);
  });

  // [critical] With no saved state, the store must keep producing the demo
  // project (demo notes + demo mixer) exactly as before Stage 1.
  it("T02: 无存档时 createInitialState 走 demo 数据(行为不变)", () => {
    // Direct createInitialState semantics are unchanged: no params -> an
    // empty graph (demo notes are injected by the provider, not the factory).
    const empty = createInitialState();
    expect(empty.graph.getAllNodes().length).toBe(0);
    expect(empty.notes).toEqual([]);
    expect(empty.mixer.tracks.length).toBe(createDemoMixer().tracks.length);

    // Provider with a fresh (never-saved) key has no snapshot -> demo data,
    // exactly like a first visit before Stage 1.
    const s = setupProvider("collinx.test.persist.t02-empty");
    const demoNotes = createDemoNotes();
    expect(s.value.notes.length).toBe(demoNotes.length);
    expect(s.value.graph.getNodesByType("NoteSpan").length).toBe(demoNotes.length);
    expect(s.value.mixer.tracks.length).toBe(createDemoMixer().tracks.length);
    expect(s.value.mixer.masterTrack.busType).toBe("master");
    // Two demo proposals are seeded, nothing applied yet.
    expect(s.value.pendingDiffs.length).toBe(2);
    expect(s.value.appliedDiffs).toEqual([]);
    expect(s.value.rollbackTokens).toEqual([]);
    expect(s.value.mixerDiffLog).toEqual([]);
    expect(s.value.genomeVersion).toBe(0);
    s.cleanup();
  });

  // [critical] Edit mixer + taste → debounced save → remount ("refresh") →
  // both restored from localStorage.
  it("T03: 持久化后 mixer/taste 可恢复(改 mixer → save → load → 状态一致)", async () => {
    const KEY = "collinx.test.persist.t03";

    // Phase 1: mount, edit mixer + taste, let the 500ms debounce flush.
    const s1 = setupProvider(KEY, makeNotes(), makeMixer());
    act(() => {
      s1.value.actions.updateMixerTrack("t1", { gainDb: "-6.5" });
    });
    act(() => {
      s1.value.actions.updateTasteParameter("harmony.chromatic_color", "0.85");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    // A snapshot really landed in localStorage under the versioned key.
    expect(loadProjectState(KEY)).not.toBeNull();
    expect(s1.value.persistence.enabled).toBe(true);
    expect(s1.value.persistence.lastSavedAt).not.toBeNull();
    s1.cleanup();

    // Phase 2: simulate a refresh — mount again against the same key.
    const s2 = setupProvider(KEY);

    // Mixer restored exactly (edited track + untouched siblings + master).
    expect(s2.value.mixer.tracks.find((t) => t.id === "t1")!.gainDb).toBe("-6.5");
    expect(s2.value.mixer.tracks[1].gainDb).toBe("0");
    expect(s2.value.mixer.masterTrack.gainDb).toBe("0");

    // Notes restored from the persisted graph.
    expect(s2.value.notes.length).toBe(makeNotes().length);

    // Taste restored through the localStorage-backed fs adapter + load().
    const taste = s2.value.tasteStore.getCurrentGenome()!;
    expect(taste.getParameter("harmony.chromatic_color")!.value).toBe("0.85");

    expect(s2.value.persistence.enabled).toBe(true);
    s2.cleanup();
  });

  it("T04: 损坏/版本不匹配的存档 payload 返回 null(走 demo 回退)", () => {
    // Garbage JSON.
    expect(deserializeProjectState("{not json")).toBeNull();
    // Valid JSON but wrong version.
    expect(deserializeProjectState(JSON.stringify({ version: 99 }))).toBeNull();
    // Missing graph payload.
    expect(
      deserializeProjectState(
        JSON.stringify({ version: 1, savedAt: "", mixer: makeMixer() })
      )
    ).toBeNull();
    // Malformed mixer shape.
    expect(
      deserializeProjectState(
        JSON.stringify({
          version: 1,
          savedAt: "",
          graphJson: JSON.stringify(ProjectGraph.create("x").toJSON()),
          mixer: { tracks: "nope", masterTrack: {} },
        })
      )
    ).toBeNull();
    // Nothing under the storage key.
    expect(loadProjectState(PROJECT_PERSISTENCE_KEY)).toBeNull();
  });

  // [critical] Stage 4 gap: T01 proves serialize/deserialize carries the
  // diff queues, but no provider-level test proves a real "apply -> refresh"
  // cycle restores them. The Agent Panel must show the same proposal queue
  // and applied-diff history after a reload.
  it("T05: 应用 diff 后持久化,refresh 后 pendingDiffs/appliedDiffs 恢复", async () => {
    const KEY = "collinx.test.persist.t05";

    // Phase 1: mount, apply one pending proposal, let the debounce flush.
    const s1 = setupProvider(KEY, makeNotes());
    const pendingBefore = s1.value.pendingDiffs.length;
    expect(pendingBefore).toBe(2); // two seeded demo proposals
    const diff = s1.value.pendingDiffs[0];
    act(() => {
      s1.value.actions.applyDiff(diff);
    });
    expect(s1.value.appliedDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);
    expect(s1.value.pendingDiffs.length).toBe(pendingBefore - 1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    // The snapshot really carries the moved diff queues.
    const saved = loadProjectState(KEY);
    expect(saved).not.toBeNull();
    expect(saved!.appliedDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);
    expect(saved!.pendingDiffs.length).toBe(pendingBefore - 1);
    s1.cleanup();

    // Phase 2: refresh against the same key -> queues restored.
    const s2 = setupProvider(KEY);
    expect(s2.value.appliedDiffs.length).toBe(1);
    expect(s2.value.appliedDiffs.some((d) => d.diffId === diff.diffId)).toBe(true);
    expect(s2.value.pendingDiffs.length).toBe(pendingBefore - 1);
    // The applied proposal is gone from the restored pending queue.
    expect(s2.value.pendingDiffs.some((d) => d.diffId === diff.diffId)).toBe(false);
    // Graph is derived from the persisted envelope (demo note count kept).
    expect(s2.value.notes.length).toBe(makeNotes().length);
    s2.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Stage 0: graph rollback chain across refresh (rollbackSnapshots).
// ---------------------------------------------------------------------------

describe("persistence (Stage 0 rollbackSnapshots)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  // [critical] The hard requirement: a persisted rollback chain must survive
  // serialize -> deserialize -> a fresh DiffEngine hydrated via importSnapshots
  // so ROLLBACK_DIFF restores the pre-apply graph after a refresh.
  it("T01: graph diff → serialize → deserialize → 新 DiffEngine import → rollback 恢复 graph", () => {
    const engine = new DiffEngine();
    const graph = ProjectGraph.create("Stage0 Rollback");
    graph.addNode("NoteSpan", {
      ...createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
    });

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
      permissionScope: "proposal_only",
      summary: "Add chorus",
      ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "Chorus" } }],
    });

    const result = engine.apply(diff, graph);
    expect(result.graph.getAllNodes()).toHaveLength(2);

    // Persist the post-apply graph + the engine's rollback map.
    const exported = engine.exportSnapshots();
    const persisted = serializeProjectState({
      graph: result.graph,
      mixer: makeMixer(),
      pendingDiffs: [],
      appliedDiffs: [diff],
      rollbackSnapshots: exported,
    });
    const restored = deserializeProjectState(JSON.stringify(persisted));
    expect(restored).not.toBeNull();
    expect(restored!.rollbackSnapshots[result.rollbackToken]).toBe(
      exported[result.rollbackToken]
    );

    // Simulate a refresh: rebuild the graph + fresh engine + importSnapshots.
    const restoredGraph = deserializeGraph(restored!.graphJson);
    const freshEngine = new DiffEngine();
    freshEngine.importSnapshots(restored!.rollbackSnapshots);

    // ROLLBACK_DIFF on the rehydrated engine restores the pre-apply graph
    // (only the original NoteSpan remains, and the revision rewinds).
    const rolledBack = freshEngine.rollback(restoredGraph, result.rollbackToken);
    expect(rolledBack.getAllNodes()).toHaveLength(1);
    expect(rolledBack.getAllNodes()[0].type).toBe("NoteSpan");
    expect(rolledBack.getRevisionId()).toBe(graph.getRevisionId());
  });

  // [critical] The persisted rollback map must round-trip key-for-key and
  // value-for-value so every applied diff stays rollback-able after refresh.
  it("T02: rollbackSnapshots round-trip 键值完整", () => {
    const engine = new DiffEngine();
    const graph = ProjectGraph.create("Stage0 RoundTrip");
    const diffA = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "system", name: "test" },
      permissionScope: "write_direct",
      summary: "Add A",
      ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "A" } }],
    });
    const diffB = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "system", name: "test" },
      permissionScope: "write_direct",
      summary: "Add B",
      ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "B" } }],
    });
    engine.apply(diffA, graph);
    engine.apply(diffB, graph);
    const exported = engine.exportSnapshots();
    expect(Object.keys(exported).length).toBe(2);

    const persisted = serializeProjectState({
      graph,
      mixer: makeMixer(),
      pendingDiffs: [],
      appliedDiffs: [diffA, diffB],
      rollbackSnapshots: exported,
    });
    const restored = deserializeProjectState(JSON.stringify(persisted));
    expect(restored).not.toBeNull();

    // Keys and values round-trip byte-for-byte.
    expect(restored!.rollbackSnapshots).toEqual(exported);
    expect(Object.keys(restored!.rollbackSnapshots)).toEqual(
      expect.arrayContaining([diffA.rollbackToken, diffB.rollbackToken])
    );
  });

  it("T03(ui): serialize 限制 rollbackSnapshots 数量(最多 10 条,保留最近)", () => {
    const engine = new DiffEngine();
    const graph = ProjectGraph.create("Stage0 Cap");
    for (let i = 0; i < MAX_PERSISTED_ROLLBACK_SNAPSHOTS + 2; i++) {
      engine.apply(
        createDiffEnvelope({
          baseRevision: graph.getRevisionId(),
          actor: { type: "system", name: "test" },
          permissionScope: "write_direct",
          summary: `Add ${i}`,
          ops: [
            { op: "add_node", path: "/", nodeType: "Phrase", data: { name: `P${i}` } },
          ],
        }),
        graph
      );
    }
    const exported = engine.exportSnapshots();
    expect(Object.keys(exported).length).toBe(MAX_PERSISTED_ROLLBACK_SNAPSHOTS + 2);

    const persisted = serializeProjectState({
      graph,
      mixer: makeMixer(),
      pendingDiffs: [],
      appliedDiffs: [],
      rollbackSnapshots: exported,
    });
    const keys = Object.keys(persisted.rollbackSnapshots);
    expect(keys.length).toBe(MAX_PERSISTED_ROLLBACK_SNAPSHOTS);
    // Object.entries keeps insertion order, so the newest N tokens survive.
    expect(keys).toEqual(Object.keys(exported).slice(-MAX_PERSISTED_ROLLBACK_SNAPSHOTS));
  });

  it("T04(ui): 损坏/缺失 rollbackSnapshots payload 的容错", () => {
    const graph = ProjectGraph.create("Bad Snapshots");
    const base = {
      version: 1,
      savedAt: "",
      graphJson: serializeGraph(graph),
      mixer: makeMixer(),
      pendingDiffs: [],
      appliedDiffs: [],
    };
    // Present but not a Record -> poisoned payload, fall back to demo.
    expect(
      deserializeProjectState(JSON.stringify({ ...base, rollbackSnapshots: "nope" }))
    ).toBeNull();
    // Record but values are not strings -> poisoned payload.
    expect(
      deserializeProjectState(
        JSON.stringify({ ...base, rollbackSnapshots: { t: 42 } })
      )
    ).toBeNull();
    // Missing field (pre-Stage-0 envelope) is tolerated as an empty map.
    const legacy = deserializeProjectState(JSON.stringify(base));
    expect(legacy).not.toBeNull();
    expect(legacy!.rollbackSnapshots).toEqual({});
  });

  // [critical] End-to-end through the provider: apply -> save -> refresh ->
  // ROLLBACK_DIFF must hit the rehydrated DiffEngine map (the importSnapshots
  // wiring in ProjectProvider), restoring the pre-apply graph.
  it("T05(provider): 应用 diff → 刷新 → ROLLBACK_DIFF 命中恢复的快照并恢复 graph", async () => {
    const KEY = "collinx.test.persist.t05-rollback";

    // Phase 1: mount, apply one demo proposal (adds a Phrase node), flush.
    const s1 = setupProvider(KEY, makeNotes());
    const diff = s1.value.pendingDiffs[0];
    act(() => {
      s1.value.actions.applyDiff(diff);
    });
    expect(s1.value.graph.getNodesByType("Phrase").length).toBe(1);
    expect(s1.value.rollbackTokens).toContain(diff.rollbackToken);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const saved = loadProjectState(KEY);
    expect(saved).not.toBeNull();
    expect(Object.keys(saved!.rollbackSnapshots).length).toBe(1);
    s1.cleanup();

    // Phase 2: refresh -> a fresh provider + fresh DiffEngine hydrated from
    // the persisted rollbackSnapshots by ProjectProvider.
    const s2 = setupProvider(KEY);
    expect(
      s2.value.appliedDiffs.some((d) => d.diffId === diff.diffId)
    ).toBe(true);
    act(() => {
      s2.value.actions.rollbackDiff(diff.rollbackToken);
    });
    // ROLLBACK_DIFF hit the rehydrated snapshot: the proposal's Phrase node
    // is gone and the diff left the applied history.
    expect(s2.value.graph.getNodesByType("Phrase").length).toBe(0);
    expect(
      s2.value.appliedDiffs.some((d) => d.diffId === diff.diffId)
    ).toBe(false);
    s2.cleanup();
  });
});
