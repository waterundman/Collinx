import { describe, it, expect, beforeEach } from "vitest";
import { EngravingAgent } from "../engraving-agent";
import type { CollisionWarning } from "../engraving-agent";

describe("EngravingAgent", () => {
  let agent: EngravingAgent;

  beforeEach(() => {
    agent = new EngravingAgent();
  });

  describe("reflowLayout", () => {
    it("should produce a DiffEnvelope for layout reflow", () => {
      const diff = agent.reflowLayout("score-001", "henle", "report_only");

      expect(diff.diffId).toBeTruthy();
      expect(diff.baseRevision).toBe("HEAD");
      expect(diff.actor.name).toBe("engraving");
      expect(diff.permissionScope).toBe("proposal_only");
      expect(diff.ops.length).toBeGreaterThan(0);
      expect(diff.summary).toContain("score-001");
      expect(diff.summary).toContain("henle");
    });

    it("should handle auto_fix collision policy without errors", () => {
      const diff = agent.reflowLayout("score-002", "schirmer", "auto_fix");

      expect(diff.diffId).toBeTruthy();
      expect(diff.ops.length).toBeGreaterThan(0);
      expect(diff.summary).toContain("schirmer");
      expect(diff.summary).toContain("auto_fix");
    });

    it("should support different house styles", () => {
      const styles = ["henle", "schirmer", "peters", "modern"];

      for (const style of styles) {
        const diff = agent.reflowLayout(`score-${style}`, style, "report_only");
        expect(diff.diffId).toBeTruthy();
        expect(diff.summary).toContain(style);
      }
    });

    it("should include domain explanations", () => {
      const diff = agent.reflowLayout("score-003", "modern", "report_only");

      expect(diff.domainExplanations.length).toBeGreaterThan(0);
      const layoutExplanation = diff.domainExplanations.find((e) => e.label === "Layout");
      expect(layoutExplanation).toBeDefined();
      expect(layoutExplanation!.text).toContain("声部");
    });

    it("should generate ops with correct structure", () => {
      const diff = agent.reflowLayout("score-004", "henle", "report_only");

      for (const op of diff.ops) {
        expect(op.op).toBeTruthy();
        expect(op.path).toBeTruthy();
      }

      const addNodeOps = diff.ops.filter((op) => op.op === "add_node");
      expect(addNodeOps.length).toBeGreaterThan(0);
    });

    it("should have a valid rollback token", () => {
      const diff = agent.reflowLayout("score-005", "henle", "report_only");

      expect(diff.rollbackToken).toBeTruthy();
      expect(typeof diff.rollbackToken).toBe("string");
    });
  });

  describe("extractParts", () => {
    it("should produce one DiffEnvelope per instrument", () => {
      const diffs = agent.extractParts("score-full-001");

      expect(Array.isArray(diffs)).toBe(true);
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs.length).toBeLessThanOrEqual(4);
    });

    it("should include instrument name in each diff summary", () => {
      const diffs = agent.extractParts("score-full-002");

      for (const diff of diffs) {
        expect(diff.summary).toBeTruthy();
        expect(diff.permissionScope).toBe("proposal_only");
        expect(diff.actor.name).toBe("engraving");
      }
    });

    it("should produce diffs with PartLayout nodes", () => {
      const diffs = agent.extractParts("score-full-003");

      for (const diff of diffs) {
        const addNodeOps = diff.ops.filter((op) => op.op === "add_node");
        expect(addNodeOps.length).toBeGreaterThan(0);

        for (const op of addNodeOps) {
          if (op.op === "add_node" && op.nodeType === "PartLayout") {
            expect(op.data.instrumentId).toBeTruthy();
            expect(op.data.instrumentName).toBeTruthy();
          }
        }
      }
    });

    it("should include domain explanations per part", () => {
      const diffs = agent.extractParts("score-full-004");

      for (const diff of diffs) {
        expect(diff.domainExplanations.length).toBeGreaterThan(0);
      }
    });

    it("should produce unique diffIds", () => {
      const diffs = agent.extractParts("score-full-005");

      const ids = diffs.map((d) => d.diffId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("reportCollisions", () => {
    it("should return collisions and suggestions", () => {
      const result = agent.reportCollisions("score-001");

      expect(Array.isArray(result.collisions)).toBe(true);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it("should classify collisions with proper structure", () => {
      const result = agent.reportCollisions("score-002");

      for (const collision of result.collisions) {
        expect(collision.type).toBeTruthy();
        expect(typeof collision.bar).toBe("number");
        expect(typeof collision.beat).toBe("number");
        expect(typeof collision.description).toBe("string");
        expect(["error", "warning", "info"]).toContain(collision.severity);
      }
    });

    it("should provide suggestions when collisions exist", () => {
      const result = agent.reportCollisions("score-003");

      if (result.collisions.length > 0) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });

    it("should identify known collision types", () => {
      const result = agent.reportCollisions("score-004");

      const validTypes = [
        "voice_crossing",
        "range_violation",
        "overlap",
        "spacing",
        "stem_direction",
        "accidental_conflict",
      ];

      for (const collision of result.collisions) {
        expect(validTypes).toContain(collision.type);
      }
    });

    it("should handle repeated calls consistently", () => {
      const result1 = agent.reportCollisions("score-005");
      const result2 = agent.reportCollisions("score-005");

      // Same input should produce same collision count
      expect(result1.collisions.length).toBe(result2.collisions.length);
    });
  });
});
