/**
 * ScoreRenderer 真实渲染测试（v2.3.0 S4b：D34-4 收口 + D34-5 高度断言）。
 *
 * 背景（v2.3.0 侦察 F6）：本文件原 7 条用例**全部**只调
 * `React.createElement(ScoreRenderer, props)` 后断言「不抛错」——组件根本没挂载，
 * 谱面渲染路径**零有效覆盖**（其中名为
 * "renders correct number of staves from layout config" 的用例什么都没测）。
 *
 * 本版改为**真实渲染**（jsdom + vexflow 5 SVG 后端；无 @testing-library/react，
 * 手写 createRoot + act，样板照抄 ScoreRenderer.anchors.test.tsx）：
 *   T58a 空音符 → 真实渲染出 svg（不再只 createElement）。
 *   T58b 有音符 → svg 渲染成功；onBarAnchorsChange 上报 renderBars 个锚点、bar 递增、
 *        x0 严格递增（全序断言）。
 *   T58c 谱表数真实生效 → 1 谱表 vs 2 谱表的覆盖层基准高之差 == 140
 *        （差值断言，不硬编码基数）。
 *   T58d scale 真实生效 → 画布 inline transform === "scale(0.5)"；且 scale=2 时基准高
 *        恰为 scale=1 的两倍（**D34-5 的「scale ≠ 1 高度断言」**）。
 *   T58e 覆盖层高度去启发式 → `.rendererStack` 显式设高（解析式 totalHeight × scale）；
 *        覆盖层 `.layer` 自身**不再**内联 height（旧写法的 `scale===1 ? '100%'
 *        : `${scale*100}%`` 是死分支 + 相对 `min-height:100%` 的启发式，已删）。
 *   T58f tempoMap 真实生效（米制敏感）→ 3/4 下播放头 left 用 beatsPerBarAt = 3 插值，
 *        与 4/4 的插值点可判别。
 *
 * 等待策略：动态 import 在 jsdom 下正常 resolve，用 `await vi.waitFor` 轮询至 DOM
 * 就绪（外层不再包 act，避免 act 阻塞 waitFor 的轮询）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TempoMap } from "@collinx/core";
import { ScoreRenderer, computeStaveWidth } from "../ScoreRenderer";
import type { ScoreRendererLayout } from "../ScoreRenderer";
import type { BarAnchor } from "../bar-anchors";
import type { NoteEvent } from "@collinx/core";

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

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** 覆盖层基准层（`.rendererStack`）的显式高度（px）。 */
function stackHeight(container: HTMLElement): number {
  const el = container.querySelector<HTMLElement>('[data-testid="score-renderer-stack"]');
  expect(el).not.toBeNull();
  const raw = el!.style.height;
  expect(raw).toMatch(/^\d+(\.\d+)?px$/);
  return Number.parseFloat(raw);
}

const twoStaffLayout: ScoreRendererLayout = {
  staffConfig: [
    { clef: "treble", name: "Treble", bars: 4 },
    { clef: "bass", name: "Bass", bars: 4 },
  ],
};

/** 单谱表（唯一差异：staffConfig 长度 1 vs 2）——用于 T58c 的差值断言。 */
const oneStaffLayout: ScoreRendererLayout = {
  staffConfig: [{ clef: "treble", name: "Treble", bars: 4 }],
};

/**
 * 48 小节双谱表（用户实测的「导出 48 小节，谱面只有 4 个区」场景）。
 * 每行最多 8 小节 → 6 个系统；2 谱表 × 140px 节距 → 画布高 6×280+20。
 */
const fortyEightBarLayout: ScoreRendererLayout = {
  staffConfig: [
    { clef: "treble", name: "Treble", bars: 48 },
    { clef: "bass", name: "Bass", bars: 48 },
  ],
};

/**
 * 每个谱表占的纵向节距 = STAVE_HEIGHT(120) + STAVE_GAP(20)，见
 * `ScoreRenderer.tsx` 顶部常量（`STAVE_HEIGHT = 120`、`STAVE_GAP = 20`）。
 * 基准高公式 = 谱表数 × 节距 + 20（尾部留白）——故 1 vs 2 谱表的**差**恰为一个节距，
 * 与尾部留白无关（这正是用差值而非绝对值的原因：不引入夹具基数）。
 */
const PER_STAVE_PITCH = 120 + 20;

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: overrides.id ?? "note-001",
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

