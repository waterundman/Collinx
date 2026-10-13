/**
 * v2.3.0 Stage 2（S2）：谱面点击定位护栏。
 *
 * 覆盖三块交付物：
 *   T49 组件级真实链路：双谱表 7 小节 → 锚点就绪后向滚动容器派发 click，命中第 3
 *       小节 50% 位置 → onSeek 收到 `bar === 3` 且 beat 逐值正确。`scale=1 /
 *       scrollLeft=0` 与 `scale=2 / scrollLeft=120` 两组各测一次——后者证明点击换算
 *       确实「除以 scale 且加上 scrollLeft」。
 *   T50 往返互逆（unit）：7/8 拍（beatsPerBarAt = 3.5）下对 bar=3 的 4 个 fraction
 *       用 barBeatFromX 反演 beat，再用 playheadX 正向算回 x → x 回到原点；并断言
 *       beat ∈ [1, 4.5]。
 *   T50b 守卫/边界（unit）：空 anchors / 非有限 localX / beats<=0 / x1<=x0 → null；
 *       越界 clamp 语义。
 *
 * 渲染策略照抄既有先例（ScoreRenderer.anchors.test.tsx / ScorePlayhead.test.tsx）：
 *   jsdom + createRoot + act 手写；动态 import 用 vi.waitFor 轮询至就绪（外层不再
 *   包 act，避免 act 阻塞 waitFor 的轮询）。派发点击用 MouseEvent + bubbles 让
 *   事件冒泡到 React 根监听。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScoreRenderer } from "../ScoreRenderer";
import type { ScoreRendererLayout } from "../ScoreRenderer";
import { barBeatFromX } from "../bar-anchors";
import { planBarSlots } from "../bar-anchors";
import type { BarAnchor } from "../bar-anchors";
import { playheadX } from "../ScorePlayhead";
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

/** 与 ScoreRenderer 内部一致的锚点来源（startX=10, availableWidth=540, bars=7）。 */
function anchors7(): BarAnchor[] {
  return planBarSlots({ startX: 10, availableWidth: 540, bars: 7 }).map((s) => ({
    bar: s.bar,
    x0: s.x,
    x1: s.x + s.width,
  }));
}

const TOL = 1e-6;

// ---------------------------------------------------------------------------
// T49：组件级真实链路（点击 → onSeek）
// ---------------------------------------------------------------------------

