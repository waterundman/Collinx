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
import { MAX_PERSISTED_ROLLBACK_SNAPSHOTS } from "./persistence";

/**
 * Cap on rollback snapshots written into a .agentmusic file. Kept identical
 * to the localStorage layer's cap (MAX_PERSISTED_ROLLBACK_SNAPSHOTS, see
 * persistence.ts) so both persistence surfaces stay in lockstep; the cap is
 * implemented once here — core AgentMusicIO stays a pure reader/writer.
 */
export const MAX_AGENTMUSIC_ROLLBACK_SNAPSHOTS = MAX_PERSISTED_ROLLBACK_SNAPSHOTS;

// ---------------------------------------------------------------------------
// .agentmusic 工程保存/加载映射层 (Stage 0；v1.17.0 补全 diff 历史)。
//
// 把 UI 层的 ProjectStore 状态（ProjectGraph / notes / mixer / tasteStore /
// appliedDiffs）与 core 的 AgentMusicIO 格式（AgentMusicData）互相转换。
//
// 设计要点（对齐 persistence.ts 的 deserialize 模式）：
//  - collectAgentMusicData: 从 store 收集完整状态为 AgentMusicData；
//    graph 用 graph.toJSON()，mixer 映射到 AgentMusicData.routing，
//    taste 用 TasteStore 快照（getCurrentGenome + getVersionHistory），
//    diffLog 由 appliedDiffs 派生（人类可读审计链）；
//    v1.17.0 起 appliedDiffs（含完整 ops）与 rollbackSnapshots（DiffEngine
//    回滚快照，cap 至 MAX_AGENTMUSIC_ROLLBACK_SNAPSHOTS，与 localStorage 层
//    的 MAX_PERSISTED_ROLLBACK_SNAPSHOTS 对齐）一并写入文件，cap 在本侧单点
//    实现，core IO 保持纯读写。
//  - restoreFromAgentMusicData: 通过既有 store actions 还原状态（不直接
//    setState），graph 用 deserializeGraph 重建，mixer 走 revertMixerTo，
//    taste 走 restoreTaste（importPackage 写入版本历史）；v1.17.0 起
//    restoreDiffHistory 重建 appliedDiffs + DiffEngine 回滚快照，使加载后
//    历史 diff 仍可 ROLLBACK_DIFF。
//
// 字段降级说明（与 store 确实无法对齐的字段，做合理降级并在报告中说明）：
//  - harmony / form / motifs / tempoCurves / noteControls：当前 store 不持有
//    这些状态，collect 时不产出（undefined），load 后也原样保留。
//  - diffLog（DiffLogEntry[]）由 appliedDiffs 派生时只保留元数据（diffId /
//    actor / summary / opsCount / rollbackToken）；完整 ops 走 v1.17.0 新增
//    的 appliedDiffs 专用字段，restore 阶段经 restoreDiffHistory 重建。
//  - 旧格式（v1.16）文件无 appliedDiffs / rollbackSnapshots：restore 时跳过
//    diff 历史重建（保留当前 appliedDiffs），行为与 v1.16 完全一致。
// ---------------------------------------------------------------------------

/** store 提供给 collect 的最小状态切片。真实的 ProjectStoreValue 满足该形状。 */
export interface AgentMusicStoreSource {
  graph: ProjectGraph;
  notes: NoteEvent[];
  mixer: MixerState;
  tasteStore: TasteStore;
  /** 已应用的 diff 历史，映射到 AgentMusicData.diffLog（元数据）与
   *  AgentMusicData.appliedDiffs（完整含 ops，v1.17.0）。 */
  appliedDiffs?: DiffEnvelope[];
  /** 待应用的 diff 队列（当前仅收集，不写入 .agentmusic）。 */
  pendingDiffs?: DiffEnvelope[];
  /**
   * v1.17.0 Stage 0: DiffEngine.exportSnapshots() 输出（rollbackToken ->
   * graph JSON），映射到 AgentMusicData.rollbackSnapshots（collect 时 cap）。
   */
  rollbackSnapshots?: Record<string, string>;
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
  /**
   * v1.17.0 Stage 0: 重建已应用 diff 历史。实现方（ProjectProvider）先把
   * rollbackSnapshots importSnapshots 进共享 DiffEngine，再 dispatch reducer
   * action 替换 appliedDiffs；两步均幂等（StrictMode 双渲染安全）。
   */
  restoreDiffHistory(
    appliedDiffs: DiffEnvelope[],
    rollbackSnapshots: Record<string, string>
  ): void;
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
 *  - diffLog             ← store.appliedDiffs（元数据派生，审计链）
 *  - appliedDiffs        ← store.appliedDiffs（完整含 ops，v1.17.0）
 *  - rollbackSnapshots   ← store.rollbackSnapshots（cap 至最近 10 条，v1.17.0）
 *  - harmony/form/motifs/tempoCurves/noteControls ← 不产出（store 无对应状态）
 */
export function collectAgentMusicData(store: AgentMusicStoreSource): AgentMusicData {
  const io = new AgentMusicIO();
  const manifest = io.createManifest({ graph: store.graph.toJSON() });

  const genome = store.tasteStore.getCurrentGenome();
  const versions = store.tasteStore.getVersionHistory();

  const applied = store.appliedDiffs ?? [];

  // Cap the rollback snapshot map to the most recent N entries. Object.entries
  // preserves insertion order, so "most recent" == the last N tokens recorded
  // by DiffEngine.apply() — same strategy as persistence.ts capRollbackSnapshots.
  const snapshotEntries = Object.entries(store.rollbackSnapshots ?? {});
  const rollbackSnapshots =
    snapshotEntries.length > MAX_AGENTMUSIC_ROLLBACK_SNAPSHOTS
      ? Object.fromEntries(
          snapshotEntries.slice(-MAX_AGENTMUSIC_ROLLBACK_SNAPSHOTS)
        )
      : Object.fromEntries(snapshotEntries);

  return {
    manifest,
    graph: store.graph.toJSON(),
    revisions: [store.graph.getRevisionId()],
    notes: store.notes,
    routing: store.mixer,
    tasteGenome: genome ? genome.toJSON() : undefined,
    tasteVersions: versions.length > 0 ? versions : undefined,
    diffLog: applied.length > 0 ? applied.map(toDiffLogEntry) : undefined,
    appliedDiffs: applied.length > 0 ? applied : undefined,
    rollbackSnapshots:
      snapshotEntries.length > 0 ? rollbackSnapshots : undefined,
  };
}

/**
 * 通过既有 store actions 还原 AgentMusicData 到 store。
 *
 * 不直接 setState：graph 走 replaceGraph（notes 由 reducer 按图重派生），
 * mixer 走 revertMixerTo，taste 走 restoreTaste（写回版本历史）。
 * diffLog 仅作元数据归档；完整 diff 历史经 restoreDiffHistory 重建
 * （appliedDiffs + DiffEngine 回滚快照）。仅当文件确实携带 diff 历史时才
 * 调用 restoreDiffHistory —— v1.16 旧文件两字段均缺失，restore 后保留当前
 * appliedDiffs，行为与 v1.16 完全一致。
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

  // v1.17.0 Stage 0: diff 历史重建（仅在文件携带时执行，旧文件降级跳过）
  const hasDiffHistory =
    (data.appliedDiffs !== undefined && data.appliedDiffs.length > 0) ||
    (data.rollbackSnapshots !== undefined &&
      Object.keys(data.rollbackSnapshots).length > 0);
  if (hasDiffHistory) {
    actions.restoreDiffHistory(
      data.appliedDiffs ?? [],
      data.rollbackSnapshots ?? {}
    );
  }
}
