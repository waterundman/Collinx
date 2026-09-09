import { describe, it, expect } from "vitest";
import {
  HarmonyPlan,
  pitchSetToRomanNumeral,
  pitchSetToChordSymbol,
  notesToHarmonyEntries,
} from "../harmony-plan";
import { midiToSpelling, type NoteEvent } from "../note-event";

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

describe("pitchSetToRomanNumeral", () => {
  // T01: C 大调基本三和弦映射
  it("maps C major triads to Roman numerals (T01)", () => {
    expect(pitchSetToRomanNumeral(["C", "E", "G"], "C", "major")).toBe("I");
    expect(pitchSetToRomanNumeral(["A", "C", "E"], "C", "major")).toBe("vi");
    expect(pitchSetToRomanNumeral(["D", "F", "A"], "C", "major")).toBe("ii");
    expect(pitchSetToRomanNumeral(["G", "B", "D"], "C", "major")).toBe("V");
    expect(pitchSetToRomanNumeral(["B", "D", "F"], "C", "major")).toBe("vii°");
  });

  // T01b: 增三和弦追加 "+"，与 tonic 大三和弦区分，且模板剥离 [0-9°] 时不误配 I-IV-V-I
  it("marks augmented triad with + suffix (T01b)", () => {
    expect(pitchSetToRomanNumeral(["C", "E", "G#"], "C", "major")).toBe("I+");
  });

  // T02: 容错边界
  it("handles flat tonic and minor mode (T02)", () => {
    // Bb 大调：降号根音
    expect(pitchSetToRomanNumeral(["Bb", "D", "F"], "Bb", "major")).toBe("I");
    // A 小调：自然小三和弦 + 大属和弦（G# 导音）
    expect(pitchSetToRomanNumeral(["A", "C", "E"], "A", "minor")).toBe("i");
    expect(pitchSetToRomanNumeral(["E", "G#", "B"], "A", "minor")).toBe("V");
  });

  it("returns undefined for non-diatonic root (T02)", () => {
    // C 大调中 Db 不是自然音级
    expect(pitchSetToRomanNumeral(["Db", "F", "Ab"], "C", "major")).toBeUndefined();
  });

  it("returns undefined when fewer than 3 distinct pitch classes (T02)", () => {
    expect(pitchSetToRomanNumeral(["C", "E"], "C", "major")).toBeUndefined();
  });

  it("returns undefined for garbage tokens (T02)", () => {
    expect(pitchSetToRomanNumeral(["C4", "E", "G"], "C", "major")).toBeUndefined();
  });

  it("never throws on spelled-out non-enharmonic tokens (T02)", () => {
    // "B#"/"Cb" 通过 token 正则但不在音名表内 → 必须不抛错而返回 undefined
    expect(() => pitchSetToRomanNumeral(["B#", "D#", "F#"], "C", "major")).not.toThrow();
    expect(pitchSetToRomanNumeral(["B#", "D#", "F#"], "C", "major")).toBeUndefined();
  });

  it("returns undefined for empty input (T02)", () => {
    expect(pitchSetToRomanNumeral([], "C", "major")).toBeUndefined();
  });
});

describe("pitchSetToChordSymbol", () => {
  // S0-T01: 三和弦矩阵
  it("identifies triad qualities (S0-T01)", () => {
    expect(pitchSetToChordSymbol(["C", "E", "G"])).toEqual({ root: "C", quality: "maj" });
    expect(pitchSetToChordSymbol(["E", "G", "B"])).toEqual({ root: "E", quality: "min" });
    expect(pitchSetToChordSymbol(["C", "E", "G#"])).toEqual({ root: "C", quality: "aug" });
    expect(pitchSetToChordSymbol(["B", "D", "F"])).toEqual({ root: "B", quality: "dim" });
  });

  // S0-T02: 七和弦矩阵
  it("identifies seventh chord qualities (S0-T02)", () => {
    expect(pitchSetToChordSymbol(["C", "E", "G", "B"])).toEqual({ root: "C", quality: "maj7" });
    expect(pitchSetToChordSymbol(["C", "E", "G", "Bb"])).toEqual({ root: "C", quality: "dom7" });
    expect(pitchSetToChordSymbol(["A", "C", "E", "G"])).toEqual({ root: "A", quality: "min7" });
    expect(pitchSetToChordSymbol(["B", "D", "F", "A"])).toEqual({ root: "B", quality: "halfdim7" });
    expect(pitchSetToChordSymbol(["B", "D", "F", "Ab"])).toEqual({ root: "B", quality: "dim7" });
  });

  // S0-T03: 无法识别 → undefined，绝不 throw
  it("returns undefined for unrecognized pitch sets without throwing (S0-T03)", () => {
    expect(() => pitchSetToChordSymbol(["C", "D", "G"])).not.toThrow();
    expect(pitchSetToChordSymbol(["C", "D", "G"])).toBeUndefined(); // 非三度叠置
    expect(pitchSetToChordSymbol(["C", "E"])).toBeUndefined(); // 2 pcs
    expect(pitchSetToChordSymbol(["C"])).toBeUndefined(); // 1 pc
    expect(pitchSetToChordSymbol([])).toBeUndefined(); // 空数组
    expect(pitchSetToChordSymbol(["X", "Y", "Z"])).toBeUndefined(); // 坏 token
  });
});

