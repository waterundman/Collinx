import { describe, it, expect, beforeEach } from "vitest";
import { ExportAnalyzer } from "../export-analyzer";
import { TasteGenome } from "../taste-genome";
import { TempoMap } from "../../model/tempo-map";
import type { NoteEvent } from "../../model/note-event";
import { randomUUID } from "../../util/random-uuid";

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: randomUUID(),
    trackId: "track-1",
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1.0,
    pitchMidi: 60,
    pitchSpelling: "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
    ...overrides,
  };
}

const defaultTempoMap = TempoMap.default();

describe("ExportAnalyzer", () => {
  let analyzer: ExportAnalyzer;

  beforeEach(() => {
    analyzer = new ExportAnalyzer();
  });

  describe("analyze() - end-to-end", () => {
    it("should return a complete ExportAnalysisResult", () => {
      const notes = Array.from({ length: 8 }, (_, i) =>
        makeNote({
          bar: 1,
          beat: i * 0.5 + 1,
          pitchMidi: 60 + i * 2,
          durQn: 0.5,
        })
      );
      const genome = TasteGenome.createDefault();

      const result = analyzer.analyze(notes, defaultTempoMap, genome);

      expect(result.exportId).toBeDefined();
      expect(result.exportRef).toContain("export://");
      expect(result.timestamp).toBeDefined();
      expect(result.features.harmony).toBeDefined();
      expect(result.evidenceSet.length).toBeGreaterThan(0);
      expect(result.genomeComparison.length).toBeGreaterThan(0);
      expect(result.tasteDiffSummary.length).toBeGreaterThan(0);
    });

    it("should use custom exportRef when provided", () => {
      const notes = [makeNote()];
      const genome = TasteGenome.createDefault();
      const result = analyzer.analyze(
        notes,
        defaultTempoMap,
        genome,
        undefined,
        "export://custom_v1"
      );

      expect(result.exportRef).toBe("export://custom_v1");
      expect(result.evidenceSet.every((e) => e.ref === "export://custom_v1")).toBe(true);
    });
  });

  describe("compareWithGenome", () => {
    it("should return comparisons for all mapped parameters", () => {
      const notes = Array.from({ length: 16 }, (_, i) =>
        makeNote({
          bar: Math.ceil((i + 1) / 4),
          beat: (i % 4) + 1,
          pitchMidi: 60 + i,
        })
      );
      const genome = TasteGenome.createDefault();
      const analyzerInstance = analyzer;

      const tempExtractor = new (analyzer as any).extractor.constructor();
      const features = tempExtractor.extract(notes, defaultTempoMap);
      const comparisons = analyzer.compareWithGenome(features, genome);

      expect(comparisons.length).toBeGreaterThanOrEqual(18);

      expect(comparisons.every((c) => typeof c.paramKey === "string")).toBe(true);
      expect(comparisons.every((c) => typeof c.currentValue === "string")).toBe(true);
      expect(comparisons.every((c) => typeof c.genomeValue === "string")).toBe(true);
      expect(comparisons.every((c) => typeof c.deviation === "number")).toBe(true);
      expect(comparisons.every((c) => c.domain.length > 0)).toBe(true);
    });

    it("should compute deviation for known parameters", () => {
      const genome = TasteGenome.createDefault();
      const notes = [makeNote()];
      const tempExtractor = new (analyzer as any).extractor.constructor();
      const features = tempExtractor.extract(notes, defaultTempoMap);
      const comparisons = analyzer.compareWithGenome(features, genome);

      const syncComp = comparisons.find((c) => c.paramKey === "rhythm.syncopation");
      expect(syncComp).toBeDefined();
      const dev = Number(syncComp!.deviation);
      expect(isNaN(dev)).toBe(false);
    });

    it("should handle missing genome parameters gracefully", () => {
      const genome = TasteGenome.create();
      const notes = [makeNote()];
      const tempExtractor = new (analyzer as any).extractor.constructor();
      const features = tempExtractor.extract(notes, defaultTempoMap);
      const comparisons = analyzer.compareWithGenome(features, genome);

      expect(comparisons.length).toBeGreaterThanOrEqual(18);
      expect(comparisons.every((c) => c.deviation >= 0)).toBe(true);
    });
  });

  describe("generateSummary", () => {
    it("should return close match for low deviation comparisons", () => {
      const comparisons = [
        {
          paramKey: "harmony.chromatic_color",
          currentValue: "0.33",
          genomeValue: "0.33",
          genomeMean: "0.33",
          genomeStd: "0.1",
          deviation: 0.0,
          domain: "harmony" as any,
        },
      ];

      const summary = analyzer.generateSummary(comparisons);
      expect(summary).toContain("closely matches");
    });

    it("should describe top deviations in natural language", () => {
      const comparisons = [
        {
          paramKey: "rhythm.syncopation",
          currentValue: "0.80",
          genomeValue: "0.50",
          genomeMean: "0.50",
          genomeStd: "0.15",
          deviation: 2.0,
          domain: "rhythm" as any,
        },
        {
          paramKey: "timbre.brightness",
          currentValue: "0.20",
          genomeValue: "0.60",
          genomeMean: "0.60",
          genomeStd: "0.12",
          deviation: 3.33,
          domain: "timbre" as any,
        },
        {
          paramKey: "mix.reverb_amount",
          currentValue: "0.90",
          genomeValue: "0.30",
          genomeMean: "0.30",
          genomeStd: "0.1",
          deviation: 6.0,
          domain: "mix" as any,
        },
      ];

      const summary = analyzer.generateSummary(comparisons);
      expect(summary).toContain("reverb amount");
      expect(summary).toContain("brightness");
      expect(summary).toContain("syncopation");
      expect(summary).toContain("significant departure");
    });

    it("should handle empty comparisons", () => {
      const summary = analyzer.generateSummary([]);
      expect(summary).toContain("No comparisons");
    });
  });

  describe("shouldSuggestUpdate", () => {
    it("should return false for low deviation results", () => {
      const result = {
        exportId: "test",
        exportRef: "export://test",
        timestamp: new Date().toISOString(),
        features: {} as any,
        evidenceSet: [],
        genomeComparison: [
          {
            paramKey: "harmony.chromatic_color",
            currentValue: "0.33",
            genomeValue: "0.33",
            genomeMean: "0.33",
            genomeStd: "0.1",
            deviation: 0.0,
            domain: "harmony" as any,
          },
        ],
        tasteDiffSummary: "",
      };

      expect(analyzer.shouldSuggestUpdate(result)).toBe(false);
    });

    it("should return true for high deviation results", () => {
      const result = {
        exportId: "test",
        exportRef: "export://test",
        timestamp: new Date().toISOString(),
        features: {} as any,
        evidenceSet: [],
        genomeComparison: [
          {
            paramKey: "mix.reverb_amount",
            currentValue: "0.95",
            genomeValue: "0.30",
            genomeMean: "0.30",
            genomeStd: "0.1",
            deviation: 6.5,
            domain: "mix" as any,
          },
        ],
        tasteDiffSummary: "",
      };

      expect(analyzer.shouldSuggestUpdate(result)).toBe(true);
    });

    it("should return true when any parameter exceeds threshold", () => {
      const result = {
        exportId: "test",
        exportRef: "export://test",
        timestamp: new Date().toISOString(),
        features: {} as any,
        evidenceSet: [],
        genomeComparison: [
          {
            paramKey: "harmony.chromatic_color",
            currentValue: "0.33",
            genomeValue: "0.33",
            genomeMean: "0.33",
            genomeStd: "0.1",
            deviation: 0.0,
            domain: "harmony" as any,
          },
          {
            paramKey: "form.section_contrast",
            currentValue: "0.95",
            genomeValue: "0.50",
            genomeMean: "0.50",
            genomeStd: "0.1",
            deviation: 4.5,
            domain: "form" as any,
          },
        ],
        tasteDiffSummary: "",
      };

      expect(analyzer.shouldSuggestUpdate(result)).toBe(true);
    });
  });

  describe("Genome comparison for default genome", () => {
    it("should produce reasonable deviations for a set of notes", () => {
      const notes = Array.from({ length: 16 }, (_, i) =>
        makeNote({
          bar: Math.ceil((i + 1) / 4),
          beat: (i % 4) + 1,
          pitchMidi: 60 + i,
        })
      );
      const genome = TasteGenome.createDefault();

      const result = analyzer.analyze(notes, defaultTempoMap, genome);
      const deviations = result.genomeComparison.map((c) => c.deviation);

      expect(deviations.every((d) => d >= 0)).toBe(true);
      const maxDev = Math.max(...deviations);
      expect(maxDev).toBeGreaterThanOrEqual(0);
    });
  });
});
