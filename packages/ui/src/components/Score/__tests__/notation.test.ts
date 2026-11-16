import { describe, it, expect } from "vitest";
import {
  GRID,
  NOTATABLE_VALUES,
  assignVoices,
  barLengthQn,
  beamRuns,
  decomposeDuration,
  fillVoiceRests,
  metricBoundaries,
  planNoteSpans,
  quantizeDur,
  spansAreContiguous,
  type Metric,
  type NoteSpan,
} from "../notation";

/**
 * v3.3.0：记谱排布引擎单测。
 *
 * 这一层的意义是把「谱面为什么错」变成可断言的数值：
 * - 时值 → 符号序列必须**逐值覆盖**原始时值（tick 守恒），否则 VexFlow 按 tick
 *   摊开时整小节错位；
 * - 跨小节 / 跨拍必须切分出可连音的段（连音判据是几何相邻，不是音高相同）；
 * - 同谱表同时发声的不同时值必须分声部，而不是串行排在一条时间轴上。
 */

const M44: Metric = { numerator: 4, denominator: 4 };
const M34: Metric = { numerator: 3, denominator: 4 };
const M68: Metric = { numerator: 6, denominator: 8 };
const M78: Metric = { numerator: 7, denominator: 8 };
const M58: Metric = { numerator: 5, denominator: 8 };
const M22: Metric = { numerator: 2, denominator: 2 };

const sum = (list: { durQn: number }[]) =>
  Math.round(list.reduce((acc, v) => acc + v.durQn, 0) / GRID) * GRID;

describe("barLengthQn（每小节四分音符数）", () => {
  it("⚠️ 必须按 numerator × 4 / denominator 算，不能用 numerator", () => {
    expect(barLengthQn(M44)).toBe(4);
    expect(barLengthQn(M34)).toBe(3);
    expect(barLengthQn(M68)).toBe(3); // 6/8 ≠ 6
    expect(barLengthQn(M78)).toBe(3.5); // 7/8 ≠ 7
    expect(barLengthQn(M58)).toBe(2.5);
    expect(barLengthQn(M22)).toBe(4);
  });
});

