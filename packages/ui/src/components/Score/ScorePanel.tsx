import React, { useMemo, useState } from "react";
import type {
  NoteEvent,
  TempoMap,
  Layout,
  HouseStyle,
} from "@collinx/core";
import { useI18n } from "../../i18n";
import { ScoreRenderer } from "./ScoreRenderer";
import type { ScoreRendererLayout } from "./ScoreRenderer";
import type { BarAnchor } from "./bar-anchors";
import styles from "./ScorePanel.module.css";

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
  layout: Layout;
  notes: NoteEvent[];
  houseStyle?: HouseStyle;
  collisions?: CollisionWarning[];
  tempoMap?: TempoMap;
  onExtractParts?: () => void;
  onAutoLayout?: () => void;
  onExportMusicXML?: () => void;
  onExportMIDI?: () => void;
  onExportPDF?: () => void;
  /** v2.8.0：导出音频（WAV）—— 之前只有 MIDI/XML/PDF，拿不到能播的成品 */
  onExportWAV?: () => void;
  compact?: boolean;
  /**
   * 谱面播放头位置（只读跟随），透传给内部 ScoreRenderer。缺省零行为变化。
   */
  playheadPosition?: { bar: number; beat: number } | null;
  /**
   * 渲染成功后上报小节锚点，透传给内部 ScoreRenderer。缺省零行为变化。
   */
  onBarAnchorsChange?: (anchors: BarAnchor[]) => void;
  /**
   * 谱面点击定位（Stage 2）：透传给内部 ScoreRenderer。缺省零行为变化。
   */
  onSeek?: (pos: { bar: number; beat: number }) => void;
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
  onExportMIDI,
  onExportPDF,
  onExportWAV,
  compact = false,
  playheadPosition,
  onBarAnchorsChange,
  onSeek,
}) => {
  const { t } = useI18n();
  // v2.4.0 S6：默认直接进入渲染视图。此前默认 "data"，用户打开「乐谱」看到的
  // 是"渲染引擎处理中"占位（文案还暗示正在加载），误以为功能坏了。
  const [viewMode, setViewMode] = useState<"data" | "rendered">("rendered");
  // Layout/Staff config fields are optional on the core Layout type; fall back
  // to safe defaults so a pure core layout still renders gracefully.
  const staffConfig = layout.staffConfig ?? [];
  const staffDistance = layout.staffDistance ?? 0;
  const stavesPerPage = layout.stavesPerPage ?? 0;
  const errors = useMemo(
    () => collisions?.filter((c) => c.severity === "error") ?? [],
    [collisions],
  );
  const warnings = useMemo(
    () => collisions?.filter((c) => c.severity === "warning") ?? [],
    [collisions],
  );

  const stavesWithNotes = useMemo(() => {
    return staffConfig.map((staff, idx) => {
      const staffNotes = notes.filter((n) => {
        if (staff.clef === "treble") return n.pitchMidi >= 60;
        if (staff.clef === "bass") return n.pitchMidi < 60;
        return true;
      });
      return { ...staff, staveIndex: idx, noteCount: staffNotes.length };
    });
  }, [staffConfig, notes]);

  // ScoreRenderer 的 layout 必须 memo 化：内联对象字面量每次渲染换身份，而它是
  // ScoreRenderer 渲染 effect 的 dep → 每次父渲染都触发重排版；若父组件用 state
  // 接收锚点（playheadPosition 的常见接线），会形成永不收敛的循环（S0 验证者实测
  // 300ms 内 15 次回调）。deps 用 layout.staffConfig 与 houseStyle?.notationSize。
  const rendererLayout = useMemo<ScoreRendererLayout>(
    () => ({
      staffConfig: (layout.staffConfig ?? []).map((s) => ({
        clef: s.clef as "treble" | "bass",
        name: s.name,
        bars: s.bars,
      })),
      notationSize: houseStyle?.notationSize,
    }),
    [layout.staffConfig, houseStyle?.notationSize],
  );

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
        {onExportMIDI && (
          <button
            className={styles.toolbarBtn}
            onClick={onExportMIDI}
            data-testid="export-midi"
          >
            {t('score.exportMIDI')}
          </button>
        )}
        {onExportWAV && (
          <button
            onClick={onExportWAV}
            data-testid="export-wav"
          >
            {t('score.exportWAV')}
          </button>
        )}
        {onExportPDF && (
          <button
            className={styles.toolbarBtn}
            onClick={onExportPDF}
            data-testid="export-pdf"
          >
            {t('score.exportPDF')}
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
          {t('score.notesCount', { count: notes.length })} · {t('score.stavesCount', { count: staffConfig.length })}
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
                  <span className={styles.layoutValue}>{staffDistance}mm</span>
                </div>
                <div className={styles.layoutItem}>
                  <span className={styles.layoutKey}>{t('score.stavesPerPage')}</span>
                  <span className={styles.layoutValue}>{stavesPerPage}</span>
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
                layout={rendererLayout}
                tempoMap={tempoMap}
                scale={1}
                playheadPosition={playheadPosition}
                onBarAnchorsChange={onBarAnchorsChange}
                onSeek={onSeek}
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
