import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrchestratorPanel, type OrchestratorConfig } from "../OrchestratorPanel";
import type { RegisterConflict } from "../OrchestratorPanel";
import type { HarmonyEntry } from "@collinx/core";
import { I18nProvider } from "../../../providers/I18nProvider";

interface PanelHarness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderPanel(props: {
  conflicts?: RegisterConflict[];
  onOrchestrate?: (config: OrchestratorConfig) => void;
  harmony?: HarmonyEntry[];
  runCounts?: Record<string, number>;
}): PanelHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <OrchestratorPanel
          harmony={props.harmony ?? []}
          conflicts={props.conflicts}
          onOrchestrate={props.onOrchestrate}
          runCounts={props.runCounts}
        />
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

/** Deterministic harmony literal (C major: I - V7), matching what App's
 *  notesToHarmonyEntries derivation produces for C4/E4/G4 + G4/B4/D5/F5. */
function makeHarmony(): HarmonyEntry[] {
  return [
    {
      bar: 1,
      beat: 1,
      chord: { root: "C", quality: "maj" },
      durationQn: 4,
      romanNumeral: "I",
    },
    {
      bar: 2,
      beat: 1,
      chord: { root: "G", quality: "dom7" },
      durationQn: 4,
      romanNumeral: "V",
    },
  ];
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OrchestratorPanel (Stage 0: real conflicts edge cases)", () => {
  it("无 conflicts prop(undefined)时正常渲染,不显示冲突区", () => {
    const { container, cleanup } = renderPanel({});

    // Panel mounts and renders the control sections.
    expect(
      container.querySelector('[data-testid="orchestrator-panel"]')
    ).not.toBeNull();
    // No conflict section before any run (undefined conflicts).
    expect(container.textContent).not.toContain("conflictDetection");
    expect(container.querySelectorAll('[class*="conflictList"]').length).toBe(0);

    cleanup();
  });

  it("runOrchestrator 结果 conflicts 为空数组(无冲突)→ UI 正常,不渲染冲突区", () => {
    const { container, cleanup } = renderPanel({ conflicts: [] });

    // The panel still mounts with the empty conflicts boundary value.
    expect(
      container.querySelector('[data-testid="orchestrator-panel"]')
    ).not.toBeNull();
    // Empty conflicts render no conflict cards (error or warning) and no
    // conflict section at all — the closed loop handles "no conflicts"
    // gracefully instead of crashing or showing stale entries.
    // (CSS modules hash class names, so match on the base name suffix.)
    expect(
      container.querySelectorAll('[class*="conflictCardError"]').length
    ).toBe(0);
    expect(
      container.querySelectorAll('[class*="conflictCardWarn"]').length
    ).toBe(0);
    expect(container.textContent).not.toContain("conflictDetection");

    cleanup();
  });

  it("conflicts 非空时渲染 error/warning 冲突卡片", () => {
    const errorConflict: RegisterConflict = {
      type: "range_violation",
      players: ["violin", ""],
      bar: 1,
      beat: 1,
      description: "Violin note below register",
      severity: "error",
      suggestion: "Raise an octave",
    };
    const warningConflict: RegisterConflict = {
      type: "overlap",
      players: ["violin", "viola"],
      bar: 2,
      beat: 3,
      description: "Violin/Viola overlap",
      severity: "warning",
      suggestion: "Narrow the gap",
    };

    const { container, cleanup } = renderPanel({
      conflicts: [errorConflict, warningConflict],
    });

    // Both severity buckets render their own cards. (CSS modules hash class
    // names, so match on the base name suffix.)
    expect(
      container.querySelectorAll('[class*="conflictCardError"]').length
    ).toBe(1);
    expect(
      container.querySelectorAll('[class*="conflictCardWarn"]').length
    ).toBe(1);
    expect(container.textContent).toContain("Violin note below register");
    expect(container.textContent).toContain("Raise an octave");
    expect(container.textContent).toContain("Violin/Viola overlap");
    expect(container.textContent).toContain("Narrow the gap");

    cleanup();
  });

  it("选中预设后 runOrchestrate 触发 onOrchestrate 回调(真实 action 路径)", () => {
    const onOrchestrate = vi.fn();
    // Harmony present so the orchestrate button is enabled (v1.22.0).
    const { container, cleanup } = renderPanel({
      onOrchestrate,
      harmony: makeHarmony(),
    });

    // Apply the string quartet preset so players are selected.
    const presetBtn = container.querySelector(
      '[data-testid="orchestrator-preset-string_quartet"]'
    );
    expect(presetBtn).not.toBeNull();
    act(() => {
      presetBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    const runBtn = container.querySelector('[data-testid="orchestrator-run"]');
    expect(runBtn).not.toBeNull();
    act(() => {
      runBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(onOrchestrate).toHaveBeenCalledTimes(1);
    const config = onOrchestrate.mock.calls[0][0];
    // The panel stores players in a Set, so the duplicated "violin" in the
    // string-quartet preset collapses to one entry: 3 unique instruments.
    expect(config.players).toEqual(["violin", "viola", "cello"]);
    expect(config.style).toBe("classical");
    expect(config.playabilityPolicy).toBe("moderate");
    expect(typeof config.doubleOctaves).toBe("boolean");

    cleanup();
  });
});

// ── v1.22.0 Stage 1: real harmony strip + empty state + real run counts ──
describe("OrchestratorPanel (v1.22.0 Stage 1: harmony wiring)", () => {
  it("T02: 真实 HarmonyEntry[] 渲染和声带(m{bar} + 和弦符号 + RN 附注)", () => {
    const { container, cleanup } = renderPanel({ harmony: makeHarmony() });

    const strip = container.querySelector(
      '[data-testid="orchestrator-harmony-strip"]'
    );
    expect(strip).not.toBeNull();
    const items = container.querySelectorAll(
      '[data-testid="orchestrator-harmony-item"]'
    );
    expect(items.length).toBe(2);
    // formatChordSymbol: {root:"C",quality:"maj"} → "C"; dom7 → "7".
    expect(items[0].textContent).toBe("m1 C (I)");
    expect(items[1].textContent).toBe("m2 G7 (V)");
    // Empty state must NOT render when real entries exist.
    expect(
      container.querySelector('[data-testid="orchestrator-harmony-empty"]')
    ).toBeNull();

    cleanup();
  });

  it("T03: 空 harmony → 空态 + orchestrate 按钮 disabled", () => {
    const onOrchestrate = vi.fn();
    const { container, cleanup } = renderPanel({
      harmony: [],
      onOrchestrate,
    });

    expect(
      container.querySelector('[data-testid="orchestrator-harmony-empty"]')
    ).not.toBeNull();
    // No harmony items in the empty state.
    expect(
      container.querySelectorAll('[data-testid="orchestrator-harmony-item"]').length
    ).toBe(0);

    // Select players so the run button exists, then it must be disabled.
    const presetBtn = container.querySelector(
      '[data-testid="orchestrator-preset-string_quartet"]'
    );
    act(() => {
      presetBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    const runBtn = container.querySelector(
      '[data-testid="orchestrator-run"]'
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();
    expect(runBtn!.disabled).toBe(true);

    cleanup();
  });

  it("T03b: 有 harmony 时 orchestrate 按钮可用(disabled 解除)", () => {
    const { container, cleanup } = renderPanel({ harmony: makeHarmony() });

    const presetBtn = container.querySelector(
      '[data-testid="orchestrator-preset-string_quartet"]'
    );
    act(() => {
      presetBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    const runBtn = container.querySelector(
      '[data-testid="orchestrator-run"]'
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();
    expect(runBtn!.disabled).toBe(false);

    cleanup();
  });

  it("T05: voice preview 显示 runCounts 真实计数(非随机占位)", () => {
    const { container, cleanup } = renderPanel({
      harmony: makeHarmony(),
      runCounts: { violin: 8, viola: 5, cello: 3 },
    });

    const presetBtn = container.querySelector(
      '[data-testid="orchestrator-preset-string_quartet"]'
    );
    act(() => {
      presetBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    const counts = Array.from(
      container.querySelectorAll('[class*="voiceCount"]')
    ).map((el) => el.textContent ?? "");
    expect(counts.length).toBe(3);
    // Deterministic real counts from the last run — no random values.
    expect(counts).toContain("8 Notes");
    expect(counts).toContain("5 Notes");
    expect(counts).toContain("3 Notes");

    // Not run yet for a newly selected player → 0 notes placeholder.
    cleanup();
  });

  it("T05b: 未运行时 voice preview 显示 0 notes 占位", () => {
    const { container, cleanup } = renderPanel({ harmony: makeHarmony() });

    const presetBtn = container.querySelector(
      '[data-testid="orchestrator-preset-string_quartet"]'
    );
    act(() => {
      presetBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    const counts = Array.from(
      container.querySelectorAll('[class*="voiceCount"]')
    ).map((el) => el.textContent ?? "");
    expect(counts).toEqual(["0 Notes", "0 Notes", "0 Notes"]);

    cleanup();
  });
});

// ── v1.23.0 Stage 1 (D2-1): multi-entry bar → m{bar}.{beat} strip labels ──
describe("OrchestratorPanel (v1.23.0 Stage 1: harmony strip bar.beat labels)", () => {
  /** S0 chordify slice reduction: a half-bar C→G7 progression in bar 1 now
   *  yields two HarmonyEntry slices (beat 1 C maj + beat 3 G7 dom7). The
   *  strip label switches from `m{bar}` to `m{bar}.{beat}` for each slice so
   *  both are uniquely addressed. Single-entry bars stay `m{bar}` (v1.22.0
   *  backward-compat assertions in T02 above must still pass unchanged). */
  function makeMultiEntryHarmony(): HarmonyEntry[] {
    return [
      {
        bar: 1,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 2,
        romanNumeral: "I",
      },
      {
        bar: 1,
        beat: 3,
        chord: { root: "G", quality: "dom7" },
        durationQn: 2,
        romanNumeral: "V",
      },
      {
        bar: 2,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      },
    ];
  }

  it("S1-T01a: 同 bar 多 entry → m1.1 / m1.3 标签;单 entry bar → m2 (critical)", () => {
    const { container, cleanup } = renderPanel({
      harmony: makeMultiEntryHarmony(),
    });

    const items = container.querySelectorAll(
      '[data-testid="orchestrator-harmony-item"]'
    );
    expect(items.length).toBe(3);
    // Bar 1 has two entries → each slice addressed as m1.1 / m1.3.
    expect(items[0].textContent).toBe("m1.1 C (I)");
    expect(items[1].textContent).toBe("m1.3 G7 (V)");
    // Bar 2 has a single entry → m2 (backward compatible with v1.22.0).
    expect(items[2].textContent).toBe("m2 C (I)");

    cleanup();
  });

  it("S1-T01b: 单 entry per bar → m{bar} (v1.22 断言不变,回归保护)", () => {
    // Two bars, one entry each — the v1.22.0 T02 case must still hold.
    const { container, cleanup } = renderPanel({ harmony: makeHarmony() });

    const items = container.querySelectorAll(
      '[data-testid="orchestrator-harmony-item"]'
    );
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("m1 C (I)");
    expect(items[1].textContent).toBe("m2 G7 (V)");

    cleanup();
  });
});
