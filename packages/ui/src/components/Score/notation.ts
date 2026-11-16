/**
 * 记谱排布引擎（v3.3.0）。
 *
 * ## 为什么存在
 *
 * v3.2.0 及之前，谱面把「一个 NoteEvent 组」直接按 `durQn` 查表映射成**一个**
 * VexFlow duration 字符串，然后塞进按小节建的 Voice。这套做法在真实编排数据上
 * 会产生三类系统性错位：
 *
 * 1. **时值不可表达 → tick 数丢失**。`durQn = 1.25 / 2.5 / 0.4` 这类值查表只能
 *    落到最近的「单一符号」（`q` / `q` / `16`），而 VexFlow 是按 **ticks** 分配
 *    横向位置的：少算的 tick 会让本小节后续所有音符整体左移，多算则溢出小节。
 * 2. **附点只画不改 tick**。旧实现用 `Dot.buildAndAttach` 补附点，但该 API 只加
 *    视觉修饰符、不改 `getTicks()`；于是附点音符画得像 3 拍、实际只占 2 拍。
 * 3. **跨小节 / 跨拍的时值没有切分与连音线**。一个持续到下一小节的音被画成
 *    「一个超长音符」压在小节里；同一时刻不同时值的两个声部被**串行**排在一行，
 *    整小节宽度翻倍。用户看到的「音符区间放置错误」「连音不识别」即此。
 *
 * 本模块把这些规则落成纯函数（不依赖 VexFlow），渲染器只消费结果：
 *
 * - {@link decomposeDuration}：任意时值 → 可记谱符号序列（尽量少、贪心最大优先）
 * - {@link metricBoundaries}：本小节的「拍点」集合（简单拍按拍、复合拍按 3/8 块）
 * - {@link planNoteSpans}：逻辑音 → 跨小节切分 + 拍点切分 + 时值分解，并给出连音链
 * - {@link assignVoices}：同小节同谱表内按时值区间分声部（解决重叠被串行排列）
 * - {@link fillVoiceRests}：按声部补齐休止（保证每声部 tick 总量 == 小节长度）
 * - {@link spansAreContiguous}：连音线判据（几何相邻，而非"同音高就画"）
 *
 * ## 规则来源
 *
 * - 跨小节线必须切分并以连音线连接（记谱法硬规则，无例外）。
 * - 切分点取「拍点」：简单拍（x/2、x/4）= 每拍；复合拍（x/8 且分子被 3 整除）
 *   = 每个附点四分块；不规则拍（5/8、7/8）与 x/16 沿用 {@link beamGroups} 的
 *   分梁块（分梁与切分必须用同一套分组，否则梁会跨过切分点）。
 * - 起点落在拍点上时，允许一个标准音符值跨过弱拍（`h.` 在 4/4 的拍 1 是标准写法，
 *   拆成三个四分反而是错的）；但**终点也必须落在拍点上或小节末**。
 * - 起点不在拍点上时，必须切到下一个拍点（切分音写作 8~4~8，不能让一个
 *   `q.` 从弱位横跨到下一拍）。
 */

import { beamGroups } from "./engraving";

/** 拍号（与 `TempoMap.meterAt` 的返回形状一致，避免依赖 core 类型） */
export interface Metric {
  numerator: number;
  denominator: number;
}

/** 一个可记谱的时值：单一符号 + 附点数，`durQn` 为其四分音符长度 */
export interface NoteValue {
  durQn: number;
  /** VexFlow duration 名（w/h/q/8/16/32/64） */
  duration: string;
  /** 附点数（0 / 1 / 2） */
  dots: number;
}

/**
 * 全部可记谱时值，**按时值降序**（贪心分解依赖这个顺序）。
 *
 * 附点 = ×1.5，双附点 = ×1.75（本表未启用双附点：视觉上易与连音线混淆，
 * 且 1.75 组合都能用更短的单一值表达）。`6` = 附点全音符，只在 6/4、12/8
 * 这类「整小节 = 6 个四分」的拍号里作为满小节音符出现。
 */
