import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteEvent } from "@collinx/core";
import { PianoRollView } from "../PianoRollView";

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

type DrawCall = { op: string; args: unknown[] };

function createRecordingCtx() {
  const calls: DrawCall[] = [];
  const methods = [
    "scale",
    "clearRect",
    "fillRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "stroke",
    "fill",
    "fillText",
    "closePath",
    "quadraticCurveTo",
  ];
  const target: Record<string, unknown> = {};
  for (const m of methods) {
    target[m] = (...args: unknown[]) => {
      calls.push({ op: m, args });
    };
  }
  target.createLinearGradient = (...args: unknown[]) => {
    calls.push({ op: "createLinearGradient", args });
    return { addColorStop: () => {} };
  };
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "string" && prop in t) return t[prop];
      return undefined;
    },
    set(t, prop, value) {
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      Reflect.set(t, prop, value);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

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

  const { ctx, calls } = createRecordingCtx();
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

  const { ctx, calls } = createRecordingCtx();
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

  /** 每帧以 drawCanvas 开头的 ctx.scale(dpr, dpr) 为界切分（一帧一次）。 */
  function frames(): DrawCall[][] {
    const out: DrawCall[][] = [];
    let cur: DrawCall[] | null = null;
    for (const c of calls) {
      if (c.op === "scale") {
        cur = [];
        out.push(cur);
      }
      if (cur) cur.push(c);
    }
    return out;
  }

  function lastFrame(): DrawCall[] {
    const fs = frames();
    return fs.length > 0 ? fs[fs.length - 1] : [];
  }

  /** 竖线绘制（moveTo(x, 0) + lineTo(x, h)）：网格线与 cursor 竖线共用此模式。 */
  function verticalLineXsIn(frame: DrawCall[]): number[] {
    const xs: number[] = [];
    for (let i = 0; i < frame.length; i++) {
      const c = frame[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        frame[i + 1]?.op === "lineTo" &&
        frame[i + 1].args[0] === c.args[0] &&
        frame[i + 1].args[1] === CANVAS_H
      ) {
        xs.push(Number(c.args[0]));
      }
    }
    return xs;
  }

  /** 倒三角序列：moveTo(apex, 8) → lineTo(left, 0) → lineTo(right, 0) → closePath → fill。 */
  function trianglesIn(frame: DrawCall[]) {
    const out: { apex: number[]; left: number[]; right: number[] }[] = [];
    for (let i = 0; i < frame.length; i++) {
      const m = frame[i];
      const l1 = frame[i + 1];
      const l2 = frame[i + 2];
      if (
        m?.op === "moveTo" &&
        m.args[1] === 8 &&
        l1?.op === "lineTo" &&
        l1.args[1] === 0 &&
        l2?.op === "lineTo" &&
        l2.args[1] === 0 &&
        frame[i + 3]?.op === "closePath" &&
        frame[i + 4]?.op === "fill"
      ) {
        out.push({
          apex: m.args as number[],
          left: l1.args as number[],
          right: l2.args as number[],
        });
      }
    }
    return out;
  }

  /** cursor 位置标签（m{bar}.{beat}）及其 x/y。 */
  function cursorLabelsIn(frame: DrawCall[]) {
    return frame
      .filter((c) => c.op === "fillText" && /^m\d+\.\d+$/.test(String(c.args[0])))
      .map((c) => ({
        text: String(c.args[0]),
        x: Number(c.args[1]),
        y: Number(c.args[2]),
      }));
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
