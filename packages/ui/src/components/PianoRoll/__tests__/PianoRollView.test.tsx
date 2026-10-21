import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteEvent } from "@collinx/core";
import { PianoRollView } from "../PianoRollView";
import {
  // v2.0.0 S5 (D5-1 / T24)：录制型 canvas ctx 已抽到共享模块（原此处内联定义，
  // 与 MidiInputLoop.test.tsx 的两份逐字节重复）。行为等价是硬约束——S1-T09 的
  // 388 条 golden 逐字节比对会捕获任何录制行为差异。
  createRecordingCtx,
  createRecordedCanvas,
  type DrawCall,
} from "../../../test-utils/canvas-ctx";
// v2.0.0 Stage 1 (T09): 改动前（v1.29）仅给 cursorPosition 时的完整绘制调用序列
// golden（由未含 playhead 分支的实现录制）；用于证明新增 playhead 分支在
// playheadPosition===undefined 时逐字节零行为变化。
import cursorOnlyGolden from "./fixtures/pianoRollDrawCalls.cursorOnly.json";

describe("PianoRollView", () => {
  const emptyNotes: NoteEvent[] = [];
  const defaultProps = {
    notes: emptyNotes,
    tempoMap: {
      bpmAt: () => 120,
      meterAt: () => ({ numerator: 4, denominator: 4 }),
      keyAt: () => ({ tonic: "C", mode: "major" }),
      timeAt: () => 0,
      barBeatAt: () => ({ bar: 1, beat: 1 }),
      getBarsDuration: () => 16,
      getTotalSeconds: () => 60,
    } as any,
    viewRange: { startBar: 1, endBar: 16 },
  };

  it("renders without crashing with empty notes", () => {
    expect(() => {
      React.createElement(PianoRollView, defaultProps);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PianoRollView).toBe("function");
  });

  it("accepts optional callbacks without crashing", () => {
    const props = {
      ...defaultProps,
      onNoteAdd: () => {},
      onNoteMove: () => {},
      onNoteResize: () => {},
      onNoteDelete: () => {},
      onNoteSelect: () => {},
      selectedNoteIds: [],
    };
    expect(() => {
      React.createElement(PianoRollView, props);
    }).not.toThrow();
  });

  it("accepts height prop", () => {
    expect(() => {
      React.createElement(PianoRollView, { ...defaultProps, height: 400 });
    }).not.toThrow();
  });

  it("does not throw with notes containing data", () => {
    const notes = [
      {
        id: "n1",
        trackId: "t1",
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
    expect(() => {
      React.createElement(PianoRollView, { ...defaultProps, notes });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// v1.27.0 Stage 0（S0-T01 ~ S0-T04）：录入光标可视化 + 量化细分线 draw-call 断言。
//
// 既有 5 用例只做 React.createElement 冒烟、不渲染，jsdom 无真实 canvas，
// 全仓无现成 canvas 断言基建。本 describe 新建最小 harness：
//   1. ResizeObserver stub（先例：src/__tests__/app-integration.test.tsx:118）；
//   2. vi.spyOn(HTMLCanvasElement.prototype, "getContext") 返回 Proxy 包装的
//      记录型 ctx：方法调用记为 {op, args}，属性赋值记为 {op:"set:<prop>"}；
//   3. createRoot + act 真渲染触发 drawCanvas，对调用序列断言。
// 约束：不使用 @testing-library/react（任务要求）。
// ---------------------------------------------------------------------------

// v2.0.0 S5 (D5-1 / T24)：`DrawCall` 与 `createRecordingCtx` 已抽到
// `src/test-utils/canvas-ctx.ts` 共享（见文件头 import）。此处原为内联定义。

describe("PianoRollView v1.27.0 cursor / quantize-grid draw calls", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView>;

  const tempoMapStub = {
    bpmAt: () => 120,
    meterAt: () => ({ numerator: 4, denominator: 4 }),
    keyAt: () => ({ tonic: "C", mode: "major" }),
    timeAt: () => 0,
    barBeatAt: () => ({ bar: 1, beat: 1 }),
    getBarsDuration: () => 16,
    getTotalSeconds: () => 60,
  } as any;

  const baseProps: ViewProps = {
    notes: [],
    tempoMap: tempoMapStub,
    viewRange: { startBar: 1, endBar: 16 },
  };

  // 默认 canvasSize = { width: 800, height: 600 }（组件 useState 初值，
  // ResizeObserver stub 不触发回调，保持默认值）。
  const CANVAS_H = 600;

  const { ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn } = createRecordedCanvas();
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function renderView(props: ViewProps): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(React.createElement(PianoRollView, props));
    });
    return container;
  }

  function clickZoomIn(el: HTMLElement) {
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  /** 竖线绘制集合：moveTo(x, 0) + lineTo(x, h) 的 x 值序列（网格线/cursor 竖线共用此模式）。 */
  function verticalLineXs(): number[] {
    const xs: number[] = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        calls[i + 1]?.op === "lineTo" &&
        calls[i + 1].args[0] === c.args[0] &&
        calls[i + 1].args[1] === CANVAS_H
      ) {
        xs.push(Number(c.args[0]));
      }
    }
    return xs;
  }

  const fillTexts = (): string[] =>
    calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));

  const propSets = (name: string): unknown[] =>
    calls.filter((c) => c.op === `set:${name}`).map((c) => c.args[0]);

  const cursorLabelRe = /^m\d+\.\d+$/;

  it("S0-T01: cursorPosition 注入时绘制 accent 竖线 + m1.1 位置标签", () => {
    renderView({ ...baseProps, cursorPosition: { bar: 1, beat: 1 } });

    // cursor ticks = (1-1)*4 + (1-1) = 0 → x = 0*40 - 0 = 0，
    // 2px 线取整为 Math.round(0)+0.5-1 = -0.5（与网格线 0.5 区分）。
    expect(verticalLineXs()).toContain(-0.5);
    // 位置标签 m1.1（bar 号标签只输出纯数字 "1"，音符标签如 "C4"，均不匹配）。
    expect(fillTexts()).toContain("m1.1");
    // lineWidth 2 仅 cursor 竖线使用（网格 1/0.5，音符描边 1）。
    expect(propSets("lineWidth")).toContain(2);
  });

  it("S0-T02: 不传 cursorPosition 时无 cursor 竖线、无 m 标签、无 2px 线宽", () => {
    renderView(baseProps);

    expect(verticalLineXs()).not.toContain(-0.5);
    expect(fillTexts().some((t) => cursorLabelRe.test(t))).toBe(false);
    expect(propSets("lineWidth")).not.toContain(2);
  });

  it("S0-T03: cursorPosition bar=99 越界 viewRange(1-16) 时不绘制", () => {
    renderView({ ...baseProps, cursorPosition: { bar: 99, beat: 1 } });

    expect(verticalLineXs()).not.toContain(-0.5);
    expect(fillTexts().some((t) => cursorLabelRe.test(t))).toBe(false);
    expect(fillTexts().some((t) => t.startsWith("m99"))).toBe(false);
    expect(propSets("lineWidth")).not.toContain(2);
  });

  it("S0-T04: quantizeGridHint=0.25 密度不足(pixelsPerBeat=40, 40*0.25<12)时零绘制", () => {
    renderView({ ...baseProps, quantizeGridHint: 0.25 });

    expect(propSets("globalAlpha")).not.toContain(0.25);
    // 密度不足时不应有任何 0.25 步长的细分线（beat0 内 k=1 → x=10 → 10.5）。
    expect(verticalLineXs()).not.toContain(10.5);
  });

  it("S0-T04b: quantizeGridHint=0.25 + zoom-in 后 pixelsPerBeat=48 满足密度 → 细分线绘制", () => {
    const el = renderView({ ...baseProps, quantizeGridHint: 0.25 });
    // 40 * 1.2 = 48，48 * 0.25 = 12 >= 12 满足阈值。
    clickZoomIn(el.querySelector('[data-testid="piano-roll-zoom-in"]')!);

    expect(propSets("globalAlpha")).toContain(0.25);
    // beat0 内 k=1 细分线：sx = 0 + 1*0.25*48 = 12 → 取整 12.5。
    expect(verticalLineXs()).toContain(12.5);
    // 画完恢复 globalAlpha=1。
    const alphaSeq = propSets("globalAlpha") as number[];
    expect(alphaSeq[alphaSeq.indexOf(0.25) + 1]).toBe(1);
  });

  it("S0-T04c: quantizeGridHint=0 零行为变化（zoom 后仍无细分线）", () => {
    const el = renderView({ ...baseProps, quantizeGridHint: 0 });
    clickZoomIn(el.querySelector('[data-testid="piano-roll-zoom-in"]')!);

    expect(propSets("globalAlpha")).not.toContain(0.25);
    expect(verticalLineXs()).not.toContain(12.5);
  });
});

// ---------------------------------------------------------------------------
// v1.28.0 Stage 0（S0-T01 ~ S0-T04）：cursor 顶部倒三角图标 + autoScrollFollow
// 自动滚动跟随（if-needed 最小平移 + clamp [0, maxScrollX]）draw-call 断言。
//
// 复用模块级 createRecordingCtx；harness 与 v1.27.0 段同构（独立实例，
// 不改既有用例）。绘制顺序约定：网格线 → cursor 竖线/倒三角/标签 → 音符。
//
// harness 实态数值（组件 useState 初值 + ResizeObserver stub 不回调 →
// canvasSize 恒为初值；由下面 beforeAll/断言实测锁定）：
//   w = 800（canvasSize.width 初值）、h = 600、pixelsPerBeat = 40（初值）、
//   BEATS_PER_BAR = 4、viewRange 默认 {1,16} → totalBeats = 64。
//   右缘阈值 = w - FOLLOW_EDGE_MARGIN = 800 - 48 = 752。
//
// 登记（约束 5：以代码/harness 实态为准）：dispatch 示例按 viewRange 8 小节
// （totalBeats 32）推导 maxScrollX = 32*40-800 = 480；实际 baseProps 为
// viewRange 1-16 → totalBeats 64 → maxScrollX = 64*40-800 = 1760，且 ppb=15
// 时总宽 960 > 800（不会得到 maxScrollX=0）。故 S0-T04a 改用
// viewRange {1,5}（totalBeats 20 → 总宽 800 = w → maxScrollX = 0）构造该分支；
// S0-T04b 用默认 viewRange 构造上界钳制（2520-752=1768 → 1760）。
// ---------------------------------------------------------------------------

describe("PianoRollView v1.28.0 cursor icon / auto-scroll-follow draw calls", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView> & {
    autoScrollFollow?: boolean;
  };

  const tempoMapStub = {
    bpmAt: () => 120,
    meterAt: () => ({ numerator: 4, denominator: 4 }),
    keyAt: () => ({ tonic: "C", mode: "major" }),
    timeAt: () => 0,
    barBeatAt: () => ({ bar: 1, beat: 1 }),
    getBarsDuration: () => 16,
    getTotalSeconds: () => 60,
  } as any;

  const baseProps: ViewProps = {
    notes: [],
    tempoMap: tempoMapStub,
    viewRange: { startBar: 1, endBar: 16 },
  };

  // 默认 canvasSize = { width: 800, height: 600 }（组件 useState 初值，
  // ResizeObserver stub 不触发回调，保持默认值）。
  const CANVAS_W = 800;
  const CANVAS_H = 600;
  const PPB = 40; // pixelsPerBeat 初值（无 zoom 交互）
  const BEATS_PER_BAR = 4;
  const FOLLOW_EDGE_MARGIN = 48;
  /** 数值自检：确认 harness 实态与推导一致（失败即说明 harness 基线已变）。 */
  const RIGHT_EDGE = CANVAS_W - FOLLOW_EDGE_MARGIN; // 752

  const { ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn } = createRecordedCanvas();
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function renderView(props: ViewProps): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(React.createElement(PianoRollView, props));
    });
    return container;
  }

  function rerenderView(props: ViewProps) {
    act(() => {
      root!.render(React.createElement(PianoRollView, props));
    });
  }






  it("S0-T01: cursor 可见时绘制顶部倒三角（顶点 (x,8) / 上角 (x∓4,0)）+ 标签右移至 x+6", () => {
    // ticks = (3-1)*4 + (3-1) = 10 → cursorX = ticks*PPB - scrollX(0) = 400。
    const cursorX = 10 * PPB;
    expect(cursorX).toBe(400);

    renderView({ ...baseProps, cursorPosition: { bar: 3, beat: 3 } });
    const frame = lastFrame();

    // 实心倒三角：顶点 (400,8)、左上 (396,0)、右上 (404,0)。
    const tris = trianglesIn(frame);
    expect(tris).toHaveLength(1);
    expect(tris[0].apex).toEqual([400, 8]);
    expect(tris[0].left).toEqual([400 - 4, 0]);
    expect(tris[0].right).toEqual([400 + 4, 0]);

    // 标签 x 由 +3 右移至 +6（避让三角半宽 4px）；字号/字体/y 不变。
    const labels = cursorLabelsIn(frame);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: "m3.3", x: cursorX + 6, y: 12 });
    expect(labels[0].x).toBe(406);

    // v1.27 竖线不受影响：Math.round(400)+0.5-1 = 399.5。
    expect(verticalLineXsIn(frame)).toContain(399.5);
  });

  it("S0-T02: 默认 autoScrollFollow=false → 步进 cursorPosition 不触发滚动（网格 x 恒定）", () => {
    // 基线：无 cursor（scrollX 恒 0）→ 网格线 beat 0..20 → x = 0.5 + 40k。
    renderView(baseProps);
    const gridBaseline = verticalLineXsIn(lastFrame());
    expect(gridBaseline.length).toBeGreaterThan(0);
    expect(gridBaseline).toContain(0.5); // beat0 → 0*40 - 0
    expect(gridBaseline).not.toContain(32.5); // scrollX=48 时 beat2 才落到 32

    // 步进 cursor：全部落在画布内（cursorX ≤ w=800）以便断言竖线位置。
    const steps: { bar: number; beat: number }[] = [
      { bar: 1, beat: 1 }, // ticks 0  → x 0
      { bar: 2, beat: 2 }, // ticks 5  → x 200
      { bar: 4, beat: 2 }, // ticks 13 → x 520
      { bar: 6, beat: 1 }, // ticks 20 → x 800（右缘阈值 752 之上，若 follow 开启会滚动）
    ];

    for (const cursorPosition of steps) {
      calls.length = 0;
      rerenderView({ ...baseProps, cursorPosition });
      const frame = lastFrame();

      // 每步只重绘一帧 → 未发生 setScrollX 引发的第二帧。
      expect(frames()).toHaveLength(1);

      const lines = verticalLineXsIn(frame);
      // 基线网格线全量仍在原位 → scrollX 未动。
      for (const x of gridBaseline) expect(lines).toContain(x);

      // cursor 竖线随 cursorPosition 平移，无滚动补偿。
      const ticks =
        (cursorPosition.bar - baseProps.viewRange.startBar) * BEATS_PER_BAR +
        (cursorPosition.beat - 1);
      const cursorX = ticks * PPB;
      expect(lines).toContain(Math.round(cursorX) + 0.5 - 1);
      expect(cursorLabelsIn(frame)[0].x).toBe(cursorX + 6);
    }
  });

  it("S0-T03: autoScrollFollow=true + cursor 出右缘 → 滚动 48px，重绘后竖线/标签回视口内", () => {
    // cursor {bar:6, beat:1}：ticks = (6-1)*4 + 0 = 20 → cursorX = 20*40 = 800 = w。
    // 800 > RIGHT_EDGE(752) → newScrollX = 20*40 - 752 = 48。
    // maxScrollX = (16-1+1)*4*40 - 800 = 1760 → 48 未触发 clamp（0 ≤ 48 ≤ 1760）。
    // 重绘后 cursorX = 800 - 48 = 752 → 竖线 Math.round(752)+0.5-1 = 751.5，标签 x 758。
    renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 6, beat: 1 },
    });

    const fs = frames();
    expect(fs).toHaveLength(2); // 首帧(scrollX 0) → setScrollX 后第二帧
    // 首帧：scrollX=0 → cursor 竖线 799.5。
    expect(verticalLineXsIn(fs[0])).toContain(799.5);

    const lines = verticalLineXsIn(lastFrame());
    expect(lines).toContain(751.5);
    expect(lines).not.toContain(799.5); // 已随 scrollX 平移
    expect(lines).toContain(32.5); // 网格同步平移：beat2 → 2*40-48 = 32

    const labels = cursorLabelsIn(lastFrame());
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: "m6.1", x: 758 });
    expect(labels[0].x).toBeGreaterThanOrEqual(0);
    expect(labels[0].x).toBeLessThanOrEqual(CANVAS_W);
    expect(lines.filter((x) => x === 751.5)).toHaveLength(1);
    expect(751.5).toBeGreaterThanOrEqual(0);
    expect(751.5).toBeLessThanOrEqual(CANVAS_W);

    // 倒三角随 cursor 位置同步（顶点 = RIGHT_EDGE，而非滚动前的 800）。
    expect(trianglesIn(lastFrame())[0].apex).toEqual([RIGHT_EDGE, 8]);
    expect(lines).toContain(RIGHT_EDGE - 0.5);
  });

  it("S0-T04a: clamp 下界——maxScrollX=0 时任何触发后 scrollX 恒 0", () => {
    // viewRange {1,5} → totalBeats = 20 → 总宽 = 20*40 = 800 = w → maxScrollX = 0。
    // cursor {bar:5, beat:4}：ticks = (5-1)*4 + 3 = 19 → cursorX = 760 > 752 触发，
    // newScrollX = 760 - 752 = 8 → clamp max(0, min(8, 0)) = 0 → 与 scrollX 相等，
    // 不 setScrollX（无第二帧）。
    renderView({
      ...baseProps,
      viewRange: { startBar: 1, endBar: 5 },
      autoScrollFollow: true,
      cursorPosition: { bar: 5, beat: 4 },
    });

    expect(frames()).toHaveLength(1); // 未重绘 → scrollX 未变
    const lines = verticalLineXsIn(lastFrame());
    expect(lines).toContain(0.5); // beat0 仍在 x=0 → scrollX = 0
    expect(lines).not.toContain(-7.5); // 反证：scrollX=8 时 beat0 → -8 → -7.5
    expect(lines).toContain(759.5); // cursor 760 - 0.5（未平移）
    expect(cursorLabelsIn(lastFrame())[0]).toMatchObject({ text: "m5.4", x: 766 });
  });

  it("S0-T04b: clamp 上界——newScrollX 超 maxScrollX 时钳制到 1760", () => {
    // cursor {bar:16, beat:4}：ticks = (16-1)*4 + 3 = 63 → cursorX = 2520。
    // 原始 newScrollX = 2520 - 752 = 1768 > maxScrollX = 64*40 - 800 = 1760 → 钳 1760。
    // 重绘后 cursorX = 2520 - 1760 = 760 → 竖线 759.5（未钳制则 2520-1768=752 → 751.5）。
    renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 16, beat: 4 },
    });

    const last = lastFrame();
    const lines = verticalLineXsIn(last);
    expect(lines).toContain(759.5);
    expect(lines).not.toContain(751.5); // 若未 clamp 会落在 752 → 751.5
    expect(lines).toContain(0.5); // beat44 → 44*40 - 1760 = 0
    expect(cursorLabelsIn(last)[0]).toMatchObject({ text: "m16.4", x: 766 });
    expect(766).toBeLessThanOrEqual(CANVAS_W);
    // 钳制判别：含 759.5（钳到 1760 后）且不含 751.5（未钳制会落 752→751.5）；
    // 帧数 2 仅为幂等收敛的辅助观察，不构成钳制证据（未钳制路径同样只有 2 帧）。
    expect(frames()).toHaveLength(2);
  });

  it("S0-T04c: clamp 下界——cursor 移出左缘时 newScrollX 钳回 0（不留负值）", () => {
    // 先让 scrollX 走到 48（同 S0-T03），再把 cursor 移回 bar1 beat1：
    // cursorX = 0 - 48 = -48 < 0 → newScrollX = 0 - 48 = -48 → clamp max(0, -48) = 0。
    renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 6, beat: 1 },
    });
    calls.length = 0;
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 1, beat: 1 },
    });

    expect(frames().length).toBeGreaterThanOrEqual(2);
    const lines = verticalLineXsIn(lastFrame());
    expect(lines).toContain(-0.5); // cursorX = 0 - 0 = 0 → 竖线 -0.5
    expect(lines).toContain(0.5); // beat0 回到 x=0 → scrollX = 0（已钳 ≥ 0）
    expect(lines).not.toContain(48.5); // 反证：scrollX=-48 时 beat0 → 48 → 48.5
    expect(lines).not.toContain(47.5); // 反证：scrollX=-48 时 cursor → 48 → 47.5
    expect(cursorLabelsIn(lastFrame())[0]).toMatchObject({ text: "m1.1", x: 6 });
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 1（S1-T08）：播放头（playheadPosition）绘制。
//
// 与 cursorPosition 语义正交，独立成块绘制在 cursor 之后：
//   橙色（--accent-sunset，区别于 cursor 的 --accent-purple）2px 竖线 +
//   顶部倒三角（几何同 v1.28 cursor：顶点 (x,8) / 两上角 (x∓4,0)）+
//   m{bar}.{floor(beat)} 标签（beat 为小数，标签取整、竖线 x 用连续值）。
// 越界（bar 超 viewRange / x 出画布）不绘制；undefined 不绘制。
//
// jsdom 无样式表 → getCSSVar 恒返回 ""，两条竖线颜色无法区分；故本段
// spy getComputedStyle 桩出变量值（--accent-purple / --accent-sunset），
// 以断言两线颜色确实不同。T09 golden 段不桩颜色（保持与录制时一致）。
// ---------------------------------------------------------------------------

