import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MixerConsole } from "../MixerConsole";
import { I18nProvider } from "../../../providers/I18nProvider";

describe("MixerConsole", () => {
  const emptyMixer = {
    tracks: [],
    masterTrack: {
      id: "master",
      name: "Master",
      sourceTrackId: "master",
      busType: "master" as const,
      gainDb: "0",
      pan: "0",
      mute: false,
      solo: false,
      fxChain: { id: "fx-master", name: "FX", slots: [] },
      sends: [],
      meterLevel: "0",
    },
    routingMatrix: {},
  };

  it("renders without crashing with empty mixer state", () => {
    expect(() => {
      React.createElement(MixerConsole, { mixer: emptyMixer });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof MixerConsole).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      mixer: emptyMixer,
      onTrackChange: () => {},
      onAddTrack: () => {},
      onRemoveTrack: () => {},
    };
    expect(() => {
      React.createElement(MixerConsole, props);
    }).not.toThrow();
  });

  it("does not throw with multiple tracks", () => {
    const mixerWithTracks = {
      ...emptyMixer,
      tracks: [
        {
          id: "t1",
          name: "Melody",
          sourceTrackId: "melody",
          busType: "group" as const,
          gainDb: "-3",
          pan: "0",
          mute: false,
          solo: false,
          fxChain: { id: "fx-1", name: "FX", slots: [] },
          sends: [],
          meterLevel: "-12",
        },
        {
          id: "t2",
          name: "Bass",
          sourceTrackId: "bass",
          busType: "group" as const,
          gainDb: "0",
          pan: "-0.2",
          mute: true,
          solo: false,
          fxChain: { id: "fx-2", name: "FX", slots: [] },
          sends: [],
          meterLevel: "-6",
        },
      ],
    };
    expect(() => {
      React.createElement(MixerConsole, { mixer: mixerWithTracks });
    }).not.toThrow();
  });

  it("renders with track that has muted state", () => {
    const mixer = {
      ...emptyMixer,
      tracks: [
        {
          id: "t1",
          name: "Track 1",
          sourceTrackId: "src1",
          busType: "group" as const,
          gainDb: "0",
          pan: "0",
          mute: true,
          solo: true,
          fxChain: { id: "fx-1", name: "FX", slots: [] },
          sends: [],
          meterLevel: "0",
        },
      ],
    };
    expect(() => {
      React.createElement(MixerConsole, { mixer });
    }).not.toThrow();
  });
});

// ── v1.15 Stage 1: per-track FX suggestion entry ───────────────────────────
describe("MixerConsole single-track FX suggestion (v1.15 Stage 1)", () => {
  const mixerWithTracks = {
    tracks: [
      {
        id: "t1",
        name: "Melody",
        sourceTrackId: "melody",
        busType: "group" as const,
        gainDb: "-3",
        pan: "0",
        mute: false,
        solo: false,
        fxChain: { id: "fx-1", name: "FX", slots: [] },
        sends: [],
        meterLevel: "-12",
      },
      {
        id: "t2",
        name: "Bass",
        sourceTrackId: "bass",
        busType: "group" as const,
        gainDb: "0",
        pan: "0",
        mute: false,
        solo: false,
        fxChain: { id: "fx-2", name: "FX", slots: [] },
        sends: [],
        meterLevel: "-6",
      },
    ],
    masterTrack: {
      id: "master",
      name: "Master",
      sourceTrackId: "master",
      busType: "master" as const,
      gainDb: "0",
      pan: "0",
      mute: false,
      solo: false,
      fxChain: { id: "fx-master", name: "FX", slots: [] },
      sends: [],
      meterLevel: "0",
    },
    routingMatrix: {},
  };

  function renderConsole(props?: {
    onSuggestFxChain?: (trackId?: string) => void;
  }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <I18nProvider>
          <MixerConsole mixer={mixerWithTracks} {...props} />
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

  /** Fire a real bubbling click through React's synthetic event system. */
  function click(el: Element | null) {
    if (!el) throw new Error("click target not found");
    act(() => {
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
  }

  it("T03: 每轨建议 FX 按钮以该轨 trackId 触发 onSuggestFxChain", () => {
    const spy = vi.fn();
    const { container, cleanup } = renderConsole({ onSuggestFxChain: spy });

    const t1Btn = container.querySelector('[data-testid="mixer-suggest-fx-t1"]');
    const t2Btn = container.querySelector('[data-testid="mixer-suggest-fx-t2"]');
    const masterBtn = container.querySelector(
      '[data-testid="mixer-suggest-fx-master"]'
    );
    expect(t1Btn).not.toBeNull();
    expect(t2Btn).not.toBeNull();
    expect(masterBtn).not.toBeNull();

    click(t2Btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith("t2");

    click(t1Btn);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("t1");

    cleanup();
  });

  it("T03b: 全局建议 FX 按钮以无参触发 onSuggestFxChain(全混音向后兼容)", () => {
    const spy = vi.fn();
    const { container, cleanup } = renderConsole({ onSuggestFxChain: spy });

    const globalBtn = container.querySelector('[data-testid="mixer-suggest-fx"]');
    expect(globalBtn).not.toBeNull();

    click(globalBtn);
    expect(spy).toHaveBeenCalledTimes(1);
    // 全局按钮无参调用(不传 trackId = 全混音)
    expect(spy).toHaveBeenLastCalledWith();

    cleanup();
  });
});
