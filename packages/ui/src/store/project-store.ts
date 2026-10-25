import { createContext } from "react";
import {
  ProjectGraph,
  DiffEngine,
  AgentBus,
  type NoteEvent,
  type DiffEnvelope,
  type MixerState,
  type MixerTrack,
  type TasteStore,
  type TasteGenomeData,
  type GenomeVersionEntry,
  type ToolCallRecord,
  type NewToolCallRecord,
  midiToSpelling,
  nodeToNoteEvent,
  createNoteEvent,
  createTrack,
  computeMixerDiff,
  FX_TYPES,
  type FXType,
  createFXSlot,
  addSlotToChain,
  mixerToDiff,
  diffToMixer,
  serializeGraph,
  deserializeGraph,
  type Layout,
  type HarmonyEntry,
} from "@collinx/core";
import { createDemoMixer, createTasteStore } from "../data/demoData";
import { createBrowserTasteFsAdapter } from "../services/tasteFsAdapter";
import { chordPitches } from "../services/chord-voicing";
import type { AgentToolDefinitionLike, AgentToolOutcome } from "../services/llm";

// ---------------------------------------------------------------------------
// Stage 0 (v2.1.0): tempo / meter map types
// ---------------------------------------------------------------------------
//
// These mirror the shapes used by core's TempoMap (packages/core/src/model/
// tempo-map.ts). They are declared locally rather than re-exported from
// @collinx/core because core already exposes `TempoChange` / `MeterChange` as
// *zod runtime values* in schema/graph-schema.ts; an `export *` re-export of
// the interface with the same name collides (TS2308) instead of merging. The
// store only needs the structural type, so a local mirror keeps core untouched
// and avoids the ambiguity. The shapes stay field-compatible with the core
// TempoMap so S1 can hand these straight into `new TempoMap(...)`.

export type TempoCurve = "instant" | "linear" | "ease_in" | "ease_out";

export interface TempoChange {
  bar: number;
  bpm: number;
  curve?: TempoCurve;
}

export interface MeterChange {
  bar: number;
  numerator: number;
  denominator: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Stage 2: a lightweight, JSON-serializable snapshot of the undoable parts of
 * ProjectStoreState. The full state also carries a mutable TasteStore class
 * instance and the tool-call trace; those are deliberately excluded:
 *  - tasteStore: a mutable class backed by its own localStorage version
 *    history. We record the genome data + version counter so the UI can
 *    re-read deterministically, and so UNDO/REDO can restore the genome
 *    *values* onto the TasteStore. The restore happens in the action-creator
 *    layer (Provider), never in the reducer, because TasteStore is mutable.
 *    The TasteStore keeps its own version history as a separate mechanism.
 *  - toolCalls: an append-only audit trace; not a user edit, so it is not
 *    part of an undo step.
 * The graph is stored as serializeGraph() JSON so the snapshot is immutable
 * by construction (ProjectGraph is a mutable class).
 */
export interface ProjectStoreSnapshot {
  graphJson: string;
  mixer: MixerState;
  pendingDiffs: DiffEnvelope[];
  appliedDiffs: DiffEnvelope[];
  rollbackTokens: string[];
  mixerDiffLog: DiffEnvelope[];
  mixerRollbackSnapshots: Record<string, MixerState>;
  /** Genome data of the state captured by this snapshot, so the provider's
   *  action creators can rebuild the TasteStore when this snapshot is undone
   *  or redone. */
  genome: TasteGenomeData | null;
  genomeVersion: number;
}

/** 默认撤销步数（设置未提供时回退到此值）。 */
export const MAX_UNDO = 50;

/**
 * 撤销栈硬上限（v2.9.3）。
 *
 * 设置页提供「100 / 500 / 1000 / 不限制」。快照是**整工程 JSON + 混音**，
 * 设置页最大选项是 1000 步，「不限制」实际按 1000 执行 —— UI 文案同步写明。
 */
export const UNDO_HARD_CAP = 1000;

/** 把设置里的 `number | 'unlimited'` 解析成实际栈上限。 */
export function resolveUndoLimit(value: number | "unlimited" | undefined): number {
  if (value === "unlimited") return UNDO_HARD_CAP;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), UNDO_HARD_CAP);
  }
  return MAX_UNDO;
}

export interface ProjectStoreState {
  graph: ProjectGraph;
  notes: NoteEvent[];
  pendingDiffs: DiffEnvelope[];
  appliedDiffs: DiffEnvelope[];
  /** v2.5.0：被用户拒绝的提案（留痕，供 Agent 面板显示"已拒绝"计数） */
  rejectedDiffs: DiffEnvelope[];
  rollbackTokens: string[];
  mixer: MixerState;
  mixerDiffLog: DiffEnvelope[];
  /** Pre-apply mixer snapshots keyed by the applied diff's rollbackToken, so
   *  ROLLBACK_DIFF can restore the mixer exactly as it was before a proposal
   *  was applied. A plain record keeps the state JSON-serializable for Stage 1
   *  persistence (a Map would stringify to an empty object). */
  mixerRollbackSnapshots: Record<string, MixerState>;
  tasteStore: TasteStore;
  /** Monotonic counter bumped after every TasteStore mutation. The store is a
   *  mutable class instance, so this counter is the re-render signal. */
  genomeVersion: number;
  /** Stage 0: chronological Agent tool-call trace (newest last). Capped at
   *  MAX_TOOL_CALLS so the array cannot grow unbounded. */
  toolCalls: ToolCallRecord[];
  /** Stage 2: undo stack (most recent last). Pop restores the previous state;
   *  every new undoable edit clears the redo stack. */
  undoStack: ProjectStoreSnapshot[];
  /** Stage 2: redo stack (most recent last). Pop re-applies an undone edit. */
  redoStack: ProjectStoreSnapshot[];
  /**
   * v2.9.3：撤销栈上限，来自设置（`general.undoHistory.maxLevels`）。
   * 此前是硬编码 MAX_UNDO=50，设置页的 100/500/1000/不限制从未生效。
   */
  undoLimit: number;
  /** Stage 0 (v2.1.0): tempo map as a first-class editable list. The playback
   *  engine (S2) reads these to build the TempoMap; defaults to bar1/120. */
  tempoChanges: TempoChange[];
  /** Stage 0 (v2.1.0): meter (time signature) map as a first-class editable
   *  list. Defaults to bar1/4-4. */
  meterChanges: MeterChange[];
}

