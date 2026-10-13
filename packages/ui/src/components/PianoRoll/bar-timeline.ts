import type { TempoMap } from "@collinx/core";

/**
 * v2.3.0 Stage 3 (S3)：钢琴卷拍号一致化。
 *
 * 按 `TempoMap` 的**真实拍号**建立「小节 → 四分音符坐标」前缀表，供
 * `PianoRollView` 取代原先的 `BEATS_PER_BAR = 4` 硬编码（3/4、7/8 下钢琴卷的
 * 「m2」与 transport 真实第 2 小节不再是同一位置）。
 *
 * ── 领域事实（全部以 core 源码为准，非本文件臆断）────────────────────────────
 * 1. `beat` 的单位是**四分音符**：
 *    `TempoMap.positionInBars(bar, beat) = bar + (beat - 1) / 4`
 *    （packages/core/src/model/tempo-map.ts:280-282）。
 * 2. 因此**每小节四分音符拍数** = `numerator × 4 / denominator`。该换算式在 core
 *    中被两处采用——`timeAt`（tempo-map.ts:120）与 `barBeatAt`（tempo-map.ts:183）
 *    均为 `meter.numerator * (4 / meter.denominator)`。故：
 *      3/4 → 3 拍；6/8 → 6×4/8 = **3** 拍；**7/8 → 3.5 拍（可小数）**。
 *    **禁止直接用 `numerator`**（3/4 与 6/8 都会被算错；本项目已因单位换算踩坑三次：
 *    v2.1.0 S4-F1 / v2.2.0 T44 / v2.3.0 S1）。
 * 3. `meterAt(bar)` 的回落与 bar 约定：`meterAt` 经 `findActive`（tempo-map.ts:263-278）
 *    取「最后一个 `bar' <= bar` 的拍号变更」——即拍号按**小节号**（bar 索引）而非按
 *    音乐位置生效，`MeterChange.bar` 是生效的起始小节（含）。若不存在 `bar' <= bar`
 *    的变更则回落 4/4（tempo-map.ts:96-100，:98 `{numerator:4,denominator:4}`）；
 *    构造函数保证默认存在一条 `{bar:1,4,4}`（tempo-map.ts:61-63）。
 *
 * ── 坐标约定 ────────────────────────────────────────────────────────────────
 * `qnOf(bar, beat)` 是**自 bar 1 beat 1 起**的绝对四分音符坐标：`qnOf(1,1) === 0`。
 * 前缀表 `starts[k] = barStartQn(k) = Σ_{j<k} beatsPerBarAt(j)`，一次 O(N) 构建后
 * 查询只做数组索引（**不再逐次循环累加浮点**，避免 7/8 的 3.5 步进漂移）。
 */
export interface BarTimeline {
  /** 该小节四分音符拍数 = numerator × 4 / denominator（可小数，7/8 → 3.5）。 */
  beatsPerBarAt(bar: number): number;
  /** 该小节起点在「自 bar 1 起的四分音符坐标」上的位置（barStartQn(1) === 0）。 */
  barStartQn(bar: number): number;
  /** 绝对四分音符坐标：`barStartQn(bar) + (beat - 1)`。beat 单位为四分音符。 */
  qnOf(bar: number, beat: number): number;
  /** `qnOf` 的反演（二分查找）；`barBeatFromQn(qnOf(b, t)) === { bar: b, beat: t }`。 */
  barBeatFromQn(qn: number): { bar: number; beat: number };
  /** 覆盖 bar 1..bars 的总四分音符拍数。 */
  totalQn(bars: number): number;
}

/** core `meterAt` 的 4/4 回落值（tempo-map.ts:98）。 */
const DEFAULT_METER = { numerator: 4, denominator: 4 };

/**
 * 读取某小节的拍号。**防御性回落**：既有组件级测试把 `tempoMap` 传成 `{}` 占位
 * （见 PianoRollView.test.tsx 的 S1-T08 / S1-T09 / S2 段），缺失 `meterAt`；此时
 * 回落 4/4，与 core 的回落语义一致（tempo-map.ts:96-100）——不这么做会让那些
 * 「与拍号无关」的既有用例因本 Stage 的接线而抛错（红线）。
 */
