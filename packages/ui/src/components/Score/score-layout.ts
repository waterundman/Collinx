/**
 * 乐谱「系统（行）/ 页」排布纯函数（无 VexFlow 依赖）。
 *
 * 背景：ScoreRenderer 早期把**全部小节**塞进一行固定宽度（550px）的谱表，
 * 于是 48 小节工程的每小节只剩 ~11px —— 既画不下音符，也让「谱面只显示前 4
 * 小节」的表象被掩盖（staffConfig.bars 被硬编码成 4）。现在改为：
 *
 *   小节 → 系统（每行最多 BARS_PER_SYSTEM 小节，纵向堆叠）
 *        → 页（每页最多 floor(stavesPerPage / 谱表数) 个系统）
 *
 * 抽成纯函数的原因与 bar-anchors 相同：`import("vexflow")` 在 jsdom 下不保证
 * 可用，排布规则必须能被单测直接覆盖。
 *
 * 不变量：
 *  1. 所有系统首尾相接、无空洞、无重叠：system[k].startBar + bars === system[k+1].startBar。
 *  2. 系统 / 页内的小节总数 === 传入的 bars。
 *  3. 每页系统数 <= systemsPerPage（至少 1）；单页时 planScorePages().length === 1。
 */

/** 每行最多小节数。550px 谱表宽下 8 小节 ≈ 66px/小节，仍可容纳 16 分音符。 */
export const BARS_PER_SYSTEM = 8;

/** Layout.stavesPerPage 缺省值（与 demoData 的默认 layout 一致）。 */
export const DEFAULT_STAVES_PER_PAGE = 10;

export interface ScoreSystem {
  /** 系统在本页内的序号（从 0 起）。 */
  index: number;
  /** 本系统首小节的小节号（1 起）。 */
  startBar: number;
  /** 本系统的小节数（>= 1）。 */
  bars: number;
}

export interface ScorePage {
  /** 页序号（从 0 起）。 */
  index: number;
  /** 本页首小节的小节号。 */
  startBar: number;
  /** 本页小节数（含全部系统）。 */
  bars: number;
  systems: ScoreSystem[];
}

function toPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/**
 * 把 `bars` 个小节切分为系统（行）。`startBar` 用于分页时保持真实小节号。
 */
export function planSystems(opts: {
  bars: number;
  startBar?: number;
  barsPerSystem?: number;
}): ScoreSystem[] {
  const total = Number.isFinite(opts.bars) ? Math.floor(opts.bars) : 0;
  if (total < 1) return [];

  const startBar = toPositiveInt(opts.startBar ?? 1, 1);
  const perSystem = toPositiveInt(opts.barsPerSystem ?? BARS_PER_SYSTEM, BARS_PER_SYSTEM);

  const systems: ScoreSystem[] = [];
  for (let offset = 0; offset < total; offset += perSystem) {
    systems.push({
      index: systems.length,
      startBar: startBar + offset,
      bars: Math.min(perSystem, total - offset),
    });
  }
  return systems;
}

/**
 * 每页可放几个系统 = floor(stavesPerPage / 谱表数)，至少 1。
 * `stavesPerPage` 是 Layout 里既有的「每页谱表」字段——每页谱表数 ÷ 每系统谱表数
 * 即每页系统数。
 */
export function systemsPerPage(stavesPerPage: number | undefined, staffCount: number): number {
  const staves = toPositiveInt(stavesPerPage ?? DEFAULT_STAVES_PER_PAGE, DEFAULT_STAVES_PER_PAGE);
  const perSystem = toPositiveInt(staffCount, 1);
  return Math.max(1, Math.floor(staves / perSystem));
}

/**
 * 整份乐谱的分页结果。`bars` 为全曲小节数（不是单页小节数）。
 */
export function planScorePages(opts: {
  bars: number;
  staffCount: number;
  stavesPerPage?: number;
  barsPerSystem?: number;
}): ScorePage[] {
  const systems = planSystems({
    bars: opts.bars,
    barsPerSystem: opts.barsPerSystem,
  });
  const perPage = systemsPerPage(opts.stavesPerPage, opts.staffCount);

  const pages: ScorePage[] = [];
  for (let offset = 0; offset < systems.length; offset += perPage) {
    // 页内系统序号重新从 0 起（ScoreRenderer 用序号算纵向位置）。
    const chunk = systems
      .slice(offset, offset + perPage)
      .map((system, index) => ({ ...system, index }));
    pages.push({
      index: pages.length,
      startBar: chunk[0].startBar,
      bars: chunk.reduce((sum, system) => sum + system.bars, 0),
      systems: chunk,
    });
  }
  return pages;
}

/**
 * 某小节落在第几页；越界时钳制到首/末页（与 `barBeatFromX` 的钳制语义一致）。
 * 空分页表返回 0。
 */
export function pageIndexForBar(pages: ScorePage[], bar: number): number {
  if (pages.length === 0) return 0;
  const found = pages.findIndex((page) => bar >= page.startBar && bar < page.startBar + page.bars);
  if (found >= 0) return found;
  return bar < pages[0].startBar ? 0 : pages.length - 1;
}
