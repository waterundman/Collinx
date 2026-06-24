import { describe, it, expect, beforeEach } from "vitest";
import { ScoringEngine } from "../scoring-engine";
import { TasteGenome } from "../taste-genome";
import { TasteDomain, type TasteContext } from "../taste-types";

// ─── Helpers ──────────────────────────────────────────────────

function makeGenome(): TasteGenome {
  return TasteGenome.createDefault();
}

// ─── ScoringEngine ────────────────────────────────────────────

describe("ScoringEngine.fit", () => {
  let engine: ScoringEngine;

  beforeEach(() => {
    engine = new ScoringEngine();
  });

  it("should return 1.0 for exact match (x = μ)", () => {
    const result = engine.fit(0.5, 0.5, 0.2);
    expect(result).toBeCloseTo(1.0, 10);
  });

  it("should return ~0.135 at 2 sigma deviation", () => {
    // fit(μ ± 2σ) = exp(-4σ² / 2σ²) = exp(-2) ≈ 0.1353
    const result = engine.fit(0.9, 0.5, 0.2);
    expect(result).toBeCloseTo(Math.exp(-2), 3);
  });

  it("should return lower fit for larger deviation", () => {
    const near = engine.fit(0.6, 0.5, 0.2);
    const far = engine.fit(0.9, 0.5, 0.2);
    expect(near).toBeGreaterThan(far);
  });

  it("should handle zero std gracefully", () => {
    const result = engine.fit(0.5, 0.5, 0);
    expect(result).toBeCloseTo(1.0, 10);
  });

  it("should return small value for large deviation with narrow std", () => {
    const result = engine.fit(1.0, 0.0, 0.05);
    expect(result).toBeLessThan(0.01);
  });
});

describe("ScoringEngine.getDistributionMoments", () => {
  let engine: ScoringEngine;

  beforeEach(() => {
    engine = new ScoringEngine();
  });

  describe("Beta distribution", () => {
    it("should compute correct mean and std for Beta(5,10)", () => {
      // Beta(α=5, β=10): mean = 5/(5+10) = 1/3, variance = 5*10/(15*15*16) = 50/(3600) ≈ 0.01389
      const genome = makeGenome();
      const param = genome.getParameter("harmony.chromatic_color")!;
      // Alpha=5, Beta=10 from createDefault
      expect(param.distribution.family).toBe("beta");

      const { mean, std } = engine.getDistributionMoments(param);

      const expectedMean = 5 / 15; // 0.3333...
      expect(mean).toBeCloseTo(expectedMean, 3);

      // std = sqrt(alpha*beta/((alpha+beta)^2*(alpha+beta+1)))
      const expectedVariance = (5 * 10) / (15 * 15 * 16);
      const expectedStd = Math.sqrt(expectedVariance);
      expect(std).toBeCloseTo(expectedStd, 3);
    });

    it("should return fallback for zero alpha+beta", () => {
      const genome = makeGenome();
      const param = { ...genome.getParameter("harmony.chord_density")! };
      param.distribution = { family: "beta", alpha: "0", beta: "0" };

      const { mean } = engine.getDistributionMoments(param);
      expect(mean).toBe(0.5);
    });
  });

  describe("Bernoulli distribution", () => {
    it("should compute correct mean and std for Bernoulli(0.3)", () => {
      const genome = makeGenome();
      const param = genome.getParameter("reject.excessive_sidechain")!;
      expect(param.distribution.family).toBe("bernoulli");

      const { mean, std } = engine.getDistributionMoments(param);
      expect(mean).toBeCloseTo(0.3, 5);

      // std = sqrt(p(1-p)) = sqrt(0.3*0.7) = sqrt(0.21) ≈ 0.458
      expect(std).toBeCloseTo(Math.sqrt(0.21), 3);
    });
  });

  describe("Gaussian distribution", () => {
    it("should compute correct mean and std for Gaussian", () => {
      const genome = makeGenome();
      const param = { ...genome.getParameter("harmony.chord_density")! };
      param.distribution = { family: "gaussian", mean: "0.6", variance: "0.04" };

      const { mean, std } = engine.getDistributionMoments(param);
      expect(mean).toBeCloseTo(0.6, 5);
      expect(std).toBeCloseTo(0.2, 5);
    });
  });
});