describe("quantizeDur / decomposeDuration（时值 → 可记谱序列）", () => {
  it("单一标准值原样返回", () => {
    expect(decomposeDuration(4)).toEqual([{ durQn: 4, duration: "w", dots: 0 }]);
    expect(decomposeDuration(0.5)).toEqual([{ durQn: 0.5, duration: "8", dots: 0 }]);
    expect(decomposeDuration(1.5)).toEqual([{ durQn: 1.5, duration: "q", dots: 1 }]);
    expect(decomposeDuration(0.75)).toEqual([{ durQn: 0.75, duration: "8", dots: 1 }]);
  });

  it("跨拍组合值拆成「大块优先」的序列（tick 总量保守）", () => {
    expect(decomposeDuration(1.25)).toEqual([
      { durQn: 1, duration: "q", dots: 0 },
      { durQn: 0.25, duration: "16", dots: 0 },
    ]);
    expect(decomposeDuration(2.5).map((v) => v.durQn)).toEqual([2, 0.5]);
    expect(decomposeDuration(5).map((v) => v.durQn)).toEqual([4, 1]);
    // 7 = 附点全音符 + 四分（附点全音符只在 6/4、12/8 这类拍号里合法，
    // 但 decomposeDuration 无拍号上下文，按「最大值优先」取 6 是设计行为）
    expect(decomposeDuration(7).map((v) => v.durQn)).toEqual([6, 1]);
  });

  it("任何输入都严格守恒（|差值| < GRID）", () => {
    for (const dur of [0.1, 0.3, 0.4, 0.9, 1.1, 1.7, 2.25, 3.75, 5.5, 6.25]) {
      const q = quantizeDur(dur);
      expect(sum(decomposeDuration(dur))).toBeCloseTo(q, 6);
    }
  });

  it("非正 / 非有限输入 → 空序列（调用方据此丢弃）", () => {
    expect(decomposeDuration(0)).toEqual([]);
    expect(decomposeDuration(-1)).toEqual([]);
    expect(decomposeDuration(Number.NaN)).toEqual([]);
    expect(decomposeDuration(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("负控：0.1 不等于 0.25（旧实现把它画成 16 分音符，多占 1.5 倍）", () => {
    expect(decomposeDuration(0.1)).toEqual([{ durQn: 0.125, duration: "32", dots: 0 }]);
    expect(decomposeDuration(0.1)[0]!.durQn).not.toBe(0.25);
  });
});

describe("metricBoundaries（拍点集合）", () => {
  it("简单拍按拍切；含 0 与小节末", () => {
    expect(metricBoundaries(M44)).toEqual([0, 1, 2, 3, 4]);
    expect(metricBoundaries(M34)).toEqual([0, 1, 2, 3]);
    expect(metricBoundaries(M22)).toEqual([0, 2, 4]);
  });

  it("复合拍按附点四分（3/8）切，不按八分切", () => {
    expect(metricBoundaries(M68)).toEqual([0, 1.5, 3]);
    expect(metricBoundaries({ numerator: 12, denominator: 8 })).toEqual([0, 1.5, 3, 4.5, 6]);
  });

  it("不规则拍沿用分梁分组（5/8 = 3+2，7/8 = 2+2+3）", () => {
    expect(metricBoundaries(M58)).toEqual([0, 1.5, 2.5]);
    expect(metricBoundaries(M78)).toEqual([0, 1, 2, 3.5]);
  });
});

function spansFor(
  offset: number,
  durQn: number,
  metric: Metric,
  lastBar = 8,
): NoteSpan[] {
  return planNoteSpans({
    bar: 1,
    offset,
    durQn,
    chain: "c",
    meterAt: () => metric,
    lastBar,
  });
}

describe("planNoteSpans（跨小节 + 跨拍 + 时值分解）", () => {
  it("满小节：4/4 → 全音符；3/4 → 附点二分；6/8 → 附点二分", () => {
    expect(spansFor(0, 4, M44).map((s) => s.duration)).toEqual(["w"]);
    expect(spansFor(0, 3, M34).map((s) => s.duration)).toEqual(["h"]);
    expect(spansFor(0, 3, M34)[0]!.dots).toBe(1);
    expect(spansFor(0, 3, M68).map((s) => s.duration)).toEqual(["h"]);
  });

  it("4/4 拍 1 的附点四分必须切成 q~8（不能让 q. 横跨到拍 2）", () => {
    const spans = spansFor(0, 1.5, M44);
    expect(spans.map((s) => [s.offset, s.duration, s.dots])).toEqual([
      [0, "q", 0],
      [1, "8", 0],
    ]);
  });

  it("6/8 拍 1 的附点四分是**单一**符号（复合拍以 3/8 为拍）", () => {
    const spans = spansFor(0, 1.5, M68);
    expect(spans.map((s) => [s.offset, s.duration, s.dots])).toEqual([[0, "q", 1]]);
  });

  it("4/4 拍 2 的二分音符保持单一符号（起点在拍点，允许跨弱拍）", () => {
    expect(spansFor(1, 2, M44).map((s) => [s.offset, s.duration])).toEqual([[1, "h"]]);
  });

  it("弱位起音必须切到下一个拍点（8~q~8，而非一个 q. 横跨）", () => {
    const spans = spansFor(0.5, 2, M44);
    expect(spans.map((s) => [s.offset, s.duration])).toEqual([
      [0.5, "8"],
      [1, "q"],
      [2, "8"],
    ]);
  });

  it("跨小节切分：bar1 末拍起 2 拍 → 落在两小节、链内 index 递增", () => {
    const spans = planNoteSpans({
      bar: 1,
      offset: 2.5,
      durQn: 2,
      chain: "x",
      meterAt: () => M44,
      lastBar: 8,
    });
    expect(spans.map((s) => [s.bar, s.offset, s.duration])).toEqual([
      [1, 2.5, "8"],
      [1, 3, "q"],
      [2, 0, "8"],
    ]);
    expect(spans.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(new Set(spans.map((s) => s.chain))).toEqual(new Set(["x"]));
  });

  it("切分点按**各小节自己的拍号**取（4/4 → 6/8 的中途变拍号）", () => {
    const meterAt = (bar: number) => (bar <= 1 ? M44 : M68);
    const spans = planNoteSpans({
      bar: 1,
      offset: 3,
      durQn: 2.5,
      chain: "m",
      meterAt,
      lastBar: 8,
    });
    // bar1 只剩 1 拍；bar2 是 6/8（3 拍）→ 剩 1.5 → 附点四分整块
    expect(spans.map((s) => [s.bar, s.offset, s.durQn])).toEqual([
      [1, 3, 1],
      [2, 0, 1.5],
    ]);
  });

  it("超出可见区最后一小节的部分不再产出 span", () => {
    const spans = planNoteSpans({
      bar: 1,
      offset: 3,
      durQn: 8,
      chain: "z",
      meterAt: () => M44,
      lastBar: 2,
    });
    expect(spans.every((s) => s.bar <= 2)).toBe(true);
    expect(sum(spans)).toBe(5); // 1（bar1 剩）+ 4（bar2）
  });

  it("时值守恒：切分后各段之和 == 量化后的原时值", () => {
    for (const [offset, dur, metric] of [
      [0, 1.25, M44],
      [0.5, 3.5, M44],
      [2.5, 2, M44],
      [0, 5, M34],
      [1.5, 2.25, M68],
      [0.25, 1.75, M78],
    ] as [number, number, Metric][]) {
      const spans = spansFor(offset, dur, metric);
      expect(sum(spans)).toBeCloseTo(quantizeDur(dur), 6);
    }
  });

  it("起点越界（≥ 小节长度）不产出 span", () => {
    expect(spansFor(4, 1, M44)).toEqual([]);
  });
});

function makeSpan(patch: Partial<NoteSpan> & { offset: number; durQn: number }): NoteSpan {
  return {
    key: `k${patch.offset}`,
    bar: 1,
    duration: "q",
    dots: 0,
    chain: `c${patch.offset}`,
    index: 0,
    ...patch,
  };
}

describe("assignVoices（同时发声的不同时值必须分声部）", () => {
  it("不重叠 → 单声部", () => {
    const voices = assignVoices([
      makeSpan({ offset: 0, durQn: 1 }),
      makeSpan({ offset: 1, durQn: 1 }),
    ]);
    expect(voices).toHaveLength(1);
  });

  it("同起点不同时值（旋律 q + 和弦 w）→ 两个声部，而非串行排成两拍", () => {
    const voices = assignVoices([
      makeSpan({ offset: 0, durQn: 4 }),
      makeSpan({ offset: 0, durQn: 1 }),
    ]);
    expect(voices).toHaveLength(2);
    // 长音在 0 号声部（同样起点优先放长音，避免短音先占位把长音挤到 2 号）
    expect(voices[0]!.map((s) => s.durQn)).toEqual([4]);
    expect(voices[1]!.map((s) => s.durQn)).toEqual([1]);
  });

  it("跨过对方结束点后回到同一声部（贪婪装箱，不无脑新开）", () => {
    const voices = assignVoices([
      makeSpan({ offset: 0, durQn: 2 }),
      makeSpan({ offset: 0.5, durQn: 0.5 }),
      makeSpan({ offset: 2, durQn: 1 }),
    ]);
    expect(voices).toHaveLength(2);
    expect(voices[0]!.map((s) => s.offset)).toEqual([0, 2]);
    expect(voices[1]!.map((s) => s.offset)).toEqual([0.5]);
  });

  it("三层同时发声 → 三个声部，一个音都不丢、时值一律不改", () => {
    const voices = assignVoices([
      makeSpan({ offset: 0, durQn: 4 }),
      makeSpan({ offset: 0, durQn: 2 }),
      makeSpan({ offset: 0, durQn: 1 }),
    ]);
    expect(voices).toHaveLength(3);
    expect(voices.map((v) => v[0]!.durQn).sort()).toEqual([1, 2, 4]);
    // 负控：不允许为了凑声部数而截短时值
    expect(voices.flat().every((s) => [1, 2, 4].includes(s.durQn))).toBe(true);
  });
});

describe("fillVoiceRests（休止必须精确填满小节）", () => {
  it("空声部 → 铺满整小节", () => {
    expect(sum(fillVoiceRests(4, []))).toBe(4);
  });

  it("有空隙 → 只补空隙，总量等于空隙之和", () => {
    const rests = fillVoiceRests(4, [
      makeSpan({ offset: 0, durQn: 1 }),
      makeSpan({ offset: 2, durQn: 1 }),
    ]);
    // 两处空隙：拍 2、拍 4
    expect(rests.map((r) => [r.offset, r.durQn])).toEqual([
      [1, 1],
      [3, 1],
    ]);
    expect(sum(rests)).toBe(2);
  });

  it("休止也按拍点切（弱位空隙不产生横跨拍点的长休止）", () => {
    const rests = fillVoiceRests(4, [makeSpan({ offset: 0, durQn: 0.5 })]);
    // 0.5 → 4 的空隙：先补弱位半拍到拍 2，再从拍 2 起取最大标准休止（附点二分）
    expect(rests.map((r) => r.offset)).toEqual([0.5, 1]);
    expect(sum(rests)).toBe(3.5);
  });

  it("声部音符总和 + 休止总和 == 小节长度（VexFlow 对齐的前提）", () => {
    for (const metric of [M44, M34, M68, M78]) {
      const len = barLengthQn(metric);
      const spans = spansFor(0, 1.5, metric);
      const rests = fillVoiceRests(len, spans);
      expect(sum(spans) + sum(rests)).toBeCloseTo(len, 6);
    }
  });
});

describe("spansAreContiguous（连音判据 = 几何相邻）", () => {
  const barLenOf = (bar: number) => (bar === 1 ? 4 : 3);

  it("同小节首尾相接 → true", () => {
    expect(
      spansAreContiguous(
        makeSpan({ offset: 0, durQn: 1 }),
        makeSpan({ offset: 1, durQn: 1 }),
        barLenOf,
      ),
    ).toBe(true);
  });

  it("同小节中间有休止 → false（音高相同也不能连）", () => {
    expect(
      spansAreContiguous(
        makeSpan({ offset: 0, durQn: 1 }),
        makeSpan({ offset: 2, durQn: 1 }),
        barLenOf,
      ),
    ).toBe(false);
  });

  it("跨小节：上一段到小节末 + 下一段在小节首 → true", () => {
    expect(
      spansAreContiguous(
        makeSpan({ bar: 1, offset: 3, durQn: 1 }),
        makeSpan({ bar: 2, offset: 0, durQn: 0.5 }),
        barLenOf,
      ),
    ).toBe(true);
  });

  it("跨小节但上一段没到小节末 → false；跨两小节 → false", () => {
    expect(
      spansAreContiguous(
        makeSpan({ bar: 1, offset: 2, durQn: 1 }),
        makeSpan({ bar: 2, offset: 0, durQn: 1 }),
        barLenOf,
      ),
    ).toBe(false);
    expect(
      spansAreContiguous(
        makeSpan({ bar: 1, offset: 4, durQn: 1 }),
        makeSpan({ bar: 3, offset: 0, durQn: 1 }),
        barLenOf,
      ),
    ).toBe(false);
  });
});

describe("NOTATABLE_VALUES（表本身的一致性）", () => {
  it("按时值严格降序（贪心分解依赖这个前提）", () => {
    for (let i = 1; i < NOTATABLE_VALUES.length; i++) {
      expect(NOTATABLE_VALUES[i]!.durQn).toBeLessThan(NOTATABLE_VALUES[i - 1]!.durQn);
    }
  });

  it("附点值的 dots 与 durQn 自洽（base × 1.5）", () => {
    const base: Record<string, number> = {
      w: 4,
      h: 2,
      q: 1,
      "8": 0.5,
      "16": 0.25,
      "32": 0.125,
    };
    for (const value of NOTATABLE_VALUES) {
      if (value.dots === 0) continue;
      const b = base[value.duration];
      if (b === undefined) continue;
      expect(value.durQn).toBeCloseTo(b * 1.5, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// v3.3.0：可连梁片段切分
// ---------------------------------------------------------------------------

describe("beamRuns（可连梁片段）", () => {
  const cand = (offset: number, durQn: number) => ({ offset, durQn });

  it("四分及更长的音把片段切开（q 8 8 q → 只有 {8,8} 可连梁）", () => {
    const runs = beamRuns([cand(0, 1), cand(1, 0.5), cand(1.5, 0.5), cand(2, 1)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.map((c) => c.offset)).toEqual([1, 1.5]);
  });

  it("负控：若把四分音符也算进片段，`{q,8,8}` 会被当成一组 —— 本函数不得如此", () => {
    const runs = beamRuns([cand(0, 1), cand(1, 0.5), cand(1.5, 0.5)]);
    const flat = runs.flat();
    expect(flat.some((c) => c.durQn === 1)).toBe(false);
  });

  it("附点八分（0.75）可连梁，附点四分（1.5）不可", () => {
    const runs = beamRuns([cand(0, 0.75), cand(0.75, 0.25), cand(1, 1.5)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.map((c) => c.durQn)).toEqual([0.75, 0.25]);
  });

  it("中间有休止（不首尾相接）→ 各自成片段，不得跨休止连梁", () => {
    const runs = beamRuns([cand(1, 0.5), cand(1.5, 0.5), cand(3, 0.5), cand(3.5, 0.5)]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.map((c) => c.offset)).toEqual([1, 1.5]);
    expect(runs[1]!.map((c) => c.offset)).toEqual([3, 3.5]);
  });

  it("整小节八分音符 → 一个连续片段（拍组切分交给 beamGroups / generateBeams）", () => {
    const runs = beamRuns(Array.from({ length: 8 }, (_, i) => cand(i * 0.5, 0.5)));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(8);
  });

  it("乱序输入按时间排序；空输入返回空", () => {
    const runs = beamRuns([cand(1.5, 0.5), cand(1, 0.5)]);
    expect(runs[0]!.map((c) => c.offset)).toEqual([1, 1.5]);
    expect(beamRuns([])).toEqual([]);
  });

  it("时值为 0 的音不参与连梁（不产生空片段）", () => {
    expect(beamRuns([cand(0, 0), cand(1, 0.5)])).toHaveLength(1);
    expect(beamRuns([cand(0, 0)])).toEqual([]);
  });
});
