import { describe, it, expect, beforeAll, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AgentMusicIO,
  AgentMusicData,
  ProjectGraph,
  createNoteEvent,
  createTrack,
  TasteStore,
  TasteGenome,
  type MixerState,
  type NoteEvent,
  type DiffEnvelope,
} from "@collinx/core";
import {
  collectAgentMusicData,
  restoreFromAgentMusicData,
  type AgentMusicStoreSource,
} from "../agentmusic-bridge";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMixer(): MixerState {
  return {
    tracks: [
      createTrack("Melody", "melody"),
      createTrack("Bass", "bass"),
    ],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

function makeNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64, pitchSpelling: "E4", velocity: 0.8, voice: "rh" }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 2, pitchMidi: 40, pitchSpelling: "E2", velocity: 0.7, voice: "lh" }),
  ];
}

function makeGraphWithNotes(notes: NoteEvent[]): ProjectGraph {
  const graph = ProjectGraph.create("Bridge Round Trip");
  for (const n of notes) {
    graph.addNode("NoteSpan", { ...n });
  }
  return graph;
}

function makeAppliedDiffs(): DiffEnvelope[] {
  return [
    {
      diffId: "d-1",
      baseRevision: "rev-1",
      actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
      permissionScope: "proposal_only",
      summary: "Applied harmony change",
      ops: [{ op: "update_meta", path: "/project", data: { title: "X" } }],
      domainExplanations: [],
      evidenceRefs: [],
      rollbackToken: "rb-1",
      riskFlags: [],
      createdAt: new Date().toISOString(),
    },
  ];
}

/** Renders a real ProjectProvider (no persistence) and exposes the live store
 *  value via a probe so we can re-read it after async restores. */
function renderProvider(opts: {
  notes?: NoteEvent[];
  mixer?: MixerState;
}): { getStore: () => ProjectStoreValue; cleanup: () => void } {
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
      <ProjectProvider initialNotes={opts.notes} initialMixer={opts.mixer}>
        <Probe />
      </ProjectProvider>
    );
  });
  return {
    getStore: () => liveStore!,
    cleanup: () => {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

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

// ---------------------------------------------------------------------------
// T01 (unit, critical): collect -> save -> load -> restore 往返一致
// ---------------------------------------------------------------------------
describe("agentmusic-bridge round trip (T01)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: collect→save→load→restore 保持 graph/notes/mixer/taste 一致", async () => {
    const io = new AgentMusicIO();
    const notes = makeNotes();
    const mixer = makeMixer();
    const provider = renderProvider({ notes, mixer });
    const store = provider.getStore();

    // 1) collect
    const data1 = collectAgentMusicData({
      graph: store.graph,
      notes: store.notes,
      mixer: store.mixer,
      tasteStore: store.tasteStore,
      appliedDiffs: makeAppliedDiffs(),
    });

    // 2) save -> load (zip round trip)
    const bytes = await io.save(data1);
    const data2 = await io.load(bytes);

    // save→load 字段完全还原
    expect(data2.graph).toEqual(data1.graph);
    expect(data2.notes).toEqual(data1.notes);
    expect(data2.routing).toEqual(data1.routing);
    expect(data2.tasteGenome).toEqual(data1.tasteGenome);
    expect(data2.tasteVersions).toEqual(data1.tasteVersions);
    expect(data2.revisions).toEqual(data1.revisions);

    // 3) restore 进真实 store
    await act(async () => {
      await restoreFromAgentMusicData(data2, store.actions);
      await new Promise((r) => setTimeout(r, 0));
    });

    const restored = provider.getStore();
    const data3 = collectAgentMusicData({
      graph: restored.graph,
      notes: restored.notes,
      mixer: restored.mixer,
      tasteStore: restored.tasteStore,
      appliedDiffs: restored.appliedDiffs,
    });

    // restore 后再次 collect 与原始一致（全字段对比）
    // 注意：ProjectGraph.toJSON() 每次调用都会重新生成顶层 created_at，
    // 这是非语义字段；比较时归一化掉，避免误判往返不一致。
    const normGraph = (g: unknown) => {
      const c = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
      delete c.created_at;
      return c;
    };
    expect(normGraph(data3.graph)).toEqual(normGraph(data1.graph));
    expect(data3.notes).toEqual(data1.notes);
    expect(data3.routing).toEqual(data1.routing);
    expect(data3.tasteGenome).toEqual(data1.tasteGenome);
    expect(data3.tasteVersions).toEqual(data1.tasteVersions);

    // 还原后的 notes 确实来自被还原的 graph（不与初始 demo 混淆）
    expect(restored.notes.map((n) => n.pitchMidi).sort()).toEqual(
      notes.map((n) => n.pitchMidi).sort()
    );

    provider.cleanup();
  });
});

// ---------------------------------------------------------------------------
// T02 (unit, critical): 损坏文件 load 报错不崩溃
// ---------------------------------------------------------------------------
describe("agentmusic-bridge corrupt file (T02)", () => {
  const io = new AgentMusicIO();

  it("T02a: 垃圾字节 unzip 失败抛出 Error", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(io.load(garbage)).rejects.toThrow();
  });

  it("T02c: 截断的合法文件 unzip 失败抛出 Error", async () => {
    const notes = makeNotes();
    const graph = makeGraphWithNotes(notes);
    const tasteStore = new TasteStore();
    tasteStore.save(TasteGenome.createDefault());
    const data: AgentMusicData = {
      manifest: {
        version: "1.1.0",
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        title: "X",
        bpm: 120,
        keySignature: "C major",
        timeSignature: "4/4",
        totalBars: 1,
        trackCount: 1,
      },
      graph: graph.toJSON(),
      revisions: [graph.getRevisionId()],
      notes,
      routing: makeMixer(),
      tasteGenome: tasteStore.getCurrentGenome()!.toJSON(),
      tasteVersions: tasteStore.getVersionHistory(),
    };
    const full = await io.save(data);
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    await expect(io.load(truncated)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T05 (unit, non-critical): 空工程（无 notes）往返
// ---------------------------------------------------------------------------
describe("agentmusic-bridge empty project (T05)", () => {
  it("T05: 无 notes 的空工程 save→load 往返一致, taste 缺省降级为 undefined", async () => {
    const io = new AgentMusicIO();
    const graph = ProjectGraph.create("Empty");
    const tasteStore = new TasteStore(); // 内存模式, 无 genome
    const source: AgentMusicStoreSource = {
      graph,
      notes: [],
      mixer: makeMixer(),
      tasteStore,
      appliedDiffs: [],
    };

    const data1 = collectAgentMusicData(source);
    expect(data1.notes).toEqual([]);
    expect(data1.tasteGenome).toBeUndefined();
    expect(data1.tasteVersions).toBeUndefined();

    const bytes = await io.save(data1);
    const data2 = await io.load(bytes);

    expect(data2.notes).toEqual([]);
    expect(data2.tasteGenome).toBeUndefined();
    expect(data2.tasteVersions).toBeUndefined();
    expect(data2.graph).toEqual(data1.graph);
    expect(data2.routing).toEqual(data1.routing);
  });
});