export const NOTATABLE_VALUES: readonly NoteValue[] = [
  { durQn: 6, duration: "w", dots: 1 },
  { durQn: 4, duration: "w", dots: 0 },
  { durQn: 3, duration: "h", dots: 1 },
  { durQn: 2, duration: "h", dots: 0 },
  { durQn: 1.5, duration: "q", dots: 1 },
  { durQn: 1, duration: "q", dots: 0 },
  { durQn: 0.75, duration: "8", dots: 1 },
  { durQn: 0.5, duration: "8", dots: 0 },
  { durQn: 0.375, duration: "16", dots: 1 },
  { durQn: 0.25, duration: "16", dots: 0 },
  { durQn: 0.1875, duration: "32", dots: 1 },
  { durQn: 0.125, duration: "32", dots: 0 },
  { durQn: 0.0625, duration: "64", dots: 0 },
];

/** 量化栅格 = 64 分音符（0.0625 个四分）。所有输出时值都是它的整数倍。 */
export const GRID = 0.0625;

/** 浮点比较容差。栅格是 2⁻⁴ 的整数倍，二进制精确，1e-4 足够且不会误判。 */
const EPS = 1e-4;

/** 每小节四分音符数。⚠️ 禁写 `numerator`：6/8 → 3，7/8 → 3.5。 */
export function barLengthQn(metric: Metric): number {
  const n = Number.isFinite(metric.numerator) ? Math.max(1, metric.numerator) : 4;
  const d = Number.isFinite(metric.denominator) && metric.denominator > 0
    ? metric.denominator
    : 4;
  return (n * 4) / d;
}

/** 把任意时值对齐到 {@link GRID}；非正/非法值返回 0（调用方据 0 丢弃）。 */
export function quantizeDur(durQn: number): number {
  if (!Number.isFinite(durQn) || durQn <= 0) return 0;
  return Math.round(durQn / GRID) * GRID;
}

/**
 * 时值 → 可记谱符号序列（贪心：依次取不超过剩余量的最大值）。
 *
 * 例：`1.25 → [q, 16]`、`2.5 → [h, 8]`、`7 → [w, h, q]`、`0.75 → [8.]`。
 * 不足一个 64 分音符的残量会被丢弃（由 {@link quantizeDur} 先行对齐，
 * 正常情况下不会出现）。
 */
export function decomposeDuration(durQn: number): NoteValue[] {
  let remaining = quantizeDur(durQn);
  const out: NoteValue[] = [];
  // 上界保护：每次至少消耗 GRID，循环次数 ≤ 64×8；防御性写死以免脏数据死循环。
  for (let guard = 0; remaining > EPS && guard < 512; guard++) {
    const value = NOTATABLE_VALUES.find((v) => v.durQn <= remaining + EPS);
    if (!value) break;
    out.push(value);
    remaining = Math.round((remaining - value.durQn) / GRID) * GRID;
  }
  return out;
}

/**
 * 本小节内的「拍点」集合（小节内偏移，四分音符单位）。
 *
 * 返回值**包含** 0 与小节长度，便于调用方直接做 `∈` 判断。规则见文件头：
 * 简单拍按拍、复合拍与不规则拍/十六分拍沿用分梁分组，保证「切分点 == 分梁边界」。
 */
export function metricBoundaries(metric: Metric): number[] {
  const len = barLengthQn(metric);
  const n = Math.max(1, Math.floor(metric.numerator));
  const d = Math.max(1, Math.floor(metric.denominator || 4));
  const set = [0];
  const push = (x: number) => {
    if (x > EPS && x < len - EPS && !set.some((b) => Math.abs(b - x) < EPS)) {
      set.push(x);
    }
  };

  if (d === 8 || d === 16) {
    // 复合拍（6/8、9/8、12/8）、不规则拍（5/8、7/8）、十六分拍：
    // 直接复用分梁分组的累计边界，避免「梁跨切分点」。
    let acc = 0;
    for (const [num, den] of beamGroups(n, d)) {
      acc += (num * 4) / den;
      push(acc);
    }
  } else {
    // 简单拍（x/2、x/4…）：每拍一个边界。
    const pulse = 4 / d;
    for (let x = pulse; x < len - EPS; x += pulse) push(x);
  }

  set.push(len);
  set.sort((a, b) => a - b);
  return set;
}

