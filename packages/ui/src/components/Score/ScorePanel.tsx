import React, { useEffect, useMemo, useRef, useState } from "react";
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
   * 紧凑视图的焦点窗小节数（默认关闭 = 沿用既有按页渲染）。
   * compose 精简谱传 4：只渲染播放头附近的 4 小节，保证音符可读，
   * 而不是把全曲压进 180px。未传时行为与改动前一致。
   */
  focusBars?: number;
  /**
   * 全尺寸谱面纸张缩放（0.5–1.5）。仅影响显示，不改变小节几何与锚点。
   */
  initialZoom?: number;
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

/**
 * 纸面谱每行小节数（v3.3.0）。
 *
 * 与 `score-layout.BARS_PER_SYSTEM`（8，通用缺省）分开：纸面宽 920px 是硬约束，
 * 8 小节/行会把每小节压到 110px 以下，VexFlow 的最小间距放不下 4-5 个符号，
 * 音符就会溢出到相邻小节。4 小节/行 ≈ 220px/小节。
 *
 * 导出给测试用：`v230-stage4.test.tsx` 需要按「与 App 内的谱面几何一致」构造
 * 点击坐标，硬编码 4 会在下次调整时静默失效。
 */
export const PAPER_BARS_PER_SYSTEM = 4;

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
  focusBars,
  initialZoom = 1,
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

  const barNoteCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const note of notes) {
      if (!Number.isInteger(note.bar) || note.bar < 1) continue;
      counts.set(note.bar, (counts.get(note.bar) ?? 0) + 1);
    }
    return counts;
  }, [notes]);

  // 全曲小节数：与 ScoreRenderer 的 renderBars 同一规则（staffConfig.bars 的最大值，
  // 下限 4）。此前该值恒为 4 —— 工程有 48 小节时谱面只有 4 个槽位，用户看到的就是
  // 「五线谱怎么就四个区」。
  const renderBars = useMemo(
    () => Math.max(...staffConfig.map((s) => s.bars), 4),
    [staffConfig],
  );

  /**
   * 紧凑焦点窗：只给 compose 传 focusBars=4；全尺寸乐谱仍按页渲染。
   *
   * 提到分页之前：`barsPerSystem`（每行小节数）要同时喂给分页与渲染器，
   * 而它依赖焦点窗宽度。
   */
  const focusWindowBars =
    compact && focusBars && focusBars > 0
      ? Math.min(renderBars, Math.max(1, Math.floor(focusBars)))
      : null;

  /**
   * v3.3.0：每行小节数。
   *
   * 纸面谱旧值 8（`BARS_PER_SYSTEM`）在 920px 纸上把每小节压到 ~110px —— 一小节
   * 只要有 4 个音 + 1 个休止 + 1 个临时记号，VexFlow 的最小间距就撑不下，音符会
   * **越过小节线**画到下一小节（用户看到的「音符区间放置错误」之一）。
   * 4 小节/行时每小节约 220px，普通密度绰绰有余，也是钢琴谱的通行排法。
   */
  const barsPerSystem = compact ? (focusWindowBars ?? undefined) : PAPER_BARS_PER_SYSTEM;

  // 分页：每行最多 barsPerSystem 小节（超出换行到下一系统），
  // 每页系统数 = floor(stavesPerPage / 谱表数) —— 复用 Layout 既有的「每页谱表」字段。
  // ⚠️ barsPerSystem 必须与渲染器**同一个值**：否则分页按 8 小节/行切、渲染按 4 小节/行
  // 排，页内系统数与「第 X-Y 小节」的标注会一起错位。
  const pages = useMemo(
    () =>
      planScorePages({
        bars: renderBars,
        staffCount: staffConfig.length,
        stavesPerPage: layout.stavesPerPage,
        barsPerSystem,
      }),
    [renderBars, staffConfig.length, layout.stavesPerPage, barsPerSystem],
  );

  const [requestedPage, setRequestedPage] = useState(0);
  // 稿件变短（如删小节）时以派生值钳制，不额外用 effect 纠正 state。
  const pageIndex = Math.min(requestedPage, Math.max(0, pages.length - 1));
  const page = pages[pageIndex];
  const pageBars = page?.bars ?? renderBars;
  const pageStartBar = page?.startBar ?? 1;

  const focusPageCount = focusWindowBars
    ? Math.max(1, Math.ceil(renderBars / focusWindowBars))
    : pages.length;
  const maxFocusStart = focusWindowBars
    ? Math.max(1, renderBars - focusWindowBars + 1)
    : 1;
  const [requestedFocusStart, setRequestedFocusStart] = useState(1);
  const focusStartBar = focusWindowBars
    ? Math.min(Math.max(1, requestedFocusStart), maxFocusStart)
    : 1;
  const focusIndex = focusWindowBars
    ? Math.min(
        focusPageCount - 1,
        Math.floor((focusStartBar - 1) / focusWindowBars),
      )
    : pageIndex;
  const effectivePageBars = focusWindowBars ?? pageBars;
  const effectivePageStartBar = focusWindowBars ? focusStartBar : pageStartBar;
  const effectivePageIndex = focusWindowBars ? focusIndex : pageIndex;
  const effectivePageCount = focusWindowBars ? focusPageCount : pages.length;
  const effectivePageStartRange = effectivePageStartBar;
  const effectivePageEndRange = Math.min(
    renderBars,
    effectivePageStartBar + effectivePageBars - 1,
  );

  // 播放头走到别的页 / 焦点窗时自动翻页：否则播到第 41 小节时谱面停在第一页，
  // 游标直接消失。紧凑谱只在播放头离开焦点窗时平移，避免每个八分音符都重排。
  const playheadBar = playheadPosition?.bar;
  useEffect(() => {
    if (playheadBar === undefined) return;
    if (focusWindowBars) {
      const end = focusStartBar + focusWindowBars - 1;
      if (playheadBar >= focusStartBar && playheadBar <= end) return;
      const target = Math.min(
        maxFocusStart,
        Math.max(
          1,
          Math.floor((playheadBar - 1) / focusWindowBars) * focusWindowBars + 1,
        ),
      );
      setRequestedFocusStart((prev) => (prev === target ? prev : target));
      return;
    }
    const target = pageIndexForBar(pages, playheadBar);
    setRequestedPage((prev) => (prev === target ? prev : target));
  }, [pages, playheadBar, focusWindowBars, focusStartBar, maxFocusStart]);

  // ScoreRenderer 的 layout 必须 memo 化：内联对象字面量每次渲染换身份，而它是
  // ScoreRenderer 渲染 effect 的 dep → 每次父渲染都触发重排版；若父组件用 state
  // 接收锚点（playheadPosition 的常见接线），会形成永不收敛的循环（S0 验证者实测
  // 300ms 内 15 次回调）。deps 用 layout.staffConfig 与 houseStyle?.notationSize。
  //
  // 分页（v2.4.1）：一页只渲染本页的小节区间，故 `bars` 取**本页**小节数，
  // 首小节号经 ScoreRenderer 的 `startBar` 传给画布（否则第 2 页锚点会退回 bar 1）。
  // deps 里的 pageBars / 分页对象均为数值或稳定 memo，不引入身份抖动。
  /**
   * v3.3.0：纸面谱每行小节数。
   *
   * 旧值 8（`BARS_PER_SYSTEM`）在 920px 纸面上把每小节压到 ~110px —— 一小节只要
   * 有 4 个音 + 1 个休止 + 1 个临时记号，VexFlow 的最小间距就撑不下，音符会**越过
   * 小节线**画到下一小节去（用户看到的「音符区间放置错误」之一）。
   * 4 小节/行时每小节约 220px，普通密度的乐句绰绰有余，也符合钢琴谱的通行排法。
   */
  const rendererLayout = useMemo<ScoreRendererLayout>(
    () => ({
      staffConfig: (layout.staffConfig ?? []).map((s) => ({
        clef: s.clef as "treble" | "bass",
        name: s.name,
        bars: effectivePageBars,
      })),
      notationSize: houseStyle?.notationSize,
      // 紧凑焦点窗必须让 4 小节落在同一行；纸面谱见 PAPER_BARS_PER_SYSTEM。
      barsPerSystem,
    }),
    [layout.staffConfig, houseStyle?.notationSize, effectivePageBars, barsPerSystem],
  );

  const previewCanvasRef = useRef<HTMLDivElement>(null);

  /**
   * 谱面可用宽度（紧凑谱与纸面谱都量）。
   *
   * v3.2.0 只在紧凑态量测：4 小节的紧凑谱在 1000px 面板里只占左侧一半。
   * v3.3.0 起纸面谱也量 —— 纸面内边距固定，量到的宽度稳定，用来把 4 个小节
   * 铺满纸面（每小节约 220px），避免「每小节 110px 装不下内容 → 音符越过小节线」。
   *
   * 不传时（jsdom 里 ResizeObserver 被 stub 成空实现 → 宽度恒为 0）几何与
   * 改动前逐值一致，所以既有锚点/点击反演的测试基准不受影响。
   */
  const scoreAreaRef = useRef<HTMLDivElement>(null);
  const [scoreAreaWidth, setScoreAreaWidth] = useState(0);
  useEffect(() => {
    const el = scoreAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      // 按值去重：小于 8px 的抖动不触发重渲染（否则滚动条出现/消失会让它抖）
      setScoreAreaWidth((prev) => (Math.abs(prev - w) < 8 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  const [zoom, setZoom] = useState(() =>
    Number.isFinite(initialZoom) ? Math.min(1.5, Math.max(0.5, initialZoom)) : 1,
  );
  const applyZoom = (next: number) =>
    setZoom(Math.min(1.5, Math.max(0.5, Math.round(next * 100) / 100)));
  const fitWidth = () => {
    const width = previewCanvasRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    // 920px 是纸面基准宽；两侧各留 16px，避免贴边。
    applyZoom((width - 32) / 920);
  };
  const goPage = (delta: number) => {
    if (focusWindowBars) {
      const next = Math.min(
        maxFocusStart,
        Math.max(1, focusStartBar + delta * focusWindowBars),
      );
      setRequestedFocusStart(next);
      return;
    }
    setRequestedPage(
      Math.min(pages.length - 1, Math.max(0, pageIndex + delta)),
    );
  };

  return (
    <div
      className={styles.scorePanel}
      data-testid="score-panel"
      // v2.8.0：把当前页的小节范围暴露成 data 属性。
      // 断言「翻页后内容真的换了」时，依赖 VexFlow 的渲染回调（onBarAnchors）
      // 在 jsdom 里跑不完（无 canvas，20s+ 仍不返回）——那不是产品缺陷
      // （真实浏览器已验证 startBar 会从 1 变 41），而是测试环境的限制。
      // 组件状态是同步可靠的断言面。
      data-page-index={effectivePageIndex}
      data-page-start-bar={effectivePageStartBar}
      data-page-bars={effectivePageBars}
      data-page-count={effectivePageCount}
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup} role="group" aria-label={t('score.layoutActions')}>
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
        </div>

        <span className={styles.toolbarDivider} aria-hidden="true" />

        <div className={styles.toolbarGroup} role="group" aria-label={t('score.exportActions')}>
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
              className={styles.toolbarBtn}
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
        </div>

        <div className={styles.viewToggle}>
          <button
            className={`${styles.toolbarBtn} ${viewMode === "data" ? styles.toolbarBtnActive : ""}`}
            onClick={() => setViewMode("data")}
            aria-pressed={viewMode === "data"}
          >
            {t('score.dataView')}
          </button>
          <button
            className={`${styles.toolbarBtn} ${viewMode === "rendered" ? styles.toolbarBtnActive : ""}`}
            onClick={() => setViewMode("rendered")}
            aria-pressed={viewMode === "rendered"}
          >
            {t('score.renderedView')}
          </button>
        </div>
        <span className={styles.toolbarSpacer} />
        {!compact && viewMode === "rendered" ? (
          <div className={styles.zoomControls} data-testid="score-zoom-controls">
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={() => applyZoom(zoom - 0.1)}
              disabled={zoom <= 0.5}
              aria-label={t('score.zoomOut')}
              data-testid="score-zoom-out"
            >
              −
            </button>
            <button
              type="button"
              className={styles.zoomValue}
              onClick={fitWidth}
              title={t('score.fitWidth')}
              data-testid="score-zoom-fit"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={() => applyZoom(zoom + 0.1)}
              disabled={zoom >= 1.5}
              aria-label={t('score.zoomIn')}
              data-testid="score-zoom-in"
            >
              +
            </button>
          </div>
        ) : null}
        {compact ? (
          <span className={styles.focusChip} data-testid="score-focus-range">
            {t('score.barRange', {
              start: effectivePageStartRange,
              end: effectivePageEndRange,
            })}
          </span>
        ) : null}
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
            <div className={styles.previewHeaderMain}>
              <span className={styles.previewHeaderTitle}>
                {compact ? t('score.focusPreview') : t('score.preview')}
              </span>
              <span className={styles.previewHeaderRange}>
                {t('score.barRange', {
                  start: effectivePageStartRange,
                  end: effectivePageEndRange,
                })}
              </span>
            </div>
            {effectivePageCount > 1 && (
              <div className={styles.pageNav}>
                <button
                  className={styles.pageBtn}
                  data-testid="score-page-prev"
                  title={t('score.prevPage')}
                  disabled={effectivePageIndex === 0}
                  onClick={() => goPage(-1)}
                >
                  ‹
                </button>
                <span className={styles.pageIndicator} data-testid="score-page-indicator">
                  {t('score.pageIndicator', {
                    current: effectivePageIndex + 1,
                    total: effectivePageCount,
                  })}
                </span>
                <button
                  className={styles.pageBtn}
                  data-testid="score-page-next"
                  title={t('score.nextPage')}
                  disabled={effectivePageIndex >= effectivePageCount - 1}
                  onClick={() => goPage(1)}
                >
                  ›
                </button>
              </div>
            )}
            <span className={styles.previewHeaderInfo}>
              {layout.pageWidth}×{layout.pageHeight}mm
            </span>
          </div>
          <div
            ref={previewCanvasRef}
            className={`${styles.previewCanvas} ${compact ? styles.previewCanvasCompact : styles.previewCanvasPaper}`}
            data-testid="score-preview-canvas"
          >
            {viewMode === "rendered" ? (
              <div
                className={`${styles.pageSheet} ${compact ? styles.pageSheetCompact : ""}`}
                data-testid="score-page-sheet"
                style={
                  compact
                    ? undefined
                    : ({ "--page-zoom": zoom } as React.CSSProperties)
                }
              >
                {!compact && (
                  <div className={styles.paperHeader}>
                    <span className={styles.paperTitle}>{t('score.sheetTitle')}</span>
                    <span className={styles.paperMeta}>
                      {t('score.barRange', {
                        start: effectivePageStartRange,
                        end: effectivePageEndRange,
                      })}
                    </span>
                  </div>
                )}
                <div className={styles.pageScore} ref={scoreAreaRef}>
                  <ScoreRenderer
                    notes={notes}
                    layout={rendererLayout}
                    tempoMap={tempoMap}
                    scale={1}
                    paper={!compact}
                    startBar={effectivePageStartBar}
                    playheadPosition={playheadPosition}
                    onBarAnchorsChange={onBarAnchorsChange}
                    onSeek={onSeek}
                    width={scoreAreaWidth > 0 ? scoreAreaWidth : undefined}
                  />
                </div>
                {!compact && (
                  <div className={styles.paperFooter}>
                    <span>Collinx</span>
                    <span>
                      {t('score.pageIndicator', {
                        current: effectivePageIndex + 1,
                        total: effectivePageCount,
                      })}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.dataView} data-testid="score-data-view">
                <div className={styles.dataViewHeader}>
                  <span>{t('score.dataViewTitle')}</span>
                  <span className={styles.dataViewMeta}>
                    {t('score.notesCount', { count: notes.length })}
                  </span>
                </div>
                <div className={styles.barGrid}>
                  {Array.from({ length: renderBars }, (_, index) => {
                    const bar = index + 1;
                    const count = barNoteCounts.get(bar) ?? 0;
                    return (
                      <div
                        key={bar}
                        className={`${styles.barCell} ${count > 0 ? styles.barCellFilled : ""}`}
                      >
                        <span className={styles.barCellIndex}>{bar}</span>
                        <span className={styles.barCellCount}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
