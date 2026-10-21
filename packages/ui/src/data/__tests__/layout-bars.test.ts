/**
 * 默认排版的小节数回归（「五线谱怎么就四个区」）。
 *
 * 缺陷：`createDefaultLayout()` 内部把 `staffConfig.bars` 硬编码为 4，于是 48 小节
 * 的工程在乐谱页只排 4 小节 —— 后面 44 小节既不占槽位也不会被渲染。
 * 现在小节数由调用方传入（App 传工程实际小节数）。
 */
import { describe, it, expect } from "vitest";
import { createDefaultLayout, DEFAULT_LAYOUT_BARS } from "../../data/demoData";

describe("createDefaultLayout(bars) —— 小节数不再硬编码", () => {
  it("createDefaultLayout(48) → 每条谱表的 bars 都是 48", () => {
    const layout = createDefaultLayout(48);
    expect(layout.staffConfig).toBeDefined();
    const bars = (layout.staffConfig ?? []).map((staff) => staff.bars);
    expect(bars).toHaveLength(2);
    // 两条谱表（高音/低音）必须同长，否则谱面对不齐。
    expect(bars).toEqual([48, 48]);
  });

  it("缺省参数保持既有 4 小节（无工程上下文的示例/单测场景）", () => {
    expect(DEFAULT_LAYOUT_BARS).toBe(4);
    const layout = createDefaultLayout();
    expect((layout.staffConfig ?? []).map((s) => s.bars)).toEqual([4, 4]);
  });

  it("非法输入（NaN / 0 / 负数）回落缺省，不产出 0 或负数小节", () => {
    for (const bad of [Number.NaN, 0, -8, Number.POSITIVE_INFINITY]) {
      const bars = (createDefaultLayout(bad).staffConfig ?? []).map((s) => s.bars);
      expect(bars).toEqual([DEFAULT_LAYOUT_BARS, DEFAULT_LAYOUT_BARS]);
    }
  });

  it("小数向下取整（小节号是整数）", () => {
    expect((createDefaultLayout(48.9).staffConfig ?? []).map((s) => s.bars)).toEqual([48, 48]);
  });

  it("每页谱表数保持不变（分页依据），且小节数不影响其它排版字段", () => {
    const layout = createDefaultLayout(48);
    expect(layout.stavesPerPage).toBe(10);
    expect(layout.pageWidth).toBe(210);
    expect(layout.pageHeight).toBe(297);
  });
});
