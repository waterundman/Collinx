/**
 * Chord Track（v2.8.0，v3.2.0 升级为直接选择）
 *
 * 一条横向和弦轨：每小节一个格子，显示该小节的和弦（或空）。
 *
 * v2.8.0 的「点击循环切换」（空 → Em → Am → C → G → F → Dm → 空）看起来很省事，
 * 实际把一个「有 12×7 种取值」的选择题压成了一条单行传送带：想写 Bb7 要点 20 多次，
 * 且序列里根本没有 F#/Bb。v3.2.0 改成「点格子 → 在轨下方展开根音/性质选择器」：
 *
 * - 单击格子就是选中（不弹浮层，不挡谱面）；选中状态在同一行下方展开编辑条
 * - 根音 12 键 + 性质 7 键，均为一击生效（单击即写图，无「确定」按钮）
 * - 支持清除（写 null）、Esc 收起
 * - 选择器是「渐进披露」：不选中任何小节时，和弦轨只有一个 22px 高的格子条
 *
 * 数据流不变：和弦存为 `ChordEvent` 图节点（graph-native），走 store 的 SET_CHORD，
 * 因此 undo / .agentmusic / 审批链路自动生效。根音 token 必须满足 core 的
 * `^[A-G][#b]?$`（见 core/model/harmony-plan.ts），quality 取 canonical 值
 * （maj/min/dim/aug/maj7/min7/dom7），不能写 "7" 以外的自由文本。
 */
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import styles from "./ChordTrack.module.css";

/** 根音：与 core NOTE_NAMES 的升号序列一致 */
const ROOTS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/** 性质：value 是 core 的 canonical quality，label 是乐手惯用记号 */
const QUALITIES = [
  { value: "maj", label: "maj" },
  { value: "min", label: "min" },
  { value: "dim", label: "dim" },
  { value: "aug", label: "aug" },
  { value: "maj7", label: "maj7" },
  { value: "min7", label: "m7" },
  { value: "dom7", label: "7" },
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

const DEFAULT_QUALITY = "maj";

export const ChordTrack: React.FC<ChordTrackProps> = ({
  totalBars,
  chordsByBar,
  onSetChord,
}) => {
  const { t } = useI18n();
  const [editingBar, setEditingBar] = useState<number | null>(null);

  const bars = useMemo(
    () => Array.from({ length: Math.max(1, totalBars) }, (_, i) => i + 1),
    [totalBars],
  );

  /** 编辑中的小节若被删（totalBars 缩小）则自动收起，避免编辑条指向不存在的格子 */
  const activeBar =
    editingBar !== null && editingBar >= 1 && editingBar <= bars.length
      ? editingBar
      : null;
  const activeChord = activeBar !== null ? chordsByBar.get(activeBar) : undefined;

  const closeEditor = useCallback(() => setEditingBar(null), []);

  const pickRoot = useCallback(
    (root: string) => {
      if (activeBar === null) return;
      onSetChord(activeBar, {
        root,
        quality: activeChord?.quality ?? DEFAULT_QUALITY,
      });
    },
    [activeBar, activeChord, onSetChord],
  );

  const pickQuality = useCallback(
    (quality: string) => {
      if (activeBar === null) return;
      // 没有和弦时先落一个根音（C），否则「选性质」这一步无从写起。
      onSetChord(activeBar, { root: activeChord?.root ?? ROOTS[0], quality });
    },
    [activeBar, activeChord, onSetChord],
  );

  const clearChord = useCallback(() => {
    if (activeBar === null) return;
    onSetChord(activeBar, null);
  }, [activeBar, onSetChord]);

  const handleTrackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape" && activeBar !== null) {
        e.stopPropagation();
        closeEditor();
      }
    },
    [activeBar, closeEditor],
  );

  return (
    <div
      className={styles.track}
      data-testid="chord-track"
      onKeyDown={handleTrackKeyDown}
    >
      <div className={styles.label}>{t("chord.label")}</div>
      <div className={styles.body}>
        <div className={styles.cells}>
          {bars.map((bar) => {
            const chord = chordsByBar.get(bar);
            const isEditing = activeBar === bar;
            return (
              <button
                key={bar}
                type="button"
                className={[
                  styles.cell,
                  chord ? styles.cellFilled : "",
                  isEditing ? styles.cellActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`chord-cell-${bar}`}
                data-bar={bar}
                aria-expanded={isEditing}
                aria-label={
                  chord
                    ? t("chord.cellAria", { bar, chord: chordLabel(chord) })
                    : t("chord.cellEmpty", { bar })
                }
                onClick={() =>
                  setEditingBar((prev) => (prev === bar ? null : bar))
                }
              >
                {chord ? chordLabel(chord) : ""}
              </button>
            );
          })}
        </div>

        {activeBar !== null && (
          <div
            className={styles.editor}
            data-testid="chord-editor"
            data-bar={activeBar}
            role="group"
            aria-label={t("chord.editorAria", { bar: activeBar })}
          >
            <div className={styles.editorRow}>
              <span className={styles.editorLabel}>{t("chord.root")}</span>
              <div className={styles.picker}>
                {ROOTS.map((root) => (
                  <button
                    key={root}
                    type="button"
                    className={`${styles.pickBtn} ${
                      activeChord?.root === root ? styles.pickBtnActive : ""
                    }`}
                    aria-pressed={activeChord?.root === root}
                    onClick={() => pickRoot(root)}
                  >
                    {root}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.editorRow}>
              <span className={styles.editorLabel}>{t("chord.quality")}</span>
              <div className={styles.picker}>
                {QUALITIES.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    className={`${styles.pickBtn} ${
                      activeChord?.quality === q.value
                        ? styles.pickBtnActive
                        : ""
                    }`}
                    aria-pressed={activeChord?.quality === q.value}
                    onClick={() => pickQuality(q.value)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.editorActions}>
              <span className={styles.editorPreview} aria-live="polite">
                {t("chord.barPrefix", { bar: activeBar })}
                <strong>
                  {activeChord ? chordLabel(activeChord) : t("chord.none")}
                </strong>
              </span>
              <button
                type="button"
                className={styles.actionBtn}
                data-testid="chord-clear"
                onClick={clearChord}
                disabled={!activeChord}
              >
                {t("chord.clear")}
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={closeEditor}
              >
                {t("chord.done")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
