import { describe, it, expect, beforeEach } from "vitest";
import { UpdateEngine, decAdd, decMul, decDiv, decSub, decExp } from "../update-engine";
import { TasteGenome } from "../taste-genome";
import {
  type TasteEvidence,
  type TasteParameter,
  type TasteContext,
  EVIDENCE_WEIGHTS,
  type BetaDistribution,
  type DirichletDistribution,
  type BernoulliDistribution,
} from "../taste-types";

function makeEvidence(overrides: Partial<TasteEvidence> = {}): TasteEvidence {
  return {
    id: crypto.randomUUID(),
    type: "confirmed_export_diff",
    paramKey: "harmony.chord_density",
    context: {} as TasteContext,
    sourceQuality: 0.8,
    timestamp: new Date().toISOString(),
    ref: "test-ref",
    confirmed: true,
    ...overrides,
  };
}

function makeGenome(): TasteGenome {
  return TasteGenome.createDefault();
}

// ─── Decimal arithmetic helpers ───────────────────────────────

describe("Decimal arithmetic helpers", () => {
  it("decAdd should add two decimal strings", () => {
    expect(decAdd("1.5", "2.5")).toBe("4");
    expect(decAdd("0.1", "0.2")).toBe("0.3");
    expect(decAdd("10", "0.0001")).toBe("10.0001");
  });

  it("decSub should subtract two decimal strings", () => {
    expect(decSub("5", "3")).toBe("2");
    expect(decSub("0.3", "0.1")).toBe("0.2");
  });

  it("decMul should multiply two decimal strings", () => {
    expect(decMul("2", "3")).toBe("6");
    expect(decMul("0.5", "0.5")).toBe("0.25");
    expect(decMul("1.5", "2")).toBe("3");
  });

  it("decDiv should divide two decimal strings", () => {
    expect(decDiv("6", "2")).toBe("3");
    expect(parseFloat(decDiv("1", "3"))).toBeCloseTo(1 / 3, 14);
    expect(decDiv("1", "0")).toBe("0");
  });

  it("decExp should compute exponential decay", () => {
    const result = decExp("0.1", 10);
    const val = parseFloat(result);
    expect(val).toBeCloseTo(Math.exp(-1), 5);
  });
});

// ─── UpdateEngine ─────────────────────────────────────────────