describe("ScoreRenderer 点击定位 onSeek（Stage 2）", () => {
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

  /**
   * 对给定 scale/scrollLeft 完成一次「真实点击 → onSeek」往返。
   * clientX 由「目标未缩放内容坐标 + scrollLeft + scale」反推：
   *   clientX = (localX - scrollLeft) * scale + rect.left
   * 即 ScoreRenderer 内部换算 localX = (clientX - rect.left)/scale + scrollLeft 的逆。
   */
  async function clickAtBar3Half(scale: number, scrollLeft: number) {
    const seekCalls: { bar: number; beat: number }[] = [];
    const anchorCalls: BarAnchor[][] = [];

    const h = mount(
      <ScoreRenderer
        notes={sampleNotes()}
        layout={twoStaffLayout(7)}
        scale={scale}
        onBarAnchorsChange={(a) => anchorCalls.push(a)}
        onSeek={(p) => seekCalls.push(p)}
      />,
    );

    // 真实渲染完成、锚点就绪（两者同一渲染周期内到达）。
    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(anchorCalls.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    const anchors = anchorCalls[0];
    expect(anchors).toHaveLength(7);

    const container = h.container.querySelector<HTMLElement>('[class*="rendererContainer"]');
    expect(container).not.toBeNull();
    const el = container!;
    el.scrollLeft = scrollLeft;

    const a3 = anchors[2];
    expect(a3.bar).toBe(3);
    const fraction = 0.5;
    const localX = a3.x0 + fraction * (a3.x1 - a3.x0);
    const rectLeft = el.getBoundingClientRect().left;

    const clientX = (localX - scrollLeft) * scale + rectLeft;
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { clientX, bubbles: true }));
    });

    h.unmount();
    return { seekCalls, localX, clientX, rectLeft, scrollLeft, scale };
  }

  it("T49a: scale=1 / scrollLeft=0 —— 命中第 3 小节 50% → onSeek bar=3、beat=3（逐值） (critical)", async () => {
    const { seekCalls, clientX, localX } = await clickAtBar3Half(1, 0);

    // 恰好一次回调。
    expect(seekCalls).toHaveLength(1);

    // scale=1、scrollLeft=0 → clientX 就等于未缩放内容坐标 localX。
    expect(Math.abs(clientX - localX)).toBeLessThanOrEqual(TOL);

    const pos = seekCalls[0];
    // bar 逐值精确等于 3。
    expect(pos.bar).toBe(3);
    // beat 逐值：默认 4/4 → beatsPerBarAt(3) = 4 → beat = 1 + 0.5*4 = 3。
    expect(Number.isFinite(pos.beat)).toBe(true);
    expect(Math.abs(pos.beat - 3)).toBeLessThanOrEqual(TOL);
  });

  it("T49b: scale=2 / scrollLeft=120 —— 证明换算除以 scale 且加上 scrollLeft → onSeek bar=3、beat=3 (critical)", async () => {
    const { seekCalls, clientX, localX } = await clickAtBar3Half(2, 120);

    expect(seekCalls).toHaveLength(1);

    // 判别性：clientX 与 scale=1/scrollLeft=0 场景的 localX 明显不同（0 vs 120 偏移
    // 经 scale=2 放大），证明两组输入真的不同源。
    expect(Math.abs(clientX - localX)).toBeGreaterThan(1);
    // clientX 恰为逆换算结果：(localX - 120) * 2。
    expect(Math.abs(clientX - (localX - 120) * 2)).toBeLessThanOrEqual(TOL);

    const pos = seekCalls[0];
    expect(pos.bar).toBe(3);
    expect(Number.isFinite(pos.beat)).toBe(true);
    expect(Math.abs(pos.beat - 3)).toBeLessThanOrEqual(TOL);
  });

  it("T49c: 缺省 onSeek → 不绑定点击（派发点击不抛错、无任何回调），SVG 结构零变化 (critical)", async () => {
    // 传 onSeek 版本。
    const withSeek = mount(
      <ScoreRenderer notes={sampleNotes()} layout={twoStaffLayout(7)} onSeek={() => {}} />,
    );
    await vi.waitFor(() => expect(withSeek.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    const withCounts = withSeek.container.querySelectorAll("svg, g, path").length;
    withSeek.unmount();

    // 缺省 onSeek 版本。
    const noSeek = mount(<ScoreRenderer notes={sampleNotes()} layout={twoStaffLayout(7)} />);
    await vi.waitFor(() => expect(noSeek.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    const noCounts = noSeek.container.querySelectorAll("svg, g, path").length;

    // SVG 结构非平凡且逐值相等（缺省 onSeek 零行为变化）。
    expect(withCounts).toBeGreaterThan(0);
    expect(noCounts).toBe(withCounts);

    // 点击不传 onSeek 的容器：不抛错、无异常占位。
    const el = noSeek.container.querySelector<HTMLElement>('[class*="rendererContainer"]');
    expect(el).not.toBeNull();
    act(() => {
      el!.dispatchEvent(new MouseEvent("click", { clientX: 123, bubbles: true }));
    });
    expect(noSeek.container.textContent ?? "").not.toContain("VexFlow 渲染失败");

    noSeek.unmount();
  });
});

// ---------------------------------------------------------------------------
// T50 / T50b：barBeatFromX 纯函数
// ---------------------------------------------------------------------------

describe("barBeatFromX 反演纯函数（Stage 2）", () => {
  it("T50: 7/8（beatsPerBarAt=3.5）往返互逆 —— 反演 beat 再经 playheadX 正向算回 x 回到原点 (critical)", () => {
    const anchors = anchors7();
    const beatsPerBarAt = () => 3.5; // 7/8：7*4/8 = 3.5 四分音符/小节。
    const a3 = anchors[2];
    expect(a3.bar).toBe(3);

    // fraction → 期望 bar / beat（逐值表）。f=1 恰落在 a3.x1 === a4.x0，按 [x0, x1)
    // 语义归属下一小节 bar=4、beat=1（内联注释：这是区间半开边界的正当归属）。
    const cases: { f: number; expectBar: number; expectBeat: number }[] = [
      { f: 0, expectBar: 3, expectBeat: 1 },
      { f: 0.25, expectBar: 3, expectBeat: 1.875 },
      { f: 0.5, expectBar: 3, expectBeat: 2.75 },
      { f: 1, expectBar: 4, expectBeat: 1 },
    ];

    for (const { f, expectBar, expectBeat } of cases) {
      const localX = a3.x0 + f * (a3.x1 - a3.x0);
      const res = barBeatFromX({ anchors, localX, beatsPerBarAt });

      expect(res).not.toBeNull();
      const { bar, beat } = res!;

      // 逐值：bar 精确、beat 容差 1e-6。
      expect(bar).toBe(expectBar);
      expect(Number.isFinite(beat)).toBe(true);
      expect(Math.abs(beat - expectBeat)).toBeLessThanOrEqual(TOL);

      // beat 边界：恒在 [1, 1 + beatsPerBarAt] = [1, 4.5]。
      expect(beat).toBeGreaterThanOrEqual(1);
      expect(beat).toBeLessThanOrEqual(4.5);

      // 往返：正向 playheadX 算回 x → 回到原点（容差 1e-6）。
      const x = playheadX(anchors, { bar, beat }, beatsPerBarAt, 1);
      expect(x).not.toBeNull();
      expect(Math.abs((x as number) - localX)).toBeLessThanOrEqual(TOL);
    }

    // 判别性：同一 x 在 3.5 与 4 两种拍数语义下反演出的 beat 必须不同，
    // 证明确实使用了 beatsPerBarAt（而非硬编码 4）。
    const localX = a3.x0 + 0.5 * (a3.x1 - a3.x0);
    const beat35 = barBeatFromX({ anchors, localX, beatsPerBarAt: () => 3.5 })!.beat;
    const beat4 = barBeatFromX({ anchors, localX, beatsPerBarAt: () => 4 })!.beat;
    expect(Math.abs(beat35 - (1 + 0.5 * 3.5))).toBeLessThanOrEqual(TOL); // 2.75
    expect(Math.abs(beat4 - (1 + 0.5 * 4))).toBeLessThanOrEqual(TOL); // 3
    expect(Math.abs(beat35 - beat4)).toBeGreaterThan(TOL);
  });

  it("T50b: 守卫/边界 —— 空/非有限/beats<=0/x1<=x0 → null；越界 clamp 语义 (critical)", () => {
    const anchors = anchors7();
    const beats4 = () => 4;
    const a1 = anchors[0];
    const a7 = anchors[6];
    expect(a1.bar).toBe(1);
    expect(a7.bar).toBe(7);

    // --- 守卫：全部必须返回 null（且不得产出 NaN/Infinity）---

    // 1) anchors 为空。
    expect(barBeatFromX({ anchors: [], localX: 100, beatsPerBarAt: beats4 })).toBeNull();
    // 1b) anchors 为空 + clamp:false 同样 null。
    expect(
      barBeatFromX({ anchors: [], localX: 100, beatsPerBarAt: beats4, clamp: false }),
    ).toBeNull();

    // 2) localX 非有限。
    const midX = a1.x0 + 0.5 * (a1.x1 - a1.x0);
    expect(barBeatFromX({ anchors, localX: NaN, beatsPerBarAt: beats4 })).toBeNull();
    expect(barBeatFromX({ anchors, localX: Infinity, beatsPerBarAt: beats4 })).toBeNull();
    expect(barBeatFromX({ anchors, localX: -Infinity, beatsPerBarAt: beats4 })).toBeNull();

    // 3) beatsPerBarAt <= 0 或非有限 → null（不得产出 beat=1 或负 beat）。
    const zero = barBeatFromX({ anchors, localX: midX, beatsPerBarAt: () => 0 });
    expect(zero).toBeNull();
    const neg = barBeatFromX({ anchors, localX: midX, beatsPerBarAt: () => -3 });
    expect(neg).toBeNull();
    expect(barBeatFromX({ anchors, localX: midX, beatsPerBarAt: () => NaN })).toBeNull();
    expect(barBeatFromX({ anchors, localX: midX, beatsPerBarAt: () => Infinity })).toBeNull();

    // 4) x1 <= x0（零宽/塌缩锚点）→ null（无论 localX 落在何处）。
    const degenerate: BarAnchor[] = [{ bar: 1, x0: 100, x1: 100 }];
    expect(barBeatFromX({ anchors: degenerate, localX: 100, beatsPerBarAt: beats4 })).toBeNull();
    expect(barBeatFromX({ anchors: degenerate, localX: 50, beatsPerBarAt: beats4 })).toBeNull();
    expect(barBeatFromX({ anchors: degenerate, localX: 150, beatsPerBarAt: beats4 })).toBeNull();
    // x1 < x0 的逆序锚点同样 null。
    expect(
      barBeatFromX({ anchors: [{ bar: 1, x0: 120, x1: 100 }], localX: 110, beatsPerBarAt: beats4 }),
    ).toBeNull();

    // --- 越界 clamp 语义 ---

    // 首锚点左侧：默认钳制到首小节边界 beat=1。
    const leftClamp = barBeatFromX({ anchors, localX: a1.x0 - 50, beatsPerBarAt: beats4 });
    expect(leftClamp).not.toBeNull();
    expect(leftClamp!.bar).toBe(1);
    expect(leftClamp!.beat).toBe(1);
    expect(Number.isFinite(leftClamp!.beat)).toBe(true);

    // 末锚点右侧：默认钳制到末小节右缘 beat=beatsPerBarAt(7)=4。
    const rightClamp = barBeatFromX({ anchors, localX: a7.x1 + 50, beatsPerBarAt: beats4 });
    expect(rightClamp).not.toBeNull();
    expect(rightClamp!.bar).toBe(7);
    expect(rightClamp!.beat).toBe(4);
    expect(Number.isFinite(rightClamp!.beat)).toBe(true);

    // clamp:false → 两侧越界均返回 null。
    expect(
      barBeatFromX({ anchors, localX: a1.x0 - 50, beatsPerBarAt: beats4, clamp: false }),
    ).toBeNull();
    expect(
      barBeatFromX({ anchors, localX: a7.x1 + 50, beatsPerBarAt: beats4, clamp: false }),
    ).toBeNull();

    // 左钳制若目标小节 beats<=0 也须 null（不得回落 beat=1）。
    expect(
      barBeatFromX({ anchors, localX: a1.x0 - 50, beatsPerBarAt: () => 0 }),
    ).toBeNull();

    // --- 正当命中：区间内命中正确 bar，且 beat 恒有限 ---
    const hit4 = barBeatFromX({
      anchors,
      localX: anchors[3].x0 + 0.25 * (anchors[3].x1 - anchors[3].x0),
      beatsPerBarAt: beats4,
    });
    expect(hit4).not.toBeNull();
    expect(hit4!.bar).toBe(4);
    expect(Math.abs(hit4!.beat - 2)).toBeLessThanOrEqual(TOL); // 1 + 0.25*4
    expect(Number.isFinite(hit4!.beat)).toBe(true);
  });
});
