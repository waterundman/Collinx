import { describe, it, expect } from "vitest";
import { MotifTransformer } from "../motif-transformer";
import type { NoteEvent } from "@collinx/core";

function makeNote(
  overrides: Partial<NoteEvent> & { bar: number; beat: number }
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

describe("MotifTransformer", () => {
  describe("transpose", () => {
    it("should shift all pitches by given semitones", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
      ];
      const result = MotifTransformer.transpose(notes, 2);
      expect(result[0].pitchMidi).toBe(62);
      expect(result[0].pitchSpelling).toBe("D4");
      expect(result[1].pitchMidi).toBe(66);
      expect(result[1].pitchSpelling).toBe("F#4");
    });

    it("should return identical array when semitones is 0", () => {
      const notes = [makeNote({ bar: 1, beat: 1 })];
      const result = MotifTransformer.transpose(notes, 0);
      expect(result[0].pitchMidi).toBe(notes[0].pitchMidi);
    });

    it("should handle negative transposition", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 72, pitchSpelling: "C5" })];
      const result = MotifTransformer.transpose(notes, -5);
      expect(result[0].pitchMidi).toBe(67);
      expect(result[0].pitchSpelling).toBe("G4");
    });

    it("should handle octave boundaries", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 71, pitchSpelling: "B4" })];
      const result = MotifTransformer.transpose(notes, 1);
      expect(result[0].pitchMidi).toBe(72);
      expect(result[0].pitchSpelling).toBe("C5");
    });

    it("should not mutate original notes", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 60 })];
      MotifTransformer.transpose(notes, 5);
      expect(notes[0].pitchMidi).toBe(60);
    });
  });

  describe("rhythmicVariation", () => {
    it("should return original when degree is 0", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, durQn: 1 }),
      ];
      const result = MotifTransformer.rhythmicVariation(notes, 0);
      expect(result[0].bar).toBe(1);
      expect(result[0].beat).toBe(1);
      expect(result[0].durQn).toBe(1);
    });

    it("should perturb durations and positions for positive degree", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, durQn: 1 }),
      ];
      const result = MotifTransformer.rhythmicVariation(notes, 0.5);
      expect(result.length).toBe(2);
      expect(result[0].durQn).not.toBe(1);
      expect(result[1].durQn).not.toBe(1);
    });

    it("should produce deterministic output for same input", () => {
      const notes = [makeNote({ bar: 1, beat: 1, durQn: 1 })];
      const a = MotifTransformer.rhythmicVariation(notes, 0.3);
      const b = MotifTransformer.rhythmicVariation(notes, 0.3);
      expect(a[0].durQn).toBe(b[0].durQn);
      expect(a[0].beat).toBe(b[0].beat);
    });

    it("should clamp degree to maximum 1", () => {
      const notes = [makeNote({ bar: 1, beat: 1, durQn: 1 })];
      const result = MotifTransformer.rhythmicVariation(notes, 5);
      expect(result[0].durQn).toBeGreaterThan(0);
      expect(result[0].durQn).toBeLessThanOrEqual(2);
    });

    it("should preserve note count", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1 }),
        makeNote({ bar: 1, beat: 2 }),
        makeNote({ bar: 1, beat: 3 }),
      ];
      const result = MotifTransformer.rhythmicVariation(notes, 0.8);
      expect(result).toHaveLength(3);
    });
  });

  describe("invert", () => {
    it("should mirror pitches around first note", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
        makeNote({ bar: 1, beat: 3, pitchMidi: 67, pitchSpelling: "G4" }),
      ];
      const result = MotifTransformer.invert(notes);
      expect(result[0].pitchMidi).toBe(60);
      expect(result[1].pitchMidi).toBe(56);
      expect(result[2].pitchMidi).toBe(53);
    });

    it("should return empty array for empty input", () => {
      const result = MotifTransformer.invert([]);
      expect(result).toHaveLength(0);
    });

    it("should handle single note (stays same)", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 72 })];
      const result = MotifTransformer.invert(notes);
      expect(result[0].pitchMidi).toBe(72);
    });
  });

  describe("retrograde", () => {
    it("should reverse note order", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 64, durQn: 1 }),
        makeNote({ bar: 1, beat: 3, pitchMidi: 67, durQn: 1 }),
      ];
      const result = MotifTransformer.retrograde(notes);
      expect(result).toHaveLength(3);
      expect(result[0].pitchMidi).toBe(67);
      expect(result[1].pitchMidi).toBe(64);
      expect(result[2].pitchMidi).toBe(60);
    });

    it("should recalculate bar/beat positions", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 62, durQn: 1 }),
      ];
      const result = MotifTransformer.retrograde(notes);
      expect(result[0].bar).toBe(1);
      expect(result[0].beat).toBe(1);
      expect(result[1].bar).toBe(1);
      expect(result[1].beat).toBe(2);
    });

    it("should return unchanged for single note", () => {
      const notes = [makeNote({ bar: 1, beat: 1 })];
      const result = MotifTransformer.retrograde(notes);
      expect(result[0].pitchMidi).toBe(notes[0].pitchMidi);
      expect(result[0].bar).toBe(notes[0].bar);
      expect(result[0].beat).toBe(notes[0].beat);
    });

    it("should not mutate original", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 64 }),
      ];
      MotifTransformer.retrograde(notes);
      expect(notes[0].pitchMidi).toBe(60);
      expect(notes[1].pitchMidi).toBe(64);
    });
  });

  describe("augment", () => {
    it("should stretch durations and positions by factor", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 62, durQn: 1 }),
      ];
      const result = MotifTransformer.augment(notes, 2);
      expect(result[0].durQn).toBeCloseTo(2, 5);
      expect(result[0].bar).toBe(1);
      expect(result[0].beat).toBe(1);
      expect(result[1].durQn).toBeCloseTo(2, 5);
      expect(result[1].bar).toBe(1);
      expect(result[1].beat).toBe(3);
    });

    it("should preserve pitch information", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 60 })];
      const result = MotifTransformer.augment(notes, 1.5);
      expect(result[0].pitchMidi).toBe(60);
    });

    it("should return original when factor is 0 or negative", () => {
      const notes = [makeNote({ bar: 1, beat: 1, durQn: 1 })];
      const result = MotifTransformer.augment(notes, 0);
      expect(result[0].durQn).toBe(1);
    });
  });

  describe("diminish", () => {
    it("should compress durations and positions by factor", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, durQn: 2 }),
        makeNote({ bar: 1, beat: 3, pitchMidi: 62, durQn: 2 }),
      ];
      const result = MotifTransformer.diminish(notes, 2);
      expect(result[0].durQn).toBeCloseTo(1, 5);
      expect(result[0].bar).toBe(1);
      expect(result[0].beat).toBe(1);
      expect(result[1].durQn).toBeCloseTo(1, 5);
      expect(result[1].bar).toBe(1);
      expect(result[1].beat).toBe(2);
    });

    it("should preserve pitch information", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 72 })];
      const result = MotifTransformer.diminish(notes, 2);
      expect(result[0].pitchMidi).toBe(72);
    });
  });

  describe("velocityShift", () => {
    it("should add delta to all velocities", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, velocity: 0.5 }),
        makeNote({ bar: 1, beat: 2, velocity: 0.6 }),
      ];
      const result = MotifTransformer.velocityShift(notes, 0.2);
      expect(result[0].velocity).toBeCloseTo(0.7, 5);
      expect(result[1].velocity).toBeCloseTo(0.8, 5);
    });

    it("should clamp to [0, 1]", () => {
      const notes = [makeNote({ bar: 1, beat: 1, velocity: 0.9 })];
      const result = MotifTransformer.velocityShift(notes, 0.3);
      expect(result[0].velocity).toBe(1);
    });

    it("should return original when delta is 0", () => {
      const notes = [makeNote({ bar: 1, beat: 1, velocity: 0.5 })];
      const result = MotifTransformer.velocityShift(notes, 0);
      expect(result[0].velocity).toBe(0.5);
    });
  });

  describe("octaveShift", () => {
    it("should shift by 12 semitones per octave", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" })];
      const up = MotifTransformer.octaveShift(notes, 1);
      expect(up[0].pitchMidi).toBe(72);
      expect(up[0].pitchSpelling).toBe("C5");

      const down = MotifTransformer.octaveShift(notes, -1);
      expect(down[0].pitchMidi).toBe(48);
      expect(down[0].pitchSpelling).toBe("C3");
    });
  });

  describe("combine", () => {
    it("should apply multiple transforms in sequence", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 64, durQn: 1 }),
      ];
      const result = MotifTransformer.combine(notes, ["transpose", "velocityShift"], 0.7);
      expect(result).toHaveLength(2);
      expect(result[0].pitchMidi).not.toBe(60);
      expect(result[0].velocity).not.toBe(0.8);
    });

    it("should skip 'combine' in operations list", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 60 })];
      const result = MotifTransformer.combine(notes, ["combine", "transpose"], 0.7);
      expect(result[0].pitchMidi).not.toBe(60);
    });

    it("should handle empty operations", () => {
      const notes = [makeNote({ bar: 1, beat: 1 })];
      const result = MotifTransformer.combine(notes, [], 0.5);
      expect(result[0].pitchMidi).toBe(notes[0].pitchMidi);
    });
  });
});
