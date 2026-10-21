/**
 * Stage 0 收口：ScoreRenderer 小节锚点回调（onBarAnchorsChange）真实渲染护栏。
 *
 * 背景：ScoreRenderer 新增 onBarAnchorsChange 后，提交的测试零覆盖——把回调删掉
 * 或改坏渲染时机，全量 534 条测试无一变红。本文件用「真实渲染」补齐（jsdom +
 * vexflow 5 SVG 后端；无 @testing-library/react，手写 createRoot + act，样板见
 * src/__tests__/v200-stage1.test.tsx）：
 *   T46b 成功路径：双谱表 7 小节 → 回调恰好 1 次、7 锚点、bar 1..7、x0 严格递增、
 *        x1 > x0，且与 planBarSlots({startX:10, availableWidth:AVAIL_WIDTH_7, bars:7}) 逐值相等。
 *   T46c 失败路径：vexflow Renderer 抛错 → 回调 0 次 + 出现「VexFlow 渲染失败」占位。
 *   T46d 取消/竞态：上一次动态 import 未 resolve 前换入参 → 无过期回调覆盖新值。
 *   T46e 缺省回调：不传 onBarAnchorsChange → 不抛错且 SVG 结构零变化。
 *
 * vexflow 桩：vi.mock 只包一层——仅当 vexflowMock.fail 为真时让 Renderer 构造抛错，
 * 其余情况透传真实 vexflow（真实渲染路径完全不受影响）。
 *
 * 等待策略：动态 import 在 jsdom 下可正常 resolve，用 await vi.waitFor 轮询至
 * 回调/DOM 就绪（外层不再包 act，避免 act 阻塞 waitFor 的轮询）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScoreRenderer, computeStaveWidth } from "../ScoreRenderer";
import { planBarSlots } from "../bar-anchors";
import type { BarAnchor } from "../bar-anchors";
import type { ScoreRendererLayout } from "../ScoreRenderer";
import type { NoteEvent } from "@collinx/core";

/** 可用宽度 = 谱表宽 - 右留白(10)；谱表宽随每行小节数自适应（v2.8.0） */
const AVAIL_WIDTH_7 = computeStaveWidth(7) - 10;

// vi.mock 被提升至 import 之上，故控制开关经 vi.hoisted 一并提升。
const vexflowMock = vi.hoisted(() => ({ fail: false }));

vi.mock("vexflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vexflow")>();
  const RealRenderer = actual.Renderer;
  // 仅拦截「构造」动作：fail 时抛错以模拟渲染失败，否则透传真实 Renderer。
  const Renderer = new Proxy(RealRenderer, {
    construct(target, args, newTarget) {
      if (vexflowMock.fail) {
        throw new Error("vexflow mock: forced render failure");
      }
      return Reflect.construct(target, args, newTarget);
    },
  });
  return { ...actual, Renderer } as typeof import("vexflow");
});

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

let mounted: { container: HTMLElement; cleanup: () => void } | null = null;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  mounted = {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
  return {
    container,
    rerender(next: React.ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => mounted!.cleanup(),
  };
}

function twoStaffLayout(bars: number): ScoreRendererLayout {
  return {
    staffConfig: [
      { clef: "treble", name: "Treble", bars },
      { clef: "bass", name: "Bass", bars },
    ],
  };
}

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: overrides.id ?? "n",
    trackId: overrides.trackId ?? "track-1",
    phraseId: overrides.phraseId ?? null,
    bar: overrides.bar ?? 1,
    beat: overrides.beat ?? 1,
    durQn: overrides.durQn ?? 1,
    pitchMidi: overrides.pitchMidi ?? 60,
    pitchSpelling: overrides.pitchSpelling ?? "C4",
    velocity: overrides.velocity ?? 0.8,
    voice: overrides.voice ?? "rh",
    tags: overrides.tags ?? [],
  };
}

