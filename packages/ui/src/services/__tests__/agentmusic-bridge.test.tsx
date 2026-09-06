import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AgentMusicIO,
  AgentMusicData,
  ProjectGraph,
  createDiffEnvelope,
  createNoteEvent,
  createTrack,
  serializeGraph,
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

// ---------------------------------------------------------------------------
// v1.17.0 Stage 0：完整 diff 历史持久化（T01/T02/T03）
// ---------------------------------------------------------------------------

function makeGraphDiff(title: string): DiffEnvelope {
  return {
    diffId: `diff-${title}`,
    baseRevision: "rev-0",
    actor: { type: "user", name: "tester" },
    permissionScope: "write_direct",
    summary: `set title to ${title}`,
    ops: [{ op: "update_meta", path: "/", data: { title } }],
    domainExplanations: [],
    evidenceRefs: [],
    rollbackToken: `rb-${title}`,
    riskFlags: [],
    createdAt: new Date().toISOString(),
  };
}

describe("agentmusic-bridge diff history (v1.17 T01/T02/T03)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: apply≥2 diff → collect → save → load → restore 后 appliedDiffs 逐字段一致且历史 diff 可回滚 (ROLLBACK_DIFF 生效)", async () => {
    const io = new AgentMusicIO();
    const provider = renderProvider({ notes: makeNotes(), mixer: makeMixer() });

    // 1) 通过真实 store 连续 apply 2 个图 diff。snapshots 逐条记录 apply 前
    //    的 serializeGraph 快照，与 DiffEngine.apply 写入的 pre-apply 快照同构
    //    （即 diffEngine.exportSnapshots() 的输出形状）。
    const snapshots: Record<string, string> = {};
    const before1 = serializeGraph(provider.getStore().graph);
    const diff1 = makeGraphDiff("History V1");
    act(() => {
      provider.getStore().actions.applyDiff(diff1);
    });
    snapshots[diff1.rollbackToken] = before1;
    const before2 = serializeGraph(provider.getStore().graph);
    const diff2 = makeGraphDiff("History V2");
    act(() => {
      provider.getStore().actions.applyDiff(diff2);
    });
    snapshots[diff2.rollbackToken] = before2;

    let store = provider.getStore();
    expect(store.appliedDiffs.length).toBe(2);

    // 2) collect：appliedDiffs 完整含 ops
    const data1 = collectAgentMusicData({
      graph: store.graph,
      notes: store.notes,
      mixer: store.mixer,
      tasteStore: store.tasteStore,
      appliedDiffs: store.appliedDiffs,
      rollbackSnapshots: snapshots,
    });
    expect(data1.appliedDiffs).toBeDefined();
    expect(data1.appliedDiffs!.length).toBe(2);
    expect(data1.appliedDiffs!.every((d) => d.ops.length > 0)).toBe(true);
    expect(data1.rollbackSnapshots).toEqual(snapshots);

    // 3) save → load (zip round trip)
    const bytes = await io.save(data1);
    const data2 = await io.load(bytes);
    expect(data2.appliedDiffs).toEqual(data1.appliedDiffs);
    expect(data2.rollbackSnapshots).toEqual(data1.rollbackSnapshots);

    // 4) restore 进真实 store
    await act(async () => {
      await restoreFromAgentMusicData(data2, provider.getStore().actions);
      await new Promise((r) => setTimeout(r, 0));
    });
    const restored = provider.getStore();
    // restore 后 store.appliedDiffs 与文件中的逐字段一致
    expect(restored.appliedDiffs).toEqual(data2.appliedDiffs!);

    // 5) 历史 diff 可回滚：ROLLBACK_DIFF 生效
    act(() => {
      restored.actions.rollbackDiff(diff2.rollbackToken);
    });
    const afterRollback2 = provider.getStore();
    expect(afterRollback2.graph.getMeta().title).toBe("History V1");
    expect(afterRollback2.appliedDiffs.length).toBe(1);

    act(() => {
      afterRollback2.actions.rollbackDiff(diff1.rollbackToken);
    });
    const afterRollback1 = provider.getStore();
    expect(afterRollback1.graph.getMeta().title).toBe("Untitled Project");
    expect(afterRollback1.appliedDiffs.length).toBe(0);

    provider.cleanup();
  });

  it("T02: 旧格式（无 appliedDiffs/rollbackSnapshots）加载不崩溃，行为等同 v1.16", async () => {
    const io = new AgentMusicIO();
    const notes = makeNotes();
    const graph = makeGraphWithNotes(notes);
    const tasteStore = new TasteStore();
    tasteStore.save(TasteGenome.createDefault());

    // v1.16 形状：只有 diffLog 元数据，没有 appliedDiffs / rollbackSnapshots
    const data: AgentMusicData = {
      manifest: {
        version: "1.1.0",
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        title: "Legacy Project",
        bpm: 120,
        keySignature: "C major",
        timeSignature: "4/4",
        totalBars: 1,
        trackCount: 2,
      },
      graph: graph.toJSON(),
      revisions: [graph.getRevisionId()],
      notes,
      routing: makeMixer(),
      tasteGenome: tasteStore.getCurrentGenome()!.toJSON(),
      tasteVersions: tasteStore.getVersionHistory(),
      diffLog: [
        {
          diffId: "d-legacy",
          baseRevision: graph.getRevisionId(),
          newRevision: graph.getRevisionId(),
          actor: { type: "agent", name: "legacy-bot" },
          summary: "legacy audit entry",
          opsCount: 1,
          appliedAt: new Date().toISOString(),
          status: "applied",
          rollbackToken: "rb-legacy",
        },
      ],
    };

    const bytes = await io.save(data);
    const data2 = await io.load(bytes);
    expect(data2.appliedDiffs).toBeUndefined();
    expect(data2.rollbackSnapshots).toBeUndefined();
    expect(data2.diffLog).toBeDefined();

    const provider = renderProvider({ notes: makeNotes(), mixer: makeMixer() });
    await act(async () => {
      await restoreFromAgentMusicData(data2, provider.getStore().actions);
      await new Promise((r) => setTimeout(r, 0));
    });

    const restored = provider.getStore();
    // 行为等同 v1.16：graph/notes 正常还原，appliedDiffs 不被重建（保留当前值）
    expect(restored.notes.map((n) => n.pitchMidi).sort()).toEqual([40, 64]);
    expect(restored.appliedDiffs).toEqual([]);
    provider.cleanup();
  });

  it("T03: rollbackSnapshots 超过 10 条时仅保留最近 10 条（保序取尾部）", () => {
    const graph = ProjectGraph.create("Cap Project");
    const tasteStore = new TasteStore();
    const snapshots: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) {
      snapshots[`rb-${i}`] = `snapshot-${i}`;
    }

    const data = collectAgentMusicData({
      graph,
      notes: [],
      mixer: makeMixer(),
      tasteStore,
      appliedDiffs: [],
      rollbackSnapshots: snapshots,
    });

    const keys = Object.keys(data.rollbackSnapshots!);
    expect(keys.length).toBe(10);
    expect(keys).toEqual(
      Array.from({ length: 10 }, (_, i) => `rb-${i + 3}`)
    );
    expect(data.rollbackSnapshots!["rb-1"]).toBeUndefined();
    expect(data.rollbackSnapshots!["rb-2"]).toBeUndefined();
    expect(data.rollbackSnapshots!["rb-12"]).toBe("snapshot-12");
  });
});

