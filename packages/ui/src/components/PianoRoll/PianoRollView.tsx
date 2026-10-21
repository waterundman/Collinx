import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { NoteEvent, TempoMap } from "@collinx/core";
import {
  usePianoRollInteraction,
  MIN_PITCH,
  MAX_PITCH,
} from "./usePianoRollInteraction";
import { useI18n } from "../../i18n";
import styles from "./PianoRoll.module.css";
import { createBarTimeline } from "./bar-timeline";

interface PianoRollViewProps {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  viewRange: { startBar: number; endBar: number };
  onNoteAdd?: (note: Omit<NoteEvent, "id">) => void;
  onNoteMove?: (noteId: string, newBar: number, newBeat: number, newPitch: number) => void;
  onNoteResize?: (noteId: string, newDurQn: number) => void;
  onNoteDelete?: (noteId: string) => void;
  onNoteSelect?: (noteIds: string[]) => void;
  /** v1.29.0 Stage 1 (D2-2): clean click 试听（pitchMidi 0-127 / velocity 0-1）。
   *  undefined 零行为变化（与 v1.25-v1.28 先例一致，仅透传给交互 hook）。 */
  onNoteAudition?: (pitchMidi: number, velocity: number) => void;
  selectedNoteIds?: string[];
  height?: number;
  /**
   * v1.25.0 Stage 1 (D2-1): 当前 MIDI 按下的 pitch 集合（App 层录入闭环）。
   * undefined / 空集时零行为变化（键位 className 输出与既有路径完全一致）。
   */
  activePitches?: Set<number>;
  /** v1.27.0: MIDI 录入光标（下一个落盘位置，非播放头）。undefined 零行为变化 */
  cursorPosition?: { bar: number; beat: number };
  /**
   * v2.0.0 Stage 1 (D1-2): 播放头位置（transport 播放位置，与录入光标语义正交，
   * 两者可同时显示）。beat 允许小数（连续播放头）：竖线 x 用连续 beat 值绘制，
   * 顶部倒三角 + 位置标签 `m{bar}.{floor(beat)}` 取整显示；橙色
   * （--accent-sunset，区别于光标的 --accent-purple）。
   * 越界（bar 超出 viewRange / x 出画布）不绘制。
   * undefined = 零行为变化（绘制调用序列与 v1.29 逐字节一致）。
   */
  playheadPosition?: { bar: number; beat: number };
  /**
   * v2.1.0 S3 (D13-5，v2.3.0 S3 修订)：时间轴点击定位回调。点击 x → 反演为
   * bar/beat（按 `tempoMap` **真实拍号**，即 numerator×4/denominator 四分音符/小节，
   * 见 bar-timeline.ts）→ 回调。undefined 零行为变化（时间轴无 onClick）。
   */
  onSeek?: (pos: { bar: number; beat: number }) => void;
  /**
   * v2.1.0 S3 (D13-6)：loop 区间可视化（时间轴高亮）。enabled=false 或
   * undefined/null 零行为变化（不渲染高亮元素）。
   */
  loopRegion?: {
    enabled: boolean;
    start: { bar: number; beat: number };
    end: { bar: number; beat: number };
  } | null;
  /** v1.27.0: 量化网格细分提示（与 settings.midi.recording.quantizeGrid 同型）。undefined/0 零行为变化 */
  quantizeGridHint?: 0 | 0.25 | 0.5 | 1;
  /** v2.4.0 S5：工具栏「量化」下拉的真实落点（写回 settings.midi.recording.quantizeGrid）。 */
  onQuantizeGridChange?: (grid: 0 | 0.25 | 0.5 | 1) => void;
  /** v1.28.0: cursor 越视口自动滚动跟随（if-needed 最小平移语义，DAW 惯例）。
   *  右缘阈值 w-48 / 左出时左缘留 48px；clamp [0, maxScrollX]。
   *  默认 false 零行为变化。
   *  v2.0.0 Stage 2 (D2-1): 跟随目标泛化为 `playheadPosition ?? cursorPosition`
   *  （播放头优先）；仅给 cursorPosition 时与 v1.28 逐字节一致。 */
  autoScrollFollow?: boolean;
  /** v2.0.0 Stage 2 (D2-4): transport 运行代次（App 在 play/stop 时自增）。
   *  **值变化**即复位内部 followSuspended=false（Ableton 语义：手动平移会挂起
   *  跟随，直到 transport 停止/重启）。undefined 或同值重渲染 = 零行为变化。 */
  transportRunId?: number;
  /**
   * v2.0.0 Stage 2.1 (S2.1 裁决): 是否允许播放头作为自动跟随权威。
   * D2-1 字面规则 `playheadPosition ?? cursorPosition`（播放头优先）只承诺
   * 「仅给 cursorPosition 时与 v1.28 一致」，却未考虑 App **同时恒传**
   * playheadPosition（idle 时恒为 m1.1）的接线场景 —— 那会让跟随目标永远停在
   * x=0 的播放头，静默杀掉 v1.28 的录入光标自动跟随。故 S2.1 裁决：按 transport
   * 是否运行切换跟随权威。`false` = 忽略播放头、回退到 cursorPosition；未给
   * cursorPosition 时即不跟随。**默认 true**（不传时行为与 S2 一致，既有组件级
   * 用例不受影响）。
   */
  followPlayhead?: boolean;
}

