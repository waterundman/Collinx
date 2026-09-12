import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  MusicXMLIO,
  midiToSpelling,
  notesToHarmonyEntries,
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
import { TopBar, TabPill } from "./components/Shell";
import { SettingsPage } from "./components/Settings";
import styles from "./App.module.css";
import {
  createDefaultLayout,
  defaultHouseStyle,
} from "./data/demoData";
import { useProjectStore } from "./hooks/useProjectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useMidiInput } from "./hooks/useMidiInput";
import { useMidiOutput } from "./hooks/useMidiOutput";
import { useSettings } from "./hooks/useSettings";
import { elapsedToBeats, snapBeat } from "./services/midi-quantize";
import type {
  ArrangerConfigInput,
  ArrangerRunResult,
  UiExplanation,
} from "./store/project-store";
import { mapUiLevelToAgent } from "./store/project-store";

type TabId = "compose" | "arrange" | "orchestrate" | "mixer" | "score" | "taste" | "teaching" | "agent" | "graph";

interface TabDef {
  id: TabId;
  label: string;
}

const TAB_IDS: TabId[] = ["compose", "arrange", "orchestrate", "mixer", "score", "taste", "teaching", "agent", "graph"];

/**
 * v1.17.0 Stage 1: formats an autosave snapshot ISO timestamp as HH:MM for
 * the TopBar recovery entry ("恢复自动保存 (14:32)"). Empty string for an
 * unparsable timestamp (button falls back to the plain label via i18n).
 */
function formatAutosaveTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * v1.26.0 Stage 1 (D2-1): noteoff 落盘计算纯辅助函数。
 *
 * - durQn = clamp(elapsedMs→拍, 0.25, 8)（elapsed<=0 → 0 拍走 clamp 下限）
 * - landing = snapBeat(cursor.beat, grid)；landing > 4 → bar 回绕（4/4）
 * - cursor 前进：从落盘位置起 landing + durQn，beat > 4 → bar 回绕
 *   （量化落点 + 实测时长，下一音从上一音结束处开始）
 *
 * 抽成纯函数的原因：landing>4 回绕分支在 cursor 恒有界的运行时不变量下
 * （每次步进后 while 归位）不可经公开 MIDI API 直达，纯函数直测可覆盖
 * 该防御分支；集成层用 1.3 拍序列覆盖 cursor 回绕 → 落点进下一小节。
 */
export interface NoteOffPlacement {
  /** 落盘位置（已回绕） */
  bar: number;
  beat: number;
  durQn: number;
  /** cursor 前进后的位置 */
  nextCursor: { bar: number; beat: number };
}

export function computeNoteOffPlacement(input: {
  cursor: { bar: number; beat: number };
  elapsedMs: number;
  bpm: number;
  grid: number;
}): NoteOffPlacement {
  const { cursor, elapsedMs, bpm, grid } = input;
  const beats = elapsedToBeats(elapsedMs, bpm);
  const durQn = Math.min(8, Math.max(0.25, beats));
  let bar = cursor.bar;
  let landing = snapBeat(cursor.beat, grid);
  while (landing > 4) {
    bar += 1;
    landing -= 4;
  }
  let nextBar = bar;
  let nextBeat = landing + durQn;
  while (nextBeat > 4) {
    nextBar += 1;
    nextBeat -= 4;
  }
  return {
    bar,
    beat: landing,
    durQn,
    nextCursor: { bar: nextBar, beat: nextBeat },
  };
}

/** v1.29.0 Stage 1 (D2-3): 试听音符发声时长（ms）。最小闭环固定值，非设置项。 */
const AUDITION_DURATION_MS = 300;

/**
 * v1.29.0 Stage 1 (D2-3): 归一化 velocity(0-1) → MIDI velocity(1-127) 纯函数。
 * NoteEvent.velocity 为 0-1（落盘时由 entry.velocity / 127 得到，见
 * handleMidiNoteOff）；试听落点为其逆运算：先 round(v*127) 取整，再 clamp
 * 到 MIDI 合法区间 [1,127]（velocity 0 在多数合成器上等价 note off，故下界
 * 取 1）。抽为导出纯函数以对齐 computeNoteOffPlacement 先例，便于直测。
 */
