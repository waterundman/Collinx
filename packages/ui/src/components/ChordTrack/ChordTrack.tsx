/**
 * Chord Track（v2.8.0）
 *
 * 一条横向和弦轨：每小节一个格子，显示该小节的和弦（或空）。
 * 点击格子按预置序列循环切换（空 → Em → Am → C → G → F → Dm → 空）。
 *
 * 为什么是"循环切换"而不是下拉/输入框：
 * - 混音台/钢琴卷帘已经占用大量横向空间，每小节塞一个 12×4 的下拉不现实
 * - 铺和弦是高频动作，循环点击一次到位比"点开→选调→选性质→确认"快得多
 * - 需要精确指定时后续可加"右键编辑"，但先把「能看到和弦 + 能改」这条打通
 *
 * 数据流：和弦存为 `ChordEvent` 图节点（graph-native），走 store 的 SET_CHORD，
 * 因此 undo / .agentmusic / 审批链路自动生效。
 */
import React, { useMemo } from "react";
import styles from "./ChordTrack.module.css";

/** 循环序列：0 表示清空 */
const CHORD_CYCLE = [
  null,
  { root: "E", quality: "min" },
  { root: "A", quality: "min" },
  { root: "C", quality: "maj" },
  { root: "G", quality: "maj" },
  { root: "F", quality: "maj" },
  { root: "D", quality: "min" },
] as const;

export interface ChordTrackProps {
  /** 总小节数（由工程最长音符/乐段决定） */
  totalBars: number;
  /** 当前工程里的和弦（bar → 和弦符号文本） */
  chordsByBar: Map<number, { root: string; quality: string }>;
  /** 写入/清除某小节和弦 */
  onSetChord: (
    bar: number,
    chord: { root: string; quality: string } | null,
  ) => void;
}

const QUALITY_LABEL: Record<string, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  maj7: "maj7",
  min7: "m7",
  dom7: "7",
};

export function chordLabel(c: { root: string; quality: string }): string {
  return c.root + (QUALITY_LABEL[c.quality] ?? c.quality);
}

export const ChordTrack: React.FC<ChordTrackProps> = ({
  totalBars,
  chordsByBar,
  onSetChord,
}) => {
  const bars = useMemo(
    () => Array.from({ length: Math.max(1, totalBars) }, (_, i) => i + 1),
    [totalBars],
  );

  return (
    <div className={styles.track} data-testid="chord-track">
      <div className={styles.label}>和弦</div>
      <div className={styles.cells}>
        {bars.map((bar) => {
          const chord = chordsByBar.get(bar);
          const idx = CHORD_CYCLE.findIndex(
            (c) =>
              (c === null && !chord) ||
              (c !== null && chord && c.root === chord.root && c.quality === chord.quality),
          );
          const next = CHORD_CYCLE[(idx < 0 ? 0 : idx + 1) % CHORD_CYCLE.length];
          return (
            <button
              key={bar}
              type="button"
              className={`${styles.cell} ${chord ? styles.cellFilled : ""}`}
              data-testid={`chord-cell-${bar}`}
              // 循环切换：当前是 Em → 下一次点击变 Am；空 → Em
              onClick={() => onSetChord(bar, next ? { root: next.root, quality: next.quality } : null)}
              title={chord ? `${chordLabel(chord)}（点击切换）` : "点击添加和弦"}
            >
              {chord ? chordLabel(chord) : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
};
