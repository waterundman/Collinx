import { describe, it, expect, beforeEach } from "vitest";
import { ABPlayer, ABVersion, ABTrial } from "../ab-player";
import { createNoteEvent } from "../../model/note-event";

function makeNotes(bar: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    createNoteEvent({
      trackId: "track-1",
      bar: bar + i * 2,
      beat: 1,
    })
  );
}

function makeVersion(overrides: Partial<ABVersion> = {}): ABVersion {
  return {
    id: "v-default",
    label: "A",
    notes: makeNotes(1, 4),
    description: "Default version",
    diffRef: "diff-1",
    exportRef: "export-1",
    ...overrides,
  };
}

describe("ABPlayer", () => {
  let player: ABPlayer;
  let versionA: ABVersion;
  let versionB: ABVersion;

  beforeEach(() => {
    player = new ABPlayer();
    versionA = makeVersion({ id: "v-a", label: "A", description: "Version A (original)" });
    versionB = makeVersion({ id: "v-b", label: "B", description: "Version B (with string pad)" });
  });

  describe("createTest", () => {
    it("should create test with given versions", () => {
      const result = player.createTest(versionA, versionB);
      expect(result.testId).toBeDefined();
      expect(result.trials).toHaveLength(5);
      expect(result.summary.versionAWins).toBe(0);
      expect(result.summary.versionBWins).toBe(0);
    });

    it("should respect custom numTrials", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 3 });
      expect(result.trials).toHaveLength(3);
    });

    it("should default to blind mode", () => {
      const result = player.createTest(versionA, versionB);
      expect(result.config.mode).toBe("blind");
    });

    it("should support labeled mode", () => {
      const result = player.createTest(versionA, versionB, { mode: "labeled" });
      expect(result.config.mode).toBe("labeled");
    });
  });

  describe("generateTrials", () => {
    it("should generate correct number of trials", () => {
      const trials = player.generateTrials(versionA, versionB, 7);
      expect(trials).toHaveLength(7);
    });

    it("should assign randomized playedOrder to each trial", () => {
      const trials = player.generateTrials(versionA, versionB, 100);
      let aFirst = 0;
      let bFirst = 0;
      for (const t of trials) {
        if (t.playedOrder[0] === "A") aFirst++;
        else bFirst++;
      }
      // With 100 trials, both should be well above 25
      expect(aFirst).toBeGreaterThan(25);
      expect(bFirst).toBeGreaterThan(25);
    });

    it("should have both versions referenced in each trial", () => {
      const trials = player.generateTrials(versionA, versionB, 1);
      const trial = trials[0];
      expect(trial.versionA.id).toBe("v-a");
      expect(trial.versionB.id).toBe("v-b");
      expect(["A", "B"]).toContain(trial.playedOrder[0]);
      expect(["A", "B"]).toContain(trial.playedOrder[1]);
      expect(trial.playedOrder[0]).not.toBe(trial.playedOrder[1]);
    });
  });

  describe("randomizeOrder", () => {
    it("should flip order 50/50 over many runs", () => {
      const trial: ABTrial = {
        trialId: "test",
        versionA,
        versionB,
        config: { mode: "blind", loopRange: { startBar: 1, endBar: 8 }, matchedLoudness: true, numTrials: 1 },
        playedOrder: ["A", "B"],
        startedAt: new Date().toISOString(),
      };

      let aFirst = 0;
      const runs = 500;
      for (let i = 0; i < runs; i++) {
        const randomized = player.randomizeOrder(trial);
        if (randomized.playedOrder[0] === "A") aFirst++;
      }
      // Approximately 50% ± tolerance
      const ratio = aFirst / runs;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });
  });

  describe("vote", () => {
    it("should record choice and mark completedAt", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 1 });
      const trialId = result.trials[0].trialId;

      player.vote(trialId, "A");

      const final = player.getResult();
      expect(final.trials[0].choice).toBeDefined();
      expect(final.trials[0].completedAt).toBeDefined();
    });

    it("should correctly tally versionA wins", () => {
      player.createTest(versionA, versionB, { numTrials: 3, mode: "labeled" });
      const result = player.getResult();

      player.vote(result.trials[0].trialId, "A");
      player.vote(result.trials[1].trialId, "A");
      player.vote(result.trials[2].trialId, "B");

      const final = player.getResult();
      expect(final.summary.versionAWins).toBe(2);
      expect(final.summary.versionBWins).toBe(1);
    });

    it("should handle no_preference votes", () => {
      player.createTest(versionA, versionB, { numTrials: 2, mode: "labeled" });
      const result = player.getResult();

      player.vote(result.trials[0].trialId, "no_preference");
      player.vote(result.trials[1].trialId, "A");

      const final = player.getResult();
      expect(final.summary.noPreference).toBe(1);
      expect(final.summary.versionAWins).toBe(1);
    });

    it("should ignore votes for non-existent trialId", () => {
      player.createTest(versionA, versionB, { numTrials: 1 });
      player.vote("nonexistent", "A");
      const result = player.getResult();
      expect(result.summary.versionAWins).toBe(0);
    });
  });

  describe("getCurrentVersion", () => {
    it("should return correct version based on playedOrder and progress", () => {
      const trial: ABTrial = {
        trialId: "t1",
        versionA,
        versionB,
        config: { mode: "blind", loopRange: { startBar: 1, endBar: 8 }, matchedLoudness: true, numTrials: 1 },
        playedOrder: ["B", "A"],
        startedAt: new Date().toISOString(),
      };

      const first = player.getCurrentVersion(trial, "first");
      const second = player.getCurrentVersion(trial, "second");

      expect(first.id).toBe("v-b");
      expect(second.id).toBe("v-a");
    });

    it("should return versionA for first when playedOrder is A then B", () => {
      const trial: ABTrial = {
        trialId: "t2",
        versionA,
        versionB,
        config: { mode: "blind", loopRange: { startBar: 1, endBar: 8 }, matchedLoudness: true, numTrials: 1 },
        playedOrder: ["A", "B"],
        startedAt: new Date().toISOString(),
      };

      const first = player.getCurrentVersion(trial, "first");
      expect(first.id).toBe("v-a");
    });
  });

  describe("isTestComplete", () => {
    it("should return false when trials incomplete", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 3 });
      player.vote(result.trials[0].trialId, "A");
      expect(player.isTestComplete(result.testId)).toBe(false);
    });

    it("should return true when all trials voted", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 3 });
      for (const trial of result.trials) {
        player.vote(trial.trialId, "A");
      }
      expect(player.isTestComplete(result.testId)).toBe(true);
    });
  });

  describe("toTasteEvidence", () => {
    it("should generate evidence for each vote", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 2 });
      player.vote(result.trials[0].trialId, "A");
      player.vote(result.trials[1].trialId, "B");

      const evidences = player.toTasteEvidence(player.getResult(), "timbre.brightness");

      // 2 trials × 2 evidence each (positive + negative) = 4
      expect(evidences).toHaveLength(4);
      expect(evidences[0].type).toBe("ab_listen_choice");
      expect(evidences[1].type).toBe("ab_listen_choice");
    });

    it("should set correct paramKey", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 1 });
      player.vote(result.trials[0].trialId, "A");

      const evidences = player.toTasteEvidence(player.getResult(), "mix.reverb_amount");
      expect(evidences).toHaveLength(2);
      expect(evidences[0].paramKey).toBe("mix.reverb_amount");
      expect(evidences[1].paramKey).toBe("mix.reverb_amount");
    });

    it("should assign positiveMass to winner and negativeMass to loser", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 1 });
      player.vote(result.trials[0].trialId, "A");

      const evidences = player.toTasteEvidence(player.getResult(), "texture.density");

      // One evidence is positive for chosen version, one is negative for unchosen
      const positive = evidences.find((e) => e.positiveMass != null);
      const negative = evidences.find((e) => e.negativeMass != null);

      expect(positive).toBeDefined();
      expect(negative).toBeDefined();
      expect(positive!.positiveMass).toBe("0.65");
      expect(negative!.negativeMass).toBe("0.65");
      expect(positive!.confirmed).toBe(true);
      expect(negative!.confirmed).toBe(true);
    });

    it("should generate single low-weight evidence for no_preference", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 1 });
      player.vote(result.trials[0].trialId, "no_preference");

      const evidences = player.toTasteEvidence(player.getResult(), "rhythm.syncopation");

      expect(evidences).toHaveLength(1);
      expect(evidences[0].confirmed).toBe(false);
      expect(evidences[0].sourceQuality).toBe(0.65);
    });

    it("should use correct sourceQuality weight", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 1 });
      player.vote(result.trials[0].trialId, "A");

      const evidences = player.toTasteEvidence(player.getResult(), "harmony.complexity");
      expect(evidences[0].sourceQuality).toBe(0.65);
    });
  });

  describe("computeConfidence", () => {
    it("should return 0 for 0 trials", () => {
      expect(player.computeConfidence(0, 0)).toBe(0);
    });

    it("should return high confidence for clear winner", () => {
      const confidence = player.computeConfidence(8, 8);
      expect(confidence).toBeGreaterThan(0.9);
    });

    it("should return low confidence for 50/50 split", () => {
      const confidence = player.computeConfidence(1, 2);
      expect(confidence).toBeLessThan(0.7);
    });

    it("should increase confidence with more trials at same ratio", () => {
      const confidenceFew = player.computeConfidence(6, 10);
      const confidenceMore = player.computeConfidence(30, 50);
      expect(confidenceMore).toBeGreaterThan(confidenceFew);
    });

    it("should be bounded between 0 and 1", () => {
      const c1 = player.computeConfidence(10, 10);
      const c2 = player.computeConfidence(0, 10);
      expect(c1).toBeGreaterThanOrEqual(0);
      expect(c1).toBeLessThanOrEqual(1);
      expect(c2).toBeGreaterThanOrEqual(0);
      expect(c2).toBeLessThanOrEqual(1);
    });
  });

  describe("inferLoopRange", () => {
    it("should return default for empty notes", () => {
      const range = player.inferLoopRange([]);
      expect(range.startBar).toBe(1);
      expect(range.endBar).toBe(8);
    });

    it("should find start and end from notes", () => {
      const notes = [
        createNoteEvent({ trackId: "t1", bar: 3, beat: 1 }),
        createNoteEvent({ trackId: "t1", bar: 7, beat: 1, durQn: 1 }),
      ];
      const range = player.inferLoopRange(notes);
      expect(range.startBar).toBe(3);
      // bar 7 + ceil((1-1+1)/4) - 1 = 7 + 1 - 1 = 7
      expect(range.endBar).toBe(7);
    });

    it("should handle single note", () => {
      const notes = [createNoteEvent({ trackId: "t1", bar: 5, beat: 1, durQn: 1 })];
      const range = player.inferLoopRange(notes);
      expect(range.startBar).toBe(5);
      // range is expanded to at least 4 bars: bar 5 to bar 8
      expect(range.endBar).toBe(8);
    });

    it("should ensure at least 4 bars total", () => {
      const notes = [
        createNoteEvent({ trackId: "t1", bar: 3, beat: 1 }),
        createNoteEvent({ trackId: "t1", bar: 3, beat: 1 }),
      ];
      const range = player.inferLoopRange(notes);
      // Two notes at bar 3, beat 1 with durQn=1: endBar = 3 + ceil((0+1)/4) - 1 = 3
      // Range is 1 bar, so expanded to 4 bars total: bar 3 to bar 6
      expect(range.startBar).toBe(3);
      expect(range.endBar).toBe(6);
    });
  });

  describe("setVersions", () => {
    it("should store versions for later use", () => {
      player.setVersions(versionA, versionB);
      // createTest uses stored versions implicitly via generateTrials call
      const result = player.createTest(versionA, versionB, { numTrials: 2 });
      expect(result.trials[0].versionA.id).toBe("v-a");
      expect(result.trials[0].versionB.id).toBe("v-b");
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      const result = player.createTest(versionA, versionB, { numTrials: 3 });
      player.vote(result.trials[0].trialId, "A");
      player.reset();

      const after = player.getResult();
      expect(after.trials).toHaveLength(0);
    });
  });
});
