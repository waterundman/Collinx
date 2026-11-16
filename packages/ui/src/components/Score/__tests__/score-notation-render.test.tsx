/**
 * v3.3.0：谱面排布（连音线 / 时值区间）的**渲染级**护栏。
 *
 * 为什么单独一个文件：`notation.test.ts` 只证明纯函数算得对，证明不了渲染器
 * **把结果接上了**。本文件断言真实 VexFlow SVG 的几何，覆盖三件用户可见的事：
 *
 * - T1 跨小节音符被切成两段，且连音线**跨越小节线**（旧实现画成一个超长音符，
 *   根本没有连音线）；
 * - T2 负控：两个同音高、首尾相接的独立音符**不**得连音（旧实现无连音，
 *   新实现若按"音高相同就连"就会误连）；
 * - T3 同拍不同时值（旋律 q + 和弦 w）必须**纵向对齐**，而不是被串行排到下一拍；
 * - T4 和弦附点必须落在**每个**键位上（`{all:true}`）。
 *
 * 几何基准：`computeStaveWidth(4) = 550`、左内边距 10、可分配宽 540 → 每小节
 * 135px，故第 1 条小节线在 x=145、第 2 条在 x=280。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NoteEvent } from "@collinx/core";
import { ScoreRenderer } from "../ScoreRenderer";
import type { ScoreRendererLayout } from "../ScoreRenderer";

// ---------------------------------------------------------------------------
// harness（照抄 ScoreRenderer.test.tsx 的最小可用集）
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
    value: class {
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
      act(() => root.unmount());
      container.remove();
    },
  };
}

const layout: ScoreRendererLayout = {
  staffConfig: [{ clef: "treble", name: "Treble", bars: 4 }],
};

/** 单谱表 4 小节布局的几何：见文件头。 */
const BAR_1_RIGHT = 145;
const BAR_2_RIGHT = 280;

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: overrides.id ?? "note",
    trackId: overrides.trackId ?? "track-1",
    phraseId: null,
    bar: overrides.bar ?? 1,
    beat: overrides.beat ?? 1,
    durQn: overrides.durQn ?? 1,
    pitchMidi: overrides.pitchMidi ?? 60,
    pitchSpelling: overrides.pitchSpelling ?? "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
  };
}

/**
 * 等**渲染真正完成**（`data-render-state="ready"`）。
 *
 * ⚠️ 不能只等 `container.querySelector("svg")`：VexFlow 在 `renderer.resize()`
 * 时就把 `<svg>` 插进 DOM 了，而连音线是在所有小节绘制完成后才画的 —— 只等 svg
 * 会在「谱表已画、连音线未画」的中间态采样（实测：`.vf-stavetie` 组存在但查询
 * 结果为空）。`ready` 是渲染函数**最后**一步设置的，语义上就是"全部完成"。
 */
async function waitForReady(container: HTMLElement) {
  await vi.waitFor(
    () => {
      const el = container.querySelector('[data-render-state="ready"]');
      expect(el).not.toBeNull();
      expect(el!.querySelector("svg")).not.toBeNull();
    },
    { timeout: 5000 },
  );
}

/**
 * 读取所有**音符头**的 x 坐标。
 *
 * VexFlow 5 用字形 `<text>` 画符头，且休止符与符头共用 `.vf-notehead` 组 ——
 * 只能靠字形码位区分：符头在 SMuFL 的 noteheads 区（U+E0A2 whole / E0A3 half /
 * E0A4 black），休止符在 U+E4E3..（wholeRest/quarterRest…）。
 */
function noteheadXs(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll(".vf-notehead"))
    .map((g) => {
      const text = g.querySelector("text");
      const code = text?.textContent?.codePointAt(0) ?? 0;
      if (code < 0xe0a0 || code > 0xe0a5) return null;
      return Number(text?.getAttribute("x"));
    })
    .filter((x): x is number => x !== null && Number.isFinite(x));
}

afterEach(() => {
  document.body.innerHTML = "";
});

beforeAll(() => {
  stubBrowserApis();
});

// ---------------------------------------------------------------------------

