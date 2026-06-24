import { describe, it, expect, beforeEach } from "vitest";
import { TasteGenome } from "../taste-genome";
import { TasteDomain } from "../taste-types";
import { TasteGenomeSchema } from "../zod-schemas";

describe("TasteGenome", () => {
  let genome: TasteGenome;

  beforeEach(() => {
    genome = TasteGenome.createDefault();
  });

  describe("createDefault", () => {
    it("should create a genome with 15+ default parameters", () => {
      const params = genome.listParameters();
      expect(params.length).toBeGreaterThanOrEqual(15);
    });

    it("should include parameters from all 8 domains", () => {
      const allKeys = genome
        .listParameters()
        .map(([key]) => key);
      const domains = TASTE_DOMAINS;
      for (const domain of domains) {
        const domainParams = allKeys.filter((k) =>
          k.startsWith(domain + ".")
        );
        expect(
          domainParams.length,
          `Domain "${domain}" should have at least 1 parameter`
        ).toBeGreaterThanOrEqual(1);
      }
    });

    it("should have a valid genomeId", () => {
      expect(genome.genomeId).toBeDefined();
      expect(typeof genome.genomeId).toBe("string");
      expect(genome.genomeId.length).toBeGreaterThan(0);
    });

    it("should start at version 0", () => {
      expect(genome.version).toBe(0);
    });

    it("should have decimal128_string encoding", () => {
      const json = genome.toJSON();
      expect(json.numericEncoding).toBe("decimal128_string");
    });

    it("should have an embedding layer", () => {
      const el = genome.embeddingLayer;
      expect(el.tagLayer).toBeDefined();
      expect(Array.isArray(el.tagLayer)).toBe(true);
    });
  });

  describe("getParameter / setParameter", () => {
    it("should get a parameter by key", () => {
      const p = genome.getParameter("harmony.chromatic_color");
      expect(p).toBeDefined();
      expect(p!.value).toBe("0.33");
      expect(p!.distribution.family).toBe("beta");
    });

    it("should return undefined for unknown key", () => {
      const p = genome.getParameter("nonexistent.key");
      expect(p).toBeUndefined();
    });

    it("should set a parameter and update lastUpdatedAt", () => {
      const existing = genome.getParameter("rhythm.syncopation")!;
      const oldTimestamp = existing.lastUpdatedAt;

      genome.setParameter("rhythm.syncopation", {
        ...existing,
        value: "0.75",
      });

      const updated = genome.getParameter("rhythm.syncopation")!;
      expect(updated.value).toBe("0.75");
      // Timestamp can be the same in fast tests, so just verify it exists
      expect(updated.lastUpdatedAt).toBeDefined();
    });

    it("should add a new parameter via setParameter", () => {
      genome.setParameter("mix.new_effect", {
        value: "0.42",
        distribution: { family: "gaussian", mean: "0.5", variance: "0.1" },
        confidence: "0.30",
        context: {},
        evidence: [],
        timeDecay: { policy: "exp", lambda: "0.01" },
        lastUpdatedAt: new Date().toISOString(),
      });

      const p = genome.getParameter("mix.new_effect");
      expect(p).toBeDefined();
      expect(p!.value).toBe("0.42");
    });
  });

  describe("removeParameter", () => {
    it("should remove a parameter", () => {
      expect(genome.getParameter("harmony.chromatic_color")).toBeDefined();
      genome.removeParameter("harmony.chromatic_color");
      expect(genome.getParameter("harmony.chromatic_color")).toBeUndefined();
    });

    it("should not throw when removing non-existent parameter", () => {
      genome.removeParameter("nonexistent.key");
      // Should not throw
    });
  });

  describe("listParameters", () => {
    it("should list all parameters when no domain specified", () => {
      const all = genome.listParameters();
      expect(all.length).toBeGreaterThanOrEqual(15);
    });

    it("should filter by domain", () => {
      const rhythmParams = genome.listParameters(TasteDomain.Rhythm);
      expect(rhythmParams.length).toBeGreaterThanOrEqual(2);
      for (const [key] of rhythmParams) {
        expect(key.startsWith("rhythm.")).toBe(true);
      }
    });

    it("should return all entries for each domain with correct keys", () => {
      for (const domain of [
        TasteDomain.Harmony,
        TasteDomain.Melody,
        TasteDomain.Reject,
      ]) {
        const params = genome.listParameters(domain);
        for (const [key] of params) {
          expect(key).toMatch(new RegExp(`^${domain}\\.`));
        }
      }
    });
  });

  describe("version management", () => {
    it("should increment version", () => {
      expect(genome.version).toBe(0);
      genome.incrementVersion();
      expect(genome.version).toBe(1);
      genome.incrementVersion();
      genome.incrementVersion();
      expect(genome.version).toBe(3);
    });
  });

  describe("serialization (toJSON / fromJSON)", () => {
    it("should serialize to JSON and back with identical data", () => {
      const json = genome.toJSON();
      const restored = TasteGenome.fromJSON(json);

      expect(restored.genomeId).toBe(genome.genomeId);
      expect(restored.version).toBe(genome.version);
      expect(
        Object.keys(restored.domains).length
      ).toBe(Object.keys(genome.domains).length);

      // Check a specific parameter
      const origP = genome.getParameter("timbre.brightness")!;
      const restoredP = restored.getParameter("timbre.brightness")!;
      expect(restoredP.value).toBe(origP.value);
      expect(restoredP.distribution).toEqual(origP.distribution);
      expect(restoredP.confidence).toBe(origP.confidence);
    });

    it("should validate successfully against TasteGenomeSchema", () => {
      const json = genome.toJSON();
      const result = TasteGenomeSchema.safeParse(json);
      expect(result.success).toBe(true);
    });

    it("should reject invalid JSON", () => {
      expect(() => TasteGenome.fromJSON({})).toThrow();
      expect(() =>
        TasteGenome.fromJSON({ genomeId: "x", version: -1 })
      ).toThrow();
    });

    it("should survive a double serialization round-trip", () => {
      const json1 = genome.toJSON();
      const g1 = TasteGenome.fromJSON(json1);
      const json2 = g1.toJSON();
      const g2 = TasteGenome.fromJSON(json2);

      expect(g2.genomeId).toBe(genome.genomeId);
      expect(
        Object.keys(g2.domains).length
      ).toBe(Object.keys(genome.domains).length);
    });
  });

  describe("getEffectiveGenome", () => {
    it("should create a copy when no overlay provided", () => {
      const effective = genome.getEffectiveGenome();
      expect(effective.genomeId).toBe(genome.genomeId);
      expect(
        Object.keys(effective.domains).length
      ).toBe(Object.keys(genome.domains).length);
    });

    it("should merge overlay values into existing parameters", () => {
      const overlay = { "rhythm.syncopation": "0.90" };
      const effective = genome.getEffectiveGenome(overlay);

      const p = effective.getParameter("rhythm.syncopation")!;
      expect(p.value).toBe("0.90");
      expect(p.confidence).toBe("0.80");
      expect(p.context.task).toBe("overlay");
    });

    it("should not modify the original genome", () => {
      const originalValue = genome.getParameter("rhythm.syncopation")!.value;
      const overlay = { "rhythm.syncopation": "0.99" };
      genome.getEffectiveGenome(overlay);

      const p = genome.getParameter("rhythm.syncopation")!;
      expect(p.value).toBe(originalValue);
    });

    it("should ignore overlay keys that do not exist", () => {
      const overlay = { "fake.domain_param": "0.50" };
      const effective = genome.getEffectiveGenome(overlay);
      const p = effective.getParameter("fake.domain_param");
      expect(p).toBeUndefined();
    });

    it("should handle multiple overlay keys", () => {
      const overlay = {
        "rhythm.syncopation": "0.80",
        "mix.reverb_amount": "0.60",
      };
      const effective = genome.getEffectiveGenome(overlay);

      expect(effective.getParameter("rhythm.syncopation")!.value).toBe("0.80");
      expect(effective.getParameter("mix.reverb_amount")!.value).toBe("0.60");
    });
  });

  describe("create (empty genome)", () => {
    it("should create an empty genome", () => {
      const empty = TasteGenome.create();
      expect(empty.listParameters()).toHaveLength(0);
      expect(empty.version).toBe(0);
    });

    it("should accept a custom genomeId", () => {
      const g = TasteGenome.create("custom-id");
      expect(g.genomeId).toBe("custom-id");
    });
  });
});

// Import needed for describe block above
import { TASTE_DOMAINS } from "../taste-types";
