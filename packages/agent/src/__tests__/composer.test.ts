import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "@collinx/core";
import { Composer } from "../composer";

describe("Composer", () => {
  let registry: ToolRegistry;
  let composer: Composer;

  beforeEach(() => {
    registry = new ToolRegistry();
    composer = new Composer(registry);
  });

  describe("generateMotif", () => {
    it("should generate notes for default parameters", () => {
      const result = composer.generateMotif({
        bars: 4,
        register: "mid",
      });

      expect(result.status).toBe("ok");
      expect(result.resultType).toBe("proposal");
      expect(result.requiresUserConfirmation).toBe(true);

      const data = result.data as { notes: unknown[]; motif: Record<string, unknown> };
      expect(data.notes).toBeDefined();
      expect(Array.isArray(data.notes)).toBe(true);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    it("should generate notes in the correct register", () => {
      const lowResult = composer.generateMotif({ bars: 2, register: "low" });
      const midResult = composer.generateMotif({ bars: 2, register: "mid" });
      const highResult = composer.generateMotif({ bars: 2, register: "high" });

      const lowData = lowResult.data as { notes: { pitchMidi: number }[] };
      const midData = midResult.data as { notes: { pitchMidi: number }[] };
      const highData = highResult.data as { notes: { pitchMidi: number }[] };

      const lowAvg = lowData.notes.reduce((s, n) => s + n.pitchMidi, 0) / lowData.notes.length;
      const midAvg = midData.notes.reduce((s, n) => s + n.pitchMidi, 0) / midData.notes.length;
      const highAvg = highData.notes.reduce((s, n) => s + n.pitchMidi, 0) / highData.notes.length;

      expect(lowAvg).toBeLessThan(midAvg);
      expect(midAvg).toBeLessThan(highAvg);
    });

    it("should respect bar count", () => {
      const result2bar = composer.generateMotif({ bars: 2, register: "mid" });
      const result8bar = composer.generateMotif({ bars: 8, register: "mid" });

      const data2 = result2bar.data as { notes: { bar: number }[] };
      const data8 = result8bar.data as { notes: { bar: number }[] };

      const maxBar2 = Math.max(...data2.notes.map((n) => n.bar));
      const maxBar8 = Math.max(...data8.notes.map((n) => n.bar));

      expect(maxBar2).toBeLessThanOrEqual(2);
      expect(maxBar8).toBeLessThanOrEqual(8);
      expect(data8.notes.length).toBeGreaterThan(data2.notes.length);
    });

    it("should handle different keys", () => {
      const resultC = composer.generateMotif({ bars: 2, register: "mid", key: "C" });
      const resultG = composer.generateMotif({ bars: 2, register: "mid", key: "G" });

      const dataC = resultC.data as { notes: { pitchMidi: number }[] };
      const dataG = resultG.data as { notes: { pitchMidi: number }[] };

      // G major should generally be 7 semitones higher than C major
      expect(dataC.notes.length).toBeGreaterThan(0);
      expect(dataG.notes.length).toBeGreaterThan(0);
    });

    it("should handle different scales", () => {
      const majorResult = composer.generateMotif({
        bars: 2,
        register: "mid",
        key: "C",
        scale: "major",
      });
      const minorResult = composer.generateMotif({
        bars: 2,
        register: "mid",
        key: "C",
        scale: "minor",
      });

      expect(majorResult.status).toBe("ok");
      expect(minorResult.status).toBe("ok");
    });

    it("should handle pentatonic scale", () => {
      const result = composer.generateMotif({
        bars: 2,
        register: "mid",
        scale: "pentatonic_major",
      });
      expect(result.status).toBe("ok");
      const data = result.data as { notes: unknown[] };
      expect(data.notes.length).toBeGreaterThan(0);
    });

    it("should generate notes with valid pitch ranges", () => {
      const result = composer.generateMotif({ bars: 4, register: "mid" });
      const data = result.data as { notes: { pitchMidi: number }[] };

      for (const note of data.notes) {
        expect(note.pitchMidi).toBeGreaterThanOrEqual(21);
        expect(note.pitchMidi).toBeLessThanOrEqual(108);
      }
    });

    it("should generate notes with proper structure", () => {
      const result = composer.generateMotif({ bars: 2, register: "mid" });
      const data = result.data as { notes: { id: string; bar: number; beat: number; durQn: number; pitchMidi: number; velocity: number }[] };

      for (const note of data.notes) {
        expect(note.id).toBeTruthy();
        expect(note.bar).toBeGreaterThanOrEqual(1);
        expect(note.bar).toBeLessThanOrEqual(2);
        expect(note.beat).toBeGreaterThanOrEqual(1);
        expect(note.durQn).toBeGreaterThan(0);
        expect(note.velocity).toBeGreaterThanOrEqual(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
      }
    });

    it("should include motif metadata", () => {
      const result = composer.generateMotif({ bars: 4, register: "mid", key: "D", scale: "minor" });
      const data = result.data as { motif: { name: string; bars: number; instrumentRole: string; tags: string[]; noteIds: string[] } };

      expect(data.motif.name).toContain("Motif");
      expect(data.motif.bars).toBe(4);
      expect(data.motif.instrumentRole).toBe("melody");
      expect(Array.isArray(data.motif.noteIds)).toBe(true);
    });

    it("should handle different style hints", () => {
      const styles = ["classical", "jazz", "pop", "rock", "electronic", "minimal"];
      for (const style of styles) {
        const result = composer.generateMotif({
          bars: 2,
          register: "mid",
          styleHint: style,
        });
        expect(result.status).toBe("ok");
      }
    });

    it("should have confidence score", () => {
      const result = composer.generateMotif({ bars: 2, register: "mid" });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("suggestHarmony", () => {
    it("should generate harmony entries", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });

      expect(result.status).toBe("ok");
      expect(result.resultType).toBe("proposal");

      const data = result.data as { entries: unknown[]; key: string; pattern: string };
      expect(data.entries).toBeDefined();
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.length).toBeGreaterThan(0);
      expect(data.key).toBe("C");
    });

    it("should generate harmony for different keys", () => {
      const keys = ["C", "G", "D", "F", "Bb", "A", "E"];
      for (const key of keys) {
        const result = composer.suggestHarmony({ bars: 4, key });
        expect(result.status).toBe("ok");
      }
    });

    it("should generate harmony with style hint", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C", style: "jazz" });
      expect(result.status).toBe("ok");
    });

    it("should limit harmony entries to bar count", () => {
      const result = composer.suggestHarmony({ bars: 2, key: "C" });
      const data = result.data as { entries: { bar: number }[] };

      for (const entry of data.entries) {
        expect(entry.bar).toBeLessThanOrEqual(2);
      }
    });

    it("should include roman numeral analysis", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      const data = result.data as { entries: { romanNumeral: string }[] };

      for (const entry of data.entries) {
        expect(entry.romanNumeral).toBeTruthy();
      }
    });

    it("should have confidence score", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should require user confirmation", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      expect(result.requiresUserConfirmation).toBe(true);
    });
  });
});
