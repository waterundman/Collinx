import React, { useState, useCallback } from "react";
import styles from "./ArrangementView.module.css";

interface PhraseBlock {
  id: string;
  name: string;
  startBar: number;
  endBar: number;
  formRole: string;
  energyLevel?: number;
}

interface ArrangementViewProps {
  phrases: PhraseBlock[];
  onPhraseClick?: (phraseId: string) => void;
  onSectionDoubleClick?: (phraseId: string) => void;
  totalBars?: number;
}

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

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

const ROLE_LABELS: Record<string, string> = {
  intro: "引子",
  verse: "主歌",
  prechorus: "预副歌",
  chorus: "副歌",
  bridge: "桥段",
  solo: "独奏",
  outro: "尾奏",
  build_up: "推进",
  drop: "高潮",
  breakdown: "分解",
  interlude: "间奏",
  outro_chorus: "尾副歌",
};

function hexToRgb(hex: string): [number, number, number] {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

function energyToColor(level: number): string {
  const low = hexToRgb(getCSSVar('--gradient-blue-start'));
  const mid = hexToRgb(getCSSVar('--gradient-green-start'));
  const high = hexToRgb(getCSSVar('--gradient-red-start'));

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

export const ArrangementView: React.FC<ArrangementViewProps> = ({
  phrases,
  onPhraseClick,
  onSectionDoubleClick,
  totalBars,
}) => {
  const maxBar =
    totalBars ?? phrases.reduce((max, p) => Math.max(max, p.endBar), 16);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleClick = useCallback(
    (phraseId: string) => {
      setSelectedId((prev) => (prev === phraseId ? null : phraseId));
      onPhraseClick?.(phraseId);
    },
    [onPhraseClick]
  );

  const handleDoubleClick = useCallback(
    (phraseId: string) => {
      onSectionDoubleClick?.(phraseId);
    },
    [onSectionDoubleClick]
  );

  const selectedPhrase = selectedId
    ? phrases.find((p) => p.id === selectedId)
    : null;

  return (
    <div className={styles.arrangementRoot} data-testid="arrangement-view">
      <div
        className={styles.barContainer}
        style={{ minWidth: `${(maxBar + 1) * 36}px` }}
      >
        {Array.from({ length: maxBar + 1 }, (_, i) => (
          <div
            key={i}
            className={styles.barLine}
            style={{
              left: `${(i / maxBar) * 100}%`,
              height: i % 4 === 0 ? "100%" : "50%",
              borderLeft: i % 4 === 0 ? "1px solid var(--border-secondary)" : "1px solid var(--border-primary)",
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
          ) : null
        )}

        {phrases.map((phrase, idx) => {
          const leftPct = ((phrase.startBar - 1) / maxBar) * 100;
          const widthPct =
            ((phrase.endBar - phrase.startBar + 1) / maxBar) * 100;
          const energyColor = phrase.energyLevel
            ? energyToColor(phrase.energyLevel)
            : undefined;
          const color =
            energyColor ||
            getRoleColor(phrase.formRole);
          const isSelected = selectedId === phrase.id;
          const isHovered = hoveredId === phrase.id;

          return (
            <div
              key={phrase.id}
              onClick={() => handleClick(phrase.id)}
              onDoubleClick={() => handleDoubleClick(phrase.id)}
              onMouseEnter={() => setHoveredId(phrase.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`${styles.phraseBlock} ${isHovered ? styles.phraseBlockHovered : ""} ${isSelected ? styles.phraseBlockSelected : ""}`}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                background: color,
                opacity: isHovered ? 0.95 : 0.8,
                zIndex: isHovered ? 2 : 1,
              }}
              title={`${phrase.name} (${ROLE_LABELS[phrase.formRole] ?? phrase.formRole})\n小节: ${phrase.startBar}-${phrase.endBar}\n能量: ${phrase.energyLevel !== undefined ? (phrase.energyLevel * 100).toFixed(0) + "%" : "—"}`}
            >
              <span
                className={styles.phraseName}
                style={{ maxWidth: `calc(${widthPct}% - 8px)` }}
              >
                {phrase.name}
              </span>
              <span className={styles.phraseRole}>
                {ROLE_LABELS[phrase.formRole] ?? phrase.formRole}
              </span>
            </div>
          );
        })}

        {phrases.length > 1 &&
          phrases.slice(0, -1).map((_, idx) => {
            const current = phrases[idx];
            const next = phrases[idx + 1];
            const currentRight =
              ((current.endBar) / maxBar) * 100;
            const nextLeft =
              ((next.startBar - 1) / maxBar) * 100;
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

      {selectedPhrase && (
        <div className={styles.selectedInfo}>
          <span>
            <span className={styles.infoLabel}>角色 </span>
            <span className={styles.infoValue}>
              {ROLE_LABELS[selectedPhrase.formRole] ?? selectedPhrase.formRole}
            </span>
          </span>
          <span>
            <span className={styles.infoLabel}>小节 </span>
            <span className={styles.infoValue}>
              {selectedPhrase.startBar} — {selectedPhrase.endBar}
            </span>
          </span>
          {selectedPhrase.energyLevel !== undefined && (
            <span>
              <span className={styles.infoLabel}>能量 </span>
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
        </div>
      )}
    </div>
  );
};
