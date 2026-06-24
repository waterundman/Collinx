import { describe, it, expect } from "vitest";
import React from "react";
import { NoteEvent } from "@collinx/core";
import { PianoRollView } from "../PianoRollView";

describe("PianoRollView", () => {
  const emptyNotes: NoteEvent[] = [];
  const defaultProps = {
    notes: emptyNotes,
    tempoMap: {
      bpmAt: () => 120,
      meterAt: () => ({ numerator: 4, denominator: 4 }),
      keyAt: () => ({ tonic: "C", mode: "major" }),
      timeAt: () => 0,
      barBeatAt: () => ({ bar: 1, beat: 1 }),
      getBarsDuration: () => 16,
      getTotalSeconds: () => 60,
    } as any,
    viewRange: { startBar: 1, endBar: 16 },
  };

  it("renders without crashing with empty notes", () => {
    expect(() => {
      React.createElement(PianoRollView, defaultProps);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PianoRollView).toBe("function");
  });

  it("accepts optional callbacks without crashing", () => {
    const props = {
      ...defaultProps,
      onNoteAdd: () => {},
      onNoteMove: () => {},
      onNoteResize: () => {},
      onNoteDelete: () => {},
      onNoteSelect: () => {},
      selectedNoteIds: [],
    };
    expect(() => {
      React.createElement(PianoRollView, props);
    }).not.toThrow();
  });

  it("accepts height prop", () => {
    expect(() => {
      React.createElement(PianoRollView, { ...defaultProps, height: 400 });
    }).not.toThrow();
  });

  it("does not throw with notes containing data", () => {
    const notes = [
      {
        id: "n1",
        trackId: "t1",
        phraseId: null,
        bar: 1,
        beat: 1,
        durQn: 1,
        pitchMidi: 60,
        pitchSpelling: "C4",
        velocity: 0.8,
        voice: "rh",
        tags: [],
      },
    ];
    expect(() => {
      React.createElement(PianoRollView, { ...defaultProps, notes });
    }).not.toThrow();
  });
});
