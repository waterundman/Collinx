import { useCallback, useRef, useState } from "react";
import { NoteEvent } from "@collinx/core";

const NOTE_HEIGHT = 18;
export const MIN_PITCH = 24;
export const MAX_PITCH = 108;
const BEATS_PER_BAR = 4;
const RESIZE_EDGE_THRESHOLD = 6;

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
  } = params;

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
  const [playheadPosition, setPlayheadPosition] = useState(0);

  const noteRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());

  const pixelToBarBeat = useCallback(
    (x: number, y: number): { bar: number; beat: number; pitch: number } => {
      const gridX = x + scrollX;
      const gridY = y + scrollY;

      const totalBeats = gridX / pixelsPerBeat;
      const bar = viewRange.startBar + Math.floor(totalBeats / BEATS_PER_BAR);
      const beat = (totalBeats % BEATS_PER_BAR) + 1;

      const pitch = MAX_PITCH - Math.floor(gridY / NOTE_HEIGHT);

      return {
        bar: Math.max(1, bar),
        beat: Math.max(1, Math.min(BEATS_PER_BAR + 0.999, beat)),
        pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)),
      };
    },
    [scrollX, scrollY, pixelsPerBeat, viewRange.startBar]
  );

  const barBeatToPixel = useCallback(
    (bar: number, beat: number, pitch: number): { x: number; y: number } => {
      const totalBeats = (bar - viewRange.startBar) * BEATS_PER_BAR + (beat - 1);
      const x = totalBeats * pixelsPerBeat - scrollX;
      const y = (MAX_PITCH - pitch) * NOTE_HEIGHT - scrollY;
      return { x, y };
    },
    [viewRange.startBar, pixelsPerBeat, scrollX, scrollY]
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
          const originalBeats =
            (draggingState.originalBar - viewRange.startBar) * BEATS_PER_BAR +
            (draggingState.originalBeat - 1);
          const newTotalBeats = originalBeats + deltaBeats;
          const newBar =
            viewRange.startBar + Math.max(0, Math.floor(newTotalBeats / BEATS_PER_BAR));
          const newBeat = ((newTotalBeats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR + 1;
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
    [draggingState, pixelsPerBeat, viewRange.startBar, onNoteMove, onNoteResize, hitTest]
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
    playheadPosition,
    updateNoteRects,
  };
}
