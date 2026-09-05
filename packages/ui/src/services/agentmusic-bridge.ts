import {
  AgentMusicIO,
  deserializeGraph,
  type AgentMusicData,
  type AgentMusicManifest,
  type DiffEnvelope,
  type DiffLogEntry,
  type GenomeVersionEntry,
  type MixerState,
  type NoteEvent,
  type ProjectGraph,
  type TasteGenomeData,
  type TasteStore,
} from "@collinx/core";

// ---------------------------------------------------------------------------
// .agentmusic 工程保存/加载映射层 (Stage 0)。
//
// 把 UI 层的 ProjectStore 状态（ProjectGraph / notes / mixer / tasteStore /
// appliedDiffs）与 core 的 AgentMusicIO 格式（AgentMusicData）互相转换。
//
// 设计要点（对齐 persistence.ts 的 deserialize 模式）：
//  - collectAgentMusicData: 从 store 收集完整状态为 AgentMusicData；
//    graph 用 graph.toJSON()，mixer 映射到 AgentMusicData.routing，
//    taste 用 TasteStore 快照（getCurrentGenome + getVersionHistory），
//    diffLog 由 appliedDiffs 派生。
//  - restoreFromAgentMusicData: 通过既有 store actions 还原状态（不直接
//    setState），graph 用 deserializeGraph 重建，mixer 走 revertMixerTo，
//    taste 走 restoreTaste（importPackage 写入版本历史），保持 diff 历史一致。
//
// 字段降级说明（与 store 确实无法对齐的字段，做合理降级并在报告中说明）：
//  - harmony / form / motifs / tempoCurves / noteControls：当前 store 不持有
//    这些状态，collect 时不产出（undefined），load 后也原样保留。
//  - diffLog（DiffLogEntry[]）由 appliedDiffs 派生时只保留元数据（diffId /
//    actor / summary / opsCount / rollbackToken），不保留完整 ops；restore
//    阶段不据此重建 appliedDiffs（避免产生 ops 为空、可回滚却无图变更的脏状
//    态）。如需完整还原 appliedDiffs 将在后续 Stage 增加专用字段。
// ---------------------------------------------------------------------------

/** store 提供给 collect 的最小状态切片。真实的 ProjectStoreValue 满足该形状。 */
export interface AgentMusicStoreSource {
  graph: ProjectGraph;
  notes: NoteEvent[];
  mixer: MixerState;
  tasteStore: TasteStore;
  /** 已应用的 diff 历史，映射到 AgentMusicData.diffLog。 */
  appliedDiffs?: DiffEnvelope[];
  /** 待应用的 diff 队列（当前仅收集，不写入 .agentmusic）。 */
  pendingDiffs?: DiffEnvelope[];
}

/**
 * restoreFromAgentMusicData 需要的最小 action 集合。ProjectStore 的 actions
 * 对象满足该接口；这里用窄接口解耦，便于单测时注入 mock。
 */
export interface AgentMusicRestoreActions {
  /** 替换工程图（notes 会按图重派生）。 */
  replaceGraph(graph: ProjectGraph): void;
  /** 还原混音台状态。 */
  revertMixerTo(mixer: MixerState): void;
  /** 还原口味基因组 + 版本历史。genome 为 null 时保留当前口味。 */
  restoreTaste(genome: TasteGenomeData | null, versions: GenomeVersionEntry[]): void;
}

/** 把一条 applied DiffEnvelope 派生为元数据型 DiffLogEntry。 */
function toDiffLogEntry(d: DiffEnvelope): DiffLogEntry {
  return {
    diffId: d.diffId,
    baseRevision: d.baseRevision,
    newRevision: "",
    actor: d.actor,
    summary: d.summary,
    opsCount: d.ops.length,
    appliedAt: d.createdAt ?? new Date().toISOString(),
    status: "applied",
    rollbackToken: d.rollbackToken ?? "",
  };
}

/**
 * 从 store 状态收集完整的 AgentMusicData。
 *
 * 字段对照（AgentMusicData 字段 ↔ store 来源）：
 *  - manifest            ← buildManifest(graph)
 *  - graph               ← store.graph.toJSON()
 *  - revisions           ← [graph.getRevisionId()]（单元素：当前图版本）
 *  - notes               ← store.notes
 *  - routing             ← store.mixer
 *  - tasteGenome         ← store.tasteStore.getCurrentGenome().toJSON()
 *  - tasteVersions       ← store.tasteStore.getVersionHistory()
 *  - diffLog             ← store.appliedDiffs（元数据派生）
 *  - harmony/form/motifs/tempoCurves/noteControls ← 不产出（store 无对应状态）
 */
export function collectAgentMusicData(store: AgentMusicStoreSource): AgentMusicData {
  const io = new AgentMusicIO();
  const manifest = io.createManifest({ graph: store.graph.toJSON() });

  const genome = store.tasteStore.getCurrentGenome();
  const versions = store.tasteStore.getVersionHistory();

  const applied = store.appliedDiffs ?? [];

  return {
    manifest,
    graph: store.graph.toJSON(),
    revisions: [store.graph.getRevisionId()],
    notes: store.notes,
    routing: store.mixer,
    tasteGenome: genome ? genome.toJSON() : undefined,
    tasteVersions: versions.length > 0 ? versions : undefined,
    diffLog: applied.length > 0 ? applied.map(toDiffLogEntry) : undefined,
  };
}

/**
 * 通过既有 store actions 还原 AgentMusicData 到 store。
 *
 * 不直接 setState：graph 走 replaceGraph（notes 由 reducer 按图重派生），
 * mixer 走 revertMixerTo，taste 走 restoreTaste（写回版本历史）。
 * diffLog 仅作元数据归档，restore 阶段不重建 appliedDiffs（见文件头降级说明）。
 */
export async function restoreFromAgentMusicData(
  data: AgentMusicData,
  actions: AgentMusicRestoreActions
): Promise<void> {
  // graph
  const graph = deserializeGraph(JSON.stringify(data.graph));
  actions.replaceGraph(graph);

  // mixer（无 routing 时保留当前混音台，避免破坏可渲染状态）
  if (data.routing) {
    actions.revertMixerTo(data.routing);
  }

  // taste（有 genome 才覆盖，否则保留当前口味）
  actions.restoreTaste(data.tasteGenome ?? null, data.tasteVersions ?? []);
}