type ToolMode = "select" | "draw";

const NOTE_HEIGHT = 18;
const KEYBOARD_WIDTH = 56;
const MIN_PIXELS_PER_BEAT = 15;
const MAX_PIXELS_PER_BEAT = 200;
/** v1.28.0 (D1-2): autoScrollFollow 的右缘/左缘留白（px）。 */
const FOLLOW_EDGE_MARGIN = 48;

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
  onNoteAudition,
  selectedNoteIds = [],
  height,
  activePitches,
  cursorPosition,
  playheadPosition,
  onSeek,
  loopRegion,
  quantizeGridHint,
  onQuantizeGridChange,
  autoScrollFollow,
  transportRunId,
  followPlayhead = true,
}) => {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(40);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  /** 供自动定位 effect 读取最新滚动位置，避免把 scrollY 放进依赖导致滚走就被弹回 */
  const scrollYRef = useRef(scrollY);
  scrollYRef.current = scrollY;
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  // v2.4.0 S5：默认「绘制」= 双击新增音符（与改动前行为一致）；切到「选择」后
  // 双击不再新增，工具按钮因此真正影响交互而非只换高亮。
  const [toolMode, setToolMode] = useState<ToolMode>("draw");
  const animationRef = useRef<number>(0);

  // v2.0.0 Stage 2 (D2-4): 手动平移挂起跟随；transportRunId 值变化即复位。
  const [followSuspended, setFollowSuspended] = useState(false);
  // v2.0.0 Stage 2 (D2-2): 中键拖拽平移状态（client 坐标 + 起始滚动量）。
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollX: number;
    startScrollY: number;
  } | null>(null);

  // v2.3.0 Stage 3 (S3)：拍号时间线——一次 O(N) 建前缀表，六处时间数学共用。
  // qnBase = 视图首小节起点的绝对四分音符坐标；totalRelQn = 相对总拍数
  // （4/4 下逐值等于旧式 `(endBar - startBar + 1) * BEATS_PER_BAR`）。
  const timeline = useMemo(
    () =>
      createBarTimeline(tempoMap, {
        startBar: viewRange.startBar,
        endBar: viewRange.endBar,
      }),
    [tempoMap, viewRange.startBar, viewRange.endBar]
  );
  const qnBase = timeline.barStartQn(viewRange.startBar);
  const totalRelQn = timeline.barStartQn(viewRange.endBar + 1) - qnBase;

  // v2.0.0 Stage 2 (D2-3): 平移上界。maxScrollY = (MAX_PITCH-MIN_PITCH+1)*18 - h
  // （= 930 @h=600）；maxScrollX 与既有 follow effect 公式一致。
  const maxScrollX = Math.max(
    0,
    totalRelQn * pixelsPerBeat - canvasSize.width
  );
  const maxScrollY = Math.max(
    0,
    (MAX_PITCH - MIN_PITCH + 1) * NOTE_HEIGHT - canvasSize.height
  );

  // v2.0.0 Stage 2 (D2-1): 跟随目标 = 播放头优先，回退到录入光标。
  // v2.0.0 Stage 2.1 (S2.1 裁决): followPlayhead=false 时忽略播放头（回退到
  // 录入光标），用于 App 在 transport 未运行时保住 v1.28 的录入光标自动跟随。
  const followTarget = (followPlayhead ? playheadPosition : undefined) ?? cursorPosition;

  const keyboardKeys = useMemo(() => buildKeyboardKeys(), []);

  /**
   * v2.8.0：音符在钢琴卷帘里看不见的真正根因。
   *
   * NOTE_HEIGHT 是固定 18px，整个音域（C1~C8）高约 1584px，而画布只有
   * ~228px —— 一次只显示 12 个半音。scrollY 默认为 0（顶部 = C8），
   * 而音乐通常写在 C2~C5，于是所有音符的 ny 都落在画布下方 1000px 处，
   * 画了但完全不可见（实测 canvas 像素里紫色样本数为 0）。
   *
   * 这里只在「当前视口内一个音符都没有」时重新定位，并把视口中心对准
   * 音符的平均音高 —— 用户手动滚到别处时不会被弹回。
   */
  const didInitialFitRef = useRef(false);
  /**
   * 只在**首次**就绪（画布量出高度后）做一次纵向定位。
   *
   * 之前挂在 notes 变化上会抢用户的操作：任何一次音符增删都会重算 scrollY，
   * 于是「中键拖拽平移」的位移断言被改写的 scrollY 顶掉（实测 S2-T17 红）。
   * 用户一旦能看见音符，之后就不再自动定位 —— 平移权完全交给用户。
   */
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (notes.length === 0 || canvasSize.height <= 0) return;
    didInitialFitRef.current = true;
    const h = canvasSize.height;
    const avgPitch = notes.reduce((sum, n) => sum + n.pitchMidi, 0) / notes.length;
    const target = (MAX_PITCH - avgPitch) * NOTE_HEIGHT - h / 2;
    setScrollY(Math.max(0, Math.min(maxScrollY, target)));
  }, [notes, canvasSize.height, maxScrollY]);


  const interaction = usePianoRollInteraction({
    notes,
    // v2.3.0 Stage 3b（S3 收口）：音符落点/矩形/拖拽换算与网格线同源同一 `tempoMap`
    // （真实拍号），消除 3/4、7/8 下「网格按真实拍号、音符按 4 拍」的彼此错位。
    tempoMap,
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
    toolMode,
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

    // v2.3.0 Stage 3 (S3)：网格竖线**逐小节**绘制（每小节一条主 bar 线 + 小节内
    // ceil(beatsPerBar)-1 条次线），拍号取自 timeline（真实 numerator×4/denominator，
    // 依据 core tempo-map.ts:120/:183）。4/4 下竖线 q 序列与标签序列与旧
    // `beat ∈ [0, totalBeats]` 派生式**逐值相同**（S3-T51 零回归负控）。
    //
    // v1.27.0 (D1-3): 量化网格细分线开关——hint 为 0/undefined 或像素密度
    // 不足（细分间距 < 12px）时不画，保持既有行为完全不变。
    const drawSubGrid =
      quantizeGridHint !== undefined &&
      quantizeGridHint > 0 &&
      pixelsPerBeat * quantizeGridHint >= 12;

    const drawGridVertical = (q: number, barLabel: number | null) => {
      const x = q * pixelsPerBeat - scrollX;
      if (x < -2 || x > w + 2) return;

      const isBar = barLabel !== null;
      ctx.strokeStyle = isBar ? getCSSVar('--border-secondary') : getCSSVar('--border-primary');
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();

      if (isBar) {
        ctx.fillStyle = getCSSVar('--text-muted');
        ctx.font = "10px sans-serif";
        ctx.fillText(`${barLabel}`, x + 3, 12);
      }

      if (drawSubGrid && q < totalRelQn) {
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
    };

    for (let bar = viewRange.startBar; bar <= viewRange.endBar; bar++) {
      const barStartRel = timeline.barStartQn(bar) - qnBase;
      const subLines = Math.ceil(timeline.beatsPerBarAt(bar)) - 1;
      drawGridVertical(barStartRel, bar);
      for (let j = 1; j <= subLines; j++) {
        drawGridVertical(barStartRel + j, null);
      }
    }
    // 收尾边界小节 endBar+1 的主 bar 线（旧 4/4 在 beat=totalBeats 处画的那条）。
    drawGridVertical(totalRelQn, viewRange.endBar + 1);

    // v1.27.0 (D1-2): MIDI 录入光标竖线（下一个落盘位置，非播放头）。
    // 越界（bar 超出 viewRange / x 出画布）不画；undefined 不画。
    if (cursorPosition) {
      const { bar, beat } = cursorPosition;
      const inViewRange =
        bar >= viewRange.startBar && bar <= viewRange.endBar;
      const cursorTicks = timeline.qnOf(bar, beat) - qnBase;
      const cursorX = cursorTicks * pixelsPerBeat - scrollX;
      if (inViewRange && cursorX >= 0 && cursorX <= w) {
        ctx.strokeStyle = getCSSVar('--accent-purple');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(cursorX) + 0.5 - 1, 0);
        ctx.lineTo(Math.round(cursorX) + 0.5 - 1, h);
        ctx.stroke();

        // v1.28.0 (D1-1): 顶部倒三角图标（与竖线同色）——顶点 (cursorX, 8)、
        // 两上角 (cursorX∓4, 0)，实心填充。
        ctx.fillStyle = getCSSVar('--accent-purple');
        ctx.beginPath();
        ctx.moveTo(cursorX, 8);
        ctx.lineTo(cursorX - 4, 0);
        ctx.lineTo(cursorX + 4, 0);
        ctx.closePath();
        ctx.fill();

        // 位置标签：与既有 bar 号标签同款（x+6, 12, 10px sans-serif）；
        // v1.28.0 起由 +3 右移至 +6，避让三角半宽 4px。
        ctx.fillStyle = getCSSVar('--accent-purple');
        ctx.font = "10px sans-serif";
        ctx.fillText(`m${bar}.${beat}`, cursorX + 6, 12);
      }
    }

    // v2.0.0 Stage 1 (D1-2): 播放头竖线（与录入光标正交，可同时显示）。
    // 橙色（--accent-sunset）区别于光标紫色；竖线 x 用连续小数 beat（平滑
    // 移动），顶部倒三角几何复用 v1.28 光标写法，位置标签取 floor(beat)。
    // 越界（bar 超出 viewRange / x 出画布）不画；undefined 不画（零行为变化）。
    if (playheadPosition) {
      const { bar, beat } = playheadPosition;
      const inViewRange = bar >= viewRange.startBar && bar <= viewRange.endBar;
      const playheadTicks = timeline.qnOf(bar, beat) - qnBase;
      const playheadX = playheadTicks * pixelsPerBeat - scrollX;
      if (inViewRange && playheadX >= 0 && playheadX <= w) {
        ctx.strokeStyle = getCSSVar('--accent-sunset');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, h);
        ctx.stroke();

        // 顶部倒三角（与竖线同色）：顶点 (playheadX, 8)、两上角 (playheadX∓4, 0)。
        ctx.fillStyle = getCSSVar('--accent-sunset');
        ctx.beginPath();
        ctx.moveTo(playheadX, 8);
        ctx.lineTo(playheadX - 4, 0);
        ctx.lineTo(playheadX + 4, 0);
        ctx.closePath();
        ctx.fill();

        // 位置标签：beat 为小数（连续播放头）→ 显示取整；x = 竖线 + 6 避让三角。
        ctx.fillStyle = getCSSVar('--accent-sunset');
        ctx.font = "10px sans-serif";
        ctx.fillText(`m${bar}.${Math.floor(beat)}`, playheadX + 6, 12);
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
      // v2.3.0 S3：音符 x 亦由 timeline 派生（4/4 下与旧式逐值相同）。
      const noteTotalBeats = timeline.qnOf(note.bar, note.beat) - qnBase;
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
        // v2.8.0：原先音符用 --bg-surface/--bg-elevated 填充，浅色主题下两者
        // 都是 #ffffff → 纯白音符画在白网格上，整条轨道看起来是空的。
        grad.addColorStop(0, getCSSVar('--note-fill-hover'));
        grad.addColorStop(1, getCSSVar('--accent-purple-light'));
      } else {
        grad.addColorStop(0, getCSSVar('--note-fill'));
        grad.addColorStop(1, getCSSVar('--note-fill'));
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
    timeline,
    qnBase,
    totalRelQn,
    pixelsPerBeat,
    scrollX,
    scrollY,
    canvasSize,
    selectedNoteIds,
    interaction,
    cursorPosition,
    playheadPosition,
    quantizeGridHint,
  ]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // v2.0.0 Stage 2 (D2-4): transportRunId **值变化**（非"值存在"）才复位挂起。
  // v2.0.0 S5 (D5-4)：**删除已被证明冗余的 prevTransportRunIdRef 守卫**——deps 只有
  // [transportRunId]，React 的依赖比较（Object.is）本身即等价于"值变化"，父层同值
  // 重渲染不会重跑本 effect（原守卫的注释声称的作用已由 deps 承担）。挂载时首跑一次
  // setFollowSuspended(false) 为 no-op（初值已是 false）。S2 验证期以变异证实删守卫后
  // T16 仍绿、删整个 effect 才变红。
  useEffect(() => {
    setFollowSuspended(false);
  }, [transportRunId]);

  // v1.28.0 (D1-2): 越视口自动滚动跟随——if-needed 最小平移语义（DAW 惯例）：
  // 仅在目标越过右缘阈值 w-48 或左出画布时平移，落在视口内不动。独立 effect
  // （不并入上面的重绘 effect）；setScrollX 后由 drawCanvas 的 scrollX 依赖链
  // 自然触发重绘。scrollX 读自闭包，驱动事件是 followTarget 变化（父层重渲染
  // 时闭包必然新鲜）；仍将 scrollX 列入 deps 以满足 exhaustive-deps，effect 幂等
  // （平移到位后走 else 分支 return）不会自激循环。
  //
  // v2.0.0 Stage 2 (D2-1): 目标由 cursorPosition 泛化为 followTarget
  // （playheadPosition ?? cursorPosition）。仅给 cursor 时 followTarget ===
  // cursorPosition，几何与依赖与 v1.28 完全一致（零回归）。
  // v2.0.0 Stage 2.1 (S2.1 裁决): followPlayhead 进 deps —— 其值翻转会改变
  // followTarget，必须重跑本 effect（初值 true，不传时不改变既有行为）。
  // v2.0.0 Stage 2 (D2-4): followSuspended 为真时不再自动平移（手动平移已挂起）。
  useEffect(() => {
    if (!autoScrollFollow || followSuspended || !followTarget) return;
    const { bar, beat } = followTarget;
    if (bar < viewRange.startBar || bar > viewRange.endBar) return;

    const targetTicks = timeline.qnOf(bar, beat) - qnBase;
    const w = canvasSize.width;
    const targetX = targetTicks * pixelsPerBeat - scrollX;

    let newScrollX: number;
    if (targetX > w - FOLLOW_EDGE_MARGIN) {
      newScrollX = targetTicks * pixelsPerBeat - (w - FOLLOW_EDGE_MARGIN);
    } else if (targetX < 0) {
      newScrollX = targetTicks * pixelsPerBeat - FOLLOW_EDGE_MARGIN;
    } else {
      return;
    }

    newScrollX = Math.max(0, Math.min(newScrollX, maxScrollX));
    if (newScrollX !== scrollX) setScrollX(newScrollX);
  }, [
    autoScrollFollow,
    followSuspended,
    followTarget,
    followPlayhead,
    pixelsPerBeat,
    timeline,
    qnBase,
    scrollX,
    canvasSize.width,
    viewRange,
    maxScrollX,
  ]);

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
      // v2.0.0 Stage 2 (D2-2): 中键/右键走各自通道（中键平移经 pointer 事件），
      // 不再进入音符交互。左键（button 0）行为不变。
      if (e.button !== 0) return;
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

  // v2.0.0 Stage 2 (D2-2): 滚轮语义重映射（D1 决策，替换 v1.28 的 wheel=缩放）：
  //   plain wheel      → scrollY 纵向平移
  //   Shift+wheel      → scrollX 横向平移
  //   Ctrl/⌘+wheel     → pixelsPerBeat 缩放（工具栏 +/- 按钮不受影响，仍可用）
  // 平移均 clamp；任何平移置 followSuspended=true 挂起跟随（D2-4）。
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(v, hi));

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const scaleFactor = 1.1;
        const newPpb =
          e.deltaY > 0
            ? Math.max(MIN_PIXELS_PER_BEAT, pixelsPerBeat / scaleFactor)
            : Math.min(MAX_PIXELS_PER_BEAT, pixelsPerBeat * scaleFactor);
        setPixelsPerBeat(newPpb);
        // 缩放改变总宽 → 重新钳制 scrollX，避免越界。
        setScrollX((prev) =>
          clamp(prev, 0, Math.max(0, totalRelQn * newPpb - canvasSize.width))
        );
        return;
      }
      if (e.shiftKey) {
        setScrollX((prev) => clamp(prev + e.deltaY, 0, maxScrollX));
      } else {
        // v2.0.0 S5 (D5-2): 触控板横向滚动（deltaX）驱动 scrollX。鼠标滚轮的
        // deltaX 通常为 0，故既有 "plain wheel → scrollY" 语义不受影响；触控板
        // 斜向手势可同时平移两轴。非有限防御：合成事件可能缺 deltaX（undefined），
        // 不做防御会让 prev + undefined = NaN 污染 scrollX。
        const deltaX = Number.isFinite(e.deltaX) ? e.deltaX : 0;
        if (deltaX !== 0) {
          setScrollX((prev) => clamp(prev + deltaX, 0, maxScrollX));
        }
        setScrollY((prev) => clamp(prev + e.deltaY, 0, maxScrollY));
      }
      setFollowSuspended(true);
    },
    [pixelsPerBeat, maxScrollX, maxScrollY, canvasSize.width, totalRelQn]
  );

  // v2.0.0 Stage 2 (D2-2): 中键拖拽平移（pointerdown button===1 → move → up）。
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startScrollX: scrollX,
        startScrollY: scrollY,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [scrollX, scrollY]
  );

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pan = panStateRef.current;
      if (!pan) return;
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      setScrollX(clamp(pan.startScrollX - dx, 0, maxScrollX));
      setScrollY(clamp(pan.startScrollY - dy, 0, maxScrollY));
      setFollowSuspended(true);
    },
    [maxScrollX, maxScrollY]
  );

  const onCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 1) return;
      panStateRef.current = null;
    },
    []
  );

  // v2.0.0 S5 (D5-3): 手势被浏览器中断（pointercancel——如系统手势接管、触控板
  // 手势抢占）时清理平移状态。缺此清理会让 panStateRef 残留，导致后续
  // pointermove 继续平移（视觉上"卡住"）。注：cancel 事件的 button 不可靠
  // （常为 -1 或 0），故**不按 button 过滤**，直接清状态。
  const onCanvasPointerCancel = useCallback(() => {
    panStateRef.current = null;
  }, []);

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

  const totalCanvasWidth = totalRelQn * pixelsPerBeat;
  const totalCanvasHeight = (MAX_PITCH - MIN_PITCH + 1) * NOTE_HEIGHT;

  // v2.3.0 Stage 3 (S3)：时间轴刻度亦逐小节生成（真实拍号）。4/4 下与旧
  // `beat ∈ [0, totalBeats]` 的 span/div 序列逐值相同（S3-T51 零回归负控）。
  const timelineMarks: React.ReactNode[] = [];
  for (let bar = viewRange.startBar; bar <= viewRange.endBar; bar++) {
    const barStartRel = timeline.barStartQn(bar) - qnBase;
    timelineMarks.push(
      <span
        key={`bar-${bar}`}
        className={styles.timelineMark}
        style={{ left: `${barStartRel * pixelsPerBeat - scrollX}px` }}
      >
        {bar}
      </span>
    );
    const subLines = Math.ceil(timeline.beatsPerBarAt(bar)) - 1;
    for (let j = 1; j <= subLines; j++) {
      timelineMarks.push(
        <div
          key={`tick-${bar}-${j}`}
          className={styles.timelineTick}
          style={{ left: `${(barStartRel + j) * pixelsPerBeat - scrollX}px` }}
        />
      );
    }
  }
  timelineMarks.push(
    <span
      key={`bar-${viewRange.endBar + 1}`}
      className={styles.timelineMark}
      style={{ left: `${totalRelQn * pixelsPerBeat - scrollX}px` }}
    >
      {viewRange.endBar + 1}
    </span>
  );

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
        <select
          className={styles.toolbarSelect}
          data-testid="piano-roll-quantize"
          value={String(quantizeGridHint ?? 0)}
          onChange={(e) =>
            onQuantizeGridChange?.(Number(e.target.value) as 0 | 0.25 | 0.5 | 1)
          }
        >
          <option value="0">关</option>
          <option value="0.25">1/16</option>
          <option value="0.5">1/8</option>
          <option value="1">1/4</option>
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
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerCancel}
            style={{ cursor: cursorStyle }}
          />
        </div>
      </div>

      <div
        className={styles.timeline}
        data-testid="piano-roll-timeline"
        onClick={
          onSeek
            ? (e) => {
                // v2.1.0 S3 (D13-5，v2.3.0 S3 修订)：点击 x → 反演 bar/beat。
                // 定位式为 `x = (qnOf(bar, beat) - qnBase) * ppb - scrollX`
                // （qnOf 为自 bar 1 起的绝对四分音符坐标），故反演
                // `relQn = (localX + scrollX) / ppb`；再由 `barBeatFromQn` 按
                // **`tempoMap` 真实拍号**（numerator×4/denominator 四分音符/小节）
                // 还原 bar/beat，取代 v2.1.0 的「按视图的 4 拍/小节网格」写死式。
                // 负半区（视图外）忽略。
                const rect = e.currentTarget.getBoundingClientRect();
                const relQn = (e.clientX - rect.left + scrollX) / pixelsPerBeat;
                if (relQn < 0) return;
                onSeek(timeline.barBeatFromQn(relQn + qnBase));
              }
            : undefined
        }
      >
        {loopRegion?.enabled ? (
          <div
            className={styles.timelineLoopRegion}
            data-testid="piano-roll-loop-region"
            style={{
              left: `${
                timeline.qnOf(loopRegion.start.bar, loopRegion.start.beat) *
                  pixelsPerBeat -
                scrollX
              }px`,
              width: `${
                (timeline.qnOf(loopRegion.end.bar, loopRegion.end.beat) -
                  timeline.qnOf(loopRegion.start.bar, loopRegion.start.beat)) *
                pixelsPerBeat
              }px`,
            }}
          />
        ) : null}
        {timelineMarks}
      </div>
    </div>
  );
};
