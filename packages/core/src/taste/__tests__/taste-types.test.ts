import { describe, it, expect } from "vitest";
import {
  EVIDENCE_WEIGHTS,
  TASTE_DOMAINS,
  TasteDomain,
} from "../taste-types";
import {
  DistributionSchema,
  BetaDistributionSchema,
  DirichletDistributionSchema,
  VonMisesDistributionSchema,
  BernoulliDistributionSchema,
  GaussianDistributionSchema,
  TasteParameterSchema,
  TasteEvidenceSchema,
  TasteGenomeSchema,
} from "../zod-schemas";

describe("Evidence Weights", () => {
  it("should have correct weight for confirmed_export_diff", () => {
    expect(EVIDENCE_WEIGHTS.confirmed_export_diff).toBe(1.0);
  });

  it("should have correct weight for ab_listen_choice", () => {
    expect(EVIDENCE_WEIGHTS.ab_listen_choice).toBe(0.65);
  });

  it("should have correct weight for explicit_reject", () => {
    expect(EVIDENCE_WEIGHTS.explicit_reject).toBe(1.2);
  });

  it("should have correct weight for manual_keep", () => {
    expect(EVIDENCE_WEIGHTS.manual_keep).toBe(0.85);
  });

  it("should have correct weight for single_export", () => {
    expect(EVIDENCE_WEIGHTS.single_export).toBe(0.15);
  });

  it("should have correct weight for temporary_mode", () => {
    expect(EVIDENCE_WEIGHTS.temporary_mode).toBe(0.0);
  });

  it("should have exactly 6 evidence types", () => {
    expect(Object.keys(EVIDENCE_WEIGHTS)).toHaveLength(6);
  });

  it("should have explicit_reject higher than confirmed_export_diff", () => {
    expect(EVIDENCE_WEIGHTS.explicit_reject).toBeGreaterThan(
      EVIDENCE_WEIGHTS.confirmed_export_diff
    );
  });

  it("should have temporary_mode as the lowest weight", () => {
    const values = Object.values(EVIDENCE_WEIGHTS);
    const min = Math.min(...values);
    expect(EVIDENCE_WEIGHTS.temporary_mode).toBe(min);
  });
});

describe("Taste Domains", () => {
  it("should have exactly 8 domains", () => {
    expect(TASTE_DOMAINS).toHaveLength(8);
  });

  it("should include all domain values", () => {
    expect(TASTE_DOMAINS).toContain(TasteDomain.Harmony);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Melody);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Rhythm);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Texture);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Timbre);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Form);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Mix);
    expect(TASTE_DOMAINS).toContain(TasteDomain.Reject);
  });

  it("should have Reject as a first-class domain", () => {
    expect(TasteDomain.Reject).toBe("reject");
    expect(TASTE_DOMAINS).toContain("reject");
  });

  it("should have correct string values", () => {
    expect(TasteDomain.Harmony).toBe("harmony");
    expect(TasteDomain.Melody).toBe("melody");
    expect(TasteDomain.Rhythm).toBe("rhythm");
    expect(TasteDomain.Texture).toBe("texture");
    expect(TasteDomain.Timbre).toBe("timbre");
    expect(TasteDomain.Form).toBe("form");
    expect(TasteDomain.Mix).toBe("mix");
    expect(TasteDomain.Reject).toBe("reject");
  });
});

describe("Distribution Schemas (discriminative union)", () => {
  it("should validate a BetaDistribution with decimal128 string values", () => {
    const d = {
      family: "beta" as const,
      alpha: "5.000000000000000000",
      beta: "10.000000000000000000",
    };
    const result = BetaDistributionSchema.safeParse(d);
    expect(result.success).toBe(true);
  });

  it("should validate a DirichletDistribution", () => {
    const d = {
      family: "dirichlet" as const,
      alphas: {
        major: "5.0",
        minor: "8.0",
        dorian: "3.0",
      },
    };
    const result = DirichletDistributionSchema.safeParse(d);
    expect(result.success).toBe(true);
  });

  it("should validate a VonMisesDistribution", () => {
    const d = {
      family: "von_mises" as const,
      mu: "3.141592653589793238",
      kappa: "2.500000000000000000",
    };
    const result = VonMisesDistributionSchema.safeParse(d);
    expect(result.success).toBe(true);
  });

  it("should validate a BernoulliDistribution", () => {
    const d = {
      family: "bernoulli" as const,
      p: "0.100000000000000000",
    };
    const result = BernoulliDistributionSchema.safeParse(d);
    expect(result.success).toBe(true);
  });

  it("should validate a GaussianDistribution", () => {
    const d = {
      family: "gaussian" as const,
      mean: "0.500000000000000000",
      variance: "0.010000000000000000",
    };
    const result = GaussianDistributionSchema.safeParse(d);
    expect(result.success).toBe(true);
  });

  it("should validate all distribution types via discriminated union", () => {
    const dists = [
      { family: "beta", alpha: "5", beta: "10" },
      {
        family: "dirichlet",
        alphas: { a: "1", b: "2" },
      },
      { family: "von_mises", mu: "1.5", kappa: "3.0" },
      { family: "bernoulli", p: "0.5" },
      { family: "gaussian", mean: "0.5", variance: "0.1" },
    ];

    for (const d of dists) {
      const result = DistributionSchema.safeParse(d);
      expect(result.success, `Should validate ${d.family}`).toBe(true);
    }
  });

  it("should reject unknown distribution family", () => {
    const d = { family: "unknown_dist", x: "1" };
    const result = DistributionSchema.safeParse(d);
    expect(result.success).toBe(false);
  });

  it("should reject beta distribution without alpha", () => {
    const d = { family: "beta", beta: "10" };
    const result = BetaDistributionSchema.safeParse(d);
    expect(result.success).toBe(false);
  });

  it("should reject bernoulli with non-string p", () => {
    const d = { family: "bernoulli", p: 0.5 };
    const result = BernoulliDistributionSchema.safeParse(d);
    expect(result.success).toBe(false);
  });
});

