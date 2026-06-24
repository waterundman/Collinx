import { describe, it, expect } from "vitest";
import {
  EnergyCurve,
  EnergyPoint,
} from "../energy-curve";
import {
  FormRole,
  createSection,
} from "../section";

function near(a: number, b: number, epsilon = 0.001): void {
  expect(Math.abs(a - b)).toBeLessThan(epsilon);
}

describe("EnergyCurve", () => {
  describe("constructor", () => {
    it("should create an empty curve", () => {
      const curve = new EnergyCurve();
      expect(curve.getPoints()).toEqual([]);
      expect(curve.at(1)).toBe(0.5);
    });

    it("should sort points by bar", () => {
      const points: EnergyPoint[] = [
        { bar: 10, level: 0.5 },
        { bar: 1, level: 0.2 },
        { bar: 5, level: 0.8 },
      ];
      const curve = new EnergyCurve(points);
      const sorted = curve.getPoints();
      expect(sorted[0].bar).toBe(1);
      expect(sorted[1].bar).toBe(5);
      expect(sorted[2].bar).toBe(10);
    });
  });

  describe("addPoint / removePoint", () => {
    it("should add a point and keep sorted", () => {
      const curve = new EnergyCurve();
      curve.addPoint(8, 0.6);
      curve.addPoint(2, 0.3);
      curve.addPoint(5, 0.9);
      expect(curve.getPoints()).toHaveLength(3);
      expect(curve.getPoints()[0].bar).toBe(2);
      expect(curve.getPoints()[2].bar).toBe(8);
    });

    it("should replace point at same bar", () => {
      const curve = new EnergyCurve();
      curve.addPoint(4, 0.3);
      curve.addPoint(4, 0.9);
      expect(curve.getPoints()).toHaveLength(1);
      expect(curve.getPoints()[0].level).toBe(0.9);
    });

    it("should clamp level to 0-1", () => {
      const curve = new EnergyCurve();
      curve.addPoint(1, -0.5);
      curve.addPoint(2, 1.5);
      expect(curve.getPoints()[0].level).toBe(0);
      expect(curve.getPoints()[1].level).toBe(1);
    });

    it("should remove a point by bar", () => {
      const curve = new EnergyCurve();
      curve.addPoint(1, 0.2);
      curve.addPoint(5, 0.8);
      curve.removePoint(1);
      expect(curve.getPoints()).toHaveLength(1);
      expect(curve.getPoints()[0].bar).toBe(5);
    });
  });

  describe("at()", () => {
    it("should return level at exact bar", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.2 },
        { bar: 5, level: 0.8 },
      ]);
      near(curve.at(1), 0.2);
      near(curve.at(5), 0.8);
    });

    it("should linear interpolate between points", () => {
      const curve = new EnergyCurve([
        { bar: 0, level: 0.0 },
        { bar: 10, level: 1.0 },
      ]);
      near(curve.at(5), 0.5);
      near(curve.at(2), 0.2);
      near(curve.at(8), 0.8);
    });

    it("should clamp to bounds", () => {
      const curve = new EnergyCurve([
        { bar: 2, level: 0.3 },
        { bar: 6, level: 0.7 },
      ]);
      near(curve.at(0), 0.3);
      near(curve.at(10), 0.7);
    });

    it("should interpolate with ease_in mode", () => {
      const curve = new EnergyCurve(
        [
          { bar: 0, level: 0.0 },
          { bar: 10, level: 1.0 },
        ],
        "ease_in"
      );
      const mid = curve.at(5);
      expect(mid).toBeLessThan(0.5);
    });

    it("should interpolate with ease_out mode", () => {
      const curve = new EnergyCurve(
        [
          { bar: 0, level: 0.0 },
          { bar: 10, level: 1.0 },
        ],
        "ease_out"
      );
      const mid = curve.at(5);
      expect(mid).toBeGreaterThan(0.5);
    });

    it("should use step mode", () => {
      const curve = new EnergyCurve(
        [
          { bar: 0, level: 0.0 },
          { bar: 5, level: 1.0 },
        ],
        "step"
      );
      near(curve.at(2), 0.0);
      near(curve.at(4.9), 0.0);
      near(curve.at(5), 1.0);
      near(curve.at(8), 1.0);
    });

    it("should use ease_in_out mode", () => {
      const curve = new EnergyCurve(
        [
          { bar: 0, level: 0.0 },
          { bar: 10, level: 1.0 },
        ],
        "ease_in_out"
      );
      const mid = curve.at(5);
      near(mid, 0.5, 0.01);
    });

    it("should handle zero-length segment", () => {
      const curve = new EnergyCurve([
        { bar: 5, level: 0.3 },
        { bar: 5, level: 0.7 },
      ]);
      near(curve.at(5), 0.3);
    });
  });

  describe("setMode", () => {
    it("should change interpolation mode", () => {
      const curve = new EnergyCurve([
        { bar: 0, level: 0.0 },
        { bar: 10, level: 1.0 },
      ]);
      curve.setMode("linear");
      near(curve.at(5), 0.5);
      curve.setMode("ease_in");
      expect(curve.at(5)).toBeLessThan(0.5);
    });
  });

  describe("normalize", () => {
    it("should normalize levels to 0-1 range", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.3 },
        { bar: 2, level: 0.5 },
        { bar: 3, level: 0.7 },
      ]);
      const n = curve.normalize();
      near(n.getPoints()[0].level, 0.0);
      near(n.getPoints()[1].level, 0.5);
      near(n.getPoints()[2].level, 1.0);
    });

    it("should handle flat curve", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.5 },
        { bar: 5, level: 0.5 },
      ]);
      const n = curve.normalize();
      near(n.getPoints()[0].level, 0.5);
      near(n.getPoints()[1].level, 0.5);
    });

    it("should handle empty curve", () => {
      const curve = new EnergyCurve();
      const n = curve.normalize();
      expect(n.getPoints()).toHaveLength(0);
    });
  });

  describe("scaleToBars", () => {
    it("should scale points to target bar count", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.2 },
        { bar: 5, level: 0.8 },
        { bar: 10, level: 0.4 },
      ]);
      const scaled = curve.scaleToBars(20);
      const pts = scaled.getPoints();
      expect(pts[0].bar).toBe(2);
      expect(pts[1].bar).toBe(10);
      expect(pts[2].bar).toBe(20);
    });

    it("should handle empty curve", () => {
      const curve = new EnergyCurve();
      const scaled = curve.scaleToBars(16);
      expect(scaled.getPoints()).toHaveLength(0);
    });

    it("should handle zero total bars", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.5 },
      ]);
      const scaled = curve.scaleToBars(0);
      expect(scaled.getPoints()).toHaveLength(0);
    });
  });

  describe("smooth", () => {
    it("should smooth levels with moving average", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 1.0 },
        { bar: 2, level: 0.0 },
        { bar: 3, level: 1.0 },
        { bar: 4, level: 0.0 },
        { bar: 5, level: 1.0 },
      ]);
      const smoothed = curve.smooth(3);
      const pts = smoothed.getPoints();
      expect(pts).toHaveLength(5);
      expect(pts[2].level).toBeGreaterThan(0.3);
      expect(pts[2].level).toBeLessThan(0.7);
    });

    it("should not smooth with fewer than 3 points", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.2 },
        { bar: 2, level: 0.8 },
      ]);
      const smoothed = curve.smooth(3);
      expect(smoothed.getPoints()[0].level).toBe(0.2);
    });

    it("should not smooth with window size < 2", () => {
      const curve = new EnergyCurve([
        { bar: 1, level: 0.2 },
        { bar: 2, level: 0.8 },
        { bar: 3, level: 0.5 },
      ]);
      const smoothed = curve.smooth(1);
      const pts = smoothed.getPoints();
      expect(pts[0].level).toBe(0.2);
      expect(pts[1].level).toBe(0.8);
    });
  });

  describe("fromSections", () => {
    it("should create curve from section energy levels", () => {
      const sections = [
        createSection({ startBar: 1, endBar: 8, energyLevel: 0.3 }),
        createSection({ startBar: 9, endBar: 16, energyLevel: 0.7 }),
        createSection({ startBar: 17, endBar: 24, energyLevel: 0.5 }),
      ];
      const curve = EnergyCurve.fromSections(sections);
      expect(curve.getPoints()).toHaveLength(3);
      near(curve.getPoints()[0].level, 0.3);
      near(curve.getPoints()[1].level, 0.7);
    });

    it("should return empty curve for empty sections", () => {
      const curve = EnergyCurve.fromSections([]);
      expect(curve.getPoints()).toHaveLength(0);
    });
  });

  describe("defaultArc", () => {
    it("should create a standard arc with 5 points", () => {
      const curve = EnergyCurve.defaultArc(64);
      expect(curve.getPoints()).toHaveLength(5);
    });

    it("should handle 0 bars gracefully", () => {
      const curve = EnergyCurve.defaultArc(0);
      expect(curve.getPoints()).toHaveLength(5);
      expect(curve.getPoints()[0].bar).toBe(1);
    });

    it("should have low start and end, high middle", () => {
      const curve = EnergyCurve.defaultArc(100);
      const pts = curve.getPoints();
      expect(pts[0].level).toBeLessThan(0.5);
      expect(pts[2].level).toBeGreaterThan(0.7);
      expect(pts[4].level).toBeLessThan(0.5);
    });
  });

  describe("buildUp", () => {
    it("should create a rising curve", () => {
      const curve = EnergyCurve.buildUp(64);
      const pts = curve.getPoints();
      expect(pts[0].level).toBeLessThan(0.1);
      expect(pts[pts.length - 1].level).toBe(1.0);
    });

    it("should handle 0 bars", () => {
      const curve = EnergyCurve.buildUp(0);
      const pts = curve.getPoints();
      expect(pts[pts.length - 1].level).toBe(1.0);
    });
  });

  describe("serialization", () => {
    it("should roundtrip through JSON", () => {
      const curve = new EnergyCurve(
        [
          { bar: 1, level: 0.2 },
          { bar: 5, level: 0.8 },
        ],
        "ease_in_out"
      );
      const json = curve.toJSON();
      const restored = EnergyCurve.fromJSON(json);
      expect(restored.getPoints()).toHaveLength(2);
      near(restored.at(3), curve.at(3), 0.001);
    });
  });
});
