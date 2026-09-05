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
  createTrack,
  computeMixerDiff,
  mixerToDiff,
  diffToMixer,
  serializeGraph,
  deserializeGraph,
  type Layout,
} from "@collinx/core";
import { createDemoMixer, createTasteStore } from "../data/demoData";
import { createBrowserTasteFsAdapter } from "../services/tasteFsAdapter";

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

/** Stage 2: hard cap on both undo and redo stacks so memory cannot grow
 *  unbounded during long editing sessions. */
export const MAX_UNDO = 50;

export interface ProjectStoreState {
  graph: ProjectGraph;
  notes: NoteEvent[];
  pendingDiffs: DiffEnvelope[];
  appliedDiffs: DiffEnvelope[];
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
}

export type ProjectStoreAction =
  | { type: "APPLY_DIFF"; diff: DiffEnvelope }
  | { type: "REJECT_DIFF"; diffId: string }
  | { type: "ROLLBACK_DIFF"; rollbackToken: string }
  | { type: "ADD_PENDING_DIFFS"; diffs: DiffEnvelope[] }
  | { type: "RECORD_DECISION_EVIDENCE"; diff: DiffEnvelope }
  | { type: "ADD_NOTE"; note: NoteEvent }
  | { type: "MOVE_NOTE"; id: string; bar: number; beat: number; pitch: number }
  | { type: "RESIZE_NOTE"; id: string; durQn: number }
  | { type: "DELETE_NOTE"; id: string }
  | { type: "UPDATE_MIXER_TRACK"; trackId: string; changes: Partial<MixerTrack>; pushUndo?: boolean }
  | { type: "APPLY_MIXER_DIFF"; diff: DiffEnvelope }
  | { type: "REVERT_MIXER_TO"; mixer: MixerState }
  | { type: "ADD_MIXER_TRACK"; name: string; sourceId: string }
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
  | { type: "TASTE_RESTORE"; genome: TasteGenomeData | null; versions: GenomeVersionEntry[]; beforeGenome?: TasteGenomeData | null };

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
  rejectDiff: (diffId: string) => void;
  rollbackDiff: (rollbackToken: string) => void;
  addNote: (note: NoteEvent) => void;
  moveNote: (id: string, bar: number, beat: number, pitch: number) => void;
  resizeNote: (id: string, durQn: number) => void;
  deleteNote: (id: string) => void;
  updateMixerTrack: (trackId: string, changes: Partial<MixerTrack>) => void;
  applyMixerDiff: (diff: DiffEnvelope) => void;
  revertMixerTo: (prevMixer: MixerState) => void;
  addMixerTrack: (name: string, sourceId: string) => void;
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
  runOrchestrator: (config: OrchestratorConfigInput) => Promise<OrchestratorRunResult>;
  /**
   * Stage 1: run the real Arranger agent through the ToolRegistry
   * (arranger.expandSection). Real variants are returned for the panel;
   * proposal diffs (DiffEnvelope[]) are enqueued into pendingDiffs for
   * Agent-panel review. Resolves to an ArrangerRunResult, never throws
   * (ToolRegistry.call surfaces handler failures as status: "error").
   */
  runArranger: (config: ArrangerConfigInput) => Promise<ArrangerRunResult>;
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
}

export interface PersistenceStatus {
  /** Whether cross-refresh persistence is enabled for this provider. */
  enabled: boolean;
  /** ISO timestamp of the last successful localStorage write, or null when
   *  nothing has been persisted yet. */
  lastSavedAt: string | null;
}

export interface ProjectStoreValue extends ProjectStoreState {
  actions: ProjectStoreActions;
  bus: AgentBus;
  /** Stage 1: cross-refresh persistence indicator. */
  persistence: PersistenceStatus;
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
 * edits). Notes are re-derived from the restored graph so graph and notes can
 * never drift apart.
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
  return {
    ...next,
    undoStack: [...state.undoStack, undoSnapshot].slice(-MAX_UNDO),
    redoStack: [],
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

        const result = diffEngine.apply(action.diff, state.graph);
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

      case "REJECT_DIFF":
        return withUndo(state, {
          pendingDiffs: state.pendingDiffs.filter(
            (d) => d.diffId !== action.diffId
          ),
        });

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
          };
        }

        let graph: ProjectGraph;
        try {
          graph = diffEngine.rollback(state.graph, action.rollbackToken);
        } catch {
          // Unknown/expired token: keep the current graph untouched.
          return state;
        }
        return {
          ...state,
          graph,
          notes: deriveNotes(graph),
          appliedDiffs: state.appliedDiffs.filter(
            (d) => d.rollbackToken !== action.rollbackToken
          ),
          rollbackTokens: state.rollbackTokens.filter(
            (t) => t !== action.rollbackToken
          ),
        };
      }

      case "ADD_NOTE": {
        const graph = state.graph.snapshot();
        graph.addNode("NoteSpan", { ...action.note });
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
        return withUndo(state, {
          mixer: {
            ...state.mixer,
            tracks: [...state.mixer.tracks, track],
          },
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
          ].slice(-MAX_UNDO),
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
          ].slice(-MAX_UNDO),
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

      default:
        return state;
    }
  };
}

// ---------------------------------------------------------------------------
// Store wiring helpers (used by ProjectProvider)
// ---------------------------------------------------------------------------