describe("Decimal128 string format", () => {
  it("should store all numeric values as strings", () => {
    const param = {
      value: "0.736428194028730581",
      distribution: {
        family: "beta" as const,
        alpha: "5.000000000000000000",
        beta: "10.000000000000000000",
      },
      confidence: "0.91",
      context: {},
      evidence: [],
      timeDecay: { policy: "slow_exp" as const, lambda: "0.001" },
      lastUpdatedAt: new Date().toISOString(),
    };
    const result = TasteParameterSchema.safeParse(param);
    expect(result.success).toBe(true);

    const data = result.data!;
    expect(typeof data.value).toBe("string");
    expect(typeof data.confidence).toBe("string");
    if (data.distribution.family === "beta") {
      expect(typeof data.distribution.alpha).toBe("string");
      expect(typeof data.distribution.beta).toBe("string");
    }
  });

  it("should reject non-string confidence values", () => {
    const param = {
      value: "0.50",
      distribution: {
        family: "beta" as const,
        alpha: "5",
        beta: "10",
      },
      confidence: 0.91,
      context: {},
      evidence: [],
      timeDecay: { policy: "slow_exp" as const, lambda: "0.001" },
      lastUpdatedAt: new Date().toISOString(),
    };
    const result = TasteParameterSchema.safeParse(param);
    expect(result.success).toBe(false);
  });
});

describe("TasteEvidence schema", () => {
  it("should validate a complete evidence record", () => {
    const ev = {
      id: "ev-001",
      type: "ab_listen_choice" as const,
      paramKey: "rhythm.syncopation",
      pointEstimate: "0.65",
      context: { genre: ["electronic"], tempoBpmRange: [120, 140] },
      sourceQuality: 0.9,
      timestamp: new Date().toISOString(),
      ref: "ab://session-42",
      confirmed: true,
    };
    const result = TasteEvidenceSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });

  it("should reject sourceQuality outside 0-1", () => {
    const ev = {
      id: "ev-001",
      type: "ab_listen_choice" as const,
      paramKey: "rhythm.syncopation",
      context: {},
      sourceQuality: 1.5,
      timestamp: new Date().toISOString(),
      ref: "ab://session-42",
      confirmed: true,
    };
    const result = TasteEvidenceSchema.safeParse(ev);
    expect(result.success).toBe(false);
  });

  it("should validate evidence with Dirichlet categoryMass", () => {
    const ev = {
      id: "ev-002",
      type: "confirmed_export_diff" as const,
      paramKey: "harmony.modal_preference",
      categoryMass: { major: "1.0", minor: "2.5" },
      context: {},
      sourceQuality: 1.0,
      timestamp: new Date().toISOString(),
      ref: "export://track-1",
      confirmed: false,
    };
    const result = TasteEvidenceSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });
});

describe("TasteGenomeSchema", () => {
  it("should validate a minimal genome", () => {
    const genome = {
      genomeId: "test-genome-1",
      version: 0,
      numericEncoding: "decimal128_string" as const,
      updatedAt: new Date().toISOString(),
      domains: {},
      embeddingLayer: { tagLayer: [] },
    };
    const result = TasteGenomeSchema.safeParse(genome);
    expect(result.success).toBe(true);
  });

  it("should reject non-decimal128_string numericEncoding", () => {
    const genome = {
      genomeId: "test-1",
      version: 0,
      numericEncoding: "float64" as const,
      updatedAt: new Date().toISOString(),
      domains: {},
      embeddingLayer: { tagLayer: [] },
    };
    const result = TasteGenomeSchema.safeParse(genome);
    expect(result.success).toBe(false);
  });

  it("should reject negative version numbers", () => {
    const genome = {
      genomeId: "test-1",
      version: -1,
      numericEncoding: "decimal128_string" as const,
      updatedAt: new Date().toISOString(),
      domains: {},
      embeddingLayer: { tagLayer: [] },
    };
    const result = TasteGenomeSchema.safeParse(genome);
    expect(result.success).toBe(false);
  });
});
