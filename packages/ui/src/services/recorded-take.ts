/**
 * v2.2.0 S1 (D22)：录制 take → NoteEvent[] 转换（纯函数，可单测）。
 *
 * 职责边界：只做「时刻 → 工程音符」的换算（落点量化 / 时长 / velocity），
 * 不触 store（批量落盘经 provider.addNotes = 一条 undo 记录）。
 *
 * 换算规则（SPEC v2.2.0 D22）：
 * - 落点：take 的谱面秒经 tempoMap.barBeatAt 反查连续拍 → 4 拍/小节网格上
 *   snap（grid<=0 不量化，与 midi-quantize.snapBeat 语义一致）；全局拍 < 0
 *   （count-in 负秒区）clamp 到 {1,1}。
 * - 时长：**量化前**时长（量化只动落点）——(off - on) 秒 → 四分音符拍
 *   （bpm 取音符起始处）；下限 0.125（32 分音符，防退化零长音符）。
 * - velocity：live = MIDI 原始值；fixed = settings.fixedVelocity。
 *   NoteEvent.velocity 为 0-1 标度（App 步进录入同惯例：/127）。
 */
import { createNoteEvent, type NoteEvent, type TempoMap } from "@collinx/core";
import { snapBeat } from "./midi-quantize";
import type { RecordedTake } from "../hooks/useTransport";

/** 视图网格拍/小节（与 PianoRollView.BEATS_PER_BAR 一致） */
const BEATS_PER_BAR = 4;
/** 录制音符最短时值（四分音符拍）：32 分音符，防零长退化 */
const MIN_DUR_QN = 0.125;

export interface ConvertTakeOptions {
  /** 量化网格（拍）：0 = 不量化 */
  quantizeGrid: number;
  velocityMode: "live" | "fixed";
  /** 1-127（MIDI 标度） */
  fixedVelocity: number;
  trackId?: string;
}

function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0.8;
  return Math.max(1, Math.min(127, Math.round(v))) / 127;
}

export function convertTakeToNotes(
  take: RecordedTake,
  tempoMap: TempoMap,
  options: ConvertTakeOptions
): NoteEvent[] {
  const trackId = options.trackId ?? "default";
  const out: NoteEvent[] = [];
  for (const n of take.notes) {
    // 落点：谱面秒 → 连续 {bar, beat}
    const pos = tempoMap.barBeatAt(n.onSeconds);
    let globalBeat = (pos.bar - 1) * BEATS_PER_BAR + (pos.beat - 1);
    if (options.quantizeGrid > 0) {
      globalBeat = snapBeat(globalBeat, options.quantizeGrid);
    }
    if (!Number.isFinite(globalBeat) || globalBeat < 0) {
      globalBeat = 0; // 越界防御：clamp {1,1}
    }
    const bar = Math.floor(globalBeat / BEATS_PER_BAR) + 1;
    const beat = (globalBeat % BEATS_PER_BAR) + 1;
    // 时长：量化前（量化只动落点）；未闭合者已在 take 层闭合
    const off = n.offSeconds ?? take.endSeconds;
    const durSec = Math.max(off - n.onSeconds, 0);
    const bpm = tempoMap.bpmAt(pos.bar, pos.beat);
    const durQn = Math.max((durSec * bpm) / 60, MIN_DUR_QN);
    const velocity =
      options.velocityMode === "fixed"
        ? clampVelocity(options.fixedVelocity)
        : clampVelocity(n.velocity);
    out.push(
      createNoteEvent({
        trackId,
        bar,
        beat,
        durQn,
        pitchMidi: n.pitchMidi,
        velocity,
      })
    );
  }
  return out;
}
