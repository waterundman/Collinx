/**
 * 谱面音符分组（v2.9.6）。
 *
 * ## 解决什么
 *
 * 旧实现把**每个 NoteEvent 画成一个独立的 StaveNote**（按 beat 排序横排）。
 * 和弦轨（v2.9.1）生成的三和弦是 3 个同小节/同拍/同时值的音符 —— 被画成
 * 3 个连续的全音符，一小节塞了 12 拍，**记谱不成立**；同时按音高把和弦
 * 拆到两个谱表（≥60 高音谱表、<60 低音谱表），和弦在谱面上就"散架"了。
 *
 * ## 规则
 *
 * 1. **同时性**：连续的（同 bar、同 beat、同 durQn）音符聚成一组 →
 *    渲染成一个多音 StaveNote（真和弦）。
 * 2. **谱表归属**：**整组统一**分配 —— 组内最低音 < 60 走低音谱表，
 *    否则走高音谱表（传统 LH 写法；单音组行为与旧的按音高分配完全一致）。
 * 3. 单谱表布局（测试/单行谱）全部进 staff 0。
 */

import type { NoteEvent } from "@collinx/core";

export interface ScoredNoteGroup {
  bar: number;
  beat: number;
  durQn: number;
  /** 组内音符，按音高升序（和弦键位顺序） */
  notes: NoteEvent[];
  staffIndex: number;
}

export function groupNotesForStaves(
  notes: NoteEvent[],
  staffConfigs: { clef: string }[],
): ScoredNoteGroup[][] {
  const sorted = notes
    .slice()
    .sort(
      (a, b) => a.bar - b.bar || a.beat - b.beat || a.pitchMidi - b.pitchMidi,
    );

  const trebleIdx = staffConfigs.findIndex((s) => s.clef === "treble");
  const bassIdx = staffConfigs.findIndex((s) => s.clef !== "treble");

  const groups: ScoredNoteGroup[] = [];
  let current: NoteEvent[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const head = current[0]!;
    const minPitch = Math.min(...current.map((n) => n.pitchMidi));
    let staffIndex = 0;
    if (staffConfigs.length >= 2) {
      staffIndex = minPitch < 60 ? bassIdx : trebleIdx;
      if (staffIndex < 0) staffIndex = 0;
    }
    groups.push({
      bar: head.bar,
      beat: head.beat,
      durQn: head.durQn,
      notes: current.slice().sort((a, b) => a.pitchMidi - b.pitchMidi),
      staffIndex,
    });
    current = [];
  };

  for (const note of sorted) {
    const head = current[0];
    const simultaneous =
      head !== undefined &&
      head.bar === note.bar &&
      head.beat === note.beat &&
      head.durQn === note.durQn;
    if (simultaneous) {
      current.push(note);
    } else {
      flush();
      current = [note];
    }
  }
  flush();

  // 按 staff 分桶；每桶内按小节 → 拍排序（渲染循环按小节取用）
  const byStaff: ScoredNoteGroup[][] = staffConfigs.map(() => []);
  for (const group of groups) byStaff[group.staffIndex]?.push(group);
  for (const list of byStaff) {
    list.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  }
  return byStaff;
}
