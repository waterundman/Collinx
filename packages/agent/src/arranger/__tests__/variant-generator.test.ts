import { describe, it, expect } from "vitest";
import { VariantGenerator } from "../variant-generator";
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

function makeSource(notes?: Partial<NoteEvent>[]): NoteEvent[] {
  if (notes && notes.length > 0) {
    return notes.map((n, i) =>
      makeNote({ bar: 1, beat: i + 1, ...n })
    );
  }
  return [
    makeNote({ bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4", durQn: 1 }),
    makeNote({ bar: 1, beat: 2, pitchMidi: 64, pitchSpelling: "E4", durQn: 1 }),
    makeNote({ bar: 1, beat: 3, pitchMidi: 67, pitchSpelling: "G4", durQn: 1 }),
    makeNote({ bar: 1, beat: 4, pitchMidi: 72, pitchSpelling: "C5", durQn: 1 }),
  ];
}

describe("VariantGenerator", () => {
  const generator = new VariantGenerator();

  describe("generateVariants", () => {
    it("should generate requested number of variants", () => {
      const source = makeSource();
      const config = { count: 5, variationDegree: 0.5 };
      const variants = generator.generateVariants(source, config);
      expect(variants).toHaveLength(5);
    });

    it("should preserve original as first variant when requested", () => {
      const source = makeSource();
      const config = {
        count: 3,
        variationDegree: 0.5,
        preserveOriginal: true,
      };
      const variants = generator.generateVariants(source, config);
      expect(variants).toHaveLength(3);
      expect(variants[0].variationScore).toBe(0);
      expect(variants[0].operations).toHaveLength(0);
      expect(variants[0].notes).toEqual(source);
    });

    it("should return original notes when degree is 0", () => {
      const source = makeSource();
      const config = { count: 3, variationDegree: 0 };
      const variants = generator.generateVariants(source, config);
      expect(variants).toHaveLength(3);
      for (const v of variants) {
        expect(v.variationScore).toBe(0);
        expect(v.operations).toHaveLength(0);
      }
    });

    it("should produce increasing variation scores with higher degree", () => {
      const source = makeSource();
      const low = generator.generateVariants(source, { count: 10, variationDegree: 0.2 });
      const high = generator.generateVariants(source, { count: 10, variationDegree: 0.9 });

      const lowAvg =
        low.reduce((s, v) => s + v.variationScore, 0) / low.length;
      const highAvg =
        high.reduce((s, v) => s + v.variationScore, 0) / high.length;

      expect(highAvg).toBeGreaterThanOrEqual(lowAvg);
    });

    it("should include variant id and description", () => {
      const source = makeSource();
      const config = { count: 2, variationDegree: 0.5 };
      const variants = generator.generateVariants(source, config);
      for (const v of variants) {
        expect(v.id).toBeTruthy();
        expect(typeof v.description).toBe("string");
      }
    });

    it("should respect allowedOperations filter", () => {
      const source = makeSource();
      const config = {
        count: 5,
        variationDegree: 0.5,
        allowedOperations: ["transpose"],
      };
      const variants = generator.generateVariants(source, config);
      for (const v of variants) {
        for (const op of v.operations) {
          expect(op).toBe("transpose");
        }
      }
    });

    it("should handle empty allowedOperations gracefully", () => {
      const source = makeSource();
      const config = {
        count: 3,
        variationDegree: 0.5,
        allowedOperations: [],
      };
      const variants = generator.generateVariants(source, config);
      expect(variants).toHaveLength(3);
    });

    it("should handle empty source notes", () => {
      const source: NoteEvent[] = [];
      const config = { count: 3, variationDegree: 0.5 };
      const variants = generator.generateVariants(source, config);
      expect(variants).toHaveLength(3);
      for (const v of variants) {
        expect(v.notes).toHaveLength(0);
      }
    });

    it("should apply light transforms at degree 0.3", () => {
      const source = makeSource();
      const config = { count: 5, variationDegree: 0.3 };
      const variants = generator.generateVariants(source, config);
      for (const v of variants) {
        for (const op of v.operations) {
          expect(["rhythmicVariation", "velocityShift"]).toContain(op);
        }
      }
    });

    it("should apply medium transforms at degree 0.5", () => {
      const source = makeSource();
      const config = { count: 5, variationDegree: 0.5 };
      const variants = generator.generateVariants(source, config);
      let hasTranspose = false;
      for (const v of variants) {
        if (v.operations.includes("transpose")) hasTranspose = true;
      }
      expect(hasTranspose).toBe(true);
    });

    it("should not mutate source notes", () => {
      const source = makeSource();
      const originalPitch = source[0].pitchMidi;
      generator.generateVariants(source, { count: 3, variationDegree: 0.8 });
      expect(source[0].pitchMidi).toBe(originalPitch);
    });

    it("should assign unique ids to each variant", () => {
      const source = makeSource();
      const config = { count: 5, variationDegree: 0.5 };
      const variants = generator.generateVariants(source, config);
      const ids = variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
