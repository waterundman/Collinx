/**
 * v2.3.0 Stage 3b（S3 收口）：usePianoRollInteraction 拍号一致化测试。
 *
 * 背景：`PianoRollView` 的网格线/细分线/录入光标/播放头/onSeek/loop 已改由
 * `createBarTimeline`（真实拍号）驱动（S3 已完成）；但本 hook 内**第二处**硬编码
 * `BEATS_PER_BAR = 4` 仍驱动「音符落点(pixelToBarBeat) / 音符矩形 x(barBeatToPixel)
 * / 拖拽 move 换算」——3/4 下网格按 3 拍、音符按 4 拍 → 音符与小节线彼此错位。
 * 本文件钉死三件事（逐值 / 互逆 / 差值，禁"数量/非空"式断言）：
 *
 *   T54c  缺省（不传 tempoMap）→ 4/4 语义，与旧内联 4 拍公式**逐值相同**（零回归）。
 *   T54d  3/4 → barBeatToPixel / pixelToBarBeat 与网格对齐且互逆。
 *   T54e  7/8 → beatsPerBarAt = 3.5（**非 numerator = 7**），末拍落点保持亚拍分辨率。
 *
 * 领域事实（core 源码，非本文件臆断）：`beat` 单位为四分音符——
 * `positionInBars(bar, beat) = bar + (beat-1)/4`（tempo-map.ts:280-282），故每小节
 * 四分音符拍数 = `numerator × 4 / denominator`（tempo-map.ts:120 / :183）。
 *
 * harness：复用既有 usePianoRollInteraction.test.tsx 的手写风格——
 * createRoot + act 直渲 hook（Probe 把最近一次返回值暴露给测试），
 * updateNoteRects 注入命中矩形后按 mousedown → mousemove 驱动拖拽。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NoteEvent, TempoMap } from "@collinx/core";
import {
  usePianoRollInteraction,
  type UsePianoRollInteractionParams,
} from "../usePianoRollInteraction";
import { createBarTimeline } from "../bar-timeline";

type Interaction = ReturnType<typeof usePianoRollInteraction>;

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: "n1",
    trackId: "default",
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1,
    pitchMidi: 60,
    pitchSpelling: "",
    velocity: 0.8,
    voice: "rh",
    tags: [],
    ...overrides,
  } as NoteEvent;
}

/** 命中矩形：宽 40 → 正文 x∈[10,44)，右缘 resize 阈值 6px（与既有测试同值）。 */
const NOTE_RECT = { x: 10, y: 10, w: 40, h: 17 };
const BODY_X = 20; // ∈ [10,44) → body（move 拖拽）
const BODY_Y = 15; // ∈ [10,27)

interface Harness {
  get: () => Interaction;
  unmount: () => void;
}

