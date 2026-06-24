import { describe, it, expect } from "vitest";
import { EnergyCurvePlanner } from "../energy-planner";
import {
  EnergyCurve,
  FormRole,
  TasteGenome,
  type FormTemplate,
  createSection,
  createFormStructure,
  addSectionToForm,
} from "@collinx/core";

function near(a: number, b: number, epsilon = 0.001): void {
  expect(Math.abs(a - b)).toBeLessThan(epsilon);
}

describe("EnergyCurvePlanner", () => {
  const planner = new EnergyCurvePlanner();

  describe("ROLE_PROFILES", () => {
    it("should have profiles for all FormRole values", () => {
      const roles = Object.values(FormRole);
      for (const role of roles) {
        expect(EnergyCurvePlanner.ROLE_PROFILES[role]).toBeDefined();
      }
    });

    it("should have baseEnergy and range for each profile", () => {
      for (const profile of Object.values(EnergyCurvePlanner.ROLE_PROFILES)) {
        expect(profile.baseEnergy).toBeGreaterThanOrEqual(0);
        expect(profile.baseEnergy).toBeLessThanOrEqual(1);
        expect(profile.range).toHaveLength(2);
        expect(profile.range[0]).toBeLessThanOrEqual(profile.range[1]);
      }
    });

    it("chorus and drop should have highest base energy", () => {
      const chorusEnergy = EnergyCurvePlanner.ROLE_PROFILES[FormRole.Chorus].baseEnergy;
      const dropEnergy = EnergyCurvePlanner.ROLE_PROFILES[FormRole.Drop].baseEnergy;
      expect(chorusEnergy).toBeGreaterThanOrEqual(0.8);
      expect(dropEnergy).toBeGreaterThanOrEqual(0.9);
    });

    it("intro and outro should have low base energy", () => {
      const introEnergy = EnergyCurvePlanner.ROLE_PROFILES[FormRole.Intro].baseEnergy;
      const outroEnergy = EnergyCurvePlanner.ROLE_PROFILES[FormRole.Outro].baseEnergy;
      expect(introEnergy).toBeLessThanOrEqual(0.3);
      expect(outroEnergy).toBeLessThanOrEqual(0.35);
    });
  });

  describe("planEnergy", () => {
    it("should return empty curve for empty template", () => {
      const template: FormTemplate = {
        name: "empty",
        description: "",
        sections: [],
      };
      const curve = planner.planEnergy(template);
      expect(curve.getPoints()).toHaveLength(0);
    });

    it("should generate points for each section in template", () => {
      const template: FormTemplate = {
        name: "test",
        description: "test form",
        sections: [
          { role: FormRole.Intro, bars: 4, energy: 0.2 },
          { role: FormRole.Verse, bars: 8, energy: 0.4 },
          { role: FormRole.Chorus, bars: 8, energy: 0.8 },
          { role: FormRole.Outro, bars: 4, energy: 0.15 },
        ],
      };
      const curve = planner.planEnergy(template);
      // 4 sections, each gets start + end point = 8 points
      expect(curve.getPoints()).toHaveLength(8);
    });

    it("should assign energies that blend profile and template values", () => {
      const template: FormTemplate = {
        name: "test",
        description: "",
        sections: [
          { role: FormRole.Chorus, bars: 8, energy: 0.9 },
        ],
      };
      const curve = planner.planEnergy(template);
      const points = curve.getPoints();
      // chorus base = 0.85, template = 0.9 -> blended = 0.875
      for (const p of points) {
        expect(p.level).toBeCloseTo(0.875, 0.05);
      }
    });

    it("should position points at section boundaries", () => {
      const template: FormTemplate = {
        name: "test",
        description: "",
        sections: [
          { role: FormRole.Verse, bars: 8, energy: 0.4 },
          { role: FormRole.Chorus, bars: 8, energy: 0.8 },
        ],
      };
      const curve = planner.planEnergy(template);
      const points = curve.getPoints();
      // Verse: bar 1-8, Chorus: bar 9-16
      expect(points[0].bar).toBe(1);
      expect(points[1].bar).toBe(8);
      expect(points[2].bar).toBe(9);
      expect(points[3].bar).toBe(16);
    });

    it("should work with minimal single-section template", () => {
      const template: FormTemplate = {
        name: "minimal",
        description: "",
        sections: [
          { role: FormRole.Verse, bars: 4, energy: 0.35 },
        ],
      };
      const curve = planner.planEnergy(template);
      expect(curve.getPoints()).toHaveLength(2);
    });
  });

  describe("adaptToTaste", () => {
    function makeGenome(contrast: number): TasteGenome {
      const genome = new TasteGenome();
      genome.setParameter("form.section_contrast", {
        value: String(contrast),
        distribution: { family: "beta", alpha: "4", beta: "4" },
        confidence: "0.50",
        context: {},
        evidence: [],
        timeDecay: { policy: "slow_exp", lambda: "0.001" },
        lastUpdatedAt: new Date().toISOString(),
      });
      return genome;
    }

    it("should flatten curve when contrast is low", () => {
      const curve = new EnergyCurve([], "linear");
      curve.addPoint(1, 0.1);
      curve.addPoint(5, 0.9);

      const genome = makeGenome(0.1);
      const adapted = planner.adaptToTaste(curve, genome);

      const pts = adapted.getPoints();
      // Low contrast: values move closer to 0.5
      expect(Math.abs(pts[0].level - 0.5)).toBeLessThan(0.3);
      expect(Math.abs(pts[1].level - 0.5)).toBeLessThan(0.3);
    });

    it("should amplify curve when contrast is high", () => {
      const curve = new EnergyCurve([], "linear");
      curve.addPoint(1, 0.15);
      curve.addPoint(5, 0.85);

      const genome = makeGenome(0.9);
      const adapted = planner.adaptToTaste(curve, genome);

      const pts = adapted.getPoints();
      // High contrast: values move away from 0.5
      expect(pts[0].level).toBeLessThan(0.1);
      expect(pts[1].level).toBeGreaterThan(0.9);
    });

    it("should keep values unchanged at default contrast 0.5", () => {
      const curve = new EnergyCurve([], "linear");
      curve.addPoint(1, 0.2);
      curve.addPoint(5, 0.8);

      const genome = makeGenome(0.5);
      const adapted = planner.adaptToTaste(curve, genome);

      const pts = adapted.getPoints();
      near(pts[0].level, 0.2);
      near(pts[1].level, 0.8);
    });

    it("should clamp output to [0, 1]", () => {
      const curve = new EnergyCurve([], "linear");
      curve.addPoint(1, 0.0);
      curve.addPoint(5, 1.0);

      const genome = makeGenome(1.0);
      const adapted = planner.adaptToTaste(curve, genome);

      const pts = adapted.getPoints();
      for (const p of pts) {
        expect(p.level).toBeGreaterThanOrEqual(0);
        expect(p.level).toBeLessThanOrEqual(1);
      }
    });

    it("should handle missing contrast parameter gracefully", () => {
      const curve = new EnergyCurve([], "linear");
      curve.addPoint(1, 0.2);
      curve.addPoint(5, 0.8);

      const genome = new TasteGenome();
      const adapted = planner.adaptToTaste(curve, genome);

      const pts = adapted.getPoints();
      // Default contrast = 0.5, no change
      near(pts[0].level, 0.2);
      near(pts[1].level, 0.8);
    });
  });

  describe("fromFormStructure", () => {
    it("should create curve from form sections", () => {
      const form = createFormStructure("test form");
      addSectionToForm(
        form,
        createSection({ startBar: 1, endBar: 8, energyLevel: 0.3, formRole: FormRole.Verse })
      );
      addSectionToForm(
        form,
        createSection({ startBar: 9, endBar: 16, energyLevel: 0.7, formRole: FormRole.Chorus })
      );

      const curve = planner.fromFormStructure(form);
      expect(curve.getPoints()).toHaveLength(2);
      near(curve.getPoints()[0].level, 0.3);
      near(curve.getPoints()[1].level, 0.7);
    });

    it("should return empty curve for empty form", () => {
      const form = createFormStructure("empty");
      const curve = planner.fromFormStructure(form);
      expect(curve.getPoints()).toHaveLength(0);
    });
  });

  describe("getSectionEnergy", () => {
    it("should return correct base energy for known roles", () => {
      near(planner.getSectionEnergy(FormRole.Intro), 0.25);
      near(planner.getSectionEnergy(FormRole.Verse), 0.40);
      near(planner.getSectionEnergy(FormRole.PreChorus), 0.60);
      near(planner.getSectionEnergy(FormRole.Chorus), 0.85);
      near(planner.getSectionEnergy(FormRole.Bridge), 0.50);
      near(planner.getSectionEnergy(FormRole.Solo), 0.75);
      near(planner.getSectionEnergy(FormRole.Outro), 0.30);
      near(planner.getSectionEnergy(FormRole.BuildUp), 0.55);
      near(planner.getSectionEnergy(FormRole.Drop), 0.95);
      near(planner.getSectionEnergy(FormRole.Breakdown), 0.30);
      near(planner.getSectionEnergy(FormRole.Interlude), 0.35);
    });
  });

  describe("planSectionEnergy", () => {
    it("should generate curve points for a section", () => {
      const curve = planner.planSectionEnergy(FormRole.Chorus, 9, 16, 0.8);
      const pts = curve.getPoints();
      expect(pts).toHaveLength(3);
      // Mid bar should be (9 + 16) / 2 = 12.5 -> rounded to 13
      expect(pts[0].bar).toBe(9);
      expect(pts[1].bar).toBe(13);
      expect(pts[2].bar).toBe(16);
    });

    it("should set mid point energy near profile base", () => {
      const curve = planner.planSectionEnergy(FormRole.Chorus, 1, 8, 0.85);
      const pts = curve.getPoints();
      const midEnergy = pts[1].level;
      // Base: 0.85, template: 0.85 -> energy = 0.85
      near(midEnergy, 0.85, 0.01);
    });

    it("should have edge points slightly below mid energy", () => {
      const curve = planner.planSectionEnergy(FormRole.Verse, 1, 8, 0.4);
      const pts = curve.getPoints();
      // Start and end should be 90% of mid
      expect(pts[0].level).toBeLessThan(pts[1].level);
      expect(pts[2].level).toBeLessThan(pts[1].level);
    });

    it("should handle single-bar section", () => {
      const curve = planner.planSectionEnergy(FormRole.Verse, 5, 5, 0.5);
      const pts = curve.getPoints();
      // Same-bar points are deduplicated by addPoint
      expect(pts).toHaveLength(1);
      expect(pts[0].bar).toBe(5);
    });
  });

  describe("planTransition", () => {
    it("should create transition curve from one role to another", () => {
      const curve = planner.planTransition(FormRole.Verse, FormRole.Chorus, 4);
      const pts = curve.getPoints();
      expect(pts).toHaveLength(2);
      expect(pts[0].bar).toBe(1);
      expect(pts[1].bar).toBe(4);
    });

    it("should transition from lower to higher energy", () => {
      const curve = planner.planTransition(FormRole.Verse, FormRole.Drop, 8);
      const pts = curve.getPoints();
      expect(pts[0].level).toBeLessThan(pts[1].level);
    });

    it("should transition from higher to lower energy", () => {
      const curve = planner.planTransition(FormRole.Drop, FormRole.Breakdown, 4);
      const pts = curve.getPoints();
      expect(pts[0].level).toBeGreaterThan(pts[1].level);
    });

    it("should use role base energies", () => {
      const curve = planner.planTransition(FormRole.Verse, FormRole.Chorus, 4);
      const pts = curve.getPoints();
      near(pts[0].level, 0.40); // Verse base
      near(pts[1].level, 0.85); // Chorus base
    });
  });
});