export type ProjectStoreAction =
  | { type: "APPLY_DIFF"; diff: DiffEnvelope }
  | { type: "REJECT_DIFF"; diffId: string }
  | { type: "ROLLBACK_DIFF"; rollbackToken: string }
  | { type: "ADD_PENDING_DIFFS"; diffs: DiffEnvelope[] }
  | { type: "RECORD_DECISION_EVIDENCE"; diff: DiffEnvelope }
  | { type: "ADD_NOTE"; note: NoteEvent }
  /** v2.6.0：从空编排的起点卡片创建乐段 */
  | { type: "ADD_PHRASE"; name: string; formRole: string; startBar: number; endBar: number }
  | { type: "ADD_NOTES"; notes: NoteEvent[] }
  | { type: "MOVE_NOTE"; id: string; bar: number; beat: number; pitch: number }
  | { type: "RESIZE_NOTE"; id: string; durQn: number }
  | { type: "DELETE_NOTE"; id: string }
  | { type: "UPDATE_MIXER_TRACK"; trackId: string; changes: Partial<MixerTrack>; pushUndo?: boolean }
  | { type: "SET_CHORD"; bar: number; chord: { root: string; quality: string; bass?: string } | null }
  | { type: "APPLY_MIXER_DIFF"; diff: DiffEnvelope }
  | { type: "REVERT_MIXER_TO"; mixer: MixerState }
  | { type: "ADD_MIXER_TRACK"; name: string; sourceId: string;
    /** v2.9.4：来自设置 mixer.defaultFXChain 的新轨默认 FX 类型（非法类型被忽略） */
    defaultFxTypes?: FXType[] }
  /**
   * v2.9.0：删除混音轨。
   *
   * 级联：该轨的音符（NoteSpan.data.trackId 命中 sourceTrackId 或混音条 id）
   * 一并从图里删除；master 与「最后一条轨」受保护。整步可 undo。
   */
  | { type: "REMOVE_MIXER_TRACK"; trackId: string }
  /** v2.9.3：设置变更后调整撤销栈上限（不产生一步 undo） */
  | { type: "SET_UNDO_LIMIT"; limit: number }
  /**
   * Stage 2: the provider's taste action creators mutate the shared TasteStore
   * before dispatching, so the reducer only advances the re-render counter.
   * `beforeGenome` carries the pre-edit genome captured by the action creator
   * so the undo snapshot records the state that undo() must restore (without
   * it, snapshotProjectStore would read the already-mutated live genome).
   */
  | { type: "TASTE_GENOME_CHANGED"; beforeGenome?: TasteGenomeData | null }
  /**
   * `redoGenome`/`undoGenome` carry the live genome captured by the provider
   * BEFORE it restores the target snapshot's genome onto the TasteStore. The
   * reducer uses it to build the opposite-stack snapshot, which must record
   * the pre-restore genome so a later redo()/undo() re-applies the edited
   * values instead of the restored ones.
   */
  | { type: "UNDO"; redoGenome?: TasteGenomeData | null }
  | { type: "REDO"; undoGenome?: TasteGenomeData | null }
  | { type: "RECORD_TOOL_CALL"; record: ToolCallRecord }
  | { type: "CLEAR_TOOL_CALLS" }
  /**
   * Stage 0 (.agentmusic load): replace the entire ProjectGraph and re-derive
   * notes from it. Used by restoreFromAgentMusicData so the graph and notes
   * never drift apart. Pushed to the undo stack so a load is undoable.
   */
  | { type: "REPLACE_GRAPH"; graph: ProjectGraph }
  /**
   * Stage 0 (.agentmusic load): restore the taste genome + version history onto
   * the shared TasteStore. The mutation happens in the provider's action
   * creator (TasteStore is mutable), so the reducer only advances the
   * re-render counter + bumps undo (genomeOverride records the pre-restore
   * genome so undo() can revert the taste values).
   */
  | { type: "TASTE_RESTORE"; genome: TasteGenomeData | null; versions: GenomeVersionEntry[]; beforeGenome?: TasteGenomeData | null }
  /**
   * v1.17.0 Stage 0 (.agentmusic load): rebuild the applied-diff history from
   * the loaded file so historical diffs stay visible and rollback-able. The
   * DiffEngine rollback snapshot import happens imperatively in the
   * provider's action creator (DiffEngine is a mutable class, same layer as
   * tasteStore.importPackage); the reducer only replaces the pure state.
   * Guarded by the bridge: only dispatched when the file actually carries
   * diff history, so v1.16 files keep their old (leave-current) behavior.
   */
  | { type: "RESTORE_DIFF_HISTORY"; appliedDiffs: DiffEnvelope[] }
  /**
   * Stage 0 (v2.1.0): set the tempo (bpm) at a given bar. Same `bar` already
   * present is overwritten (not appended); a new `bar` is appended, then the
   * list is re-sorted by `bar` ascending. `bar` must be a positive integer;
   * non-positive / fractional bars are ignored (no-op) so a malformed UI
   * input can never corrupt the tempo map. Pushed to the undo stack so the
   * edit is reversible. `curve` carries the ramp shape (instant by default).
   */
  | { type: "SET_TEMPO"; bar: number; bpm: number; curve?: TempoChange["curve"] }
  /**
   * Stage 0 (v2.1.0): set the meter (time signature) at a given bar. Same
   * overwrite / append / sort-asc semantics as SET_TEMPO. `bar` must be a
   * positive integer (non-positive / fractional ignored). Pushed to undo.
   */
  | { type: "SET_METER"; bar: number; numerator: number; denominator: number };

// ---------------------------------------------------------------------------
// Stage 0: Orchestrator panel -> real Orchestrator tool bridge
// ---------------------------------------------------------------------------

/** A register conflict as produced by the real Orchestrator agent
 *  (agent's RegisterConflict). It is structurally identical to the UI's
 *  RegisterConflict, so no field conversion is needed — this type only keeps
 *  the store free of a component import. */
export interface OrchestratorConflict {
  type: "overlap" | "spacing" | "range_violation" | "crossing";
  players: [string, string];
  bar: number;
  beat: number;
  description: string;
  severity: "warning" | "error";
  suggestion: string;
}

/** Parameters forwarded to the orchestrator.voicingPlan tool. phraseRef is
 *  optional here (the Orchestrator panel config has no phrase picker); the
 *  provider defaults it before calling the tool. */
export interface OrchestratorConfigInput {
  phraseRef?: string;
  players: string[];
  style?: "classical" | "pop" | "cinematic" | "jazz";
  playabilityPolicy: "strict" | "moderate" | "lenient";
  doubleOctaves?: boolean;
  maxVoices?: number;
}

/** Parsed outcome of a real Orchestrator run, surfaced to the Orchestrator
 *  panel (conflicts) and the Agent panel (diffs are already enqueued into
 *  pendingDiffs by the action). */
export interface OrchestratorRunResult {
  status: "ok" | "error";
  conflicts: OrchestratorConflict[];
  suggestions: string[];
  confidence: number | undefined;
  diffs: DiffEnvelope[];
  voicingPlan: unknown;
  perPlayerNotes: unknown;
}

// ---------------------------------------------------------------------------
// Stage 1: Arranger panel -> real Arranger tool bridge
// ---------------------------------------------------------------------------

/** Source material + target config forwarded to the arranger.expandSection
 *  tool. `source` is the flat note list of the motif being expanded. */
export interface ArrangerConfigInput {
  source: NoteEvent[];
  bars?: number;
  style?: string;
  formTemplate?: string;
  energyTarget?: number;
  variantCount?: number;
}

/** Serialized variant produced by the real Arranger (Variant shape). */
export interface ArrangerVariantData {
  id: string;
  notes: NoteEvent[];
  operations: string[];
  variationScore: number;
  description: string;
}

/** Parsed outcome of a real Arranger run, surfaced to the Arranger panel
 *  (variants/selectedVariant/energyCurvePoints) and the Agent panel (diffs
 *  are already enqueued into pendingDiffs by the action). */
export interface ArrangerRunResult {
  status: "ok" | "error";
  variants: ArrangerVariantData[];
  selectedVariant: ArrangerVariantData | null;
  formStructure: unknown;
  section: unknown;
  energyCurvePoints: { bar: number; level: number }[];
  confidence: number | undefined;
  diffs: DiffEnvelope[];
}

// ---------------------------------------------------------------------------
// Stage 0 (v1.14): Score panel -> real Engraving tool bridge
// ---------------------------------------------------------------------------

/** UI-facing collision warning shape. Structurally identical to the
 *  CollisionWarning exported by components/Score; the store keeps its own copy
 *  so it never imports a component module. */
export interface UiCollisionWarning {
  type: "symbol_overlap" | "slur_cross" | "dynamic_clash" | "articulation_conflict";
  staveIndex: number;
  bar: number;
  beat: number;
  description: string;
  severity: "warning" | "error";
  fixSuggestion: string;
}

/** Parsed outcome of a real Engraving run (engraving.reportCollisions tool).
 *  `collisions` are the agent-side CollisionWarnings converted to the UI
 *  UiCollisionWarning shape (see convertAgentCollisions); `suggestions` are
 *  passed through unchanged. */
export interface EngravingRunResult {
  status: "ok" | "error";
  collisions: UiCollisionWarning[];
  suggestions: string[];
  confidence: number | undefined;
  raw: unknown;
}

/** Fallback suggestion text when the agent's CollisionWarning carries no fix. */
export const DEFAULT_FIX_SUGGESTION = "（无自动修复建议）";

// ---------------------------------------------------------------------------
// v1.15 Stage 0: Score panel -> real part-extraction tool bridge
// ---------------------------------------------------------------------------

/** One extracted part (PartLayout payload from engraving.extractParts). */
export interface ExtractPartInfo {
  instrumentId: string;
  instrumentName: string;
  barCount: number;
}

/** Parsed outcome of a real part-extraction run
 *  (engraving.extractParts tool). `parts` are the extracted PartLayout
 *  payloads; the proposal diffs are already enqueued into pendingDiffs by the
 *  action. */
export interface ExtractPartsRunResult {
  status: "ok" | "error";
  parts: ExtractPartInfo[];
  confidence: number | undefined;
  raw: unknown;
}

/** Converts the raw `parts` payload of the engraving.extractParts tool into
 *  ExtractPartInfo[]. Malformed / non-object entries are dropped so a
 *  partially malformed tool payload cannot crash the panel. */
