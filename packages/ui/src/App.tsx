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
  ABPlayer,
} from "@collinx/core";
import { ChordTrack } from "./components/ChordTrack/ChordTrack";
import { PianoRollView } from "./components/PianoRoll/PianoRollView";
import { TransportBar } from "./components/Transport/TransportBar";
import { ScorePanel } from "./components/Score";
import type { CollisionWarning } from "./components/Score";
import { ArrangementView } from "./components/Arrangement/ArrangementView";
import { EmptyState } from "./components/common/EmptyState";
import { ArrangerPanel } from "./components/Arranger";
import { OrchestratorPanel } from "./components/Orchestrator";
import type { OrchestratorConfig, RegisterConflict } from "./components/Orchestrator";
import { MixerConsole } from "./components/Mixer";
import { PerformanceDashboard } from "./components/Performance";
import { usePerformanceMetrics } from "./hooks/usePerformanceMetrics";
import { latencyHintForBufferSize } from "./services/audio-preview";
import { TasteTimelineView } from "./components/Taste/TasteTimelineView";
import { ABPlayerUI } from "./components/Taste/ABPlayerUI";
import { TasteLibraryPanel } from "./components/Taste/TasteLibraryPanel";
import { TasteDiffPanel } from "./components/Taste/TasteDiffPanel";
import { TeachingPanel } from "./components/Teaching";
import type { UserLevel } from "./components/Teaching";
import { AgentPanel, AgentChat, ToolCallTimeline } from "./components/Agent";
import { GraphView, NodeDetail } from "./components/KnowledgeGraph";
import type { ConnectedNode, GraphData, GraphEdge } from "./components/KnowledgeGraph";
import { TopBar, TabPill, AppShell, Splitter, CommandPalette, useCommandPalette } from "./components/Shell";
import type { CommandItem } from "./components/Shell";
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
import { useTransport, type RecordedTake } from "./hooks/useTransport";
import { useSettings } from "./hooks/useSettings";
import { elapsedToBeats, snapBeat } from "./services/midi-quantize";
import { convertTakeToNotes } from "./services/recorded-take";
import { renderNotesToWav } from "./services/wav-export";
import { applyMixerToAudio } from "./services/mix-resolver";
import { renderStems, stemFileName } from "./services/stem-export";
import { resolveInstrument } from "./services/instruments";
import { trackByBusKey } from "./services/mix-resolver";
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
  // 非有限防御：NaN / ±Infinity 穿过 Math.round 会成 NaN → 编成 0 → 试听静音。
  if (!Number.isFinite(normalizedVelocity01)) return 1;
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
    rejectedDiffs,
    mixer,
    tempoChanges,
    meterChanges,
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

  // v2.0.0 Stage 1 (D1-5): global keyboard shortcuts are wired AFTER the
  // transport hook is set up (see below) so onPlayPause closes over the
  // latest transport state; the hook reads handlers through a ref each render,
  // so no stale closure. (Previously this call only wired undo/redo.)

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

  // v2.3.0 S4a (D34-6) —— 引用稳定前提（勿改为渲染体内重建）：
  // defaultLayout 必须经 useMemo 持有同一身份。原因：ScorePanel 的 rendererLayout
  // memo deps 含 layout.staffConfig；若每次渲染重建 layout/staffConfig，则 memo 失效
  // → ScoreRenderer 渲染 effect（dep 含 layout）反复触发 → 配合父组件用 state 接收
  // onBarAnchorsChange 会形成永不收敛的渲染循环（S0 期实测 300ms 内 15 次回调）。
  // defaultHouseStyle 是 ./data/demoData 的模块级导出，身份天然稳定；禁止内联。
  //
  // 小节数必须跟随工程实际长度：此前 createDefaultLayout() 内部把 staffConfig.bars
  // 硬编码为 4，48 小节工程在乐谱页只画出前 4 小节（用户：「五线谱怎么就四个区」）。
  // 依赖刻意用 `totalBars` 这个**数字**而非 notes 数组：notes 每次编辑都会换新数组，
  // 用数组做 dep 会让 layout 在「内容长度未变」时也换身份 —— 那正是上面这条注释
  // 禁止的渲染循环诱因。数字只有真的变长/变短时才变，等价于「内容变化次数」。
  const defaultLayout = useMemo(
    () => createDefaultLayout(totalBars),
    [totalBars],
  );
  const analyzer = useMemo(() => new ExportAnalyzer(), []);
  const generator = useMemo(() => new ReportGenerator(), []);

  // Stage 2: adapt the store's ProjectGraph (core class) to the pure-data
  // GraphData shape consumed by GraphView. GraphView itself is untouched.
  const graphData: GraphData = useMemo(
    () => {
      const nodes = graph.getAllNodes().map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data as Record<string, unknown>,
      }));

      // v2.8.0：**派生结构边**。
      // 图模型里目前只有 NoteSpan 节点（core 的 diff-engine 只 addNode NoteSpan），
      // 没有 Track/Phrase 节点 → `graph.getAllEdges()` 恒为空 → 图谱页只剩
      // 一堆孤立散点，完全不表达工程结构（用户原话：「图谱就没有使用」）。
      //
      // 这里在**视图层**派生「同轨音列」边：同一 trackId 的音符按 (bar,beat) 排序
      // 依次相连。效果是三条清晰的音列线（旋律/贝斯/和弦），一眼能看出
      // 「有几条轨、每条轨的音符怎么走」。
      //
      // 为什么放在 ui 层而不改 core：core 的图模型是 diff 的作用对象，
      // 在那里加"视图用的派生边"会把展示语义混进数据模型；
      // 而 GraphView 的数据契约（source/target/type）本就支持任意边。
      const byTrack = new Map<string, typeof nodes>();
      for (const n of nodes) {
        if (n.type !== "NoteSpan") continue;
        const trackId = typeof n.data.trackId === "string" ? n.data.trackId : "";
        const list = byTrack.get(trackId) ?? [];
        list.push(n);
        byTrack.set(trackId, list);
      }

      const derivedEdges: GraphEdge[] = [];
      for (const list of byTrack.values()) {
        const ordered = [...list].sort((a, b) => {
          const ab = Number(a.data.bar ?? 0);
          const bb = Number(b.data.bar ?? 0);
          if (ab !== bb) return ab - bb;
          return Number(a.data.beat ?? 0) - Number(b.data.beat ?? 0);
        });
        for (let i = 1; i < ordered.length; i++) {
          derivedEdges.push({
            source: ordered[i - 1]!.id,
            target: ordered[i]!.id,
            type: "sequence",
          });
        }
      }

      return {
        nodes,
        // 真实边优先；没有真实边时才用派生边（两者不混，避免双重绘制）
        edges:
          graph.getAllEdges().length > 0
            ? graph.getAllEdges().map((e) => ({
                source: e.source_id,
                target: e.target_id,
                type: e.type,
              }))
            : derivedEdges,
      };
    },
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

  // v2.1.0 (D11-1): 速度/拍号成为一等可编辑数据 —— TempoMap 从工程 store 派生
  //（graph.meta.tempo_map/meter_map 的投影，S0）。store 为默认值时与
  // TempoMap.default() 逐字段等价（T30 回归门）。
  const tempoMap = useMemo(
    () => new TempoMap(tempoChanges, meterChanges),
    [tempoChanges, meterChanges]
  );

  // ── v2.1.0 S3 (D13-1/D13-7)：TransportBar 的 tempo/meter 接线 ──
  // bar 1 的当前值（编辑落在 bar 1；多变拍编辑 UI 留后续版本）
  const bpmAtBar1 = tempoChanges.find((tc) => tc.bar === 1)?.bpm ?? 120;
  const meterAtBar1 =
    meterChanges.find((mc) => mc.bar === 1) ?? { numerator: 4, denominator: 4 };
  const handleBpmChange = useCallback(
    (bpm: number) => actions.setTempo(1, bpm),
    [actions]
  );
  const handleMeterChange = useCallback(
    (numerator: number, denominator: number) =>
      actions.setMeter(1, numerator, denominator),
    [actions]
  );

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
  // v2.2.0 S2 (D23-2)：transport ref——录制捕获在 MIDI 事件回调（上方定义）
  // 里调用，而 transport 在下方定义 → 经 ref 解耦声明顺序
  const transportRef = useRef<{
    captureRecordedNoteOn: (pitchMidi: number, velocity: number) => void;
    captureRecordedNoteOff: (pitchMidi: number) => void;
    isRecording: () => boolean;
  } | null>(null);
  inputCursorRef.current = inputCursor;

  // noteon 的 velocity + tOn（接收时刻 timeStamp）需在 noteoff 落盘时使用，
  // 以 note → {velocity, tOn} 映射暂存。tOn 非有限数时兜底 performance.now()
  // （useMidiInput 已兜底，此处双保险）。
  const activeVelocitiesRef = useRef(
    new Map<number, { velocity: number; tOn: number }>()
  );

  const { settings, updateSettings } = useSettings();
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
      // v2.2.0 S2 (D23-2)：实时录制捕获（录制中才缓冲；velocity 0-127）
      transportRef.current?.captureRecordedNoteOn(note, velocity);
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
      // v2.2.0 S2 (D23-2)：实时录制闭合
      transportRef.current?.captureRecordedNoteOff(note);
      // 录制中：音符由录制 take 批量落盘（量化/undo 粒度），跳过步进录入
      // 路径——否则同一音会双份创建（步进 + 录制各一份）。
      if (transportRef.current?.isRecording()) {
        activeVelocitiesRef.current.delete(note);
        return;
      }
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
  const { playNote, getOutputPort } = useMidiOutput();
  const handleNoteAudition = useCallback(
    (pitchMidi: number, velocity01: number) => {
      playNote(pitchMidi, computeAuditionVelocity(velocity01), AUDITION_DURATION_MS);
    },
    [playNote]
  );

  // v2.0.0 Stage 1 (D1-5): 全局 transport —— 复用同一个 useMidiOutput 实例的
  // getOutputPort（D0-7 注入契约），notes/tempoMap/channel 均取自当前渲染的
  // 最新值（hook 内经 ref 读取）。播放状态机 + 播放头位置由 useTransport 提供。
  // ── v2.2.0 S0/S1 (D22)：录制 take 提交 → 换算 → 批量落盘（一条 undo） ──
  // 回调存于 transport 内部 ref（每渲染刷新）→ 闭包读取最新 tempoMap/recording
  const handleRecordingCommit = useCallback(
    (take: RecordedTake) => {
      const notes = convertTakeToNotes(take, tempoMap, {
        quantizeGrid: recording.quantizeGrid,
        velocityMode: recording.velocityMode,
        fixedVelocity: recording.fixedVelocity,
      });
      if (notes.length > 0) actionsRef.current.addNotes(notes);
    },
    [tempoMap, recording]
  );

  /**
   * 和弦轨数据（v2.8.0）：从图的 ChordEvent 节点投影出来。
   * graph → 视图的单向投影，与 notes/phrases 同源，不做第二份真相。
   */
  const chordsByBar = useMemo(() => {
    const map = new Map<number, { root: string; quality: string }>();
    for (const n of graph.getAllNodes()) {
      if (n.type !== "ChordEvent") continue;
      const bar = Number(n.data.bar);
      const chord = n.data.chord as { root?: string; quality?: string } | undefined;
      if (!Number.isFinite(bar) || !chord?.root) continue;
      map.set(bar, { root: chord.root, quality: chord.quality ?? "maj" });
    }
    return map;
  }, [graph]);

  /**
   * 轨道 → 音色 id 的统一解析（v2.8.0）。
   *
   * 播放（AudioPreview）与导出（WAV）必须用**同一个**解析结果，
   * 否则"听到的"和"导出的"会是两个声音。
   *
   * v2.9.1：轨道查找改用 `trackByBusKey` —— 此前这里和混音总线各写一遍
   * 「先 sourceTrackId 再 id」的匹配，两处只要有一处改动就会分叉。
   */
  const instrumentOfTrack = useCallback(
    (trackId: string | undefined): string => {
      if (!trackId) return resolveInstrument(undefined, undefined);
      const strip = trackByBusKey(mixer, trackId);
      return resolveInstrument(strip?.instrument, trackId);
    },
    [mixer],
  );

  const transport = useTransport({
    notes,
    tempoMap,
    channel: settings.midi.midiChannel,
    getOutputPort,
    // v2.9.4：采样率/延迟档位在 AudioContext 创建时生效（改设置后需重启音频引擎）
    audio: {
      sampleRate: settings.audio.sampleRate,
      latencyHint: latencyHintForBufferSize(settings.audio.bufferSize),
      outputDeviceId: settings.audio.audioDevice.output,
    },
    // v2.1.0 S2 (D12-4)：播放期节拍器（settings.midi.playback.metronome）
    metronome: settings.midi.playback.metronome,
    // v3.1.0：演奏期 MIDI 效果链（移调 / 力度），只影响发声
    midiEffects: settings.midi.effects,
    // v2.2.0 S0 (D21)：录制 take 自动提交（stop/pause 防丢）→ 换算 → 批量落盘
    onRecordingCommit: handleRecordingCommit,
    instrumentOfTrack,
  });

  // v2.2.0 S2 (D23-2)：录制捕获 ref 回填（handleMidiNoteOn/Off 在上方经此调用）
  transportRef.current = {
    captureRecordedNoteOn: transport.captureRecordedNoteOn,
    captureRecordedNoteOff: transport.captureRecordedNoteOff,
    isRecording: () => transport.isRecording,
  };



  // ── v2.1.0 S3 (D13-1)：loop 开关接线（保留既有区间，仅翻转 enabled；
  // 首次启用默认 bar1→bar2） ──
  const handleLoopToggle = useCallback(() => {
    const cur = transport.loop;
    if (cur) {
      transport.setLoop({ ...cur, enabled: !cur.enabled });
    } else {
      transport.setLoop({
        enabled: true,
        start: { bar: 1, beat: 1 },
        end: { bar: 2, beat: 1 },
      });
    }
  }, [transport.setLoop, transport.loop]);

  // v2.0.0 Stage 2 (D2-4): transport 运行代次。每次 **play / stop** 自增，作为
  // PianoRollView 的 `transportRunId` prop —— 其值变化会复位组件内部的手动平移
  // 挂起（followSuspended=false），实现 Ableton 语义「手动平移挂起跟随，直到
  // transport 停止/重启」。pause 不自增（SPEC 只提 stop/restart）。
  const [transportRunId, setTransportRunId] = useState(0);
  const handleTransportPlay = useCallback(() => {
    setTransportRunId((n) => n + 1);
    // v2.0.0 Stage 3 (D3-3)：settings 决定 count-in 预备小节数；useTransport 自身
    // 不读 settings，由 App 显式传入（=0 时直进 playing，无 count-in 阶段）。
    transport.play({ countInBars: settings.midi.playback.countInBars });
  }, [transport, settings]);
  const handleTransportStop = useCallback(() => {
    setTransportRunId((n) => n + 1);
    transport.stop();
  }, [transport]);

  // v2.0.0 S2.1 裁决：D2-1 字面规则 `playheadPosition ?? cursorPosition` 在"App 恒传
  // playheadPosition"的接线会退化为"永远跟停着的播放头"，令 v1.28 录入光标自动跟随
  // 失效。故按 transport 是否运行切换跟随权威：运行中跟播放头；idle/paused 跟录入
  // 光标（保住 v1.28）。用否定式而非 `=== 'playing'` 以便 S3 的 count-in 阶段自动纳入。
  const transportRunning = transport.phase !== "idle" && transport.phase !== "paused";

  // Stage 2 + v2.0.0 Stage 1: global shortcuts.
  // - Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y): composite undo/redo (input/textarea/
  //   contentEditable targets excluded inside the hook → native text undo kept).
  // - Space: transport play/pause (same editable-target guard inside the hook).
  // onPlayPause reads transport.isPlaying on each keypress through the hook's
  // handler ref, so it always acts on the latest phase (no stale closure).
  // v2.0.0 Stage 2: Space 起播也走 runId 自增（否则手动平移后按 Space 无法恢复跟随）。
  useKeyboardShortcuts({
    onUndo: actions.undo,
    onRedo: actions.redo,
    onPlayPause: () => {
      if (transport.isPlaying) {
        transport.pause();
      } else {
        setTransportRunId((n) => n + 1);
        // v2.0.0 Stage 3 (D3-3)：Space 起播同样显式传入 settings 的 countInBars。
        transport.play({ countInBars: settings.midi.playback.countInBars });
      }
    },
  });