describe("notesToHarmonyEntries", () => {
  const key = { tonic: "C", mode: "major" };

  function chordNote(
    bar: number,
    beat: number,
    pitchMidi: number,
    durQn = 1,
    pitchSpelling?: string,
  ): NoteEvent {
    return {
      id: `n-${bar}-${beat}-${pitchMidi}`,
      trackId: "chords",
      phraseId: null,
      bar,
      beat,
      durQn,
      pitchMidi,
      pitchSpelling: pitchSpelling ?? midiToSpelling(pitchMidi),
      velocity: 0.8,
      voice: "rh",
      tags: [],
    };
  }

  // S0-T05: 分组 / 最小 beat / 跨度 durationQn / 去重 / 空输入
  it("groups by bar with min beat and span durationQn (S0-T05)", () => {
    const notes = [
      chordNote(1, 1, 60, 4), // C4
      chordNote(1, 1, 64, 4), // E4
      chordNote(1, 1, 67, 4), // G4
    ];
    const entries = notesToHarmonyEntries(notes);
    expect(entries).toHaveLength(1);
    expect(entries[0].bar).toBe(1);
    expect(entries[0].beat).toBe(1);
    expect(entries[0].durationQn).toBe(4);
    expect(entries[0].chord).toEqual({ root: "C", quality: "maj" });
  });

  it("uses time span for arpeggiated bars (S0-T05)", () => {
    // bar3 琶音：A3/C4/E4 各 1 拍 → durationQn = 跨度 3（求和会得 3 但同时态会翻倍，跨度才正确）
    const notes = [
      chordNote(3, 1, 57, 1), // A3
      chordNote(3, 2, 60, 1), // C4
      chordNote(3, 3, 64, 1), // E4
    ];
    const entries = notesToHarmonyEntries(notes);
    expect(entries).toHaveLength(1);
    expect(entries[0].beat).toBe(1);
    expect(entries[0].durationQn).toBe(3);
    expect(entries[0].chord).toEqual({ root: "A", quality: "min" });
  });

  it("dedupes pitch names preserving order and falls back to midi (S0-T05)", () => {
    const notes = [
      chordNote(2, 1, 67, 4, "G4"),
      chordNote(2, 1, 71, 4, "B4"),
      chordNote(2, 1, 74, 4, "D5"),
      chordNote(2, 1, 77, 4, "F5"),
      chordNote(2, 1, 67, 4, "G4"), // 重复，去重
    ];
    const entries = notesToHarmonyEntries(notes);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toEqual({ root: "G", quality: "dom7" });
  });

  it("returns [] for empty or all-invalid input (S0-T05)", () => {
    expect(notesToHarmonyEntries([])).toEqual([]);
    expect(notesToHarmonyEntries([null as unknown as NoteEvent])).toEqual([]);
    expect(notesToHarmonyEntries([{ bar: "x" } as unknown as NoteEvent])).toEqual([]);
  });

  // S0-T06: 有 key 填 RN / 无 key 省略 / 无法识别 bar 跳过
  it("fills romanNumeral when key given (S0-T06)", () => {
    const notes = [
      chordNote(1, 1, 60, 4), // C4
      chordNote(1, 1, 64, 4),
      chordNote(1, 1, 67, 4),
    ];
    const entries = notesToHarmonyEntries(notes, key);
    expect(entries[0].romanNumeral).toBe("I");
  });

  it("fills romanNumeral as string for dom7 bar (S0-T06)", () => {
    const notes = [
      chordNote(2, 1, 67, 4), // G4
      chordNote(2, 1, 71, 4), // B4
      chordNote(2, 1, 74, 4), // D5
      chordNote(2, 1, 77, 4), // F5
    ];
    const entries = notesToHarmonyEntries(notes, key);
    expect(typeof entries[0].romanNumeral).toBe("string");
  });

  it("omits romanNumeral when no key (S0-T06)", () => {
    const notes = [
      chordNote(1, 1, 60, 4),
      chordNote(1, 1, 64, 4),
      chordNote(1, 1, 67, 4),
    ];
    const entries = notesToHarmonyEntries(notes);
    expect(entries).toHaveLength(1);
    expect("romanNumeral" in entries[0]).toBe(false);
  });

  it("skips unrecognized bars and sorts by bar ascending (S0-T06)", () => {
    const notes = [
      chordNote(1, 1, 60, 4), // C maj
      chordNote(1, 1, 64, 4),
      chordNote(1, 1, 67, 4),
      chordNote(4, 1, 60, 4), // C4/D4/G4 → 非三度叠置，bar4 被跳过
      chordNote(4, 1, 62, 4),
      chordNote(4, 1, 67, 4),
      chordNote(3, 1, 57, 1), // A min（琶音）
      chordNote(3, 2, 60, 1),
      chordNote(3, 3, 64, 1),
    ];
    const entries = notesToHarmonyEntries(notes, key);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.bar)).toEqual([1, 3]);
    expect(entries[1].romanNumeral).toBe("vi");
  });
});
