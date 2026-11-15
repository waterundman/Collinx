import React, { useCallback, useMemo, useRef, useState } from "react";
import { getCSSVar } from "../../utils/cssVar";
import { useI18n } from "../../i18n";
import styles from "./ArrangementView.module.css";

export interface PhraseBlock {
  id: string;
  name: string;
  startBar: number;
  endBar: number;
  formRole: string;
  energyLevel?: number;
}

export interface PhraseChanges {
  formRole?: string;
  startBar?: number;
  endBar?: number;
  energyLevel?: number;
}

interface ArrangementViewProps {
  phrases: PhraseBlock[];
  onPhraseClick?: (phraseId: string) => void;
  onSectionDoubleClick?: (phraseId: string) => void;
  totalBars?: number;
  /** v1.18.0 Stage 0: explicit empty-state hint shown when phrases is empty
   *  (no Phrase nodes in the graph). Text comes from i18n via the caller;
   *  the view never falls back to demo data. */
  emptyHint?: string;
  /** v2.6.0：空编排时的「起点卡片」回调。传入后空态不再是一行提示，
   *  而是可点击创建乐段的卡片网格（消除 90%+ 的死区）。 */
  onCreatePhrase?: (role: string, bars: number) => void;
  /**
   * v3.2.0：结构编辑。传 onPhraseChange 才启用拖动/改长度/键盘移动；
   * 缺省时组件保持原来的只读行为。
   */
  onPhraseChange?: (phraseId: string, changes: PhraseChanges) => void;
  onPhraseDelete?: (phraseId: string) => void;
  onPhraseDuplicate?: (phraseId: string) => void;
  /** 播放头小节（只读标记，不参与布局计算）。 */
  playheadPosition?: { bar: number; beat: number } | null;
  /** 编排页使用：更高的乐段条 + 选中乐段检查器。 */
  expanded?: boolean;
}

/** v2.6.0：起点卡片 —— 常见曲式段落，点了就真的建节点 */
const STARTING_SECTIONS: { role: string; bars: number }[] = [
  { role: "intro", bars: 4 },
  { role: "verse", bars: 8 },
  { role: "chorus", bars: 8 },
  { role: "bridge", bars: 4 },
  { role: "outro", bars: 4 },
];

const ROLE_COLOR_VARS: Record<string, string> = {
  verse: "--section-verse",
  chorus: "--section-chorus",
  bridge: "--section-bridge",
  intro: "--section-intro",
  outro: "--section-outro",
  prechorus: "--section-prechorus",
  breakdown: "--section-breakdown",
  interlude: "--section-interlude",
  outro_chorus: "--section-outro-chorus",
  build_up: "--section-build-up",
  drop: "--section-drop",
  solo: "--section-solo",
};

function getRoleColor(role: string): string {
  const varName = ROLE_COLOR_VARS[role];
  return varName ? getCSSVar(varName) : getCSSVar("--canvas-node-default");
}

const ROLE_KEYS: Record<string, string> = {
  intro: "intro",
  verse: "verse",
  prechorus: "prechorus",
  chorus: "chorus",
  bridge: "bridge",
  solo: "solo",
  outro: "outro",
  build_up: "buildUp",
  drop: "drop",
  breakdown: "breakdown",
  interlude: "interlude",
  outro_chorus: "outro",
};

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "").trim();
  const expanded =
    clean.length === 3
      ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    parseInt(expanded.substring(0, 2), 16),
    parseInt(expanded.substring(2, 4), 16),
    parseInt(expanded.substring(4, 6), 16),
  ];
}