describe("PianoRollView v2.0.0 playhead draw calls (S1-T08)", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView> & {
    playheadPosition?: { bar: number; beat: number };
  };

  const baseProps: ViewProps = {
    notes: [],
    tempoMap: {} as any,
    viewRange: { startBar: 1, endBar: 16 },
  };

  const CANVAS_H = 600;
  const PPB = 40; // pixelsPerBeat 初值
  const BEATS_PER_BAR = 4;

  /** 变量 → 颜色桩值（仅本段使用，用于区分 cursor/playhead）。 */
  const COLOR_BY_VAR: Record<string, string> = {
    "--accent-purple": "#a29bfe",
    "--accent-sunset": "#ff7a17",
  };

  const { ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn } = createRecordedCanvas();
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) => COLOR_BY_VAR[name] ?? "",
        }) as unknown as CSSStyleDeclaration
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function renderView(props: ViewProps): void {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(React.createElement(PianoRollView, props));
    });
  }






  const propSets = (name: string): unknown[] =>
    calls.filter((c) => c.op === `set:${name}`).map((c) => c.args[0]);

  it("S1-T08: 仅给 playheadPosition → 橙色竖线 + 倒三角 + m{bar}.{floor(beat)} 标签于预期 x", () => {
    // playheadTicks = (3-1)*4 + (2.5-1) = 9.5 → x = 9.5*40 = 380（连续小数 beat）。
    const playheadX = 9.5 * PPB;
    expect(playheadX).toBe(380);

    renderView({ ...baseProps, playheadPosition: { bar: 3, beat: 2.5 } });
    const frame = lastFrame();

    // 竖线 x 用连续 beat 值（未取整），非 cursor 的 Math.round(x)+0.5-1。
    expect(verticalLineXsIn(frame)).toContain(playheadX);

    // 倒三角顶点 (380,8)、两上角 (376,0)/(384,0)。
    const tris = trianglesIn(frame);
    expect(tris).toHaveLength(1);
    expect(tris[0].apex).toEqual([380, 8]);
    expect(tris[0].left).toEqual([376, 0]);
    expect(tris[0].right).toEqual([384, 0]);

    // beat=2.5 为小数 → 标签取 floor=2；x = 380 + 6 = 386，y = 12。
    const labels = positionLabelsIn(frame);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: "m3.2", x: playheadX + 6, y: 12 });

    // 橙色（--accent-sunset），且无 cursor 的紫色。
    expect(propSets("strokeStyle")).toContain("#ff7a17");
    expect(propSets("fillStyle")).toContain("#ff7a17");
    expect(propSets("strokeStyle")).not.toContain("#a29bfe");
    expect(propSets("fillStyle")).not.toContain("#a29bfe");
  });

  it("S1-T08b: playheadPosition 与 cursorPosition 同给 → 两线 x/颜色独立", () => {
    // cursor {bar:3,beat:3}: ticks = (3-1)*4 + (3-1) = 10 → x=400 → 竖线 399.5
    // playhead {bar:3,beat:2.5}: x=380 → 竖线 380（两线相距 19.5px）
    renderView({
      ...baseProps,
      cursorPosition: { bar: 3, beat: 3 },
      playheadPosition: { bar: 3, beat: 2.5 },
    });
    const frame = lastFrame();
    const lines = verticalLineXsIn(frame);

    expect(lines).toContain(399.5); // cursor
    expect(lines).toContain(380); // playhead
    expect(lines).not.toContain(400); // 反证：playhead 未错用取整 x

    // 两个独立倒三角（x 不同）。
    const tris = trianglesIn(frame);
    expect(tris).toHaveLength(2);
    expect(tris.map((t) => t.apex[0]).sort((a, b) => a - b)).toEqual([380, 400]);

    // 标签独立：cursor 用原始 beat(3) → m3.3；playhead 用 floor(2.5)=2 → m3.2。
    const labels = positionLabelsIn(frame);
    expect(labels.map((l) => l.text).sort()).toEqual(["m3.2", "m3.3"]);
    expect(labels.find((l) => l.text === "m3.3")!.x).toBe(406);
    expect(labels.find((l) => l.text === "m3.2")!.x).toBe(386);

    // 颜色独立：紫色（cursor）+ 橙色（playhead）均出现。
    const strokes = propSets("strokeStyle");
    expect(strokes).toContain("#a29bfe");
    expect(strokes).toContain("#ff7a17");
  });

  it("S1-T08c: playheadPosition 越界（bar 超 viewRange / x 出画布）不绘制", () => {
    // (a) bar=99 超出 viewRange(1-16)
    renderView({ ...baseProps, playheadPosition: { bar: 99, beat: 1 } });
    expect(trianglesIn(lastFrame())).toHaveLength(0);
    expect(propSets("strokeStyle")).not.toContain("#ff7a17");

    // (b) bar 在 viewRange 内但 x 出画布：{bar:1,beat:40} → ticks=39 → x=1560 > w=800
    calls.length = 0;
    renderView({ ...baseProps, playheadPosition: { bar: 1, beat: 40 } });
    expect(trianglesIn(lastFrame())).toHaveLength(0);
    expect(verticalLineXsIn(lastFrame())).not.toContain(39 * PPB);
    expect(propSets("strokeStyle")).not.toContain("#ff7a17");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 1（S1-T09，回归门）：playheadPosition === undefined 时零行为变化。
//
// 断言方式：将仅给 cursorPosition 的完整绘制调用序列（op + JSON(args)）与
// 改动前（v1.29，尚无 playhead 分支）录制的 golden 数组逐元素比对。golden 由
// 同一 createRecordingCtx 录制（src/components/PianoRoll/__tests__/fixtures/
// pianoRollDrawCalls.cursorOnly.json，388 次调用）。
// 本段不桩 getComputedStyle（颜色保持 "" 与录制时一致）。
// ---------------------------------------------------------------------------

describe("PianoRollView v2.0.0 playhead zero-regression (S1-T09)", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView> & {
    playheadPosition?: { bar: number; beat: number };
  };

  const baseProps: ViewProps = {
    notes: [],
    tempoMap: {} as any,
    viewRange: { startBar: 1, endBar: 16 },
  };

  const { ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn } = createRecordedCanvas();
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  it("S1-T09: 仅给 cursorPosition → 绘制调用序列与改动前逐字节一致 (critical)", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        React.createElement(PianoRollView, {
          ...baseProps,
          cursorPosition: { bar: 3, beat: 3 },
        })
      );
    });

    const sig = calls.map((c) => `${c.op}(${JSON.stringify(c.args)})`);
    expect(sig).toHaveLength(cursorOnlyGolden.length);
    expect(sig).toEqual(cursorOnlyGolden);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 2（S2-T12 ~ S2-T17）：跟随目标泛化 + 手动平移 + Follow 抢占。
//
// harness 与既有段同构（createRecordingCtx + ResizeObserver stub + createRoot/act）。
// 实态数值：w=800、h=600、pixelsPerBeat=40、viewRange {1,16} → totalBeats 64。
//   maxScrollX = 64*40 - 800 = 1760；maxScrollY = (108-24+1)*18 - 600 = 930。
//   RIGHT_EDGE = 800 - 48 = 752。
// 平移量经 DOM 直接读取（比 canvas 更精确，避免同 x 多解）：
//   scrollX ← 时间轴 bar1 标签的 inline `left`（= 0*ppb - scrollX）取负；
//   scrollY ← 键盘内层 div 的 `translateY(-scrollY px)` 取负。
// ---------------------------------------------------------------------------

describe("PianoRollView v2.0.0 follow / pan / suspension (S2-T12..T17)", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView> & {
    autoScrollFollow?: boolean;
    playheadPosition?: { bar: number; beat: number };
    transportRunId?: number;
  };

  const baseProps: ViewProps = {
    notes: [],
    tempoMap: {} as any,
    viewRange: { startBar: 1, endBar: 16 },
  };

  const CANVAS_W = 800;
  const CANVAS_H = 600;
  const PPB = 40;
  const BEATS_PER_BAR = 4;
  const FOLLOW_EDGE_MARGIN = 48;
  const RIGHT_EDGE = CANVAS_W - FOLLOW_EDGE_MARGIN; // 752
  const MAX_SCROLL_X = 64 * PPB - CANVAS_W; // 1760
  const MAX_SCROLL_Y = (108 - 24 + 1) * 18 - CANVAS_H; // 930

  const { ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn } = createRecordedCanvas();
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function renderView(props: ViewProps): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(React.createElement(PianoRollView, props));
    });
    return container;
  }

  function rerenderView(props: ViewProps): void {
    act(() => {
      root!.render(React.createElement(PianoRollView, props));
    });
  }




  /** 时间轴「纯整数标签」的 inline left（bar N → (N-1)*4*ppb - scrollX）。 */
  function timelineLeft(el: HTMLElement, label: string): number {
    for (const s of Array.from(el.querySelectorAll("span"))) {
      const he = s as HTMLElement;
      if (he.textContent === label && he.style.left) {
        return parseFloat(he.style.left);
      }
    }
    throw new Error(`timeline label ${label} not found`);
  }

  const readScrollX = (el: HTMLElement): number => {
    const v = -timelineLeft(el, "1");
    return v === 0 ? 0 : v; // 归一化 -0
  };
  function readScrollY(el: HTMLElement): number {
    for (const d of Array.from(el.querySelectorAll("div"))) {
      const m = /^translateY\((-?\d+(?:\.\d+)?)px\)$/.exec(
        (d as HTMLElement).style.transform
      );
      if (m) {
        const v = -Number(m[1]);
        return v === 0 ? 0 : v; // 归一化 -0
      }
    }
    throw new Error("keyboard translateY not found");
  }

  function wheel(
    el: Element,
    opts: { deltaY: number; deltaX?: number; shiftKey?: boolean; ctrlKey?: boolean }
  ) {
    act(() => {
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: opts.deltaY,
          // v2.0.0 S5 (D5-2)：支持 deltaX（触控板横向滚动）。缺省不传时
          // WheelEvent 的 deltaX 为 0，等价于鼠标滚轮的既有行为。
          deltaX: opts.deltaX ?? 0,
          shiftKey: opts.shiftKey ?? false,
          ctrlKey: opts.ctrlKey ?? false,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  }

  function pointer(
    el: Element,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    opts: { button: number; clientX: number; clientY: number }
  ) {
    act(() => {
      el.dispatchEvent(
        new PointerEvent(type, {
          button: opts.button,
          clientX: opts.clientX,
          clientY: opts.clientY,
          pointerId: 1,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  }

  function mouse(
    el: Element,
    type: "mousedown" | "mousemove" | "mouseup",
    opts: { button: number; clientX: number; clientY: number }
  ) {
    act(() => {
      el.dispatchEvent(
        new MouseEvent(type, {
          button: opts.button,
          clientX: opts.clientX,
          clientY: opts.clientY,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  }

  const canvasOf = (el: HTMLElement): Element =>
    el.querySelector('[data-testid="piano-roll-canvas"]')!;

  it("S2-T12: playheadPosition + autoScrollFollow → 越右缘(≥w-48)最小平移、连续位置逐次推进 (critical)", () => {
    // 数值自检（harness 基线锁定）。
    expect(RIGHT_EDGE).toBe(752);
    expect(MAX_SCROLL_X).toBe(1760);
    expect(MAX_SCROLL_Y).toBe(930);

    // 播放头在视口内 → 不平移。
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 1, beat: 1 },
    });
    expect(readScrollX(el)).toBe(0);

    // {bar:6,beat:1} → ticks 20 → x 800 > 752 → newScrollX = 800-752 = 48（最小平移）。
    calls.length = 0;
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 6, beat: 1 },
    });
    expect(readScrollX(el)).toBe(48);
    // 首帧 x=800（滚动前）；末帧 x=752=RIGHT_EDGE（播放头恰落右缘），grid beat2 = 32.5。
    const fs1 = frames();
    expect(fs1).toHaveLength(2);
    expect(verticalLineXsIn(fs1[0])).toContain(800);
    expect(verticalLineXsIn(lastFrame())).toContain(RIGHT_EDGE);
    expect(verticalLineXsIn(lastFrame())).toContain(32.5);

    // 连续推进：每次仅按需平移（逐次最小平移，不跳到终点）。
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 7, beat: 1 }, // ticks 24 → 960 → 960-752 = 208
    });
    expect(readScrollX(el)).toBe(208);

    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 8, beat: 1 }, // ticks 28 → 1120 → 1120-752 = 368
    });
    expect(readScrollX(el)).toBe(368);
  });

  it("S2-T13a: 同给 cursor 与 playhead → 跟随 playhead（playhead 优先） (critical)", () => {
    // cursor {bar:1,beat:1} 在视口内（若跟随它则 scrollX 恒 0）；
    // playhead {bar:6,beat:1} 越右缘 → 必须跟随 playhead 滚动 48。
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 1, beat: 1 },
      playheadPosition: { bar: 6, beat: 1 },
    });
    expect(readScrollX(el)).toBe(48);
  });

  it("S2-T13b: 只给 cursor（不给 playhead）→ 行为同 v1.28（回归） (critical)", () => {
    // {bar:6,beat:1} → cursorX = 800 → 滚动 48；末帧 cursor 竖线 751.5、标签 x=758。
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 6, beat: 1 },
    });
    expect(readScrollX(el)).toBe(48);
    const fs = frames();
    expect(fs).toHaveLength(2);
    expect(verticalLineXsIn(fs[0])).toContain(799.5);
    const lines = verticalLineXsIn(lastFrame());
    expect(lines).toContain(751.5);
    expect(lines).toContain(32.5);
  });

  it("S2-T13c: followPlayhead=false + 同给 cursor/playhead → 跟随 cursor（忽略 playhead，App 级场景组件镜像） (critical)", () => {
    // App idle 时 transport 恒停于 m1.1（playhead x=0 → 天然不触发平移），而录入
    // 光标继续右移。followPlayhead=false 必须回退到 cursor 并滚动 48；若仍跟
    // playhead 则 scrollX 恒 0（= v1.28 功能被杀）。
    const CURSOR_SCROLL = 20 * PPB - RIGHT_EDGE; // cursor{bar:6} → 800-752 = 48
    const PLAYHEAD_SCROLL = 0; // playhead{bar:1} 在视口内 → 不平移
    expect(CURSOR_SCROLL).toBe(48);
    expect(CURSOR_SCROLL).not.toBe(PLAYHEAD_SCROLL);

    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      followPlayhead: false,
      cursorPosition: { bar: 6, beat: 1 },
      playheadPosition: { bar: 1, beat: 1 },
    });
    const sx = readScrollX(el);
    expect(sx).toBe(CURSOR_SCROLL);
    expect(sx).not.toBe(PLAYHEAD_SCROLL);
  });

  it("S2-T13d: 不传 followPlayhead（默认 true）+ 同给 cursor/playhead → 跟随 playhead（默认值固化） (critical)", () => {
    // cursor 越右缘（若跟随它 → 48），playhead 停在视口内 m1.1（跟随它 → 0）。
    // 默认 true 必须跟 playhead → 0（不滚动），证明 S2.1 未改坏默认语义。
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      cursorPosition: { bar: 6, beat: 1 },
      playheadPosition: { bar: 1, beat: 1 },
    });
    expect(readScrollX(el)).toBe(0);
    expect(readScrollX(el)).not.toBe(20 * PPB - RIGHT_EDGE); // 反证：未跟 cursor
  });

  it("S2-T13e: followPlayhead=false + 只给 playhead（无 cursor）→ 不跟随（followTarget undefined，负控）", () => {
    // 忽略 playhead 且无 cursor 可回退 → followTarget 为 undefined → 不自动平移。
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      followPlayhead: false,
      playheadPosition: { bar: 6, beat: 1 }, // 若仍跟 playhead → 48
    });
    expect(readScrollX(el)).toBe(0);
  });

  it("S2-T14: wheel→scrollY；Shift+wheel→scrollX；Ctrl+wheel→pixelsPerBeat（plain wheel 不改 ppb：负控） (critical)", () => {
    const el = renderView(baseProps);
    const canvas = canvasOf(el);
    expect(readScrollX(el)).toBe(0);
    expect(readScrollY(el)).toBe(0);
    expect(timelineLeft(el, "2")).toBe(4 * PPB); // 160

    // plain wheel → 纵向平移；ppb 与 scrollX 均不变（负控）。
    wheel(canvas, { deltaY: 100 });
    expect(readScrollY(el)).toBe(100);
    expect(readScrollX(el)).toBe(0);
    expect(timelineLeft(el, "2")).toBe(4 * PPB); // 160 → ppb 仍为 40

    // Shift+wheel → 横向平移；scrollY 不变。
    wheel(canvas, { deltaY: 120, shiftKey: true });
    expect(readScrollX(el)).toBe(120);
    expect(readScrollY(el)).toBe(100);
    expect(timelineLeft(el, "2")).toBe(4 * PPB - 120); // 40

    // Ctrl+wheel（deltaY<0）→ ppb 40→44；不平移（scrollX 保持 120）。
    wheel(canvas, { deltaY: -1, ctrlKey: true });
    expect(readScrollX(el)).toBe(120);
    expect(readScrollY(el)).toBe(100);
    expect(timelineLeft(el, "2")).toBeCloseTo(4 * 44 - 120, 6); // 56
  });

  it("S2-T15: 平移 clamp —— 极端 wheel 后 scrollX===maxScrollX / scrollY===maxScrollY，双向均不越界 (critical)", () => {
    const el = renderView(baseProps);
    const canvas = canvasOf(el);

    // 正向越界 → 钳到上界。
    wheel(canvas, { deltaY: 100000, shiftKey: true });
    expect(readScrollX(el)).toBe(MAX_SCROLL_X); // 1760
    wheel(canvas, { deltaY: 100000 });
    expect(readScrollY(el)).toBe(MAX_SCROLL_Y); // 930

    // 负向越界 → 钳到下界 0（不为负）。
    wheel(canvas, { deltaY: -100000, shiftKey: true });
    expect(readScrollX(el)).toBe(0);
    wheel(canvas, { deltaY: -100000 });
    expect(readScrollY(el)).toBe(0);

    // 双向均不越界。
    expect(readScrollX(el)).toBeGreaterThanOrEqual(0);
    expect(readScrollX(el)).toBeLessThanOrEqual(MAX_SCROLL_X);
    expect(readScrollY(el)).toBeGreaterThanOrEqual(0);
    expect(readScrollY(el)).toBeLessThanOrEqual(MAX_SCROLL_Y);
  });

  it("S2-T16: 手动平移挂起跟随；transportRunId 值变化复位（同值不复位：负控） (critical)", () => {
    const el = renderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 1, beat: 1 },
      transportRunId: 1,
    });
    const canvas = canvasOf(el);
    expect(readScrollX(el)).toBe(0);

    // 手动平移（plain wheel 纵向）→ followSuspended=true。
    wheel(canvas, { deltaY: 50 });

    // 播放头越右缘：因已挂起 → 不自动平移。
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 6, beat: 1 },
      transportRunId: 1,
    });
    expect(readScrollX(el)).toBe(0); // 挂起生效（若未挂起会是 48）

    // 同值重渲染（transportRunId 仍 1）→ 不复位（"值变化"≠"值存在"）。
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 7, beat: 1 },
      transportRunId: 1,
    });
    expect(readScrollX(el)).toBe(0); // 仍挂起

    // runId 1→2（值变化）→ 复位 → 跟随当前 playhead {bar:7} → 960-752=208。
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 7, beat: 1 },
      transportRunId: 2,
    });
    expect(readScrollX(el)).toBe(208);

    // 再次手动平移 → 挂起；同值（仍 2）重渲染不复位。
    wheel(canvas, { deltaY: 30 });
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 8, beat: 1 },
      transportRunId: 2,
    });
    expect(readScrollX(el)).toBe(208); // 未复位

    // runId 2→3 → 复位 → 跟随 {bar:8} → 1120-752=368。
    rerenderView({
      ...baseProps,
      autoScrollFollow: true,
      playheadPosition: { bar: 8, beat: 1 },
      transportRunId: 3,
    });
    expect(readScrollX(el)).toBe(368);
  });

  it("S2-T17: 中键拖拽产出位移；左键拖拽音符不受影响（负控） (critical)", () => {
    const onNoteMove = vi.fn();
    const notes = [
      {
        id: "n1",
        trackId: "t1",
        phraseId: null,
        bar: 1,
        beat: 1,
        durQn: 1,
        pitchMidi: 60,
        pitchSpelling: "C4",
        velocity: 0.8,
        voice: "rh" as const,
        tags: [],
      },
    ];
    const el = renderView({ ...baseProps, notes, onNoteMove });
    const canvas = canvasOf(el);

    // 负控（先做，scrollX 仍为 0）：左键 mouse 拖拽音符 → onNoteMove 被调用。
    // note rect: x∈[0,40]、y = (108-60)*18 - scrollY。
    // v2.8.0：PianoRoll 首次就绪时会自动把纵向视口对准音符所在音区
    // （此前 scrollY 恒为 0，音符被画在画布下方 1200px 处、根本看不见）。
    // 因此这里必须按**实际** scrollY 换算 y —— 被测语义（左键拖音符 / 中键平移）
    // 没有变，变的是坐标前提，所以断言强度不变。
    const noteY = (108 - 60) * 18 - readScrollY(el);
    mouse(canvas, "mousedown", { button: 0, clientX: 5, clientY: noteY + 6 });
    mouse(canvas, "mousemove", { button: 0, clientX: 45, clientY: noteY + 6 });
    mouse(canvas, "mouseup", { button: 0, clientX: 45, clientY: noteY + 6 });
    expect(onNoteMove).toHaveBeenCalledTimes(1);
    expect(readScrollX(el)).toBe(0); // 左键拖音符不平移

    // 中键拖拽：向左拖 120px → scrollX = 起始 0 - (-120) = 120。
    pointer(canvas, "pointerdown", { button: 1, clientX: 200, clientY: 300 });
    pointer(canvas, "pointermove", { button: 1, clientX: 80, clientY: 300 });
    pointer(canvas, "pointerup", { button: 1, clientX: 80, clientY: 300 });
    expect(readScrollX(el)).toBe(120);

    // 负控：左键 pointer 拖拽不平移。
    pointer(canvas, "pointerdown", { button: 0, clientX: 400, clientY: 300 });
    pointer(canvas, "pointermove", { button: 0, clientX: 250, clientY: 300 });
    pointer(canvas, "pointerup", { button: 0, clientX: 250, clientY: 300 });
    expect(readScrollX(el)).toBe(120);
  });

  // v2.0.0 S5：输入完善两项（D5-2 触控板横向滚动 / D5-3 pointercancel 清理）。
  it("S5-D5-2: 触控板横向 deltaX → scrollX；不动 scrollY 与 pixelsPerBeat（负控） (critical)", () => {
    const el = renderView(baseProps);
    const canvas = canvasOf(el);
    // ppb 探针：timelineLeft(label) = (N-1)*4*ppb - scrollX，故**相邻标签间距**
    // 与 scrollX 无关，恒为 1 小节 = 4*ppb。用它验 ppb 不变才不会被滚动污染。
    const barSpacing = () =>
      timelineLeft(el, "2") - timelineLeft(el, "1");
    expect(readScrollX(el)).toBe(0);
    expect(readScrollY(el)).toBe(0);
    expect(barSpacing()).toBe(4 * PPB); // 160 → ppb = 40

    // 纯横向 deltaX（触控板横扫）→ 只平移 scrollX。
    wheel(canvas, { deltaX: 90, deltaY: 0 });
    expect(readScrollX(el)).toBe(90);
    expect(readScrollY(el)).toBe(0);
    expect(barSpacing()).toBe(4 * PPB); // ppb 未变（负控）

    // 负控：纯纵向 wheel（deltaX 缺省 = 0）→ 只平移 scrollY，scrollX 保持不变
    //（证明 deltaX 分支不会因缺省值误触发/污染 scrollX）。
    wheel(canvas, { deltaY: 100 });
    expect(readScrollY(el)).toBe(100);
    expect(readScrollX(el)).toBe(90);
    expect(barSpacing()).toBe(4 * PPB);
  });

  it("S5-D5-3: pointercancel 清理平移状态 → 取消后 pointermove 不再平移 (critical)", () => {
    const el = renderView(baseProps);
    const canvas = canvasOf(el);

    pointer(canvas, "pointerdown", { button: 1, clientX: 300, clientY: 300 });
    pointer(canvas, "pointermove", { button: 1, clientX: 240, clientY: 300 });
    expect(readScrollX(el)).toBe(60); // 左拖 60px → scrollX 60

    // 手势被浏览器中断（pointercancel）→ 平移状态必须被清理。
    pointer(canvas, "pointercancel", { button: 1, clientX: 240, clientY: 300 });

    // 反证：清理后再 move 不得继续平移（若未清理会变 120）。
    pointer(canvas, "pointermove", { button: 1, clientX: 180, clientY: 300 });
    expect(readScrollX(el)).toBe(60);
  });
  // v2.1.0 S3 (D13-5 / T34)：时间轴点击定位
  it("S3-T34: 时间轴点击 x → onSeek（按 4 拍/小节网格反演 bar/beat；负半区忽略）", () => {
    const onSeek = vi.fn();
    const el = renderView({ ...baseProps, onSeek });
    const timeline = el.querySelector('[data-testid="piano-roll-timeline"]') as HTMLElement;
    expect(timeline).not.toBeNull();
    // jsdom 的 getBoundingClientRect 恒 0 → rect.left = 0；ppb=40、scrollX=0
    act(() => {
      timeline.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 10, bubbles: true }));
    });
    // beats = 100/40 = 2.5 → bar 1, beat 3.5
    expect(onSeek).toHaveBeenCalledWith({ bar: 1, beat: 3.5 });
    // beats = 160/40 = 4 → bar 2, beat 1
    act(() => {
      timeline.dispatchEvent(new MouseEvent("click", { clientX: 160, clientY: 10, bubbles: true }));
    });
    expect(onSeek).toHaveBeenCalledWith({ bar: 2, beat: 1 });
    // 负半区（视图外）忽略
    act(() => {
      timeline.dispatchEvent(new MouseEvent("click", { clientX: -50, clientY: 10, bubbles: true }));
    });
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  // v2.1.0 S3 (D13-6)：loop 区间高亮（enabled=false / 未传 → 不渲染）
  it("S3-D13-6: loopRegion.enabled 时时间轴渲染 loop 高亮元素", () => {
    const el = renderView({ ...baseProps, loopRegion: { enabled: true, start: { bar: 1, beat: 1 }, end: { bar: 2, beat: 1 } } });
    expect(el.querySelector('[data-testid="piano-roll-loop-region"]')).not.toBeNull();
    const el2 = renderView({ ...baseProps });
    expect(el2.querySelector('[data-testid="piano-roll-loop-region"]')).toBeNull();
  });
});
