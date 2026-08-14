import React, { useState, useMemo, useCallback } from "react";
import { useI18n } from "./i18n";
import {
  NoteEvent,
  TempoMap,
  createNoteEvent,
  TasteGenome,
  TasteDiffReport,
  ReportGenerator,
  ExportAnalyzer,
  DiffEnvelope,
  MixerTrack,
} from "@collinx/core";
import { PianoRollView } from "./components/PianoRoll/PianoRollView";
import { ScorePanel } from "./components/Score";
import type { CollisionWarning } from "./components/Score";
import { ArrangementView } from "./components/Arrangement/ArrangementView";
import { ArrangerPanel } from "./components/Arranger";
import { OrchestratorPanel } from "./components/Orchestrator";
import type { OrchestratorConfig, RegisterConflict } from "./components/Orchestrator";
import { MixerConsole } from "./components/Mixer";
import { TasteTimelineView } from "./components/Taste/TasteTimelineView";
import { TasteLibraryPanel } from "./components/Taste/TasteLibraryPanel";
import { TasteDiffPanel } from "./components/Taste/TasteDiffPanel";
import { TeachingPanel } from "./components/Teaching";
import type { UserLevel } from "./components/Teaching";
import { AgentPanel, AgentChat, ToolCallTimeline } from "./components/Agent";
import { GraphView, NodeDetail } from "./components/KnowledgeGraph";
import type { ConnectedNode, GraphData } from "./components/KnowledgeGraph";
import styles from "./App.module.css";
import {
  demoPhrases,
  createDefaultLayout,
  defaultHouseStyle,
} from "./data/demoData";
import { useProjectStore } from "./hooks/useProjectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type {
  ArrangerConfigInput,
  ArrangerRunResult,
} from "./store/project-store";

type TabId = "compose" | "arrange" | "orchestrate" | "mixer" | "score" | "taste" | "teaching" | "agent" | "graph";

interface TabDef {
  id: TabId;
  label: string;
}

const TAB_IDS: TabId[] = ["compose", "arrange", "orchestrate", "mixer", "score", "taste", "teaching", "agent", "graph"];