function energyToColor(level: number): string {
  const low = hexToRgb(getCSSVar("--gradient-blue-start")) ?? [72, 110, 190];
  const mid = hexToRgb(getCSSVar("--gradient-green-start")) ?? [72, 150, 110];
  const high = hexToRgb(getCSSVar("--gradient-red-start")) ?? [190, 80, 72];

  let color: [number, number, number];
  if (level <= 0.5) {
    const t = level / 0.5;
    color = [
      Math.round(low[0] + (mid[0] - low[0]) * t),
      Math.round(low[1] + (mid[1] - low[1]) * t),
      Math.round(low[2] + (mid[2] - low[2]) * t),
    ];
  } else {
    const t = (level - 0.5) / 0.5;
    color = [
      Math.round(mid[0] + (high[0] - mid[0]) * t),
      Math.round(mid[1] + (high[1] - mid[1]) * t),
      Math.round(mid[2] + (high[2] - mid[2]) * t),
    ];
  }
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  originalStart: number;
  originalEnd: number;
  barWidth: number;
  moved: boolean;
}

export const ArrangementView: React.FC<ArrangementViewProps> = ({
  phrases,
  onPhraseClick,
  onSectionDoubleClick,
  totalBars,
  emptyHint,
  onCreatePhrase,
  onPhraseChange,
  onPhraseDelete,
  onPhraseDuplicate,
  playheadPosition,
  expanded = false,
}) => {
  const { t } = useI18n();
  const maxBar = Math.max(
    1,
    totalBars ?? phrases.reduce((max, p) => Math.max(max, p.endBar), 16),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    startBar: number;
    endBar: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 拖动换算基准必须是被拖块的定位父级（.barContainer），不是 root：
   *  root 有 padding 且 barContainer 有 min-width，用 root 宽度会让
   *  「拖一格」的判据偏小，实测拖 1 小节会跳 2 小节。 */
  const barContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const roleLabel = useCallback(
    (role: string) =>
      t(`arranger.formRoles.${ROLE_KEYS[role] ?? role}`, { defaultValue: role }),
    [t],
  );

  const selectedPhrase = useMemo(
    () => (selectedId ? phrases.find((p) => p.id === selectedId) ?? null : null),
    [phrases, selectedId],
  );

  const handleClick = useCallback(
    (phraseId: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setSelectedId((prev) => (prev === phraseId ? null : phraseId));
      onPhraseClick?.(phraseId);
    },
    [onPhraseClick],
  );

  const handleDoubleClick = useCallback(
    (phraseId: string) => {
      onSectionDoubleClick?.(phraseId);
    },
    [onSectionDoubleClick],
  );

  const neighborBounds = useCallback(
    (id: string, startBar: number, endBar: number) => {
      let previousEnd = 0;
      let nextStart = Number.POSITIVE_INFINITY;
      for (const phrase of phrases) {
        if (phrase.id === id) continue;
        if (phrase.endBar < startBar) {
          previousEnd = Math.max(previousEnd, phrase.endBar);
        } else if (phrase.startBar > endBar) {
          nextStart = Math.min(nextStart, phrase.startBar);
        }
      }
      return { minStart: previousEnd + 1, nextStart };
    },
    [phrases],
  );

  const beginDrag = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      phrase: PhraseBlock,
      mode: "move" | "resize",
    ) => {
      if (!onPhraseChange) return;
      const barWidth =
        (barContainerRef.current?.clientWidth ?? 0) / maxBar;
      if (!Number.isFinite(barWidth) || barWidth <= 0) return;
      dragRef.current = {
        id: phrase.id,
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        originalStart: phrase.startBar,
        originalEnd: phrase.endBar,
        barWidth,
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // 只在「改长度」时吞掉默认行为：拖右缘不需要产生 click。
      // 「移动」模式必须保留 click —— 否则浏览器在 pointerdown 被取消后
      // 不再派发 click，单击选中就失效了（.arrangementRoot 已 user-select: none，
      // 不存在拖选文本的问题）。
      if (mode === "resize") e.preventDefault();
    },
    [maxBar, onPhraseChange],
  );

  /** 按值去重：指针没跨过小节边界时不产生新的渲染。 */
  const applyPreview = useCallback(
    (next: { id: string; startBar: number; endBar: number }) => {
      setPreview((prev) =>
        prev &&
        prev.id === next.id &&
        prev.startBar === next.startBar &&
        prev.endBar === next.endBar
          ? prev
          : next,
      );
    },
    [],
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const deltaBars = Math.round((e.clientX - drag.startX) / drag.barWidth);
      if (deltaBars !== 0) drag.moved = true;
      const duration = drag.originalEnd - drag.originalStart + 1;
      const bounds = neighborBounds(drag.id, drag.originalStart, drag.originalEnd);

      if (drag.mode === "resize") {
        const maxEnd = Math.min(
          maxBar,
          Number.isFinite(bounds.nextStart)
            ? bounds.nextStart - 1
            : maxBar,
        );
        const nextEnd = Math.min(
          maxEnd,
          Math.max(drag.originalStart, drag.originalEnd + deltaBars),
        );
        applyPreview({
          id: drag.id,
          startBar: drag.originalStart,
          endBar: nextEnd,
        });
        return;
      }

      const minStart = Math.max(1, bounds.minStart);
      const maxStart = Math.min(
        maxBar - duration + 1,
        Number.isFinite(bounds.nextStart)
          ? bounds.nextStart - duration
          : maxBar - duration + 1,
      );
      if (maxStart < minStart) return;
      const nextStart = Math.min(
        maxStart,
        Math.max(minStart, drag.originalStart + deltaBars),
      );
      applyPreview({
        id: drag.id,
        startBar: nextStart,
        endBar: nextStart + duration - 1,
      });
    },
    [applyPreview, maxBar, neighborBounds],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const next = preview;
      dragRef.current = null;
      setPreview(null);
      if (drag.moved) {
        // 拖动结束后浏览器仍会派发一次 click。用「自清除标记」而不是常驻标记：
        // 若某次拖动没有跟随 click（例如指针在块外松开），常驻标记会把下一次
        // 真实点击吃掉，用户表现为要点两次才选中。
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      if (
        next &&
        (next.startBar !== drag.originalStart || next.endBar !== drag.originalEnd)
      ) {
        onPhraseChange?.(drag.id, {
          startBar: next.startBar,
          endBar: next.endBar,
        });
      }
    },
    [onPhraseChange, preview],
  );

  const nudgePhrase = useCallback(
    (phrase: PhraseBlock, delta: number) => {
      if (!onPhraseChange) return;
      const duration = phrase.endBar - phrase.startBar + 1;
      const bounds = neighborBounds(phrase.id, phrase.startBar, phrase.endBar);
      const maxStart = Math.min(
        maxBar - duration + 1,
        Number.isFinite(bounds.nextStart)
          ? bounds.nextStart - duration
          : maxBar - duration + 1,
      );
      const minStart = Math.max(1, bounds.minStart);
      if (maxStart < minStart) return;
      const startBar = Math.min(
        maxStart,
        Math.max(minStart, phrase.startBar + delta),
      );
      if (startBar === phrase.startBar) return;
      onPhraseChange(phrase.id, {
        startBar,
        endBar: startBar + duration - 1,
      });
    },
    [maxBar, neighborBounds, onPhraseChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, phrase: PhraseBlock) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!onPhraseChange) return;
        e.preventDefault();
        nudgePhrase(phrase, (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 4 : 1));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && onPhraseDelete) {
        e.preventDefault();
        onPhraseDelete(phrase.id);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSectionDoubleClick?.(phrase.id);
      }
    },
    [nudgePhrase, onPhraseChange, onPhraseDelete, onSectionDoubleClick],
  );

  const playheadPct =
    playheadPosition && Number.isFinite(playheadPosition.bar)
      ? (Math.min(maxBar, Math.max(1, playheadPosition.bar)) - 1) / maxBar * 100
      : null;

  return (
    <div
      ref={containerRef}
      className={`${styles.arrangementRoot} ${expanded ? styles.arrangementRootExpanded : ""}`}
      data-testid="arrangement-view"
      data-expanded={expanded ? "true" : undefined}
    >
      {expanded && (
        <div className={styles.expandedHeader}>
          <span>
            {t("arrangement.summary", {
              count: phrases.length,
              bars: maxBar,
            })}
          </span>
          <span className={styles.dragHint}>
            {onPhraseChange && phrases.length > 0 ? t("arrangement.dragHint") : null}
          </span>
        </div>
      )}

      {/* v3.2.0 S2：没有乐段时不画小节标尺 —— 一条 16 格的空尺子不是信息，
          只是把空态挤到页面底部。空编排只留「一句话 + 起点卡片」。 */}
      {phrases.length > 0 && (
        <div
          ref={barContainerRef}
          className={`${styles.barContainer} ${expanded ? styles.barContainerExpanded : ""}`}
          data-testid="arrangement-bars"
          data-total-bars={maxBar}
        >
        {Array.from({ length: maxBar + 1 }, (_, i) => (
          <div
            key={i}
            className={styles.barLine}
            style={{
              left: `${(i / maxBar) * 100}%`,
              height: i % 4 === 0 ? "100%" : "50%",
              borderLeft:
                i % 4 === 0
                  ? "1px solid var(--border-secondary)"
                  : "1px solid var(--border-primary)",
            }}
          />
        ))}

        {Array.from({ length: maxBar + 1 }, (_, i) =>
          i % 4 === 0 ? (
            <span
              key={`label-${i}`}
              className={styles.barLabel}
              style={{ left: `${(i / maxBar) * 100}%` }}
            >
              {i + 1}
            </span>
          ) : null,
        )}

        {playheadPct !== null && (
          <div
            className={styles.playhead}
            style={{ left: `${playheadPct}%` }}
            data-testid="arrangement-playhead"
            aria-hidden="true"
          />
        )}

        {phrases.map((phrase) => {
          const position =
            preview?.id === phrase.id
              ? { startBar: preview.startBar, endBar: preview.endBar }
              : { startBar: phrase.startBar, endBar: phrase.endBar };
          const leftPct = ((position.startBar - 1) / maxBar) * 100;
          const widthPct =
            ((position.endBar - position.startBar + 1) / maxBar) * 100;
          const energyColor = phrase.energyLevel
            ? energyToColor(phrase.energyLevel)
            : undefined;
          const color = energyColor || getRoleColor(phrase.formRole);
          const isSelected = selectedId === phrase.id;
          const isHovered = hoveredId === phrase.id;
          const isActive =
            playheadPosition &&
            playheadPosition.bar >= position.startBar &&
            playheadPosition.bar <= position.endBar;

          return (
            <div
              key={phrase.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={t("arrangement.phraseAria", {
                name: phrase.name,
                role: roleLabel(phrase.formRole),
                start: position.startBar,
                end: position.endBar,
              })}
              onClick={() => handleClick(phrase.id)}
              onDoubleClick={() => handleDoubleClick(phrase.id)}
              onKeyDown={(e) => handleKeyDown(e, phrase)}
              onPointerDown={(e) => beginDrag(e, phrase, "move")}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onMouseEnter={() => setHoveredId(phrase.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={[
                styles.phraseBlock,
                expanded ? styles.phraseBlockExpanded : "",
                isHovered ? styles.phraseBlockHovered : "",
                isSelected ? styles.phraseBlockSelected : "",
                isActive ? styles.phraseBlockActive : "",
                onPhraseChange ? styles.phraseBlockEditable : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                background: color,
                opacity: isHovered ? 0.95 : 0.84,
                zIndex: isHovered || isSelected ? 2 : 1,
              }}
              title={`${phrase.name} (${roleLabel(phrase.formRole)})\n${t("arranger.bars")}: ${position.startBar}-${position.endBar}\n${t("arranger.energy")}: ${
                phrase.energyLevel !== undefined
                  ? (phrase.energyLevel * 100).toFixed(0) + "%"
                  : "—"
              }`}
            >
              <span
                className={styles.phraseName}
                style={{ maxWidth: `calc(100% - 12px)` }}
              >
                {phrase.name}
              </span>
              <span className={styles.phraseRole}>
                {roleLabel(phrase.formRole)}
              </span>
              {onPhraseChange && (
                <span
                  className={styles.resizeHandle}
                  data-testid={`arrangement-resize-${phrase.id}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(e, phrase, "resize");
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}

        {phrases.length > 1 &&
          phrases.slice(0, -1).map((_, idx) => {
            const current = phrases[idx];
            const next = phrases[idx + 1];
            const currentRight = (current.endBar / maxBar) * 100;
            const nextLeft = ((next.startBar - 1) / maxBar) * 100;
            const arrowX = (currentRight + nextLeft) / 2;
            const gap = nextLeft - currentRight;

            if (gap <= 0.5) return null;

            return (
              <div
                key={`arrow-${idx}`}
                className={styles.arrowIndicator}
                style={{ left: `${arrowX}%` }}
              >
                →
              </div>
            );
          })}
        </div>
      )}

      {phrases.length === 0 && emptyHint && (
        /* v2.6.0：此前这里只有一行提示文字，整个编排区 90%+ 是空白
           （"像后台模板"的主因）。改为可操作的起点：点一下就真的建乐段。 */
        <div className={styles.emptyState} data-testid="arrangement-empty">
          <p className={styles.emptyTitle}>{emptyHint}</p>
          {onCreatePhrase && (
            <div className={styles.startGrid} data-testid="arrangement-start-grid">
              {STARTING_SECTIONS.map((section) => (
                <button
                  key={section.role}
                  type="button"
                  className={styles.startCard}
                  data-testid={`arrangement-start-${section.role}`}
                  onClick={() => onCreatePhrase(section.role, section.bars)}
                >
                  <span className={styles.startCardRole}>
                    {section.role.toUpperCase()}
                  </span>
                  <span className={styles.startCardMeta}>
                    {roleLabel(section.role)} · {t("arrangement.startBars", {
                      count: section.bars,
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedPhrase && (
        <div
          className={`${styles.selectedInfo} ${expanded ? styles.selectedInfoExpanded : ""}`}
          data-testid="arrangement-selected-info"
        >
          <span>
            <span className={styles.infoLabel}>{t("arranger.role")} </span>
            <span className={styles.infoValue}>
              {roleLabel(selectedPhrase.formRole)}
            </span>
          </span>
          <span>
            <span className={styles.infoLabel}>{t("arranger.bars")} </span>
            <span className={styles.infoValue}>
              {selectedPhrase.startBar} — {selectedPhrase.endBar}
            </span>
          </span>
          {selectedPhrase.energyLevel !== undefined && (
            <span>
              <span className={styles.infoLabel}>{t("arranger.energy")} </span>
              <span
                className={styles.infoValue}
                style={{
                  color:
                    selectedPhrase.energyLevel >= 0.7
                      ? "var(--accent-red)"
                      : selectedPhrase.energyLevel >= 0.4
                        ? "var(--accent-yellow)"
                        : "var(--accent-green)",
                }}
              >
                {(selectedPhrase.energyLevel * 100).toFixed(0)}%
              </span>
            </span>
          )}
          <span className={styles.inspectorActions}>
            {onSectionDoubleClick && (
              <button
                type="button"
                className={styles.inspectorBtn}
                data-testid="arrangement-focus"
                onClick={() => onSectionDoubleClick(selectedPhrase.id)}
              >
                {t("arrangement.focus")}
              </button>
            )}
            {onPhraseDuplicate && (
              <button
                type="button"
                className={styles.inspectorBtn}
                data-testid="arrangement-duplicate"
                onClick={() => onPhraseDuplicate(selectedPhrase.id)}
              >
                {t("arrangement.duplicate")}
              </button>
            )}
            {onPhraseDelete && (
              <button
                type="button"
                className={`${styles.inspectorBtn} ${styles.inspectorBtnDanger}`}
                data-testid="arrangement-delete"
                onClick={() => onPhraseDelete(selectedPhrase.id)}
              >
                {t("arrangement.delete")}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
};