export function computeAuditionVelocity(normalizedVelocity01: number): number {
  return Math.max(1, Math.min(127, Math.round(normalizedVelocity01 * 127)));
}

export function App() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("compose");

  // v1.24.0 Stage 1 (D1-1): settings modal open state — SettingsPage is a
  // role="dialog" modal that unmounts conditionally (Escape handled inside
  // SettingsPage via its onClose prop).
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    autosaveRecovery,
    actions,
  } = useProjectStore();

  // v1.14: the store rebuilds `actions` whenever its state changes (RECORD_TOOL_CALL
  // from a tool run mutates state), so the actions reference is unstable across
  // renders. Reading it through a ref keeps the teaching effect's dependency
  // array stable — otherwise actions.runTeaching -> RECORD_TOOL_CALL -> state
  // change -> actions rebuilt -> effect re-run forms an infinite loop.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Stage 0 (.agentmusic): hidden file input for loading a .agentmusic project.
  const projectFileInputRef = useRef<HTMLInputElement>(null);

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

  // v1.18.0 Stage 0: the ArrangementView tabs receive REAL phrases derived
  // from the project graph's Phrase nodes (single source of truth), never the
  // demo template data. Projection mirrors the demo proposal payload
  // (ProjectProvider add_node Phrase): name/formRole/startBar/endBar.
  // Defensive defaults keep hand-crafted / partial nodes from crashing the
  // view; nodes are ordered by startBar so blocks render left-to-right.
  const storePhrases = useMemo(() => {
    return graph
      .getNodesByType("Phrase")
      .map((n) => {
        const d = (n.data ?? {}) as Record<string, unknown>;
        return {
          id: n.id,
          name: typeof d.name === "string" ? d.name : "",
          startBar: typeof d.startBar === "number" ? d.startBar : 1,
          endBar:
            typeof d.endBar === "number"
              ? d.endBar
              : typeof d.startBar === "number"
                ? d.startBar
                : 1,
          formRole: typeof d.formRole === "string" ? d.formRole : "verse",
        };
      })
      .sort((a, b) => a.startBar - b.startBar);
  }, [graph]);

  // v1.18.0 Stage 0: arrangement timeline length derived from the real data —
  // the larger of the deepest note bar and the deepest phrase endBar. The
  // minimum of 16 preserves the default viewport when the project is short,
  // matching the previous hardcoded totalBars={16} view span.
  const totalBars = useMemo(() => {
    const maxNoteBar = notes.reduce((max, n) => Math.max(max, n.bar), 0);
    const maxPhraseBar = storePhrases.reduce(
      (max, p) => Math.max(max, p.endBar),
      0,
    );
    return Math.max(16, maxNoteBar, maxPhraseBar);
  }, [notes, storePhrases]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffReport, setDiffReport] = useState<TasteDiffReport | null>(null);
  const [arrangerDiff, setArrangerDiff] = useState<DiffEnvelope | null>(null);
  const [orchestratorConflicts, setOrchestratorConflicts] = useState<RegisterConflict[] | undefined>(undefined);
  // v1.22.0 Stage 1: per-player note counts from the last real orchestrator
  // run (result.perPlayerNotes, [pid, count] pairs) — replaces the panel's
  // old Math.random placeholder. Empty until the first run.
  const [orchestratorRunCounts, setOrchestratorRunCounts] = useState<Record<string, number>>({});
  const [scoreCollisions, setScoreCollisions] = useState<CollisionWarning[]>([]);
  // v1.14: transient status line for the Score panel (auto-layout results,
  // pending part-extraction / MusicXML export notices). Null hides it.
  const [scoreNotice, setScoreNotice] = useState<string | null>(null);
  // v1.18.0 Stage 1: user-visible banner when an autosave restore attempt
  // fails (previously the error was only logged to console). Null hides it;
  // a successful retry clears it.
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [userLevel, setUserLevel] = useState<UserLevel>("intermediate");
  // v1.14 Stage 1: Teaching panel state, fed by the real teaching.explainDecision
  // tool run in the effect below (never template content).
  const [teachingExplanation, setTeachingExplanation] = useState<UiExplanation | null>(null);
  const [teachingLoading, setTeachingLoading] = useState(false);
  const [teachingError, setTeachingError] = useState<string | null>(null);
  // v1.18.0 Stage 0: harmony explanation block state, fed by the real
  // teaching.explainHarmony tool through the button handler below (button
  // triggered, unlike the diff-driven explainDecision effect).
  const [harmonyExplanation, setHarmonyExplanation] = useState<UiExplanation | null>(null);
  const [harmonyLoading, setHarmonyLoading] = useState(false);
  const [harmonyError, setHarmonyError] = useState<string | null>(null);
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

  // v1.25.0 Stage 1 (D2-2): MIDI 录入闭环状态。
  // - activePitches：当前按下的 pitch 集合，直接驱动 PianoRollView 键位高亮。
  // - inputCursor：录入光标（最小闭环，App 层 useState；store 无全局 transport）。
  //   4/4 基准，初始 {bar:1, beat:1}，每落盘一音自上一音结束处继续步进，
  //   beat>4 → bar+1 / beat-=4。
  //   v1.26.0 (D2-1)：durQn 改为实测（timeStamp 差 → 拍），落点按
  //   settings.midi.recording.quantizeGrid 量化；velocity 支持 fixed 模式。
  const [activePitches, setActivePitches] = useState<Set<number>>(() => new Set());
  const [inputCursor, setInputCursor] = useState({ bar: 1, beat: 1 });
  const inputCursorRef = useRef(inputCursor);
  inputCursorRef.current = inputCursor;

  // noteon 的 velocity + tOn（接收时刻 timeStamp）需在 noteoff 落盘时使用，
  // 以 note → {velocity, tOn} 映射暂存。tOn 非有限数时兜底 performance.now()
  // （useMidiInput 已兜底，此处双保险）。
  const activeVelocitiesRef = useRef(
    new Map<number, { velocity: number; tOn: number }>()
  );

  const { settings } = useSettings();
  const recording = settings.midi.recording;

  const handleNoteAdd = useCallback((note: Omit<NoteEvent, "id">) => {
    const newNote = createNoteEvent(note);
    // 经 actionsRef 读取（store actions 引用随渲染重建，见上方 actionsRef 注释）
    actionsRef.current.addNote(newNote);
  }, []);

  const handleMidiNoteOn = useCallback(
    (note: number, velocity: number, timeStamp: number) => {
      const tOn =
        typeof timeStamp === "number" && Number.isFinite(timeStamp)
          ? timeStamp
          : performance.now();
      activeVelocitiesRef.current.set(note, { velocity, tOn });
      setActivePitches((prev) => {
        if (prev.has(note)) return prev;
        const next = new Set(prev);
        next.add(note);
        return next;
      });
    },
    []
  );

  const handleMidiNoteOff = useCallback(
    (note: number, timeStamp: number) => {
      // 移除高亮（函数式更新）
      setActivePitches((prev) => {
        if (!prev.has(note)) return prev;
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
      // 落盘：字段构造与 PianoRoll 鼠标添加音符路径同构
      // （usePianoRollInteraction.handleDoubleClick → trackId:"default"）。
      // v1.26.0 (D2-1)：实测时长（tOff - tOn → 拍，bpm 取 cursor 处 tempo）
      // + 量化落点 + fixed velocity 模式；纯计算抽至 computeNoteOffPlacement。
      const entry =
        activeVelocitiesRef.current.get(note) ?? {
          velocity: 100,
          tOn: performance.now(),
        };
      activeVelocitiesRef.current.delete(note);
      const tOff =
        typeof timeStamp === "number" && Number.isFinite(timeStamp)
          ? timeStamp
          : performance.now();
      const elapsed = Math.max(0, tOff - entry.tOn);
      const cursor = inputCursorRef.current;
      const placement = computeNoteOffPlacement({
        cursor,
        elapsedMs: elapsed,
        bpm: tempoMap.bpmAt(cursor.bar, cursor.beat),
        grid: recording.quantizeGrid,
      });
      const velocity =
        recording.velocityMode === "fixed"
          ? recording.fixedVelocity / 127
          : entry.velocity / 127;
      handleNoteAdd({
        trackId: "default",
        phraseId: null,
        bar: placement.bar,
        beat: placement.beat,
        durQn: placement.durQn,
        pitchMidi: note,
        pitchSpelling: "",
        velocity,
        voice: "rh",
        tags: [],
      });
      // cursor 前进：从落盘位置起 landing + durQn（computeNoteOffPlacement
      // 已含 beat>4 → bar+1 / beat-=4 回绕，见 placement.nextCursor）
      setInputCursor(placement.nextCursor);
    },
    [handleNoteAdd, recording, tempoMap]
  );

  // v1.25.0 Stage 1 (D2-2): MIDI 输入绑定（读 settings.midi.midiDevice.input，
  // enabled 默认 true；回调经 hook 内部 ref 稳定，失败路径全程静默）。
  useMidiInput({ onNoteOn: handleMidiNoteOn, onNoteOff: handleMidiNoteOff });

  // v1.29.0 Stage 1 (D2-3): MIDI 输出试听——PianoRollView clean click 音符时
  // 经 useMidiOutput 立即发声（静默失败；无绑定端口则 no-op）。velocity 由
  // NoteEvent 归一化值换算为 MIDI 1-127，时长固定 AUDITION_DURATION_MS。
  const { playNote } = useMidiOutput();
  const handleNoteAudition = useCallback(
    (pitchMidi: number, velocity01: number) => {
      playNote(pitchMidi, computeAuditionVelocity(velocity01), AUDITION_DURATION_MS);
    },
    [playNote]
  );

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

  // v1.18.0 Stage 0: double-clicking a phrase block validates that the id is
  // a REAL graph Phrase node and jumps to the compose tab. The phrase id IS
  // the graph node id, so no demo-data lookup is involved; if the node was
  // removed the click is a no-op instead of navigating.
  const handleSectionDoubleClick = useCallback((phraseId: string) => {
    const phrase = storePhrases.find((p) => p.id === phraseId);
    if (phrase) {
      setActiveTab("compose");
    }
  }, [storePhrases]);

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
  // v1.15 Stage 1: an optional trackId scopes the suggestion to a single
  // track (MixerConsole per-track buttons); omitting it keeps the full-mix
  // suggestion (header button).
  const handleSuggestFxChain = useCallback((trackId?: string) => {
    actions.suggestMixingChain(trackId);
    setActiveTab("agent");
  }, [actions]);

  // Stage 0 (v1.14): the Score panel runs the real Engraving agent through the
  // shared ToolRegistry (engraving.reportCollisions). The returned collisions
  // come from the agent's EngravingEngine (converted to the UI shape by the
  // store action), not from sample data; suggestions are surfaced as a status
  // line, and a tool failure keeps the panel alive with a hint instead of a
  // crash.
  const handleAutoLayout = useCallback(async () => {
    setScoreNotice(null);
    const result = await actions.runEngraving(defaultLayout.id);
    if (result.status === "ok") {
      setScoreCollisions(result.collisions);
      if (result.suggestions.length > 0) {
        setScoreNotice(result.suggestions.join(" · "));
      }
    } else {
      setScoreCollisions([]);
      setScoreNotice(t("app.score.runFailed"));
    }
  }, [actions, defaultLayout.id, t]);

  // v1.15 Stage 0: part extraction runs the real engraving.extractParts tool
  // through the store action and surfaces the extracted part list as a status
  // line (score-notice). Tool failures keep the panel alive with a hint.
  const handleExtractParts = useCallback(async () => {
    setScoreNotice(null);
    const result = await actions.runExtractParts(defaultLayout.id);
    if (result.status === "ok") {
      if (result.parts.length > 0) {
        const summary = result.parts
          .map((p) => `${p.instrumentName} (${p.barCount} 小节)`)
          .join(" · ");
        setScoreNotice(
          t("app.score.partsExtracted", {
            count: result.parts.length,
            summary,
          })
        );
      } else {
        setScoreNotice(t("app.score.partsEmpty"));
      }
    } else {
      setScoreNotice(t("app.score.extractPartsFailed"));
    }
  }, [actions, defaultLayout.id, t]);

  // v1.15 Stage 0: MusicXML export generates a real score-partwise XML from
  // the store's notes + tempo map and downloads it as collinx-score.xml.
  const handleExportMusicXML = useCallback(() => {
    if (notes.length === 0) {
      setScoreNotice(t("app.score.exportMusicXMLEmpty"));
      return;
    }
    const xml = MusicXMLIO.exportToXML(notes, tempoMap, {
      title: "Collinx Score",
      composer: "Collinx",
    });
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "collinx-score.xml";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setScoreNotice(
      t("app.score.exportMusicXMLDone", { count: notes.length })
    );
  }, [notes, tempoMap, t]);

  // Stage 0 (.agentmusic): download the current project as project.agentmusic.
  const handleSaveProject = useCallback(() => {
    void actions.saveProjectAsAgentMusic();
  }, [actions]);

  // v1.16.0 Stage 1: export menu wiring — MIDI (current notes → .mid) and PDF
  // (score layout + notes → .pdf) through the real core exporters. The score
  // layout is the same Layout instance the ScorePanel/ScoreRenderer consume.
  const handleExportMIDI = useCallback(() => {
    // eslint-disable-next-line no-console
    void actions.exportMIDI().catch(console.error);
  }, [actions]);

  const handleExportPDF = useCallback(() => {
    // eslint-disable-next-line no-console
    void actions.exportPDF(defaultLayout).catch(console.error);
  }, [actions, defaultLayout]);

  // Stage 0 (.agentmusic): open the hidden file picker; the change handler
  // reads the selected .agentmusic File and restores the project.
  const handleLoadProjectClick = useCallback(() => {
    projectFileInputRef.current?.click();
  }, []);

  // v1.17.0 Stage 1: crash recovery. Clicking the entry IS the user
  // confirmation; the store action parses the pending autosave slot and
  // restores through the standard .agentmusic restore path.
  // v1.18.0 Stage 1: failures surface a user-visible banner instead of a
  // silent console.error. The pending slot + TopBar hint are preserved on
  // failure (the store action only clears them after a successful restore),
  // so the user can retry; a successful attempt clears the banner.
  const handleRestoreAutosave = useCallback(async () => {
    try {
      await actions.restoreFromAutosave();
      setAutosaveError(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setAutosaveError(t("app.project.autosaveRestoreFailed"));
    }
  }, [actions, t]);

  const handleProjectFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so selecting the same file again still fires a change event.
      event.target.value = "";
      if (!file) return;
      try {
        await actions.loadProjectFromAgentMusic(file);
      } catch (err) {
        // Surface the failure (corrupt / unreadable file) without crashing.
        // eslint-disable-next-line no-console
        console.error("[agentmusic] 加载工程失败:", err);
      }
    },
    [actions]
  );

  // v1.14 Stage 1: Teaching panel real tool loop. Whenever the active diff or
  // the user level changes, re-run teaching.explainDecision through the store
  // action (userLevel mapped from the UI enum: professional -> expert) and
  // surface loading/error/explanation to the panel. Without an active diff the
  // panel falls back to its empty-state guidance instead of template content.
  useEffect(() => {
    if (!arrangerDiff) {
      setTeachingExplanation(null);
      setTeachingLoading(false);
      setTeachingError(null);
      return;
    }
    let cancelled = false;
    setTeachingExplanation(null);
    setTeachingLoading(true);
    setTeachingError(null);
    actionsRef.current
      .runTeaching({
        diffId: arrangerDiff.diffId,
        userLevel: mapUiLevelToAgent(userLevel),
        compareWithAlt: true,
      })
      .then((result) => {
        if (cancelled) return;
        setTeachingLoading(false);
        if (result.status === "ok") {
          setTeachingExplanation(result.explanation);
        } else {
          setTeachingError(t("app.teaching.runFailed"));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setTeachingLoading(false);
        setTeachingError(t("app.teaching.runFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [arrangerDiff, userLevel, t]);

  // v1.18.0 Stage 0: harmony teaching derivation. The chords track notes are
  // grouped by bar; each bar's pitch set becomes one chord in the
  // progression, rendered as a hyphen-joined pitch-name sequence (e.g.
  // "E-G#-B") because the tool's chordProgression parameter is string[] with
  // one chord per element. Empty when the chords track has no notes — the
  // TeachingPanel trigger button is disabled in that case.
  const chordProgression = useMemo(() => {
    const chordNotes = notes.filter((n) => n.trackId === "chords");
    if (chordNotes.length === 0) return [];
    const byBar = new Map<number, string[]>();
    for (const n of chordNotes) {
      const spelling =
        typeof n.pitchSpelling === "string" && n.pitchSpelling.length > 0
          ? n.pitchSpelling
          : midiToSpelling(n.pitchMidi);
      const name = spelling.replace(/\d+$/, "");
      if (!name) continue;
      const bar = byBar.get(n.bar) ?? [];
      if (!bar.includes(name)) bar.push(name);
      byBar.set(n.bar, bar);
    }
    return Array.from(byBar.keys())
      .sort((a, b) => a - b)
      .map((bar) => (byBar.get(bar) ?? []).join("-"));
  }, [notes]);

  // Tonic + mode from the graph meta key_map's first entry ("C major").
  const harmonyKey = useMemo(() => {
    const keyMap = graph.getMeta().key_map;
    const first = keyMap[0];
    return first ? `${first.tonic} ${first.mode}` : "C major";
  }, [graph]);

  // v1.22.0 Stage 1: harmony progression derivation for the Orchestrator
  // panel. The chords track notes feed the real core notesToHarmonyEntries
  // (grouping/span semantics live in core); App only filters the track and
  // forwards the key. Entries are empty when the chords track has no notes —
  // the panel shows an empty state and disables the orchestrate button.
  const harmonyKeyToKeyParam = useMemo(() => {
    const [tonic, mode] = harmonyKey.split(" ");
    return { tonic: tonic || "C", mode: mode || "major" };
  }, [harmonyKey]);

  const harmonyEntries = useMemo(
    () =>
      notesToHarmonyEntries(
        notes.filter((n) => n.trackId === "chords"),
        harmonyKeyToKeyParam,
      ),
    [notes, harmonyKeyToKeyParam],
  );

  const canExplainHarmony = chordProgression.length > 0;

  // v1.18.0 Stage 0: button-triggered harmony explanation. Routes through the
  // store action (real teaching.explainHarmony tool on the shared
  // ToolRegistry); a failure keeps the panel alive with an error hint.
  const handleExplainHarmony = useCallback(() => {
    if (!canExplainHarmony) return;
    setHarmonyExplanation(null);
    setHarmonyLoading(true);
    setHarmonyError(null);
    actionsRef.current
      .runTeachingHarmony(chordProgression, harmonyKey, mapUiLevelToAgent(userLevel))
      .then((result) => {
        setHarmonyLoading(false);
        if (result.status === "ok") {
          setHarmonyExplanation(result.explanation);
        } else {
          setHarmonyError(t("app.teaching.harmonyRunFailed"));
        }
      })
      .catch(() => {
        setHarmonyLoading(false);
        setHarmonyError(t("app.teaching.harmonyRunFailed"));
      });
  }, [canExplainHarmony, chordProgression, harmonyKey, userLevel, t]);

  // Stage 0: the Orchestrator panel runs the real Orchestrator agent through
  // the shared ToolRegistry (orchestrator.voicingPlan). The returned conflicts
  // come from the agent's RegisterConflictDetector, not from sample data; the
  // proposal diffs are already enqueued into pendingDiffs by the action.
  // v1.22.0 Stage 1: the harmony entries derived from the chords track feed
  // the tool (required harmony param), and the returned perPlayerNotes
  // ([pid, count] pairs) become the voice-preview run counts. Placed after
  // the harmonyEntries derivation it depends on.
  const handleOrchestrate = useCallback(async (config: OrchestratorConfig) => {
    const result = await actions.runOrchestrator(config, harmonyEntries);
    setOrchestratorConflicts(result.conflicts);
    const counts: Record<string, number> = {};
    if (Array.isArray(result.perPlayerNotes)) {
      for (const [pid, count] of result.perPlayerNotes as [string, number][]) {
        counts[pid] = count;
      }
    }
    setOrchestratorRunCounts(counts);
  }, [actions, harmonyEntries]);

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
      <TopBar brand="Collinx" status={headerStatus} toolbar={<>
        <button
          type="button"
          onClick={handleSaveProject}
          data-testid="save-project"
          className={styles.topBarButton}
        >
          {t("app.project.save")}
        </button>
        <button
          type="button"
          onClick={handleLoadProjectClick}
          data-testid="load-project"
          className={styles.topBarButton}
        >
          {t("app.project.load")}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          data-testid="open-settings"
          className={styles.topBarButton}
        >
          {t("app.settings.open")}
        </button>
        {autosaveRecovery ? (
          <button
            type="button"
            onClick={handleRestoreAutosave}
            data-testid="restore-autosave"
            className={styles.topBarButton}
          >
            {t("app.project.restoreAutosave", {
              time: formatAutosaveTime(autosaveRecovery.savedAt),
            })}
          </button>
        ) : null}
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".agentmusic"
          data-testid="project-file-input"
          style={{ display: "none" }}
          onChange={handleProjectFileChange}
        />
      </>}>
        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            id={tab.id}
            active={activeTab === tab.id}
            onSelect={setActiveTab}
          >
            {tab.label}
          </TabPill>
        ))}
      </TopBar>

      {/* v1.18.0 Stage 1: autosave restore failure banner, rendered right
          under the TopBar (same diffInfoBox style as the score notice). */}
      {autosaveError && (
        <div
          className={styles.diffInfoBox}
          data-testid="autosave-error-banner"
          role="alert"
        >
          <div className={styles.diffInfoSummary}>{autosaveError}</div>
        </div>
      )}

      {activeTab === "compose" && (
        <div className={styles.composeLayout} data-testid="compose-layout">
          <div className={styles.composeArrangement}>
            <ArrangementView
              phrases={storePhrases}
              totalBars={totalBars}
              emptyHint={t("app.arrange.emptyPhrases")}
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
                onNoteAudition={handleNoteAudition}
                activePitches={activePitches}
                cursorPosition={inputCursor}
                quantizeGridHint={recording.quantizeGrid}
                autoScrollFollow
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
                phrases={storePhrases}
                totalBars={totalBars}
                emptyHint={t("app.arrange.emptyPhrases")}
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
                phrases={storePhrases}
                totalBars={totalBars}
                emptyHint={t("app.arrange.emptyPhrases")}
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
            harmony={harmonyEntries}
            onOrchestrate={handleOrchestrate}
            conflicts={orchestratorConflicts}
            runCounts={orchestratorRunCounts}
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
          {scoreNotice && (
            <div className={styles.diffInfoBox} data-testid="score-notice">
              <div className={styles.diffInfoTitle}>
                {t("app.score.noticeTitle")}
              </div>
              <div className={styles.diffInfoSummary}>{scoreNotice}</div>
            </div>
          )}
          <ScorePanel
            layout={defaultLayout}
            notes={notes}
            houseStyle={defaultHouseStyle}
            collisions={scoreCollisions.length > 0 ? scoreCollisions : undefined}
            onAutoLayout={handleAutoLayout}
            onExtractParts={handleExtractParts}
            onExportMusicXML={handleExportMusicXML}
            onExportMIDI={handleExportMIDI}
            onExportPDF={handleExportPDF}
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
            explanation={teachingExplanation}
            alternatives={teachingExplanation?.alternatives ?? []}
            relatedConcepts={teachingExplanation?.conceptTags ?? []}
            loading={teachingLoading}
            error={teachingError}
            harmonyExplanation={harmonyExplanation}
            harmonyLoading={harmonyLoading}
            harmonyError={harmonyError}
            onExplainHarmony={handleExplainHarmony}
            canExplainHarmony={canExplainHarmony}
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

      {/* v1.24.0 Stage 1 (D1-2): settings modal, conditionally mounted.
          Escape-to-close lives inside SettingsPage (onKeyDown → onClose). */}
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