describe("ScoringEngine.score", () => {
  let engine: ScoringEngine;
  let genome: TasteGenome;

  beforeEach(() => {
    engine = new ScoringEngine();
    genome = makeGenome();
  });

  it("should compute a total score for matched candidates", () => {
    const candidates = [
      { paramKey: "harmony.chord_density", value: 0.4 }, // close to default 0.4
      { paramKey: "rhythm.syncopation", value: 0.5 }, // close to default 0.5
    ];

    const context: TasteContext = {};

    const result = engine.score(candidates, genome, context);

    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.totalScore).toBeLessThanOrEqual(1.0);
    expect(result.domainScores).toBeDefined();
  });

  it("should produce lower score for values far from preferences (without novelty)", () => {
    const context: TasteContext = {};

    const goodCandidates = [
      { paramKey: "harmony.chord_density", value: 0.4 }, // near default mean
    ];

    const badCandidates = [
      { paramKey: "harmony.chord_density", value: 0.95 }, // far from default
    ];

    // Disable novelty bonus to isolate fit comparison
    const goodResult = engine.score(goodCandidates, genome, context, { lambdaNovelty: 0, lambdaContextMatch: 0 });
    const badResult = engine.score(badCandidates, genome, context, { lambdaNovelty: 0, lambdaContextMatch: 0 });

    expect(goodResult.totalScore).toBeGreaterThan(badResult.totalScore);
  });

  it("should apply reject penalties for reject domain candidates", () => {
    const candidates = [
      { paramKey: "reject.triplet_fill_before_drop", value: 0.8 }, // high reject value
    ];

    const context: TasteContext = {};

    const result = engine.score(candidates, genome, context);
    expect(result.rejectPenalties.length).toBeGreaterThan(0);
    expect(result.rejectPenalties[0].penalty).toBeGreaterThan(0);
  });

  it("should add context match bonus when contexts overlap", () => {
    const candidates = [
      { paramKey: "harmony.chord_density", value: 0.5 },
    ];

    // Create context with genre overlap
    const context: TasteContext = { genre: ["pop"], task: "composition" };

    // Set param context to match
    const param = genome.getParameter("harmony.chord_density")!;
    param.context = { genre: ["pop"], task: "composition" };
    genome.setParameter("harmony.chord_density", param);

    const result = engine.score(candidates, genome, context);
    expect(result.contextMatchBonus).toBeGreaterThan(0);
  });

  it("should add novelty bonus for values far from preferences", () => {
    const context: TasteContext = {};

    const closeCandidate = [
      { paramKey: "harmony.chord_density", value: 0.4 }, // near mean
    ];

    const farCandidate = [
      { paramKey: "harmony.chord_density", value: 0.95 }, // far from mean
    ];

    const closeResult = engine.score(closeCandidate, genome, context);
    const farResult = engine.score(farCandidate, genome, context);

    expect(farResult.noveltyBonus).toBeGreaterThan(closeResult.noveltyBonus);
  });

  it("should handle custom score options", () => {
    const candidates = [{ paramKey: "harmony.chord_density", value: 0.5 }];
    const context: TasteContext = {};

    const defaultResult = engine.score(candidates, genome, context);
    const customResult = engine.score(candidates, genome, context, {
      lambdaContextMatch: 0.5,
      lambdaNovelty: 0.5,
    });

    // Custom options should produce different total (higher due to higher lambdas)
    expect(customResult.totalScore).not.toBe(defaultResult.totalScore);
  });
});

describe("ScoringEngine.rank", () => {
  let engine: ScoringEngine;
  let genome: TasteGenome;

  beforeEach(() => {
    engine = new ScoringEngine();
    genome = makeGenome();
  });

  it("should sort candidates by total score descending", () => {
    const context: TasteContext = {};

    const good = [{ paramKey: "harmony.chord_density", value: 0.4 }];
    const mediocre = [{ paramKey: "harmony.chord_density", value: 0.7 }];
    const bad = [{ paramKey: "harmony.chord_density", value: 0.95 }];

    const ranked = engine.rank([bad, good, mediocre], genome, context);

    expect(ranked).toHaveLength(3);
    expect(ranked[0].score.totalScore).toBeGreaterThanOrEqual(ranked[1].score.totalScore);
    expect(ranked[1].score.totalScore).toBeGreaterThanOrEqual(ranked[2].score.totalScore);
  });

  it("should handle empty candidates list", () => {
    const context: TasteContext = {};
    const ranked = engine.rank([], genome, context);
    expect(ranked).toHaveLength(0);
  });
});

describe("ScoringEngine - edge cases", () => {
  let engine: ScoringEngine;
  let genome: TasteGenome;

  beforeEach(() => {
    engine = new ScoringEngine();
    genome = makeGenome();
  });

  it("should handle candidate with non-existent paramKey", () => {
    const candidates = [
      { paramKey: "nonexistent.param", value: 0.5 },
    ];

    const context: TasteContext = {};
    const result = engine.score(candidates, genome, context);

    expect(result.totalScore).toBe(0);
  });

  it("should produce consistent results for same inputs", () => {
    const candidates = [
      { paramKey: "harmony.chord_density", value: 0.5 },
      { paramKey: "rhythm.syncopation", value: 0.5 },
    ];

    const context: TasteContext = {};

    const r1 = engine.score(candidates, genome, context);
    const r2 = engine.score(candidates, genome, context);

    expect(r1.totalScore).toBeCloseTo(r2.totalScore, 10);
  });
});
