/**
 * v2.3.0 Stage 4a（D34-1 / D34-2(T55) / D34-6）：App 级米制敏感集成护栏 +
 * 「layout.staffConfig 引用稳定」循环防护。
 *
 * 核心验收意图：
 *  1. 证明「改拍号 → 谱面点击反演出的 beat」端到端贯通（App 真实链路：
 *     TransportBar 拍号控件 → store → 派生 TempoMap → ScorePanel → ScoreRenderer
 *     → barBeatFromX → onSeek → transport.seek → TransportBar 位置显示）。
 *  2. 证明该链路**米制敏感**：同一点击落点、3/4 与 4/4 给出不同 beat。若 App 未把
 *     tempoMap 接到 ScorePanel（ScoreRenderer 回落 4/4），3/4 用例会得 4/4 的结果 →
 *     本文件变红（语义断言失败，而非编译/超时）。
 *  3. D34-6：以真实 ScorePanel + 父级 useState 接收锚点的 harness，证明锚点上报表
 *     现「不可自触发」——回调次数上界 = 内容变化次数（内容不变时不随渲染轮数增长）。
 *
 * harness 完全照抄既有 App 级先例（app-integration.test.tsx:41-71 / v200-stage1.test.tsx）：
 *   I18nProvider + SettingsProvider + ThemeProvider + ProjectProvider + 真 <App />，
 *   matchMedia / ResizeObserver / scrollIntoView 桩，createRoot + act 手写渲染。
 *
 * 点击落点 x 的取得方式：先挂载一次真实 ScoreRenderer（layout 与 App 等价），从
 *   onBarAnchorsChange 拿到锚点数组，取第 2 小节（anchors[1]）区间并按比例定位。
 *   jsdom 里 getBoundingClientRect() 全 0，故 ScoreRenderer 的
 *   localX = (clientX - rect.left)/scale + scrollLeft 退化为 clientX（scale=1、
 *   scrollLeft=0）——可用 clientX 精确指定落点。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Layout, NoteEvent } from "@collinx/core";
import { TempoMap } from "@collinx/core";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { ScoreRenderer } from "../components/Score/ScoreRenderer";
import type { ScoreRendererLayout } from "../components/Score/ScoreRenderer";
import { ScorePanel } from "../components/Score/ScorePanel";
import { createDefaultLayout, createDemoNotes, defaultHouseStyle, demoPhrases } from "../data/demoData";
import type { BarAnchor } from "../components/Score/bar-anchors";

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/**
 * App 里的 defaultLayout 现在按**工程实际小节数**创建（此前内部硬编码 4，导致
 * 48 小节工程只画出前 4 小节）。App 的 totalBars = max(16, 最深音符小节, 最深乐句
 * endBar)，示例工程即 16。锚点捕获必须用同一小节数，否则点到的 x 会落在别的
 * 小节上（夹具与 App 不同源 → 断言失去意义）。
 */
const APP_TOTAL_BARS = Math.max(
  16,
  ...createDemoNotes().map((n) => n.bar),
  ...demoPhrases.map((p) => p.endBar),
);
/** 谱面覆盖的小节数（= App 的 totalBars，下限 4）。 */
const EXPECTED_BARS = APP_TOTAL_BARS;
/**
 * 点击在小节内的相对位置。取 0.6（而非 0.5）是**刻意**的：0.5 恰好落在 4/4 下
 * beat=3.0 的 floor 边界上，浮点舍入可能使 floor 得到 2（伪红）。0.6 使两种拍号
 * 的结果都远离整数边界：
 *   3/4 → beat = 1 + 0.6*3 = 2.8 → floor 2 → "m2.2"
 *   4/4 → beat = 1 + 0.6*4 = 3.4 → floor 3 → "m2.3"
 * 判别性不变（同落点、两种拍号 → 不同 beat）。
 */
