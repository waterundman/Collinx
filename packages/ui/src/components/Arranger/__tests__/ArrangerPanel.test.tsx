import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Arranger } from "@collinx/agent";
import {
  FormRole,
  createNoteEvent,
  type NoteEvent,
  type Section,
} from "@collinx/core";
import { ArrangerPanel } from "../ArrangerPanel";
import { I18nProvider } from "../../../providers/I18nProvider";
import type {
  ArrangerConfigInput,
  ArrangerRunResult,
} from "../../../store/project-store";

function makeNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 2, durQn: 0.5, pitchMidi: 66 }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 3, durQn: 1, pitchMidi: 67 }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 2, pitchMidi: 71 }),
  ];
}

/** Runs the real Arranger agent against a fixed section and packs its output
 *  into the exact shape the panel's onRunArranger receives from the store. */
function buildRealResult(): ArrangerRunResult {
  const arranger = new Arranger();
  const source = makeNotes();
  const section: Section = {
    id: "section-test",
    name: "Test Section",
    formRole: FormRole.Verse,
    startBar: 1,
    endBar: 4,
    energyLevel: 0.6,
    motifIds: [],
    phraseIds: [],
  };
  const real = arranger.expandSection(source, section, {
    formTemplate: "pop_ababcb",
    barCount: 4,
    variantCount: 3,
  });
  return {
    status: "ok",
    variants: real.variants,
    selectedVariant: real.selectedVariant,
    formStructure: real.formStructure,
    section,
    energyCurvePoints: real.energyCurve.getPoints(),
    confidence: real.confidence,
    diffs: real.diffs,
  };
}

interface PanelHarness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderPanel(props: {
  motifs: { id: string; name: string; notes: NoteEvent[] }[];
  onRunArranger?: (config: ArrangerConfigInput) => Promise<ArrangerRunResult>;
}): PanelHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <ArrangerPanel motifs={props.motifs} onRunArranger={props.onRunArranger} />
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

describe("ArrangerPanel (Stage 1: real Arranger data source)", () => {
  it("T03: 点击生成编排 → 面板数据更新为真实 Arranger 结果 (critical)", async () => {
    const real = buildRealResult();
    const notes = makeNotes();
    const onRunArranger = vi.fn().mockResolvedValue(real);
    const { container, cleanup } = renderPanel({
      motifs: [{ id: "m1", name: "Melody", notes }],
      onRunArranger,
    });

    // No variants before the click.
    expect(
      container.querySelectorAll('[data-testid^="arranger-variant-"]').length
    ).toBe(0);

    const btn = container.querySelector('[data-testid="arranger-generate"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    // The panel routed the click through the real Arranger runner with the
    // real source notes + selected template.
    expect(onRunArranger).toHaveBeenCalledTimes(1);
    const config = onRunArranger.mock.calls[0][0];
    expect(config.source).toEqual(notes);
    expect(config.formTemplate).toBe("pop_ababcb");
    expect(config.bars).toBeGreaterThan(0);

    // Variant cards now reflect the real Arranger output (one card per real
    // variant, keyed by the real variant id).
    const cards = container.querySelectorAll('[data-testid^="arranger-variant-"]');
    expect(cards.length).toBe(real.variants.length);
    // The real variant id is used as the card testid.
    expect(
      container.querySelector(`[data-testid="arranger-variant-${real.variants[0].id}"]`)
    ).not.toBeNull();
    // Real variant descriptions are rendered in the panel.
    expect(container.textContent).toContain(real.variants[0].description);
  });

  it("本地 demo 兜底:未提供 onRunArranger 时仍可生成(不崩)", async () => {
    const { container, cleanup } = renderPanel({
      motifs: [{ id: "m1", name: "Melody", notes: makeNotes() }],
    });

    const btn = container.querySelector('[data-testid="arranger-generate"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    // The local demo generator still works as a fallback.
    const cards = container.querySelectorAll('[data-testid^="arranger-variant-"]');
    expect(cards.length).toBeGreaterThan(0);
    expect(container.textContent).not.toBe("");

    cleanup();
  });
});
