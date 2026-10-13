/**
 * v2.3.0 Stage 1（S1）：谱面播放头覆盖层（只读跟随）护栏。
 *
 * 覆盖三块交付物：
 *   T48  ScorePlayhead 组件：锚点 + position → 覆盖层 `left` 逐值相等；position
 *        null/undefined → 零覆盖层 DOM。
 *   T48b 循环防护（D31-6）：父组件用 useState 接收 onBarAnchorsChange 时的
 *        「按值去重」+ ScorePanel 的 layout memo 化。含两种 harness 形态
 *        （内联 layout 字面量 / memo 化 layout）+ 真实 ScorePanel。
 *   T48c 拍号派生：beatsPerBarAt 参与 fraction 计算，支持小数 beat（unit）。
 *
 * 渲染策略完全照抄既有先例（ScoreRenderer.anchors.test.tsx）：
 *   jsdom + createRoot + act 手写；动态 import 用 vi.waitFor 轮询（外层不再包
 *   act，避免 act 阻塞 waitFor 的轮询）。
 *
 * 循环防护的可观测性说明见 T48b-a 内注释：若 dedup 失效（无限自触发），回调次数
 * 会在数百毫秒内线性增长到十几~几十次；本用例先等首次回调，再静置 250ms 后断言
 * 「恰好 1 次」，对无限增长与偶发二次触发都敏感。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Layout, NoteEvent } from "@collinx/core";
import { TempoMap } from "@collinx/core";
import { ScoreRenderer } from "../ScoreRenderer";
import type { ScoreRendererLayout } from "../ScoreRenderer";
import { ScorePlayhead, playheadX } from "../ScorePlayhead";
import { planBarSlots } from "../bar-anchors";
import type { BarAnchor } from "../bar-anchors";
import { ScorePanel } from "../ScorePanel";
import type { CollisionWarning } from "../ScorePanel";
import { I18nProvider } from "../../../providers/I18nProvider";

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 与 ScoreRenderer 内部一致的锚点来源（startX=10, availableWidth=540）。 */
function anchors7(): BarAnchor[] {
  return planBarSlots({ startX: 10, availableWidth: 540, bars: 7 }).map((s) => ({
    bar: s.bar,
    x0: s.x,
    x1: s.x + s.width,
  }));
}

// 稳定引用：避免 notes 身份变化干扰渲染 effect 的依赖。
const ANCHOR_NOTES: NoteEvent[] = [makeNote({ id: "h1", bar: 1, beat: 1, pitchMidi: 60 })];

/** 内联 layout 字面量：每次渲染换身份（模拟 ScorePanel 未 memo 的旧场景）。 */
const InlineLayoutHarness: React.FC<{ onAnchors: (a: BarAnchor[]) => void; bump: number }> = ({
  onAnchors,
  bump,
}) => {
  void bump; // 仅借 bump 制造父级重渲染（不参与几何）。
  const [, setAnchors] = useState<BarAnchor[]>([]);
  const layout: ScoreRendererLayout = {
    staffConfig: [{ clef: "treble", name: "Treble", bars: 7 }],
  };
  return (
    <ScoreRenderer
      notes={ANCHOR_NOTES}
      layout={layout}
      onBarAnchorsChange={(a) => {
        onAnchors(a);
        setAnchors(a);
      }}
    />
  );
};

/** memo 化 layout：身份在 bump 变化时保持稳定（模拟 ScorePanel 已 memo 的路径）。 */
const MemoLayoutHarness: React.FC<{ onAnchors: (a: BarAnchor[]) => void; bump: number }> = ({
  onAnchors,
  bump,
}) => {
  void bump; // 仅借 bump 制造父级重渲染（不进入 layout 身份）。
  const [, setAnchors] = useState<BarAnchor[]>([]);
  const layout = useMemo<ScoreRendererLayout>(
    () => ({ staffConfig: [{ clef: "treble", name: "Treble", bars: 7 }] }),
    [],
  );
  return (
    <ScoreRenderer
      notes={ANCHOR_NOTES}
      layout={layout}
      onBarAnchorsChange={(a) => {
        onAnchors(a);
        setAnchors(a);
      }}
    />
  );
};