/** 双谱表各塞若干音符（高音 >=60，低音 <60），确保真实渲染含 StaveNote/Voice。 */
function sampleNotes(): NoteEvent[] {
  return [
    makeNote({ id: "t1", bar: 1, beat: 1, pitchMidi: 60 }),
    makeNote({ id: "t2", bar: 3, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
    makeNote({ id: "t3", bar: 6, beat: 1, pitchMidi: 67, pitchSpelling: "G4" }),
    makeNote({ id: "b1", bar: 1, beat: 1, pitchMidi: 48, pitchSpelling: "C3" }),
    makeNote({ id: "b2", bar: 4, beat: 3, pitchMidi: 43, pitchSpelling: "G2" }),
  ];
}

const countSvgStructure = (c: HTMLElement) => ({
  svg: c.querySelectorAll("svg").length,
  g: c.querySelectorAll("g").length,
  path: c.querySelectorAll("path").length,
  text: c.querySelectorAll("text").length,
});

describe("ScoreRenderer onBarAnchorsChange 真实渲染护栏（Stage 0 收口）", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    vexflowMock.fail = false;
    if (mounted) {
      mounted.cleanup();
      mounted = null;
    }
    document.body.innerHTML = "";
  });

  it("T46b: 双谱表 7 小节 → 回调恰好 1 次、7 锚点与 planBarSlots 逐值相等 (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const { container, unmount } = mount(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(7)}
        onBarAnchorsChange={(a) => calls.push(a)}
      />,
    );

    // 真实渲染完成：SVG 出现 + 回调到达（两者都在同一渲染周期内）。
    await vi.waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    // 恰好 1 次（多谱表共用同一 bar→x，只回调一次）。
    expect(calls.length).toBe(1);
    const anchors = calls[0];

    // 数量（必要但非充分）。
    expect(anchors).toHaveLength(7);

    // 全序：bar 严格 1..7。
    for (let k = 0; k < anchors.length; k++) {
      expect(anchors[k].bar).toBe(k + 1);
    }
    // x0 严格递增（隐含无重复、无塌缩）。
    for (let k = 1; k < anchors.length; k++) {
      expect(anchors[k].x0).toBeGreaterThan(anchors[k - 1].x0);
    }
    // 每个锚点宽度为正（x1 > x0）。
    for (const a of anchors) {
      expect(a.x1).toBeGreaterThan(a.x0);
    }

    // 逐值相等：与 planBarSlots({startX:10, availableWidth:AVAIL_WIDTH_7, bars:7}) 映射结果一致。
    // availableWidth = staveX(10) + staveWidth - firstBarLeft(10) - rightPad(10) = 540。
    const expected = planBarSlots({ startX: 10, availableWidth: AVAIL_WIDTH_7, bars: 7 }).map(
      (s) => ({ bar: s.bar, x0: s.x, x1: s.x + s.width }),
    );
    expect(expected).toHaveLength(7);
    for (let k = 0; k < expected.length; k++) {
      expect(anchors[k].bar).toBe(expected[k].bar);
      expect(anchors[k].x0).toBe(expected[k].x0);
      expect(anchors[k].x1).toBe(expected[k].x1);
    }

    unmount();
  });

  it("T46c: 渲染失败路径 → 回调 0 次且出现「VexFlow 渲染失败」占位 (critical)", async () => {
    vexflowMock.fail = true;
    const calls: BarAnchor[][] = [];
    const { container, unmount } = mount(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(7)}
        onBarAnchorsChange={(a) => calls.push(a)}
      />,
    );

    // 现值断言：占位文本真实出现（而非仅「不抛错」）。
    await vi.waitFor(() => {
      expect(container.textContent ?? "").toContain("VexFlow 渲染失败");
    });
    const placeholder = container.querySelector('[class*="errorPlaceholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent ?? "").toContain("VexFlow 渲染失败");
    // 无 SVG 绘制（失败路径未产出谱面）。
    expect(container.querySelector("svg")).toBeNull();

    // 给迟到的（若有）回调留出时间窗，再断言 0 次。
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(0);

    unmount();
  });

  it("T46d: 取消/竞态 → 无过期回调覆盖新值，最终锚点数对应最后一次入参 bars (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const h = mount(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(7)}
        onBarAnchorsChange={(a) => calls.push(a)}
      />,
    );
    // 上一次动态 import 尚未 resolve（同一同步执行栈内）即改变入参：
    // notes 与 layout 都是 effect 依赖 → 触发 cleanup(cancelled=true) + 新 renderId。
    h.rerender(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(5)}
        onBarAnchorsChange={(a) => calls.push(a)}
      />,
    );

    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    // 让被取消的那次 import 若真会回调，也有时间落地（判别过期回调）。
    await new Promise((r) => setTimeout(r, 100));

    // 恰好 1 次且对应最后一次入参 bars=5；无任何 bars=7 的过期锚点。
    expect(calls.length).toBe(1);
    expect(calls.some((c) => c.length === 7)).toBe(false);
    const anchors = calls[0];
    expect(anchors).toHaveLength(5);
    for (let k = 0; k < anchors.length; k++) {
      expect(anchors[k].bar).toBe(k + 1);
    }
    expect(anchors[anchors.length - 1].x1).toBeGreaterThan(anchors[0].x0);

    h.unmount();
  });

  it("T46e: 缺省 onBarAnchorsChange → 不抛错且 SVG 结构零变化 (critical)", async () => {
    // 传回调版本。
    const withCb = mount(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(7)}
        onBarAnchorsChange={() => {}}
      />,
    );
    await vi.waitFor(() => expect(withCb.container.querySelector("svg")).not.toBeNull());
    const withCbCounts = countSvgStructure(withCb.container);
    withCb.unmount();

    // 缺省回调版本。
    const noCb = mount(
      <ScoreRenderer notes={sampleNotes()} layout={twoStaffLayout(7)} />,
    );
    await vi.waitFor(() => expect(noCb.container.querySelector("svg")).not.toBeNull());
    const noCbCounts = countSvgStructure(noCb.container);

    // 结构非平凡。
    expect(withCbCounts.svg).toBeGreaterThan(0);
    expect(withCbCounts.g).toBeGreaterThan(0);
    expect(withCbCounts.path).toBeGreaterThan(0);
    expect(withCbCounts.text).toBeGreaterThan(0);

    // 零行为变化：四种元素计数逐项相等。
    expect(noCbCounts.svg).toBe(withCbCounts.svg);
    expect(noCbCounts.g).toBe(withCbCounts.g);
    expect(noCbCounts.path).toBe(withCbCounts.path);
    expect(noCbCounts.text).toBe(withCbCounts.text);

    noCb.unmount();
  });
});
