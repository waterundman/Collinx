import { describe, it, expect } from "vitest";
import React from "react";
import { TempoMap } from "@collinx/core";
import { ScoreRenderer } from "../ScoreRenderer";
import type { NoteEvent } from "@collinx/core";
import type { ScoreRendererLayout } from "../ScoreRenderer";

const defaultLayout: ScoreRendererLayout = {
  staffConfig: [
    { clef: "treble", name: "Treble", bars: 4 },
    { clef: "bass", name: "Bass", bars: 4 },
  ],
};

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: overrides.id ?? "note-001",
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

describe("ScoreRenderer", () => {
  it("renders without crashing with empty notes", () => {
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes: [],
        layout: defaultLayout,
      });
    }).not.toThrow();
  });

  it("renders without crashing with notes", () => {
    const notes = [
      makeNote({ id: "n1", pitchMidi: 60, bar: 1, beat: 1 }),
      makeNote({ id: "n2", pitchMidi: 62, bar: 1, beat: 2 }),
      makeNote({ id: "n3", pitchMidi: 48, bar: 1, beat: 1 }),
    ];
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes,
        layout: defaultLayout,
      });
    }).not.toThrow();
  });

  it("renders correct number of staves from layout config", () => {
    const singleStaffLayout: ScoreRendererLayout = {
      staffConfig: [{ clef: "treble", name: "Piano", bars: 4 }],
    };
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes: [],
        layout: singleStaffLayout,
      });
    }).not.toThrow();
  });

  it("handles scale prop", () => {
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes: [],
        layout: defaultLayout,
        scale: 0.5,
      });
    }).not.toThrow();
  });

  it("handles scale at 2.0", () => {
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes: [],
        layout: defaultLayout,
        scale: 2.0,
      });
    }).not.toThrow();
  });

  it("handles tempoMap prop", () => {
    const tempoMap = new TempoMap(
      [{ bar: 1, bpm: 140 }],
      [{ bar: 1, numerator: 3, denominator: 4 }],
    );
    expect(() => {
      React.createElement(ScoreRenderer, {
        notes: [],
        layout: defaultLayout,
        tempoMap,
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof ScoreRenderer).toBe("function");
  });
});