/** 等真实渲染完成（svg 出现在画布容器内）。 */
async function waitForSvg(container: HTMLElement) {
  await vi.waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), {
    timeout: 5000,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ScoreRenderer 真实渲染 (S4b · D34-4)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  it("T58a: 空音符 → 真实渲染出 svg（非仅 createElement） (critical)", async () => {
    const h = mount(<ScoreRenderer notes={[]} layout={twoStaffLayout} />);
    await waitForSvg(h.container);
    const svg = h.container.querySelector("svg");
    expect(svg).not.toBeNull();
    // 画布容器内确有内容（vexflow 渲染过，而非空壳）。
    expect(svg!.childNodes.length).toBeGreaterThan(0);
    h.cleanup();
  });

  it("T58b: 有音符 → 渲染成功 + onBarAnchorsChange 上报 4 锚点且 x0 严格递增 (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const notes = [
      makeNote({ id: "n1", pitchMidi: 60, bar: 1, beat: 1 }),
      makeNote({ id: "n2", pitchMidi: 62, bar: 1, beat: 2 }),
      makeNote({ id: "n3", pitchMidi: 48, bar: 1, beat: 1 }),
    ];
    const h = mount(
      <ScoreRenderer
        notes={notes}
        layout={twoStaffLayout}
        onBarAnchorsChange={(a) => calls.push(a)}
      />
    );
    await waitForSvg(h.container);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    const anchors = calls[calls.length - 1];
    // 4 小节（bars=4 且 max(…, 4) = 4）。
    expect(anchors).toHaveLength(4);
    for (let k = 0; k < anchors.length; k++) {
      expect(anchors[k].bar).toBe(k + 1);
      expect(anchors[k].x1).toBeGreaterThan(anchors[k].x0);
      if (k > 0) {
        // 全序：x0 严格递增（数量断言对塌缩/乱序视而不见，故必须断言全序）。
        expect(anchors[k].x0).toBeGreaterThan(anchors[k - 1].x0);
      }
    }
    h.cleanup();
  });

  it("T58c: 谱表数真实生效 → 1 vs 2 谱表的覆盖层基准高之差 == 一个谱表节距 (critical)", async () => {
    const h1 = mount(<ScoreRenderer notes={[]} layout={oneStaffLayout} />);
    const h2 = mount(<ScoreRenderer notes={[]} layout={twoStaffLayout} />);
    await waitForSvg(h1.container);
    await waitForSvg(h2.container);

    const stack1 = stackHeight(h1.container);
    const stack2 = stackHeight(h2.container);
    expect(stack1).toBeGreaterThan(0);
    // 差 = 1 × 谱表节距；尾部留白被差值消掉 → 无夹具基数。
    expect(stack2 - stack1).toBe(PER_STAVE_PITCH);
    // 负控式核对：若谱表数被忽略，两者会相等（即差值 0）→ 上面断言必红。
    expect(stack2).not.toBe(stack1);

    h1.cleanup();
    h2.cleanup();
  });

  it("T58d: scale 真实生效——画布 transform === scale(0.5)，且 scale=2 基准高 == 2 × scale=1 (critical)", async () => {
    const h05 = mount(<ScoreRenderer notes={[]} layout={twoStaffLayout} scale={0.5} />);
    await waitForSvg(h05.container);
    // 画布容器 = 基准层的第一个子 div（结构定位，不依赖 CSS module 的类名形态）。
    const canvas = h05.container.querySelector<HTMLElement>(
      '[data-testid="score-renderer-stack"] > div'
    );
    expect(canvas).not.toBeNull();
    expect(canvas!.style.transform).toBe("scale(0.5)");
    h05.cleanup();

    // D34-5 的「scale ≠ 1 高度断言」：基准高必须随 scale 线性变化（比值断言，无夹具）。
    const h1 = mount(<ScoreRenderer notes={[]} layout={twoStaffLayout} scale={1} />);
    const h2 = mount(<ScoreRenderer notes={[]} layout={twoStaffLayout} scale={2} />);
    await waitForSvg(h1.container);
    await waitForSvg(h2.container);
    const base = stackHeight(h1.container);
    const doubled = stackHeight(h2.container);
    expect(base).toBeGreaterThan(0);
    expect(doubled).toBe(base * 2);
    h1.cleanup();
    h2.cleanup();
  });

  it("T58e: 覆盖层高度去启发式——基准层显式设高，覆盖层自身不再内联 height (critical)", async () => {
    const h = mount(
      <ScoreRenderer
        notes={[]}
        layout={twoStaffLayout}
        playheadPosition={{ bar: 1, beat: 2 }}
      />
    );
    await waitForSvg(h.container);

    // 基准层：解析式高度（totalHeight × scale，scale=1）。
    const stack = h.container.querySelector<HTMLElement>(
      '[data-testid="score-renderer-stack"]'
    );
    expect(stack).not.toBeNull();
    expect(stack!.style.height).toBe(`${stackHeight(h.container)}px`);

    // 覆盖层：必须已渲染，且**不得**再带内联 height（旧写法的
    // `scale===1 ? '100%' : `${scale*100}%`` 死分支已删；高度改由 CSS
    // `.layer { top:0; bottom:0 }` 撑满基准层）。
    await vi.waitFor(
      () => expect(h.container.querySelector('[data-testid="score-playhead-layer"]')).not.toBeNull(),
      { timeout: 5000 }
    );
    const layer = h.container.querySelector<HTMLElement>(
      '[data-testid="score-playhead-layer"]'
    );
    expect(layer!.style.height).toBe("");

    h.cleanup();
  });

  it("T58f: tempoMap 真实生效（米制敏感）→ 3/4 下播放头 left 按 beatsPerBar = 3 插值 (critical)", async () => {
    const captured: BarAnchor[][] = [];
    const h = mount(
      <ScoreRenderer
        notes={[]}
        layout={twoStaffLayout}
        tempoMap={new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }])}
        playheadPosition={{ bar: 1, beat: 2 }}
        onBarAnchorsChange={(a) => captured.push(a)}
      />
    );
    await waitForSvg(h.container);
    await vi.waitFor(() => expect(captured.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });
    await vi.waitFor(
      () => expect(h.container.querySelector('[data-testid="score-playhead"]')).not.toBeNull(),
      { timeout: 5000 }
    );

    const a1 = captured[captured.length - 1][0];
    expect(a1.bar).toBe(1);
    const left = Number.parseFloat(
      h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]')!.style.left
    );

    // 3/4 → beatsPerBarAt = 3 × 4 / 4 = 3 → fraction = (2 − 1) / 3。
    const expected34 = a1.x0 + ((2 - 1) / 3) * (a1.x1 - a1.x0);
    expect(Math.abs(left - expected34)).toBeLessThan(1e-6);

    // 判别性：4/4 的插值点（fraction = 1/4）必须与 3/4 不同 → 证明用的是真实拍号，
    // 而非「恒 4」的回落值。
    const expected44 = a1.x0 + ((2 - 1) / 4) * (a1.x1 - a1.x0);
    expect(Math.abs(expected34 - expected44)).toBeGreaterThan(1e-6);
    expect(Math.abs(left - expected44)).toBeGreaterThan(1e-6);

    h.cleanup();
  });

  it("T58g: 48 小节 → 48 个锚点覆盖 1..48、分 6 个系统、每小节宽度不再被压缩 (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const h = mount(
      <ScoreRenderer
        notes={[]}
        layout={fortyEightBarLayout}
        onBarAnchorsChange={(a) => calls.push(a)}
      />
    );
    await waitForSvg(h.container);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    const anchors = calls[calls.length - 1];
    // 数量与全序：48 小节一个不少（旧实现只有 4 个）。
    expect(anchors).toHaveLength(48);
    expect(anchors.map((a) => a.bar)).toEqual(
      Array.from({ length: 48 }, (_, i) => i + 1),
    );

    // 每小节宽度 = 可分配宽 / 每行 8 小节；旧实现固定 550px 谱表 → 67.5px/8，且被压到 11.25px/48
    // （11px 连一个小节线间距都放不下，等于不可读）。
    const barWidth = (computeStaveWidth(8) - 10) / 8;
    for (const a of anchors) {
      expect(a.x1 - a.x0).toBeCloseTo(barWidth, 9);
    }
    expect(barWidth).toBeGreaterThan(60);

    // 6 个系统（行）：每 8 小节换行，纵向按「2 谱表 × 140px 节距」堆叠。
    expect(new Set(anchors.map((a) => a.y)).size).toBe(6);
    expect(anchors[0].y).toBe(0);
    expect(anchors[7].y).toBe(0);
    expect(anchors[8].y).toBe(PER_STAVE_PITCH * 2);
    expect(anchors[47].y).toBe(PER_STAVE_PITCH * 2 * 5);

    // 画布高随系统数增长：6 系统 × 2 谱表 × 140 + 20。
    expect(stackHeight(h.container)).toBe(6 * 2 * PER_STAVE_PITCH + 20);

    // 同一系统内 x0 递增（行内连续），跨行则回到行首 —— 这两点共同证明「换行而非压缩」。
    expect(anchors[1].x0).toBeGreaterThan(anchors[0].x0);
    expect(anchors[8].x0).toBeCloseTo(anchors[0].x0, 9);

    h.cleanup();
  });

  it("T58h: startBar 生效（分页第 2 页）→ 锚点从第 41 小节起，x 从行首重新开始 (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const h = mount(
      <ScoreRenderer
        notes={[]}
        layout={{
          staffConfig: [
            { clef: "treble", name: "Treble", bars: 8 },
            { clef: "bass", name: "Bass", bars: 8 },
          ],
        }}
        startBar={41}
        onBarAnchorsChange={(a) => calls.push(a)}
      />
    );
    await waitForSvg(h.container);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    const anchors = calls[calls.length - 1];
    expect(anchors.map((a) => a.bar)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
    // 单系统页面不带纵向字段（锚点形状与改动前一致）。
    expect(anchors[0].y).toBeUndefined();
    expect(stackHeight(h.container)).toBe(2 * PER_STAVE_PITCH + 20);

    h.cleanup();
  });

  it("is a function component", () => {
    expect(typeof ScoreRenderer).toBe("function");
  });
});

