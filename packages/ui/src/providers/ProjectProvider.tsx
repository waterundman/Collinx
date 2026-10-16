import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AgentBus,
  AgentMusicIO,
  DiffEngine,
  MIDIExporter,
  PDFExporter,
  TempoMap,
  ToolRegistry,
  TasteGenome,
  deserializeGraph,
  createLayout,
  type AgentMusicData,
  type Layout,
  type NoteEvent,
  type ProjectGraph,
  type DiffEnvelope,
  type MixerState,
  type MixerTrack,
  type TasteStore,
  type TasteGenomeData,
  type GenomeVersionEntry,
  createToolCallRecord,
  mixerToDiff,
  type NewToolCallRecord,
  type HarmonyEntry,
} from "@collinx/core";
import type { AgentToolDefinitionLike, AgentToolOutcome } from "../services/llm";
import {
  collectAgentMusicData,
  restoreFromAgentMusicData,
  type AgentMusicRestoreActions,
} from "../services/agentmusic-bridge";
import {
  ProjectStoreContext,
  createInitialState,
  createProjectReducer,
  type ProjectStoreAction,
  type ProjectStoreSnapshot,
  type ProjectStoreValue,
  type ArrangerConfigInput,
  type ArrangerRunResult,
  type ArrangerVariantData,
  type OrchestratorConflict,
  type OrchestratorConfigInput,
  type OrchestratorRunResult,
  type EngravingRunResult,
  type ExtractPartsRunResult,
  type TeachingConfigInput,
  type TeachingRunResult,
  convertAgentCollisions,
  convertExtractParts,
  convertAgentExplanation,
  EMPTY_UI_EXPLANATION,
} from "../store/project-store";
import { createDemoNotes } from "../data/demoData";
import { createBrowserTasteFsAdapter } from "../services/tasteFsAdapter";
import {
  PROJECT_PERSISTENCE_KEY,
  type PersistedProjectState,
  createTasteStoreFromAdapter,
  loadProjectState,
  saveProjectState,
  serializeProjectState,
} from "../services/persistence";
import {
  AUTOSAVE_INTERVAL_MS,
  clearAutosaveSlots,
  scanAutosaveSlots,
  writeAutosaveSlot,
} from "../services/autosave";
import { MixingAgent, registerBuiltinTools } from "@collinx/agent";

/** Serialized deep-equality for genome snapshots. toJSON() emits the same key
 *  order for the same genome, so JSON.stringify is a reliable proxy. */