export function convertExtractParts(data: unknown): ExtractPartInfo[] {
  if (!Array.isArray(data)) return [];
  const out: ExtractPartInfo[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (
      typeof p.instrumentId === "string" &&
      typeof p.instrumentName === "string" &&
      typeof p.barCount === "number"
    ) {
      out.push({
        instrumentId: p.instrumentId,
        instrumentName: p.instrumentName,
        barCount: p.barCount,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// v1.14 Stage 1: Teaching panel -> real Teaching tool bridge
// ---------------------------------------------------------------------------

/** Store-facing teaching config. userLevel is already the agent enum: the UI
 *  side only knows "professional", which the caller maps to agent "expert"
 *  before invoking this action (see mapUiLevelToAgent). */
export interface TeachingConfigInput {
  diffId: string;
  userLevel: "beginner" | "intermediate" | "advanced" | "expert";
  compareWithAlt?: boolean;
}

/** UI-facing alternative approach produced by the Teaching agent. Structural
 *  mirror of the TeachingPanel's AlternativeApproach (the agent's
 *  `description` becomes `name`). */
export interface UiAlternativeApproach {
  name: string;
  pros: string[];
  cons: string[];
}

/** UI-facing explanation produced by the Teaching agent. Structural mirror of
 *  the TeachingPanel's ExplanationSection plus its alternatives, so App.tsx
 *  can hand `explanation` straight to the panel. */
export interface UiExplanation {
  title: string;
  overview: string;
  detail: string;
  conceptTags: string[];
  examples: string[];
  alternatives: UiAlternativeApproach[];
}

/** Parsed outcome of a real Teaching run (teaching.explainDecision tool).
 *  `explanation` is the agent-side Explanation converted to the UI
 *  UiExplanation shape (see convertAgentExplanation); on failure it is the
 *  EMPTY_UI_EXPLANATION so consumers only need to branch on status. */
export interface TeachingRunResult {
  status: "ok" | "error";
  explanation: UiExplanation;
  confidence: number | undefined;
  raw: unknown;
}

/** Empty explanation surfaced on tool failure / malformed payload so the
 *  TeachingPanel never has to render a half-built explanation. */
export const EMPTY_UI_EXPLANATION: UiExplanation = {
  title: "",
  overview: "",
  detail: "",
  conceptTags: [],
  examples: [],
  alternatives: [],
};

/**
 * Maps the UI-side UserLevel to the agent's UserLevel enum. The UI exposes
 * four levels ending in "professional", while the agent only knows four
 * levels ending in "expert", so professional -> expert and everything else
 * passes through unchanged. Unknown values fall back to "intermediate" (the
 * agent's default) so a future UI level can never crash the tool call.
 */
export function mapUiLevelToAgent(
  level: unknown
): TeachingConfigInput["userLevel"] {
  if (level === "professional") return "expert";
  if (
    level === "beginner" ||
    level === "intermediate" ||
    level === "advanced"
  ) {
    return level;
  }
  return "intermediate";
}

/**
 * Converts ONE agent-side AlternativeApproach (teaching-agent.ts) to the UI
 * UiAlternativeApproach shape. `description` becomes `name`; `example` is
 * dropped (the UI panel does not render it). Returns null when the payload is
 * not a valid alternative object.
 */
export function convertAgentAlternative(
  raw: unknown
): UiAlternativeApproach | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.description !== "string") return null;
  return {
    name: a.description,
    pros: Array.isArray(a.pros)
      ? a.pros.filter((p): p is string => typeof p === "string")
      : [],
    cons: Array.isArray(a.cons)
      ? a.cons.filter((c): c is string => typeof c === "string")
      : [],
  };
}

/**
 * Converts the raw `data` payload of the teaching.explainDecision tool into
 * the UI UiExplanation shape. Field mapping (agent -> UI):
 *   title        -> title
 *   summary      -> overview
 *   detail       -> detail
 *   concepts     -> conceptTags
 *   alternatives -> alternatives (description -> name; example dropped)
 *   level        -> NOT written back (the UI explanation has no level field)
 * Returns null when the payload is not a valid explanation object, so the
 * caller can fall back to EMPTY_UI_EXPLANATION instead of crashing.
 */
export function convertAgentExplanation(raw: unknown): UiExplanation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (
    typeof e.title !== "string" ||
    typeof e.summary !== "string" ||
    typeof e.detail !== "string"
  ) {
    return null;
  }
  return {
    title: e.title,
    overview: e.summary,
    detail: e.detail,
    conceptTags: Array.isArray(e.concepts)
      ? e.concepts.filter((c): c is string => typeof c === "string")
      : [],
    examples: Array.isArray(e.examples)
      ? e.examples.filter((x): x is string => typeof x === "string")
      : [],
    alternatives: Array.isArray(e.alternatives)
      ? e.alternatives
          .map(convertAgentAlternative)
          .filter((a): a is UiAlternativeApproach => a !== null)
      : [],
  };
}

/**
 * Semantic mapping from the agent-side collision types (EngravingAgent's
 * CollisionWarning in @collinx/agent) to the UI-side ScorePanel collision
 * types. The agent emits six fine-grained categories while the UI panel only
 * knows four visual categories, so several agent types converge onto one UI
 * type:
 *
 * | agent type              | UI type                 | rationale                          |
 * |-------------------------|-------------------------|------------------------------------|
 * | overlap                 | symbol_overlap          | 音符/符号重叠                      |
 * | accidental_conflict     | symbol_overlap          | 临时记号冲突也是符号重叠           |
 * | voice_crossing          | slur_cross              | 声部/线条交叉冲突                  |
 * | spacing                 | articulation_conflict   | 间距/符干问题归类为发音法冲突      |
 * | stem_direction          | articulation_conflict   | 符干方向即发音法排版               |
 * | range_violation         | dynamic_clash           | 音域越界属演奏层面冲突             |
 *
 * Unknown types fall back to symbol_overlap (defensive; the agent type union
 * is closed, so this is only reachable with hand-crafted payloads).
 */
export const AGENT_TYPE_TO_UI_TYPE: Record<string, UiCollisionWarning["type"]> = {
  voice_crossing: "slur_cross",
  range_violation: "dynamic_clash",
  overlap: "symbol_overlap",
  spacing: "articulation_conflict",
  stem_direction: "articulation_conflict",
  accidental_conflict: "symbol_overlap",
};

/**
 * Severity mapping: the agent also emits "info"; the UI panel only knows
 * "warning" / "error", so info is escalated to warning.
 */
export function mapAgentSeverity(
  severity: unknown
): UiCollisionWarning["severity"] {
  if (severity === "error") return "error";
  return "warning"; // "warning" | "info" | unknown -> warning
}

/**
 * Converts ONE agent-side collision payload (from the
 * engraving.reportCollisions tool) to the UI UiCollisionWarning shape.
 * Returns null when the payload is not a valid collision object. fix -> 
 * fixSuggestion, severity info -> warning, staveIndex defaults to 0 (the agent
 * collisions carry no stave information).
 */
export function convertAgentCollision(raw: unknown): UiCollisionWarning | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.bar !== "number" ||
    typeof c.beat !== "number" ||
    typeof c.description !== "string"
  ) {
    return null;
  }
  const typeName = typeof c.type === "string" ? c.type : "";
  return {
    type: AGENT_TYPE_TO_UI_TYPE[typeName] ?? "symbol_overlap",
    staveIndex: 0,
    bar: c.bar,
    beat: c.beat,
    description: c.description,
    severity: mapAgentSeverity(c.severity),
    fixSuggestion:
      typeof c.fix === "string" && c.fix.length > 0
        ? c.fix
        : DEFAULT_FIX_SUGGESTION,
  };
}

/**
 * Converts the raw `collisions` payload of the engraving.reportCollisions tool
 * into UI-shaped UiCollisionWarning[]. Non-object / malformed entries are
 * dropped so a partially malformed tool payload cannot crash the panel.
 */
export function convertAgentCollisions(data: unknown): UiCollisionWarning[] {
  if (!Array.isArray(data)) return [];
  const out: UiCollisionWarning[] = [];
  for (const item of data) {
    const converted = convertAgentCollision(item);
    if (converted) out.push(converted);
  }
  return out;
}