// ---------------------------------------------------------------------------
// v1.17.0 Stage 0（T01b）：真实保存路径防回归
// saveProjectAsAgentMusic 必须把 diffEngine.exportSnapshots() 写进
// collectAgentMusicData —— 否则生产 .agentmusic 永不含 rollbackSnapshots，
// 跨会话历史 diff 回滚静默失效。T01 手工喂快照掩盖过这条断链，T01b 走
// 真实 ProjectProvider 保存 action 全链路验证。
// ---------------------------------------------------------------------------

/** jsdom Blob → Uint8Array（FileReader 全环境可用）。 */
function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

describe("agentmusic-bridge real save path (T01b)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("T01b: 真实保存路径（saveProjectAsAgentMusic）→ 文件 → 恢复后历史 diff 可回滚（防回归：保存端必须携带 rollbackSnapshots）", async () => {
    // 1) 打桩 downloadBlob 依赖的浏览器 API，捕获导出的 Blob。
    //    downloadBlob 是 ProjectProvider 模块内私有函数，只能从这三处截获。
    const capturedBlobs: Blob[] = [];
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = ((blob: Blob) => {
      capturedBlobs.push(blob);
      return "blob:mock-t01b";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {};

    try {
      const provider = renderProvider({ notes: makeNotes(), mixer: makeMixer() });
      const store = provider.getStore();

      // 2) 真实 APPLY_DIFF ×2：reducer 内部走 diffEngine.apply，自动在
      //    diffEngine 中记录 pre-apply 快照（键为 rollbackToken）。
      const diff1 = makeGraphDiff("Save Path V1");
      const diff2 = makeGraphDiff("Save Path V2");
      act(() => {
        store.actions.applyDiff(diff1);
      });
      act(() => {
        store.actions.applyDiff(diff2);
      });
      expect(provider.getStore().appliedDiffs.length).toBe(2);

      // 3) 调用真实保存 action，截获 Blob 字节
      await act(async () => {
        await provider.getStore().actions.saveProjectAsAgentMusic();
      });
      expect(capturedBlobs.length).toBe(1);
      const bytes = await readBlobBytes(capturedBlobs[0]);

      // 4) AgentMusicIO.load 反序列化真实文件字节，断言保存端携带了
      //    rollbackSnapshots 且 appliedDiffs 与 store 一致（核心防回归断言）
      const io = new AgentMusicIO();
      const data = await io.load(bytes);
      expect(data.rollbackSnapshots).toBeDefined();
      expect(Object.keys(data.rollbackSnapshots!).sort()).toEqual(
        [diff1.rollbackToken, diff2.rollbackToken].sort()
      );
      expect(data.rollbackSnapshots![diff2.rollbackToken]).toBeTruthy();
      expect(data.appliedDiffs).toEqual(provider.getStore().appliedDiffs);

      // 5) 走真实 loadProjectFromAgentMusic 恢复路径（含 restoreApi 与
      //    restoreDiffHistory 接线，即 importSnapshots）
      const file = new File([bytes.slice()], "project.agentmusic");
      await act(async () => {
        await provider.getStore().actions.loadProjectFromAgentMusic(file);
        await new Promise((r) => setTimeout(r, 0));
      });
      const restored = provider.getStore();
      expect(restored.appliedDiffs).toEqual(data.appliedDiffs!);
      expect(restored.graph.getMeta().title).toBe("Save Path V2");

      // 6) 跨会话回滚生效：历史 diff 可 ROLLBACK_DIFF
      act(() => {
        restored.actions.rollbackDiff(diff2.rollbackToken);
      });
      const afterRollback = provider.getStore();
      expect(afterRollback.graph.getMeta().title).toBe("Save Path V1");
      expect(afterRollback.appliedDiffs.length).toBe(1);

      provider.cleanup();
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
      HTMLAnchorElement.prototype.click = origAnchorClick;
    }
  });
});