const CLICK_FRACTION = 0.6;

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
    rerender(next: React.ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <ThemeProvider>
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
      </I18nProvider>
    );
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

const q = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-testid="${id}"]`);

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 切到 ScorePanel 的「渲染视图」（默认 data 视图不挂载 ScoreRenderer）。 */
function clickRenderedView(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    /Rendered View|渲染视图/.test(b.textContent ?? "")
  );
  expect(btn).toBeTruthy();
  act(() => {
    btn!.click();
  });
}

/** 与 App 内 ScorePanel 等价的 rendererLayout（staffConfig 几何与 notes 无关）。 */
function appEquivalentRendererLayout(): ScoreRendererLayout {
  return {
    staffConfig: (createDefaultLayout(APP_TOTAL_BARS).staffConfig ?? []).map((s) => ({
      clef: s.clef as "treble" | "bass",
      name: s.name,
      bars: s.bars,
    })),
    notationSize: defaultHouseStyle.notationSize,
  };
}

/**
 * 挂载一次真实 ScoreRenderer，取回与 App 内一致的小节锚点。
 * 锚点几何只取决于 layout.staffConfig 与 ScoreRenderer 内部常量，与 notes 无关。
 */
async function captureAnchors(): Promise<BarAnchor[]> {
  let captured: BarAnchor[] | null = null;
  const h = mount(
    <ScoreRenderer
      notes={[]}
      layout={appEquivalentRendererLayout()}
      onBarAnchorsChange={(a) => {
        captured = a;
      }}
    />
  );
  await vi.waitFor(() => expect(captured).not.toBeNull(), { timeout: 5000 });
  const anchors = captured!;
  h.unmount();
  return anchors;
}

/** 第 2 小节区间内的点击 x（未缩放内容坐标；jsdom 下 == clientX）。 */
function clickXInBar2(anchors: BarAnchor[]): number {
  const a2 = anchors[1];
  expect(a2.bar).toBe(2);
  const x = a2.x0 + CLICK_FRACTION * (a2.x1 - a2.x0);
  expect(x).toBeGreaterThan(a2.x0);
  expect(x).toBeLessThan(a2.x1);
  return x;
}

/** 在 App 的 score 标签页谱面上按 x 派发一次真实 click（冒泡到 onSeek 所在容器）。 */
function clickScoreAt(container: HTMLElement, x: number) {
  const svg = container.querySelector('[data-testid="score-panel"] svg');
  expect(svg).not.toBeNull();
  act(() => {
    svg!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 0,
      })
    );
  });
}

/** Stubs the browser APIs jsdom lacks so the real App renders under vitest. */
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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

/** 驱动 App 走到「score 标签页 + 渲染视图已挂载 + 锚点就绪」的状态。 */
async function openRenderedScore(container: HTMLElement) {
  click(q(container, "tab-score"));
  expect(q(container, "score-panel")).not.toBeNull();
  clickRenderedView(container);
  await vi.waitFor(() => expect(container.querySelector('[data-testid="score-panel"] svg')).not.toBeNull(), {
    timeout: 5000,
  });
  // 播放头 DOM 只有在 anchors 已 setState 后才会出现（bar 1 锚点存在）→ 作为锚点就绪的同步点。
  await vi.waitFor(() => expect(q(container, "score-playhead")).not.toBeNull(), {
    timeout: 5000,
  });
}

// ---------------------------------------------------------------------------
// D34-1 / D34-2 (T55)：App 级米制敏感集成护栏
// ---------------------------------------------------------------------------

describe("v2.3.0 S4a (D34-1/D34-2 T55) App 级谱面点击 → beat 米制敏感贯通", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T55a: 拍号 3/4 → 谱面第 2 小节同一落点点击 → transport 位置显示 m2.2 (critical)", async () => {
    const anchors = await captureAnchors();
    expect(anchors).toHaveLength(EXPECTED_BARS);
    const clickX = clickXInBar2(anchors);

    const { container, cleanup } = renderApp();

    // compose 标签页：把拍号改成 3/4（真实控件 → store → 派生 TempoMap）。
    const sel = q(container, "transport-meter") as HTMLSelectElement;
    expect(sel).not.toBeNull();
    act(() => {
      sel.value = "3/4";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((q(container, "transport-meter") as HTMLSelectElement).value).toBe("3/4");

    // 切到 score 标签页并挂载渲染视图。
    await openRenderedScore(container);

    // 点击落点 → onSeek → transport.seek。
    clickScoreAt(container, clickX);

    // 回到 compose，读取位置显示（3/4：beat = 1 + 0.6*3 = 2.8 → floor 2）。
    click(q(container, "tab-compose"));
    expect(q(container, "transport-bar-beat")?.textContent).toBe("m2.2");

    cleanup();
  });

  it("T55b: 拍号 4/4（对照）→ 同一落点点击 → transport 位置显示 m2.3 (critical)", async () => {
    const anchors = await captureAnchors();
    const clickX = clickXInBar2(anchors);

    // 不修改拍号（store 默认 bar1/4-4）。
    const { container, cleanup } = renderApp();
    expect((q(container, "transport-meter") as HTMLSelectElement).value).toBe("4/4");

    await openRenderedScore(container);
    clickScoreAt(container, clickX);

    click(q(container, "tab-compose"));
    // 4/4：beat = 1 + 0.6*4 = 3.4 → floor 3。
    expect(q(container, "transport-bar-beat")?.textContent).toBe("m2.3");

    cleanup();
  });

  it("T55c: 同落点、两拍号给出不同 beat（判别性）——防「隐式覆盖」退化为恒真 (critical)", async () => {
    const anchors = await captureAnchors();
    const clickX = clickXInBar2(anchors);

    // 独立复算预期 beat，确认两拍号的目标值本身不同（否则下面的「不等」会恒真）。
    const expected34 = 1 + CLICK_FRACTION * 3;
    const expected44 = 1 + CLICK_FRACTION * 4;
    expect(Math.floor(expected34)).toBe(2);
    expect(Math.floor(expected44)).toBe(3);

    // 组件级直接挂载真实 ScorePanel，断言 onSeek 收到的 beat 与拍号一致。
    const runPanelSeek = async (tempoMap: TempoMap | undefined) => {
      let seeked: { bar: number; beat: number } | null = null;
      const layout: Layout = {
        id: "s4a-layout",
        name: "S4a Layout",
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
        staffConfig: [{ clef: "treble", name: "Treble", bars: EXPECTED_BARS }],
      };
      const h = mount(
        <I18nProvider>
          <ScorePanel
            layout={layout}
            notes={[]}
            compact
            tempoMap={tempoMap}
            playheadPosition={{ bar: 1, beat: 1 }}
            onSeek={(p) => {
              seeked = p;
            }}
          />
        </I18nProvider>
      );
      clickRenderedView(h.container);
      await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), {
        timeout: 5000,
      });
      await vi.waitFor(() => expect(h.container.querySelector('[data-testid="score-playhead"]')).not.toBeNull(), {
        timeout: 5000,
      });
      act(() => {
        h.container.querySelector("svg")!.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: clickX,
            clientY: 0,
          })
        );
      });
      expect(seeked).not.toBeNull();
      const pos = seeked as unknown as { bar: number; beat: number };
      h.unmount();
      return pos;
    };

    const pos34 = await runPanelSeek(
      new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }])
    );
    const pos44 = await runPanelSeek(undefined); // 缺省 → ScoreRenderer 回落 4/4。

    expect(pos34.bar).toBe(2);
    expect(Math.floor(pos34.beat)).toBe(2);
    // 缺省（回落 4/4）与显式 4/4 等价，且与 3/4 判别不同 → 证明 tempoMap 未被忽略。
    expect(Math.floor(pos44.beat)).toBe(3);
    expect(Math.floor(pos34.beat)).not.toBe(Math.floor(pos44.beat));
  });
});

// ---------------------------------------------------------------------------
// D34-6：引用稳定前提下的锚点上报循环防护（真实 ScorePanel + 父级 useState）
// ---------------------------------------------------------------------------

/** 稳定引用：模块常量，跨渲染身份不变（模拟 App 的 defaultLayout）。 */
const LOOP_LAYOUT: Layout = {
  id: "s4a-loop",
  name: "S4a Loop Layout",
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
  staffConfig: [
    { clef: "treble", name: "Treble", bars: 4 },
    { clef: "bass", name: "Bass", bars: 4 },
  ],
};

const LOOP_NOTES: NoteEvent[] = [
  {
    id: "l1",
    trackId: "melody",
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1,
    pitchMidi: 60,
    pitchSpelling: "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
  },
];

/**
 * 循环防护 harness：父级用 useState 接收锚点（模拟「锚点 setState → 重渲染」路径），
 * 并由外部以不断变换的 `bump` 驱动若干轮父级重渲染。layout 用模块常量（稳定引用）
 * → rendererLayout memo 命中 → ScoreRenderer 渲染 effect 不重跑 → 不产生新回调。
 */
const LoopGuardHarness: React.FC<{
  onAnchors: (a: BarAnchor[]) => void;
  bump: number;
}> = ({ onAnchors, bump }) => {
  void bump; // 仅借 bump 制造父级重渲染（不参与几何/身份）。
  const [, setAnchors] = useState<BarAnchor[]>([]);

  return (
    <I18nProvider>
      <ScorePanel
        layout={LOOP_LAYOUT}
        notes={LOOP_NOTES}
        compact
        playheadPosition={{ bar: 2, beat: 3 }}
        onBarAnchorsChange={(a) => {
          onAnchors(a);
          setAnchors(a);
        }}
      />
    </I18nProvider>
  );
};

describe("v2.3.0 S4a (D34-6) 锚点上报循环防护（真实 ScorePanel + 稳定 layout 引用）", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T59: 多轮父级重渲染下锚点回调上界 = 内容变化次数（恰好 1 次，不随渲染轮数增长） (critical)", async () => {
    const calls: BarAnchor[][] = [];
    const build = (bump: number) => (
      <LoopGuardHarness bump={bump} onAnchors={(a) => calls.push(a)} />
    );
    const h = mount(build(0));

    clickRenderedView(h.container);
    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    // 观测窗口：自触发循环会在此窗口内线性增长（S0 实测 300ms 内 15 次）。
    await wait(200);
    expect(calls.length).toBe(1);

    // 稳定 layout 引用 → 渲染 effect 不重跑 → svg DOM 节点保持不变。
    const svgBefore = h.container.querySelector("svg");
    expect(svgBefore).not.toBeNull();

    // 多轮父级重渲染（每次换新 onAnchors 身份 + bump）。内容未变 → 不得产生新回调。
    for (let k = 1; k <= 12; k++) {
      h.rerender(build(k));
    }
    await wait(200);

    // 渲染轮数已推进 12 次，回调次数不变（上界 == 内容变化次数 1）。
    expect(calls.length).toBe(1);
    // 同一 DOM 节点：证明渲染 effect 未重跑（未清空重绘）。
    expect(h.container.querySelector("svg")).toBe(svgBefore);

    // 内容正确（防「一次但为空」假绿）：4 个单调递增的小节锚点。
    const anchors = calls[0];
    expect(anchors).toHaveLength(4);
    expect(anchors[0].bar).toBe(1);
    expect(anchors[1].bar).toBe(2);
    for (let k = 1; k < anchors.length; k++) {
      expect(anchors[k].x0).toBeGreaterThan(anchors[k - 1].x0);
    }

    h.unmount();
  });
});
