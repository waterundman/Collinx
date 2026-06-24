import { describe, it, expect } from "vitest";
import { RegisterConflictDetector } from "../register-conflict";
import type { RegisterConflict, VoiceNote } from "../register-conflict";
import type { NoteEvent, Instrument } from "@collinx/core";

function makeNote(
  overrides: Partial<NoteEvent> & { bar: number; beat: number },
): NoteEvent {
  return {
    id: `n-${overrides.bar}-${overrides.beat}`,
    trackId: "t1",
    phraseId: null,
    bar: overrides.bar,
    beat: overrides.beat,
    durQn: overrides.durQn ?? 1,
    pitchMidi: overrides.pitchMidi ?? 60,
    pitchSpelling: overrides.pitchSpelling ?? "C4",
    velocity: overrides.velocity ?? 0.8,
    voice: "rh",
    tags: [],
  };
}

function makeVoiceNote(
  overrides: Partial<VoiceNote> & { bar: number; beat: number },
): VoiceNote {
  return {
    pitchMidi: overrides.pitchMidi ?? 60,
    voice: overrides.voice ?? "soprano",
    bar: overrides.bar,
    beat: overrides.beat,
    durQn: overrides.durQn ?? 1,
  };
}

function violaInst(): Instrument {
  return {
    id: "viola", name: "Viola", family: "strings",
    range: { minMidi: 48, maxMidi: 81, comfortableLow: 55, comfortableHigh: 76 },
    transposition: 0, clef: "alto",
    techniques: ["legato"], isPolyphonic: true,
    defaultVelocity: 0.7,
  };
}

function violinInst(): Instrument {
  return {
    id: "violin", name: "Violin", family: "strings",
    range: { minMidi: 55, maxMidi: 103, comfortableLow: 60, comfortableHigh: 91 },
    transposition: 0, clef: "treble",
    techniques: ["legato"], isPolyphonic: true,
    defaultVelocity: 0.7,
  };
}

function celloInst(): Instrument {
  return {
    id: "cello", name: "Cello", family: "strings",
    range: { minMidi: 36, maxMidi: 76, comfortableLow: 43, comfortableHigh: 72 },
    transposition: 0, clef: "bass",
    techniques: ["legato"], isPolyphonic: true,
    defaultVelocity: 0.7,
  };
}

function fluteInst(): Instrument {
  return {
    id: "flute", name: "Flute", family: "woodwind",
    range: { minMidi: 72, maxMidi: 108, comfortableLow: 76, comfortableHigh: 96 },
    transposition: 0, clef: "treble",
    techniques: ["legato"], isPolyphonic: false,
    defaultVelocity: 0.7,
  };
}