// ── v2.2.0 S2 (D23-2)：录制开关 ──
  // 未在播 → 先 startRecording 再走既有 play（含 count-in 设置与 runId 推进）；
  // 录制中 → stopRecording 提交 take（播放不中断，用户可继续听）。
  const handleToggleRecord = useCallback(() => {
    if (transport.isRecording) {
      transport.stopRecording();
      return;
    }
    transport.startRecording();
    if (transport.phase === "idle") {
      handleTransportPlay();
    }
  }, [transport.isRecording, transport.phase, transport.startRecording, transport.stopRecording, handleTransportPlay]);

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

  /* v3.1.0：A/B 对比。快照必须**带音符**才有第二个真实版本；没有就不给假变体。 */
  const [tasteSelectedVersion, setTasteSelectedVersion] = useState<number | null>(null);
  const [abOpen, setAbOpen] = useState(false);
  const abPlayer = useMemo(() => new ABPlayer(), []);

  const handleSelectVersion = useCallback((version: number) => {
    setTasteSelectedVersion(version);
  }, []);

  const handleRevertTo = useCallback((version: number) => {
    actions.revertTasteTo(version);
  }, [actions]);

  const handleParameterEdit = useCallback((paramKey: string, value: string) => {
    actions.updateTasteParameter(paramKey, value, notes);
  }, [actions, notes]);

  /* v3.1.0：可对比的历史版本 = 快照里**带音符**的那些。旧存档没有 notes，
     因此这里可能是空集 —— 空集时面板给「记录当前版本」，不造变体。 */
  const tasteSnapshotsWithNotes = useMemo(
    () => tasteStore.getVersionHistory().filter((v) => (v.notes?.length ?? 0) > 0),
    [genomeVersion, tasteStore],
  );

  const abVersionBEntry = useMemo(() => {
    if (tasteSnapshotsWithNotes.length === 0) return null;
    const picked =
      tasteSelectedVersion != null
        ? tasteSnapshotsWithNotes.find((v) => v.version === tasteSelectedVersion)
        : undefined;
    return picked ?? tasteSnapshotsWithNotes[tasteSnapshotsWithNotes.length - 1];
  }, [tasteSnapshotsWithNotes, tasteSelectedVersion]);

  /**
   * A/B 试听通道：按 tempoMap 把音符排成定时序列，逐音触发合成器。
   * 与钢琴卷试听共用同一个 playNote，不新开音频链路。
   */
  const previewVersionNotes = useCallback(
    (versionNotes: NoteEvent[]) => {
      if (versionNotes.length === 0) return;
      const startSec = Math.min(...versionNotes.map((n) => tempoMap.timeAt(n.bar, n.beat)));
      for (const n of versionNotes) {
        const delayMs = Math.max(0, (tempoMap.timeAt(n.bar, n.beat) - startSec) * 1000);
        const durMs = Math.max(80, n.durQn * (60000 / tempoMap.bpmAt(n.bar)));
        window.setTimeout(() => {
          playNote(n.pitchMidi, computeAuditionVelocity(n.velocity), Math.min(durMs, 1200));
        }, delayMs);
      }
    },
    [playNote, tempoMap],
  );

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

  // v2.4.0 S5: "确认写入品味库" 必须真的落库。原先只 setDiffReport(null)，
  // 用户点了什么也不会改变 —— 现在把选中条目的分析值写入对应品味参数
  // （updateTasteParameter 会 save genome 并 bump genomeVersion，时间线与
  // 参数卡片随之更新）。
  const handleConfirmWrite = useCallback(
    (evidenceIds: string[]) => {
      if (!diffReport) return;
      const items = diffReport.evidenceItems.filter((it) => evidenceIds.includes(it.paramKey));
      for (const item of items) {
        actions.updateTasteParameter(item.paramKey, String(item.currentValue), notes);
      }
      setDiffReport(null);
    },
    [actions, diffReport, notes]
  );

  // "忽略" = 本次不写入（条目已从弹窗列表移除，无需落库）。
  const handleIgnore = useCallback((_evidenceIds: string[]) => {}, []);

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

  // v2.6.0：从空编排的起点卡片创建乐段（顺接在最后一个乐段之后）
  const handleCreatePhrase = useCallback(
    (role: string, bars: number) => {
      const startBar = storePhrases.reduce((max, p) => Math.max(max, p.endBar), 0);
      actions.addPhrase({
        name: role.charAt(0).toUpperCase() + role.slice(1),
        formRole: role,
        startBar,
        endBar: startBar + bars,
      });
    },
    [storePhrases, actions],
  );

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

  /**
   * v2.9.0：删轨。store 负责级联删音符 + undo；这里额外释放音频总线，
   * 否则被删轨的节点会一直挂在 master 上（听不见，但泄漏）。
   */
  const handleMixerRemoveTrack = useCallback(
    (trackId: string) => {
      const track = mixer.tracks.find((t) => t.id === trackId);
      actions.removeMixerTrack(trackId);
      if (track) transport.removeTrackAudio(track.sourceTrackId || track.id);
    },
    [actions, mixer.tracks, transport],
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

  /**
   * v2.8.0：导出 WAV —— 让用户拿到能播的成品。
   *
   * 之前只有 MIDI / MusicXML / PDF，没有音频。而"做出一首歌"的终点是一个
   * 能播的文件：前八步做得再好，交不出成品等于没交付。
   *
   * 用 OfflineAudioContext 离线渲染（样本级确定），不用实时录音 ——
   * 后者受设备缓冲与调度抖动影响，同一工程两次导出长度都不同。
   */
  /** 音符 → 离线渲染输入（WAV 与分轨共用，避免两处换算逻辑分叉） */
  const buildRenderableNotes = useCallback(
    () =>
      notes.map((n) => {
        const startSec = tempoMap.timeAt(n.bar, n.beat);
        // durQn 是四分音符数；用当前位置的 BPM 换算秒数。
        // 不直接 timeAt(bar, beat + durQn) —— 那个 API 的 beat 是小节内
        // 1-based 位置，跨小节时语义不成立。
        const bpm = tempoMap.bpmAt(n.bar, n.beat);
        const durSec = Math.max(0.05, (n.durQn * 60) / Math.max(1, bpm));
        return {
          pitchMidi: n.pitchMidi,
          velocity: n.velocity,
          startSec,
          durSec,
          // 与播放侧同一个解析器 —— 导出的音色必须与听到的一致
          instrumentId: instrumentOfTrack(n.trackId),
          // v2.9.0：导出也要走混音总线（推子/静音/独奏/声像/FX）
          trackId: n.trackId,
        };
      }),
    [notes, tempoMap, instrumentOfTrack],
  );

  const handleExportWAV = useCallback(() => {
    void (async () => {
      try {
        const wav = await renderNotesToWav(buildRenderableNotes(), {
          mixer,
          // v2.9.3：导出的采样率跟随设置（此前固定 44100，设置页改了没反应）
          sampleRate: settings.audio.sampleRate,
          // v2.9.4：峰值归一化开关（设置 mixer.loudnessNormalization）
          normalize: settings.mixer.loudnessNormalization,
        });
        const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "project.wav";
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("导出 WAV 失败", err);
      }
    })();
  }, [buildRenderableNotes, mixer, settings.audio.sampleRate, settings.mixer.loudnessNormalization]);

  /**
   * v2.9.1：分轨导出 —— 每轨一个 WAV，走与整曲相同的 MixerGraph
   * （推子/声像/FX/送出都在各自轨道里生效）。
   */
  const handleExportStems = useCallback(() => {
    void (async () => {
      try {
        const stems = await renderStems(buildRenderableNotes(), mixer, {
          sampleRate: settings.audio.sampleRate,
          normalize: settings.mixer.loudnessNormalization,
        });
        for (const stem of stems) {
          const blob = new Blob([stem.wav as unknown as BlobPart], { type: "audio/wav" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = stemFileName(stem.name, stem.trackId);
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("分轨导出失败", err);
      }
    })();
  }, [buildRenderableNotes, mixer, settings.audio.sampleRate, settings.mixer.loudnessNormalization]);

  /**
   * 混音台 → 音频图（v2.8.0 推子；v2.9.0 扩到静音/独奏/声像/FX）。
   *
   * 此前每次 mixer 变化只同步 gainDb，于是 M/S/pan/FX 全部是装饰。
   * 现在判定逻辑集中在 `applyMixerToAudio`（纯函数，可逐条断言），
   * App 只负责在状态变化时调一次。
   *
   * 依赖项用**稳定的 useCallback**而不是 transport 对象本身 ——
   * 后者每次渲染都是新引用，会让 effect 每帧重放，白白给 6 类 FX 写参数。
   */
  const { setTrackGain, setTrackPan, setTrackFx, setMasterGain } = transport;

  /**
   * v2.9.2：音频性能面板的真实数据源。
   *
   * 之前 PerformanceDashboard 是零引用组件 —— 它要 CPU/内存/欠载这类数据，
   * 而浏览器只肯给「声部数 / 采样率 / 延迟 / JS 堆」。这里只喂真实值，
   * 拿不到的留空（面板显示「—」），不编数字。
   */
  const audioPerf = usePerformanceMetrics(transport.getAudioPerformance);

  /**
   * v2.9.4：输出设备切换实时生效（AudioContext.setSinkId）。
   * 采样率/延迟档位只在下次创建 AudioContext 时生效 —— 与浏览器一致。
   */
  const setOutputDevice = transport.setOutputDevice;
  useEffect(() => {
    void setOutputDevice(settings.audio.audioDevice.output);
  }, [setOutputDevice, settings.audio.audioDevice.output]);
  useEffect(() => {
    applyMixerToAudio(mixer, { setTrackGain, setTrackPan, setTrackFx, setMasterGain });
  }, [mixer, setTrackGain, setTrackPan, setTrackFx, setMasterGain]);

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

  /* v3.0.0 A3：命令面板。
     命令集只做「已有能力的快捷入口」，不新增任何行为 —— 面板只是把页签与
     两个顶栏按钮收进键盘可达的入口，符合朴素哲学的「键盘优先」。 */
  const { open: commandOpen, openPalette, close: closeCommandPalette } = useCommandPalette();
  const commands = useMemo<CommandItem[]>(
    () => [
      ...tabs.map((tab, i) => ({
        id: `tab-${tab.id}`,
        label: t("app.command.goToTab", { name: tab.label }),
        hint: i < 9 ? `⌘${i + 1}` : undefined,
        run: () => setActiveTab(tab.id),
      })),
      {
        id: "save-project",
        label: t("app.command.saveProject"),
        hint: "⌘S",
        run: handleSaveProject,
      },
      {
        id: "open-settings",
        label: t("app.command.openSettings"),
        run: () => setSettingsOpen(true),
      },
    ],
    [tabs, t, handleSaveProject],
  );

  return (
    <AppShell>
      <TopBar
        brand="Collinx"
        status={headerStatus}
        command={
          <button
            type="button"
            onClick={openPalette}
            className={styles.commandEntry}
            data-testid="open-command-palette"
          >
            <span className={styles.commandEntryLabel}>{t("app.command.entry")}</span>
            <span className={styles.commandEntryKey}>⌘K</span>
          </button>
        }
        toolbar={<>
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
          className={styles.hiddenInput}
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
              onCreatePhrase={handleCreatePhrase}
            />
            <ChordTrack
              totalBars={totalBars}
              chordsByBar={chordsByBar}
              onSetChord={actions.setChord}
            />
          </div>

          <div className={styles.composeMain}>
            <div className={styles.composeScore}>
              <ScorePanel
                layout={defaultLayout}
                notes={notes}
                houseStyle={defaultHouseStyle}
                tempoMap={tempoMap}
                playheadPosition={transport.position}
                onSeek={transport.seek}
                compact
              />
            </div>

            {/* v3.0.0 A2：谱面与钢琴卷之间可拖拽。首轮只接这一处，
                验证后再推广到其它分栏。 */}
            <Splitter />

            {/* v2.0.0 Stage 1 (D1-5): 全局 transport 控件，置于钢琴卷上方、同属
                compose 标签页（可见、结构合理：控制其正下方 PianoRollView 的播放）。 */}
            <TransportBar
              isPlaying={transport.isPlaying}
              position={transport.position}
              positionSeconds={transport.positionSeconds}
              onPlay={handleTransportPlay}
              onPause={transport.pause}
              onStop={handleTransportStop}
              isCountingIn={transport.phase === "count-in"}
              bpm={bpmAtBar1}
              onBpmChange={handleBpmChange}
              meter={meterAtBar1}
              onMeterChange={handleMeterChange}
              loop={transport.loop}
              onLoopToggle={handleLoopToggle}
              isRecording={transport.isRecording}
              onToggleRecord={handleToggleRecord}
            />

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
                playheadPosition={transport.position}
                quantizeGridHint={recording.quantizeGrid}
                // v2.4.0 S5：量化下拉写回设置（此前是无回调的死控件）
                onQuantizeGridChange={(grid) =>
                  updateSettings({
                    midi: {
                      ...settings.midi,
                      recording: { ...settings.midi.recording, quantizeGrid: grid },
                    },
                  })
                }
                autoScrollFollow={settings.midi.playback.followPlayhead}
                transportRunId={transportRunId}
                followPlayhead={transportRunning}
                onSeek={transport.seek}
                loopRegion={transport.loop}
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
                onCreatePhrase={handleCreatePhrase}
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
                onCreatePhrase={handleCreatePhrase}
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
              /* v3.0.0 S4：空态改为一句话 —— 原来的图标 + 三步引导比内容还重 */
              <EmptyState testId="orchestrate-guide" title={t("app.orchestrate.guideTitle")} />
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
          <PerformanceDashboard metrics={audioPerf.metrics} onRefresh={audioPerf.refresh} />
          <MixerConsole
              audioLevel={transport.getAudioLevel}
              trackLevel={transport.getTrackLevel}
            mixer={mixer}
            onTrackChange={handleMixerTrackChange}
            onAddTrack={handleMixerAddTrack}
            onRemoveTrack={handleMixerRemoveTrack}
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
            tempoMap={tempoMap}
            playheadPosition={transport.position}
            onSeek={transport.seek}
            collisions={scoreCollisions.length > 0 ? scoreCollisions : undefined}
            onAutoLayout={handleAutoLayout}
            onExtractParts={handleExtractParts}
            onExportMusicXML={handleExportMusicXML}
            onExportMIDI={handleExportMIDI}
            onExportPDF={handleExportPDF}
            onExportWAV={handleExportWAV}
            onExportStems={handleExportStems}
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
            <button
              onClick={() => setAbOpen((v) => !v)}
              className={styles.tasteButton}
              data-testid="taste-ab-toggle"
              aria-expanded={abOpen}
            >
              {t("app.taste.abToggle")}
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

          {/* v3.1.0：A/B 对比。只有快照带音符时才出现播放/投票流程。 */}
          {abOpen && (
            <div className={styles.tasteAB} data-testid="taste-ab-panel">
              {abVersionBEntry ? (
                <ABPlayerUI
                  player={abPlayer}
                  tempoMap={tempoMap}
                  versionA={{
                    id: "current",
                    label: t("app.taste.abCurrent"),
                    notes,
                    description: "",
                  }}
                  versionB={{
                    id: `v${abVersionBEntry.version}`,
                    label: `v${abVersionBEntry.version}`,
                    notes: abVersionBEntry.notes ?? [],
                    description: abVersionBEntry.message,
                  }}
                  onAudition={(v) => previewVersionNotes(v.notes)}
                />
              ) : (
                <EmptyState
                  testId="taste-ab-empty"
                  title={t("app.taste.abEmpty")}
                  action={{
                    label: t("app.taste.abRecord"),
                    onClick: () => actions.recordTasteSnapshot(notes),
                  }}
                />
              )}
            </div>
          )}
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
            onNavigate={setActiveTab}
          />
        </div>
      )}

      {activeTab === "agent" && (
        <div className={styles.agentLayout} data-testid="agent-layout">
          <div className={styles.agentChatContainer}>
            <AgentChat
              agentName="HarmonyBot"
              persistKey="harmonybot"
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
          <div className={styles.agentPanelContainer}>
            <div className={styles.agentPanelSection}>
              <AgentPanel
                pendingDiffs={pendingDiffs}
                historyDiffs={appliedDiffs}
                rejectedDiffs={rejectedDiffs}
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
        />
      )}

      {/* v1.24.0 Stage 1 (D1-2): settings modal, conditionally mounted.
          Escape-to-close lives inside SettingsPage (onKeyDown → onClose). */}
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}

      {/* v3.0.0 A3：⌘K 命令面板（挂在 Shell 内，覆盖全站） */}
      <CommandPalette
        open={commandOpen}
        items={commands}
        onClose={closeCommandPalette}
        placeholder={t("app.command.placeholder")}
      />
    </AppShell>
  );
}
