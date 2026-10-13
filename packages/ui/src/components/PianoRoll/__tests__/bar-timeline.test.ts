import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TempoMap } from "@collinx/core";
import { PianoRollView } from "../PianoRollView";
import { createBarTimeline } from "../bar-timeline";
import { createRecordedCanvas } from "../../../test-utils/canvas-ctx";

// ---------------------------------------------------------------------------
// v2.3.0 Stage 3 (S3)：钢琴卷拍号一致化（消除 BEATS_PER_BAR = 4 硬编码）。
//
// 本文件分两段：
//   A. createBarTimeline 纯函数单元断言（T54b / 单位换算 / 互逆 / 越界语义）；
//   B. PianoRollView 集成断言（T51 零回归负控 / T52 3/4 跨视图 / T53 onSeek 反演 /
//      T54 loop 高亮宽度）——经录制型 canvas ctx + DOM 时间轴读取。
//
// 领域事实（见 bar-timeline.ts 注释与 core tempo-map.ts:120/:183/:280-282）：
//   每小节四分音符拍数 = numerator × 4 / denominator（3/4→3、6/8→3、7/8→3.5）。
// ---------------------------------------------------------------------------

describe("bar-timeline createBarTimeline unit (S3-T54b / 单位换算 / 互逆 / 越界)", () => {
  const meter = (numerator: number, denominator: number) => [
    { bar: 1, numerator, denominator },
  ];

  it("S3-T54b: 7/8 小数往返——beatsPerBarAt(1)=3.5、qnOf/barBeatFromQn 互逆、totalQn(8)=28 (critical)", () => {
    const t = createBarTimeline(new TempoMap([], meter(7, 8)), {
      startBar: 1,
      endBar: 8,
    });

    // 7/8 → 7 × 4 / 8 = 3.5 拍/小节（**不是** numerator=7）。
    expect(t.beatsPerBarAt(1)).toBe(3.5);
    expect(t.totalQn(8)).toBe(28); // 8 × 3.5

    // 互逆（跨小节全序）：bar 1..8 × beat ∈ {1, 2.5, 3.5}，误差 < 1e-9。
    for (let bar = 1; bar <= 8; bar++) {
      for (const beat of [1, 2.5, 3.5]) {
        const qn = t.qnOf(bar, beat);
        const back = t.barBeatFromQn(qn);
        expect(back.bar).toBe(bar);
        expect(Math.abs(back.beat - beat)).toBeLessThan(1e-9);
      }
    }
  });

  it("S3-单位换算：4/4=4、3/4=3、6/8=3、7/8=3.5——逐值反证未误用 numerator", () => {
    const mk = (n: number, d: number) =>
      createBarTimeline(new TempoMap([], meter(n, d)), { startBar: 1, endBar: 4 });

    expect(mk(4, 4).beatsPerBarAt(1)).toBe(4);
    expect(mk(3, 4).beatsPerBarAt(1)).toBe(3);
    expect(mk(6, 8).beatsPerBarAt(1)).toBe(3); // 6×4/8
    expect(mk(7, 8).beatsPerBarAt(1)).toBe(3.5); // 7×4/8

    // 若误用 numerator：6/8→6、7/8→7 —— 反证式（负控语义）。
    expect(mk(6, 8).beatsPerBarAt(1)).not.toBe(6);
    expect(mk(7, 8).beatsPerBarAt(1)).not.toBe(7);
  });

  it("S3-互逆（4/4、3/4 全程）：barStartQn 前缀与前序拍数全序一致、qnOf/barBeatFromQn 互逆", () => {
    for (const [n, d] of [
      [4, 4],
      [3, 4],
    ] as const) {
      const t = createBarTimeline(new TempoMap([], meter(n, d)), {
        startBar: 1,
        endBar: 8,
      });
      const beatsPerBar = t.beatsPerBarAt(1);

      expect(t.barStartQn(1)).toBe(0);
      expect(t.qnOf(1, 1)).toBe(0);

      for (let bar = 1; bar <= 8; bar++) {
        // 等拍号下前缀表逐值等于 (bar-1) × 每小节拍数。
        expect(t.barStartQn(bar)).toBe((bar - 1) * beatsPerBar);
        for (const beat of [1, 1.5, 2, 3, beatsPerBar]) {
          const qn = t.qnOf(bar, beat);
          const back = t.barBeatFromQn(qn);
          expect(back.bar).toBe(bar);
          expect(Math.abs(back.beat - beat)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("S3-越界语义（显式 clamp / 非整数四舍五入）：bar 下界、bar 上界、非整数、qn 越界", () => {
    // startBar=2 → 表格覆盖 bar 2..6（closingBar = endBar+1 = 6），3/4。
    const t = createBarTimeline(new TempoMap([], meter(3, 4)), {
      startBar: 2,
      endBar: 5,
    });
    expect(t.barStartQn(2)).toBe(3); // 自 bar 1 起：bar 2 起点 = 1 小节 × 3 拍
    expect(t.barStartQn(6)).toBe(15); // bar 6 起点 = 5 × 3

    // bar < startBar → clamp 到 startBar。
    expect(t.barStartQn(1)).toBe(t.barStartQn(2));
    expect(t.barStartQn(-7)).toBe(t.barStartQn(2));
    // bar > endBar+1 → clamp 到 endBar+1（收尾边界小节故意可寻址）。
    expect(t.barStartQn(99)).toBe(t.barStartQn(6));
    // 非整数 bar → 四舍五入到最近整数后 clamp。
    expect(t.barStartQn(2.4)).toBe(t.barStartQn(2));
    expect(t.barStartQn(2.6)).toBe(t.barStartQn(3));

    // beatsPerBarAt 合法域 [startBar, endBar]。
    expect(t.beatsPerBarAt(99)).toBe(t.beatsPerBarAt(5));
    expect(t.beatsPerBarAt(1)).toBe(t.beatsPerBarAt(2));

    // totalQn：覆盖 bar 1..bars。
    expect(t.totalQn(5)).toBe(15);

    // qn 越界 → clamp 到 [barStartQn(startBar), barStartQn(endBar+1)]。
    expect(t.barBeatFromQn(-1000)).toEqual({ bar: 2, beat: 1 });
    expect(t.barBeatFromQn(1e9)).toEqual({ bar: 6, beat: 1 });
    // 边界点逐值：正好落在 bar 起点。
    expect(t.barBeatFromQn(t.barStartQn(4))).toEqual({ bar: 4, beat: 1 });
  });
});

describe("bar-timeline PianoRollView integration (S3-T51 / T52 / T53 / T54)", () => {
  type ViewProps = React.ComponentProps<typeof PianoRollView>;

  const CANVAS_W = 800; // canvasSize.width 初值（ResizeObserver stub 不回调）
  const CANVAS_H = 600;
  const PPB = 40; // pixelsPerBeat 初值（无 zoom 交互）
  const SCROLL_X = 0;

  const { ctx, calls } = createRecordedCanvas();
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

  /** 渲染（先卸载上一实例，避免多根泄漏）；返回容器供 DOM 断言。 */
  function renderView(props: ViewProps): HTMLDivElement {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    calls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root.render(React.createElement(PianoRollView, props));
    });
    return container;
  }

  /**
   * 竖线调用（moveTo(x,0)+lineTo(x,h)）及其**前一条 set:lineWidth**：
   * 主 bar 线 = 1、小节内次线 = 0.5、cursor/播放头 = 2。用于把录制序列按语义分组。
   */
  function verticalLinesWithWidth(): { x: number; width: number }[] {
    const out: { x: number; width: number }[] = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        calls[i + 1]?.op === "lineTo" &&
        calls[i + 1].args[0] === c.args[0] &&
        calls[i + 1].args[1] === CANVAS_H
      ) {
        let width = -1;
        for (let k = i - 1; k >= 0; k--) {
          if (calls[k].op === "set:lineWidth") {
            width = calls[k].args[0] as number;
            break;
          }
        }
        out.push({ x: Number(c.args[0]), width });
      }
    }
    return out;
  }

  /** 网格 bar 号标签（纯整数文本、y=12）；其 x = 竖线 x + 3。 */
  function barLabels(): { text: string; x: number }[] {
    return calls
      .filter(
        (c) =>
          c.op === "fillText" &&
          /^\d+$/.test(String(c.args[0])) &&
          c.args[2] === 12
      )
      .map((c) => ({ text: String(c.args[0]), x: Number(c.args[1]) }));
  }

  function dispatchTimelineClick(el: HTMLElement, clientX: number): void {
    const timeline = el.querySelector(
      '[data-testid="piano-roll-timeline"]'
    ) as HTMLElement;
    expect(timeline).not.toBeNull();
    act(() => {
      timeline.dispatchEvent(
        new MouseEvent("click", { clientX, clientY: 10, bubbles: true })
      );
    });
  }

  it("S3-T51: 零回归负控（4/4，new TempoMap([], [])）——网格竖线/标签/播放头/onSeek 与旧式逐值一致 (critical)", () => {
    const tempoMap = new TempoMap([], []);
    const viewRange = { startBar: 1, endBar: 16 };

    // 旧式（改动前）4/4 网格期望：beat ∈ [0, totalBeats]，x = beat*ppb - scrollX，
    // 可见域 [-2, w+2]，取整 Math.round(x)+0.5；beat%4===0 为主线 + 标签。
    const totalBeats = (viewRange.endBar - viewRange.startBar + 1) * 4;
    const oldGridXs: number[] = [];
    const oldMainXs: number[] = [];
    const oldSubXs: number[] = [];
    const oldLabelTexts: string[] = [];
    const oldLabelXs: number[] = [];
    for (let beat = 0; beat <= totalBeats; beat++) {
      const x = beat * PPB - SCROLL_X;
      if (x < -2 || x > CANVAS_W + 2) continue;
      const rounded = Math.round(x) + 0.5;
      oldGridXs.push(rounded);
      if (beat % 4 === 0) {
        oldMainXs.push(rounded);
        oldLabelTexts.push(String(viewRange.startBar + beat / 4));
        oldLabelXs.push(x + 3);
      } else {
        oldSubXs.push(rounded);
      }
    }

    renderView({ notes: [], tempoMap, viewRange });
    const lines = verticalLinesWithWidth();

    // (1) 网格竖线 x 序列逐值相同（全序）。
    expect(lines.map((l) => l.x)).toEqual(oldGridXs);
    // (2) 主/次线分别逐值相同（lineWidth 1 / 0.5 区分）。
    expect(lines.filter((l) => l.width === 1).map((l) => l.x)).toEqual(oldMainXs);
    expect(lines.filter((l) => l.width === 0.5).map((l) => l.x)).toEqual(oldSubXs);
    // (3) bar 标签序列 = 1..N，x 同为旧式 x+3。
    expect(barLabels().map((l) => l.text)).toEqual(oldLabelTexts);
    expect(barLabels().map((l) => l.x)).toEqual(oldLabelXs);
    expect(oldLabelTexts).toEqual(["1", "2", "3", "4", "5", "6"]);

    // (4) 播放头 {2,1}：旧式 ticks = (2-1)*4 + (1-1) = 4 → x = 4*ppb。
    const oldPlayheadTicks = (2 - viewRange.startBar) * 4 + (1 - 1);
    expect(oldPlayheadTicks).toBe(4);
    const oldPlayheadX = oldPlayheadTicks * PPB - SCROLL_X;
    renderView({
      notes: [],
      tempoMap,
      viewRange,
      playheadPosition: { bar: 2, beat: 1 },
    });
    expect(verticalLinesWithWidth().filter((l) => l.width === 2).map((l) => l.x)).toEqual([
      oldPlayheadX,
    ]);

    // (5) onSeek 反演（4/4）与旧式 `bar=floor(beats/4)+1 / beat=beats%4+1` 逐值一致。
    const onSeek = vi.fn();
    const el = renderView({ notes: [], tempoMap, viewRange, onSeek });
    const oldSeek = (x: number) => {
      const beats = (x + SCROLL_X) / PPB;
      return { bar: Math.floor(beats / 4) + 1, beat: (beats % 4) + 1 };
    };
    for (const x of [0, PPB, 3 * PPB, 4 * PPB, 7 * PPB]) {
      dispatchTimelineClick(el, x);
      expect(onSeek).toHaveBeenLastCalledWith(oldSeek(x));
    }
    // 对照 S3-T53：4/4 下 x=4*ppb 才是 {2,1}（3/4 下 x=3*ppb 为 {2,1}）。
    expect(oldSeek(4 * PPB)).toEqual({ bar: 2, beat: 1 });
    expect(oldSeek(3 * PPB)).toEqual({ bar: 1, beat: 4 });
    // 负半区（视图外）忽略。
    const before = onSeek.mock.calls.length;
    dispatchTimelineClick(el, -50);
    expect(onSeek.mock.calls.length).toBe(before);
  });

  it("S3-T52: 3/4 跨视图一致——主 bar 线相邻间距 = 3*ppb、m2 线 x = 3*ppb、播放头 {2,1} 落在 m2 线上 (critical)", () => {
    const tempoMap = new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }]);
    const viewRange = { startBar: 1, endBar: 8 };

    renderView({
      notes: [],
      tempoMap,
      viewRange,
      playheadPosition: { bar: 2, beat: 1 },
    });
    const lines = verticalLinesWithWidth();

    // 3/4 → 每小节 3 拍：主 bar 线 q = 0,3,6,9,12,15,18（x ≤ 802）。
    const mainXs = lines.filter((l) => l.width === 1).map((l) => l.x);
    const expectedMainQ = [0, 3, 6, 9, 12, 15, 18];
    expect(mainXs).toEqual(expectedMainQ.map((q) => Math.round(q * PPB) + 0.5));
    // 相邻主 bar 线间距 = 3*ppb（逐值全序）。
    expect(mainXs.slice(1).map((x, i) => x - mainXs[i])).toEqual([
      3 * PPB,
      3 * PPB,
      3 * PPB,
      3 * PPB,
      3 * PPB,
      3 * PPB,
    ]);

    // m2 线 x = 3*ppb - scrollX（标签 x = 线 x + 3）。
    const label2 = barLabels().find((l) => l.text === "2");
    expect(label2).toBeDefined();
    expect(label2!.x - 3).toBe(3 * PPB - SCROLL_X);

    // 播放头 {2,1} 恰好落在 m2 线上（差 < 1e-6）。
    const accentXs = lines.filter((l) => l.width === 2).map((l) => l.x);
    expect(accentXs).toEqual([3 * PPB - SCROLL_X]);
    expect(Math.abs(accentXs[0] - (label2!.x - 3))).toBeLessThan(1e-6);
  });

  it("S3-T53a: onSeek 反演随拍号——3/4 下 x = 3*ppb（scrollX=0）→ {bar:2, beat:1} (critical)", () => {
    const onSeek = vi.fn();
    const el = renderView({
      notes: [],
      tempoMap: new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }]),
      viewRange: { startBar: 1, endBar: 8 },
      onSeek,
    });

    dispatchTimelineClick(el, 3 * PPB);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ bar: 2, beat: 1 });

    // 3/4 下 x = 6*ppb → {3,1}（另一小节边界，非同一解）。
    dispatchTimelineClick(el, 6 * PPB);
    expect(onSeek).toHaveBeenLastCalledWith({ bar: 3, beat: 1 });
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  it("S3-T53b: onSeek 反演随拍号——7/8 下 x = 3.5*ppb → {bar:2, beat:1} (critical)", () => {
    const onSeek = vi.fn();
    const el = renderView({
      notes: [],
      tempoMap: new TempoMap([], [{ bar: 1, numerator: 7, denominator: 8 }]),
      viewRange: { startBar: 1, endBar: 8 },
      onSeek,
    });

    dispatchTimelineClick(el, 3.5 * PPB);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith({ bar: 2, beat: 1 });

    // 7/8 下 x = 3*ppb → bar 1 内（beat = 3 + 1 = 4），与 3/4 的解不同（负控）。
    dispatchTimelineClick(el, 3 * PPB);
    expect(onSeek).toHaveBeenLastCalledWith({ bar: 1, beat: 4 });
  });

  it("S3-T54: loop 高亮随拍号——3/4 下 2.1→3.1 宽度 = 3*ppb；7/8 下宽度 = 3.5*ppb (critical)", () => {
    const loopRegion = {
      enabled: true,
      start: { bar: 2, beat: 1 },
      end: { bar: 3, beat: 1 },
    };

    // 3/4：qnOf(3,1) - qnOf(2,1) = 3 拍 → 宽度 3*ppb；left = qnOf(2,1) = 3 拍。
    let el = renderView({
      notes: [],
      tempoMap: new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }]),
      viewRange: { startBar: 1, endBar: 8 },
      loopRegion,
    });
    let region = el.querySelector(
      '[data-testid="piano-roll-loop-region"]'
    ) as HTMLElement;
    expect(region).not.toBeNull();
    expect(parseFloat(region.style.width)).toBe(3 * PPB);
    expect(parseFloat(region.style.left)).toBe(3 * PPB);

    // 7/8：qnOf(3,1) - qnOf(2,1) = 3.5 拍 → 宽度 3.5*ppb；left = 3.5 拍。
    el = renderView({
      notes: [],
      tempoMap: new TempoMap([], [{ bar: 1, numerator: 7, denominator: 8 }]),
      viewRange: { startBar: 1, endBar: 8 },
      loopRegion,
    });
    region = el.querySelector(
      '[data-testid="piano-roll-loop-region"]'
    ) as HTMLElement;
    expect(parseFloat(region.style.width)).toBe(3.5 * PPB);
    expect(parseFloat(region.style.left)).toBe(3.5 * PPB);
  });
});
