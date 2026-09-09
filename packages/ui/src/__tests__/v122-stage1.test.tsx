import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";
import type { ProjectStoreValue } from "../store/project-store";
import { createNoteEvent } from "@collinx/core";
import en from "../i18n/locales/en.json";
import zhCN from "../i18n/locales/zh-CN.json";

// ---------------------------------------------------------------------------
// v1.22.0 Stage 1: App-level wiring tests.
//
// 1. The App derives harmonyEntries from the chords track (core
//    notesToHarmonyEntries) and the OrchestratorPanel renders the real
//    progression (formatChordSymbol + romanNumeral), never demo data.
// 2. Clearing the chords track shows the empty state and disables the
//    orchestrate button.
// 3. A real orchestrator run feeds the voice preview with perPlayerNotes
//    counts (the old Math.random placeholder is gone).
// 4. en/zh-CN i18n key structures stay symmetric (v1.16 pattern).
// ---------------------------------------------------------------------------

let captured: ProjectStoreValue | null = null;

function StoreProbe() {
  captured = useProjectStore();
  return null;
}

function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <ThemeProvider>
            <ProjectProvider>
              <App />
              <StoreProbe />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
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
      captured = null;
    },
  };
}

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Removes every chords-track note (the demo project seeds some) so a test
 *  can lay down its own deterministic progression. */
function clearChordsTrack() {
  const store = captured!;
  for (const n of store.notes.filter((n) => n.trackId === "chords")) {
    store.actions.deleteNote(n.id);
  }
}

function addChordNotes() {
  const store = captured!;
  const spec = [
    { bar: 1, pitchMidi: 60, pitchSpelling: "C4" },
    { bar: 1, pitchMidi: 64, pitchSpelling: "E4" },
    { bar: 1, pitchMidi: 67, pitchSpelling: "G4" },
    { bar: 2, pitchMidi: 67, pitchSpelling: "G4" },
    { bar: 2, pitchMidi: 71, pitchSpelling: "B4" },
    { bar: 2, pitchMidi: 74, pitchSpelling: "D5" },
    { bar: 2, pitchMidi: 77, pitchSpelling: "F5" },
  ];
  for (const s of spec) {
    store.actions.addNote(
      createNoteEvent({
        trackId: "chords",
        bar: s.bar,
        beat: 1,
        durQn: 4,
        pitchMidi: s.pitchMidi,
        pitchSpelling: s.pitchSpelling,
        velocity: 0.6,
        voice: "lh",
      }),
    );
  }
}

function selectStringQuartet(container: HTMLElement) {
  const presetBtn = container.querySelector(
    '[data-testid="orchestrator-preset-string_quartet"]',
  );
  if (!presetBtn) throw new Error("string quartet preset not found");
  click(presetBtn);
}

/** Stubs the browser APIs jsdom lacks so the real App renders under vitest
 *  (same set as app-integration.test.tsx). */
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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

describe("v1.22.0 Stage 1: App harmony wiring (S1)", () => {
  beforeAll(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("S1-T01/T02: chords 轨 Cmaj7→G7 推进渲染和声带 (C/I + G7/V)", () => {
    const { container, cleanup } = renderApp();

    // Replace the demo chords with a deterministic progression:
    // bar 1 = C4/E4/G4 (C major, I), bar 2 = G4/B4/D5/F5 (G7, V).
    act(() => {
      clearChordsTrack();
    });
    act(() => {
      addChordNotes();
    });

    // Switch to the orchestrate tab through the real tab pill.
    click(container.querySelector('[data-testid="tab-orchestrate"]'));
    expect(
      container.querySelector('[data-testid="orchestrate-layout"]')
    ).not.toBeNull();

    const strip = container.querySelector(
      '[data-testid="orchestrator-harmony-strip"]',
    );
    expect(strip).not.toBeNull();
    const items = Array.from(
      container.querySelectorAll('[data-testid="orchestrator-harmony-item"]'),
    );
    expect(items.length).toBe(2);
    // formatChordSymbol({root:"C",quality:"maj"}) → "C";
    // formatChordSymbol({root:"G",quality:"dom7"}) → "G7";
    // C major key_map → roman numerals I / V.
    expect(items[0].textContent).toBe("m1 C (I)");
    expect(items[1].textContent).toBe("m2 G7 (V)");
    // Empty state must not coexist with real entries.
    expect(
      container.querySelector('[data-testid="orchestrator-harmony-empty"]')
    ).toBeNull();

    cleanup();
  });

  it("S1-T03: 清空 chords 轨 → 空态 + orchestrate 按钮 disabled", () => {
    const { container, cleanup } = renderApp();

    act(() => {
      clearChordsTrack();
    });
    click(container.querySelector('[data-testid="tab-orchestrate"]'));

    expect(
      container.querySelector('[data-testid="orchestrator-harmony-empty"]')
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="orchestrator-harmony-item"]').length
    ).toBe(0);

    // Players selected so the run button mounts; harmony is empty → disabled.
    selectStringQuartet(container);
    const runBtn = container.querySelector(
      '[data-testid="orchestrator-run"]',
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();
    expect(runBtn!.disabled).toBe(true);

    cleanup();
  });

  it("S1-T05: 真实 runOrchestrator 后 voice preview 显示真实计数(>0, 非 random)", async () => {
    const { container, cleanup } = renderApp();

    // Demo harmony (chords track seeded by the demo project) is present.
    click(container.querySelector('[data-testid="tab-orchestrate"]'));
    selectStringQuartet(container);

    const runBtn = container.querySelector(
      '[data-testid="orchestrator-run"]',
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();
    expect(runBtn!.disabled).toBe(false);
    click(runBtn);

    // The real orchestrator.voicingPlan tool runs asynchronously; wait for
    // the voice preview to flip from the 0-notes placeholder to the real
    // per-player counts (no act around vi.waitFor).
    await vi.waitFor(() => {
      const counts = Array.from(
        container.querySelectorAll('[class*="voiceCount"]'),
      ).map((el) => Number((el.textContent ?? "").replace(/\D+.*$/, "")));
      expect(counts.length).toBe(3);
      // Every count is a real number, and the run actually generated notes
      // (the pre-run placeholder state would be all zeros).
      for (const c of counts) {
        expect(Number.isFinite(c)).toBe(true);
      }
      expect(counts.some((c) => c > 0)).toBe(true);
    });

    cleanup();
  });
});

// ── S1-T04: en / zh-CN i18n key structure symmetry (v1.16 pattern) ──
describe("v1.22.0 Stage 1: i18n key symmetry", () => {
  function collectKeys(obj: unknown, prefix = ""): string[] {
    if (obj === null || typeof obj !== "object") return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      collectKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it("en.json 与 zh-CN.json 键结构完全对称", () => {
    const enKeys = collectKeys(en).sort();
    const zhKeys = collectKeys(zhCN).sort();
    expect(enKeys).toEqual(zhKeys);

    // The v1.22.0 orchestrator keys exist on both sides.
    for (const key of [
      "orchestrator.harmonySection",
      "orchestrator.harmonyEmpty",
      "orchestrator.harmonyEmptyHint",
    ]) {
      expect(enKeys).toContain(key);
      expect(zhKeys).toContain(key);
    }
  });
});