/** 真实 ScorePanel 所需的完整 Layout（staffConfig 为稳定模块常量）。 */
const PANEL_STAFF_CONFIG = [
  { clef: "treble" as const, name: "Treble", bars: 7 },
  { clef: "bass" as const, name: "Bass", bars: 7 },
];
const PANEL_LAYOUT: Layout = {
  id: "layout-stage1",
  name: "Stage1 Layout",
  type: "full_score",
  staves: [],
  players: [],
  pageWidth: 210,
  pageHeight: 297,
  margins: { top: 15, bottom: 15, left: 15, right: 15 },
  systemBreaks: [],
  globalStaffSize: 7,
  stavesPerPage: 4,
  staffDistance: 6,
  staffConfig: PANEL_STAFF_CONFIG,
};

const PANEL_NOTES: NoteEvent[] = [
  makeNote({ id: "t1", bar: 1, beat: 1, pitchMidi: 60 }),
  makeNote({ id: "t2", bar: 3, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
  makeNote({ id: "b1", bar: 1, beat: 1, pitchMidi: 48, pitchSpelling: "C3" }),
  makeNote({ id: "b2", bar: 4, beat: 3, pitchMidi: 43, pitchSpelling: "G2" }),
];

function clickRenderedView(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    /Rendered View|渲染视图/.test(b.textContent ?? ""),
  );
  expect(btn).toBeTruthy();
  act(() => {
    btn!.click();
  });
}

// ---------------------------------------------------------------------------
// T48 / T48c：playheadX 纯函数 + ScorePlayhead 组件
// ---------------------------------------------------------------------------

describe("ScorePlayhead 覆盖层（Stage 1）", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    if (mounted) {
      mounted.cleanup();
      mounted = null;
    }
    document.body.innerHTML = "";
  });

  it("T48: 覆盖层 left 逐值等于 (x0 + fraction*(x1-x0))*scale；position=null → 零 DOM (critical)", () => {
    const anchors = anchors7();
    const a2 = anchors[1]; // bar 2
    expect(a2.bar).toBe(2);

    const beatsPerBarAt = () => 4;
    const fraction = (3 - 1) / 4; // beat=3, 4/4
    // 独立复算（与 planBarSlots 同一算术）：每小节宽 = 540/7。
    const barWidth = 540 / 7;
    const expectedScale1 = 10 + barWidth /* a2.x0 */ + fraction * barWidth;
    const expectedScale05 = expectedScale1 * 0.5;

    // 锚点自身与独立复算一致（防 anchors 与断言同错）。
    expect(a2.x0).toBe(10 + barWidth);
    expect(a2.x1).toBe(10 + 2 * barWidth);

    // --- scale = 1 ---
    {
      const h = mount(
        <ScorePlayhead anchors={anchors} position={{ bar: 2, beat: 3 }} beatsPerBarAt={beatsPerBarAt} scale={1} />,
      );
      const el = h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]');
      expect(el).not.toBeNull();
      expect(el!.style.left).toBe(`${expectedScale1}px`);
      expect(parseFloat(el!.style.left)).toBe(expectedScale1);
      // 覆盖层位于有界区间内（a2.x0, a2.x1）
      expect(parseFloat(el!.style.left)).toBeGreaterThan(a2.x0);
      expect(parseFloat(el!.style.left)).toBeLessThan(a2.x1);
      h.unmount();
    }

    // --- scale = 0.5 ---
    {
      const h = mount(
        <ScorePlayhead anchors={anchors} position={{ bar: 2, beat: 3 }} beatsPerBarAt={beatsPerBarAt} scale={0.5} />,
      );
      const el = h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]');
      expect(el).not.toBeNull();
      expect(el!.style.left).toBe(`${expectedScale05}px`);
      expect(parseFloat(el!.style.left)).toBe(expectedScale05);
      h.unmount();
    }

    // --- 边界：beat=1 → 左缘；beat=1+beats → 右缘；单调递增 ---
    expect(playheadX(anchors, { bar: 2, beat: 1 }, beatsPerBarAt, 1)).toBe(a2.x0);
    expect(playheadX(anchors, { bar: 2, beat: 5 }, beatsPerBarAt, 1)).toBe(a2.x1);
    const b1 = playheadX(anchors, { bar: 2, beat: 1 }, beatsPerBarAt, 1)!;
    const b3 = playheadX(anchors, { bar: 2, beat: 3 }, beatsPerBarAt, 1)!;
    const b4 = playheadX(anchors, { bar: 2, beat: 4 }, beatsPerBarAt, 1)!;
    expect(b3).toBeGreaterThan(b1);
    expect(b4).toBeGreaterThan(b3);

    // --- 找不到 bar 的锚点 → null ---
    expect(playheadX(anchors, { bar: 99, beat: 1 }, beatsPerBarAt, 1)).toBeNull();
    expect(playheadX([], { bar: 2, beat: 3 }, beatsPerBarAt, 1)).toBeNull();

    // --- position=null → 零覆盖层 DOM（连 layer 都不存在） ---
    {
      const h = mount(<ScorePlayhead anchors={anchors} position={null} />);
      expect(h.container.querySelector('[data-testid="score-playhead"]')).toBeNull();
      expect(h.container.querySelector('[data-testid="score-playhead-layer"]')).toBeNull();
      h.unmount();
    }
    // --- position 缺省（undefined）→ 同样零 DOM ---
    {
      const h = mount(<ScorePlayhead anchors={anchors} />);
      expect(h.container.querySelector('[data-testid="score-playhead"]')).toBeNull();
      expect(h.container.querySelector('[data-testid="score-playhead-layer"]')).toBeNull();
      h.unmount();
    }
  });

  it("T48c: 拍号派生 —— beatsPerBarAt=()=>3 时 fraction=(2.5-1)/3，支持小数 beat (critical)", () => {
    const anchors = anchors7();
    const a2 = anchors[1];
    const barWidth = 540 / 7;

    const x3 = playheadX(anchors, { bar: 2, beat: 2.5 }, () => 3, 1);
    const x4 = playheadX(anchors, { bar: 2, beat: 2.5 }, () => 4, 1);

    // 逐值相等（3/4 拍：fraction = (2.5-1)/3）
    expect(x3).toBe(10 + barWidth + ((2.5 - 1) / 3) * barWidth);
    // 4/4 拍对照（fraction = (2.5-1)/4）
    expect(x4).toBe(10 + barWidth + ((2.5 - 1) / 4) * barWidth);
    // 判别性：两者必须不同，证明确实使用了 beatsPerBarAt（而非硬编码 4）。
    expect(x3).not.toBe(x4);
    // 3/4 下 beat 更大（分母小→fraction 大）→ x 更大。
    expect(x3!).toBeGreaterThan(x4!);

    // scale 参与：x3 * scale
    const scaled = playheadX(anchors, { bar: 2, beat: 2.5 }, () => 3, 0.5);
    expect(scaled).toBe(x3! * 0.5);
  });

  it("T48d: 复合拍号插值 —— 6/8 语义(3) 与 7/8 语义(3.5) 逐值断言（容差 1e-9） (critical)", () => {
    // 显式锚点（不依赖 planBarSlots）：单小节 x0=100, x1=180（宽 80）。
    const anchors: BarAnchor[] = [{ bar: 2, x0: 100, x1: 180 }];
    const close = (actual: number | null, expected: number) => {
      expect(actual).not.toBeNull();
      expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(1e-9);
    };

    // 6/8：每小节四分音符数 = numerator*4/denominator = 6*4/8 = 3。
    // beat=2.5 → fraction = (2.5-1)/3 = 0.5 → x = 100 + 0.5*80 = 140。
    close(playheadX(anchors, { bar: 2, beat: 2.5 }, () => 3, 1), 100 + ((2.5 - 1) / 3) * 80);
    close(playheadX(anchors, { bar: 2, beat: 2.5 }, () => 3, 1), 140);

    // 7/8：每小节四分音符数 = 7*4/8 = 3.5。
    // beat=3.5 → fraction = (3.5-1)/3.5 = 2.5/3.5 → x = 100 + (2.5/3.5)*80 = 157.14285714285714。
    close(playheadX(anchors, { bar: 2, beat: 3.5 }, () => 3.5, 1), 100 + (2.5 / 3.5) * 80);
    close(playheadX(anchors, { bar: 2, beat: 3.5 }, () => 3.5, 1), 157.14285714285714);

    // 判别性：3（6/8 语义）与 6（旧式 meter.numerator）结果不同——证明确实使用了换算后的拍数。
    const x68 = playheadX(anchors, { bar: 2, beat: 2.5 }, () => 3, 1);
    const xOld = playheadX(anchors, { bar: 2, beat: 2.5 }, () => 6, 1);
    expect(x68).not.toBe(xOld);
    expect(x68!).toBeGreaterThan(xOld!);
  });

  it("T48e: 组件级回归锁 —— 真实 ScoreRenderer 6/8 tempoMap 下覆盖层按 beatsPerBar=3 定位 (critical)", async () => {
    const layout: ScoreRendererLayout = {
      staffConfig: [{ clef: "treble", name: "Treble", bars: 7 }],
    };
    // 6/8：正确换算 → 每小节四分音符数 = 6*4/8 = 3；旧式实现会误用 numerator = 6。
    const tempoMap = new TempoMap([], [{ bar: 1, numerator: 6, denominator: 8 }]);

    const h = mount(
      <ScoreRenderer
        notes={ANCHOR_NOTES}
        layout={layout}
        tempoMap={tempoMap}
        playheadPosition={{ bar: 1, beat: 2.5 }}
      />,
    );

    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    await vi.waitFor(
      () => expect(h.container.querySelector('[data-testid="score-playhead"]')).not.toBeNull(),
      { timeout: 5000 },
    );

    const el = h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]')!;
    const left = parseFloat(el.style.left);

    // 锚点几何与 ScoreRenderer 内部一致（startX=10, availableWidth=540, bars=7）。
    const expected = anchors7();
    const a1 = expected[0];
    expect(a1.bar).toBe(1);

    // 正确语义（beatsPerBar=3）：fraction = (2.5-1)/3 = 0.5。
    const expectedWith3 = a1.x0 + ((2.5 - 1) / 3) * (a1.x1 - a1.x0);
    // 旧实现错误语义（beatsPerBar = numerator = 6）：fraction = (2.5-1)/6。
    const expectedWith6 = a1.x0 + ((2.5 - 1) / 6) * (a1.x1 - a1.x0);
    // 两目标值本身必须不同，否则「不等于 6」的断言会退化为恒真。
    expect(Math.abs(expectedWith3 - expectedWith6)).toBeGreaterThan(1e-6);

    // 断言 1：等于按 3 推出的值（容差 1e-9）。
    expect(Math.abs(left - expectedWith3)).toBeLessThanOrEqual(1e-9);
    // 断言 2（反证）：不等于按 6 推出的值 —— 回到 () => meter.numerator 旧实现即在此变红。
    expect(Math.abs(left - expectedWith6)).toBeGreaterThan(1e-6);

    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T48b：循环防护
// ---------------------------------------------------------------------------

describe("T48b 锚点上报循环防护（D31-6）", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    if (mounted) {
      mounted.cleanup();
      mounted = null;
    }
    document.body.innerHTML = "";
  });

  it("T48b-a: 内联 layout 字面量 + 父级 useState 接收锚点 → 回调恰好 1 次且不随渲染增长 (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const h = mount(<InlineLayoutHarness onAnchors={(a) => calls.push(a)} bump={0} />);

    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), { timeout: 5000 });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    // 观测窗口：自触发循环在此窗口内会线性增长（S0 实测 300ms 内 15 次）。
    await wait(250);
    // 再触发若干次父级重渲染（每次换新 layout 身份）。
    for (let k = 1; k <= 3; k++) {
      h.rerender(<InlineLayoutHarness onAnchors={(a) => calls.push(a)} bump={k} />);
    }
    await wait(250);

    // 恰好 1 次：去重生效，重排版不再重复上报。
    expect(calls.length).toBe(1);
    // 内容正确（与 planBarSlots 一致），防止「一次但为空」的假绿。
    const anchors = calls[0];
    expect(anchors).toHaveLength(7);
    const expected = anchors7();
    for (let k = 0; k < expected.length; k++) {
      expect(anchors[k].bar).toBe(expected[k].bar);
      expect(anchors[k].x0).toBe(expected[k].x0);
      expect(anchors[k].x1).toBe(expected[k].x1);
    }

    h.unmount();
  });

  it("T48b-b: memo 化 layout harness 反复重渲染 → 不产生新回调，且渲染 effect 不重跑 (regression)", async () => {
    const calls: BarAnchor[][] = [];
    const h = mount(<MemoLayoutHarness onAnchors={(a) => calls.push(a)} bump={0} />);

    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), { timeout: 5000 });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    await wait(100);
    expect(calls.length).toBe(1);

    // layout 身份稳定 → 渲染 effect 不重跑 → svg DOM 节点保持不变。
    const svgBefore = h.container.querySelector("svg");
    expect(svgBefore).not.toBeNull();

    for (let k = 1; k <= 4; k++) {
      h.rerender(<MemoLayoutHarness onAnchors={(a) => calls.push(a)} bump={k} />);
    }
    await wait(150);

    expect(calls.length).toBe(1);
    // 同一 DOM 节点：证明 effect 未重跑（未清空重绘）。
    expect(h.container.querySelector("svg")).toBe(svgBefore);

    h.unmount();
  });

  it("T48b-c: 真实 ScorePanel —— layout memo 化使重渲染不重排版，且透传 playheadPosition/onBarAnchorsChange (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const build = (collisions?: CollisionWarning[]) => (
      <I18nProvider>
        <ScorePanel
          layout={PANEL_LAYOUT}
          notes={PANEL_NOTES}
          compact
          collisions={collisions}
          playheadPosition={{ bar: 2, beat: 3 }}
          onBarAnchorsChange={(a) => calls.push(a)}
        />
      </I18nProvider>
    );

    const h = mount(build());

    // 默认 data 视图不渲染 ScoreRenderer；切到 rendered 视图。
    clickRenderedView(h.container);

    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), { timeout: 5000 });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    await wait(100);

    // 透传 onBarAnchorsChange：恰好 1 次，且与 planBarSlots(10,540,7) 逐值相等。
    expect(calls.length).toBe(1);
    const anchors = calls[0];
    expect(anchors).toHaveLength(7);
    const expected = anchors7();
    for (let k = 0; k < expected.length; k++) {
      expect(anchors[k].bar).toBe(expected[k].bar);
      expect(anchors[k].x0).toBe(expected[k].x0);
      expect(anchors[k].x1).toBe(expected[k].x1);
    }

    // 透传 playheadPosition：覆盖层存在且 left 逐值正确（meter=4/4 → fraction=0.5）。
    const lead = h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]');
    expect(lead).not.toBeNull();
    const a2 = expected[1];
    const expectedLeft = a2.x0 + ((3 - 1) / 4) * (a2.x1 - a2.x0);
    expect(parseFloat(lead!.style.left)).toBe(expectedLeft);

    // layout memo 化：仅改变无关 prop（collisions）触发 ScorePanel 重渲染，
    // rendererLayout 身份应保持稳定 → ScoreRenderer 渲染 effect 不重跑 → svg 节点不变。
    const svgBefore = h.container.querySelector("svg");
    expect(svgBefore).not.toBeNull();
    h.rerender(
      build([
        {
          type: "symbol_overlap",
          staveIndex: 0,
          bar: 1,
          beat: 1,
          description: "x",
          severity: "warning",
          fixSuggestion: "y",
        },
      ]),
    );
    await wait(150);

    expect(h.container.querySelector("svg")).toBe(svgBefore);
    expect(calls.length).toBe(1);

    h.unmount();
  });
});
