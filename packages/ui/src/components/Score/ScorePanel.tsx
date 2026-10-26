import React, { useEffect, useMemo, useState } from "react";
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
import { pageIndexForBar, planScorePages } from "./score-layout";
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
  /** v2.9.1：分轨导出（每轨一个 WAV，含各自推子/声像/FX） */
  onExportStems?: () => void;
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
  onExportStems,
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

  // 全曲小节数：与 ScoreRenderer 的 renderBars 同一规则（staffConfig.bars 的最大值，
  // 下限 4）。此前该值恒为 4 —— 工程有 48 小节时谱面只有 4 个槽位，用户看到的就是
  // 「五线谱怎么就四个区」。
  const renderBars = useMemo(
    () => Math.max(...staffConfig.map((s) => s.bars), 4),
    [staffConfig],
  );

  // 分页：每行最多 BARS_PER_SYSTEM(8) 小节（超出换行到下一系统），
  // 每页系统数 = floor(stavesPerPage / 谱表数) —— 复用 Layout 既有的「每页谱表」字段。
  const pages = useMemo(
    () =>
      planScorePages({
        bars: renderBars,
        staffCount: staffConfig.length,
        stavesPerPage: layout.stavesPerPage,
      }),
    [renderBars, staffConfig.length, layout.stavesPerPage],
  );

  const [requestedPage, setRequestedPage] = useState(0);
  // 稿件变短（如删小节）时以派生值钳制，不额外用 effect 纠正 state。
  const pageIndex = Math.min(requestedPage, Math.max(0, pages.length - 1));
  const page = pages[pageIndex];
  const pageBars = page?.bars ?? renderBars;
  const pageStartBar = page?.startBar ?? 1;

  // 播放头走到别的页时自动翻页：否则播到第 41 小节时谱面停在第一页，游标直接消失。
  const playheadBar = playheadPosition?.bar;
  useEffect(() => {
    if (playheadBar === undefined) return;
    const target = pageIndexForBar(pages, playheadBar);
    setRequestedPage((prev) => (prev === target ? prev : target));
  }, [pages, playheadBar]);

  // ScoreRenderer 的 layout 必须 memo 化：内联对象字面量每次渲染换身份，而它是
  // ScoreRenderer 渲染 effect 的 dep → 每次父渲染都触发重排版；若父组件用 state
  // 接收锚点（playheadPosition 的常见接线），会形成永不收敛的循环（S0 验证者实测
  // 300ms 内 15 次回调）。deps 用 layout.staffConfig 与 houseStyle?.notationSize。
  //
  // 分页（v2.4.1）：一页只渲染本页的小节区间，故 `bars` 取**本页**小节数，
  // 首小节号经 ScoreRenderer 的 `startBar` 传给画布（否则第 2 页锚点会退回 bar 1）。
  // deps 里的 pageBars / 分页对象均为数值或稳定 memo，不引入身份抖动。
  const rendererLayout = useMemo<ScoreRendererLayout>(
    () => ({
      staffConfig: (layout.staffConfig ?? []).map((s) => ({
        clef: s.clef as "treble" | "bass",
        name: s.name,
        bars: pageBars,
      })),
      notationSize: houseStyle?.notationSize,
    }),
    [layout.staffConfig, houseStyle?.notationSize, pageBars],
  );

  return (
    <div
      className={styles.scorePanel}
      data-testid="score-panel"
      // v2.8.0：把当前页的小节范围暴露成 data 属性。
      // 断言「翻页后内容真的换了」时，依赖 VexFlow 的渲染回调（onBarAnchors）
      // 在 jsdom 里跑不完（无 canvas，20s+ 仍不返回）——那不是产品缺陷
      // （真实浏览器已验证 startBar 会从 1 变 41），而是测试环境的限制。
      // 组件状态是同步可靠的断言面。
      data-page-index={pageIndex}
      data-page-start-bar={pageStartBar}
      data-page-bars={pageBars}
      data-page-count={pages.length}
    >
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
        {onExportStems && (
          <button
            className={styles.toolbarBtn}
            onClick={onExportStems}
            data-testid="export-stems"
          >
            {t('score.exportStems')}
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
            {pages.length > 1 && (
              <div className={styles.pageNav}>
                <button
                  className={styles.pageBtn}
                  data-testid="score-page-prev"
                  title={t('score.prevPage')}
                  disabled={pageIndex === 0}
                  onClick={() => setRequestedPage(Math.max(0, pageIndex - 1))}
                >
                  ‹
                </button>
                <span className={styles.pageIndicator} data-testid="score-page-indicator">
                  {t('score.pageIndicator', {
                    current: pageIndex + 1,
                    total: pages.length,
                  })}
                </span>
                <button
                  className={styles.pageBtn}
                  data-testid="score-page-next"
                  title={t('score.nextPage')}
                  disabled={pageIndex >= pages.length - 1}
                  onClick={() => setRequestedPage(Math.min(pages.length - 1, pageIndex + 1))}
                >
                  ›
                </button>
              </div>
            )}
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
                startBar={pageStartBar}
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
                  <div className={`${styles.previewPlaceholderText} ${styles.previewHint}`}>
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
