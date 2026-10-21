/**
 * 系统（行）/ 页排布纯函数回归。
 *
 * 关键回归点：48 小节不能压进一行（550px / 48 ≈ 11px/小节，音符根本画不下），
 * 也不能只画前 4 小节。这里用纯函数断言「覆盖 1..48、无空洞、无重复、每页系统数
 * 受 stavesPerPage 约束」。
 */
import { describe, it, expect } from "vitest";
import {
  BARS_PER_SYSTEM,
  DEFAULT_STAVES_PER_PAGE,
  pageIndexForBar,
  planScorePages,
  planSystems,
  systemsPerPage,
} from "../score-layout";

describe("planSystems —— 小节 → 系统（行）", () => {
  it("48 小节 / 每行 8 → 6 个系统，覆盖 1..48 且首尾相接", () => {
    const systems = planSystems({ bars: 48 });
    expect(systems).toHaveLength(6);
    expect(systems.map((s) => s.bars)).toEqual([8, 8, 8, 8, 8, 8]);
    expect(systems[0].startBar).toBe(1);
    expect(systems.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // 无空洞、无重叠：前一个系统的末小节 + 1 === 后一个系统的首小节。
    for (let k = 1; k < systems.length; k++) {
      expect(systems[k].startBar).toBe(systems[k - 1].startBar + systems[k - 1].bars);
    }
    // 覆盖 1..48。
    const covered: number[] = [];
    for (const system of systems) {
      for (let bar = system.startBar; bar < system.startBar + system.bars; bar++) covered.push(bar);
    }
    expect(covered).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it("末系统允许不足一行（43 小节 → 8×5 + 3）", () => {
    const systems = planSystems({ bars: 43 });
    expect(systems.map((s) => s.bars)).toEqual([8, 8, 8, 8, 8, 3]);
    const last = systems[systems.length - 1];
    expect(last.startBar + last.bars - 1).toBe(43);
  });

  it("单系统（<= 每行容量）行为与改动前一致：一段连续小节", () => {
    const systems = planSystems({ bars: 7 });
    expect(systems).toHaveLength(1);
    expect(systems[0]).toEqual({ index: 0, startBar: 1, bars: 7 });
  });

  it("首小节号可指定（分页第 2 页），0 / 非法 bars 返回空", () => {
    expect(planSystems({ bars: 8, startBar: 41 })[0]).toEqual({
      index: 0,
      startBar: 41,
      bars: 8,
    });
    expect(planSystems({ bars: 0 })).toEqual([]);
    expect(planSystems({ bars: Number.NaN })).toEqual([]);
  });

  it("每行容量缺省 = BARS_PER_SYSTEM（8），可被覆盖", () => {
    expect(BARS_PER_SYSTEM).toBe(8);
    expect(planSystems({ bars: 48 }).length).toBe(Math.ceil(48 / BARS_PER_SYSTEM));
    expect(planSystems({ bars: 48, barsPerSystem: 4 }).length).toBe(12);
  });
});

describe("systemsPerPage —— 每页系统数取自 stavesPerPage", () => {
  it("10 谱表 / 2 谱表每行 → 5 行每页", () => {
    expect(systemsPerPage(10, 2)).toBe(5);
  });

  it("stavesPerPage 缺失 / 0 / 非法 → 回落缺省 10；过小 → 至少 1", () => {
    expect(DEFAULT_STAVES_PER_PAGE).toBe(10);
    expect(systemsPerPage(undefined, 2)).toBe(5);
    // 0 与 NaN 视为「未设置」（Layout 里该字段可缺省），不是「每页 0 行」。
    expect(systemsPerPage(0, 2)).toBe(5);
    expect(systemsPerPage(Number.NaN, 2)).toBe(5);
    // 每页谱表数少于每行谱表数 → 至少 1 行，不能出现 0 行/页。
    expect(systemsPerPage(1, 2)).toBe(1);
  });
});

describe("planScorePages —— 48 小节分页", () => {
  it("48 小节 / 2 谱表 / 每页 10 谱表 → 2 页（40 + 8），覆盖 1..48", () => {
    const pages = planScorePages({ bars: 48, staffCount: 2, stavesPerPage: 10 });
    expect(pages).toHaveLength(2);
    expect(pages[0].startBar).toBe(1);
    expect(pages[0].bars).toBe(40);
    expect(pages[0].systems).toHaveLength(5);
    expect(pages[1].startBar).toBe(41);
    expect(pages[1].bars).toBe(8);
    expect(pages[1].systems).toHaveLength(1);
    // 页内系统序号重新从 0 起（渲染器按序号算纵向位置）。
    expect(pages[1].systems[0].index).toBe(0);

    const covered: number[] = [];
    for (const page of pages) {
      for (let bar = page.startBar; bar < page.startBar + page.bars; bar++) covered.push(bar);
    }
    expect(covered).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it("短工程（16 小节 / 2 谱表）只有 1 页，不出现分页控件", () => {
    const pages = planScorePages({ bars: 16, staffCount: 2, stavesPerPage: 10 });
    expect(pages).toHaveLength(1);
    expect(pages[0].bars).toBe(16);
    expect(pages[0].systems).toHaveLength(2);
  });

  it("每页系统数受 stavesPerPage 约束（4 谱表每页 / 2 谱表每行 → 每页 2 行）", () => {
    const pages = planScorePages({ bars: 48, staffCount: 2, stavesPerPage: 4 });
    expect(pages).toHaveLength(3);
    for (const page of pages) expect(page.systems.length).toBeLessThanOrEqual(2);
  });

  it("0 小节 → 无分页（渲染器自行回落）", () => {
    expect(planScorePages({ bars: 0, staffCount: 2 })).toEqual([]);
  });
});

describe("pageIndexForBar —— 小节 → 页号（越界钳制）", () => {
  const pages = planScorePages({ bars: 48, staffCount: 2, stavesPerPage: 10 });

  it("页内小节命中对应页", () => {
    expect(pageIndexForBar(pages, 1)).toBe(0);
    expect(pageIndexForBar(pages, 40)).toBe(0);
    expect(pageIndexForBar(pages, 41)).toBe(1);
    expect(pageIndexForBar(pages, 48)).toBe(1);
  });

  it("越界钳制到首/末页；空分页表返回 0", () => {
    expect(pageIndexForBar(pages, 0)).toBe(0);
    expect(pageIndexForBar(pages, 999)).toBe(1);
    expect(pageIndexForBar([], 5)).toBe(0);
  });
});