/** 一个逻辑音（同一 chain）被排布后的一个可单独绘制的音符。 */
export interface NoteSpan {
  /** 唯一键：`{chain}#{index}`，供渲染器把 span 映射回已绘制的 StaveNote */
  key: string;
  /** 所属小节（1-based） */
  bar: number;
  /** 小节内起点（四分音符单位，0-based） */
  offset: number;
  /** 时值（单一符号可表达） */
  durQn: number;
  /** VexFlow duration 名 */
  duration: string;
  /** 附点数 */
  dots: number;
  /** 同一逻辑音的链标识（跨小节 / 跨拍切分共用同一个值） */
  chain: string;
  /** 链内序号 */
  index: number;
}

/** {@link planNoteSpans} 的输入 */
export interface PlanSpanInput {
  /** 逻辑音所在小节（1-based） */
  bar: number;
  /** 小节内起点（0-based，四分音符单位；即 `NoteEvent.beat - 1`） */
  offset: number;
  /** 时值（四分音符单位） */
  durQn: number;
  /** 链标识，缺省由 `bar/offset` 组合生成 */
  chain?: string;
  /** 拍号查询（按小节） */
  meterAt: (bar: number) => Metric;
  /** 可见区最后一小节：超出部分不再产生 span（避免画到画布外） */
  lastBar: number;
}

/**
 * 逻辑音 → span 序列。
 *
 * 三步（顺序固定，不可交换）：
 * 1. **跨小节切分**：沿小节线把时值切开，每段落在自己的小节里；
 * 2. **拍点切分**：段内按 {@link metricBoundaries} 切，使切分音与跨拍时值符合记谱法；
 * 3. **时值分解**：每段再分解成单一符号（正常情况下第 2 步已给出单一值）。
 *
 * 输出按时间顺序排列，`index` 递增；相邻 span 的连音线由
 * {@link spansAreContiguous} 判定，渲染器据此画 `StaveTie`。
 */
export function planNoteSpans(input: PlanSpanInput): NoteSpan[] {
  const { bar, offset, durQn, meterAt, lastBar } = input;
  const chain = input.chain ?? `${bar}:${offset}:${durQn}`;
  const total = quantizeDur(durQn);
  if (total <= 0 || bar > lastBar || bar < 1) return [];

  // ── 1. 跨小节切分 ──
  const barChunks: { bar: number; offset: number; durQn: number }[] = [];
  let cursorBar = bar;
  let cursorOffset = Math.max(0, quantizeDur(offset));
  let remaining = total;
  for (let guard = 0; remaining > EPS && cursorBar <= lastBar && guard < 256; guard++) {
    const len = barLengthQn(meterAt(cursorBar));
    if (cursorOffset >= len - EPS) break; // 起点已在末拍之后：无可绘制内容
    const take = Math.min(remaining, len - cursorOffset);
    barChunks.push({ bar: cursorBar, offset: cursorOffset, durQn: take });
    remaining = Math.round((remaining - take) / GRID) * GRID;
    cursorBar += 1;
    cursorOffset = 0;
  }

  // ── 2 + 3. 拍点切分 × 时值分解 ──
  const out: NoteSpan[] = [];
  for (const chunk of barChunks) {
    const boundaries = metricBoundaries(meterAt(chunk.bar));
    const len = barLengthQn(meterAt(chunk.bar));
    for (const seg of metricSegments(chunk.offset, chunk.durQn, boundaries, len)) {
      for (const value of decomposeDuration(seg.durQn)) {
        out.push({
          key: `${chain}#${out.length}`,
          bar: chunk.bar,
          offset: seg.offset,
          durQn: value.durQn,
          duration: value.duration,
          dots: value.dots,
          chain,
          index: out.length,
        });
        seg.offset += value.durQn;
      }
    }
  }
  return out;
}

/**
 * 把 `[offset, offset+durQn)` 切成「每个切点都是拍点」的若干段。
 *
 * 规则（见文件头「规则来源」）：
 * - 起点在拍点上 → 尽量取**大**且落点仍在拍点上的标准值（`h.` 允许跨弱拍）；
 * - 起点不在拍点上 → 只能切到**下一个拍点**，不允许横跨；
 * - 无拍点可落时（尾段）→ 直接取剩余量，交给 {@link decomposeDuration} 分解。
 */