function readMeter(
  tempoMap: TempoMap,
  bar: number
): { numerator: number; denominator: number } {
  const maybe = tempoMap as unknown as {
    meterAt?: (b: number) => { numerator: number; denominator: number } | undefined;
  };
  if (typeof maybe?.meterAt !== "function") return DEFAULT_METER;
  const meter = maybe.meterAt(bar);
  if (!meter || !meter.numerator || !meter.denominator) return DEFAULT_METER;
  return meter;
}

/** 每小节四分音符拍数（numerator × 4 / denominator；依据 tempo-map.ts:120/:183）。 */
function qnPerBar(tempoMap: TempoMap, bar: number): number {
  const meter = readMeter(tempoMap, bar);
  return (meter.numerator * 4) / meter.denominator;
}

export function createBarTimeline(
  tempoMap: TempoMap,
  opts: { startBar: number; endBar: number }
): BarTimeline {
  const { startBar, endBar } = opts;
  // 「收尾边界小节」：网格最后一条主 bar 线 / 总宽 / totalQn 落在 endBar+1 的起点上
  // （旧 4/4 网格亦在 `startBar + totalBeats/4 = endBar+1` 处画一条主线与标签）。
  const closingBar = endBar + 1;

  // starts[k] = barStartQn(k)，k ∈ [1, closingBar + 1]；starts[1] = 0。
  // 一次 O(N) 前缀和；此后所有查询均为 O(1) 索引（barBeatFromQn 为 O(log N) 二分）。
  const starts = new Array<number>(closingBar + 2);
  starts[1] = 0;
  for (let bar = 1; bar <= closingBar; bar++) {
    starts[bar + 1] = starts[bar] + qnPerBar(tempoMap, bar);
  }

  /**
   * 将查询 bar 归一化为整数并 clamp 到 [lo, hi]。
   * 越界语义（显式、并在 test 中钉死）：`bar < lo` → lo；`bar > hi` → hi；
   * **非整数 bar 四舍五入到最近整数**后再 clamp；非有限输入 → lo。
   */
  function clampBarIndex(bar: number, lo: number, hi: number): number {
    const rounded = Math.round(bar);
    if (!Number.isFinite(rounded)) return lo;
    if (rounded < lo) return lo;
    if (rounded > hi) return hi;
    return rounded;
  }

  function beatsPerBarAt(bar: number): number {
    // 合法域 [startBar, endBar]；越界取最近合法小节的拍数。
    const b = clampBarIndex(bar, startBar, endBar);
    return starts[b + 1] - starts[b];
  }

  function barStartQn(bar: number): number {
    // 合法域 [startBar, endBar + 1]：endBar+1 是收尾边界小节，故意可寻址（见上）。
    const b = clampBarIndex(bar, startBar, closingBar);
    return starts[b];
  }

  function qnOf(bar: number, beat: number): number {
    // beat（四分音符单位）不做 clamp：允许越出小节（调用方自行取整语义）。
    return barStartQn(bar) + (beat - 1);
  }

  function totalQn(bars: number): number {
    // 覆盖 bar 1..bars；bars ≤ 0 → 0，bars > endBar → endBar 处的累计（最近合法）。
    const b = clampBarIndex(bars, 0, endBar);
    return starts[b + 1];
  }

  function barBeatFromQn(qn: number): { bar: number; beat: number } {
    const firstQn = starts[startBar];
    const lastQn = starts[closingBar];
    // 越界 qn clamp 到 [firstQn, lastQn]（startBar=1 时即 [0, totalQn(endBar)]）。
    let q = qn;
    if (!Number.isFinite(q) || q < firstQn) q = firstQn;
    else if (q > lastQn) q = lastQn;

    // starts 严格递增（拍数恒 > 0）→ 二分找最大的 b ∈ [startBar, closingBar]
    // 使 starts[b] <= q（O(log N)；N = endBar - startBar + 2）。
    let lo = startBar;
    let hi = closingBar;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= q) lo = mid;
      else hi = mid - 1;
    }
    return { bar: lo, beat: q - starts[lo] + 1 };
  }

  return {
    beatsPerBarAt,
    barStartQn,
    qnOf,
    barBeatFromQn,
    totalQn,
  };
}