export interface ProjectStoreActions {
  applyDiff: (diff: DiffEnvelope) => string;
  /** v2.8.0：设置/删除某小节的和弦（Chord Track 用；graph-native） */
  setChord: (bar: number, chord: { root: string; quality: string; bass?: string } | null) => void;
  rejectDiff: (diffId: string) => void;
  rollbackDiff: (rollbackToken: string) => void;
  addNote: (note: NoteEvent) => void;
  /** v2.6.0：创建乐段（空编排的起点卡片 / 曲式模板都走它） */
  addPhrase: (phrase: {
    name: string;
    formRole: string;
    startBar: number;
    endBar: number;
  }) => void;
  /** v2.2.0 S1 (D22-4)：批量新增（录制 take 落盘；一条 undo 记录） */
  addNotes: (notes: NoteEvent[]) => void;
  /** v2.1.0 S3 (D13-1)：设置 bar 处速度（bpm）——TransportBar 的 BPM 控件消费 */
  setTempo: (bar: number, bpm: number) => void;
  /** v2.1.0 S3 (D13-1)：设置 bar 处拍号——TransportBar 的拍号选择器消费 */
  setMeter: (bar: number, numerator: number, denominator: number) => void;
  moveNote: (id: string, bar: number, beat: number, pitch: number) => void;
  resizeNote: (id: string, durQn: number) => void;
  deleteNote: (id: string) => void;
  updateMixerTrack: (trackId: string, changes: Partial<MixerTrack>) => void;
  applyMixerDiff: (diff: DiffEnvelope) => void;
  revertMixerTo: (prevMixer: MixerState) => void;
  addMixerTrack: (name: string, sourceId: string) => void;
  /** v2.9.0：删除混音轨（级联删该轨音符，可 undo） */
  removeMixerTrack: (trackId: string) => void;
  /**
   * Stage 2: generate a Mixing Agent mix proposal and enqueue it into
   * pendingDiffs.
   * v1.15 Stage 1: `trackId` is optional. When given, only that track
   * receives a single-track FX chain proposal; without it the full-mix
   * proposal (all tracks + master) is generated as before (backwards
   * compatible).
   */
  suggestMixingChain: (trackId?: string) => void;
  /**
   * Stage 0: run the real Orchestrator agent through the ToolRegistry
   * (orchestrator.voicingPlan). Real conflict detection is returned for the
   * panel; proposal diffs (DiffEnvelope[]) are enqueued into pendingDiffs for
   * Agent-panel review. Resolves to an OrchestratorRunResult, never throws
   * (ToolRegistry.call surfaces handler failures as status: "error").
   */
  runOrchestrator: (
    config: OrchestratorConfigInput,
    harmony?: HarmonyEntry[],
  ) => Promise<OrchestratorRunResult>;
  /**
   * Stage 1: run the real Arranger agent through the ToolRegistry
   * (arranger.expandSection). Real variants are returned for the panel;
   * proposal diffs (DiffEnvelope[]) are enqueued into pendingDiffs for
   * Agent-panel review. Resolves to an ArrangerRunResult, never throws
   * (ToolRegistry.call surfaces handler failures as status: "error").
   */
  runArranger: (config: ArrangerConfigInput) => Promise<ArrangerRunResult>;
  /**
   * v2.4.0 S4: 列出可供 LLM 调用的工具（OpenAI tools schema 的原料）。
   */
  listAgentTools: () => AgentToolDefinitionLike[];
  /**
   * v2.4.0 S4: AI 工具闭环入口。AgentChat 的 LLM 产出 tool_calls 后经此执行
   * 真实工具；提案 DiffEnvelope 入队 pendingDiffs，用户审批后才写入工程。
   * Resolves to an AgentToolOutcome, never throws.
   */
  runAgentTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<AgentToolOutcome>;
  /**
   * Stage 0 (v1.14): run the real Engraving agent through the ToolRegistry
   * (engraving.reportCollisions). Agent-side collisions are converted to the
   * UI UiCollisionWarning shape (see convertAgentCollisions); suggestions are
   * passed through. Resolves to an EngravingRunResult, never throws
   * (ToolRegistry.call surfaces handler failures as status: "error").
   */
  runEngraving: (layoutId: string) => Promise<EngravingRunResult>;
  /**
   * v1.15 Stage 0: run the real Engraving agent through the ToolRegistry
   * (engraving.extractParts). Extracted PartLayout payloads are returned as a
   * parts summary for the panel; proposal diffs (DiffEnvelope[]) are enqueued
   * into pendingDiffs for Agent-panel review. Resolves to an
   * ExtractPartsRunResult, never throws (ToolRegistry.call surfaces handler
   * failures as status: "error"). `layoutId` defaults when omitted.
   */
  runExtractParts: (layoutId?: string) => Promise<ExtractPartsRunResult>;
  /**
   * v1.14 Stage 1: run the real Teaching agent through the ToolRegistry
   * (teaching.explainDecision). The agent-side Explanation is converted to the
   * UI UiExplanation shape (see convertAgentExplanation); `userLevel` is
   * already mapped from the UI enum (professional -> expert, see
   * mapUiLevelToAgent) before this action is called. Resolves to a
   * TeachingRunResult, never throws (ToolRegistry.call surfaces handler
   * failures as status: "error").
   */
  runTeaching: (config: TeachingConfigInput) => Promise<TeachingRunResult>;
  /**
   * v1.18.0 Stage 0: run the real Teaching agent through the ToolRegistry
   * (teaching.explainHarmony). `chordProgression` is one chord per element
   * (a hyphen-joined pitch-name sequence such as "E-G#-B"); `key` is the
   * "tonic mode" string from the graph meta key_map; `userLevel` is already
   * mapped from the UI enum (professional -> expert, see mapUiLevelToAgent).
   * The agent-side Explanation is converted to the UI UiExplanation shape (see
   * convertAgentExplanation). Resolves to a TeachingRunResult, never throws
   * (ToolRegistry.call surfaces handler failures as status: "error").
   */
  runTeachingHarmony: (
    chordProgression: string[],
    key: string,
    userLevel: TeachingConfigInput["userLevel"]
  ) => Promise<TeachingRunResult>;
  /**
   * Stage 2: record an applied (or arbitrary) Agent decision as a graph
   * evidence node so the Knowledge Graph can show the decision rationale.
   * APPLY_DIFF also records agent diffs automatically; this action makes the
   * same trace available on demand.
   */
  recordDecisionEvidence: (diff: DiffEnvelope) => void;
  updateTasteParameter: (paramKey: string, value: string) => void;
  revertTasteTo: (version: number) => void;
  deleteTasteEvidence: (paramKey: string, evidenceId: string) => void;
  /** Stage 2: pop the undo stack and restore the previous state. No-op when
   *  the stack is empty. The current state is pushed onto the redo stack. */
  undo: () => void;
  /** Stage 2: pop the redo stack and re-apply an undone state. No-op when
   *  the stack is empty. The current state is pushed onto the undo stack. */
  redo: () => void;
  /**
   * Stage 0: append an Agent tool-call record. id and timestamp are minted by
   * the caller of createToolCallRecord; records beyond MAX_TOOL_CALLS drop the
   * oldest entry.
   */
  recordToolCall: (record: NewToolCallRecord) => void;
  /** Stage 0: empty the tool-call trace. */
  clearToolCalls: () => void;
  /**
   * Stage 0 (.agentmusic): collect the full project state into AgentMusicData,
   * serialize via AgentMusicIO, and download it as `project.agentmusic`
   * (Blob, application/octet-stream). Resolves when the download is triggered.
   */
  saveProjectAsAgentMusic: () => Promise<void>;
  /**
   * v1.16.0 Stage 1: serialize the current notes (derived from the graph) into
   * a Standard MIDI File via core MIDIExporter and download it as
   * `project.mid` (Blob, audio/midi).
   */
  exportMIDI: () => Promise<void>;
  /**
   * v1.16.0 Stage 1: render the current score layout + notes into a PDF via
   * core PDFExporter (browser-safe exportToPDFBytes) and download it as
   * `project.pdf` (Blob, application/pdf). When no layout is given a minimal
   * default layout is used.
   */
  exportPDF: (layout?: Layout) => Promise<void>;
  /**
   * Stage 0 (.agentmusic): read a `.agentmusic` File, deserialize via
   * AgentMusicIO, and restore the project state through restoreFromAgentMusicData.
   * Corrupt files reject with the underlying Error (caller surfaces it to the UI).
   */
  loadProjectFromAgentMusic: (file: File) => Promise<void>;
  /**
   * Stage 0 (.agentmusic load): replace the whole ProjectGraph (notes re-derived).
   * Used by restoreFromAgentMusicData instead of bypassing the reducer.
   */
  replaceGraph: (graph: ProjectGraph) => void;
  /**
   * Stage 0 (.agentmusic load): restore the taste genome + version history onto
   * the shared TasteStore. genome === null keeps the current taste.
   */
  restoreTaste: (genome: TasteGenomeData | null, versions: GenomeVersionEntry[]) => void;
  /**
   * v1.17.0 Stage 0 (.agentmusic load): rebuild the applied-diff history so
   * historical diffs remain rollback-able after a load. The provider imports
   * the rollback snapshots into the shared DiffEngine before dispatching.
   */
  restoreDiffHistory: (
    appliedDiffs: DiffEnvelope[],
    rollbackSnapshots: Record<string, string>
  ) => void;
  /**
   * v1.17.0 Stage 1: restore the latest autosave snapshot (crash recovery).
   * The user clicking the TopBar "restore autosave" entry is the explicit
   * confirmation. Parses the slot payload, routes through
   * restoreFromAgentMusicData (same restore path as .agentmusic file load),
   * then clears the autosave slots + the pending-recovery hint. Resolves
   * silently when no recovery snapshot is pending or the payload is corrupt.
   */
  restoreFromAutosave: () => Promise<void>;
}

export interface PersistenceStatus {
  /** Whether cross-refresh persistence is enabled for this provider. */
  enabled: boolean;
  /** ISO timestamp of the last successful localStorage write, or null when
   *  nothing has been persisted yet. */
  lastSavedAt: string | null;
}

/**
 * v1.17.0 Stage 1: pending crash-recovery snapshot info. Non-null when an
 * autosave snapshot is newer than the localStorage-persisted state at mount
 * (i.e. the browser likely crashed before the debounced main save ran). The
 * TopBar surfaces a "restore autosave" entry while this is set.
 */
export interface AutosaveRecoveryInfo {
  /** ISO timestamp of the autosave snapshot (slot-level savedAt). */
  savedAt: string;
}

export interface ProjectStoreValue extends ProjectStoreState {
  actions: ProjectStoreActions;
  bus: AgentBus;
  /** Stage 1: cross-refresh persistence indicator. */
  persistence: PersistenceStatus;
  /** v1.17.0 Stage 1: pending autosave crash-recovery snapshot, or null. */
  autosaveRecovery: AutosaveRecoveryInfo | null;
}

