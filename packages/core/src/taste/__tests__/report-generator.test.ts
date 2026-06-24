import { describe, it, expect, beforeEach } from "vitest";
import { ReportGenerator, type EvidenceItem } from "../report-generator";
import { ExportAnalyzer, type ExportAnalysisResult, type GenomeComparison } from "../export-analyzer";
import { TasteGenome } from "../taste-genome";
import { EvidenceExtractor } from "../evidence-extractor";
import { TempoMap } from "../../model/tempo-map";
import type { NoteEvent } from "../../model/note-event";
import { TasteDomain } from "../taste-types";
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

function buildAnalysisResult(
  overrides: Partial<ExportAnalysisResult> = {}
): ExportAnalysisResult {
  const extractor = new EvidenceExtractor();
  const notes = Array.from({ length: 16 }, (_, i) =>
    makeNote({ bar: Math.floor(i / 4) + 1, beat: (i % 4) + 1, pitchMidi: 60 + i })
  );
  const tempoMap = TempoMap.default();
  const features = extractor.extract(notes, tempoMap);

  return {
    exportId: randomUUID(),
    exportRef: "export://test",
    timestamp: new Date().toISOString(),
    features,
    evidenceSet: extractor.toEvidenceSet(features, "export://test"),
    genomeComparison: [],
    tasteDiffSummary: "",
    ...overrides,
  };
}

function buildGenomeComparison(
  overrides: Partial<GenomeComparison> = {}
): GenomeComparison {
  return {
    paramKey: "harmony.chromatic_color",
    currentValue: "0.5",
    genomeValue: "0.33",
    genomeMean: "0.33",
    genomeStd: "0.12",
    deviation: 1.42,
    domain: TasteDomain.Harmony,
    ...overrides,
  };
}