function metricSegments(
  offset: number,
  durQn: number,
  boundaries: number[],
  len: number,
): { offset: number; durQn: number }[] {
  const end = offset + durQn;
  const out: { offset: number; durQn: number }[] = [];
  let p = offset;

  const isBoundary = (x: number) => boundaries.some((b) => Math.abs(b - x) < EPS);

  for (let guard = 0; p < end - EPS && guard < 256; guard++) {
    const remaining = Math.round((end - p) / GRID) * GRID;
    let chosen = -1;

    if (!isBoundary(p)) {
      // 弱位起：必须切到下一个拍点
      const next = boundaries.find((b) => b > p + EPS);
      if (next !== undefined && next < end - EPS) chosen = next - p;
    }

    if (chosen < 0) {
      // 拍点起（或已无可切拍点）：优先取落点仍是拍点的最大标准值
      for (const v of NOTATABLE_VALUES) {
        if (v.durQn > remaining + EPS) continue;
        if (isBoundary(p + v.durQn) || Math.abs(p + v.durQn - len) < EPS) {
          chosen = v.durQn;
          break;
        }
      }
    }

    if (chosen < 0) chosen = remaining; // 兜底：交给 decomposeDuration

    out.push({ offset: p, durQn: chosen });
    p = Math.round((p + chosen) / GRID) * GRID;
  }

  return out;
}

/**
 * 同小节同谱表内的声部划分。
 *
 * 旧实现把「同拍但不同时值」的两个音（例如旋律 `q` + 和弦 `w`）当作两个独立
 * tickable **串行**塞进同一个 Voice —— VexFlow 按 tick 顺序排布，第二个音被推到
 * 第 5 拍，整小节宽度翻倍。这里改为「按区间贪婪装箱」：每个 span 放进
 * **第一个已结束**（`end <= offset`）的声部，都未结束则新开一个声部。
 *
 * ⚠️ **不设声部上限、不截短时值**：截短会伪造时值，正是本模块要消灭的那类错误。
 * 声部数 > 2 时谱面会拥挤（符干相撞），但每个音的时间位置与长度都是真的 ——
 * 这是「同时发声层数超过双谱表表达力」的诚实表现，由渲染器告警，不做静默篡改。
 *
 * 声部顺序即绘制顺序：0 号在上（符干向上），1 号在下（符干向下），之后交替。
 */
export function assignVoices(spans: NoteSpan[]): NoteSpan[][] {
  const sorted = spans
    .slice()
    .sort((a, b) => a.offset - b.offset || b.durQn - a.durQn || a.index - b.index);
  const voices: NoteSpan[][] = [];
  const ends: number[] = [];

  for (const span of sorted) {
    let target = ends.findIndex((e) => e <= span.offset + EPS);
    if (target < 0) {
      voices.push([]);
      ends.push(0);
      target = voices.length - 1;
    }
    voices[target]!.push(span);
    ends[target] = span.offset + span.durQn;
  }

  for (const list of voices) list.sort((a, b) => a.offset - b.offset || a.index - b.index);
  return voices;
}

/** 一个待绘制的休止符 */
export interface RestSpan {
  offset: number;
  durQn: number;
  duration: string;
  dots: number;
}

/**
 * 按声部补齐休止，使该声部在本小节的 tick 总量**精确等于**小节长度。
 *
 * 不补齐的后果与「时值丢失」同源：VexFlow 的 `format(voices, width)` 按 tick
 * 总量横向摊开，缺 tick 的声部会被压到左侧、与另一声部错位。
 */
export function fillVoiceRests(barLenQn: number, spans: NoteSpan[]): RestSpan[] {
  const total = quantizeDur(barLenQn);
  if (total <= 0) return [];
  const sorted = spans.slice().sort((a, b) => a.offset - b.offset);
  const boundaries = metricBoundariesForLength(total);
  const gaps: { offset: number; durQn: number }[] = [];
  let cursor = 0;

  for (const span of sorted) {
    const start = Math.max(cursor, quantizeDur(span.offset));
    if (start > cursor + EPS) gaps.push({ offset: cursor, durQn: start - cursor });
    cursor = Math.max(cursor, start + span.durQn);
  }
  if (cursor < total - EPS) gaps.push({ offset: cursor, durQn: total - cursor });

  const out: RestSpan[] = [];
  for (const gap of gaps) {
    for (const seg of metricSegments(gap.offset, gap.durQn, boundaries, total)) {
      for (const value of decomposeDuration(seg.durQn)) {
        out.push({
          offset: seg.offset,
          durQn: value.durQn,
          duration: value.duration,
          dots: value.dots,
        });
        seg.offset += value.durQn;
      }
    }
  }
  return out;
}

