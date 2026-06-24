import React, { useMemo, useState } from "react";
import type {
  NoteEvent,
  TempoMap,
  Layout as CoreLayout,
  HouseStyle as CoreHouseStyle,
} from "@collinx/core";
import { useI18n } from "../../i18n";
import { ScoreRenderer } from "./ScoreRenderer";
import styles from "./ScorePanel.module.css";

export interface ScorePanelLayout extends CoreLayout {
  stavesPerPage: number;
  staffDistance: number;
  staffConfig: { clef: "treble" | "bass" | "alto" | "tenor"; name: string; bars: number }[];
}

export type Layout = ScorePanelLayout;

export interface ScorePanelHouseStyle extends CoreHouseStyle {
  fontFamily: string;
  stemDirection: "auto" | "up" | "down";
  beamStyle: "modern" | "traditional";
  tieStyle: "curved" | "straight";
  notationSize: number;
}

export type HouseStyle = ScorePanelHouseStyle;

export interface CollisionWarning {
  type: "symbol_overlap" | "slur_cross" | "dynamic_clash" | "articulation_conflict";
  staveIndex: number;
  bar: number;
  beat: number;
  description: string;
  severity: "warning" | "error";
  fixSuggestion: string;
}

export interface ScorePanelProps {
  layout: ScorePanelLayout;
  notes: NoteEvent[];
  houseStyle?: ScorePanelHouseStyle;
  collisions?: CollisionWarning[];
  tempoMap?: TempoMap;
  onExtractParts?: () => void;
  onAutoLayout?: () => void;
  onExportMusicXML?: () => void;
  compact?: boolean;
}

const CLEF_SYMBOLS: Record<string, string> = {
  treble: "\u{1D11E}",
  bass: "\u{1D122}",
  alto: "\u{1D11C}",
  tenor: "\u{1D11C}",
  treble_8vb: "\u{1D11E}",
  bass_8vb: "\u{1D122}",
  percussion: "\u{1D126}",
};

