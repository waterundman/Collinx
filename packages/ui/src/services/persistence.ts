import {
  type DiffEnvelope,
  type MixerState,
  type ProjectGraph,
  type FileSystemAdapter,
  TasteStore,
  TasteGenome,
  serializeGraph,
  deserializeGraph,
} from "@collinx/core";

// ---------------------------------------------------------------------------
// Project-level persistence (Stage 1: cross-refresh persistence).
//
// The storage envelope is versioned (collinx.project.v1) so a future format
// change can be detected and fall back to demo data instead of crashing the
// app on parse errors. TasteStore is deliberately NOT part of this envelope:
// the browser FileSystemAdapter (tasteFsAdapter.ts) already persists genome
// files to localStorage under "collinx:taste.fs.v1", so on restore we simply
// load the existing files back through the same adapter.
// ---------------------------------------------------------------------------

export const PROJECT_PERSISTENCE_KEY = "collinx.project.v1";
export const PERSISTED_STATE_VERSION = 1;

/**
 * Cap on persisted rollback snapshots (Stage 0). Each snapshot is a full
 * graph JSON string, so an unbounded chain could blow past localStorage's
 * ~5MB quota even though the in-memory DiffEngine map is unbounded. Only the
 * most recent MAX_PERSISTED_ROLLBACK_SNAPSHOTS entries are written; older
 * snapshots fall back to the try/catch in ROLLBACK_DIFF (silent no-op) after
 * a refresh, exactly like the pre-Stage-0 behavior. saveProjectState also
 * swallows quota errors, so an oversized payload degrades to a dropped write
 * rather than a crash.
 */
export const MAX_PERSISTED_ROLLBACK_SNAPSHOTS = 10;

/** Virtual storage path used by the TasteStore built on the browser adapter.
 *  Must match the path used by createTasteStore in demoData.ts so both the
 *  fresh-default path and the load-existing path hit the same files. */
export const TASTE_STORAGE_PATH = "collinx/taste";

export interface PersistedProjectState {
  version: typeof PERSISTED_STATE_VERSION;
  savedAt: string;
  /** serializeGraph() output (JSON string) for the ProjectGraph. */
  graphJson: string;
  mixer: MixerState;
  /** Proposal queue: survives refresh so pending agent suggestions are kept. */
  pendingDiffs: DiffEnvelope[];
  /** Applied-diff history: survives refresh so the rollback chain is kept. */
  appliedDiffs: DiffEnvelope[];
  /**
   * DiffEngine rollback snapshots (rollbackToken -> graph JSON string),
   * capped at MAX_PERSISTED_ROLLBACK_SNAPSHOTS so historical graph diffs can
   * still be rolled back after a refresh. DiffEngine.apply() writes the
   * pre-apply snapshot under the diff's rollbackToken; without this the
   * rehydrated DiffEngine map is empty and ROLLBACK_DIFF silently no-ops.
   */
  rollbackSnapshots: Record<string, string>;
}

