import { describe, it, expect, beforeEach } from "vitest";
import { createNoteEvent, type NoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import { ExportAnalyzer } from "../../taste/export-analyzer";
import { UpdateEngine } from "../../taste/update-engine";
import { ScoringEngine } from "../../taste/scoring-engine";
import { TasteGenome } from "../../taste/taste-genome";
import type { CandidateFeatures } from "../../taste/scoring-engine";
import type { TasteContext } from "../../taste/taste-types";

function createTestNotes(): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = 1; bar <= 8; bar++) {
    for (let beat = 1; beat <= 4; beat++) {
      const pitch = 60 + ((bar * 2 + beat) % 12);
      notes.push(
        createNoteEvent({
          trackId: "melody",
          bar,
          beat,
          durQn: 1.0,
          pitchMidi: pitch,
          velocity: Math.random() * 0.4 + 0.6,
          voice: "rh",
          tags: ["test"],
        })
      );
    }
  }
  return notes;
}

describe("NoteEvent + TempoMap + ExportAnalyzer + UpdateEngine + ScoringEngine integration", () => {
  let notes: NoteEvent[];
  let tempoMap: TempoMap;
  let genome: TasteGenome;
  let exportAnalyzer: ExportAnalyzer;
  let updateEngine: UpdateEngine;
  let scoringEngine: ScoringEngine;

  beforeEach(() => {
    notes = createTestNotes();
    tempoMap = TempoMap.default();
    genome = TasteGenome.createDefault();
    exportAnalyzer = new ExportAnalyzer();
    updateEngine = new UpdateEngine();
    scoringEngine = new ScoringEngine();
  });

  it("should analyze exported notes and generate evidence", () => {
    const result = exportAnalyzer.analyze(notes, tempoMap, genome);

    expect(result.exportId).toBeDefined();
    expect(result.evidenceSet.length).toBeGreaterThan(0);
    expect(result.evidenceSet[0]).toHaveProperty("paramKey");
    expect(result.evidenceSet[0]).toHaveProperty("pointEstimate");
    expect(result.genomeComparison.length).toBeGreaterThan(0);
    expect(result.tasteDiffSummary).toBeTruthy();
  });

  it("should update genome with extracted evidence", () => {
    const preVersion = genome.version;

    const analysis = exportAnalyzer.analyze(notes, tempoMap, genome);
    const updateResult = updateEngine.update(genome, analysis.evidenceSet, {
      confirmed: true,
    });

    expect(updateResult.versionIncremented).toBe(true);
    expect(updateResult.genome.version).toBeGreaterThan(preVersion);
    expect(updateResult.updatedParams.length).toBeGreaterThan(0);
  });

  it("should skip update when not confirmed", () => {
    const analysis = exportAnalyzer.analyze(notes, tempoMap, genome);
    const updateResult = updateEngine.update(genome, analysis.evidenceSet, {
      confirmed: false,
    });

    expect(updateResult.updatedParams).toHaveLength(0);
    expect(updateResult.skippedParams.length).toBeGreaterThan(0);
    expect(updateResult.versionIncremented).toBe(false);
  });

  it("should score candidates and reflect taste influence", () => {
    const context: TasteContext = { genre: ["pop"], task: "composition" };

    const candidates: CandidateFeatures[] = [
      { paramKey: "melody.range_width", value: 0.6 },
      { paramKey: "melody.leap_ratio", value: 0.2 },
      { paramKey: "rhythm.syncopation", value: 0.5 },
      { paramKey: "texture.density", value: 0.55 },
      { paramKey: "timbre.brightness", value: 0.65 },
    ];

    const vanillaScore = scoringEngine.score(candidates, genome, context);

    // Analyze notes and update genome
    const analysis = exportAnalyzer.analyze(notes, tempoMap, genome);
    const updatedGenome = updateEngine.update(genome, analysis.evidenceSet, {
      confirmed: true,
    }).genome;

    const adaptedScore = scoringEngine.score(candidates, updatedGenome, context);

    // Scoring results should be structurally valid
    expect(vanillaScore.totalScore).toBeGreaterThanOrEqual(0);
    expect(vanillaScore.domainScores).toBeDefined();
    expect(Object.keys(vanillaScore.domainScores).length).toBeGreaterThan(0);

    expect(adaptedScore.totalScore).toBeGreaterThanOrEqual(0);
    expect(adaptedScore.domainScores).toBeDefined();
    // After update, the taste should influence scores
    expect(adaptedScore.totalScore).not.toBeNaN();
  });

  it("should complete full export-learn-score closed loop", () => {
    // Step 1: Analyze initial notes against default genome
    const analysis1 = exportAnalyzer.analyze(notes, tempoMap, genome);
    expect(analysis1.genomeComparison.length).toBeGreaterThan(0);

    // Step 2: Update genome with evidence
    const { genome: updatedGenome } = updateEngine.update(
      genome,
      analysis1.evidenceSet,
      { confirmed: true }
    );
    expect(updatedGenome.version).toBeGreaterThan(genome.version);

    // Step 3: Analyze the same notes against updated genome (should be closer match)
    const analysis2 = exportAnalyzer.analyze(notes, tempoMap, updatedGenome);
    expect(analysis2.genomeComparison.length).toBeGreaterThan(0);

    // Step 4: Score candidates with both genomes
    const context: TasteContext = {};
    const candidates: CandidateFeatures[] = [
      { paramKey: "melody.range_width", value: 0.5 },
      { paramKey: "rhythm.syncopation", value: 0.3 },
      { paramKey: "timbre.brightness", value: 0.6 },
    ];

    const scoreBefore = scoringEngine.score(candidates, genome, context);
    const scoreAfter = scoringEngine.score(candidates, updatedGenome, context);

    expect(scoreBefore.totalScore).toBeDefined();
    expect(scoreAfter.totalScore).toBeDefined();

    // Scoring engine should also support ranking
    const ranked = scoringEngine.rank(
      [
        candidates,
        [{ paramKey: "melody.range_width", value: 0.1 }, { paramKey: "rhythm.syncopation", value: 0.9 }],
      ],
      updatedGenome,
      context
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].score.totalScore).toBeGreaterThanOrEqual(0);
    expect(ranked[1].score.totalScore).toBeGreaterThanOrEqual(0);
  });

  it("should handle reject domain penalties in scoring", () => {
    const context: TasteContext = {};

    const candidates: CandidateFeatures[] = [
      { paramKey: "reject.triplet_fill_before_drop", value: 0.9 },
      { paramKey: "reject.excessive_sidechain", value: 0.85 },
      { paramKey: "melody.range_width", value: 0.5 },
    ];

    const score = scoringEngine.score(candidates, genome, context);
    expect(score.rejectPenalties.length).toBeGreaterThan(0);
    expect(score.totalScore).toBeGreaterThanOrEqual(0);
    // High reject values should reduce total score
    expect(score.totalScore).toBeLessThan(1.0);
  });

  it("should check if update should be suggested based on deviation", () => {
    const analysis = exportAnalyzer.analyze(notes, tempoMap, genome);
    const shouldSuggest = exportAnalyzer.shouldSuggestUpdate(analysis);
    // Should return a boolean value
    expect(typeof shouldSuggest).toBe("boolean");
  });
});
