import { describe, it, expect } from "vitest";
import type { ChordSymbol, HarmonyEntry, Instrument } from "@collinx/core";
import { VoicingEngine } from "../voicing-engine";
import type { VoicingChord, VoicingGrid } from "../voicing-engine";

function makeChord(overrides: Partial<ChordSymbol> = {}): ChordSymbol {
  return {
    root: "C",
    quality: "maj",
    ...overrides,
  };
}

function makeEntry(
  bar: number,
  beat: number,
  chord: ChordSymbol,
): HarmonyEntry {
  return { bar, beat, chord, durationQn: 4 };
}

function makeMockInstrument(id: string, name: string): Instrument {
  return {
    id,
    name,
    family: "strings",
    range: { minMidi: 28, maxMidi: 108, comfortableLow: 36, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble",
    techniques: ["arco"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  };
}

const engine = new VoicingEngine();

describe("VoicingEngine", () => {
  describe("closeVoicing", () => {
    it("should produce C major close voicing within range", () => {
      const chord = makeChord({ root: "C", quality: "maj" });
      const pitches = engine.closeVoicing(chord, [48, 72], 4);
      expect(pitches).toHaveLength(4);
      for (const p of pitches) {
        expect(p).toBeGreaterThanOrEqual(48);
        expect(p).toBeLessThanOrEqual(72);
      }
      const sorted = [...pitches].sort((a, b) => a - b);
      expect(sorted).toEqual(pitches);
    });

    it("should produce unique ascending pitches", () => {
      const chord = makeChord({ root: "C", quality: "maj" });
      const pitches = engine.closeVoicing(chord, [48, 72], 3);
      expect(pitches).toHaveLength(3);
      const unique = new Set(pitches);
      expect(unique.size).toBe(3);
    });

    it("should work with minor chords", () => {
      const chord = makeChord({ root: "A", quality: "min" });
      const pitches = engine.closeVoicing(chord, [48, 72], 3);
      expect(pitches).toHaveLength(3);
    });

    it("should work with dominant 7th chords (4 notes)", () => {
      const chord = makeChord({ root: "G", quality: "dom7" });
      const pitches = engine.closeVoicing(chord, [40, 72], 4);
      expect(pitches).toHaveLength(4);
    });

    it("should work with high count (doubled tones)", () => {
      const chord = makeChord({ root: "C", quality: "maj" });
      const pitches = engine.closeVoicing(chord, [48, 84], 6);
      expect(pitches).toHaveLength(6);
    });

    it("should work with dim7 chord", () => {
      const chord = makeChord({ root: "B", quality: "dim7" });
      const pitches = engine.closeVoicing(chord, [48, 84], 4);
      expect(pitches).toHaveLength(4);
    });

    it("should handle sus4 chord", () => {
      const chord = makeChord({ root: "C", quality: "sus4" });
      const pitches = engine.closeVoicing(chord, [48, 72], 3);
      expect(pitches).toHaveLength(3);
    });

    it("should handle maj7 chord", () => {
      const chord = makeChord({ root: "F", quality: "maj7" });
      const pitches = engine.closeVoicing(chord, [48, 80], 4);
      expect(pitches).toHaveLength(4);
    });

    it("should handle halfdim7 chord", () => {
      const chord = makeChord({ root: "B", quality: "halfdim7" });
      const pitches = engine.closeVoicing(chord, [48, 80], 4);
      expect(pitches).toHaveLength(4);
    });
  });

  describe("drop2Voicing", () => {
    it("should produce 4-note drop-2 voicing", () => {
      const chord = makeChord({ root: "C", quality: "maj7" });
      const pitches = engine.drop2Voicing(chord, [48, 84]);
      expect(pitches).toHaveLength(4);
    });

    it("should differ from close voicing (second voice dropped)", () => {
      const chord = makeChord({ root: "C", quality: "maj7" });
      const close = engine.closeVoicing(chord, [48, 84], 4);
      const drop2 = engine.drop2Voicing(chord, [48, 84]);
      const closeSorted = [...close].sort((a, b) => a - b);
      const drop2Sorted = [...drop2].sort((a, b) => a - b);
      // Drop-2 should have a wider spread than close
      const closeSpan = closeSorted[closeSorted.length - 1] - closeSorted[0];
      const drop2Span = drop2Sorted[drop2Sorted.length - 1] - drop2Sorted[0];
      expect(drop2Span).toBeGreaterThan(closeSpan);
    });

    it("should produce notes within reasonable playing range", () => {
      const chord = makeChord({ root: "C", quality: "maj" });
      const pitches = engine.drop2Voicing(chord, [48, 84]);
      expect(pitches).toHaveLength(4);
      for (const p of pitches) {
        expect(p).toBeGreaterThanOrEqual(28);
        expect(p).toBeLessThanOrEqual(108);
      }
    });
  });

  describe("generateVoicing", () => {
    const players = [
      makeMockInstrument("soprano", "Soprano"),
      makeMockInstrument("alto", "Alto"),
      makeMockInstrument("tenor", "Tenor"),
      makeMockInstrument("bass", "Bass"),
    ];

    it("should generate close voicing by default", () => {
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj" })),
      ];
      const grid = engine.generateVoicing(chords, players);
      expect(grid.chords).toHaveLength(1);
      expect(grid.chords[0].notes.length).toBeGreaterThanOrEqual(3);
      expect(grid.players).toEqual(["soprano", "alto", "tenor", "bass"]);
    });

    it("should generate drop-2 voicing when specified", () => {
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj7" })),
      ];
      const grid = engine.generateVoicing(chords, players, "drop2");
      expect(grid.chords).toHaveLength(1);
      expect(grid.chords[0].notes).toHaveLength(4);
    });

    it("should generate voicing for a chord progression", () => {
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj" })),
        makeEntry(1, 3, makeChord({ root: "F", quality: "maj" })),
        makeEntry(2, 1, makeChord({ root: "G", quality: "dom7" })),
        makeEntry(2, 3, makeChord({ root: "C", quality: "maj" })),
      ];
      const grid = engine.generateVoicing(chords, players);
      expect(grid.chords).toHaveLength(4);
      expect(grid.totalVoices).toBe(4);
    });

    it("should generate open voicing", () => {
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj" })),
      ];
      const grid = engine.generateVoicing(chords, players, "open");
      expect(grid.chords).toHaveLength(1);
    });

    it("should generate drop-24 voicing", () => {
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj7" })),
      ];
      const grid = engine.generateVoicing(chords, players, "drop24");
      expect(grid.chords).toHaveLength(1);
    });

    it("should handle fewer players than voices", () => {
      const singlePlayer = [makeMockInstrument("piano", "Piano")];
      const chords: HarmonyEntry[] = [
        makeEntry(1, 1, makeChord({ root: "C", quality: "maj" })),
      ];
      const grid = engine.generateVoicing(chords, singlePlayer);
      expect(grid.totalVoices).toBe(4);
    });
  });

  describe("voiceLeading", () => {
    it("should produce a chord with same structure", () => {
      const prev: VoicingChord = {
        notes: [
          { pitchMidi: 48, pitchSpelling: "C3", voiceIndex: 0, playerId: "p1", instrumentId: "bass" },
          { pitchMidi: 52, pitchSpelling: "E3", voiceIndex: 1, playerId: "p2", instrumentId: "tenor" },
          { pitchMidi: 55, pitchSpelling: "G3", voiceIndex: 2, playerId: "p3", instrumentId: "alto" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 3, playerId: "p4", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord({ root: "C", quality: "maj" }),
      };

      const next: VoicingChord = {
        notes: [
          { pitchMidi: 53, pitchSpelling: "F3", voiceIndex: 0, playerId: "p1", instrumentId: "bass" },
          { pitchMidi: 57, pitchSpelling: "A3", voiceIndex: 1, playerId: "p2", instrumentId: "tenor" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 2, playerId: "p3", instrumentId: "alto" },
          { pitchMidi: 65, pitchSpelling: "F4", voiceIndex: 3, playerId: "p4", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 2,
        chord: makeChord({ root: "F", quality: "maj" }),
      };

      const result = engine.voiceLeading(prev, next);
      expect(result.notes).toBeDefined();
      expect(result.notes.length).toBeGreaterThan(0);
    });

    it("should keep common tone between C and Am chords", () => {
      const prev: VoicingChord = {
        notes: [
          { pitchMidi: 48, pitchSpelling: "C3", voiceIndex: 0, playerId: "p1", instrumentId: "bass" },
          { pitchMidi: 52, pitchSpelling: "E3", voiceIndex: 1, playerId: "p2", instrumentId: "tenor" },
          { pitchMidi: 55, pitchSpelling: "G3", voiceIndex: 2, playerId: "p3", instrumentId: "alto" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 3, playerId: "p4", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord({ root: "C", quality: "maj" }),
      };

      const next: VoicingChord = {
        notes: [
          { pitchMidi: 45, pitchSpelling: "A2", voiceIndex: 0, playerId: "p1", instrumentId: "bass" },
          { pitchMidi: 52, pitchSpelling: "E3", voiceIndex: 1, playerId: "p2", instrumentId: "tenor" },
          { pitchMidi: 57, pitchSpelling: "A3", voiceIndex: 2, playerId: "p3", instrumentId: "alto" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 3, playerId: "p4", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 2,
        chord: makeChord({ root: "A", quality: "min" }),
      };

      const result = engine.voiceLeading(prev, next);
      // E and C are common tones, should stay (minimal movement)
      const hasE = result.notes.some((n) => n.pitchMidi === 52);
      const hasC = result.notes.some((n) => n.pitchMidi === 60);
      expect(hasE).toBe(true);
      expect(hasC).toBe(true);
    });
  });

  describe("assignPlayers", () => {
    it("should assign player IDs to voicing notes", () => {
      const chord: VoicingChord = {
        notes: [
          { pitchMidi: 48, pitchSpelling: "C3", voiceIndex: 0, playerId: "", instrumentId: "" },
          { pitchMidi: 55, pitchSpelling: "G3", voiceIndex: 1, playerId: "", instrumentId: "" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 2, playerId: "", instrumentId: "" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord(),
      };

      const grid: VoicingGrid = {
        chords: [chord],
        players: ["p1", "p2", "p3"],
        totalVoices: 3,
      };

      const instruments = [
        makeMockInstrument("violin", "Violin"),
        makeMockInstrument("viola", "Viola"),
        makeMockInstrument("cello", "Cello"),
      ];

      engine.assignPlayers(grid, instruments);
      expect(grid.chords[0].notes[0].playerId).toBe("p1");
      expect(grid.chords[0].notes[0].instrumentId).toBe("violin");
      expect(grid.chords[0].notes[1].playerId).toBe("p2");
      expect(grid.chords[0].notes[2].playerId).toBe("p3");
    });
  });

  describe("checkSpacing", () => {
    it("should pass for valid SATB spacing", () => {
      const chord: VoicingChord = {
        notes: [
          { pitchMidi: 48, pitchSpelling: "C3", voiceIndex: 0, playerId: "b", instrumentId: "bass" },
          { pitchMidi: 55, pitchSpelling: "G3", voiceIndex: 1, playerId: "t", instrumentId: "tenor" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 2, playerId: "a", instrumentId: "alto" },
          { pitchMidi: 64, pitchSpelling: "E4", voiceIndex: 3, playerId: "s", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord(),
      };
      const result = engine.checkSpacing(chord);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should flag spacing violations exceeding octave", () => {
      const chord: VoicingChord = {
        notes: [
          { pitchMidi: 36, pitchSpelling: "C2", voiceIndex: 0, playerId: "b", instrumentId: "bass" },
          { pitchMidi: 55, pitchSpelling: "G3", voiceIndex: 1, playerId: "t", instrumentId: "tenor" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 2, playerId: "a", instrumentId: "alto" },
          { pitchMidi: 64, pitchSpelling: "E4", voiceIndex: 3, playerId: "s", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord(),
      };
      const result = engine.checkSpacing(chord);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should pass for 2-note chords (insufficient to check)", () => {
      const chord: VoicingChord = {
        notes: [
          { pitchMidi: 48, pitchSpelling: "C3", voiceIndex: 0, playerId: "b", instrumentId: "bass" },
          { pitchMidi: 60, pitchSpelling: "C4", voiceIndex: 1, playerId: "s", instrumentId: "soprano" },
        ],
        bar: 1,
        beat: 1,
        chord: makeChord(),
      };
      const result = engine.checkSpacing(chord);
      expect(result.valid).toBe(true);
    });
  });
});
