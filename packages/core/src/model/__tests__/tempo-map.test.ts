import { describe, it, expect } from "vitest";
import { TempoMap } from "../tempo-map";

describe("TempoMap", () => {
  describe("default", () => {
    it("should create default 4/4 120bpm C major", () => {
      const map = TempoMap.default();
      expect(map.bpmAt(1)).toBe(120);
      expect(map.meterAt(1)).toEqual({ numerator: 4, denominator: 4 });
      expect(map.keyAt(1)).toEqual({ tonic: "C", mode: "major" });
    });
  });

  describe("bpmAt", () => {
    it("should return tempo at the start of a section", () => {
      const map = new TempoMap([{ bar: 1, bpm: 120 }]);
      expect(map.bpmAt(1)).toBe(120);
    });

    it("should return tempo for bars within a section", () => {
      const map = new TempoMap([{ bar: 1, bpm: 120 }]);
      expect(map.bpmAt(5)).toBe(120);
    });

    it("should return updated tempo after a change", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120 },
        { bar: 5, bpm: 140 },
      ]);
      expect(map.bpmAt(1)).toBe(120);
      expect(map.bpmAt(5)).toBe(140);
      expect(map.bpmAt(10)).toBe(140);
    });

    it("should interpolate linear curve", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120, curve: "linear" },
        { bar: 5, bpm: 140 },
      ]);
      const mid = map.bpmAt(3);
      expect(mid).toBeCloseTo(130, 0);
    });

    it("should remain at start bpm before ease_in curve reaches end", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120, curve: "ease_in" },
        { bar: 5, bpm: 140 },
      ]);
      const early = map.bpmAt(2);
      expect(early).toBeLessThan(130);
    });

    it("should accelerate near end of ease_out curve", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120, curve: "ease_out" },
        { bar: 5, bpm: 140 },
      ]);
      const late = map.bpmAt(4);
      expect(late).toBeGreaterThan(130);
    });

    it("should change instantly with instant curve", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120, curve: "instant" },
        { bar: 5, bpm: 140 },
      ]);
      expect(map.bpmAt(4.9, 1)).toBe(120);
      expect(map.bpmAt(5)).toBe(140);
    });
  });

  describe("meterAt", () => {
    it("should return meter for a bar", () => {
      const map = new TempoMap(
        [],
        [{ bar: 1, numerator: 4, denominator: 4 }]
      );
      expect(map.meterAt(1)).toEqual({ numerator: 4, denominator: 4 });
    });

    it("should return updated meter after a change", () => {
      const map = new TempoMap(
        [],
        [
          { bar: 1, numerator: 4, denominator: 4 },
          { bar: 9, numerator: 3, denominator: 4 },
        ]
      );
      expect(map.meterAt(5).numerator).toBe(4);
      expect(map.meterAt(9).numerator).toBe(3);
    });
  });

  describe("keyAt", () => {
    it("should return key for a bar", () => {
      const map = new TempoMap(
        [],
        [],
        [{ bar: 1, tonic: "D", mode: "minor" }]
      );
      expect(map.keyAt(1)).toEqual({ tonic: "D", mode: "minor" });
    });

    it("should return updated key after a modulation", () => {
      const map = new TempoMap(
        [],
        [],
        [
          { bar: 1, tonic: "C", mode: "major" },
          { bar: 17, tonic: "G", mode: "major" },
        ]
      );
      expect(map.keyAt(8).tonic).toBe("C");
      expect(map.keyAt(17).tonic).toBe("G");
    });
  });

  describe("timeAt", () => {
    it("should compute 4 bars at 120bpm 4/4 = 8 seconds", () => {
      const map = TempoMap.default();
      const t = map.timeAt(5, 1);
      expect(t).toBeCloseTo(8.0, 1);
    });

    it("should compute 1 bar at 60bpm 4/4 = 4 seconds", () => {
      const map = new TempoMap([{ bar: 1, bpm: 60 }]);
      const t = map.timeAt(2, 1);
      expect(t).toBeCloseTo(4.0, 1);
    });

    it("should handle 3/4 meter", () => {
      const map = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 3, denominator: 4 }]
      );
      const t = map.timeAt(3, 1);
      expect(t).toBeCloseTo(3.0, 1);
    });

    it("should handle 6/8 meter at 120bpm", () => {
      const map = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 6, denominator: 8 }]
      );
      const t = map.timeAt(2, 1);
      expect(t).toBeCloseTo(1.5, 1);
    });

    it("should handle tempo change mid-piece", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120 },
        { bar: 3, bpm: 60 },
      ]);
      const atBar3 = map.timeAt(3, 1);
      expect(atBar3).toBeCloseTo(4.0, 1);
      const atBar5 = map.timeAt(6, 1);
      expect(atBar5).toBeCloseTo(16.0, 1);
    });

    it("should handle partial bar beat positions", () => {
      const map = TempoMap.default();
      const t1 = map.timeAt(1, 1);
      const t2 = map.timeAt(1, 3);
      expect(t2 - t1).toBeCloseTo(1.0, 1);
    });

    it("should return 0 for bar 0", () => {
      const map = TempoMap.default();
      expect(map.timeAt(0, 1)).toBe(0);
    });

    it("should handle linear tempo curve integration", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120, curve: "linear" },
        { bar: 3, bpm: 60 },
      ]);
      const t = map.timeAt(3, 1);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(8);
      expect(t).toBeCloseTo(5.33, 0);
    });
  });

  describe("barBeatAt", () => {
    it("should roundtrip with timeAt", () => {
      const map = TempoMap.default();
      const time = map.timeAt(3, 3);
      const pos = map.barBeatAt(time);
      expect(pos.bar).toBe(3);
      expect(pos.beat).toBeCloseTo(3, 0.5);
    });

    it("should return bar 1 beat 1 for 0 seconds", () => {
      const map = TempoMap.default();
      const pos = map.barBeatAt(0);
      expect(pos).toEqual({ bar: 1, beat: 1 });
    });
  });

  describe("add/remove changes", () => {
    it("should add tempo change", () => {
      const map = TempoMap.default();
      map.addTempoChange({ bar: 5, bpm: 80 });
      expect(map.bpmAt(5)).toBe(80);
    });

    it("should replace existing tempo at same bar", () => {
      const map = TempoMap.default();
      map.addTempoChange({ bar: 1, bpm: 160 });
      expect(map.bpmAt(1)).toBe(160);
    });

    it("should add meter change", () => {
      const map = TempoMap.default();
      map.addMeterChange({ bar: 5, numerator: 3, denominator: 4 });
      expect(map.meterAt(5).numerator).toBe(3);
    });

    it("should add key change", () => {
      const map = TempoMap.default();
      map.addKeyChange({ bar: 9, tonic: "G", mode: "major" });
      expect(map.keyAt(9).tonic).toBe("G");
    });
  });

  describe("getBarsDuration / getTotalSeconds", () => {
    it("should estimate total bars from change points", () => {
      const map = new TempoMap([
        { bar: 1, bpm: 120 },
        { bar: 5, bpm: 80 },
      ]);
      expect(map.getBarsDuration()).toBe(21);
    });

    it("should compute total seconds", () => {
      const map = TempoMap.default();
      const total = map.getTotalSeconds();
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("serialization", () => {
    it("should roundtrip through node data", () => {
      const map = new TempoMap(
        [
          { bar: 1, bpm: 120, curve: "linear" },
          { bar: 4, bpm: 160 },
        ],
        [{ bar: 1, numerator: 4, denominator: 4 }],
        [{ bar: 1, tonic: "C", mode: "major" }]
      );
      const data = map.toNodeData();
      const restored = TempoMap.fromNodeData(data);
      expect(restored.bpmAt(1)).toBe(120);
      expect(restored.bpmAt(4)).toBe(160);
      expect(restored.meterAt(1).numerator).toBe(4);
      expect(restored.keyAt(1).tonic).toBe("C");
    });
  });
});
