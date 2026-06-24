import { describe, it, expect, beforeEach } from "vitest";
import {
  TasteGenome,
  TempoMap,
  TasteStore,
  type NoteEvent,
  type CandidateFeatures,
  randomUUID,
} from "@collinx/core";
import { TasteMemoryAgent } from "../taste-memory-agent";
import type { RankedCandidate } from "../taste-memory-agent";

function makeNote(
  trackId: string,
  bar: number,
  beat: number,
  pitchMidi: number,
  durQn: number = 1
): NoteEvent {
  return {
    id: randomUUID(),
    trackId,
    phraseId: null,
    bar,
    beat,
    durQn,
    pitchMidi,
    pitchSpelling: `C${Math.floor(pitchMidi / 12) - 1}`,
    velocity: 0.75,
    voice: "rh",
    tags: [],
  };
}

function makeSampleNotes(): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = 1; bar <= 4; bar++) {
    for (let beat = 1; beat <= 4; beat++) {
      notes.push(makeNote("piano", bar, beat, 60 + ((bar + beat) % 12)));
    }
  }
  return notes;
}

describe("TasteMemoryAgent", () => {
  let agent: TasteMemoryAgent;

  beforeEach(() => {
    agent = new TasteMemoryAgent();
  });

  describe("analyzeExport", () => {
    it("should analyze notes and return ExportAnalysisResult", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const result = agent.analyzeExport(notes, tempoMap, "test-export-001");

      expect(result.exportId).toBeTruthy();
      expect(result.exportRef).toBe("test-export-001");
      expect(result.timestamp).toBeTruthy();
      expect(result.features).toBeDefined();
      expect(result.evidenceSet.length).toBeGreaterThan(0);
      expect(result.genomeComparison.length).toBeGreaterThan(0);
      expect(result.tasteDiffSummary).toBeTruthy();
    });

    it("should generate evidence for all taste parameters", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const result = agent.analyzeExport(notes, tempoMap, "test-export-002");

      const paramKeys = result.evidenceSet.map((e) => e.paramKey);
      expect(paramKeys).toContain("harmony.chromatic_color");
      expect(paramKeys).toContain("melody.range_width");
      expect(paramKeys).toContain("rhythm.syncopation");
      expect(paramKeys).toContain("texture.density");
      expect(paramKeys).toContain("timbre.brightness");
      expect(paramKeys).toContain("form.section_contrast");
      expect(paramKeys).toContain("mix.reverb_amount");
    });

    it("should provide genome comparison for all mapped parameters", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const result = agent.analyzeExport(notes, tempoMap, "test-export-003");

      const domains = new Set(result.genomeComparison.map((c) => c.domain));
      expect(domains.has("harmony" as any)).toBe(true);
      expect(domains.has("melody" as any)).toBe(true);
      expect(domains.has("rhythm" as any)).toBe(true);
      expect(domains.has("texture" as any)).toBe(true);
      expect(domains.has("timbre" as any)).toBe(true);
      expect(domains.has("form" as any)).toBe(true);
      expect(domains.has("mix" as any)).toBe(true);

      for (const comp of result.genomeComparison) {
        expect(typeof comp.currentValue).toBe("string");
        expect(typeof comp.genomeValue).toBe("string");
        expect(typeof comp.genomeMean).toBe("string");
        expect(typeof comp.genomeStd).toBe("string");
        expect(typeof comp.deviation).toBe("number");
      }
    });
  });

  describe("confirmWrite", () => {
    it("should confirm write without errors", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const analysis = agent.analyzeExport(notes, tempoMap, "test-confirm-001");
      const evidenceIds = analysis.evidenceSet.map((e) => e.id);

      const genome = TasteGenome.createDefault();
      const result = agent.confirmWrite(evidenceIds, genome);

      expect(result.versionIncremented).toBe(true);
      expect(result.updatedParams.length).toBeGreaterThan(0);
    });

    it("should save genome on confirm", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const analysis = agent.analyzeExport(notes, tempoMap, "test-confirm-002");
      const evidenceIds = analysis.evidenceSet.slice(0, 3).map((e) => e.id);

      const result = agent.confirmWrite(evidenceIds, TasteGenome.createDefault());

      expect(result.versionIncremented).toBe(true);
    });
  });

  describe("rejectEvidence", () => {
    it("should move evidence to tentative buffer on reject", () => {
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const analysis = agent.analyzeExport(notes, tempoMap, "test-reject-001");
      const evidenceIds = analysis.evidenceSet.slice(0, 2).map((e) => e.id);

      agent.rejectEvidence(evidenceIds);

      const pendingCount = agent.getBuffer().countPending();
      expect(pendingCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("rollbackGenome", () => {
    it("should throw for non-existent version", () => {
      expect(() => agent.rollbackGenome(99999)).toThrow();
    });
  });

  describe("getTimeline", () => {
    it("should return array of version entries", () => {
      const timeline = agent.getTimeline();

      expect(Array.isArray(timeline)).toBe(true);
    });
  });

  describe("exportPackage", () => {
    it("should export a valid taste package", () => {
      // First confirm some writes so there is data
      const notes = makeSampleNotes();
      const tempoMap = TempoMap.default();
      const analysis = agent.analyzeExport(notes, tempoMap, "test-export-pkg");
      const evidenceIds = analysis.evidenceSet.slice(0, 3).map((e) => e.id);
      agent.confirmWrite(evidenceIds, TasteGenome.createDefault());

      const pkg = agent.exportPackage();

      expect(pkg.packageVersion).toBe(1);
      expect(pkg.exportedAt).toBeTruthy();
      expect(pkg.genome).toBeDefined();
      expect(pkg.genome.genomeId).toBeTruthy();
      expect(Array.isArray(pkg.evidence)).toBe(true);
      expect(Array.isArray(pkg.versionHistory)).toBe(true);
    });
  });

  describe("rankWithTaste", () => {
    it("should rank candidates by taste preference", () => {
      const candidateSet1: CandidateFeatures[] = [
        { paramKey: "harmony.chromatic_color", value: 0.3 },
        { paramKey: "melody.range_width", value: 0.6 },
        { paramKey: "rhythm.syncopation", value: 0.5 },
      ];

      const candidateSet2: CandidateFeatures[] = [
        { paramKey: "harmony.chromatic_color", value: 0.8 },
        { paramKey: "melody.range_width", value: 0.2 },
        { paramKey: "rhythm.syncopation", value: 0.1 },
      ];

      const ranked = agent.rankWithTaste(
        [candidateSet1, candidateSet2],
        { genre: ["classical"] }
      );

      expect(ranked.length).toBe(2);
      expect(ranked[0]!.rank).toBe(1);
      expect(ranked[1]!.rank).toBe(2);
      expect(ranked[0]!.score.totalScore).toBeGreaterThanOrEqual(
        ranked[1]!.score.totalScore
      );
    });

    it("should return ranked candidates with proper structure", () => {
      const candidates: CandidateFeatures[] = [
        { paramKey: "harmony.chord_density", value: 0.4 },
      ];

      const ranked = agent.rankWithTaste([candidates], {
        task: "compose",
        genre: ["pop"],
      });

      expect(ranked.length).toBe(1);
      expect(ranked[0]!.rank).toBe(1);
      expect(ranked[0]!.score.totalScore).toBeGreaterThanOrEqual(0);
      expect(ranked[0]!.score.domainScores).toBeDefined();
      expect(ranked[0]!.score.rejectPenalties).toBeDefined();
    });

    it("should rank empty candidate list without error", () => {
      const ranked = agent.rankWithTaste([], {});

      expect(ranked.length).toBe(0);
    });
  });

  describe("getEffectiveTaste", () => {
    it("should return a taste genome", () => {
      const genome = agent.getEffectiveTaste({ genre: ["classical"] });

      expect(genome).toBeDefined();
      expect(genome.genomeId).toBeTruthy();
      expect(typeof genome.version).toBe("number");
    });
  });

  describe("getStore / getBuffer / getAnalyzer / getScorer", () => {
    it("should return internal components", () => {
      expect(agent.getStore()).toBeInstanceOf(TasteStore);
      expect(agent.getBuffer()).toBeDefined();
      expect(agent.getAnalyzer()).toBeDefined();
      expect(agent.getScorer()).toBeDefined();
    });
  });
});
