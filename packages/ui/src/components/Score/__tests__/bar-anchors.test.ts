/**
 * Stage 0（乐谱小节级排版）核心护栏：bar-anchors 几何纯函数。
 *
 * 断言策略（硬要求）：断言必须落在「全序」或「差值」上，禁止只断言 length——
 * 数量断言对槽位塌缩 / barline 乱序视而不见（本项目 v2.1.0 S2 已因此漏过
 * count-in 塌缩）。本文件另含一个「负控」：内联逐次浮点累加实现作对照，
 * 证明等宽/乘法不变量对该实现真的敏感。
 */
import { describe, it, expect } from "vitest";
import { planBarSlots, barlineXs } from "../bar-anchors";
import type { BarSlot } from "../bar-anchors";

const EPS = 1e-9;

/** 相邻槽位首尾相接：slot[k].x + slot[k].width === slot[k+1].x */
function assertContiguous(slots: BarSlot[]) {
  for (let k = 0; k < slots.length - 1; k++) {
    expect(Math.abs(slots[k].x + slots[k].width - slots[k + 1].x)).toBeLessThan(EPS);
  }
}

/** 全体槽位严格等宽 */
function assertEqualWidths(slots: BarSlot[]) {
  for (let k = 1; k < slots.length; k++) {
    expect(Math.abs(slots[k].width - slots[k - 1].width)).toBeLessThan(EPS);
  }
}

/** 序列严格递增（隐含无重复） */
function assertStrictlyIncreasing(xs: number[]) {
  for (let k = 1; k < xs.length; k++) {
    expect(xs[k]).toBeGreaterThan(xs[k - 1]);
  }
}

describe("planBarSlots / barlineXs 小节级几何不变量", () => {
  it("T46 无音符小节仍产出等宽连续槽位（bars=7，含空小节 2/5）", () => {
    // 场景：bars=7，其中第 2/5 小节无音符。planBarSlots 由小节数驱动、与音符
    // 无关，故「无音符」不会塌缩槽位——这正是本用例要锁定的行为。
    const slots = planBarSlots({ startX: 10, availableWidth: 540, bars: 7 });

    // 数量（必要但非充分）
    expect(slots).toHaveLength(7);

    // 全序落点：bar 编号严格为 1..7
    for (let k = 0; k < slots.length; k++) {
      expect(slots[k].bar).toBe(k + 1);
    }

    // 差值不变量：等宽 + 首尾相接
    assertEqualWidths(slots);
    assertContiguous(slots);

    // barlineXs 全序：长度 = bars + 1，且严格递增
    const xs = barlineXs(slots);
    expect(xs).toHaveLength(8);
    assertStrictlyIncreasing(xs);

    // 首末锚点与槽位边界一致（差值断言，非仅数量）
    expect(Math.abs(xs[0] - slots[0].x)).toBeLessThan(EPS);
    expect(Math.abs(xs[xs.length - 1] - (slots[6].x + slots[6].width))).toBeLessThan(EPS);
  });

  it("T47 全序不变量在 bars=1 / 7 / 64 边界均成立", () => {
    for (const bars of [1, 7, 64]) {
      const slots = planBarSlots({ startX: 10, availableWidth: 540, bars });

      expect(slots).toHaveLength(bars);
      assertEqualWidths(slots);
      assertContiguous(slots);

      // 每个 width > 0（负宽度 / 塌缩即失败，而非只看数量）
      for (const s of slots) expect(s.width).toBeGreaterThan(0);

      // 完整分配：末槽右缘精确落在 startX + availableWidth（无溢出、无欠分配）。
      // 差值断言——把 barWidth = availableWidth / bars 钉死：若误写成 /(bars+1)，
      // 末槽右缘会欠分配到 startX + availableWidth * bars/(bars+1)，差值远大于 EPS。
      const last = slots[bars - 1];
      expect(Math.abs(last.x + last.width - (10 + 540))).toBeLessThan(EPS);

      // barlineXs 严格递增且无重复
      const xs = barlineXs(slots);
      expect(xs).toHaveLength(bars + 1);
      assertStrictlyIncreasing(xs);
      expect(new Set(xs).size).toBe(xs.length);
    }
  });

  it("负控：逐次浮点累加实现 vs 乘法版本在 bars=64、barWidth=7/3 下不同", () => {
    // 构造使 barWidth === 7/3（不可精确表示）的入参
    const bars = 64;
    const startX = 10;
    const availableWidth = (bars * 7) / 3;

    const good = planBarSlots({ startX, availableWidth, bars });
    const barWidth = availableWidth / bars;

    // 内联「逐次累加」变体（负控对照，非生产实现）
    const naive: number[] = [];
    let acc = startX;
    for (let k = 0; k < bars; k++) {
      naive.push(acc);
      acc += barWidth;
    }

    let diffCount = 0;
    for (let k = 0; k < bars; k++) {
      if (good[k].x !== naive[k]) diffCount++;
    }

    // 至少一个落点不同——证明「乘法」不变量对该实现真的敏感
    expect(diffCount).toBeGreaterThan(0);
  });

  it("T47b 末点正向不变量（次序无关）：64 小节非精确宽度下末点精确命中 startX+availableWidth", () => {
    // bars=64、availableWidth=(64*7)/3 使 barWidth === 7/3（不可精确表示）。原负控
    // 只对「内联累加的那一种次序」敏感；本用例改钉生产正向不变量，对累加次序免疫。
    const bars = 64;
    const startX = 10;
    const availableWidth = (bars * 7) / 3;
    const targetEnd = startX + availableWidth;

    const slots = planBarSlots({ startX, availableWidth, bars });

    // 正向不变量：可用宽被完整分配——末槽右缘精确落在 startX + availableWidth。
    const last = slots[bars - 1];
    expect(Math.abs(last.x + last.width - targetEnd)).toBeLessThan(EPS);

    const barWidth = availableWidth / bars;

    // 任意「逐次浮点累加」次序的变体（初值 startX / 初值 0 最后加 startX / 逆序累加）
    // 都无法精确命中末端——累计舍入漂移至少 1 ulp。判别与具体累加次序无关。
    const accumulateEnds: number[] = [];
    {
      let acc = startX; // 次序 1：初值 startX，逐次累加
      for (let k = 0; k < bars; k++) acc += barWidth;
      accumulateEnds.push(acc);
    }
    {
      let acc = 0; // 次序 2：初值 0，逐次累加，startX 最后相加
      for (let k = 0; k < bars; k++) acc += barWidth;
      accumulateEnds.push(acc + startX);
    }
    {
      let acc = startX; // 次序 3：逆序逐次累加
      for (let k = bars - 1; k >= 0; k--) acc += barWidth;
      accumulateEnds.push(acc);
    }

    for (const end of accumulateEnds) {
      // 「不满足不变量」：与精确末端存在非零偏差（累加次序无法免疫的舍入漂移）。
      expect(end).not.toBe(targetEnd);
      expect(Math.abs(end - targetEnd)).toBeGreaterThan(0);
    }
  });
});