function genomesEqual(
  a: TasteGenomeData | null,
  b: TasteGenomeData | null
): boolean {
  if (a === null) return b === null;
  if (b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * v1.16.0 Stage 1: shared Blob download helper for the export menu
 * (.agentmusic save, MIDI export, PDF export). Creates an object URL, clicks
 * a temporary anchor with the given filename, then revokes the URL.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * v1.17.0 Stage 1: dirty-detection fingerprint for the autosave interval.
 * A cheap composite of the signals that actually change on user edits —
 * graph revision + diff/notes counts + a compact mixer signature (the mixer
 * lives outside the graph, so its gain/pan/mute/solo per track is folded in
 * without hashing the full state JSON) + genomeVersion — rather than a hash
 * of the whole serialized project. Equal fingerprints mean "no user-visible
 * change since the last autosave write", so the tick is skipped.
 *
 * v1.18.0 Stage 1: two dimensions added —
 *  - pendingDiffs diffIds (comma-joined): covers the "equal-length swap" case
 *    (one pending diff rejected + a new one added keeps length unchanged, but
 *    the diffId list changes), which the previous length-only signal missed.
 *  - per-track fxChain serialization (JSON.stringify of each track's
 *    fxChain): mixer effect-slot edits (add/reorder/params) change the mixer
 *    state without touching gain/pan/mute/solo. JSON.stringify is chosen over
 *    a hand-rolled signature because FXChain/FXSlot are plain data objects
 *    with stable key insertion order (created via createTrack/createFXSlot),
 *    so stringify is deterministic; the cost is bounded (fxChains are small)
 *    and the fingerprint is only computed inside the autosave interval
 *    callback (stateRef.current), never per render.
 */
function computeAutosaveFingerprint(state: {
  graph: ProjectGraph;
  notes: NoteEvent[];
  pendingDiffs: DiffEnvelope[];
  appliedDiffs: DiffEnvelope[];
  mixer: MixerState;
  genomeVersion: number;
}): string {
  const mixerSig = state.mixer.tracks
    .map(
      (t) =>
        `${t.id}:${t.gainDb}:${t.pan}:${t.mute}:${t.solo}:${JSON.stringify(
          t.fxChain,
        )}`,
    )
    .join(",");
  const pendingDiffSig = state.pendingDiffs.map((d) => d.diffId).join(",");
  return [
    state.graph.getRevisionId(),
    state.appliedDiffs.length,
    state.notes.length,
    state.pendingDiffs.length,
    pendingDiffSig,
    mixerSig,
    state.genomeVersion,
  ].join("|");
}

/**
 * Stage 2: restores the genome recorded in an undo/redo snapshot onto the
 * shared TasteStore instance. TasteStore is a mutable class, so the restore
 * must live in the action-creator layer, never inside the pure reducer.
 * tasteStore.save() advances the store's own version history; the undo stack
 * independently restores the genome *values* while the version history keeps
 * its list of versions — the two are independent mechanisms.
 */
function restoreGenomeForSnapshot(
  tasteStore: TasteStore,
  snap: ProjectStoreSnapshot | undefined
): void {
  if (!snap || !snap.genome) return;
  const current = tasteStore.getCurrentGenome();
  if (current && genomesEqual(current.toJSON(), snap.genome)) return;
  tasteStore.save(TasteGenome.fromJSON(snap.genome));
}

interface ProjectProviderProps {
  children: ReactNode;
  title?: string;
  initialNotes?: NoteEvent[];
  initialMixer?: MixerState;
  pendingDiffs?: DiffEnvelope[];
  /** localStorage key for the persisted project state (Stage 1). Pass
   *  undefined or an empty string to disable persistence. */
  persistenceKey?: string;
}

/**
 * Stage 0 state bridge: owns a real ProjectGraph, a DiffEngine and an
 * AgentBus, and exposes them through React Context.
 */
export const ProjectProvider: React.FC<ProjectProviderProps> = ({
  children,
  title = "Untitled Project",
  initialNotes,
  initialMixer,
  pendingDiffs,
  persistenceKey,
}) => {
  // Persistence is on by default in real browser builds (vite dev/production).
  // Under vitest (MODE === "test") it defaults to off so existing provider
  // tests never leak a snapshot into the shared jsdom localStorage across
  // tests; persistence-specific tests opt in by passing their own key.
  const effectivePersistenceKey =
    persistenceKey === undefined
      ? import.meta.env.MODE === "test"
        ? null
        : PROJECT_PERSISTENCE_KEY
      : persistenceKey;

  // DiffEngine + AgentBus + TasteStore are created once per provider instance.
  // MixingAgent is stateless (rule-based mix suggestions), so a single shared
  // instance is reused across suggestMixingChain calls instead of allocating a
  // fresh one per proposal.
  const servicesRef = useRef<{
    diffEngine: DiffEngine;
    agentBus: AgentBus;
    mixingAgent: MixingAgent;
    tasteStore: TasteStore;
  } | null>(null);
  if (!servicesRef.current) {
    servicesRef.current = {
      diffEngine: new DiffEngine(),
      agentBus: new AgentBus(),
      mixingAgent: new MixingAgent(),
      // Browser adapter (localStorage-backed) so TasteStore never touches
      // Node's fs module in the browser. The same instance is shared between
      // the store state and the action creators below. createTasteStoreFromAdapter
      // restores a previously persisted genome via load() before seeding the
      // default genome, so taste edits survive a refresh.
      tasteStore: createTasteStoreFromAdapter(createBrowserTasteFsAdapter()),
    };
  }
  const { diffEngine, agentBus, mixingAgent, tasteStore } = servicesRef.current;

  // Stage 2: undo coalescing for mixer slider drags. UPDATE_MIXER_TRACK fires
  // at mousemove rate; the action creator only lets the reducer push a new
  // undo step when >= MIN_MIXER_UNDO_GAP_MS has passed since the last push,
  // so a drag collapses into a single undo step. The ref lives outside the
  // reducer on purpose — reducers must stay pure, and this throttle is a
  // side-effectful guard in the action creator layer.
  const MIN_MIXER_UNDO_GAP_MS = 500;
  const mixerUndoGuardRef = useRef<{ lastPushAt: number } | null>(null);

  // Stage 1: the shared ToolRegistry that real tool calls (registerBuiltinTools
  // in the agent package) route through. Its onToolCall sink feeds the store's
  // append-only tool-call timeline, so every registry.call invocation becomes
  // visible in the ToolCallTimeline.
  const toolRegistryRef = useRef<ToolRegistry | null>(null);

  // Stage 1: restore a persisted project on mount. Read once via a ref so
  // StrictMode double-rendering and the reducer init see the same payload.
  const persistedRef = useRef<PersistedProjectState | null>(null);
  if (persistedRef.current === null) {
    persistedRef.current = effectivePersistenceKey
      ? loadProjectState(effectivePersistenceKey)
      : null;
  }
  const persisted = persistedRef.current;

  // Stage 0: rehydrate the DiffEngine rollback map from the persisted
  // envelope so historical graph diffs can still be rolled back after a
  // refresh. DiffEngine.apply() stores the pre-apply snapshot under the
  // diff's rollbackToken; without this the fresh engine's map is empty and
  // ROLLBACK_DIFF silently no-ops (try/catch in the reducer). Safe under
  // StrictMode double-render: importSnapshots overwrites the same values.
  if (persisted && Object.keys(persisted.rollbackSnapshots).length > 0) {
    diffEngine.importSnapshots(persisted.rollbackSnapshots);
  }

  // v2.4.0 S5: 原先这里有两条**预置假提案**（actor 硬编码标 gpt-4o / claude-3），
  // 会让用户误以为 AI 已经参与。已删除：待审批队列现在只能由真实路径产生
  // （AI 工具调用 runAgentTool，或各面板的真实 Agent 按钮）。

  const [state, dispatch] = useReducer(
    useMemo(() => createProjectReducer(diffEngine), [diffEngine]),
    undefined,
    () => {
      if (persisted) {
        // Restored project: rebuild the graph, mixer, proposal queue and
        // applied-diff history from the persisted envelope. Notes are derived
        // from the restored graph by createInitialState.
        const graph = deserializeGraph(persisted.graphJson);
        return createInitialState({
          title,
          graph,
          pendingDiffs: persisted.pendingDiffs,
          appliedDiffs: persisted.appliedDiffs,
          mixer: persisted.mixer,
          tasteStore,
        });
      }
      const restored = createInitialState({
        title,
        initialNotes: initialNotes ?? createDemoNotes(),
        mixer: initialMixer,
        tasteStore,
      });
      // v2.4.0 S5：通过 prop 注入的初始提案是针对"初始图"的，而初始图的
      // revisionId 由 ProjectGraph.create 随机生成，调用方无法预先得知。
      // 在这里把注入提案的 baseRevision 对齐到真实图 revision，使它们仍可被
      // 正常审批应用（DiffEngine 会校验 baseRevision）。面板/真实 Agent 路径
      // 产生的提案不经过这里，其 baseRevision 由生成端保证。
      return {
        ...restored,
        pendingDiffs: (pendingDiffs ?? []).map((diff) => ({
          ...diff,
          baseRevision: restored.graph.getRevisionId(),
        })),
      };
    }
  );

  // -----------------------------------------------------------------------
  // v1.17.0 Stage 1: autosave (crash recovery).
  // -----------------------------------------------------------------------

  // Mirror of the latest state for the autosave interval: the interval reads
  // stateRef inside its callback, so its 5-minute cadence is NOT reset by
  // edits (a useEffect keyed on [state] would restart the timer on every
  // change and starve the autosave during continuous editing).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Dirty-detection baseline: fingerprint of the state at mount. Until the
  // live fingerprint differs from this, the autosave interval skips writing
  // (a freshly opened tab with no edits must not produce snapshots).
  const autosaveFingerprintRef = useRef<string>(computeAutosaveFingerprint(state));

  // Mount-time scan of the autosave slots (one-shot: the useState lazy
  // initializer runs exactly once per mount and is StrictMode-safe — double
  // invocation is a pure localStorage read). A recovery hint is surfaced only
  // when the newest autosave snapshot is NEWER than the localStorage-persisted
  // state (loadProjectState null counts as older) — i.e. the browser likely
  // crashed/was killed after an autosave tick but before the debounced main
  // save landed.
  const [autosaveRecovery, setAutosaveRecovery] = useState<{
    savedAt: string;
    payload: string;
  } | null>(() => {
    if (!effectivePersistenceKey) return null;
    const latest = scanAutosaveSlots()[0];
    if (!latest) return null;
    const persistedState = persistedRef.current;
    if (persistedState && persistedState.savedAt >= latest.savedAt) return null;
    return { savedAt: latest.savedAt, payload: latest.payload };
  });
  // The restore action reads the pending payload through this mirror so the
  // actions memo does not need to rebuild when the hint is consumed.
  const autosaveRecoveryRef = useRef(autosaveRecovery);
  autosaveRecoveryRef.current = autosaveRecovery;

  // Stage 1: create the ToolRegistry after dispatch is available and register
  // the built-in agent tools. onToolCall forwards every ToolCallRecord emitted
  // by ToolRegistry.call into the store's timeline (RECORD_TOOL_CALL is pure:
  // id/timestamp are already minted by createToolCallRecord in core).
  if (!toolRegistryRef.current) {
    toolRegistryRef.current = new ToolRegistry({
      onToolCall: (record) => {
        dispatch({
          type: "RECORD_TOOL_CALL",
          record,
        } satisfies ProjectStoreAction);
      },
    });
    registerBuiltinTools(toolRegistryRef.current, agentBus);
  }
  const toolRegistry = toolRegistryRef.current;

  // Stage 1: debounce-persist the serializable state after every change. The
  // initial render is skipped (state === the initial render's state) so a
  // first visit with no edits does not eagerly write a demo snapshot, and the
  // pending timer is cancelled on unmount so short-lived test providers never
  // leak a save into localStorage. mixerDiffLog / mixerRollbackSnapshots are
  // intentionally not persisted: the audit chain restarts empty after refresh.
  const initialStateRef = useRef(state);
  const saveTimerRef = useRef<number | null>(null);
  const [lastPersistedAt, setLastPersistedAt] = useState<string | null>(null);

  useEffect(() => {
    if (state === initialStateRef.current) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      if (!effectivePersistenceKey) return;
      saveProjectState(
        effectivePersistenceKey,
        serializeProjectState({
          graph: state.graph,
          mixer: state.mixer,
          pendingDiffs: state.pendingDiffs,
          appliedDiffs: state.appliedDiffs,
          // Stage 0: export the DiffEngine rollback snapshots so the rollback
          // chain survives the refresh. serializeProjectState caps the count
          // to protect the ~5MB localStorage quota.
          rollbackSnapshots: diffEngine.exportSnapshots(),
        })
      );
      setLastPersistedAt(new Date().toISOString());
    }, 500);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [state, effectivePersistenceKey]);

  // v1.17.0 Stage 1: periodic autosave. Every AUTOSAVE_INTERVAL_MS a full
  // AgentMusicData snapshot (same collect path as saveProjectAsAgentMusic,
  // including rollbackSnapshots) is rotated into the localStorage autosave
  // slots — a crash-recovery net complementary to the single-slot debounced
  // main persistence above. Dirty detection: the tick is skipped when the
  // fingerprint is unchanged since the last write, so an idle open tab does
  // not churn identical snapshots. Disabled entirely when persistence is off
  // (same condition as the save effect), cleared on unmount.
  const collectAgentMusicSnapshot = useCallback((): AgentMusicData => {
    const s = stateRef.current;
    return collectAgentMusicData({
      graph: s.graph,
      notes: s.notes,
      mixer: s.mixer,
      tasteStore,
      appliedDiffs: s.appliedDiffs,
      pendingDiffs: s.pendingDiffs,
      // Same wiring as the localStorage main-save path: the autosave carries
      // the full rollback chain. collectAgentMusicData caps the count.
      rollbackSnapshots: diffEngine.exportSnapshots(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteStore, diffEngine]);

  useEffect(() => {
    if (!effectivePersistenceKey) return;
    const intervalId = window.setInterval(() => {
      const fingerprint = computeAutosaveFingerprint(stateRef.current);
      if (autosaveFingerprintRef.current === fingerprint) return;
      autosaveFingerprintRef.current = fingerprint;
      const data = collectAgentMusicSnapshot();
      writeAutosaveSlot(JSON.stringify(data), new Date().toISOString());
    }, AUTOSAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [effectivePersistenceKey, collectAgentMusicSnapshot]);

  // v2.4.0 S3: 原先这里注册了一个"compose" agent，对任何输入返回硬编码字符串
  // （`[compose] Rule-based response for "<prompt>"`）。已删除——AI 对话现在由
  // AgentChat 直接调用真实 LLM（services/llm），工具执行走 actions.runAgentTool。

  // v1.17.0 Stage 1: the restore API shared by the .agentmusic file load
  // path (loadProjectFromAgentMusic) and the autosave crash-recovery path
  // (restoreFromAutosave) — kept identical by construction. Both route
  // through restoreFromAgentMusicData. DiffEngine is a mutable class, so
  // the snapshot import lives here (same layer as tasteStore.importPackage);
  // importSnapshots is a merge-overwrite, so repeated restores are idempotent.
  const buildRestoreApi = useCallback((): AgentMusicRestoreActions => {
    return {
      replaceGraph: (graph) => {
        dispatch({ type: "REPLACE_GRAPH", graph } satisfies ProjectStoreAction);
      },
      revertMixerTo: (mixer) => {
        dispatch({ type: "REVERT_MIXER_TO", mixer } satisfies ProjectStoreAction);
      },
      restoreTaste: (genome, versions) => {
        const beforeGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        if (genome) {
          tasteStore.importPackage({
            packageVersion: 1,
            exportedAt: new Date().toISOString(),
            genome,
            evidence: [],
            versionHistory: versions,
          });
        }
        dispatch({
          type: "TASTE_RESTORE",
          genome,
          versions,
          beforeGenome,
        } satisfies ProjectStoreAction);
      },
      restoreDiffHistory: (appliedDiffs, rollbackSnapshots) => {
        diffEngine.importSnapshots(rollbackSnapshots);
        dispatch({
          type: "RESTORE_DIFF_HISTORY",
          appliedDiffs,
        } satisfies ProjectStoreAction);
      },
    };
  }, [tasteStore, diffEngine]);

  // v2.4.0 S4：所有待审批提案在入队前把 baseRevision 对齐到当前图 revision。
  // 工具层拿不到 ProjectGraph（engraving 硬编码 "HEAD"、arranger 由调用方传参、
  // composer 无图上下文），而 DiffEngine.apply 会严格校验 baseRevision ——
  // 不修正的话，用户能点「应用」但会被拒绝（表现为"点了没反应"）。
  const alignRevision = useCallback(
    (diffs: DiffEnvelope[]): DiffEnvelope[] => {
      const revision = stateRef.current.graph.getRevisionId();
      return diffs.map((d) => ({ ...d, baseRevision: revision }));
    },
    [],
  );

  const actions = useMemo(
    () => ({
      applyDiff: (diff: DiffEnvelope): string => {
        // v2.5.0：应用前再次把 baseRevision 对齐到"当前"图 revision。
        // 只做入队时对齐是不够的 —— 连续应用多条提案时，第一条应用后图
        // revision 已改变，第二条会因 baseRevision 失配被 DiffEngine 拒绝
        // （用户看到"第一条能应用、后面都点不动"）。
        const aligned: DiffEnvelope = {
          ...diff,
          baseRevision: stateRef.current.graph.getRevisionId(),
        };
        dispatch({ type: "APPLY_DIFF", diff: aligned } satisfies ProjectStoreAction);
        return diff.rollbackToken;
      },
      rejectDiff: (diffId: string): void => {
        dispatch({ type: "REJECT_DIFF", diffId } satisfies ProjectStoreAction);
      },
      // Stage 2: materialize an Agent decision as a Knowledge Graph evidence
      // node on demand. APPLY_DIFF already records agent diffs automatically;
      // this gives callers (tests, audit UI) an explicit hook.
      recordDecisionEvidence: (diff: DiffEnvelope): void => {
        dispatch({ type: "RECORD_DECISION_EVIDENCE", diff } satisfies ProjectStoreAction);
      },
      rollbackDiff: (rollbackToken: string): void => {
        dispatch({ type: "ROLLBACK_DIFF", rollbackToken } satisfies ProjectStoreAction);
      },
      addNote: (note: NoteEvent): void => {
        dispatch({ type: "ADD_NOTE", note } satisfies ProjectStoreAction);
      },
      // v2.6.0：从「空编排」起点卡片创建乐段（graph-native，非平行字段）
      addPhrase: (phrase: {
        name: string;
        formRole: string;
        startBar: number;
        endBar: number;
      }): void => {
        dispatch({
          type: "ADD_PHRASE",
          name: phrase.name,
          formRole: phrase.formRole,
          startBar: phrase.startBar,
          endBar: phrase.endBar,
        } satisfies ProjectStoreAction);
      },
      // v2.2.0 S1 (D22-4)：批量新增（录制 take 落盘；一条 undo 记录）
      addNotes: (notes: NoteEvent[]): void => {
        dispatch({ type: "ADD_NOTES", notes } satisfies ProjectStoreAction);
      },
      // v2.1.0 S3 (D13-1)：tempo/meter 编辑入口（TransportBar 消费）
      setTempo: (bar: number, bpm: number): void => {
        dispatch({ type: "SET_TEMPO", bar, bpm } satisfies ProjectStoreAction);
      },
      setMeter: (bar: number, numerator: number, denominator: number): void => {
        dispatch({ type: "SET_METER", bar, numerator, denominator } satisfies ProjectStoreAction);
      },
      moveNote: (id: string, bar: number, beat: number, pitch: number): void => {
        dispatch({ type: "MOVE_NOTE", id, bar, beat, pitch } satisfies ProjectStoreAction);
      },
      resizeNote: (id: string, durQn: number): void => {
        dispatch({ type: "RESIZE_NOTE", id, durQn } satisfies ProjectStoreAction);
      },
      deleteNote: (id: string): void => {
        dispatch({ type: "DELETE_NOTE", id } satisfies ProjectStoreAction);
      },
      updateMixerTrack: (trackId: string, changes: Partial<MixerTrack>): void => {
        // Stage 2: coalesce slider drags into one undo step. Only grant the
        // reducer permission to push an undo snapshot when the last undoable
        // mixer edit is older than MIN_MIXER_UNDO_GAP_MS. Throttled edits
        // still apply + audit-log; they just merge into the current step.
        const now = Date.now();
        const allowPush =
          !mixerUndoGuardRef.current ||
          now - mixerUndoGuardRef.current.lastPushAt >= MIN_MIXER_UNDO_GAP_MS;
        if (allowPush) {
          mixerUndoGuardRef.current = { lastPushAt: now };
        }
        dispatch({
          type: "UPDATE_MIXER_TRACK",
          trackId,
          changes,
          pushUndo: allowPush,
        } satisfies ProjectStoreAction);
      },
      // Stage 2: composite undo/redo across graph + mixer + taste genome. The
      // reducer pops the stacks and restores the pure-state snapshots (see
      // project-store.ts). The genome VALUES are restored here, before the
      // dispatch: we rebuild the genome recorded in the snapshot being undone/
      // redone and save it onto the shared TasteStore (a mutable class, so
      // this cannot happen inside the reducer). The pre-restore live genome is
      // captured first and forwarded to the reducer so the opposite-stack
      // snapshot records the edited genome for a symmetric redo/undo.
      undo: (): void => {
        const snap = state.undoStack[state.undoStack.length - 1];
        const redoGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        restoreGenomeForSnapshot(tasteStore, snap);
        dispatch({ type: "UNDO", redoGenome } satisfies ProjectStoreAction);
      },
      redo: (): void => {
        const snap = state.redoStack[state.redoStack.length - 1];
        const undoGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        restoreGenomeForSnapshot(tasteStore, snap);
        dispatch({ type: "REDO", undoGenome } satisfies ProjectStoreAction);
      },
      applyMixerDiff: (diff: DiffEnvelope): void => {
        dispatch({ type: "APPLY_MIXER_DIFF", diff } satisfies ProjectStoreAction);
      },
      revertMixerTo: (prevMixer: MixerState): void => {
        dispatch({ type: "REVERT_MIXER_TO", mixer: prevMixer } satisfies ProjectStoreAction);
      },
      addMixerTrack: (name: string, sourceId: string): void => {
        dispatch({ type: "ADD_MIXER_TRACK", name, sourceId } satisfies ProjectStoreAction);
      },
      // Stage 2: Mixing Agent closed loop. Generates a mix proposal
      // (gainDb/pan/fxChain for every track + master) via the real
      // MixingAgent and enqueues it into pendingDiffs, where the Agent Panel
      // picks it up. Applying it routes through applyDiff's mixer-diff
      // detection and lands on the mixer via diffToMixer.
      //
      // v1.15 Stage 1: accepts an optional trackId. When given, only that
      // track receives a proposal: the single-track FX chain (built from the
      // track's source role, matching what suggestMix would suggest for it) is
      // encoded as a mixer diff in the /tracks/<id> namespace so isMixerDiff /
      // diffToMixer recognize it exactly like a full-mix proposal. The real
      // mixing.suggestChain tool is still routed through the ToolRegistry so
      // the call shows up in the timeline. Without trackId the full-mix path
      // below is unchanged (backwards compatible).
      suggestMixingChain: (trackId?: string): void => {
        const currentMixer = state.mixer;
        const mixing = mixingAgent;

        if (trackId) {
          const track =
            currentMixer.tracks.find((t) => t.id === trackId) ??
            (trackId === currentMixer.masterTrack.id
              ? currentMixer.masterTrack
              : undefined);
          // Unknown track id: nothing to suggest, keep the queue untouched.
          if (!track) return;

          // Single-track FX chain suggestion. suggestChain classifies by
          // source role (melody/bass/chords/drums/default), matching the per-
          // track chain suggestMix builds for the same source.
          const chain = mixing.suggestChain(
            track.sourceTrackId.length > 0 ? track.sourceTrackId : trackId
          );
          const fxChanges = chain.map((slot, idx) => ({
            slotIndex: idx,
            changes: {
              type: slot.type,
              preset: slot.preset,
              params: slot.params,
              enabled: slot.enabled,
            },
          }));
          // mixerToDiff emits ops in the /tracks/<id> namespace with a
          // MixerChange payload carrying `trackId`, so isMixerDiff recognizes
          // the envelope and applyDiff routes it to diffToMixer.
          const diff = mixerToDiff(
            [{ trackId, changes: {}, fxChanges }],
            "HEAD"
          );
          const envelope: DiffEnvelope = {
            ...diff,
            actor: { type: "agent", name: "mixing" },
            permissionScope: "proposal_only",
            summary: `FX chain suggestion for track: ${track.name}`,
            domainExplanations: [
              {
                label: "fx_chain",
                text: `Tailored FX chain for ${track.name} based on its role in the mix.`,
              },
            ],
          };
          dispatch({
            type: "ADD_PENDING_DIFFS",
            diffs: alignRevision([envelope]),
          } satisfies ProjectStoreAction);
          // Stage 1: route the real mixing.suggestChain tool call through the
          // ToolRegistry (fire-and-forget) so the single-track suggestion is
          // visible in the tool-call timeline.
          void toolRegistry.call(
            "mixing.suggestChain",
            { trackId },
            { type: "agent", name: "mixing" }
          );
          return;
        }

        const analysis = mixing.suggestMix(currentMixer.tracks, state.notes);
        const envelope = mixing.toDiffEnvelope(analysis, currentMixer);
        dispatch({
          type: "ADD_PENDING_DIFFS",
          diffs: alignRevision([envelope]),
        } satisfies ProjectStoreAction);
        // Stage 1: route the real mixing.suggestChain tool call through the
        // ToolRegistry so it shows up in the tool-call timeline. The proposal
        // envelope above is still built by the stateless MixingAgent directly
        // (the registered tool returns an FX chain, not a full MixAnalysis
        // envelope); this call is fire-and-forget and only feeds the
        // observable tool trace.
        const chainParams: Record<string, unknown> = {};
        if (currentMixer.tracks.length > 0) {
          chainParams.trackId = currentMixer.tracks[0].id;
        }
        void toolRegistry.call(
          "mixing.suggestChain",
          chainParams,
          { type: "agent", name: "mixing" }
        );
      },
      // Stage 0: Orchestrator panel closed loop. Routes the panel config
      // through the real orchestrator.voicingPlan tool on the shared
      // ToolRegistry, so the invocation (running + success) shows up in the
      // tool-call timeline. Real conflict detection is returned for the panel;
      // the proposal diffs produced by the Orchestrator (DiffEnvelope[],
      // carried on the ToolResult under `diffs`) are enqueued into
      // pendingDiffs where the Agent Panel can review/apply them.
      // v1.22.0 Stage 1: harmony (HarmonyEntry[] derived from the chords
      // track) is forwarded to the tool (required param); phraseRef stays
      // optional audit metadata.
      runOrchestrator: async (
        config: OrchestratorConfigInput,
        harmony?: HarmonyEntry[],
      ): Promise<OrchestratorRunResult> => {
        const result = await toolRegistry.call(
          "orchestrator.voicingPlan",
          {
            harmony: harmony ?? [],
            phraseRef: config.phraseRef ?? "verse1",
            players: config.players,
            style: config.style ?? "classical",
            playabilityPolicy: config.playabilityPolicy ?? "moderate",
            doubleOctaves: config.doubleOctaves,
            maxVoices: config.maxVoices,
          },
          { type: "user", name: "orchestrate-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        const conflicts = Array.isArray(data.conflicts)
          ? (data.conflicts as OrchestratorConflict[])
          : [];
        // The orchestrator handler puts the DiffEnvelope[] proposals on the
        // ToolResult as `diffs` (plural); ToolResult only types `diff`, so
        // extract it defensively through a cast.
        const diffs = Array.isArray((result as { diffs?: unknown }).diffs)
          ? ((result as { diffs?: unknown }).diffs as DiffEnvelope[])
          : [];
        if (result.status === "ok" && diffs.length > 0) {
          dispatch({
            type: "ADD_PENDING_DIFFS",
            diffs: alignRevision(diffs),
          } satisfies ProjectStoreAction);
        }
        return {
          status: result.status,
          conflicts,
          suggestions: Array.isArray(data.suggestions)
            ? (data.suggestions as string[])
            : [],
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          diffs,
          voicingPlan: data.voicingPlan,
          perPlayerNotes: data.perPlayerNotes,
        };
      },
      // Stage 1: Arranger panel closed loop. Routes the panel config through
      // the real arranger.expandSection tool on the shared ToolRegistry, so
      // the invocation (running + success) shows up in the tool-call timeline.
      // Real variants are returned for the panel; the proposal diffs produced
      // by the Arranger (DiffEnvelope[], carried on the ToolResult under
      // `diffs`) are enqueued into pendingDiffs where the Agent Panel can
      // review/apply them.
      runArranger: async (
        config: ArrangerConfigInput,
      ): Promise<ArrangerRunResult> => {
        const result = await toolRegistry.call(
          "arranger.expandSection",
          {
            source: config.source,
            bars: config.bars,
            style: config.style,
            formTemplate: config.formTemplate,
            energyTarget: config.energyTarget,
            variantCount: config.variantCount,
          },
          { type: "user", name: "arrange-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        const diffs = Array.isArray((result as { diffs?: unknown }).diffs)
          ? ((result as { diffs?: unknown }).diffs as DiffEnvelope[])
          : [];
        if (result.status === "ok" && diffs.length > 0) {
          dispatch({
            type: "ADD_PENDING_DIFFS",
            diffs: alignRevision(diffs),
          } satisfies ProjectStoreAction);
        }
        return {
          status: result.status,
          variants: Array.isArray(data.variants)
            ? (data.variants as ArrangerVariantData[])
            : [],
          selectedVariant: (data.selectedVariant as ArrangerVariantData) ?? null,
          formStructure: data.formStructure,
          section: data.section,
          energyCurvePoints: Array.isArray(data.energyCurvePoints)
            ? (data.energyCurvePoints as { bar: number; level: number }[])
            : [],
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          diffs,
        };
      },
      // v2.4.0 S4: AI 工具闭环。AgentChat 的 LLM 决定调用工具时统一经此执行：
      // 走真实 ToolRegistry（工具调用时间线可见），产出的提案 DiffEnvelope
      // 入队 pendingDiffs，用户审批后才写入工程。
      listAgentTools: (): AgentToolDefinitionLike[] =>
        toolRegistry.listTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
          })),
        })),
      runAgentTool: async (
        toolName: string,
        args: Record<string, unknown>,
      ): Promise<AgentToolOutcome> => {
        try {
          const result = await toolRegistry.call(toolName, args, {
            type: "agent",
            name: "HarmonyBot",
          });
          // 工具约定把 DiffEnvelope[] 挂在 ToolResult.diffs 上（ToolResult 只
          // 类型化了单数 diff），这里两者都取，避免漏掉提案。
          const carried = (result as { diffs?: unknown }).diffs;
          const diffs = Array.isArray(carried)
            ? (carried as DiffEnvelope[])
            : result.diff
              ? [result.diff]
              : [];
          if (result.status === "ok" && diffs.length > 0) {
            dispatch({ type: "ADD_PENDING_DIFFS", diffs: alignRevision(diffs) } satisfies ProjectStoreAction);
          }
          return {
            ok: result.status === "ok",
            data: result.data,
            diffCount: result.status === "ok" ? diffs.length : 0,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            diffCount: 0,
          };
        }
      },
      // Stage 0 (v1.14): Score panel closed loop. Routes the auto-layout
      // request through the real engraving.reportCollisions tool on the shared
      // ToolRegistry, so the invocation (running + success) shows up in the
      // tool-call timeline. The agent-side collisions are converted to the UI
      // UiCollisionWarning shape (see convertAgentCollisions); suggestions are
      // passed through unchanged.
      runEngraving: async (layoutId: string): Promise<EngravingRunResult> => {
        const result = await toolRegistry.call(
          "engraving.reportCollisions",
          { layoutId },
          { type: "user", name: "score-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        return {
          status: result.status,
          collisions: convertAgentCollisions(data.collisions),
          suggestions: Array.isArray(data.suggestions)
            ? (data.suggestions as string[])
            : [],
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          raw: data,
        };
      },
      // v1.15 Stage 0: Score panel part-extraction closed loop. Routes the
      // request through the real engraving.extractParts tool on the shared
      // ToolRegistry (visible in the tool-call timeline); the returned
      // PartLayout proposal diffs are enqueued into pendingDiffs. The parts
      // summary for the panel comes from the tool's `data.parts` payload,
      // falling back to the diff ops when it is missing (defensive).
      runExtractParts: async (
        layoutId?: string,
      ): Promise<ExtractPartsRunResult> => {
        const result = await toolRegistry.call(
          "engraving.extractParts",
          { layoutId: layoutId ?? "full-score-v1" },
          { type: "user", name: "score-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        const diffs = Array.isArray((result as { diffs?: unknown }).diffs)
          ? ((result as { diffs?: unknown }).diffs as DiffEnvelope[])
          : [];
        let parts = convertExtractParts(data.parts);
        // Fallback: derive the part list from the proposal diffs' PartLayout
        // add_node ops when the tool payload carries no `parts` array.
        if (parts.length === 0 && diffs.length > 0) {
          parts = diffs
            .flatMap((d) => d.ops)
            .filter((op) => op.op === "add_node" && op.nodeType === "PartLayout")
            .map((op) => (op as { data?: unknown }).data)
            .filter(
              (d): d is { instrumentId: string; instrumentName: string; barCount: number } =>
                typeof d === "object" &&
                d !== null &&
                typeof (d as { instrumentId?: unknown }).instrumentId === "string" &&
                typeof (d as { instrumentName?: unknown }).instrumentName === "string" &&
                typeof (d as { barCount?: unknown }).barCount === "number"
            );
        }
        if (result.status === "ok" && diffs.length > 0) {
          dispatch({
            type: "ADD_PENDING_DIFFS",
            diffs: alignRevision(diffs),
          } satisfies ProjectStoreAction);
        }
        return {
          status: result.status,
          parts,
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          raw: data,
        };
      },
      // v1.14 Stage 1: Teaching panel closed loop. Routes the panel request
      // through the real teaching.explainDecision tool on the shared
      // ToolRegistry, so the invocation (running + success) shows up in the
      // tool-call timeline. The agent-side Explanation is converted to the UI
      // UiExplanation shape (see convertAgentExplanation); on failure the
      // result carries EMPTY_UI_EXPLANATION + status "error" so the panel can
      // render an explicit error state instead of template content.
      runTeaching: async (
        config: TeachingConfigInput,
      ): Promise<TeachingRunResult> => {
        const result = await toolRegistry.call(
          "teaching.explainDecision",
          {
            diffId: config.diffId,
            userLevel: config.userLevel,
            compareWithAlt: config.compareWithAlt ?? false,
          },
          { type: "user", name: "teaching-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        return {
          status: result.status,
          explanation: convertAgentExplanation(data) ?? EMPTY_UI_EXPLANATION,
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          raw: data,
        };
      },
      // v1.18.0 Stage 0: Teaching harmony closed loop. Routes the panel request
      // through the real teaching.explainHarmony tool on the shared
      // ToolRegistry, so the invocation (running + success) shows up in the
      // tool-call timeline. The agent-side Explanation is converted to the UI
      // UiExplanation shape (see convertAgentExplanation); on failure the
      // result carries EMPTY_UI_EXPLANATION + status "error" so the panel can
      // render an explicit error state instead of template content.
      runTeachingHarmony: async (
        chordProgression: string[],
        key: string,
        userLevel: TeachingConfigInput["userLevel"],
      ): Promise<TeachingRunResult> => {
        const result = await toolRegistry.call(
          "teaching.explainHarmony",
          { chordProgression, key, userLevel },
          { type: "user", name: "teaching-panel" },
        );
        const data = (result.data ?? {}) as Record<string, unknown>;
        return {
          status: result.status,
          explanation: convertAgentExplanation(data) ?? EMPTY_UI_EXPLANATION,
          confidence:
            typeof result.confidence === "number" ? result.confidence : undefined,
          raw: data,
        };
      },
      // TasteStore mutations run imperatively on the shared instance (it is a
      // mutable class, not an immutable snapshot). The reducer only bumps the
      // genomeVersion counter to trigger re-renders. Keeping the mutation out
      // of the reducer also avoids double-saves from StrictMode double-
      // invoking reducers in dev. Each creator captures `beforeGenome` (the
      // pre-edit genome) so the undo snapshot records the state undo() must
      // restore (Stage 2).
      updateTasteParameter: (paramKey: string, value: string): void => {
        const current = tasteStore.getCurrentGenome();
        if (!current) return;
        const param = current.getParameter(paramKey);
        if (!param) return;
        const beforeGenome = current.toJSON();
        current.setParameter(paramKey, { ...param, value });
        tasteStore.save(current);
        dispatch({
          type: "TASTE_GENOME_CHANGED",
          beforeGenome,
        } satisfies ProjectStoreAction);
      },
      revertTasteTo: (version: number): void => {
        const beforeGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        const restored = tasteStore.revertTo(version);
        if (restored) {
          dispatch({
            type: "TASTE_GENOME_CHANGED",
            beforeGenome,
          } satisfies ProjectStoreAction);
        }
      },
      deleteTasteEvidence: (paramKey: string, evidenceId: string): void => {
        const beforeGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        tasteStore.deleteEvidence(paramKey, evidenceId);
        dispatch({
          type: "TASTE_GENOME_CHANGED",
          beforeGenome,
        } satisfies ProjectStoreAction);
      },
      // Stage 0: Agent tool-call trace. id/timestamp are minted here (not in
      // the reducer) so the reducer stays pure — StrictMode double-invokes
      // reducers in dev, and randomUUID()/Date.now() would otherwise make the
      // result non-deterministic.
      recordToolCall: (record: NewToolCallRecord): void => {
        dispatch({
          type: "RECORD_TOOL_CALL",
          record: createToolCallRecord(record),
        } satisfies ProjectStoreAction);
      },
      clearToolCalls: (): void => {
        dispatch({ type: "CLEAR_TOOL_CALLS" } satisfies ProjectStoreAction);
      },
      // Stage 0 (.agentmusic): collect the live store state, serialize via
      // AgentMusicIO, and trigger a Blob download as project.agentmusic.
      // v1.17.0 Stage 1: snapshot collection is shared with the autosave
      // interval (collectAgentMusicSnapshot), so both surfaces stay in
      // lockstep by construction.
      saveProjectAsAgentMusic: async (): Promise<void> => {
        const data = collectAgentMusicSnapshot();
        const io = new AgentMusicIO();
        const bytes = await io.save(data);
        // .slice() copies into a plain Uint8Array<ArrayBuffer> — a valid
        // BlobPart without any cast.
        downloadBlob(new Blob([bytes.slice()], { type: "application/octet-stream" }), "project.agentmusic");
      },
      // v1.16.0 Stage 1: export the current notes (derived from the project
      // graph) as a Standard MIDI File via core MIDIExporter and download it
      // as project.mid. Notes are already NoteEvents; the exporter handles
      // sorting/tempo/meter events itself.
      exportMIDI: async (): Promise<void> => {
        const bytes = MIDIExporter.toBuffer(state.notes, TempoMap.default());
        downloadBlob(new Blob([bytes], { type: "audio/midi" }), "project.mid");
      },
      // v1.16.0 Stage 1: render the current score (layout + notes) to PDF via
      // core PDFExporter's browser-safe byte pipeline and download it as
      // project.pdf. The caller (App) passes the live score layout; the
      // fallback is a minimal full-score layout the exporter expands to its
      // default treble/bass staves.
      exportPDF: async (layout?: Layout): Promise<void> => {
        const exporter = new PDFExporter();
        const bytes = await exporter.exportToPDFBytes(
          layout ?? createLayout("Collinx Score", "full_score", []),
          state.notes,
          TempoMap.default(),
          { title: "Collinx Score" },
        );
        downloadBlob(
          // .slice() copies into a plain Uint8Array<ArrayBuffer> — a valid
          // BlobPart without any cast.
          new Blob([bytes.slice()], { type: "application/pdf" }),
          "project.pdf",
        );
      },
      // Stage 0 (.agentmusic): read the uploaded .agentmusic File, deserialize,
      // and restore the project through restoreFromAgentMusicData (which routes
      // through the existing store actions so diff history stays consistent).
      // Corrupt files throw — the caller (App) catches and surfaces the error.
      loadProjectFromAgentMusic: async (file: File): Promise<void> => {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const io = new AgentMusicIO();
        const data: AgentMusicData = await io.load(bytes);

        // v1.17.0 Stage 1: the restore API is shared with the autosave
        // crash-recovery path (buildRestoreApi), so a slot restore and a file
        // load route through exactly the same actions.
        await restoreFromAgentMusicData(data, buildRestoreApi());
      },
      // Stage 0 (.agentmusic load): replace the whole graph (notes re-derived in
      // the reducer). Exposed so restoreFromAgentMusicData can route through it.
      replaceGraph: (graph: ProjectGraph): void => {
        dispatch({ type: "REPLACE_GRAPH", graph } satisfies ProjectStoreAction);
      },
      // Stage 0 (.agentmusic load): restore the taste genome + version history.
      restoreTaste: (genome: TasteGenomeData | null, versions: GenomeVersionEntry[]): void => {
        const beforeGenome = tasteStore.getCurrentGenome()?.toJSON() ?? null;
        if (genome) {
          tasteStore.importPackage({
            packageVersion: 1,
            exportedAt: new Date().toISOString(),
            genome,
            evidence: [],
            versionHistory: versions,
          });
        }
        dispatch({
          type: "TASTE_RESTORE",
          genome,
          versions,
          beforeGenome,
        } satisfies ProjectStoreAction);
      },
      // v1.17.0 Stage 0 (.agentmusic load): rebuild the applied-diff history.
      // Same implementation as the local restoreApi in
      // loadProjectFromAgentMusic (kept in sync by construction).
      restoreDiffHistory: (
        appliedDiffs: DiffEnvelope[],
        rollbackSnapshots: Record<string, string>
      ): void => {
        diffEngine.importSnapshots(rollbackSnapshots);
        dispatch({
          type: "RESTORE_DIFF_HISTORY",
          appliedDiffs,
        } satisfies ProjectStoreAction);
      },
      // v1.17.0 Stage 1: crash recovery. The user clicking the TopBar
      // "restore autosave" entry IS the confirmation (no extra dialog).
      // Parses the pending slot payload and routes through the same restore
      // path as a .agentmusic file load, then clears the slots + the hint so
      // the entry disappears. Corrupt payload resolves silently (the scan
      // already filters most of it; belt and braces).
      restoreFromAutosave: async (): Promise<void> => {
        const recovery = autosaveRecoveryRef.current;
        if (!recovery) return;
        let data: AgentMusicData;
        try {
          const parsed = JSON.parse(recovery.payload) as {
            savedAt?: unknown;
            data?: AgentMusicData;
          };
          if (!parsed || typeof parsed.data !== "object" || parsed.data === null) {
            return;
          }
          data = parsed.data;
        } catch {
          return;
        }
        await restoreFromAgentMusicData(data, buildRestoreApi());
        // Recovery consumed: drop the slots (avoid stale hints) + the hint.
        clearAutosaveSlots();
        autosaveRecoveryRef.current = null;
        setAutosaveRecovery(null);
      },
    }),
    [tasteStore, state, buildRestoreApi, collectAgentMusicSnapshot]
  );

  const value = useMemo<ProjectStoreValue>(
    () => ({
      graph: state.graph,
      notes: state.notes,
      pendingDiffs: state.pendingDiffs,
      appliedDiffs: state.appliedDiffs,
      rejectedDiffs: state.rejectedDiffs,
      rollbackTokens: state.rollbackTokens,
      mixer: state.mixer,
      mixerDiffLog: state.mixerDiffLog,
      mixerRollbackSnapshots: state.mixerRollbackSnapshots,
      tasteStore: state.tasteStore,
      genomeVersion: state.genomeVersion,
      toolCalls: state.toolCalls,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      // Stage 0 (v2.1.0): expose the new tempo/meter first-class state.
      tempoChanges: state.tempoChanges,
      meterChanges: state.meterChanges,
      persistence: {
        enabled: Boolean(effectivePersistenceKey),
        lastSavedAt: lastPersistedAt,
      },
      autosaveRecovery: autosaveRecovery
        ? { savedAt: autosaveRecovery.savedAt }
        : null,
      actions,
      bus: agentBus,
    }),
    [state, actions, agentBus, effectivePersistenceKey, lastPersistedAt, autosaveRecovery]
  );

  return (
    <ProjectStoreContext.Provider value={value}>
      {children}
    </ProjectStoreContext.Provider>
  );
};

export default ProjectProvider;