export const ProjectStoreContext = createContext<ProjectStoreValue | null>(null);

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

function deriveNotes(graph: ProjectGraph): NoteEvent[] {
  return graph
    .getNodesByType("NoteSpan")
    .map((n) => nodeToNoteEvent(n.data))
    .filter((n) => typeof n.id === "string" && typeof n.trackId === "string")
    .sort(
      (a, b) =>
        a.bar - b.bar || a.beat - b.beat || a.pitchMidi - b.pitchMidi
    );
}

function findNoteNode(graph: ProjectGraph, noteId: string) {
  return graph
    .getNodesByType("NoteSpan")
    .find((n) => n.data?.id === noteId);
}

// ---------------------------------------------------------------------------
// Mixer diff helpers
// ---------------------------------------------------------------------------

/**
 * Synthetic base revision for mixer diffs. The mixer lives as store-local
 * state (not a ProjectGraph node), so diffs are anchored to a stable
 * sentinel instead of a graph revision.
 */
const MIXER_DIFF_BASE_REVISION = "mixer://state-v1";

/**
 * Detects a "mixer diff": a DiffEnvelope whose ops live in the synthetic
 * `/tracks/<id>` namespace with payloads in the MixerChange shape produced by
 * mixerToDiff. These must be applied to the mixer via diffToMixer instead of
 * the ProjectGraph DiffEngine, which knows nothing about mixer state.
 */
export function isMixerDiff(diff: DiffEnvelope): boolean {
  return (
    diff.ops.length > 0 &&
    diff.ops.every(
      (op) =>
        op.op === "update_node" &&
        op.path.startsWith("/tracks/") &&
        typeof op.data.trackId === "string",
    )
  );
}

/**
 * Computes MixerChange[] between two mixer states. computeMixerDiff only
 * covers `tracks`; we additionally diff the masterTrack so master fader
 * edits are captured by the audit trail too.
 */
function computeMixerChanges(
  prev: MixerState,
  next: MixerState
): {
  trackId: string;
  changes: Partial<Pick<MixerTrack, "gainDb" | "pan" | "mute" | "solo">>;
}[] {
  const changes = computeMixerDiff(prev, next);
  const masterChanges: Partial<Pick<MixerTrack, "gainDb" | "pan" | "mute" | "solo">> = {};
  if (prev.masterTrack.gainDb !== next.masterTrack.gainDb)
    masterChanges.gainDb = next.masterTrack.gainDb;
  if (prev.masterTrack.pan !== next.masterTrack.pan)
    masterChanges.pan = next.masterTrack.pan;
  if (prev.masterTrack.mute !== next.masterTrack.mute)
    masterChanges.mute = next.masterTrack.mute;
  if (prev.masterTrack.solo !== next.masterTrack.solo)
    masterChanges.solo = next.masterTrack.solo;
  if (Object.keys(masterChanges).length > 0) {
    changes.push({ trackId: next.masterTrack.id, changes: masterChanges });
  }
  return changes;
}

/**
 * Applies a mixer diff together with a pre-apply mixer snapshot registered
 * under the diff's rollbackToken, so a later ROLLBACK_DIFF can restore the
 * mixer to its pre-proposal state.
 *
 * Diffs without a rollbackToken are applied without a snapshot: every
 * envelope minted by createDiffEnvelope (mixerToDiff, MixingAgent) carries
 * one, and the Agent Panel can only roll back via the token already stored on
 * the envelope — a token generated here would be unreachable from the UI.
 * Minting one would also make the reducer non-deterministic (StrictMode
 * double-invokes reducers in dev), so we skip instead.
 */
function withMixerSnapshot(
  state: ProjectStoreState,
  diff: DiffEnvelope,
  patch: Partial<ProjectStoreState>
): ProjectStoreState {
  if (!diff.rollbackToken) {
    return { ...state, ...patch };
  }
  return {
    ...state,
    ...patch,
    mixerRollbackSnapshots: {
      ...state.mixerRollbackSnapshots,
      [diff.rollbackToken]: structuredClone(state.mixer),
    },
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** Stage 0: hard cap on the in-store tool-call trace (FIFO eviction). */
export const MAX_TOOL_CALLS = 100;

export interface CreateInitialStateParams {
  title?: string;
  /** Restored graph (Stage 1 persistence). When supplied, initialNotes is
   *  ignored: notes are derived from the restored graph instead. */
  graph?: ProjectGraph;
  initialNotes?: NoteEvent[];
  pendingDiffs?: DiffEnvelope[];
  /** Restored applied-diff history (Stage 1 persistence). */
  appliedDiffs?: DiffEnvelope[];
  mixer?: MixerState;
  tasteStore?: TasteStore;
  /** v2.9.3：撤销栈上限（来自设置；缺省 MAX_UNDO） */
  undoLimit?: number;
}

/**
 * Stage 0 (v2.1.0): tempo/meter are a DERIVED PROJECTION of graph.meta —
 * graph.meta is the single source of truth (the .agentmusic file and every
 * getMeta() consumer read the same data). EVERY code path that installs a new
 * graph into the state must re-derive the projection through this helper so
 * the two can never drift apart.
 */
function deriveTempoProjection(graph: ProjectGraph): {
  tempoChanges: TempoChange[];
  meterChanges: MeterChange[];
} {
  const meta = graph.getMeta();
  return {
    tempoChanges: meta.tempo_map,
    meterChanges: meta.meter_map,
  };
}

export function createInitialState(
  params: CreateInitialStateParams = {}
): ProjectStoreState {
  const graph =
    params.graph ?? ProjectGraph.create(params.title ?? "Untitled Project");
  if (!params.graph) {
    for (const note of params.initialNotes ?? []) {
      graph.addNode("NoteSpan", { ...note });
    }
  }
  return {
    graph,
    notes: deriveNotes(graph),
    pendingDiffs: params.pendingDiffs ?? [],
    appliedDiffs: params.appliedDiffs ?? [],
    rejectedDiffs: [],
    rollbackTokens: [],
    mixer: params.mixer ?? createDemoMixer(),
    mixerDiffLog: [],
    mixerRollbackSnapshots: {},
    // Browser builds inject the localStorage-backed fs adapter so TasteStore
    // never touches Node's fs module; callers in a Node test environment can
    // pass their own tasteStore (or rely on the memory-mode default).
    tasteStore: params.tasteStore ?? createTasteStore(createBrowserTasteFsAdapter()),
    genomeVersion: 0,
    toolCalls: [],
    undoStack: [],
    redoStack: [],
    undoLimit: resolveUndoLimit(params.undoLimit),
    // Stage 0 (v2.1.0): tempo/meter are a DERIVED PROJECTION of graph.meta
    // (the single source of truth) — see deriveTempoProjection.
    ...deriveTempoProjection(graph),
  };
}

// ---------------------------------------------------------------------------
// Undo/redo helpers (Stage 2)
// ---------------------------------------------------------------------------

/**
 * Captures the undoable parts of the current state as an immutable snapshot.
 * The graph is serialized to JSON (ProjectGraph is mutable, so holding a
 * reference would let later edits corrupt past undo steps); the mixer and
 * diff envelopes are deep-cloned so snapshots never share mutable memory with
 * the live state.
 */
export function snapshotProjectStore(
  state: ProjectStoreState
): ProjectStoreSnapshot {
  return {
    graphJson: serializeGraph(state.graph),
    mixer: structuredClone(state.mixer),
    pendingDiffs: state.pendingDiffs.map((d) => structuredClone(d)),
    appliedDiffs: state.appliedDiffs.map((d) => structuredClone(d)),
    rollbackTokens: [...state.rollbackTokens],
    mixerDiffLog: state.mixerDiffLog.map((d) => structuredClone(d)),
    mixerRollbackSnapshots: structuredClone(state.mixerRollbackSnapshots),
    genome: state.tasteStore.getCurrentGenome()?.toJSON() ?? null,
    genomeVersion: state.genomeVersion,
  };
}

/**
 * Restores the undoable parts of a snapshot onto the given state. The
 * tasteStore instance and toolCalls are carried over from `state` unchanged
 * (the genome *values* are restored onto the TasteStore by the provider's
 * action creators, which own the mutable instance; tool calls are not user
 * edits). Notes AND tempo/meter are re-derived from the restored graph so the
 * graph and its projections can never drift apart — graph.meta is the single
 * source of truth, including across undo/redo.
 */
function restoreProjectSnapshot(
  state: ProjectStoreState,
  snap: ProjectStoreSnapshot
): ProjectStoreState {
  const graph = deserializeGraph(snap.graphJson);
  return {
    ...state,
    graph,
    notes: deriveNotes(graph),
    mixer: structuredClone(snap.mixer),
    pendingDiffs: snap.pendingDiffs.map((d) => structuredClone(d)),
    appliedDiffs: snap.appliedDiffs.map((d) => structuredClone(d)),
    rollbackTokens: [...snap.rollbackTokens],
    mixerDiffLog: snap.mixerDiffLog.map((d) => structuredClone(d)),
    mixerRollbackSnapshots: structuredClone(snap.mixerRollbackSnapshots),
    genomeVersion: snap.genomeVersion,
    // Derived projection of graph.meta (single source of truth).
    ...deriveTempoProjection(graph),
  };
}

/**
 * Wraps an undoable edit: pushes a snapshot of the PRE-edit state onto the
 * undo stack (capped at MAX_UNDO, oldest evicted) and clears the redo stack,
 * because any new edit invalidates the redo history.
 *
 * `genomeOverride`, when provided, replaces the snapshot's recorded genome.
 * Taste action creators mutate the shared TasteStore before dispatching, so
 * snapshotProjectStore(state) would otherwise capture the post-edit genome
 * (the pre-edit genome is only known to the action creator).
 */
function withUndo(
  state: ProjectStoreState,
  patch: Partial<ProjectStoreState>,
  genomeOverride?: TasteGenomeData | null
): ProjectStoreState {
  const next = { ...state, ...patch };
  const undoSnapshot =
    genomeOverride !== undefined
      ? { ...snapshotProjectStore(state), genome: genomeOverride }
      : snapshotProjectStore(state);
  // Stage 0 (v2.1.0): tempo/meter are a derived projection of graph.meta.
  // Re-derive from whichever graph the patch produced (or the live graph if
  // the patch left it untouched) so the projection can never drift from the
  // authoritative graph.
  const graph = patch.graph ?? state.graph;
  return {
    ...next,
    undoStack: [...state.undoStack, undoSnapshot].slice(-state.undoLimit),
    redoStack: [],
    ...deriveTempoProjection(graph),
  };
}

// ---------------------------------------------------------------------------
// Decision evidence helpers (Stage 2: evidenceRefs -> graph node)
// ---------------------------------------------------------------------------

/** Node type used to materialize an Agent decision in the Knowledge Graph. */
export const DECISION_EVIDENCE_NODE_TYPE = "AgentDecision" as const;

/** Edge type linking a decision evidence node to the node(s) it affects. */
export const DECISION_EVIDENCE_EDGE_TYPE = "suggested_by_agent" as const;

/**
 * Collects the node/entity references a diff's ops touch, best-effort:
 * explicit node ids from update/remove ops, both endpoints of add_edge ops,
 * note ids from add_note_group ops, and mixer track ids embedded in the
 * payloads of /tracks/<id> update ops.
 */
function collectEvidenceTargetRefs(diff: DiffEnvelope): string[] {
  const refs: string[] = [];
  for (const op of diff.ops) {
    switch (op.op) {
      case "update_node":
        refs.push(op.nodeId);
        // Mixer diffs carry the affected track id in the payload.
        if (typeof op.data?.trackId === "string") refs.push(op.data.trackId);
        break;
      case "remove_node":
        refs.push(op.nodeId);
        break;
      case "add_edge":
        refs.push(op.sourceId, op.targetId);
        break;
      case "add_note_group":
        for (const note of op.notes) refs.push(note.id);
        break;
      default:
        break;
    }
  }
  return refs;
}

/**
 * Resolves collected refs to node ids that actually exist in the graph.
 * Direct id lookup first, then a data-ref fallback so refs such as note ids
 * or mixer track ids (stored in node.data) still link to their graph node.
 */
function resolveEvidenceTargets(graph: ProjectGraph, refs: string[]): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const allNodes = graph.getAllNodes();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (graph.getNode(ref)) {
      targets.push(ref);
      continue;
    }
    const match = allNodes.find((n) => {
      const data = (n.data ?? {}) as Record<string, unknown>;
      return data.id === ref || data.trackId === ref;
    });
    if (match) targets.push(match.id);
  }
  return targets;
}