function renderInteraction(params: UsePianoRollInteractionParams): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  const latest: { value: Interaction | null } = { value: null };

  function Probe() {
    latest.value = usePianoRollInteraction(params);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    get: () => latest.value!,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function makeParams(
  overrides: Partial<UsePianoRollInteractionParams> = {}
): UsePianoRollInteractionParams {
  return {
    notes: [makeNote()],
    viewRange: { startBar: 1, endBar: 8 },
    pixelsPerBeat: 40,
    scrollX: 0,
    scrollY: 0,
    selectedNoteIds: [],
    ...overrides,
  };
}

/** 注入命中矩形（hitTest 依赖 noteRectsRef，正常由 drawCanvas 写入）。 */
function setNoteRects(h: Harness) {
  act(() => {
    h.get().updateNoteRects(new Map([["n1", NOTE_RECT]]));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T54c：缺省零回归。旧式（改动前）内联 4 拍公式的**逐字复刻**，与不传 tempoMap 的
// hook 输出逐值比对。**全合法域**（不是"共同域"）：
//   * barBeatToPixel / 拖拽 move —— 新旧式在全合法域恒等（bar ∈ [startBar,endBar]：
//     qnOf(bar,beat)-qnBase = (bar-startBar)*4+(beat-1)，纯代数恒等）。
//   * pixelToBarBeat —— 新式 barBeatFromQn 反演 + 拍内钳制上界 `beatsPerBarAt + 0.999`。
//     4/4 下 `beatsPerBarAt === 4` → 上界恒为 `4 + 0.999`，与旧式**逐位相同**，故
//     输入可覆盖全部 beat_raw ∈ [1, 5)，**包括 (4, 5) 这一段末拍区间**。
//
// ⚠️ 这段末拍区间是**回归哨兵**，不是可选加强：S3b 初版把上界写成 `beatsPerBarAt(bar)`
//    （缺 `+ 0.999`），于是「双击某小节最后一拍 → 落点被钳到 4 → 音符渲染左移最多
//    1 个四分音符」（渲染侧见 PianoRollView.tsx:417 的 `timeline.qnOf`，落盘侧见
//    App.tsx:394 不量化）。本用例的 b 列表**必含** b ∈ (4,5) 的取样，否则该回归全绿。
// ---------------------------------------------------------------------------
describe("usePianoRollInteraction 缺省零回归 (S3b-T54c)", () => {
  const PPB = 40;
  const NOTE_H = 18;
  const MIN_P = 24;
  const MAX_P = 108;

  interface RefCtx {
    startBar: number;
    scrollX: number;
    scrollY: number;
    ppb: number;
  }

  function oldPixelToBarBeat(x: number, y: number, c: RefCtx) {
    const totalBeats = (x + c.scrollX) / c.ppb;
    const bar = c.startBar + Math.floor(totalBeats / 4);
    const beat = (totalBeats % 4) + 1;
    const pitch = MAX_P - Math.floor((y + c.scrollY) / NOTE_H);
    return {
      bar: Math.max(1, bar),
      beat: Math.max(1, Math.min(4 + 0.999, beat)),
      pitch: Math.max(MIN_P, Math.min(MAX_P, pitch)),
    };
  }

  function oldBarBeatToPixel(bar: number, beat: number, pitch: number, c: RefCtx) {
    const totalBeats = (bar - c.startBar) * 4 + (beat - 1);
    return { x: totalBeats * c.ppb - c.scrollX, y: (MAX_P - pitch) * NOTE_H - c.scrollY };
  }

  function oldMove(
    deltaX: number,
    c: RefCtx,
    original: { bar: number; beat: number; pitch: number }
  ): [string, number, number, number] {
    const deltaBeats = deltaX / c.ppb;
    const originalBeats = (original.bar - c.startBar) * 4 + (original.beat - 1);
    const newTotalBeats = originalBeats + deltaBeats;
    const newBar = c.startBar + Math.max(0, Math.floor(newTotalBeats / 4));
    const newBeat = ((newTotalBeats % 4) + 4) % 4 + 1;
    return ["n1", Math.max(1, newBar), newBeat, original.pitch];
  }

  it("T54c: 不传 tempoMap → pixelToBarBeat / barBeatToPixel / 拖拽 move 与旧内联 4 拍公式逐值相同 (critical)", () => {
    const viewRange = { startBar: 1, endBar: 8 };

    // —— 两组渲染参数（含一组非零 scrollX/Y）以覆盖偏移通道。 ——
    for (const scroll of [
      { scrollX: 0, scrollY: 0 },
      { scrollX: 120, scrollY: 36 },
    ]) {
      const ctx: RefCtx = { startBar: viewRange.startBar, ppb: PPB, ...scroll };
      const h = renderInteraction(
        makeParams({ viewRange, pixelsPerBeat: PPB, ...scroll })
      );
      const api = h.get();

      // (1) pixelToBarBeat 逐值（bar / beat / pitch 三元全比；**全合法域**，含末拍区间
      //     b%4 ∈ (3,4) → beat_raw ∈ (4,5)，见块首「回归哨兵」说明）。
      //     x 由「自 startBar 起的四分音符偏移 b」反推：x + scrollX = b*ppb。
      for (const b of [
        0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75, 3.9, 3.999,
        4, 4.5, 5.5, 6, 6.5, 7.5, 7.999, 8, 11.5, 12, 15.999, 16,
      ]) {
        const x = b * PPB - scroll.scrollX;
        for (const y of [0, 9, 30, 108]) {
          expect(api.pixelToBarBeat(x, y)).toEqual(oldPixelToBarBeat(x, y, ctx));
        }
      }

      // (2) barBeatToPixel 逐值（全合法域恒等）。
      for (const bar of [1, 2, 3, 5, 8]) {
        for (const beat of [1, 2.5, 3, 4]) {
          for (const pitch of [60, MIN_P, MAX_P]) {
            expect(api.barBeatToPixel(bar, beat, pitch)).toEqual(
              oldBarBeatToPixel(bar, beat, pitch, ctx)
            );
          }
        }
      }

      h.unmount();
    }

    // (3) 拖拽 move：newBar / newBeat 逐值（deltaBeats 取整数/半整数，落共同域）。
    const scroll = { scrollX: 0, scrollY: 0 };
    const ctx: RefCtx = { startBar: viewRange.startBar, ppb: PPB, ...scroll };
    const onNoteMove = vi.fn();
    const h2 = renderInteraction(
      makeParams({ viewRange, pixelsPerBeat: PPB, ...scroll, onNoteMove })
    );
    setNoteRects(h2);
    act(() => {
      h2.get().handleMouseDown(BODY_X, BODY_Y);
    });
    for (const dx of [0, 20, 40, 60, 80, 120, 140, 160, 200, 240, 300, 320, 400, 480]) {
      act(() => {
        h2.get().handleMouseMove(BODY_X + dx, BODY_Y);
      });
      const call = onNoteMove.mock.calls[onNoteMove.mock.calls.length - 1];
      expect(call).toEqual(oldMove(dx, ctx, { bar: 1, beat: 1, pitch: 60 }));
    }
    h2.unmount();
  });
});

// ---------------------------------------------------------------------------
// T54d：3/4 一致（音符换算与网格 m2 同源、反演、互逆）。
// ---------------------------------------------------------------------------
describe("usePianoRollInteraction 3/4 一致 (S3b-T54d)", () => {
  const PPB = 40;
  const SCROLL_X = 0;
  const viewRange = { startBar: 1, endBar: 8 };
  const tempoMap = new TempoMap([], [{ bar: 1, numerator: 3, denominator: 4 }]);

  it("T54d-①: barBeatToPixel(2,1).x === 3*ppb - scrollX（与网格 m2 线同位置） (critical)", () => {
    const h = renderInteraction(
      makeParams({ tempoMap, viewRange, pixelsPerBeat: PPB, scrollX: SCROLL_X })
    );
    const api = h.get();

    // m2 起点 qn = 3（1 小节 × 3 拍）→ x = 3*ppb。
    expect(api.barBeatToPixel(2, 1, 60).x).toBe(3 * PPB - SCROLL_X);
    // 同源交叉验证：timeline 的 barStartQn(2) 正是 3（网格 m2 线亦由它派生）。
    expect(createBarTimeline(tempoMap, viewRange).barStartQn(2)).toBe(3);
    h.unmount();
  });

  it("T54d-②: pixelToBarBeat(3*ppb) 反演回 {bar:2, beat:1} (critical)", () => {
    const h = renderInteraction(
      makeParams({ tempoMap, viewRange, pixelsPerBeat: PPB, scrollX: SCROLL_X })
    );
    const api = h.get();

    const r = api.pixelToBarBeat(3 * PPB - SCROLL_X, 0);
    expect(r.bar).toBe(2);
    expect(Math.abs(r.beat - 1)).toBeLessThan(1e-9);
    h.unmount();
  });

  it("T54d-③: 互逆——pixelToBarBeat(barBeatToPixel(b,t)) 误差 < 1e-9（b∈{1,2,3}, t∈{1,2,3,3.5}） (critical)", () => {
    const h = renderInteraction(
      makeParams({ tempoMap, viewRange, pixelsPerBeat: PPB, scrollX: SCROLL_X })
    );
    const api = h.get();

    for (const b of [1, 2, 3]) {
      // t = 3.5 覆盖 3/4 小节内的**最后一拍区间**（小节内坐标 beat ∈ [1, 4)，末拍为
      // (3,4)）——与 T54c/T54e 同一条「不得压扁末拍」的语义，此处以 3/4 再钉一次。
      for (const t of [1, 2, 3, 3.5]) {
        const { x } = api.barBeatToPixel(b, t, 60);
        const back = api.pixelToBarBeat(x, 0);
        expect(back.bar).toBe(b);
        expect(Math.abs(back.beat - t)).toBeLessThan(1e-9);
      }
    }
    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T54e：7/8 一致（beatsPerBarAt = 3.5，非 numerator = 7；末拍亚拍分辨率不被压扁）。
// ---------------------------------------------------------------------------
describe("usePianoRollInteraction 7/8 一致 (S3b-T54e)", () => {
  const PPB = 40;
  const SCROLL_X = 0;
  const viewRange = { startBar: 1, endBar: 8 };
  const tempoMap = new TempoMap([], [{ bar: 1, numerator: 7, denominator: 8 }]);

  it("T54e: 7/8 → barBeatToPixel(2,1).x === 3.5*ppb；反演回 {2,1}；末拍落点保持亚拍分辨率 (critical)", () => {
    // 领域事实：7 × 4 / 8 = 3.5（**不是** numerator = 7）。
    const tl = createBarTimeline(tempoMap, viewRange);
    expect(tl.beatsPerBarAt(1)).toBe(3.5);
    expect(tl.beatsPerBarAt(1)).not.toBe(7);

    const h = renderInteraction(
      makeParams({ tempoMap, viewRange, pixelsPerBeat: PPB, scrollX: SCROLL_X })
    );
    const api = h.get();

    // ① m2 起点 qn = 3.5 拍 → x = 3.5*ppb（与网格 m2 线同位置）。
    //    负控：若 beatsPerBar 误用 numerator=7，此处 x 会是 7*ppb → 变红。
    expect(api.barBeatToPixel(2, 1, 60).x).toBe(3.5 * PPB - SCROLL_X);

    // ② 反演：x = 3.5*ppb → 恰为 {bar:2, beat:1}。
    const r = api.pixelToBarBeat(3.5 * PPB - SCROLL_X, 0);
    expect(r.bar).toBe(2);
    expect(Math.abs(r.beat - 1)).toBeLessThan(1e-9);

    // ③ 末拍亚拍分辨率：x = 6.9*ppb 落在**第 2 小节最后一条网格线（6.5）之后、
    //    小节线（7）之前**——barBeatFromQn 的原始 beat = 6.9 − 3.5 + 1 = 4.4，
    //    位于该小节最后一拍之内（7/8 小节内坐标为 beat ∈ [1, 4.5)）。
    //    语义：**保持 4.4，不得压扁到 3.5**（上界 = beatsPerBar + 0.999 = 4.499 > 4.4）。
    //    若上界误写成 `beatsPerBarAt(bar)`（S3b 初版回归）→ 得 3.5 → 变红；
    //    若上界误用 numerator 系 → 此处虽不变，但 ① 已变红。
    const inLastBeat = api.pixelToBarBeat(6.9 * PPB - SCROLL_X, 0);
    expect(inLastBeat.bar).toBe(2);
    expect(inLastBeat.beat).toBeGreaterThan(3.5);
    expect(Math.abs(inLastBeat.beat - 4.4)).toBeLessThan(1e-9);

    // ④ 落点/渲染往返一致：把③的落点按渲染式（PianoRollView.tsx:417 的 timeline.qnOf）
    //    还原回像素，必须回到原点击位置（否则「双击末拍 → 音符左移」即用户可见回归）。
    const roundTripX = (tl.qnOf(inLastBeat.bar, inLastBeat.beat) - tl.barStartQn(1)) * PPB;
    expect(Math.abs(roundTripX - 6.9 * PPB)).toBeLessThan(1e-9);
    h.unmount();
  });
});