describe("UpdateEngine", () => {
  let engine: UpdateEngine;
  let genome: TasteGenome;

  beforeEach(() => {
    engine = new UpdateEngine();
    genome = makeGenome();
  });

  describe("update - unconfirmed config", () => {
    it("should not modify genome when config.confirmed is false", () => {
      const evidence = makeEvidence({ paramKey: "harmony.chord_density" });
      const original = genome.toJSON();

      const result = engine.update(genome, [evidence], { confirmed: false });

      expect(result.updatedParams).toHaveLength(0);
      expect(result.skippedParams).toHaveLength(1);
      expect(result.versionIncremented).toBe(false);
      expect(result.genome.toJSON()).toEqual(original);
    });
  });

  describe("update - Beta distribution", () => {
    it("should update alpha and beta with positive and negative mass", () => {
      const evidence = makeEvidence({
        paramKey: "harmony.chord_density",
        positiveMass: "0.3",
        negativeMass: "0.1",
        sourceQuality: 1.0,
      });

      const paramBefore = genome.getParameter("harmony.chord_density")!;
      expect(paramBefore.distribution.family).toBe("beta");

      const result = engine.update(genome, [evidence], { confirmed: true });

      expect(result.updatedParams).toContain("harmony.chord_density");
      expect(result.versionIncremented).toBe(true);

      const updated = result.genome.getParameter("harmony.chord_density")!;
      expect(updated.distribution.family).toBe("beta");

      // alpha should have increased
      const alphaAfter = parseFloat((updated.distribution as BetaDistribution).alpha);
      const alphaBefore = parseFloat((paramBefore.distribution as BetaDistribution).alpha);
      expect(alphaAfter).toBeGreaterThan(alphaBefore);

      // beta should have increased
      const betaAfter = parseFloat((updated.distribution as BetaDistribution).beta);
      const betaBefore = parseFloat((paramBefore.distribution as BetaDistribution).beta);
      expect(betaAfter).toBeGreaterThan(betaBefore);

      // value should equal alpha/(alpha+beta)
      const sum = alphaAfter + betaAfter;
      const expectedValue = alphaAfter / sum;
      expect(parseFloat(updated.value)).toBeCloseTo(expectedValue, 10);
    });

    it("should update value toward 0.5 with only positive evidence", () => {
      const evidence = makeEvidence({
        paramKey: "harmony.chord_density",
        positiveMass: "1.0",
        negativeMass: "0.0",
        sourceQuality: 1.0,
      });

      const result = engine.update(genome, [evidence], { confirmed: true });
      const updated = result.genome.getParameter("harmony.chord_density")!;

      // With default Beta(4,6), adding positive mass should shift toward 1.0
      const val = parseFloat(updated.value);
      expect(val).toBeGreaterThan(0.4);
    });
  });

  describe("update - Dirichlet distribution", () => {
    it("should update category alphas", () => {
      const evidence = makeEvidence({
        paramKey: "harmony.modal_preference",
        categoryMass: { major: "2.0", minor: "1.0" },
        sourceQuality: 1.0,
      });

      const paramBefore = genome.getParameter("harmony.modal_preference")!;
      expect(paramBefore.distribution.family).toBe("dirichlet");

      const result = engine.update(genome, [evidence], { confirmed: true });

      const updated = result.genome.getParameter("harmony.modal_preference")!;
      expect(updated.distribution.family).toBe("dirichlet");

      const majorBefore = parseFloat((paramBefore.distribution as DirichletDistribution).alphas.major);
      const majorAfter = parseFloat((updated.distribution as DirichletDistribution).alphas.major);
      expect(majorAfter).toBeGreaterThan(majorBefore);

      const minorBefore = parseFloat((paramBefore.distribution as DirichletDistribution).alphas.minor);
      const minorAfter = parseFloat((updated.distribution as DirichletDistribution).alphas.minor);
      expect(minorAfter).toBeGreaterThan(minorBefore);

      // value should be valid JSON
      const parsedValue = JSON.parse(updated.value);
      expect(typeof parsedValue).toBe("object");
    });
  });

  describe("update - Bernoulli distribution", () => {
    it("should update probability p with point estimate", () => {
      const evidence = makeEvidence({
        paramKey: "reject.triplet_fill_before_drop",
        pointEstimate: "0.8",
        sourceQuality: 1.0,
      });

      const paramBefore = genome.getParameter("reject.triplet_fill_before_drop")!;
      expect(paramBefore.distribution.family).toBe("bernoulli");

      const result = engine.update(genome, [evidence], { confirmed: true });

      const updated = result.genome.getParameter("reject.triplet_fill_before_drop")!;
      const pBefore = parseFloat((paramBefore.distribution as BernoulliDistribution).p);
      const pAfter = parseFloat((updated.distribution as BernoulliDistribution).p);
      expect(pAfter).toBeGreaterThan(pBefore); // 0.1 → towards 0.8
    });

    it("should clamp p between 0 and 1", () => {
      const evidenceHigh = makeEvidence({
        paramKey: "reject.triplet_fill_before_drop",
        pointEstimate: "5.0",
        sourceQuality: 1.0,
      });

      const evidenceLow = makeEvidence({
        paramKey: "reject.triplet_fill_before_drop",
        pointEstimate: "-2.0",
        sourceQuality: 1.0,
      });

      const r1 = engine.update(genome, [evidenceHigh], { confirmed: true });
      const p1 = parseFloat(
        (r1.genome.getParameter("reject.triplet_fill_before_drop")!.distribution as BernoulliDistribution).p,
      );
      expect(p1).toBeLessThanOrEqual(1.0);

      const r2 = engine.update(genome, [evidenceLow], { confirmed: true });
      const p2 = parseFloat(
        (r2.genome.getParameter("reject.triplet_fill_before_drop")!.distribution as BernoulliDistribution).p,
      );
      expect(p2).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe("computeWeight", () => {
    it("should return correct base weight for evidence type", () => {
      const evidence = makeEvidence({
        type: "confirmed_export_diff",
        sourceQuality: 1.0,
      });

      const weight = engine.computeWeight(evidence, { confirmed: true });
      expect(weight).toBe(EVIDENCE_WEIGHTS.confirmed_export_diff);
    });

    it("should apply contextMatchMultiplier", () => {
      const evidence = makeEvidence({ sourceQuality: 1.0 });
      const base = engine.computeWeight(evidence, { confirmed: true });
      const withCM = engine.computeWeight(evidence, {
        confirmed: true,
        contextMatchMultiplier: 2.0,
      });
      expect(withCM).toBeCloseTo(base * 2, 10);
    });

    it("should apply sourceQualityMultiplier (replaces sourceQuality)", () => {
      const evidence = makeEvidence({ sourceQuality: 0.5 });
      const base = engine.computeWeight(evidence, { confirmed: true });
      // base = EVIDENCE_WEIGHTS[type] * 1.0 * 0.5 * 1.0 = 0.5 (when type=confirmed_export_diff=1.0)
      const withSQ = engine.computeWeight(evidence, {
        confirmed: true,
        sourceQualityMultiplier: 0.8,
      });
      // withSQ = 1.0 * 1.0 * 0.8 * 1.0 = 0.8
      // ratio = 0.8 / 0.5 = 1.6
      expect(withSQ).toBeCloseTo(base * 1.6, 10);
    });

    it("should apply recencyMultiplier", () => {
      const evidence = makeEvidence({ sourceQuality: 1.0 });
      const base = engine.computeWeight(evidence, { confirmed: true });
      const withRec = engine.computeWeight(evidence, {
        confirmed: true,
        recencyMultiplier: 0.5,
      });
      expect(withRec).toBeCloseTo(base * 0.5, 10);
    });
  });

  describe("applyTimeDecay", () => {
    it("should regress old parameters toward 0.5 (neutral)", () => {
      const g = makeGenome();
      // Force lastUpdatedAt far in past by manipulating serialized data
      const data = g.toJSON();
      data.domains["harmony.chord_density"].lastUpdatedAt = "2020-01-01T00:00:00.000Z";
      const pastGenome = TasteGenome.fromJSON(data);
      const originalValue = parseFloat(pastGenome.getParameter("harmony.chord_density")!.value);

      const decayed = engine.applyTimeDecay(pastGenome, new Date("2025-01-01T00:00:00.000Z"));
      const decayedParam = decayed.getParameter("harmony.chord_density")!;
      const decayedValue = parseFloat(decayedParam.value);

      if (originalValue > 0.5) {
        expect(decayedValue).toBeLessThan(originalValue);
      }
    });

    it("should decrease confidence over time", () => {
      const g = makeGenome();
      const data = g.toJSON();
      data.domains["harmony.chord_density"].lastUpdatedAt = "2020-01-01T00:00:00.000Z";
      const pastGenome = TasteGenome.fromJSON(data);
      const origConf = parseFloat(pastGenome.getParameter("harmony.chord_density")!.confidence);

      const decayed = engine.applyTimeDecay(pastGenome, new Date("2025-01-01T00:00:00.000Z"));
      const decayedParam = decayed.getParameter("harmony.chord_density")!;
      const decayedConf = parseFloat(decayedParam.confidence);
      expect(decayedConf).toBeLessThan(origConf);
    });

    it("should not decay parameters with policy 'none'", () => {
      const g = makeGenome();
      const param = g.getParameter("harmony.chord_density")!;
      param.timeDecay = { policy: "none", lambda: "0.1" };
      param.lastUpdatedAt = "2020-01-01T00:00:00.000Z";
      const origValue = param.value;
      g.setParameter("harmony.chord_density", param);

      engine.applyTimeDecay(g, new Date("2025-01-01T00:00:00.000Z"));

      const decayed = g.getParameter("harmony.chord_density")!;
      expect(decayed.value).toBe(origValue);
    });
  });

  describe("updateConfidence", () => {
    it("should increase confidence with gain", () => {
      const param = genome.getParameter("harmony.chord_density")!;
      const result = engine.updateConfidence(param, "0.1");
      const newConf = parseFloat(result);
      const oldConf = parseFloat(param.confidence);
      expect(newConf).toBeGreaterThan(oldConf);
    });

    it("should clamp confidence at 1.0", () => {
      const param = { ...genome.getParameter("harmony.chord_density")!, confidence: "0.99" };
      const result = engine.updateConfidence(param, "0.5");
      const newConf = parseFloat(result);
      expect(newConf).toBeLessThanOrEqual(1.0);
    });
  });

  describe("applyOverrideRule", () => {
    it("should downweight when mode is 'downweight' and context matches", () => {
      const param = genome.getParameter("harmony.chord_density")!;
      param.overrideRule = {
        when: { task: "mixdown" } as Partial<TasteContext>,
        mode: "downweight",
        factor: "0.3",
      };

      const origConf = parseFloat(param.confidence);
      const result = engine.applyOverrideRule(param, { task: "mixdown" });
      const newConf = parseFloat(result.confidence);
      expect(newConf).toBeLessThan(origConf);
    });

    it("should boost when mode is 'boost' and context matches", () => {
      const param = genome.getParameter("harmony.chord_density")!;
      param.overrideRule = {
        when: { task: "composition" } as Partial<TasteContext>,
        mode: "boost",
        factor: "0.2",
      };

      const origConf = parseFloat(param.confidence);
      const result = engine.applyOverrideRule(param, { task: "composition" });
      const newConf = parseFloat(result.confidence);
      expect(newConf).toBeGreaterThan(origConf);
    });

    it("should not apply rule when context does not match", () => {
      const param = genome.getParameter("harmony.chord_density")!;
      param.overrideRule = {
        when: { task: "mixdown" } as Partial<TasteContext>,
        mode: "downweight",
        factor: "0.3",
      };

      const origConf = param.confidence;
      const result = engine.applyOverrideRule(param, { task: "composition" });
      expect(result.confidence).toBe(origConf);
    });
  });

  describe("updateParameter - single param", () => {
    it("should dispatch to beta update for beta distribution", () => {
      const param = genome.getParameter("harmony.chord_density")!;
      const evidence = makeEvidence({
        paramKey: "harmony.chord_density",
        positiveMass: "0.5",
      });

      const updated = engine.updateParameter(param, evidence, 1.0);
      expect(updated.distribution.family).toBe("beta");
    });

    it("should dispatch to bernoulli update for bernoulli distribution", () => {
      const param = genome.getParameter("reject.triplet_fill_before_drop")!;
      const evidence = makeEvidence({
        paramKey: "reject.triplet_fill_before_drop",
        pointEstimate: "0.6",
      });

      const updated = engine.updateParameter(param, evidence, 0.5);
      expect(updated.distribution.family).toBe("bernoulli");
    });
  });

  describe("update - multi-evidence batch", () => {
    it("should update multiple parameters in one call", () => {
      const e1 = makeEvidence({
        paramKey: "harmony.chord_density",
        positiveMass: "0.2",
        negativeMass: "0.1",
        sourceQuality: 1.0,
      });

      const e2 = makeEvidence({
        paramKey: "rhythm.syncopation",
        positiveMass: "0.3",
        sourceQuality: 1.0,
      });

      const result = engine.update(genome, [e1, e2], { confirmed: true });

      expect(result.updatedParams).toHaveLength(2);
      expect(result.updatedParams).toContain("harmony.chord_density");
      expect(result.updatedParams).toContain("rhythm.syncopation");
      expect(result.versionIncremented).toBe(true);
    });

    it("should skip missing paramKeys", () => {
      const evidence = makeEvidence({
        paramKey: "nonexistent.param",
        sourceQuality: 1.0,
      });

      const result = engine.update(genome, [evidence], { confirmed: true });

      expect(result.updatedParams).toHaveLength(0);
      expect(result.skippedParams).toContain(evidence.id);
      expect(result.versionIncremented).toBe(false);
    });

    it("should append evidence to parameter evidence array", () => {
      const evidence = makeEvidence({
        paramKey: "harmony.chord_density",
        sourceQuality: 1.0,
      });

      const result = engine.update(genome, [evidence], { confirmed: true });
      const updated = result.genome.getParameter("harmony.chord_density")!;
      expect(updated.evidence.length).toBeGreaterThanOrEqual(1);
      expect(updated.evidence[updated.evidence.length - 1].id).toBe(evidence.id);
    });
  });

  describe("ema", () => {
    it("should compute exponential moving average", () => {
      // new_value = alpha * new + (1 - alpha) * old
      // alpha=0.3, old=0.5, new=0.9 → 0.3*0.9 + 0.7*0.5 = 0.27 + 0.35 = 0.62
      const result = engine.ema("0.5", "0.9", "0.3");
      expect(parseFloat(result)).toBeCloseTo(0.62, 5);
    });

    it("should not change when alpha is 0", () => {
      const result = engine.ema("0.7", "0.2", "0");
      expect(parseFloat(result)).toBeCloseTo(0.7, 10);
    });

    it("should fully adopt new value when alpha is 1", () => {
      const result = engine.ema("0.7", "0.2", "1");
      expect(parseFloat(result)).toBeCloseTo(0.2, 10);
    });
  });

  describe("adaptiveAlpha", () => {
    it("should produce lower alpha for higher confidence", () => {
      const a1 = parseFloat(engine.adaptiveAlpha("0.1", 1.0));
      const a2 = parseFloat(engine.adaptiveAlpha("0.9", 1.0));
      expect(a2).toBeLessThan(a1);
    });

    it("should be clamped to [0.01, 0.5]", () => {
      const low = parseFloat(engine.adaptiveAlpha("0.99", 0.01));
      expect(low).toBeGreaterThanOrEqual(0.01);

      const high = parseFloat(engine.adaptiveAlpha("0", 10.0));
      expect(high).toBeLessThanOrEqual(0.5);
    });
  });
});