describe("RegisterConflictDetector", () => {
  const detector = new RegisterConflictDetector();

  describe("detectConflicts()", () => {
    it("should detect no conflicts for clean arrangement", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("violin", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 72 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 74 }),
      ]);
      perPlayerNotes.set("cello", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 40 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 43 }),
      ]);

      const instruments = new Map<string, Instrument>();
      instruments.set("violin", violinInst());
      instruments.set("cello", celloInst());

      const conflicts = detector.detectConflicts(perPlayerNotes, instruments);
      expect(conflicts.length).toBe(0);
    });

    it("should detect range violations for out-of-range notes", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("flute", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 50, pitchSpelling: "D3" }),
      ]);

      const instruments = new Map<string, Instrument>();
      instruments.set("flute", fluteInst());

      const conflicts = detector.detectConflicts(perPlayerNotes, instruments);
      const rangeConflicts = conflicts.filter((c) => c.type === "range_violation");
      expect(rangeConflicts.length).toBeGreaterThan(0);
      expect(rangeConflicts[0].severity).toBe("error");
    });

    it("should detect overlap between two instruments in same range", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("violin", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 92 }),
      ]);
      perPlayerNotes.set("viola", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 62 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 88 }),
      ]);

      const instruments = new Map<string, Instrument>();
      instruments.set("violin", violinInst());
      instruments.set("viola", violaInst());

      const conflicts = detector.detectConflicts(perPlayerNotes, instruments);
      const overlapConflicts = conflicts.filter((c) => c.type === "overlap");
      expect(overlapConflicts.length).toBeGreaterThan(0);
      expect(overlapConflicts[0].severity).toBe("warning");
    });

    it("should handle players with no instrument gracefully", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("unknown", [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60 }),
      ]);

      const instruments = new Map<string, Instrument>();
      const conflicts = detector.detectConflicts(perPlayerNotes, instruments);
      expect(conflicts).toBeDefined();
    });
  });

  describe("detectSpacing()", () => {
    it("should detect large gaps between voices", () => {
      const voices: VoiceNote[] = [
        makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 84, voice: "soprano" }),
        makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 48, voice: "alto" }),
      ];

      const conflicts = detector.detectSpacing(voices);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe("spacing");
      expect(conflicts[0].severity).toBe("warning");
    });

    it("should not flag tight voicings", () => {
      const voices: VoiceNote[] = [
        makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 72, voice: "soprano" }),
        makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 67, voice: "alto" }),
        makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 64, voice: "tenor" }),
      ];

      const conflicts = detector.detectSpacing(voices);
      expect(conflicts.length).toBe(0);
    });
  });

  describe("detectRangeViolation()", () => {
    it("should detect note below range", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 50, pitchSpelling: "D3" }),
      ];
      const conflicts = detector.detectRangeViolation(notes, fluteInst());
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].severity).toBe("error");
    });

    it("should detect note above range", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 115, pitchSpelling: "G9" }),
      ];
      const conflicts = detector.detectRangeViolation(notes, fluteInst());
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].severity).toBe("error");
    });

    it("should pass notes within range", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 76, pitchSpelling: "E5" }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 84, pitchSpelling: "C6" }),
      ];
      const conflicts = detector.detectRangeViolation(notes, fluteInst());
      expect(conflicts.length).toBe(0);
    });
  });

  describe("detectCrossing()", () => {
    it("should detect voice crossing", () => {
      const voices: VoiceNote[][] = [
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 60, voice: "soprano" })],
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 72, voice: "alto" })],
      ];

      const conflicts = detector.detectCrossing(voices);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe("crossing");
    });

    it("should pass normal voice order", () => {
      const voices: VoiceNote[][] = [
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 76, voice: "soprano" })],
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 64, voice: "alto" })],
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 52, voice: "tenor" })],
      ];

      const conflicts = detector.detectCrossing(voices);
      expect(conflicts.length).toBe(0);
    });

    it("should return empty for single voice", () => {
      const voices: VoiceNote[][] = [
        [makeVoiceNote({ bar: 1, beat: 1, pitchMidi: 72, voice: "soprano" })],
      ];
      const conflicts = detector.detectCrossing(voices);
      expect(conflicts.length).toBe(0);
    });
  });

  describe("detectOverlap()", () => {
    it("should detect overlap when instruments play in same range simultaneously", () => {
      const aNotes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 48 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 60 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 72 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 84 }),
      ];
      const bNotes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 52 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 60 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 72 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 80 }),
      ];

      const conflicts = detector.detectOverlap(aNotes, bNotes, violinInst(), violaInst());
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe("overlap");
    });

    it("should not flag non-overlapping ranges", () => {
      const aNotes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 84 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 96 }),
      ];
      const bNotes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 36 }),
        makeNote({ bar: 1, beat: 1, pitchMidi: 40 }),
      ];

      const conflicts = detector.detectOverlap(aNotes, bNotes, violinInst(), celloInst());
      const overlapConflicts = conflicts.filter((c) => c.type === "overlap");
      expect(overlapConflicts.length).toBe(0);
    });
  });

  describe("suggestFix()", () => {
    it("should provide suggestion for overlap", () => {
      const conflict: RegisterConflict = {
        type: "overlap", players: ["violin", "viola"],
        bar: 1, beat: 1, severity: "warning",
        description: "overlap", suggestion: "",
      };
      const suggestion = detector.suggestFix(conflict);
      expect(suggestion).toContain("八度");
    });

    it("should provide suggestion for spacing", () => {
      const conflict: RegisterConflict = {
        type: "spacing", players: ["upper", "lower"],
        bar: 1, beat: 1, severity: "warning",
        description: "spacing", suggestion: "",
      };
      const suggestion = detector.suggestFix(conflict);
      expect(suggestion).toContain("填充");
    });

    it("should provide suggestion for range violation", () => {
      const conflict: RegisterConflict = {
        type: "range_violation", players: ["flute", ""],
        bar: 1, beat: 1, severity: "error",
        description: "range", suggestion: "",
      };
      const suggestion = detector.suggestFix(conflict);
      expect(suggestion).toContain("flute");
    });

    it("should provide suggestion for crossing", () => {
      const conflict: RegisterConflict = {
        type: "crossing", players: ["soprano", "alto"],
        bar: 1, beat: 1, severity: "warning",
        description: "crossing", suggestion: "",
      };
      const suggestion = detector.suggestFix(conflict);
      expect(suggestion).toContain("交换");
    });
  });
});
