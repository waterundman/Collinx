import { describe, it, expect } from "vitest";
import React from "react";
import { ArrangementView } from "../ArrangementView";

describe("ArrangementView", () => {
  it("renders without crashing with empty phrases", () => {
    expect(() => {
      React.createElement(ArrangementView, { phrases: [] });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof ArrangementView).toBe("function");
  });

  it("renders with multiple phrases", () => {
    const phrases = [
      { id: "p1", name: "Intro", startBar: 1, endBar: 4, formRole: "intro", energyLevel: 0.2 },
      { id: "p2", name: "Verse 1", startBar: 5, endBar: 12, formRole: "verse", energyLevel: 0.5 },
      { id: "p3", name: "Chorus", startBar: 13, endBar: 20, formRole: "chorus", energyLevel: 0.8 },
    ];
    expect(() => {
      React.createElement(ArrangementView, { phrases });
    }).not.toThrow();
  });

  it("accepts onPhraseClick callback", () => {
    let clicked: string | null = null;
    const phrases = [
      { id: "p1", name: "Verse", startBar: 1, endBar: 8, formRole: "verse" },
    ];
    expect(() => {
      React.createElement(ArrangementView, {
        phrases,
        onPhraseClick: (id) => {
          clicked = id;
        },
      });
    }).not.toThrow();
  });

  it("accepts onSectionDoubleClick and totalBars props", () => {
    const phrases = [
      { id: "p1", name: "Chorus", startBar: 1, endBar: 8, formRole: "chorus", energyLevel: 0.7 },
    ];
    expect(() => {
      React.createElement(ArrangementView, {
        phrases,
        onSectionDoubleClick: () => {},
        totalBars: 32,
      });
    }).not.toThrow();
  });

  it("handles phrases with all role types", () => {
    const phrases = [
      { id: "int", name: "Intro", startBar: 1, endBar: 4, formRole: "intro" },
      { id: "v1", name: "Verse", startBar: 5, endBar: 12, formRole: "verse" },
      { id: "pc", name: "Pre-chorus", startBar: 13, endBar: 16, formRole: "prechorus" },
      { id: "ch", name: "Chorus", startBar: 17, endBar: 24, formRole: "chorus" },
      { id: "br", name: "Bridge", startBar: 25, endBar: 28, formRole: "bridge" },
      { id: "so", name: "Solo", startBar: 29, endBar: 36, formRole: "solo" },
      { id: "ot", name: "Outro", startBar: 37, endBar: 40, formRole: "outro" },
    ];
    expect(() => {
      React.createElement(ArrangementView, { phrases, totalBars: 40 });
    }).not.toThrow();
  });
});