// ── v2.9.6：同拍音符必须聚成一个和弦 StaveNote ───────────────────────────
// 旧实现每音一个 StaveNote：三和弦（3 个 beat=1/durQn=4 的音）被画成
// 3 个连续全音符 —— 一小节塞 12 拍，记谱不成立（v2.9.5 点击会话实锤）。
// 判据：**符干数**（.vf-stem）—— 和弦 3 个音共 1 条符干；散排则是 3 条。
// 注意全音符没有符干，所以这里用二分音符（durQn=2）。
describe("v2.9.6 同拍聚合（和弦记谱）", () => {
  it("同小节同拍同值的 3 个音 → 3 个符头 + 1 条符干（和弦），不是 3 条符干", async () => {
    const notes = [
      makeNote({ id: "c1", pitchMidi: 57, pitchSpelling: "A3", bar: 1, beat: 1, durQn: 2 }),
      makeNote({ id: "c2", pitchMidi: 60, pitchSpelling: "C4", bar: 1, beat: 1, durQn: 2 }),
      makeNote({ id: "c3", pitchMidi: 64, pitchSpelling: "E4", bar: 1, beat: 1, durQn: 2 }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={twoStaffLayout} />);
    await waitForSvg(h.container);

    const svg = h.container.querySelector("svg")!;
    // 作用域收敛到**单个 StaveNote 组**：全 svg 查询会把其它小节/谱表的元素
    // 一并算进来（空小节休止符等），断言会随内容漂移。
    const chordGroup = Array.from(svg.querySelectorAll(".vf-stavenote")).find(
      (g) => g.querySelectorAll(".vf-notehead").length === 3,
    );
    expect(chordGroup).toBeDefined();
    expect(chordGroup!.querySelectorAll(".vf-stem")).toHaveLength(1);
    h.cleanup();
  });

  it("和弦整体落在同一个谱表（A3/C4/E4 → 低音谱表）", async () => {
    const notes = [
      makeNote({ id: "c1", pitchMidi: 57, pitchSpelling: "A3", bar: 1, beat: 1, durQn: 2 }),
      makeNote({ id: "c2", pitchMidi: 60, pitchSpelling: "C4", bar: 1, beat: 1, durQn: 2 }),
      makeNote({ id: "c3", pitchMidi: 64, pitchSpelling: "E4", bar: 1, beat: 1, durQn: 2 }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={twoStaffLayout} />);
    await waitForSvg(h.container);

    // jsdom 不做布局（getBoundingClientRect 恒 0），改读 SVG **属性坐标**：
    // 符干 y 坐标落在低音谱表区（staffIdx=1 → yOffset = 140+30 = 170 起）。
    const stems = Array.from(
      h.container.querySelectorAll("svg .vf-stem"),
    ) as SVGElement[];
    expect(stems).toHaveLength(1);
    // 符干是 <g class="vf-stem"><path d="M x y L x y"/></g> —— 坐标在 path 的
    // d 属性里（VexFlow5 不写 y1/y2 属性）。低音谱表纵向起点 =
    // staffIdx×(120+20)+30 = 170；符干必须落在这个区域（>150 即排除高音谱表）。
    const d = stems[0]!.querySelector("path")?.getAttribute("d") ?? "";
    const ys = Array.from(d.matchAll(/[ML]\s*[-\d.]+\s+([-\d.]+)/g)).map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThanOrEqual(2);
    for (const y of ys) expect(y).toBeGreaterThan(150);
    h.cleanup();
  });
});
