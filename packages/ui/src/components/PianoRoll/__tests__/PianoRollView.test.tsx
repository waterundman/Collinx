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
