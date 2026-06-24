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
  MixerState,
  MixerTrack,
  createTrack,
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
import { AgentPanel, AgentChat } from "./components/Agent";
import type { ChatMessage } from "./components/Agent";
import { GraphView, NodeDetail } from "./components/KnowledgeGraph";
import type { ConnectedNode } from "./components/KnowledgeGraph";
import styles from "./App.module.css";
import {
  createDemoMixer,
  createDemoNotes,
  demoPhrases,
  createDefaultLayout,
  defaultHouseStyle,
  createDemoGraph,
  agentPendingDiffs,
  agentHistoryDiffs,
  createTasteStore,
} from "./data/demoData";

type TabId = "compose" | "arrange" | "orchestrate" | "mixer" | "score" | "taste" | "teaching" | "agent" | "graph";

interface TabDef {
  id: TabId;
  label: string;
}

const TAB_IDS: TabId[] = ["compose", "arrange", "orchestrate", "mixer", "score", "taste", "teaching", "agent", "graph"];

export function App() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("compose");

  const tabs: TabDef[] = useMemo(
    () => TAB_IDS.map((id) => ({ id, label: t(`app.tabs.${id}`) })),
    [t],
  );

  const translatedMotifs = useMemo(
    () => [
      { id: "motif_a", name: t("app.motifs.melody"), notes: [] },
      { id: "motif_b", name: t("app.motifs.bass"), notes: [] },
      { id: "motif_c", name: t("app.motifs.harmony"), notes: [] },
    ],
    [t],
  );
  const [notes, setNotes] = useState<NoteEvent[]>(createDemoNotes);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffReport, setDiffReport] = useState<TasteDiffReport | null>(null);
  const [arrangerDiff, setArrangerDiff] = useState<DiffEnvelope | null>(null);
  const [orchestratorConflicts, setOrchestratorConflicts] = useState<RegisterConflict[] | undefined>(undefined);
  const [scoreCollisions, setScoreCollisions] = useState<CollisionWarning[]>([]);
  const [storeVersion, setStoreVersion] = useState(0);
  const [mixer, setMixer] = useState<MixerState>(createDemoMixer);
  const [userLevel, setUserLevel] = useState<UserLevel>("intermediate");
  const [selectedGraphNode, setSelectedGraphNode] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  const tasteStore = useMemo(() => createTasteStore(), []);
  const defaultLayout = useMemo(() => createDefaultLayout(), []);
  const analyzer = useMemo(() => new ExportAnalyzer(), []);
  const generator = useMemo(() => new ReportGenerator(), []);

  const demoGraph = useMemo(() => createDemoGraph(translatedMotifs, t), [translatedMotifs, t]);

  const graphConnectedNodes: ConnectedNode[] = useMemo(() => {
    if (!selectedGraphNode) return [];
    const result: ConnectedNode[] = [];
    for (const edge of demoGraph.edges) {
      if (edge.source === selectedGraphNode) {
        const target = demoGraph.nodes.find((n) => n.id === edge.target);
        if (target) result.push({ id: target.id, type: target.type, edgeType: edge.type });
      }
      if (edge.target === selectedGraphNode) {
        const source = demoGraph.nodes.find((n) => n.id === edge.source);
        if (source) result.push({ id: source.id, type: source.type, edgeType: edge.type });
      }
    }
    return result;
  }, [selectedGraphNode, demoGraph]);

  const handleAgentApply = useCallback((diffId: string) => {
    console.log("Apply diff:", diffId);
  }, []);
  const handleAgentReject = useCallback((diffId: string) => {
    console.log("Reject diff:", diffId);
  }, []);
  const handleAgentRollback = useCallback((rollbackToken: string) => {
    console.log("Rollback:", rollbackToken);
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setIsAgentTyping(true);

    setTimeout(() => {
      const agentResponse: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        content: `我收到了你的消息："${content}"。作为音乐创作助手，我可以帮助你处理和弦进行、旋律生成、编曲建议等任务。请告诉我你需要什么帮助？`,
        timestamp: new Date(),
        agentName: "HarmonyBot",
      };
      setChatMessages((prev) => [...prev, agentResponse]);
      setIsAgentTyping(false);
    }, 1500);
  }, []);
  const tempoMap = useMemo(() => TempoMap.default(), []);

  const genome = useMemo(() => tasteStore.getCurrentGenome(), [storeVersion, tasteStore]);

  const handleNoteAdd = (note: Omit<NoteEvent, "id">) => {
    const newNote = createNoteEvent(note);
    setNotes((prev) => [...prev, newNote]);
  };

  const handleNoteMove = (noteId: string, newBar: number, newBeat: number, newPitch: number) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, bar: newBar, beat: newBeat, pitchMidi: newPitch, pitchSpelling: "" } : n
      )
    );
  };

  const handleNoteResize = (noteId: string, newDurQn: number) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, durQn: newDurQn } : n))
    );
  };

  const handleNoteDelete = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    setSelectedIds((prev) => prev.filter((id) => id !== noteId));
  };

  const handleSelectVersion = useCallback((_version: number) => {
  }, []);

  const handleRevertTo = useCallback((version: number) => {
    const restored = tasteStore.revertTo(version);
    if (restored) {
      setStoreVersion((v) => v + 1);
    }
  }, [tasteStore]);

  const handleParameterEdit = useCallback((paramKey: string, value: string) => {
    const current = tasteStore.getCurrentGenome();
    if (!current) return;
    const param = current.getParameter(paramKey);
    if (!param) return;
    current.setParameter(paramKey, { ...param, value });
    tasteStore.save(current);
    setStoreVersion((v) => v + 1);
  }, [tasteStore]);

  const handleDeleteEvidence = useCallback((paramKey: string, evidenceId: string) => {
    tasteStore.deleteEvidence(paramKey, evidenceId);
    setStoreVersion((v) => v + 1);
  }, [tasteStore]);

  const handleExportAnalysis = useCallback(() => {
    const current = tasteStore.getCurrentGenome();
    if (!current) return;
    const result = analyzer.analyze(notes, tempoMap, current);
    const report = generator.generate(result, current);
    setDiffReport(report);
  }, [notes, tempoMap, tasteStore, analyzer, generator]);

  const handleConfirmWrite = useCallback((_evidenceIds: string[]) => {
    setDiffReport(null);
    setStoreVersion((v) => v + 1);
  }, []);

  const handleIgnore = useCallback((_evidenceIds: string[]) => {
  }, []);

  const handleWriteToReject = useCallback((_evidenceIds: string[]) => {
    setStoreVersion((v) => v + 1);
  }, []);

  const handleApplyArrangerDiff = useCallback((diff: DiffEnvelope) => {
    setArrangerDiff(diff);
  }, []);

  const handleOrchestrate = useCallback((_config: OrchestratorConfig) => {
    const sampleConflicts: RegisterConflict[] = [
      {
        type: "range_violation",
        players: ["violin", ""],
        bar: 1,
        beat: 1,
        description: "Violin: note 50 below lowest register 55",
        severity: "error",
        suggestion: "Move note up 5 semitones, or assign to another instrument",
      },
      {
        type: "overlap",
        players: ["violin", "viola"],
        bar: 2,
        beat: 1,
        description: "Violin and Viola register overlap (28 semitones)",
        severity: "warning",
        suggestion: "Separate Violin and Viola by at least one octave",
      },
    ];
    setOrchestratorConflicts(sampleConflicts);
  }, []);

  const handleSectionDoubleClick = useCallback((phraseId: string) => {
    const phrase = demoPhrases.find((p) => p.id === phraseId);
    if (phrase) {
      setActiveTab("compose");
    }
  }, []);

  const handleMixerTrackChange = useCallback(
    (trackId: string, changes: Partial<MixerTrack>) => {
      setMixer((prev) => {
        if (prev.masterTrack.id === trackId) {
          return { ...prev, masterTrack: { ...prev.masterTrack, ...changes } };
        }
        return {
          ...prev,
          tracks: prev.tracks.map((t) =>
            t.id === trackId ? { ...t, ...changes } : t,
          ),
        };
      });
    },
    [],
  );

  const handleMixerAddTrack = useCallback(
    (name: string, sourceId: string) => {
      setMixer((prev) => ({
        ...prev,
        tracks: [...prev.tracks, createTrack(name, sourceId)],
      }));
    },
    [],
  );

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
        return t("app.status.stavesInfo", { count: defaultLayout.staffConfig.length, format: "A4" });
      case "taste":
        return t("app.status.genomeVersion", { version: tasteStore.getVersion() });
      case "teaching":
        return arrangerDiff ? t("app.status.activePlan") : t("app.status.pendingActivation");
      case "agent":
        return t("app.status.pending", { count: agentPendingDiffs.length });
      case "graph":
        return t("app.status.nodes", { count: demoGraph.nodes.length });
      default:
        return "";
    }
  }, [activeTab, notes.length, mixer.tracks.length, tasteStore, arrangerDiff, defaultLayout.staffConfig.length, t, demoGraph.nodes.length]);

  return (
    <div className={styles.appRoot}>
      <header className={styles.header}>
        <span className={styles.headerBrand}>Collinx</span>
        <span className={styles.headerVersion}>v0.6.0</span>

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

        <span className={styles.headerStatus}>
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
            <AgentChat
              messages={chatMessages}
              onSendMessage={handleSendMessage}
              isTyping={isAgentTyping}
              agentName="HarmonyBot"
            />
          </div>
          <div className={styles.agentPanelContainer}>
            <AgentPanel
              pendingDiffs={agentPendingDiffs}
              historyDiffs={agentHistoryDiffs}
              onApply={handleAgentApply}
              onReject={handleAgentReject}
              onRollback={handleAgentRollback}
            />
          </div>
        </div>
      )}

      {activeTab === "graph" && (
        <div className={styles.graphLayout} data-testid="graph-layout">
          <GraphView
            graph={demoGraph}
            onNodeClick={setSelectedGraphNode}
          />
          {selectedGraphNode && (() => {
            const node = demoGraph.nodes.find((n) => n.id === selectedGraphNode);
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