describe("v3.3.0 跨小节音符 → 切分 + 连音线", () => {
  it("T1: bar1 末拍起 2 拍的音被切成两段，连音线跨过小节线", async () => {
    const notes = [makeNote({ bar: 1, beat: 4, durQn: 2, pitchMidi: 60 })];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);

    const ties = Array.from(h.container.querySelectorAll(".vf-stavetie path"));
    expect(ties).toHaveLength(1);
    const d = ties[0]!.getAttribute("d") ?? "";
    const xs = Array.from(d.matchAll(/[M,Q]\s*([-\d.]+)\s+[-\d.]+/g)).map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThanOrEqual(2);
    const start = Math.min(...xs);
    const end = Math.max(...xs);
    // 起点在第 1 小节内、终点在第 2 小节内 —— 即连音线真的跨过了小节线。
    expect(start).toBeLessThan(BAR_1_RIGHT);
    expect(end).toBeGreaterThan(BAR_1_RIGHT);
    expect(end).toBeLessThan(BAR_2_RIGHT);

    // 归桶回归：第 2 段必须落在第 2 小节，不能被塞回第 1 小节。
    const xsHeads = noteheadXs(h.container);
    expect(xsHeads.filter((x) => x < BAR_1_RIGHT)).toHaveLength(1);
    expect(xsHeads.filter((x) => x > BAR_1_RIGHT && x < BAR_2_RIGHT)).toHaveLength(1);

    h.cleanup();
  });

  it("T2 负控：同音高但首尾相接的两个独立音符不连音", async () => {
    const notes = [
      makeNote({ id: "a", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
      makeNote({ id: "b", bar: 1, beat: 2, durQn: 1, pitchMidi: 60 }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);
    // 没有连音线 —— 说明"连音"来自**同一个逻辑音被切分**，不是"音高相同"。
    expect(h.container.querySelectorAll(".vf-stavetie")).toHaveLength(0);
    h.cleanup();
  });
});

describe("v3.3.0 同拍不同时值 → 分声部后纵向对齐", () => {
  it("T3: 全音符和弦 + 同拍四分音符 → 两个符头 x 几乎相同（不是串行排到下一拍）", async () => {
    const notes = [
      makeNote({ id: "w", bar: 1, beat: 1, durQn: 4, pitchMidi: 60 }),
      makeNote({ id: "q", bar: 1, beat: 1, durQn: 1, pitchMidi: 72, pitchSpelling: "C5" }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);

    const xs = noteheadXs(h.container).filter((x) => x < BAR_1_RIGHT);
    // 第 1 小节只有这两个音（其余是休止，已被 noteheadXs 过滤）。
    expect(xs.length).toBeGreaterThanOrEqual(2);
    const sorted = xs.slice(0, 2).sort((a, b) => a - b);
    // 同一拍的音必须纵向对齐：x 差小于一个八分音符的跨度（≈17px），
    // 旧实现把它们串行排开，x 差会超过 30px。
    expect(sorted[1]! - sorted[0]!).toBeLessThan(17);
    // 负控：第二个音不得被推到第 2 拍以后
    expect(sorted[1]!).toBeLessThan(BAR_1_RIGHT - 60);

    h.cleanup();
  });
});

describe("v3.3.0 附点必须落在每个键位上", () => {
  it("T4: 三音和弦的附点二分 → 3 个附点（不是只点第一个音）", async () => {
    const notes = [
      makeNote({ id: "a", bar: 2, beat: 1, durQn: 3, pitchMidi: 55 }),
      makeNote({ id: "b", bar: 2, beat: 1, durQn: 3, pitchMidi: 59 }),
      makeNote({ id: "c", bar: 2, beat: 1, durQn: 3, pitchMidi: 62 }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);

    // 附点没有独立的 CSS 类（`Dot.draw` 直接 fillText），只能按字形码位识别：
    // U+E1E7 = SMuFL augmentationDot。
    const dots = Array.from(h.container.querySelectorAll("text")).filter(
      (t) => t.textContent?.codePointAt(0) === 0xe1e7,
    );
    expect(dots).toHaveLength(3);
    h.cleanup();
  });
});

describe("v3.3.0 分梁：可连梁片段必须先切分", () => {
  it("T5: `四分 → 八分 → 八分 → 四分` 的两个八分音符连到同一条梁上", async () => {
    // 回归背景：`Beam.generateBeams` 按 `groups`（4/4 半小节）分桶后，**桶内只要
    // 有一个四分及更长的音就整桶作废**。这两个八分音符与前后两个四分音符同处
    // 一个半小节桶 → 旧实现一条梁都画不出来（谱面上各自挂符尾）。对照用例
    // `二分 → 八分 → 八分` 反而能连上 —— 所以这个用例必须用「中间夹八分」的形态。
    const notes = [
      makeNote({ id: "1", bar: 1, beat: 1, durQn: 1, pitchMidi: 64, pitchSpelling: "E4" }),
      makeNote({ id: "2", bar: 1, beat: 2, durQn: 0.5, pitchMidi: 66, pitchSpelling: "F#4" }),
      makeNote({ id: "3", bar: 1, beat: 2.5, durQn: 0.5, pitchMidi: 67, pitchSpelling: "G4" }),
      makeNote({ id: "4", bar: 1, beat: 3, durQn: 1, pitchMidi: 69, pitchSpelling: "A4" }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);

    const beams = Array.from(h.container.querySelectorAll(".vf-beam"));
    expect(beams).toHaveLength(1);
    // 梁只覆盖那两个八分音符：其 x 跨度必须小于一个二分音符（≈2 拍 ≈ 67px）。
    // jsdom 无排版，`getBoundingClientRect()` 恒为 0 —— 只能读几何路径的坐标。
    const d = beams[0]!.querySelector("path")?.getAttribute("d") ?? "";
    const xs = Array.from(d.matchAll(/[-\d.]+/g)).map((m) => Number(m[0]));
    expect(xs.length).toBeGreaterThan(3);
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThan(0);
    expect(span).toBeLessThan(67);

    h.cleanup();
  });

  it("T5b 负控：`四分 → 八分 → 八分停顿 → 八分` 里被休止隔开的两个八分音符不连梁", async () => {
    // beat 2.5 与 beat 4 之间隔着 beat 3 起的休止（fillVoiceRests 补齐）→
    // 两个八分音符不首尾相接，绝不能连成一条梁跨过休止。
    const notes = [
      makeNote({ id: "1", bar: 1, beat: 1, durQn: 1, pitchMidi: 64, pitchSpelling: "E4" }),
      makeNote({ id: "2", bar: 1, beat: 2, durQn: 0.5, pitchMidi: 66, pitchSpelling: "F#4" }),
      makeNote({ id: "3", bar: 1, beat: 2.5, durQn: 0.5, pitchMidi: 67, pitchSpelling: "G4" }),
      makeNote({ id: "4", bar: 1, beat: 4, durQn: 0.5, pitchMidi: 69, pitchSpelling: "A4" }),
      makeNote({ id: "5", bar: 1, beat: 4.5, durQn: 0.5, pitchMidi: 71, pitchSpelling: "B4" }),
    ];
    const h = mount(<ScoreRenderer notes={notes} layout={layout} />);
    await waitForReady(h.container);

    // 两条梁：{F#4,G4} 与 {A4,B4}；不得合成一条跨休止的长梁。
    const beams = Array.from(h.container.querySelectorAll(".vf-beam"));
    expect(beams).toHaveLength(2);

    h.cleanup();
  });
});

describe("v3.3.0 空小节的整小节休止符必须居中", () => {
  it("T6: 空小节的整小节休止符落在小节中线（不是贴左小节线）", async () => {
    const h = mount(<ScoreRenderer notes={[]} layout={layout} />);
    await waitForReady(h.container);

    // U+E4E3 = SMuFL wholeRest
    const rests = Array.from(h.container.querySelectorAll("text"))
      .filter((t) => t.textContent?.codePointAt(0) === 0xe4e3)
      .map((t) => Number(t.getAttribute("x")))
      .sort((a, b) => a - b);
    expect(rests).toHaveLength(4);

    // 每小节 135px（见文件头），bar n 的左缘 = 10 + (n-1)*135，中线 +67.5。
    // 旧实现（未开 centerAlignment）会把休止符摆在小节内容区起点 ≈ 左缘 +12，
    // 与中线差 55px —— 本断言以 ±25px 把两种行为分开。
    rests.forEach((x, i) => {
      const barLeft = 10 + i * 135;
      expect(Math.abs(x - (barLeft + 67.5))).toBeLessThan(25);
    });

    h.cleanup();
  });
});
