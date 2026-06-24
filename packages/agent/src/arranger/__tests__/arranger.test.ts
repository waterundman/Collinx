import { describe, it, expect } from "vitest";
import { Arranger } from "../arranger";
import type { NoteEvent } from "@collinx/core";
import { TasteGenome, ScoringEngine } from "@collinx/core";
import type { FormTemplate } from "@collinx/core";

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

function makeMotif(barOffset = 1, count = 8): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let i = 0; i < count; i++) {
    notes.push(
      makeNote({
        bar: barOffset + Math.floor(i / 4),
        beat: (i % 4) + 1,
        pitchMidi: 60 + (i % 8) * 2,
        pitchSpelling: `C${4 + Math.floor(i / 8)}`,
        durQn: 1,
      })
    );
  }
  return notes;
}

describe("Arranger", () => {
  const arranger = new Arranger();

  describe("arrange()", () => {
    it("should generate complete arrangement using pop_ababcb template", () => {
      const motifs = [makeMotif(), makeMotif(2, 4)];
      const result = arranger.arrange(motifs, {
        formTemplate: "pop_ababcb",
        barCount: 48,
      });

      expect(result.formStructure.name).toBe("Pop ABABCB");
      expect(result.formStructure.sections).toHaveLength(6);
      expect(result.variants.length).toBeGreaterThan(0);
      expect(result.diffs.length).toBeGreaterThan(0);
      expect(result.selectedVariant).toBeDefined();
      expect(result.energyCurve).toBeDefined();
      expect(typeof result.tasteScore).toBe("number");
      expect(typeof result.confidence).toBe("number");
    });

    it("should throw for non-existent template", () => {
      const motifs = [makeMotif()];
      expect(() =>
        arranger.arrange(motifs, {
          formTemplate: "nonexistent",
          barCount: 16,
        })
      ).toThrow("Form template not found");
    });

    it("should handle empty motifs gracefully", () => {
      const result = arranger.arrange([], {
        formTemplate: "minimal",
        barCount: 16,
      });

      expect(result.formStructure.sections).toHaveLength(2);
      expect(result.selectedVariant.notes).toHaveLength(0);
    });

    it("should produce valid energy curve from sections", () => {
      const motifs = [makeMotif(), makeMotif(2, 4)];
      const result = arranger.arrange(motifs, {
        formTemplate: "pop_ababcb",
        barCount: 48,
      });

      const points = result.energyCurve.getPoints();
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p.level).toBeGreaterThanOrEqual(0);
        expect(p.level).toBeLessThanOrEqual(1);
      }
    });

    it("should produce unique variant ids", () => {
      const motifs = [makeMotif(), makeMotif(2, 4)];
      const result = arranger.arrange(motifs, {
        formTemplate: "pop_ababcb",
        barCount: 48,
        variantCount: 3,
      });

      const ids = result.variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("expandSection()", () => {
    it("should produce correct number of variants", () => {
      const source = makeMotif();
      const result = arranger.expandSection(source, {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      }, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 4,
      });

      expect(result.variants).toHaveLength(4);
    });

    it("should preserve original as first variant", () => {
      const source = makeMotif();
      const result = arranger.expandSection(source, {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      }, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 3,
      });

      expect(result.variants[0].operations).toHaveLength(0);
      expect(result.variants[0].variationScore).toBe(0);
    });

    it("should generate diffs for each variant", () => {
      const source = makeMotif();
      const result = arranger.expandSection(source, {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      }, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 3,
      });

      expect(result.diffs).toHaveLength(3);
      for (const diff of result.diffs) {
        expect(diff.diffId).toBeTruthy();
        expect(diff.baseRevision).toBeTruthy();
        expect(diff.actor.type).toBe("agent");
        expect(diff.actor.name).toBe("arranger");
        expect(diff.permissionScope).toBe("proposal_only");
        expect(diff.ops.length).toBeGreaterThan(0);
        expect(diff.rollbackToken).toBeTruthy();
      }
    });

    it("should produce correct section in result form structure", () => {
      const source = makeMotif();
      const section = {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };
      const result = arranger.expandSection(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 2,
      });

      expect(result.formStructure.sections).toHaveLength(1);
      expect(result.formStructure.sections[0].id).toBe("s1");
    });
  });

  describe("generateVariants()", () => {
    it("should produce distinct variants", () => {
      const source = makeMotif();
      const section = {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };
      const result = arranger.generateVariants(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 5,
      });

      const hasVariation = result.variants.some((v) => v.variationScore > 0);
      expect(hasVariation).toBe(true);
    });

    it("should generate diffs with add_note_group ops", () => {
      const source = makeMotif();
      const section = {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };
      const result = arranger.generateVariants(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 2,
      });

      for (const diff of result.diffs) {
        expect(diff.ops[0].op).toBe("add_note_group");
        expect(Array.isArray((diff.ops[0] as { notes: NoteEvent[] }).notes)).toBe(true);
      }
    });
  });

  describe("rankVariants()", () => {
    it("should sort variants by taste score", () => {
      const genome = TasteGenome.createDefault();
      const scorer = new ScoringEngine();
      const arrangerWithScorer = new Arranger(scorer);

      const source = makeMotif();
      const section = {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };
      const result = arrangerWithScorer.generateVariants(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 5,
      });

      const ranked = arrangerWithScorer.rankVariants(result.variants, genome);
      expect(ranked.length).toBe(result.variants.length);
    });
  });

  describe("variantToDiff()", () => {
    it("should produce valid DiffEnvelope", () => {
      const source = makeMotif();
      const section = {
        id: "s1",
        name: "Test Section",
        formRole: "verse" as unknown as never,
        startBar: 1,
        endBar: 8,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };
      const result = arranger.generateVariants(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 16,
        variantCount: 1,
      });

      const diff = result.diffs[0];

      expect(diff.diffId).toBeTruthy();
      expect(diff.baseRevision).toContain("section-s1");
      expect(diff.actor).toEqual({ type: "agent", name: "arranger" });
      expect(diff.permissionScope).toBe("proposal_only");
      expect(diff.summary).toBeTruthy();
      expect(diff.ops[0].op).toBe("add_note_group");
      expect(diff.domainExplanations.length).toBe(1);
      expect(diff.rollbackToken).toBeTruthy();
      expect(diff.riskFlags).toEqual([]);
    });
  });

  describe("fillTemplate()", () => {
    it("should produce correct section count", () => {
      const template: FormTemplate = {
        name: "Test",
        description: "test template",
        sections: [
          { role: "verse" as never, bars: 4, energy: 0.3 },
          { role: "chorus" as never, bars: 4, energy: 0.7 },
          { role: "verse" as never, bars: 4, energy: 0.35 },
        ],
      };

      const result = arranger.fillTemplate(template, []);
      expect(result.sections).toHaveLength(3);
    });

    it("should assign sequential bar ranges", () => {
      const template: FormTemplate = {
        name: "Test",
        description: "test template",
        sections: [
          { role: "verse" as never, bars: 4, energy: 0.3 },
          { role: "chorus" as never, bars: 8, energy: 0.7 },
        ],
      };

      const result = arranger.fillTemplate(template, []);
      expect(result.sections[0].startBar).toBe(1);
      expect(result.sections[0].endBar).toBe(4);
      expect(result.sections[1].startBar).toBe(5);
      expect(result.sections[1].endBar).toBe(12);
    });

    it("should create unique section ids", () => {
      const template: FormTemplate = {
        name: "Test",
        description: "test template",
        sections: [
          { role: "verse" as never, bars: 4, energy: 0.3 },
          { role: "chorus" as never, bars: 4, energy: 0.7 },
        ],
      };

      const result = arranger.fillTemplate(template, []);
      const ids = result.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(2);
    });
  });
});
