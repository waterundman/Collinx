import { describe, it, expect, beforeEach } from "vitest";
import { ProjectTasteOverlay } from "../project-overlay";
import { TasteGenome } from "../taste-genome";

describe("ProjectTasteOverlay", () => {
  let overlay: ProjectTasteOverlay;
  let genome: TasteGenome;

  beforeEach(() => {
    overlay = new ProjectTasteOverlay("project-001");
    genome = TasteGenome.createDefault();
  });

  describe("set / get / has / remove", () => {
    it("should set and get a value", () => {
      overlay.set("rhythm.syncopation", "0.90");
      expect(overlay.get("rhythm.syncopation")).toBe("0.90");
    });

    it("should return undefined for unknown key", () => {
      expect(overlay.get("nonexistent.key")).toBeUndefined();
    });

    it("should check if key exists", () => {
      expect(overlay.has("rhythm.syncopation")).toBe(false);
      overlay.set("rhythm.syncopation", "0.90");
      expect(overlay.has("rhythm.syncopation")).toBe(true);
    });

    it("should remove a key", () => {
      overlay.set("rhythm.syncopation", "0.90");
      expect(overlay.has("rhythm.syncopation")).toBe(true);
      overlay.remove("rhythm.syncopation");
      expect(overlay.has("rhythm.syncopation")).toBe(false);
    });

    it("should not throw when removing non-existent key", () => {
      overlay.remove("nonexistent.key");
      // should not throw
    });

    it("should overwrite existing key", () => {
      overlay.set("rhythm.syncopation", "0.90");
      overlay.set("rhythm.syncopation", "0.25");
      expect(overlay.get("rhythm.syncopation")).toBe("0.25");
    });
  });

  describe("getAll", () => {
    it("should return all overrides as object", () => {
      overlay.set("rhythm.syncopation", "0.90");
      overlay.set("mix.reverb_amount", "0.60");

      const all = overlay.getAll();
      expect(all).toEqual({
        "rhythm.syncopation": "0.90",
        "mix.reverb_amount": "0.60",
      });
    });

    it("should return empty object when no overrides", () => {
      expect(overlay.getAll()).toEqual({});
    });
  });

  describe("applyTo", () => {
    it("should return a genome with overlay values merged", () => {
      overlay.set("rhythm.syncopation", "0.90");

      const effective = overlay.applyTo(genome);
      expect(effective.getParameter("rhythm.syncopation")!.value).toBe("0.90");
    });

    it("should not modify the original genome", () => {
      const originalValue = genome.getParameter("rhythm.syncopation")!.value;

      overlay.set("rhythm.syncopation", "0.90");
      overlay.applyTo(genome);

      expect(genome.getParameter("rhythm.syncopation")!.value).toBe(
        originalValue
      );
    });

    it("should return clone of original when no overrides", () => {
      const effective = overlay.applyTo(genome);
      expect(effective.genomeId).toBe(genome.genomeId);
      expect(Object.keys(effective.domains).length).toBe(
        Object.keys(genome.domains).length
      );
    });

    it("should apply multiple overrides", () => {
      overlay.set("rhythm.syncopation", "0.80");
      overlay.set("mix.reverb_amount", "0.60");

      const effective = overlay.applyTo(genome);
      expect(effective.getParameter("rhythm.syncopation")!.value).toBe("0.80");
      expect(effective.getParameter("mix.reverb_amount")!.value).toBe("0.60");
    });

    it("should ignore overlay keys not in genome", () => {
      overlay.set("fake.domain_param", "0.50");
      const effective = overlay.applyTo(genome);
      expect(effective.getParameter("fake.domain_param")).toBeUndefined();
    });
  });

  describe("mergeToGenome", () => {
    it("should merge overlay values into genome", () => {
      overlay.set("rhythm.syncopation", "0.90");
      overlay.set("mix.reverb_amount", "0.35");

      const merged = overlay.mergeToGenome(genome);
      expect(merged.getParameter("rhythm.syncopation")!.value).toBe("0.90");
      expect(merged.getParameter("mix.reverb_amount")!.value).toBe("0.35");
    });

    it("should not modify original genome", () => {
      const originalSync = genome.getParameter("rhythm.syncopation")!.value;

      overlay.set("rhythm.syncopation", "0.90");
      overlay.mergeToGenome(genome);

      expect(genome.getParameter("rhythm.syncopation")!.value).toBe(
        originalSync
      );
    });

    it("should skip overlay keys not in genome", () => {
      overlay.set("fake.key", "0.50");
      const merged = overlay.mergeToGenome(genome);
      expect(merged.getParameter("fake.key")).toBeUndefined();
    });

    it("should preserve genome version unchanged", () => {
      overlay.set("rhythm.syncopation", "0.90");
      const merged = overlay.mergeToGenome(genome);
      expect(merged.version).toBe(genome.version);
    });
  });

  describe("discard", () => {
    it("should clear all overrides", () => {
      overlay.set("rhythm.syncopation", "0.90");
      overlay.set("mix.reverb_amount", "0.60");

      overlay.discard();

      expect(overlay.getAll()).toEqual({});
      expect(overlay.has("rhythm.syncopation")).toBe(false);
    });
  });

  describe("serialization (toJSON / fromJSON)", () => {
    it("should round-trip preserve overrides", () => {
      overlay.set("rhythm.syncopation", "0.90");
      overlay.set("mix.reverb_amount", "0.60");

      const json = overlay.toJSON();
      const restored = ProjectTasteOverlay.fromJSON(json, "project-001");

      expect(restored.get("rhythm.syncopation")).toBe("0.90");
      expect(restored.get("mix.reverb_amount")).toBe("0.60");
    });

    it("should handle empty overlay serialization", () => {
      const json = overlay.toJSON();
      const restored = ProjectTasteOverlay.fromJSON(json, "project-empty");
      expect(restored.getAll()).toEqual({});
    });

    it("should preserve project ID structure", () => {
      const json = overlay.toJSON();
      const data = json as { projectId: string };
      expect(data.projectId).toBe("project-001");
    });
  });
});