/**
 * Returns a new graph carrying an AgentDecision evidence node for the diff,
 * plus suggested_by_agent edges from that node to every affected target that
 * exists in the graph. When no target can be resolved the evidence node is
 * still recorded (no edges).
 */
function addDecisionEvidence(
  graph: ProjectGraph,
  diff: DiffEnvelope
): ProjectGraph {
  const next = graph.snapshot();
  const node = next.addNode(DECISION_EVIDENCE_NODE_TYPE, {
    diffId: diff.diffId,
    actor: diff.actor,
    summary: diff.summary,
    domainExplanations: diff.domainExplanations,
    evidenceRefs: diff.evidenceRefs,
    appliedAt: new Date().toISOString(),
  });
  for (const targetId of resolveEvidenceTargets(
    next,
    collectEvidenceTargetRefs(diff)
  )) {
    next.addEdge(DECISION_EVIDENCE_EDGE_TYPE, node.id, targetId, {
      diffId: diff.diffId,
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function createProjectReducer(
  diffEngine: DiffEngine
): (state: ProjectStoreState, action: ProjectStoreAction) => ProjectStoreState {
  return function projectReducer(
    state: ProjectStoreState,
    action: ProjectStoreAction
  ): ProjectStoreState {
    switch (action.type) {
      case "APPLY_DIFF": {
        // v2.5.0：幂等守卫。同一 diffId 已在 appliedDiffs 中说明它已被应用过 ——
        // 重复派发（用户连点"应用"、或"全部应用"里含已应用项）必须被忽略，
        // 否则会重复记录（已应用计数 +2）并产生重复的 React key。
        if (state.appliedDiffs.some((d) => d.diffId === action.diff.diffId)) {
          return state;
        }
        // Mixer diffs (ops in the synthetic /tracks/<id> namespace with
        // MixerChange payloads) apply to the mixer state, not the
        // ProjectGraph. Route them through diffToMixer so the graph diff
        // chain keeps using the DiffEngine unchanged.
        if (isMixerDiff(action.diff)) {
          const nextMixer = diffToMixer(action.diff, state.mixer);
          const wasPending = state.pendingDiffs.some(
            (d) => d.diffId === action.diff.diffId,
          );
          // Agent decisions leave an evidence trace in the graph even when
          // the diff itself only touched the mixer state.
          const graph =
            action.diff.actor.type === "agent"
              ? addDecisionEvidence(state.graph, action.diff)
              : state.graph;
          return withUndo(
            state,
            withMixerSnapshot(state, action.diff, {
              graph,
              mixer: nextMixer,
              pendingDiffs: wasPending
                ? state.pendingDiffs.filter(
                    (d) => d.diffId !== action.diff.diffId,
                  )
                : state.pendingDiffs,
              appliedDiffs: [...state.appliedDiffs, action.diff],
              mixerDiffLog: [...state.mixerDiffLog, action.diff],
            })
          );
        }

        // v2.5.0：应用时把 baseRevision 对齐到"当前"图 revision。否则连续应用
        // 多条提案（或"全部应用"）时，第一条之后 revision 已改变，后续提案会被
        // DiffEngine 的 baseRevision 校验直接拒绝（用户看到"只有第一条能应用"）。
        const result = diffEngine.apply(
          { ...action.diff, baseRevision: state.graph.getRevisionId() },
          state.graph,
        );
        // Stage 2: materialize the Agent decision as an evidence node so the
        // Knowledge Graph can show why this diff was proposed. Non-agent diffs
        // (user/system) are still applied but leave no trace node.
        const graph =
          action.diff.actor.type === "agent"
            ? addDecisionEvidence(result.graph, action.diff)
            : result.graph;
        return withUndo(state, {
          graph,
          notes: deriveNotes(graph),
          pendingDiffs: state.pendingDiffs.filter(
            (d) => d.diffId !== action.diff.diffId
          ),
          appliedDiffs: [...state.appliedDiffs, action.diff],
          rollbackTokens: [...state.rollbackTokens, result.rollbackToken],
        });
      }

      case "ADD_PENDING_DIFFS":
        return {
          ...state,
          pendingDiffs: [...state.pendingDiffs, ...action.diffs],
        };

      case "REJECT_DIFF": {
        // v2.5.0：拒绝的提案单独留痕。此前它只是从 pendingDiffs 里消失，
        // 导致 Agent 面板的"已拒绝"计数恒为 0（loop-tester 报告）。
        const rejected = state.pendingDiffs.filter((d) => d.diffId === action.diffId);
        return withUndo(state, {
          pendingDiffs: state.pendingDiffs.filter(
            (d) => d.diffId !== action.diffId
          ),
          rejectedDiffs: [...state.rejectedDiffs, ...rejected],
        });
      }

      case "RECORD_DECISION_EVIDENCE": {
        // Explicit trace: record an applied (or arbitrary) diff as an
        // evidence node on demand. Notes are unaffected (evidence nodes are
        // never NoteSpans), so only the graph needs to be replaced.
        const graph = addDecisionEvidence(state.graph, action.diff);
        return { ...state, graph };
      }

      case "ROLLBACK_DIFF": {
        // Mixer diffs never touch the DiffEngine, so their rollback token
        // lives in mixerRollbackSnapshots. Restore the mixer and drop the
        // snapshot; the graph is left untouched.
        const mixerSnapshot =
          state.mixerRollbackSnapshots[action.rollbackToken];
        if (mixerSnapshot) {
          const snapshots = { ...state.mixerRollbackSnapshots };
          delete snapshots[action.rollbackToken];
          // v2.5.0：与 graph 分支一致 —— 回滚的混音提案放回待审批队列
          const rolledBackMixer = state.appliedDiffs.find(
            (d) => d.rollbackToken === action.rollbackToken
          );
          return {
            ...state,
            mixer: mixerSnapshot,
            mixerRollbackSnapshots: snapshots,
            appliedDiffs: state.appliedDiffs.filter(
              (d) => d.rollbackToken !== action.rollbackToken
            ),
            mixerDiffLog: state.mixerDiffLog.filter(
              (d) => d.rollbackToken !== action.rollbackToken
            ),
            pendingDiffs: rolledBackMixer
              ? [...state.pendingDiffs, rolledBackMixer]
              : state.pendingDiffs,
          };
        }

        let graph: ProjectGraph;
        try {
          graph = diffEngine.rollback(state.graph, action.rollbackToken);
        } catch {
          // Unknown/expired token: keep the current graph untouched.
          return state;
        }
        // v2.5.0：回滚后把该提案放回待审批队列。此前它既不在 appliedDiffs
        // 也不在 pendingDiffs 里 —— 用户回滚后无法再应用它（loop-tester 报）。
        const rolledBack = state.appliedDiffs.find(
          (d) => d.rollbackToken === action.rollbackToken
        );
        return {
          ...state,
          graph,
          notes: deriveNotes(graph),
          // S0-D2: the rollback restored graph.meta from the pre-diff
          // snapshot, so the tempo/meter projection MUST be re-derived from
          // the restored graph here — this path returns directly (no
          // withUndo) and would otherwise drift from graph.meta.
          ...deriveTempoProjection(graph),
          appliedDiffs: state.appliedDiffs.filter(
            (d) => d.rollbackToken !== action.rollbackToken
          ),
          rollbackTokens: state.rollbackTokens.filter(
            (t) => t !== action.rollbackToken
          ),
          pendingDiffs: rolledBack
            ? [...state.pendingDiffs, rolledBack]
            : state.pendingDiffs,
        };
      }

      /**
       * 设置某小节的和弦（v2.8.0 Chord Track）。
       *
       * graph-native：写 ChordEvent 节点，与 ADD_PHRASE 同一模式。
       * 同一 bar 只保留一个和弦 —— 先清掉该 bar 的旧 ChordEvent 再写，
       * 避免"同一小节两个和弦"这种图里合法但语义混乱的状态。
       * chord 传 null 表示删除该小节的和弦。
       */
      case "SET_CHORD": {
        /**
         * v2.9.1：写和弦的同时生成真实音符（此前只有 ChordEvent → 只画不响）。
         *
         * 生成物打 `chordGenerated: true`，这样重设和弦时只替换**和弦轨生成的
         * 音符**，不会误删用户自己在和弦轨上手画的声部。
         */
        const graph = state.graph.snapshot();
        for (const n of graph.getAllNodes()) {
          if (n.type === "ChordEvent" && Number(n.data.bar) === action.bar) {
            graph.removeNode(n.id);
          }
          if (
            n.type === "NoteSpan" &&
            n.data.chordGenerated === true &&
            Number(n.data.bar) === action.bar
          ) {
            graph.removeNode(n.id);
          }
        }
        if (action.chord) {
          graph.addNode("ChordEvent", {
            bar: action.bar,
            beat: 1,
            durationQn: 4,
            chord: action.chord,
          });
          for (const pitchMidi of chordPitches(action.chord)) {
            // 用 createNoteEvent 生成完整 NoteEvent（id/phraseId/tags 都是
            // deriveNotes → NoteEventSchema 的必填项；手写对象会抛 Zod 校验错）
            const note = createNoteEvent({
              trackId: "chords",
              bar: action.bar,
              beat: 1,
              durQn: 4,
              pitchMidi,
              pitchSpelling: midiToSpelling(pitchMidi),
              velocity: 0.6,
              voice: "lh",
            });
            graph.addNode("NoteSpan", { ...note, chordGenerated: true });
          }
        }
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      case "ADD_PHRASE": {
        // v2.6.0：支持从「空编排」卡片直接创建乐段，让空白区变成可操作起点。
        // graph-native：写 Phrase 节点（不带音符），notes 投影不受影响。
        const graph = state.graph.snapshot();
        graph.addNode("Phrase", {
          name: action.name,
          formRole: action.formRole,
          startBar: action.startBar,
          endBar: action.endBar,
          motifIds: [],
        });
        return withUndo(state, { graph });
      }

      case "ADD_NOTE": {
        const graph = state.graph.snapshot();
        graph.addNode("NoteSpan", { ...action.note });
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      // v2.2.0 S1 (D22-4)：批量新增（实时录制 take 落盘）——一次 withUndo =
      // 一条 undo 记录，undo 一次撤整个 take。
      case "ADD_NOTES": {
        if (action.notes.length === 0) return state;
        const graph = state.graph.snapshot();
        for (const note of action.notes) {
          graph.addNode("NoteSpan", { ...note });
        }
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      case "MOVE_NOTE": {
        const graph = state.graph.snapshot();
        const node = findNoteNode(graph, action.id);
        if (!node) return state;
        node.data = {
          ...(node.data as Record<string, unknown>),
          bar: action.bar,
          beat: action.beat,
          pitchMidi: action.pitch,
          pitchSpelling: midiToSpelling(action.pitch),
        };
        node.updated_at = new Date().toISOString();
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      case "RESIZE_NOTE": {
        const graph = state.graph.snapshot();
        const node = findNoteNode(graph, action.id);
        if (!node) return state;
        node.data = {
          ...(node.data as Record<string, unknown>),
          durQn: action.durQn,
        };
        node.updated_at = new Date().toISOString();
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      case "DELETE_NOTE": {
        const graph = state.graph.snapshot();
        const node = findNoteNode(graph, action.id);
        if (!node) return state;
        graph.removeNode(node.id);
        return withUndo(state, { graph, notes: deriveNotes(graph) });
      }

      case "UPDATE_MIXER_TRACK": {
        const prevMixer = state.mixer;
        let nextMixer: MixerState;
        if (action.trackId === prevMixer.masterTrack.id) {
          nextMixer = {
            ...prevMixer,
            masterTrack: { ...prevMixer.masterTrack, ...action.changes },
          };
        } else {
          const target = prevMixer.tracks.find((t) => t.id === action.trackId);
          if (!target) return state;
          nextMixer = {
            ...prevMixer,
            tracks: prevMixer.tracks.map((t) =>
              t.id === action.trackId ? { ...t, ...action.changes } : t,
            ),
          };
        }

        // Record a DiffEnvelope in the audit trail when the edit is
        // representable as a MixerChange (gainDb/pan/mute/solo/fx/sends).
        const changes = computeMixerChanges(prevMixer, nextMixer);
        if (changes.length === 0) {
          return { ...state, mixer: nextMixer };
        }
        const envelope = mixerToDiff(changes, MIXER_DIFF_BASE_REVISION);
        const patch = {
          mixer: nextMixer,
          mixerDiffLog: [...state.mixerDiffLog, envelope],
        };
        // Stage 2: slider drags fire UPDATE_MIXER_TRACK at mousemove rate.
        // The action creator gates pushUndo (>= 500ms since the last undoable
        // mixer edit) so the undo stack coalesces a drag into one step instead
        // of flooding with dozens of intermediate values. Throttled edits
        // still mutate the mixer and the audit log, just without a new step.
        if (action.pushUndo === false) {
          return { ...state, ...patch };
        }
        return withUndo(state, patch);
      }

      case "APPLY_MIXER_DIFF": {
        const nextMixer = diffToMixer(action.diff, state.mixer);
        const wasPending = state.pendingDiffs.some(
          (d) => d.diffId === action.diff.diffId
        );
        return withUndo(
          state,
          withMixerSnapshot(state, action.diff, {
            mixer: nextMixer,
            pendingDiffs: wasPending
              ? state.pendingDiffs.filter(
                  (d) => d.diffId !== action.diff.diffId
                )
              : state.pendingDiffs,
            mixerDiffLog: [...state.mixerDiffLog, action.diff],
          })
        );
      }

      case "REVERT_MIXER_TO":
        return { ...state, mixer: action.mixer };

      case "ADD_MIXER_TRACK": {
        const track = createTrack(action.name, action.sourceId);
        // v2.9.4：新轨默认 FX 链来自设置（此前 defaultFXChain 设置不生效）。
        // 只接受合法 FXType；未知字符串直接丢弃，不造一个渲染不出来的槽。
        if (action.defaultFxTypes && action.defaultFxTypes.length > 0) {
          for (const type of action.defaultFxTypes) {
            if (FX_TYPES.includes(type)) addSlotToChain(track.fxChain, createFXSlot(type));
          }
        }
        return withUndo(state, {
          mixer: {
            ...state.mixer,
            tracks: [...state.mixer.tracks, track],
          },
        });
      }

      case "REMOVE_MIXER_TRACK": {
        // master 不可删；至少保留一条轨（否则混音台空掉且无法再选中任何轨）
        if (action.trackId === state.mixer.masterTrack.id) return state;
        const target = state.mixer.tracks.find((t) => t.id === action.trackId);
        if (!target) return state;
        if (state.mixer.tracks.length <= 1) return state;

        // 级联删该轨音符：音频侧按 note.trackId 分组，混音侧按 sourceTrackId，
        // 两个键都可能出现（旧工程 / 直接写条 id 的数据），故都匹配。
        const graph = state.graph.snapshot();
        const keys = new Set(
          [target.sourceTrackId, target.id].filter((k): k is string => typeof k === "string" && k.length > 0),
        );
        for (const node of graph.getNodesByType("NoteSpan")) {
          const trackId = (node.data as { trackId?: unknown }).trackId;
          if (typeof trackId === "string" && keys.has(trackId)) {
            graph.removeNode(node.id);
          }
        }

        const tracks = state.mixer.tracks.filter((t) => t.id !== action.trackId);
        const routingMatrix = Object.fromEntries(
          Object.entries(state.mixer.routingMatrix)
            .filter(([key]) => key !== target.id)
            .map(([key, targets]) => [key, targets.filter((id) => id !== target.id)]),
        );

        return withUndo(state, {
          graph,
          notes: deriveNotes(graph),
          mixer: { ...state.mixer, tracks, routingMatrix },
        });
      }

      case "TASTE_GENOME_CHANGED":
        // TasteStore mutations happen imperatively in the provider's action
        // creators (the instance is mutable), so the reducer only advances the
        // re-render counter. Keeping the reducer pure avoids double mutations
        // from StrictMode double-invoking reducers in dev. The undo snapshot
        // records the pre-edit genome via `beforeGenome` (Stage 2) so a later
        // undo() can restore the genome values onto the TasteStore.
        return withUndo(
          state,
          { genomeVersion: state.genomeVersion + 1 },
          action.beforeGenome
        );

      case "UNDO": {
        // Pop the newest undo snapshot and restore it. The current state is
        // pushed onto the redo stack so redo() can walk back forward. The
        // redo snapshot records the genome captured by the action creator
        // BEFORE it restored the undone snapshot's genome onto the TasteStore,
        // so a later redo re-applies the edited genome, not the restored one.
        if (state.undoStack.length === 0) return state;
        const snap = state.undoStack[state.undoStack.length - 1];
        const redoSnapshot = snapshotProjectStore(state);
        return {
          ...restoreProjectSnapshot(state, snap),
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [
            ...state.redoStack,
            action.redoGenome !== undefined
              ? { ...redoSnapshot, genome: action.redoGenome }
              : redoSnapshot,
          ].slice(-state.undoLimit),
        };
      }

      case "REDO": {
        if (state.redoStack.length === 0) return state;
        const snap = state.redoStack[state.redoStack.length - 1];
        const undoSnapshot = snapshotProjectStore(state);
        return {
          ...restoreProjectSnapshot(state, snap),
          undoStack: [
            ...state.undoStack,
            action.undoGenome !== undefined
              ? { ...undoSnapshot, genome: action.undoGenome }
              : undoSnapshot,
          ].slice(-state.undoLimit),
          redoStack: state.redoStack.slice(0, -1),
        };
      }

      case "RECORD_TOOL_CALL": {
        // v1.13 Stage 2: upsert by correlationId. A record whose correlationId
        // already exists in the trace is merged into the existing entry (only
        // status/resultSummary/params advance; id/timestamp/agentName/toolName
        // are preserved) so a running -> success pair renders as one card. The
        // provider mints id/timestamp before dispatching (via
        // createToolCallRecord), so this stays pure: map() builds a new array
        // and nothing is mutated in place. Records without a correlationId (or
        // whose match has already been evicted) are appended, keeping the
        // append-only contract. slice(-MAX_TOOL_CALLS) enforces the cap on
        // append; an in-place update cannot grow the array.
        const record = action.record;
        const matchIndex = record.correlationId
          ? state.toolCalls.findIndex(
              (c) => c.correlationId === record.correlationId
            )
          : -1;
        if (matchIndex === -1) {
          return {
            ...state,
            toolCalls: [...state.toolCalls, record].slice(-MAX_TOOL_CALLS),
          };
        }
        const existing = state.toolCalls[matchIndex];
        const merged: ToolCallRecord = {
          ...existing,
          status: record.status,
          resultSummary: record.resultSummary,
          params: record.params,
        };
        return {
          ...state,
          toolCalls: state.toolCalls.map((c, i) =>
            i === matchIndex ? merged : c
          ),
        };
      }

      case "CLEAR_TOOL_CALLS":
        return { ...state, toolCalls: [] };

      // v2.9.3：撤销上限跟随设置。只裁剪多余的栈，不记录新的一步 undo。
      case "SET_UNDO_LIMIT": {
        const limit = resolveUndoLimit(action.limit);
        if (limit === state.undoLimit) return state;
        return {
          ...state,
          undoLimit: limit,
          undoStack: state.undoStack.slice(-limit),
          redoStack: state.redoStack.slice(-limit),
        };
      }

      // Stage 0 (.agentmusic load): replace the graph and re-derive notes from
      // it. The graph is a mutable class, so we snapshot the pre-edit state for
      // undo and swap in the loaded graph wholesale.
      case "REPLACE_GRAPH": {
        return withUndo(state, {
          graph: action.graph,
          notes: deriveNotes(action.graph),
        });
      }

      // Stage 0 (.agentmusic load): the TasteStore mutation (importPackage) is
      // already done in the provider's action creator; the reducer only bumps
      // the re-render counter + advances undo (beforeGenome captured the
      // pre-restore genome so undo() restores the taste values).
      case "TASTE_RESTORE": {
        return withUndo(
          state,
          { genomeVersion: state.genomeVersion + 1 },
          action.beforeGenome
        );
      }

      // v1.17.0 Stage 0 (.agentmusic load): replace the applied-diff history
      // wholesale. rollbackTokens are re-derived from the envelopes so the
      // token list stays consistent with appliedDiffs; the DiffEngine
      // snapshot map was already populated by the provider's action creator
      // (importSnapshots is a merge-overwrite, so StrictMode double-dispatch
      // of the same payload is idempotent). Structured-clone keeps the state
      // from sharing mutable memory with the loaded payload.
      case "RESTORE_DIFF_HISTORY": {
        return withUndo(state, {
          appliedDiffs: action.appliedDiffs.map((d) => structuredClone(d)),
          rollbackTokens: action.appliedDiffs.map((d) => d.rollbackToken),
        });
      }

      // Stage 0 (v2.1.0): first-class tempo editing. The new tempo_map is
      // computed from the AUTHORITATIVE graph.meta (same-bar overwrite, new-bar
      // append, sorted asc; a non-positive / fractional bar is a no-op), then
      // written back through graph.withMeta so graph.meta stays the single
      // source of truth — the .agentmusic file and every getMeta() consumer
      // read the same data. The store's tempoChanges projection is re-derived
      // from the graph inside withUndo, and the edit is undoable.
      case "SET_TEMPO": {
        const bar = action.bar;
        if (!Number.isInteger(bar) || bar < 1) return state;
        const base = state.graph.getMeta().tempo_map;
        const next: TempoChange[] = base.map((t) =>
          t.bar === bar
            ? { bar, bpm: action.bpm, curve: action.curve }
            : t
        );
        if (!base.some((t) => t.bar === bar)) {
          next.push({ bar, bpm: action.bpm, curve: action.curve });
        }
        next.sort((a, b) => a.bar - b.bar);
        const graph = state.graph.withMeta({ tempo_map: next });
        return withUndo(state, { graph });
      }

      // Stage 0 (v2.1.0): first-class meter editing. Same graph-native
      // overwrite / append / sort-asc semantics as SET_TEMPO; `bar` must be a
      // positive integer (non-positive / fractional ignored). Undoable.
      case "SET_METER": {
        const bar = action.bar;
        if (!Number.isInteger(bar) || bar < 1) return state;
        const base = state.graph.getMeta().meter_map;
        const next: MeterChange[] = base.map((m) =>
          m.bar === bar
            ? {
                bar,
                numerator: action.numerator,
                denominator: action.denominator,
              }
            : m
        );
        if (!base.some((m) => m.bar === bar)) {
          next.push({
            bar,
            numerator: action.numerator,
            denominator: action.denominator,
          });
        }
        next.sort((a, b) => a.bar - b.bar);
        const graph = state.graph.withMeta({ meter_map: next });
        return withUndo(state, { graph });
      }

      default:
        return state;
    }
  };
}

// ---------------------------------------------------------------------------
// Store wiring helpers (used by ProjectProvider)
// ---------------------------------------------------------------------------