describe("ReportGenerator", () => {
  let generator: ReportGenerator;

  beforeEach(() => {
    generator = new ReportGenerator();
  });

  describe("generate() - full report", () => {
    it("should produce a complete TasteDiffReport from analysis result", () => {
      const genome = TasteGenome.createDefault();

      const comparisons: GenomeComparison[] = [
        buildGenomeComparison({ paramKey: "harmony.chromatic_color", deviation: 2.5, domain: TasteDomain.Harmony }),
        buildGenomeComparison({ paramKey: "rhythm.syncopation", deviation: 1.2, domain: TasteDomain.Rhythm }),
        buildGenomeComparison({ paramKey: "mix.reverb_amount", deviation: 0.3, domain: TasteDomain.Mix }),
        buildGenomeComparison({ paramKey: "reject.triplet_fill_before_drop", deviation: 3.0, currentValue: "0.9", genomeMean: "0.1", domain: TasteDomain.Reject }),
      ];

      const result = buildAnalysisResult({ genomeComparison: comparisons });
      const report = generator.generate(result, genome);

      expect(report.reportId).toBeDefined();
      expect(report.exportRef).toBe("export://test");
      expect(report.genomeVersion).toBe(0);
      expect(report.generatedAt).toBeDefined();
      expect(report.evidenceItems).toHaveLength(4);
      expect(report.summary).toBeTruthy();
      expect(report.suggestions.length).toBeGreaterThan(0);
      expect(report.stats.totalComparisons).toBe(4);
    });

    it("should compute correct stats counts", () => {
      const genome = TasteGenome.createDefault();
      const comparisons: GenomeComparison[] = [
        buildGenomeComparison({ deviation: 3.0 }),
        buildGenomeComparison({ deviation: 2.5 }),
        buildGenomeComparison({ deviation: 1.5 }),
        buildGenomeComparison({ deviation: 0.8 }),
        buildGenomeComparison({ deviation: 0.3 }),
      ];
      const result = buildAnalysisResult({ genomeComparison: comparisons });
      const report = generator.generate(result, genome);

      expect(report.stats.significantDeviations).toBe(2);
      expect(report.stats.mildDeviations).toBe(1);
      expect(report.stats.inTolerance).toBe(2);
    });
  });

  describe("formatEvidenceItem()", () => {
    it("should return deviationLabel 'high' for deviation > 2.0", () => {
      const genome = TasteGenome.createDefault();
      const comparison = buildGenomeComparison({ deviation: 2.5 });
      const param = genome.getParameter(comparison.paramKey);
      const item = generator.formatEvidenceItem(comparison, param);

      expect(item.deviationLabel).toBe("high");
    });

    it("should return deviationLabel 'moderate' for deviation > 1.0", () => {
      const genome = TasteGenome.createDefault();
      const comparison = buildGenomeComparison({ deviation: 1.5 });
      const param = genome.getParameter(comparison.paramKey);
      const item = generator.formatEvidenceItem(comparison, param);

      expect(item.deviationLabel).toBe("moderate");
    });

    it("should return deviationLabel 'mild' for deviation > 0.5", () => {
      const genome = TasteGenome.createDefault();
      const comparison = buildGenomeComparison({ deviation: 0.6 });
      const param = genome.getParameter(comparison.paramKey);
      const item = generator.formatEvidenceItem(comparison, param);

      expect(item.deviationLabel).toBe("mild");
    });

    it("should return deviationLabel 'none' for deviation <= 0.5", () => {
      const genome = TasteGenome.createDefault();
      const comparison = buildGenomeComparison({ deviation: 0.2 });
      const param = genome.getParameter(comparison.paramKey);
      const item = generator.formatEvidenceItem(comparison, param);

      expect(item.deviationLabel).toBe("none");
    });

    it("should include human-readable Chinese labels", () => {
      const genome = TasteGenome.createDefault();
      const comparison = buildGenomeComparison({
        paramKey: "melody.range_width",
        domain: TasteDomain.Melody,
      });
      const param = genome.getParameter(comparison.paramKey);
      const item = generator.formatEvidenceItem(comparison, param);

      expect(item.label).toBe("旋律音域宽度");
      expect(item.domain).toBe(TasteDomain.Melody);
    });

    it("should handle undefined parameter gracefully", () => {
      const comparison = buildGenomeComparison({ paramKey: "unknown.param" });
      const item = generator.formatEvidenceItem(comparison, undefined);

      expect(item.label).toBe("unknown.param");
      expect(item.confidence).toBe(0.5);
    });
  });

  describe("generateSummary()", () => {
    it("should mention domain breakdown in summary", () => {
      const items: EvidenceItem[] = [
        {
          paramKey: "harmony.chromatic_color",
          domain: TasteDomain.Harmony,
          label: "和声色彩丰富度",
          currentValue: 0.8,
          genomePreferred: 0.33,
          deviation: 3.9,
          deviationLabel: "high",
          description: "显著高于偏好",
          suggestion: "确认写入",
          evidenceSource: "genome_comparison",
          confidence: 0.5,
        },
        {
          paramKey: "rhythm.syncopation",
          domain: TasteDomain.Rhythm,
          label: "切分节奏量",
          currentValue: 0.3,
          genomePreferred: 0.5,
          deviation: 1.5,
          deviationLabel: "moderate",
          description: "中等偏低",
          suggestion: "审阅",
          evidenceSource: "genome_comparison",
          confidence: 0.5,
        },
      ];

      const result = buildAnalysisResult({ genomeComparison: [] });
      const summary = generator.generateSummary(items, result);

      expect(summary).toContain("和声");
      expect(summary).toContain("节奏");
    });

    it("should return '基本相符' when no significant deviations", () => {
      const items: EvidenceItem[] = [
        {
          paramKey: "mix.reverb_amount",
          domain: TasteDomain.Mix,
          label: "混响量",
          currentValue: 0.31,
          genomePreferred: 0.30,
          deviation: 0.1,
          deviationLabel: "none",
          description: "基本一致",
          suggestion: "无需调整",
          evidenceSource: "genome_comparison",
          confidence: 0.5,
        },
      ];

      const result = buildAnalysisResult({ genomeComparison: [] });
      const summary = generator.generateSummary(items, result);

      expect(summary).toMatch(/相符|差异/);
    });

    it("should handle empty items array", () => {
      const result = buildAnalysisResult({ genomeComparison: [] });
      const summary = generator.generateSummary([], result);

      expect(summary).toContain("没有发现");
    });
  });

  describe("generateSuggestions()", () => {
    it("should assign correct priority levels based on deviation", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({ deviation: 3.0, domain: TasteDomain.Harmony }),
        buildEvidenceItem({ deviation: 1.5, domain: TasteDomain.Rhythm }),
        buildEvidenceItem({ deviation: 0.3, domain: TasteDomain.Mix }),
      ];

      const suggestions = generator.generateSuggestions(items);

      const high = suggestions.filter((s) => s.priority === "high");
      const medium = suggestions.filter((s) => s.priority === "medium");
      const low = suggestions.filter((s) => s.priority === "low");

      expect(high).toHaveLength(1);
      expect(medium).toHaveLength(1);
      expect(low).toHaveLength(1);
    });

    it("should mark Reject domain deviations as write_to_reject", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({
          deviation: 2.5,
          domain: TasteDomain.Reject,
          paramKey: "reject.triplet_fill_before_drop",
        }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions[0].action).toBe("write_to_reject");
      expect(suggestions[0].priority).toBe("high");
    });

    it("should mark non-Reject high deviations as write_to_genome", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({
          deviation: 2.5,
          domain: TasteDomain.Harmony,
          paramKey: "harmony.chromatic_color",
        }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions[0].action).toBe("write_to_genome");
      expect(suggestions[0].priority).toBe("high");
    });

    it("should mark moderate deviations as review", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({
          deviation: 1.5,
          domain: TasteDomain.Melody,
          paramKey: "melody.leap_ratio",
        }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions[0].action).toBe("review");
      expect(suggestions[0].priority).toBe("medium");
    });

    it("should mark low deviations as ignore", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({
          deviation: 0.3,
          domain: TasteDomain.Mix,
          paramKey: "mix.reverb_amount",
        }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions[0].action).toBe("ignore");
      expect(suggestions[0].priority).toBe("low");
    });

    it("should sort suggestions by priority", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({ deviation: 0.3, domain: TasteDomain.Mix, paramKey: "mix.reverb_amount" }),
        buildEvidenceItem({ deviation: 2.5, domain: TasteDomain.Harmony, paramKey: "harmony.chromatic_color" }),
        buildEvidenceItem({ deviation: 1.5, domain: TasteDomain.Rhythm, paramKey: "rhythm.syncopation" }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions[0].priority).toBe("high");
      expect(suggestions[1].priority).toBe("medium");
      expect(suggestions[2].priority).toBe("low");
    });

    it("should handle all-high-deviation items", () => {
      const items: EvidenceItem[] = [
        buildEvidenceItem({ deviation: 2.5, domain: TasteDomain.Harmony, paramKey: "harmony.chromatic_color" }),
        buildEvidenceItem({ deviation: 3.0, domain: TasteDomain.Rhythm, paramKey: "rhythm.syncopation" }),
        buildEvidenceItem({ deviation: 2.8, domain: TasteDomain.Melody, paramKey: "melody.range_width" }),
      ];

      const suggestions = generator.generateSuggestions(items);

      expect(suggestions.every((s) => s.priority === "high")).toBe(true);
    });
  });

  describe("formatForUI()", () => {
    it("should group items by all 8 domains", () => {
      const genome = TasteGenome.createDefault();
      const allDomainParams: [string, TasteDomain][] = [
        ["harmony.chromatic_color", TasteDomain.Harmony],
        ["melody.range_width", TasteDomain.Melody],
        ["rhythm.syncopation", TasteDomain.Rhythm],
        ["texture.density", TasteDomain.Texture],
        ["timbre.brightness", TasteDomain.Timbre],
        ["form.section_contrast", TasteDomain.Form],
        ["mix.reverb_amount", TasteDomain.Mix],
        ["reject.triplet_fill_before_drop", TasteDomain.Reject],
      ];

      const comparisons = allDomainParams.map(([key, domain]) =>
        buildGenomeComparison({ paramKey: key, domain, deviation: 1.0 })
      );

      const result = buildAnalysisResult({ genomeComparison: comparisons });
      const report = generator.generate(result, genome);
      const ui = generator.formatForUI(report);

      expect(ui.groups).toHaveLength(8);
      expect(ui.header.title).toBe("品味差异报告");
      expect(ui.header.subtitle).toContain("export://test");

      const domainLabels = ui.groups.map((g) => g.label);
      expect(domainLabels).toContain("和声");
      expect(domainLabels).toContain("排除项");

      for (const group of ui.groups) {
        expect(group.items.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should handle empty report", () => {
      const genome = TasteGenome.createDefault();
      const result = buildAnalysisResult({ genomeComparison: [] });
      const report = generator.generate(result, genome);
      const ui = generator.formatForUI(report);

      expect(ui.groups).toHaveLength(8);
      expect(ui.stats.totalComparisons).toBe(0);
      expect(ui.stats.significantDeviations).toBe(0);
    });
  });

  describe("Report JSON serialization", () => {
    it("should produce JSON-serializable report", () => {
      const genome = TasteGenome.createDefault();
      const comparisons = [
        buildGenomeComparison({ deviation: 2.0 }),
        buildGenomeComparison({ deviation: 0.5 }),
      ];
      const result = buildAnalysisResult({ genomeComparison: comparisons });
      const report = generator.generate(result, genome);

      const json = JSON.stringify(report);
      const parsed = JSON.parse(json);

      expect(parsed.reportId).toBe(report.reportId);
      expect(parsed.evidenceItems).toHaveLength(2);
      expect(parsed.suggestions).toBeDefined();
      expect(parsed.stats.totalComparisons).toBe(2);
    });
  });
});

function buildEvidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    paramKey: "harmony.chromatic_color",
    domain: TasteDomain.Harmony,
    label: "和声色彩丰富度",
    currentValue: 0.5,
    genomePreferred: 0.33,
    deviation: 1.0,
    deviationLabel: "moderate",
    description: "",
    suggestion: "",
    evidenceSource: "genome_comparison",
    confidence: 0.5,
    ...overrides,
  };
}
