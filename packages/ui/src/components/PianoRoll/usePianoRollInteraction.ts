import { useCallback, useMemo, useRef, useState } from "react";
import { NoteEvent, TempoMap } from "@collinx/core";
import { createBarTimeline } from "./bar-timeline";

const NOTE_HEIGHT = 18;
export const MIN_PITCH = 24;
export const MAX_PITCH = 108;
const RESIZE_EDGE_THRESHOLD = 6;

/**
 * v2.3.0 Stage 3b（S3 收口）：`tempoMap` 未传时的 **4/4 缺省**。
 *
 * 依据 core `TempoMap` 构造函数——`new TempoMap([], [])` 会补一条默认
 * `{ bar:1, numerator:4, denominator:4 }` 拍号（packages/core/src/model/tempo-map.ts:61-63），
 * 故它**就是 core 自身定义的「4/4 语义」**，比在 UI 层再手写一份常量表更干净
 * （不引入第二个 4/4 定义，避免漂移）；且后续走 `meterAt` 与真实路径完全同构。
 * 冻结为模块级单例，避免每次渲染重建前缀表。缺省路径逐值等价于改动前的
 * 「硬编码 `BEATS_PER_BAR = 4`」（见 T54c 零回归负控）。
 */
const DEFAULT_TEMPO_MAP = new TempoMap([], []);

export interface UsePianoRollInteractionParams {
  notes: NoteEvent[];
  viewRange: { startBar: number; endBar: number };
  pixelsPerBeat: number;
  scrollX: number;
  scrollY: number;
  onNoteAdd?: (note: Omit<NoteEvent, "id">) => void;
  onNoteMove?: (noteId: string, newBar: number, newBeat: number, newPitch: number) => void;
  onNoteResize?: (noteId: string, newDurQn: number) => void;
  onNoteDelete?: (noteId: string) => void;
  onNoteSelect?: (noteIds: string[]) => void;
  /**
   * v1.29.0 Stage 1 (D2-1): clean click 试听回调（pitchMidi 0-127 /
   * velocity 归一化 0-1，即 NoteEvent 原字段）。undefined 零行为变化。
   */
  onNoteAudition?: (pitchMidi: number, velocity: number) => void;
  /**
   * v2.3.0 Stage 3b（S3 收口）：拍号时间线来源。**可选**——未传时退化为 4/4
   * 语义（`new TempoMap([], [])`，见 DEFAULT_TEMPO_MAP），与改动前硬编码
   * `BEATS_PER_BAR = 4` 逐值等价。每小节四分音符拍数 = numerator × 4 / denominator
   * （依据 core tempo-map.ts:120/:183；3/4→3、6/8→3、7/8→3.5），见 `bar-timeline.ts`。
   */
  tempoMap?: TempoMap;
  selectedNoteIds: string[];
}

