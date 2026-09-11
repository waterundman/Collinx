import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { NoteEvent, TempoMap } from "@collinx/core";
import {
  usePianoRollInteraction,
  MIN_PITCH,
  MAX_PITCH,
} from "./usePianoRollInteraction";
import { useI18n } from "../../i18n";
import styles from "./PianoRoll.module.css";

interface PianoRollViewProps {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  viewRange: { startBar: number; endBar: number };
  onNoteAdd?: (note: Omit<NoteEvent, "id">) => void;
  onNoteMove?: (noteId: string, newBar: number, newBeat: number, newPitch: number) => void;
  onNoteResize?: (noteId: string, newDurQn: number) => void;
  onNoteDelete?: (noteId: string) => void;
  onNoteSelect?: (noteIds: string[]) => void;
  selectedNoteIds?: string[];
  height?: number;
  /**
   * v1.25.0 Stage 1 (D2-1): 当前 MIDI 按下的 pitch 集合（App 层录入闭环）。
   * undefined / 空集时零行为变化（键位 className 输出与既有路径完全一致）。
   */
  activePitches?: Set<number>;
  /** v1.27.0: MIDI 录入光标（下一个落盘位置，非播放头）。undefined 零行为变化 */
  cursorPosition?: { bar: number; beat: number };
  /** v1.27.0: 量化网格细分提示（与 settings.midi.recording.quantizeGrid 同型）。undefined/0 零行为变化 */
  quantizeGridHint?: 0 | 0.25 | 0.5 | 1;
}

type ToolMode = "select" | "draw";

const NOTE_HEIGHT = 18;
const KEYBOARD_WIDTH = 56;
const BEATS_PER_BAR = 4;
const MIN_PIXELS_PER_BEAT = 15;
const MAX_PIXELS_PER_BEAT = 200;

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const WHITE_KEY_INDICES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEY_INDICES = [1, 3, 6, 8, 10];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface KeyboardKey {
  midi: number;
  isBlack: boolean;
  name: string;
  y: number;
  height: number;
}

function buildKeyboardKeys(): KeyboardKey[] {
  const keys: KeyboardKey[] = [];
  for (let midi = MIN_PITCH; midi <= MAX_PITCH; midi++) {
    const noteIndex = ((midi % 12) + 12) % 12;
    const isBlack = BLACK_KEY_INDICES.includes(noteIndex);
    const octave = Math.floor(midi / 12) - 1;
    keys.push({
      midi,
      isBlack,
      name: `${NOTE_NAMES[noteIndex]}${octave}`,
      y: (MAX_PITCH - midi) * NOTE_HEIGHT,
      height: isBlack ? 11 : NOTE_HEIGHT,
    });
  }
  return keys;
}

