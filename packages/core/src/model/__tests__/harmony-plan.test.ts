import { describe, it, expect } from "vitest";
import { HarmonyPlan } from "../harmony-plan";

describe("HarmonyPlan", () => {
  describe("parseChordSymbol", () => {
    it("should parse major triad", () => {
      const c = HarmonyPlan.parseChordSymbol("C");
      expect(c.root).toBe("C");
      expect(c.quality).toBe("maj");
    });

    it("should parse minor triad", () => {
      const c = HarmonyPlan.parseChordSymbol("Am");
      expect(c.root).toBe("A");
      expect(c.quality).toBe("min");
    });

    it("should parse dominant 7th", () => {
      const c = HarmonyPlan.parseChordSymbol("G7");
      expect(c.root).toBe("G");
      expect(c.quality).toBe("dom7");
    });

    it("should parse major 7th", () => {
      const c = HarmonyPlan.parseChordSymbol("Fmaj7");
      expect(c.root).toBe("F");
      expect(c.quality).toBe("maj7");
    });

    it("should parse minor 7th", () => {
      const c = HarmonyPlan.parseChordSymbol("Dm7");
      expect(c.root).toBe("D");
      expect(c.quality).toBe("min7");
    });

    it("should parse half-diminished (m7b5)", () => {
      const c = HarmonyPlan.parseChordSymbol("Bm7b5");
      expect(c.root).toBe("B");
      expect(c.quality).toBe("halfdim7");
    });

    it("should parse diminished 7th", () => {
      const c = HarmonyPlan.parseChordSymbol("G#dim7");
      expect(c.root).toBe("G#");
      expect(c.quality).toBe("dim7");
    });

    it("should parse sharp root", () => {
      const c = HarmonyPlan.parseChordSymbol("F#m");
      expect(c.root).toBe("F#");
      expect(c.quality).toBe("min");
    });

    it("should parse flat root", () => {
      const c = HarmonyPlan.parseChordSymbol("Eb");
      expect(c.root).toBe("Eb");
      expect(c.quality).toBe("maj");
    });

    it("should parse slash chord", () => {
      const c = HarmonyPlan.parseChordSymbol("C/E");
      expect(c.root).toBe("C");
      expect(c.quality).toBe("maj");
      expect(c.bass).toBe("E");
    });

    it("should parse chord with extensions", () => {
      const c = HarmonyPlan.parseChordSymbol("G7b9");
      expect(c.root).toBe("G");
      expect(c.quality).toBe("dom7");
      expect(c.extensions).toBe("b9");
    });

    it("should parse chord with complex extensions", () => {
      const c = HarmonyPlan.parseChordSymbol("Dm11");
      expect(c.root).toBe("D");
      expect(c.quality).toBe("min");
      expect(c.extensions).toBe("11");
    });

    it("should parse dominant 9th", () => {
      const c = HarmonyPlan.parseChordSymbol("C9");
      expect(c.root).toBe("C");
      expect(c.quality).toBe("dom9");
    });

    it("should parse augmented chord", () => {
      const c = HarmonyPlan.parseChordSymbol("Caug");
      expect(c.root).toBe("C");
      expect(c.quality).toBe("aug");
    });

    it("should parse diminished triad", () => {
      const c = HarmonyPlan.parseChordSymbol("Bdim");
      expect(c.root).toBe("B");
      expect(c.quality).toBe("dim");
    });
  });

  describe("formatChordSymbol", () => {
    it("should format major triad", () => {
      expect(
        HarmonyPlan.formatChordSymbol({ root: "C", quality: "maj" })
      ).toBe("C");
    });

    it("should format minor triad", () => {
      expect(
        HarmonyPlan.formatChordSymbol({ root: "A", quality: "min" })
      ).toBe("Am");
    });

    it("should format dominant 7th", () => {
      expect(
        HarmonyPlan.formatChordSymbol({ root: "G", quality: "dom7" })
      ).toBe("G7");
    });

    it("should format slash chord", () => {
      expect(
        HarmonyPlan.formatChordSymbol({
          root: "C",
          quality: "maj",
          bass: "E",
        })
      ).toBe("C/E");
    });

    it("should format chord with extensions", () => {
      expect(
        HarmonyPlan.formatChordSymbol({
          root: "G",
          quality: "dom7",
          extensions: "b9",
        })
      ).toBe("G7b9");
    });

    it("should roundtrip parse and format", () => {
      const symbols = [
        "C", "Am", "G7", "Fmaj7", "Dm7", "Bm7b5",
        "F#m", "Eb", "C/E", "G7b9",
      ];
      for (const sym of symbols) {
        const parsed = HarmonyPlan.parseChordSymbol(sym);
        const formatted = HarmonyPlan.formatChordSymbol(parsed);
        expect(formatted).toBe(sym);
      }
    });
  });

  describe("addEntry / chordAt", () => {
    it("should add and query a chord", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      });

      const chord = plan.chordAt(1, 1);
      expect(chord).toBeDefined();
      expect(chord!.root).toBe("C");
    });

    it("should find chord active at later beats", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });

      const chord = plan.chordAt(1, 3);
      expect(chord).toBeDefined();
      expect(chord!.root).toBe("C");
    });

    it("should find chord in later bars", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });
      plan.addEntry({
        bar: 2,
        beat: 1,
        chord: { root: "G", quality: "dom7" },
        durationQn: 4,
      });

      expect(plan.chordAt(2, 1)!.root).toBe("G");
      expect(plan.chordAt(2, 2)!.root).toBe("G");
    });

    it("should return undefined for position before any chord", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 5,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });

      expect(plan.chordAt(1, 1)).toBeUndefined();
    });
  });

  describe("getEntriesInRange", () => {
    it("should filter entries by bar range", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });
      plan.addEntry({
        bar: 2, beat: 1,
        chord: { root: "G", quality: "dom7" },
        durationQn: 4,
      });
      plan.addEntry({
        bar: 3, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });

      const range = plan.getEntriesInRange(1, 2);
      expect(range).toHaveLength(2);
    });
  });

  describe("removeEntry", () => {
    it("should remove an entry by bar and beat", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });
      plan.removeEntry(1, 1);
      expect(plan.chordAt(1, 1)).toBeUndefined();
    });
  });

  describe("getChordProgression", () => {
    it("should return chord symbols as strings", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: HarmonyPlan.parseChordSymbol("Am"),
        durationQn: 4,
        romanNumeral: "i",
      });
      plan.addEntry({
        bar: 2, beat: 1,
        chord: HarmonyPlan.parseChordSymbol("G7"),
        durationQn: 4,
        romanNumeral: "V7",
      });
      plan.addEntry({
        bar: 3, beat: 1,
        chord: HarmonyPlan.parseChordSymbol("C"),
        durationQn: 4,
        romanNumeral: "I",
      });

      const prog = plan.getChordProgression();
      expect(prog).toEqual(["i", "V7", "I"]);
    });
  });

  describe("detectCadences", () => {
    it("should detect authentic cadence V-I", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      });
      plan.addEntry({
        bar: 2, beat: 1,
        chord: { root: "G", quality: "dom7" },
        durationQn: 2,
        romanNumeral: "V7",
      });
      plan.addEntry({
        bar: 2, beat: 3,
        chord: { root: "C", quality: "maj" },
        durationQn: 2,
        romanNumeral: "I",
      });

      const cadences = plan.detectCadences();
      expect(cadences).toHaveLength(1);
      expect(cadences[0].type).toBe("authentic");
      expect(cadences[0].bar).toBe(2);
    });

    it("should detect plagal cadence IV-I", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 4, beat: 1,
        chord: { root: "F", quality: "maj" },
        durationQn: 2,
        romanNumeral: "IV",
      });
      plan.addEntry({
        bar: 4, beat: 3,
        chord: { root: "C", quality: "maj" },
        durationQn: 2,
        romanNumeral: "I",
      });

      const cadences = plan.detectCadences();
      expect(cadences.some((c) => c.type === "plagal")).toBe(true);
    });

    it("should detect ii-V-I progression", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "D", quality: "min7" },
        durationQn: 2,
        romanNumeral: "ii",
      });
      plan.addEntry({
        bar: 1, beat: 3,
        chord: { root: "G", quality: "dom7" },
        durationQn: 1,
        romanNumeral: "V7",
      });
      plan.addEntry({
        bar: 1, beat: 4,
        chord: { root: "C", quality: "maj" },
        durationQn: 1,
        romanNumeral: "I",
      });

      const cadences = plan.detectCadences();
      expect(cadences.some((c) => c.type === "ii-V-I")).toBe(true);
    });

    it("should handle entries without roman numerals", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "D", quality: "min7" },
        durationQn: 4,
      });
      plan.addEntry({
        bar: 2, beat: 1,
        chord: { root: "G", quality: "dom7" },
        durationQn: 4,
      });
      plan.addEntry({
        bar: 3, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
      });

      const cadences = plan.detectCadences();
      expect(cadences).toHaveLength(0);
    });
  });

  describe("serialization", () => {
    it("should roundtrip through node data", () => {
      const plan = new HarmonyPlan();
      plan.addEntry({
        bar: 1, beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      });

      const data = plan.toNodeData();
      const restored = HarmonyPlan.fromNodeData(data);
      expect(restored.chordAt(1, 1)!.root).toBe("C");
      expect(restored.getAllEntries()).toHaveLength(1);
    });

    it("should handle empty plan", () => {
      const plan = new HarmonyPlan();
      const data = plan.toNodeData();
      const restored = HarmonyPlan.fromNodeData(data);
      expect(restored.getAllEntries()).toHaveLength(0);
    });
  });
});