export const ScorePanel: React.FC<ScorePanelProps> = ({
  layout,
  notes,
  houseStyle,
  collisions,
  tempoMap,
  onExtractParts,
  onAutoLayout,
  onExportMusicXML,
  compact = false,
}) => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"data" | "rendered">("data");
  const errors = useMemo(
    () => collisions?.filter((c) => c.severity === "error") ?? [],
    [collisions],
  );
  const warnings = useMemo(
    () => collisions?.filter((c) => c.severity === "warning") ?? [],
    [collisions],
  );

  const stavesWithNotes = useMemo(() => {
    return layout.staffConfig.map((staff, idx) => {
      const staffNotes = notes.filter((n) => {
        if (staff.clef === "treble") return n.pitchMidi >= 60;
        if (staff.clef === "bass") return n.pitchMidi < 60;
        return true;
      });
      return { ...staff, staveIndex: idx, noteCount: staffNotes.length };
    });
  }, [layout.staffConfig, notes]);

  return (
    <div className={styles.scorePanel} data-testid="score-panel">
      <div className={styles.toolbar}>
        {onAutoLayout && (
          <button className={styles.toolbarBtn} onClick={onAutoLayout}>
            {t('score.autoLayout')}
          </button>
        )}
        {onExtractParts && (
          <button className={styles.toolbarBtn} onClick={onExtractParts}>
            {t('score.extractParts')}
          </button>
        )}
        {onExportMusicXML && (
          <button className={styles.toolbarBtn} onClick={onExportMusicXML}>
            {t('score.exportMusicXML')}
          </button>
        )}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.toolbarBtn} ${viewMode === "data" ? styles.toolbarBtnActive : ""}`}
            onClick={() => setViewMode("data")}
          >
            {t('score.dataView')}
          </button>
          <button
            className={`${styles.toolbarBtn} ${viewMode === "rendered" ? styles.toolbarBtnActive : ""}`}
            onClick={() => setViewMode("rendered")}
          >
            {t('score.renderedView')}
          </button>
        </div>
        <span className={styles.toolbarSpacer} />
        <span className={styles.toolbarBadge}>
          {t('score.notesCount', { count: notes.length })} · {t('score.stavesCount', { count: layout.staffConfig.length })}
        </span>
      </div>

      <div className={styles.body}>
        {!compact && (
          <div className={styles.sidebar}>
            <div className={styles.section}>
              <span className={styles.sectionHeader}>{t('score.pageLayout')}</span>
              <div className={styles.layoutGrid}>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.pageSize')}</span>
                  <span className={styles.layoutValue}>{layout.pageWidth}×{layout.pageHeight}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.topMargin')}</span>
                  <span className={styles.layoutValue}>{layout.margins.top}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.bottomMargin')}</span>
                  <span className={styles.layoutValue}>{layout.margins.bottom}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.leftMargin')}</span>
                  <span className={styles.layoutValue}>{layout.margins.left}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.rightMargin')}</span>
                  <span className={styles.layoutValue}>{layout.margins.right}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.staffDistance')}</span>
                  <span className={styles.layoutValue}>{layout.staffDistance}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.stavesPerPage')}</span>
                  <span className={styles.layoutValue}>{layout.stavesPerPage}</span>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <span className={styles.sectionHeader}>{t('score.staffConfig')}</span>
              <div className={styles.staffList}>
                {stavesWithNotes.map((staff) => (
                  <div key={staff.staveIndex} className={styles.staffItem}>
                    <span className={styles.staffClef}>
                      {CLEF_SYMBOLS[staff.clef] ?? staff.clef}
                    </span>
                    <span className={styles.staffName}>{staff.name}</span>
                    <span className={styles.staffCount}>{staff.noteCount} {t('score.notes')} · {staff.bars} {t('score.measures')}</span>
                  </div>
                ))}
              </div>
            </div>

            {houseStyle && (
              <div className={styles.section}>
                <span className={styles.sectionHeader}>{t('score.houseStyle')}</span>
                <div className={styles.layoutGrid}>
                  <div className={styles.layoutItem}>
                    <span className={styles.layoutKey}>{t('score.font')}</span>
                    <span className={styles.layoutValue}>{houseStyle.fontFamily}</span>
                  </div>
                  <div className={styles.layoutItem}>
                    <span className={styles.layoutKey}>{t('score.stemDirection')}</span>
                    <span className={styles.layoutValue}>{houseStyle.stemDirection}</span>
                  </div>
                  <div className={styles.layoutItem}>
                    <span className={styles.layoutKey}>{t('score.beamStyle')}</span>
                    <span className={styles.layoutValue}>{houseStyle.beamStyle}</span>
                  </div>
                  <div className={styles.layoutItem}>
                    <span className={styles.layoutKey}>{t('score.tieStyle')}</span>
                    <span className={styles.layoutValue}>{houseStyle.tieStyle}</span>
                  </div>
                  <div className={styles.layoutItem}>
                    <span className={styles.layoutKey}>{t('score.notationSize')}</span>
                    <span className={styles.layoutValue}>{houseStyle.notationSize}pt</span>
                  </div>
                </div>
              </div>
            )}

            {collisions && collisions.length > 0 && (
              <div className={styles.collisionSection}>
                <span className={styles.sectionHeader}>{t('score.collisionWarning')}</span>
                <div className={styles.collisionCount}>
                  {errors.length > 0 && (
                    <span className={styles.collisionBadgeError}>{errors.length} {t('score.error')}</span>
                  )}
                  {warnings.length > 0 && (
                    <span className={styles.collisionBadgeWarn}>{warnings.length} {t('score.warning')}</span>
                  )}
                </div>
                <div className={styles.collisionList}>
                  {errors.map((c, idx) => (
                    <div key={`err-${idx}`} className={styles.collisionCardError}>
                      <div className={styles.collisionHeader}>
                        <span className={styles.collisionType}>{t('score.error')}</span>
                        <span className={styles.collisionLocation}>
                          Stave {c.staveIndex} · m{c.bar}.{c.beat}
                        </span>
                      </div>
                      <div className={styles.collisionDesc}>{c.description}</div>
                      <div className={styles.collisionFix}>{t('score.fixSuggestion')}: {c.fixSuggestion}</div>
                    </div>
                  ))}
                  {warnings.map((c, idx) => (
                    <div key={`warn-${idx}`} className={styles.collisionCardWarn}>
                      <div className={styles.collisionHeader}>
                        <span className={styles.collisionTypeWarn}>{t('score.warning')}</span>
                        <span className={styles.collisionLocation}>
                          Stave {c.staveIndex} · m{c.bar}.{c.beat}
                        </span>
                      </div>
                      <div className={styles.collisionDesc}>{c.description}</div>
                      <div className={styles.collisionFix}>{t('score.fixSuggestion')}: {c.fixSuggestion}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!collisions || collisions.length === 0 ? (
              <div className={styles.emptySidebar}>{t('score.noCollisions')}</div>
            ) : null}
          </div>
        )}

        <div className={styles.previewArea}>
          <div className={styles.previewHeader}>
            <span className={styles.previewHeaderTitle}>{t('score.preview')}</span>
            <span className={styles.previewHeaderInfo}>
              {layout.pageWidth}×{layout.pageHeight}mm
            </span>
          </div>
          <div className={styles.previewCanvas}>
            {viewMode === "rendered" ? (
              <ScoreRenderer
                notes={notes}
                layout={{
                  staffConfig: layout.staffConfig.map((s) => ({
                    clef: s.clef as "treble" | "bass",
                    name: s.name,
                    bars: s.bars,
                  })),
                  notationSize: houseStyle?.notationSize,
                }}
                tempoMap={tempoMap}
                scale={1}
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                <div className={styles.previewPlaceholderIcon}>&#9839;</div>
                <div className={styles.previewPlaceholderText}>
                  {notes.length > 0
                    ? t('score.renderingInProgress', { count: notes.length })
                    : t('score.noNotes')}
                </div>
                {notes.length > 0 && (
                  <div className={styles.previewPlaceholderText} style={{ fontSize: "11px", marginTop: "8px" }}>
                    {t('score.vexflowHint')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