/** The subset of ProjectStoreState that is serializable / restored. */
export interface ProjectStateSnapshot {
  graph: ProjectGraph;
  mixer: MixerState;
  pendingDiffs: DiffEnvelope[];
  appliedDiffs: DiffEnvelope[];
  /** DiffEngine.exportSnapshots() output. Optional so plain (non-engine)
   *  snapshots can still be serialized; treated as empty when absent. */
  rollbackSnapshots?: Record<string, string>;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // localStorage getter can throw in privacy mode / some sandboxes.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Loose structural guard so a corrupt/partial payload falls back to demo
 *  data instead of crashing the reducer with malformed mixer fields. */
function isMixerShape(value: unknown): value is MixerState {
  if (!isRecord(value)) return false;
  const mixer = value as Partial<MixerState>;
  return (
    Array.isArray(mixer.tracks) &&
    isRecord(mixer.masterTrack) &&
    typeof (mixer.masterTrack as { id?: unknown }).id === "string"
  );
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Keeps only the most recent MAX_PERSISTED_ROLLBACK_SNAPSHOTS entries so a
 * long editing session cannot write unbounded graph JSON into localStorage.
 * Object.entries preserves Map insertion order, so "most recent" == the last
 * N tokens recorded by DiffEngine.apply().
 */
function capRollbackSnapshots(
  snapshots: Record<string, string>
): Record<string, string> {
  const entries = Object.entries(snapshots);
  if (entries.length <= MAX_PERSISTED_ROLLBACK_SNAPSHOTS) return snapshots;
  return Object.fromEntries(entries.slice(-MAX_PERSISTED_ROLLBACK_SNAPSHOTS));
}

export function serializeProjectState(
  state: ProjectStateSnapshot
): PersistedProjectState {
  return {
    version: PERSISTED_STATE_VERSION,
    savedAt: new Date().toISOString(),
    graphJson: serializeGraph(state.graph),
    mixer: state.mixer,
    pendingDiffs: state.pendingDiffs,
    appliedDiffs: state.appliedDiffs,
    rollbackSnapshots: capRollbackSnapshots(state.rollbackSnapshots ?? {}),
  };
}

/**
 * Parses + validates a persisted envelope. Returns null for any malformed /
 * mismatched-version payload so callers can fall back to demo data.
 */
export function deserializeProjectState(
  json: string
): PersistedProjectState | null {
  try {
    const data = JSON.parse(json) as unknown;
    if (!isRecord(data)) return null;
    if (data.version !== PERSISTED_STATE_VERSION) return null;
    if (typeof data.graphJson !== "string") return null;
    if (!isMixerShape(data.mixer)) return null;

    // Stage 0: rollbackSnapshots is a Record of token -> graph JSON string.
    // Missing (pre-Stage-0 envelope) is tolerated as empty so old saves still
    // restore; present-but-malformed poisons the whole payload -> null.
    const rawSnapshots = data.rollbackSnapshots;
    let rollbackSnapshots: Record<string, string>;
    if (rawSnapshots === undefined) {
      rollbackSnapshots = {};
    } else if (
      !isRecord(rawSnapshots) ||
      !Object.values(rawSnapshots).every((v) => typeof v === "string")
    ) {
      return null;
    } else {
      rollbackSnapshots = rawSnapshots as Record<string, string>;
    }

    // Throw path (invalid graph payload) is caught below -> null.
    deserializeGraph(data.graphJson);

    return {
      version: PERSISTED_STATE_VERSION,
      savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
      graphJson: data.graphJson,
      mixer: data.mixer as MixerState,
      pendingDiffs: Array.isArray(data.pendingDiffs)
        ? (data.pendingDiffs as DiffEnvelope[])
        : [],
      appliedDiffs: Array.isArray(data.appliedDiffs)
        ? (data.appliedDiffs as DiffEnvelope[])
        : [],
      rollbackSnapshots,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function loadProjectState(
  storageKey: string
): PersistedProjectState | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    return deserializeProjectState(raw);
  } catch {
    return null;
  }
}

export function saveProjectState(
  storageKey: string,
  state: PersistedProjectState
): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Quota exceeded / privacy mode: drop the write, keep the in-memory state.
  }
}

// ---------------------------------------------------------------------------
// TasteStore restore
// ---------------------------------------------------------------------------

/**
 * Creates a TasteStore over the browser adapter and restores a previously
 * persisted genome if one exists. TasteStore.load() reads genome.json /
 * versions.jsonl through the adapter (backed by localStorage); when nothing
 * has been saved yet it seeds the default genome exactly like
 * createTasteStore in demoData.ts. Without this load-first step, mounting a
 * fresh store would overwrite persisted taste data with the default genome.
 */
export function createTasteStoreFromAdapter(
  fsAdapter: FileSystemAdapter
): TasteStore {
  const tasteStore = new TasteStore(TASTE_STORAGE_PATH, fsAdapter);
  const loaded = tasteStore.load();
  if (!loaded) {
    const defaultGenome = TasteGenome.createDefault();
    tasteStore.save(defaultGenome.clone());
  }
  return tasteStore;
}