/**
 * 仅用「小节长度」反推拍点（{@link fillVoiceRests} 只拿到长度、拿不到拍号）。
 *
 * 缺省按 4/4 的每拍边界切；这对休止符是正确的（休止符必须让人看清拍位），
 * 6/8 这类复合拍会退化成每 1 个四分切一次 —— 比「一个长休止横跨整个小节」
 * 更接近通行排印，且不会影响跨声部对齐（对齐只取决于 tick 总量）。
 */
function metricBoundariesForLength(total: number): number[] {
  const set = [0];
  for (let x = 1; x < total - EPS; x += 1) set.push(x);
  set.push(total);
  return set;
}

/**
 * 两个 span 是否「几何相邻」——连音线的唯一判据。
 *
 * 同一小节内：`a.end == b.start`；跨小节：`a` 结束于小节末且 `b` 起于小节首。
 * **不以「音高相同」为判据**：两个同音高但中间有休止的音若画连音线，语义就错了。
 */
export function spansAreContiguous(
  a: NoteSpan,
  b: NoteSpan,
  barLenOf: (bar: number) => number,
): boolean {
  if (a.bar === b.bar) return Math.abs(a.offset + a.durQn - b.offset) < EPS;
  if (b.bar === a.bar + 1) {
    return (
      Math.abs(a.offset + a.durQn - barLenOf(a.bar)) < EPS && Math.abs(b.offset) < EPS
    );
  }
  return false;
}

/** {@link beamRuns} 的最小输入：时间位置 + 时值。 */
export interface BeamCandidate {
  offset: number;
  durQn: number;
}

/**
 * 把同一小节内的音符切成「可连梁的连续片段」。
 *
 * ## 为什么必须切
 *
 * VexFlow 的 `Beam.generateBeams` 先把音符按 `groups`（4/4 是**半小节**一组）
 * 分桶，再用 `getBeamGroups` 过滤：**组内只要有一个音的内禀 tick ≥ 四分音符，
 * 整组作废**（beams.js `durationToTicks('4')` 比较）。
 *
 * 于是 `四分 → 八分 → 八分 → 四分` 这样最常见的旋律里，两个八分音符落在同一个
 * 半小节桶、桶里混着四分音符 → 整桶被丢弃 → 谱面上两个八分音符各自画符尾，
 * 永远连不到一起（`二分 → 八分 → 八分` 才侥幸能连）。
 *
 * 本函数先把不可连梁的音符（四分及更长）与休止造成的空隙切掉，只把真正
 * 「时值短于四分、且首尾相接」的片段交给 `generateBeams` —— 分组规则仍由
 * `beamGroups` 决定（4/4 半小节、6/8 附点四分、5/8 = 3+2 …）。
 *
 * 判据用「时值短于四分」而不是「等于八分」：附点八分（0.75）与十六分（0.25）
 * 同样要连梁（附点八分 + 十六分是最常见的一对）。
 */
export function beamRuns<T extends BeamCandidate>(items: readonly T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.offset - b.offset);
  const runs: T[][] = [];
  let run: T[] = [];
  /** 当前片段最后一个音的结束位置（四分音符单位） */
  let runEnd = Number.NaN;

  const flush = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };

  for (const item of sorted) {
    const beamable = item.durQn > 0 && item.durQn < 1 - EPS;
    if (!beamable) {
      flush();
      runEnd = item.offset + item.durQn;
      continue;
    }
    // 与上一音不首尾相接（中间有休止）→ 另起片段，绝不能跨休止连梁
    if (run.length > 0 && Math.abs(item.offset - runEnd) > EPS) flush();
    run.push(item);
    runEnd = item.offset + item.durQn;
  }
  flush();
  return runs;
}