export function usePianoRollInteraction(params: UsePianoRollInteractionParams) {
  const {
    notes,
    viewRange,
    pixelsPerBeat,
    scrollX,
    scrollY,
    onNoteAdd,
    onNoteMove,
    onNoteResize,
    onNoteDelete,
    onNoteSelect,
    onNoteAudition,
    selectedNoteIds,
    tempoMap,
  } = params;

  // v2.3.0 Stage 3b（S3 收口）：与 PianoRollView 同源的时间线——一次 O(N) 建前缀表，
  // 供音符落点（pixelToBarBeat）、音符矩形 x（barBeatToPixel）、拖拽 move 换算共用。
  // 未传 tempoMap → 用 4/4 缺省表（DEFAULT_TEMPO_MAP），逐值等价于旧硬编码。
  const timeline = useMemo(
    () =>
      createBarTimeline(tempoMap ?? DEFAULT_TEMPO_MAP, {
        startBar: viewRange.startBar,
        endBar: viewRange.endBar,
      }),
    [tempoMap, viewRange.startBar, viewRange.endBar]
  );

  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [draggingState, setDraggingState] = useState<{
    noteId: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originalBar: number;
    originalBeat: number;
    originalPitch: number;
    originalDur: number;
    hasMoved: boolean;
  } | null>(null);
  // v2.0.0 后置清理（2026-09-14 遗留补全）：原此处有
  // `const [playheadPosition, setPlayheadPosition] = useState(0);` 并随 hook 导出——
  // 但 `setPlayheadPosition` **从未被调用**（grep 全仓仅命中声明本身），状态恒为 0，
  // 且无任何消费方读取，属死代码；更易与 PianoRollView 的 `playheadPosition` prop
  // 混淆（二者语义无关：后者是播放头位置，前者曾是残留占位）。故删除。

  const noteRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());

  const pixelToBarBeat = useCallback(
    (x: number, y: number): { bar: number; beat: number; pitch: number } => {
      const gridX = x + scrollX;
      const gridY = y + scrollY;

      const totalBeats = gridX / pixelsPerBeat;
      // v2.3.0 Stage 3b：totalBeats 是「自 viewRange.startBar 起、以**四分音符**
      // 为单位」的偏移；加 barStartQn(startBar) 得自 bar 1 起的绝对四分音符坐标，
      // 再由 timeline 按**真实拍号**反演 bar/beat（barBeatFromQn 为 qnOf 的逆）。
      // 依据 core tempo-map.ts:120/:183——每小节四分音符拍数 = numerator × 4 /
      // denominator（3/4→3、6/8→3、7/8→3.5），**不是 numerator**（上音/时长单位
      // 换算在本项目已踩坑三次：v2.1.0 S4-F1 / v2.2.0 T44 / v2.3.0 S1）。
      const { bar, beat } = timeline.barBeatFromQn(
        totalBeats + timeline.barStartQn(viewRange.startBar)
      );

      const pitch = MAX_PITCH - Math.floor(gridY / NOTE_HEIGHT);

      return {
        bar: Math.max(1, bar),
        // v2.3.0 Stage 3b（主 session 裁定，2026-10-12）：
        // 拍内钳制上界 = 该小节**真实拍数 + 0.999**——这是旧式 `BEATS_PER_BAR + 0.999`
        // 的忠实泛化，**不是** `beatsPerBarAt(bar)`。
        //
        // 为什么不能用 `beatsPerBarAt(bar)`（曾一度这么写，实测为回归）：
        //   · `barBeatFromQn` 与旧 `(totalBeats % 4) + 1` 同域，返回 beat ∈ [1, 拍数+1)
        //     ——即**整拍单位的 1-based 小节内坐标**，末拍（如 4/4 的 beat ∈ (4,5)）
        //     是合法位置，代表「第 4 个四分音符之内的亚拍落点」（beat 4.5 = 第 4 拍的反拍）。
        //   · 取上界 `beatsPerBarAt` 会把整条第 4 拍（占小节 25%）压扁到 4。
        //     端到端后果：`handleDoubleClick → pixelToBarBeat → onNoteAdd`
        //     （App.tsx:394 不量化）落点被钳到 4，而音符按 `timeline.qnOf(note.bar,
        //     note.beat)` 渲染（PianoRollView.tsx:417）→ 音符相对点击位置**左移最多
        //     1 个四分音符**，用户可见。
        //   · `+ 0.999` 保留末拍亚拍分辨率，仅夹掉小节线前最后 0.001 拍（与旧式逐位相同；
        //     4/4 即 `Math.min(4.999, beat)`）。7/8 → 上界 3.5+0.999=4.499，同理。
        // 见 T54c（全合法域逐值等价，含 beat_raw ∈ (4,5)）与 T54e-③（末拍分辨率不被压扁）。
        beat: Math.max(1, Math.min(timeline.beatsPerBarAt(bar) + 0.999, beat)),
        pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)),
      };
    },
    [scrollX, scrollY, pixelsPerBeat, viewRange.startBar, timeline]
  );

  const barBeatToPixel = useCallback(
    (bar: number, beat: number, pitch: number): { x: number; y: number } => {
      // v2.3.0 Stage 3b：qnOf 为自 bar 1 起的绝对四分音符坐标，减去视图首小节
      // 起点 qnBase 得相对坐标，再换算为像素（与 pixelToBarBeat 严格互逆）。
      const qn = timeline.qnOf(bar, beat) - timeline.barStartQn(viewRange.startBar);
      const x = qn * pixelsPerBeat - scrollX;
      const y = (MAX_PITCH - pitch) * NOTE_HEIGHT - scrollY;
      return { x, y };
    },
    [viewRange.startBar, pixelsPerBeat, scrollX, scrollY, timeline]
  );

  const hitTest = useCallback(
    (canvasX: number, canvasY: number): { noteId: string; edge: "body" | "right" } | null => {
      for (const note of notes) {
        const rect = noteRectsRef.current.get(note.id);
        if (!rect) continue;

        if (
          canvasX >= rect.x - 2 &&
          canvasX <= rect.x + rect.w + 2 &&
          canvasY >= rect.y &&
          canvasY <= rect.y + rect.h
        ) {
          const nearRightEdge = canvasX >= rect.x + rect.w - RESIZE_EDGE_THRESHOLD;
          return { noteId: note.id, edge: nearRightEdge ? "right" : "body" };
        }
      }
      return null;
    },
    [notes]
  );

  const handleMouseDown = useCallback(
    (canvasX: number, canvasY: number) => {
      const hit = hitTest(canvasX, canvasY);
      if (hit) {
        const note = notes.find((n) => n.id === hit.noteId);
        if (note) {
          setDraggingState({
            noteId: hit.noteId,
            mode: hit.edge === "right" ? "resize" : "move",
            startX: canvasX,
            startY: canvasY,
            originalBar: note.bar,
            originalBeat: note.beat,
            originalPitch: note.pitchMidi,
            originalDur: note.durQn,
            hasMoved: false,
          });
          onNoteSelect?.([hit.noteId]);
        }
      } else {
        onNoteSelect?.([]);
      }
    },
    [hitTest, notes, onNoteSelect]
  );

  const handleMouseMove = useCallback(
    (canvasX: number, canvasY: number) => {
      if (draggingState) {
        const deltaX = canvasX - draggingState.startX;
        const deltaY = canvasY - draggingState.startY;

        // v1.29.0 Stage 1 (D2-1): 首次发生位移即置 hasMoved —— 它是
        // handleMouseUp 中 clean-click 判定的唯一依据（未拖动才试听）。
        // 原实现从未置位（恒 false），会使任何 mousedown+mouseup 都被当作
        // clean click；此处补置，仅在 false→true 时 setState，避免每次
        // mousemove 触发重渲染（对既有 onNoteMove/onNoteResize 无影响）。
        // 副作用（既有行为修正，S1 验证登记）：拖拽结束不再重复触发
        // onNoteSelect —— 但 handleMouseDown 命中时已 onNoteSelect([id])，
        // 净选中结果不变。本调用内后续 move/resize 仍读旧 draggingState，
        // 而 hasMoved 非其计算输入，故无首帧位移丢失。
        if (!draggingState.hasMoved && (deltaX !== 0 || deltaY !== 0)) {
          setDraggingState({ ...draggingState, hasMoved: true });
        }

        if (draggingState.mode === "move") {
          const deltaBeats = deltaX / pixelsPerBeat;
          // v2.3.0 Stage 3b：originalBeats = qnOf(绝对四分音符) − qnBase，即
          // 「自 viewRange.startBar 起」的四分音符偏移（取代旧 `(bar-startBar)*4+
          // (beat-1)`）；拖拽量 deltaBeats 仍以四分音符计。新 bar/beat 由
          // barBeatFromQn 反演（真实拍号），调用处保留 Math.max(1, newBar) 下限保护。
          const originalBeats =
            timeline.qnOf(draggingState.originalBar, draggingState.originalBeat) -
            timeline.barStartQn(viewRange.startBar);
          const newTotalBeats = originalBeats + deltaBeats;
          const { bar: newBar, beat: newBeat } = timeline.barBeatFromQn(
            newTotalBeats + timeline.barStartQn(viewRange.startBar)
          );
          const deltaPitch = -Math.round(deltaY / NOTE_HEIGHT);
          const newPitch = Math.max(
            MIN_PITCH,
            Math.min(MAX_PITCH, draggingState.originalPitch + deltaPitch)
          );

          onNoteMove?.(draggingState.noteId, Math.max(1, newBar), newBeat, newPitch);
        } else if (draggingState.mode === "resize") {
          const newDur = Math.max(0.25, Math.round((draggingState.originalDur + deltaX / pixelsPerBeat) * 4) / 4);
          onNoteResize?.(draggingState.noteId, newDur);
        }
      } else {
        const hit = hitTest(canvasX, canvasY);
        setHoveredNoteId(hit?.noteId ?? null);
      }
    },
    [draggingState, pixelsPerBeat, viewRange.startBar, timeline, onNoteMove, onNoteResize, hitTest]
  );

  const handleMouseUp = useCallback(
    (canvasX: number, canvasY: number) => {
      if (draggingState && !draggingState.hasMoved) {
        onNoteSelect?.([draggingState.noteId]);
        // v1.29.0 Stage 1 (D2-1): clean click（按下后未拖动、命中既有音符）
        // 触发一次试听。拖拽（hasMoved）/ 空白点击（draggingState 为 null）
        // / 双击添加（走 handleDoubleClick）均不进入此分支。
        const note = notes.find((n) => n.id === draggingState.noteId);
        if (note) {
          onNoteAudition?.(note.pitchMidi, note.velocity);
        }
      }
      setDraggingState(null);
    },
    [draggingState, onNoteSelect, onNoteAudition, notes]
  );

  const handleDoubleClick = useCallback(
    (canvasX: number, canvasY: number) => {
      const hit = hitTest(canvasX, canvasY);
      if (!hit) {
        const { bar, beat, pitch } = pixelToBarBeat(canvasX, canvasY);
        onNoteAdd?.({
          trackId: "default",
          phraseId: null,
          bar: Math.max(1, bar),
          beat: Math.max(1, beat),
          durQn: 1,
          pitchMidi: pitch,
          pitchSpelling: "",
          velocity: 0.8,
          voice: "rh",
          tags: [],
        });
      }
    },
    [hitTest, pixelToBarBeat, onNoteAdd]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        for (const id of selectedNoteIds) {
          onNoteDelete?.(id);
        }
      }
    },
    [selectedNoteIds, onNoteDelete]
  );

  const updateNoteRects = useCallback(
    (rects: Map<string, { x: number; y: number; w: number; h: number }>) => {
      noteRectsRef.current = rects;
    },
    []
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    handleKeyDown,
    pixelToBarBeat,
    barBeatToPixel,
    hoveredNoteId,
    draggingState,
    updateNoteRects,
  };
}
