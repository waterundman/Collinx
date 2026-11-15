import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TempoMap, type Layout, type NoteEvent } from "@collinx/core";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ScorePanel } from "../ScorePanel";
import { ScoreRenderer, type ScoreRendererLayout } from "../ScoreRenderer";
import type { BarAnchor } from "../bar-anchors";

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

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: overrides.id ?? "n1",
    trackId: "melody",
    phraseId: null,
    bar: overrides.bar ?? 5,
    beat: overrides.beat ?? 1,
    durQn: overrides.durQn ?? 1,
    pitchMidi: overrides.pitchMidi ?? 60,
    pitchSpelling: overrides.pitchSpelling ?? "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
  };
}

const layout16: Layout = {
  id: "layout-16",
  name: "16 bars",
  type: "full_score",
  staves: [],
  players: [],
  pageWidth: 210,
  pageHeight: 297,
  margins: { top: 15, bottom: 15, left: 15, right: 15 },
  systemBreaks: [],
  globalStaffSize: 7,
  stavesPerPage: 10,
  staffDistance: 6,
  staffConfig: [
    { clef: "treble", name: "Treble", bars: 16 },
    { clef: "bass", name: "Bass", bars: 16 },
  ],
};

const rendererLayout8: ScoreRendererLayout = {
  staffConfig: [{ clef: "treble", name: "Treble", bars: 8 }],
};

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
      act(() => root.render(next));
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeAll(stubBrowserApis);
afterEach(() => {
  document.body.innerHTML = "";
});

describe("ScorePanel 紧凑焦点窗", () => {
  it("默认只渲染 4 小节，播放头离开窗口后平移到对应 4 小节", async () => {
    const build = (playheadPosition?: { bar: number; beat: number }) => (
      <I18nProvider>
        <ScorePanel
          layout={layout16}
          notes={[makeNote({ bar: 1 }), makeNote({ bar: 7, id: "n7" })]}
          compact
          focusBars={4}
          playheadPosition={playheadPosition}
        />
      </I18nProvider>
    );

    const h = mount(build({ bar: 1, beat: 1 }));
    const panel = () => h.container.querySelector<HTMLElement>('[data-testid="score-panel"]')!;

    expect(panel().dataset.pageStartBar).toBe("1");
    expect(panel().dataset.pageBars).toBe("4");
    expect(panel().dataset.pageCount).toBe("4");
    expect(h.container.querySelector('[data-testid="score-focus-range"]')?.textContent).toContain(
      "1–4",
    );

    h.rerender(build({ bar: 9, beat: 1 }));
    await vi.waitFor(() => expect(panel().dataset.pageStartBar).toBe("9"));
    expect(panel().dataset.pageIndex).toBe("2");
    expect(h.container.querySelector('[data-testid="score-focus-range"]')?.textContent).toContain(
      "9–12",
    );

    h.cleanup();
  });
});

describe("ScoreRenderer 逐小节拍号", () => {
  it("中途 6/8 的播放头插值按该小节 3 个四分音符，而不是首小节 4/4", async () => {
    const tempoMap = new TempoMap(
      [],
      [
        { bar: 1, numerator: 4, denominator: 4 },
        { bar: 5, numerator: 6, denominator: 8 },
      ],
    );
    const anchors: BarAnchor[][] = [];
    const h = mount(
      <ScoreRenderer
        notes={[makeNote({ bar: 5, beat: 1 })]}
        layout={rendererLayout8}
        tempoMap={tempoMap}
        playheadPosition={{ bar: 5, beat: 2 }}
        onBarAnchorsChange={(a) => anchors.push(a)}
      />,
    );

    await vi.waitFor(() => expect(h.container.querySelector("svg")).not.toBeNull(), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(anchors.length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });
    await vi.waitFor(
      () =>
        expect(
          h.container.querySelector('[data-testid="score-playhead"]'),
        ).not.toBeNull(),
      { timeout: 5000 },
    );

    const list = anchors[anchors.length - 1];
    const bar5 = list.find((a) => a.bar === 5)!;
    const left = Number.parseFloat(
      h.container.querySelector<HTMLElement>('[data-testid="score-playhead"]')!.style.left,
    );
    const width = bar5.x1 - bar5.x0;

    // beat 从 1 起；6/8 每小节 3 个四分音符 → fraction = (2-1)/3。
    expect(left).toBeCloseTo(bar5.x0 + width / 3, 3);
    // 旧式 meterAt(1)=4/4 会得到 1/4 —— 该负控保证本用例真的敏感。
    expect(left).not.toBeCloseTo(bar5.x0 + width / 4, 3);

    h.cleanup();
  });
});