export function App() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("compose");

  // Stage 1/2: real diff/rollback state + AgentBus + notes/graph from the
  // project store. Notes and graph are single source of truth in ProjectGraph.
  // TasteStore and genomeVersion also come from the store (Stage 1): the
  // store owns the TasteStore instance and bumps genomeVersion on mutation.
  const {
    notes,
    graph,
    pendingDiffs,
    appliedDiffs,
    mixer,
    tasteStore,
    genomeVersion,
    toolCalls,
    actions,
  } = useProjectStore();

  // Stage 2: global Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) composite undo/redo.
  // Input/textarea/contentEditable targets are excluded inside the hook, so
  // text editing keeps the native browser undo.
  useKeyboardShortcuts({ onUndo: actions.undo, onRedo: actions.redo });

  const tabs: TabDef[] = useMemo(
    () => TAB_IDS.map((id) => ({ id, label: t(`app.tabs.${id}`) })),
    [t],
  );

  // Stage 1: the Arranger panel receives real source material, not empty note
  // arrays. Notes are segmented by track into melody/bass/harmony motifs;
  // when no trackId matches (e.g. a custom import) the full note set backs the
  // melody slot so the real Arranger still has notes to expand.
  const translatedMotifs = useMemo(() => {
    const byTrack = (trackId: string) =>
      notes.filter((n) => n.trackId === trackId);
    const melody = byTrack("melody");
    const fallback = notes.length > 0 ? notes : [];
    return [
      { id: "motif_a", name: t("app.motifs.melody"), notes: melody.length > 0 ? melody : fallback },
      { id: "motif_b", name: t("app.motifs.bass"), notes: byTrack("bass") },
      { id: "motif_c", name: t("app.motifs.harmony"), notes: byTrack("chords") },
    ];
  }, [t, notes]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffReport, setDiffReport] = useState<TasteDiffReport | null>(null);
  const [arrangerDiff, setArrangerDiff] = useState<DiffEnvelope | null>(null);
  const [orchestratorConflicts, setOrchestratorConflicts] = useState<RegisterConflict[] | undefined>(undefined);
  const [scoreCollisions, setScoreCollisions] = useState<CollisionWarning[]>([]);
  const [userLevel, setUserLevel] = useState<UserLevel>("intermediate");
  const [selectedGraphNode, setSelectedGraphNode] = useState<string | null>(null);

  const defaultLayout = useMemo(() => createDefaultLayout(), []);
  const analyzer = useMemo(() => new ExportAnalyzer(), []);
  const generator = useMemo(() => new ReportGenerator(), []);

  // Stage 2: adapt the store's ProjectGraph (core class) to the pure-data
  // GraphData shape consumed by GraphView. GraphView itself is untouched.
  const graphData: GraphData = useMemo(
    () => ({
      nodes: graph.getAllNodes().map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data as Record<string, unknown>,
      })),
      edges: graph.getAllEdges().map((e) => ({
        source: e.source_id,
        target: e.target_id,
        type: e.type,
      })),
    }),
    [graph],
  );

  const graphConnectedNodes: ConnectedNode[] = useMemo(() => {
    if (!selectedGraphNode) return [];
    const result: ConnectedNode[] = [];
    for (const edge of graphData.edges) {
      if (edge.source === selectedGraphNode) {
        const target = graphData.nodes.find((n) => n.id === edge.target);
        if (target) result.push({ id: target.id, type: target.type, edgeType: edge.type });
      }
      if (edge.target === selectedGraphNode) {
        const source = graphData.nodes.find((n) => n.id === edge.source);
        if (source) result.push({ id: source.id, type: source.type, edgeType: edge.type });
      }
    }
    return result;
  }, [selectedGraphNode, graphData]);

  const handleAgentApply = useCallback(
    (diffId: string) => {
      const diff = pendingDiffs.find((d) => d.diffId === diffId);
      if (diff) actions.applyDiff(diff);
    },
    [pendingDiffs, actions]
  );
  const handleAgentReject = useCallback(
    (diffId: string) => {
      actions.rejectDiff(diffId);
    },
    [actions]
  );
  const handleAgentRollback = useCallback(
    (rollbackToken: string) => {
      try {
        actions.rollbackDiff(rollbackToken);
      } catch {
        // Invalid/expired token: DiffEngine.rollback may throw. The reducer
        // guards this as well; we simply keep the current graph state.
      }
    },
    [actions]
  );

  const tempoMap = useMemo(() => TempoMap.default(), []);

  const genome = useMemo(() => tasteStore.getCurrentGenome(), [genomeVersion, tasteStore]);

  const handleNoteAdd = (note: Omit<NoteEvent, "id">) => {
    const newNote = createNoteEvent(note);
    actions.addNote(newNote);
  };

  const handleNoteMove = (noteId: string, newBar: number, newBeat: number, newPitch: number) => {
    actions.moveNote(noteId, newBar, newBeat, newPitch);
  };

  const handleNoteResize = (noteId: string, newDurQn: number) => {
    actions.resizeNote(noteId, newDurQn);
  };

  const handleNoteDelete = (noteId: string) => {
    actions.deleteNote(noteId);
    setSelectedIds((prev) => prev.filter((id) => id !== noteId));
  };

  const handleSelectVersion = useCallback((_version: number) => {
  }, []);

  const handleRevertTo = useCallback((version: number) => {
    actions.revertTasteTo(version);
  }, [actions]);

  const handleParameterEdit = useCallback((paramKey: string, value: string) => {
    actions.updateTasteParameter(paramKey, value);
  }, [actions]);

  const handleDeleteEvidence = useCallback((paramKey: string, evidenceId: string) => {
    actions.deleteTasteEvidence(paramKey, evidenceId);
  }, [actions]);

  const handleExportAnalysis = useCallback(() => {
    const current = tasteStore.getCurrentGenome();
    if (!current) return;
    const result = analyzer.analyze(notes, tempoMap, current);
    const report = generator.generate(result, current);
    setDiffReport(report);
  }, [notes, tempoMap, tasteStore, analyzer, generator]);

  const handleConfirmWrite = useCallback((_evidenceIds: string[]) => {
    setDiffReport(null);
  }, []);

  const handleIgnore = useCallback((_evidenceIds: string[]) => {
  }, []);

  const handleWriteToReject = useCallback((_evidenceIds: string[]) => {
  }, []);

  const handleApplyArrangerDiff = useCallback((diff: DiffEnvelope) => {
    setArrangerDiff(diff);
  }, []);

  // Stage 0: the Orchestrator panel runs the real Orchestrator agent through
  // the shared ToolRegistry (orchestrator.voicingPlan). The returned conflicts
  // come from the agent's RegisterConflictDetector, not from sample data; the
  // proposal diffs are already enqueued into pendingDiffs by the action.
  const handleOrchestrate = useCallback(async (config: OrchestratorConfig) => {
    const result = await actions.runOrchestrator(config);
    setOrchestratorConflicts(result.conflicts);
  }, [actions]);

  // Stage 1: the Arranger panel runs the real Arranger agent through the
  // shared ToolRegistry (arranger.expandSection). Returned variants come from
  // the agent's Arranger, not the panel's local demo generator; the proposal
  // diffs are already enqueued into pendingDiffs by the action.
  const handleRunArranger = useCallback(
    async (config: ArrangerConfigInput): Promise<ArrangerRunResult> => {
      return actions.runArranger(config);
    },
    [actions],
  );

  const handleSectionDoubleClick = useCallback((phraseId: string) => {
    const phrase = demoPhrases.find((p) => p.id === phraseId);
    if (phrase) {
      setActiveTab("compose");
    }
  }, []);

  const handleMixerTrackChange = useCallback(
    (trackId: string, changes: Partial<MixerTrack>) => {
      actions.updateMixerTrack(trackId, changes);
    },
    [actions],
  );

  const handleMixerAddTrack = useCallback(
    (name: string, sourceId: string) => {
      actions.addMixerTrack(name, sourceId);
    },
    [actions],
  );

  // Stage 2: Mixing Agent trigger. Generates the proposal into pendingDiffs,
  // then jumps to the Agent Panel so the user sees and reviews it.
  const handleSuggestFxChain = useCallback(() => {
    actions.suggestMixingChain();
    setActiveTab("agent");
  }, [actions]);

  const handleAutoLayout = useCallback(() => {
    const sampleCollisions: CollisionWarning[] = [
      {
        type: "symbol_overlap",
        staveIndex: 0,
        bar: 2,
        beat: 1,
        description: "F#4 notehead collides with B4 notehead",
        severity: "error",
        fixSuggestion: "Offset F#4 by +1 unit or adjust width",
      },
      {
        type: "slur_cross",
        staveIndex: 0,
        bar: 1,
        beat: 3,
        description: "Slur crosses rest, creating ambiguity",
        severity: "warning",
        fixSuggestion: "Split slur into two segments to avoid crossing rest",
      },
    ];
    setScoreCollisions(sampleCollisions);
  }, []);

  const handleExtractParts = useCallback(() => {
  }, []);

  const handleExportMusicXML = useCallback(() => {
  }, []);

  const headerStatus = useMemo(() => {
    switch (activeTab) {
      case "compose":
        return t("app.status.notesCount", { count: notes.length });
      case "arrange":
        return t("app.status.arranger");
      case "orchestrate":
        return t("app.status.orchestrator");
      case "mixer":
        return t("app.status.tracksCount", { count: mixer.tracks.length });
      case "score":
        return t("app.status.stavesInfo", { count: defaultLayout.staffConfig?.length ?? 0, format: "A4" });
      case "taste":
        return t("app.status.genomeVersion", { version: tasteStore.getVersion() });
      case "teaching":
        return arrangerDiff ? t("app.status.activePlan") : t("app.status.pendingActivation");
      case "agent":
        return t("app.status.pending", { count: pendingDiffs.length });
      case "graph":
        return t("app.status.nodes", { count: graphData.nodes.length });
      default:
        return "";
    }
  }, [activeTab, notes.length, mixer.tracks.length, tasteStore, genomeVersion, arrangerDiff, defaultLayout.staffConfig?.length ?? 0, t, graphData.nodes.length, pendingDiffs.length]);

  return (
    <div className={styles.appRoot}>
      <header className={styles.header}>
        <span className={styles.headerBrand}>Collinx</span>

        <div className={styles.tabBar} data-testid="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className={styles.headerStatus} data-testid="header-status">
          {headerStatus}
        </span>
      </header>

      {activeTab === "compose" && (
        <div className={styles.composeLayout} data-testid="compose-layout">
          <div className={styles.composeArrangement}>
            <ArrangementView
              phrases={demoPhrases}
              totalBars={16}
              onSectionDoubleClick={handleSectionDoubleClick}
            />
          </div>

          <div className={styles.composeMain}>
            <div className={styles.composeScore}>
              <ScorePanel
                layout={defaultLayout}
                notes={notes}
                houseStyle={defaultHouseStyle}
                compact
              />
            </div>

            <div className={styles.composePianoRoll}>
              <PianoRollView
                notes={notes}
                tempoMap={tempoMap}
                viewRange={{ startBar: 1, endBar: 8 }}
                selectedNoteIds={selectedIds}
                onNoteAdd={handleNoteAdd}
                onNoteMove={handleNoteMove}
                onNoteResize={handleNoteResize}
                onNoteDelete={handleNoteDelete}
                onNoteSelect={setSelectedIds}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "arrange" && (
        <div className={styles.sectionRow} data-testid="arrange-layout">
          <div className={styles.sectionColumn}>
            <div className={styles.sectionMargin}>
              <ArrangementView
                phrases={demoPhrases}
                totalBars={16}
                onSectionDoubleClick={handleSectionDoubleClick}
              />
            </div>

            {arrangerDiff && (
              <div className={styles.diffInfoBox}>
                <div className={styles.diffInfoTitle}>
                  {t("app.arrange.planReady")}
                </div>
                <div className={styles.diffInfoSummary}>{arrangerDiff.summary}</div>
                <div className={styles.diffInfoMeta}>
                  {t("app.arrange.opsAndExplanations", { ops: arrangerDiff.ops.length, explanations: arrangerDiff.domainExplanations.length })}
                </div>
              </div>
            )}
          </div>

          <ArrangerPanel
            motifs={translatedMotifs}
            genome={genome}
            onApplyDiff={handleApplyArrangerDiff}
            onRunArranger={handleRunArranger}
          />
        </div>
      )}

      {activeTab === "orchestrate" && (
        <div className={styles.sectionRow} data-testid="orchestrate-layout">
          <div className={styles.sectionColumn}>
            <div className={styles.sectionMargin}>
              <ArrangementView
                phrases={demoPhrases}
                totalBars={16}
                onSectionDoubleClick={handleSectionDoubleClick}
              />
            </div>

            {orchestratorConflicts && orchestratorConflicts.length > 0 ? (
              <div className={styles.diffInfoBox}>
                <div className={styles.diffInfoTitle}>
                  {t("app.orchestrate.planReady")}
                </div>
                <div className={styles.diffInfoSummary}>
                  {t("app.orchestrate.conflictsDetected", { count: orchestratorConflicts.length })}
                </div>
                <div className={styles.diffInfoMeta}>
                  {t("app.orchestrate.errorsAndWarnings", { errors: orchestratorConflicts.filter((c) => c.severity === "error").length, warnings: orchestratorConflicts.filter((c) => c.severity === "warning").length })}
                </div>
              </div>
            ) : (
              <div className={styles.emptyHint}>
                {t("app.orchestrate.hint")}
              </div>
            )}
          </div>

          <OrchestratorPanel
            harmony={[]}
            onOrchestrate={handleOrchestrate}
            conflicts={orchestratorConflicts}
          />
        </div>
      )}

      {activeTab === "mixer" && (
        <div className={styles.mixerFill} data-testid="mixer-layout">
          <MixerConsole
            mixer={mixer}
            onTrackChange={handleMixerTrackChange}
            onAddTrack={handleMixerAddTrack}
            onSuggestFxChain={handleSuggestFxChain}
          />
        </div>
      )}

      {activeTab === "score" && (
        <div className={styles.mixerFill} data-testid="score-layout">
          <ScorePanel
            layout={defaultLayout}
            notes={notes}
            houseStyle={defaultHouseStyle}
            collisions={scoreCollisions.length > 0 ? scoreCollisions : undefined}
            onAutoLayout={handleAutoLayout}
            onExtractParts={handleExtractParts}
            onExportMusicXML={handleExportMusicXML}
          />
        </div>
      )}

      {activeTab === "taste" && (
        <div className={styles.tasteLayout} data-testid="taste-layout">
          <div className={styles.tasteToolbar}>
            <button
              onClick={handleExportAnalysis}
              className={styles.tasteButton}
              data-testid="taste-analyze-export"
            >
              {t("app.taste.analyzeExport")}
            </button>
          </div>

          <div className={styles.tasteContent}>
            <div className={styles.tasteTimeline}>
              <TasteTimelineView
                store={tasteStore}
                onSelectVersion={handleSelectVersion}
                onRevertTo={handleRevertTo}
              />
            </div>
            <div className={styles.tasteLibrary}>
              <TasteLibraryPanel
                genome={genome}
                onParameterEdit={handleParameterEdit}
                onDeleteEvidence={handleDeleteEvidence}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "teaching" && (
        <div className={styles.mixerFill} data-testid="teaching-layout">
          <TeachingPanel
            activeDiff={arrangerDiff ?? undefined}
            userLevel={userLevel}
            onLevelChange={setUserLevel}
          />
        </div>
      )}

      {activeTab === "agent" && (
        <div className={styles.agentLayout} data-testid="agent-layout">
          <div className={styles.agentChatContainer}>
            <AgentChat agentName="HarmonyBot" />
          </div>
          <div className={styles.agentPanelContainer}>
            <div className={styles.agentPanelSection}>
              <AgentPanel
                pendingDiffs={pendingDiffs}
                historyDiffs={appliedDiffs}
                onApply={handleAgentApply}
                onReject={handleAgentReject}
                onRollback={handleAgentRollback}
              />
            </div>
            <div className={styles.agentTimelineSection}>
              <ToolCallTimeline toolCalls={toolCalls} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "graph" && (
        <div className={styles.graphLayout} data-testid="graph-layout">
          <GraphView
            graph={graphData}
            onNodeClick={setSelectedGraphNode}
          />
          {selectedGraphNode && (() => {
            const node = graphData.nodes.find((n) => n.id === selectedGraphNode);
            if (!node) return null;
            return (
              <NodeDetail
                node={node}
                connectedNodes={graphConnectedNodes}
                onClose={() => setSelectedGraphNode(null)}
              />
            );
          })()}
        </div>
      )}

      {diffReport && (
        <TasteDiffPanel
          report={diffReport}
          onConfirmWrite={handleConfirmWrite}
          onIgnore={handleIgnore}
          onWriteToReject={handleWriteToReject}
        />
      )}
    </div>
  );
}