export const PianoRollView: React.FC<PianoRollViewProps> = ({
  notes,
  tempoMap,
  viewRange,
  onNoteAdd,
  onNoteMove,
  onNoteResize,
  onNoteDelete,
  onNoteSelect,
  selectedNoteIds = [],
  height,
  activePitches,
  cursorPosition,
  quantizeGridHint,
}) => {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(40);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const animationRef = useRef<number>(0);

  const keyboardKeys = useMemo(() => buildKeyboardKeys(), []);

  const interaction = usePianoRollInteraction({
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
    selectedNoteIds,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        setCanvasSize({ width: Math.floor(width), height: Math.floor(h) });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    ctx.scale(dpr, dpr);

    const w = canvasSize.width;
    const h = canvasSize.height;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = getCSSVar('--bg-secondary');
    ctx.fillRect(0, 0, w, h);

    const totalBeats =
      (viewRange.endBar - viewRange.startBar + 1) * BEATS_PER_BAR;

    // v1.27.0 (D1-3): 量化网格细分线开关——hint 为 0/undefined 或像素密度
    // 不足（细分间距 < 12px）时不画，保持既有行为完全不变。
    const drawSubGrid =
      quantizeGridHint !== undefined &&
      quantizeGridHint > 0 &&
      pixelsPerBeat * quantizeGridHint >= 12;

    for (let beat = 0; beat <= totalBeats; beat++) {
      const x = beat * pixelsPerBeat - scrollX;
      if (x < -2 || x > w + 2) continue;

      const isBar = beat % BEATS_PER_BAR === 0;
      ctx.strokeStyle = isBar ? getCSSVar('--border-secondary') : getCSSVar('--border-primary');
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();

      if (isBar) {
        const barNum = viewRange.startBar + beat / BEATS_PER_BAR;
        ctx.fillStyle = getCSSVar('--text-muted');
        ctx.font = "10px sans-serif";
        ctx.fillText(`${barNum}`, x + 3, 12);
      }

      if (drawSubGrid && beat < totalBeats) {
        // 每对相邻 beat 竖线之间画 quantizeGridHint 细分线（0.25 → 拍内
        // +0.25/+0.5/+0.75 三条；0.5 → +0.5 一条；1 → 无）。0.25 透明度与
        // 既有 border-primary 色、0.5 线宽，取整方式与 beat 线一致。
        const subSteps = Math.round(1 / (quantizeGridHint as number)) - 1;
        ctx.globalAlpha = 0.25;
        try {
          for (let k = 1; k <= subSteps; k++) {
            const sx = x + k * (quantizeGridHint as number) * pixelsPerBeat;
            if (sx < -2 || sx > w + 2) continue;
            ctx.strokeStyle = getCSSVar('--border-primary');
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(Math.round(sx) + 0.5, 0);
            ctx.lineTo(Math.round(sx) + 0.5, h);
            ctx.stroke();
          }
        } finally {
          // v1.27.0 (D2-3): 防护——stroke 抛出时避免 alpha=0.25 泄漏到同帧
          // 后续 cursor/音符绘制（canvas.width 重置仅跨帧自愈）。正常路径
          // 行为不变（仍画完后恢复 1），S0-T04b 的 alpha 序列断言不受影响。
          ctx.globalAlpha = 1;
        }
      }
    }

    // v1.27.0 (D1-2): MIDI 录入光标竖线（下一个落盘位置，非播放头）。
    // 越界（bar 超出 viewRange / x 出画布）不画；undefined 不画。
    if (cursorPosition) {
      const { bar, beat } = cursorPosition;
      const inViewRange =
        bar >= viewRange.startBar && bar <= viewRange.endBar;
      const cursorTicks =
        (bar - viewRange.startBar) * BEATS_PER_BAR + (beat - 1);
      const cursorX = cursorTicks * pixelsPerBeat - scrollX;
      if (inViewRange && cursorX >= 0 && cursorX <= w) {
        ctx.strokeStyle = getCSSVar('--accent-purple');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(cursorX) + 0.5 - 1, 0);
        ctx.lineTo(Math.round(cursorX) + 0.5 - 1, h);
        ctx.stroke();

        // 位置标签：与既有 bar 号标签同款（x+3, 12, 10px sans-serif）。
        ctx.fillStyle = getCSSVar('--accent-purple');
        ctx.font = "10px sans-serif";
        ctx.fillText(`m${bar}.${beat}`, cursorX + 3, 12);
      }
    }

    for (let midi = MIN_PITCH; midi <= MAX_PITCH; midi++) {
      const y = (MAX_PITCH - midi) * NOTE_HEIGHT + NOTE_HEIGHT - scrollY;
      if (y < -2 || y > h + 2) continue;

      const noteIndex = ((midi % 12) + 12) % 12;
      const isC = noteIndex === 0;

      if (isC) {
        ctx.strokeStyle = getCSSVar('--border-secondary');
        ctx.lineWidth = 1;
      } else if (BLACK_KEY_INDICES.includes(noteIndex)) {
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(0, y - NOTE_HEIGHT, w, NOTE_HEIGHT);
        ctx.strokeStyle = getCSSVar('--border-primary');
        ctx.lineWidth = 0.5;
      } else {
        ctx.strokeStyle = getCSSVar('--border-primary');
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
    }

    const noteRects = new Map<string, { x: number; y: number; w: number; h: number }>();

    for (const note of notes) {
      const noteTotalBeats =
        (note.bar - viewRange.startBar) * BEATS_PER_BAR + (note.beat - 1);
      const nx = noteTotalBeats * pixelsPerBeat - scrollX;
      const ny = (MAX_PITCH - note.pitchMidi) * NOTE_HEIGHT - scrollY;
      const nw = Math.max(3, note.durQn * pixelsPerBeat);
      const nh = NOTE_HEIGHT - 1;

      if (nx + nw < 0 || nx > w) continue;

      const isSelected = selectedNoteIds.includes(note.id);
      const isHovered = note.id === interaction.hoveredNoteId;

      const grad = ctx.createLinearGradient(nx, ny, nx, ny + nh);
      if (isSelected) {
        grad.addColorStop(0, getCSSVar('--accent-purple'));
        grad.addColorStop(1, getCSSVar('--accent-purple-dark'));
      } else if (isHovered) {
        grad.addColorStop(0, getCSSVar('--accent-lavender-light'));
        grad.addColorStop(1, getCSSVar('--accent-purple-light'));
      } else {
        grad.addColorStop(0, getCSSVar('--bg-surface'));
        grad.addColorStop(1, getCSSVar('--bg-elevated'));
      }
      ctx.fillStyle = grad;

      const r = 2;
      ctx.beginPath();
      ctx.moveTo(nx + r, ny);
      ctx.lineTo(nx + nw - r, ny);
      ctx.quadraticCurveTo(nx + nw, ny, nx + nw, ny + r);
      ctx.lineTo(nx + nw, ny + nh - r);
      ctx.quadraticCurveTo(nx + nw, ny + nh, nx + nw - r, ny + nh);
      ctx.lineTo(nx + r, ny + nh);
      ctx.quadraticCurveTo(nx, ny + nh, nx, ny + nh - r);
      ctx.lineTo(nx, ny + r);
      ctx.quadraticCurveTo(nx, ny, nx + r, ny);
      ctx.closePath();
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? getCSSVar("--text-primary") : getCSSVar('--accent-purple');
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = getCSSVar('--text-muted');
      ctx.font = "9px sans-serif";
      const label = note.pitchSpelling || NOTE_NAMES[note.pitchMidi % 12];
      if (nw > 20) {
        ctx.fillText(label, nx + 3, ny + 13);
      }

      noteRects.set(note.id, { x: nx, y: ny, w: nw, h: nh });
    }

    interaction.updateNoteRects(noteRects);
  }, [
    notes,
    viewRange,
    pixelsPerBeat,
    scrollX,
    scrollY,
    canvasSize,
    selectedNoteIds,
    interaction,
    cursorPosition,
    quantizeGridHint,
  ]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      interaction.handleMouseDown(x, y);
    },
    [getCanvasCoords, interaction]
  );

  const onCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      interaction.handleMouseMove(x, y);
    },
    [getCanvasCoords, interaction]
  );

  const onCanvasMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      interaction.handleMouseUp(x, y);
    },
    [getCanvasCoords, interaction]
  );

  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getCanvasCoords(e);
      interaction.handleDoubleClick(x, y);
    },
    [getCanvasCoords, interaction]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const scaleFactor = 1.1;
      const newPpb = e.deltaY > 0
        ? Math.max(MIN_PIXELS_PER_BEAT, pixelsPerBeat / scaleFactor)
        : Math.min(MAX_PIXELS_PER_BEAT, pixelsPerBeat * scaleFactor);
      setPixelsPerBeat(newPpb);
    },
    [pixelsPerBeat]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      interaction.handleKeyDown(e);
    },
    [interaction]
  );

  const cursorStyle =
    interaction.draggingState?.mode === "move"
      ? "grabbing"
      : interaction.draggingState?.mode === "resize"
        ? "ew-resize"
        : interaction.hoveredNoteId
          ? "grab"
          : "crosshair";

  const totalCanvasWidth =
    (viewRange.endBar - viewRange.startBar + 1) * BEATS_PER_BAR * pixelsPerBeat;
  const totalCanvasHeight = (MAX_PITCH - MIN_PITCH + 1) * NOTE_HEIGHT;

  return (
    <div
      className={styles.pianoRoll}
      data-testid="piano-roll"
      style={{ height: height ? `${height}px` : "100%" }}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className={styles.toolbar} data-testid="piano-roll-toolbar">
        <span className={styles.toolbarLabel}>{t('pianoRoll.tools')}</span>
        <button
          data-testid="piano-roll-select"
          className={`${styles.toolbarButton} ${toolMode === "select" ? styles.toolbarButtonActive : ""}`}
          onClick={() => setToolMode("select")}
        >
          {t('pianoRoll.select')}
        </button>
        <button
          data-testid="piano-roll-draw"
          className={`${styles.toolbarButton} ${toolMode === "draw" ? styles.toolbarButtonActive : ""}`}
          onClick={() => setToolMode("draw")}
        >
          {t('pianoRoll.draw')}
        </button>
        <span className={styles.toolbarLabel}>{t('pianoRoll.quantize')}</span>
        <select className={styles.toolbarSelect} data-testid="piano-roll-quantize" defaultValue="1/4">
          <option value="1/4">1/4</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
        </select>
        <span className={styles.toolbarLabel}>{t('pianoRoll.zoom')}</span>
        <button
          data-testid="piano-roll-zoom-out"
          className={styles.toolbarButton}
          onClick={() =>
            setPixelsPerBeat((p) => Math.max(MIN_PIXELS_PER_BEAT, p / 1.2))
          }
        >
          -
        </button>
        <button
          data-testid="piano-roll-zoom-in"
          className={styles.toolbarButton}
          onClick={() =>
            setPixelsPerBeat((p) => Math.min(MAX_PIXELS_PER_BEAT, p * 1.2))
          }
        >
          +
        </button>
        <span className={styles.toolbarLabel}>
          {viewRange.startBar}-{viewRange.endBar}
        </span>
      </div>

      <div className={styles.mainArea}>
        <div className={styles.keyboard} ref={keyboardRef}>
          <div style={{ transform: `translateY(${-scrollY}px)`, position: "relative" }}>
            {keyboardKeys.map((key) => {
              // v1.25.0 Stage 1 (D2-1): MIDI 输入高亮落点选在键位 DOM 层而非
              // canvas 格位——(1) noteon/noteoff 与物理按键一一对应，键位高亮
              // 最符合演奏直觉；(2) canvas 走既有 drawCanvas 绘制管线，不触碰
              // 它可保证 activePitches 为空/undefined 时零行为变化；(3) 键位是
              // DOM 元素，高亮 class 可被测试直接断言。
              const isActive = activePitches?.has(key.midi) ?? false;
              return key.isBlack ? (
                <div
                  key={key.midi}
                  className={
                    isActive
                      ? `${styles.blackKey} ${styles.keyActive}`
                      : styles.blackKey
                  }
                  style={{
                    top: `${key.y - scrollY}px`,
                    height: `${key.height}px`,
                  }}
                />
              ) : (
                <div
                  key={key.midi}
                  className={
                    isActive
                      ? `${styles.whiteKey} ${styles.keyActive}`
                      : styles.whiteKey
                  }
                  style={{
                    top: `${key.y - scrollY}px`,
                    height: `${key.height}px`,
                  }}
                  title={key.name}
                >
                  {key.name}
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.gridContainer} ref={containerRef}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            data-testid="piano-roll-canvas"
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            onDoubleClick={onCanvasDoubleClick}
            onWheel={handleWheel}
            style={{ cursor: cursorStyle }}
          />
        </div>
      </div>

      <div className={styles.timeline}>
        {Array.from(
          { length: (viewRange.endBar - viewRange.startBar + 1) * BEATS_PER_BAR + 1 },
          (_, beat) => {
            const x = beat * pixelsPerBeat - scrollX;
            const isBar = beat % BEATS_PER_BAR === 0;
            if (isBar) {
              return (
                <span
                  key={beat}
                  className={styles.timelineMark}
                  style={{ left: `${x}px` }}
                >
                  {viewRange.startBar + beat / BEATS_PER_BAR}
                </span>
              );
            }
            return (
              <div
                key={beat}
                className={styles.timelineTick}
                style={{ left: `${x}px` }}
              />
            );
          }
        )}
      </div>
    </div>
  );
};
