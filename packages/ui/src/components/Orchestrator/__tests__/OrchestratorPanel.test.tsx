import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrchestratorPanel, type OrchestratorConfig } from "../OrchestratorPanel";
import type { RegisterConflict } from "../OrchestratorPanel";
import { I18nProvider } from "../../../providers/I18nProvider";

interface PanelHarness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderPanel(props: {
  conflicts?: RegisterConflict[];
  onOrchestrate?: (config: OrchestratorConfig) => void;
}): PanelHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <OrchestratorPanel
          harmony={[]}
          conflicts={props.conflicts}
          onOrchestrate={props.onOrchestrate}
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
    const { container, cleanup } = renderPanel({ onOrchestrate });

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
