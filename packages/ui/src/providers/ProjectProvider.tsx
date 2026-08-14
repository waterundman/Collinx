import React, {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AgentBus,
  DiffEngine,
  ToolRegistry,
  TasteGenome,
  deserializeGraph,
  type NoteEvent,
  type DiffEnvelope,
  type MixerState,
  type MixerTrack,
  type TasteStore,
  type TasteGenomeData,
  createDiffEnvelope,
  createNoteEvent,
  createToolCallRecord,
  type NewToolCallRecord,
} from "@collinx/core";
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
  type TeachingConfigInput,
  type TeachingRunResult,
  convertAgentCollisions,
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

  // Initial project graph + demo notes + a small set of demo proposals.
  // When a persisted project is restored, its own proposal queue wins and the
  // demo proposals (which reference a fresh graph's revision) are skipped.
  const initialPendingDiffs = useMemo<DiffEnvelope[]>(() => {
    if (persisted) return [];
    // Build proposals against a fresh graph so baseRevision matches.
    const probe = createInitialState({ title });
    return [
      createDiffEnvelope({
        baseRevision: probe.graph.getRevisionId(),
        actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
        permissionScope: "proposal_only",
        summary: "Add a chorus phrase to the arrangement",
        ops: [
          {
            op: "add_node",
            path: "/",
            nodeType: "Phrase",
            data: { name: "Chorus", formRole: "chorus", startBar: 4, endBar: 5, motifIds: [] },
          },
        ],
      }),
      createDiffEnvelope({
        baseRevision: probe.graph.getRevisionId(),
        actor: { type: "agent", name: "BassAgent", model: "claude-3" },
        permissionScope: "proposal_only",
        summary: "Add a bass fill in bar 2",
        ops: [
          {
            op: "add_note_group",
            path: "/",
            notes: [createNoteEvent({ trackId: "bass", bar: 2, beat: 1, durQn: 0.5, pitchMidi: 43 })],
          },
        ],
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return createInitialState({
        title,
        initialNotes: initialNotes ?? createDemoNotes(),
        pendingDiffs: [...initialPendingDiffs, ...(pendingDiffs ?? [])],
        mixer: initialMixer,
        tasteStore,
      });
    }
  );

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

  // Register a minimal "compose" agent for Stage 1 groundwork.
  useEffect(() => {
    agentBus.registerAgent("compose", async (msg) => {
      if (msg.type === "request") {
        const prompt = (msg.payload as { prompt?: string } | undefined)?.prompt ?? "";
        await agentBus.send(
          "compose",
          msg.from,
          "response",
          {
            kind: "text",
            text: `[compose] Rule-based response for "${prompt}": suggested progression C-Am-F-G`,
          },
          msg.correlationId
        );
      }
    });
    return () => {
      agentBus.unregisterAgent("compose");
    };
  }, [agentBus]);

  const actions = useMemo(
    () => ({
      applyDiff: (diff: DiffEnvelope): string => {
        dispatch({ type: "APPLY_DIFF", diff } satisfies ProjectStoreAction);
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
      suggestMixingChain: (): void => {
        const currentMixer = state.mixer;
        const mixing = mixingAgent;
        const analysis = mixing.suggestMix(currentMixer.tracks, state.notes);
        const envelope = mixing.toDiffEnvelope(analysis, currentMixer);
        dispatch({
          type: "ADD_PENDING_DIFFS",
          diffs: [envelope],
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
      runOrchestrator: async (
        config: OrchestratorConfigInput,
      ): Promise<OrchestratorRunResult> => {
        const result = await toolRegistry.call(
          "orchestrator.voicingPlan",
          {
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
            diffs,
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
            diffs,
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
    }),
    [tasteStore, state]
  );

  const value = useMemo<ProjectStoreValue>(
    () => ({
      graph: state.graph,
      notes: state.notes,
      pendingDiffs: state.pendingDiffs,
      appliedDiffs: state.appliedDiffs,
      rollbackTokens: state.rollbackTokens,
      mixer: state.mixer,
      mixerDiffLog: state.mixerDiffLog,
      mixerRollbackSnapshots: state.mixerRollbackSnapshots,
      tasteStore: state.tasteStore,
      genomeVersion: state.genomeVersion,
      toolCalls: state.toolCalls,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      persistence: {
        enabled: Boolean(effectivePersistenceKey),
        lastSavedAt: lastPersistedAt,
      },
      actions,
      bus: agentBus,
    }),
    [state, actions, agentBus, effectivePersistenceKey, lastPersistedAt]
  );

  return (
    <ProjectStoreContext.Provider value={value}>
      {children}
    </ProjectStoreContext.Provider>
  );
};

export default ProjectProvider;
