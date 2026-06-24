import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  getInstrument,
  getInstrumentsByFamily,
  getAllInstruments,
  midiInInstrumentRange,
  midiInComfortableRange,
  instrumentRangeLabel,
} from "../instrument";
import type { InstrumentFamily } from "../instrument";

describe("INSTRUMENTS", () => {
  it("should contain 30+ built-in instruments", () => {
    const count = Object.keys(INSTRUMENTS).length;
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("should have unique IDs matching keys", () => {
    for (const [key, inst] of Object.entries(INSTRUMENTS)) {
      expect(inst.id).toBe(key);
    }
  });

  it("should have valid ranges for all instruments", () => {
    for (const inst of Object.values(INSTRUMENTS)) {
      expect(inst.range.minMidi).toBeLessThanOrEqual(inst.range.maxMidi);
      expect(inst.range.comfortableLow).toBeGreaterThanOrEqual(inst.range.minMidi);
      expect(inst.range.comfortableHigh).toBeLessThanOrEqual(inst.range.maxMidi);
      expect(inst.range.comfortableLow).toBeLessThanOrEqual(inst.range.comfortableHigh);
    }
  });

  it("should have a valid family for all instruments", () => {
    const validFamilies: InstrumentFamily[] = [
      "woodwind", "brass", "strings", "percussion", "keyboard", "voice", "electronic",
    ];
    for (const inst of Object.values(INSTRUMENTS)) {
      expect(validFamilies).toContain(inst.family);
    }
  });

  it("should have valid clef for all instruments", () => {
    const validClefs = ["treble", "bass", "alto", "tenor", "treble_8vb"];
    for (const inst of Object.values(INSTRUMENTS)) {
      expect(validClefs).toContain(inst.clef);
    }
  });

  it("should have valid defaultVelocity (0-1) for all instruments", () => {
    for (const inst of Object.values(INSTRUMENTS)) {
      expect(inst.defaultVelocity).toBeGreaterThan(0);
      expect(inst.defaultVelocity).toBeLessThanOrEqual(1);
    }
  });

  it("should contain woodwind instruments", () => {
    const woodwinds = getInstrumentsByFamily("woodwind");
    expect(woodwinds.length).toBeGreaterThan(0);
    expect(woodwinds.some((i) => i.id === "flute")).toBe(true);
    expect(woodwinds.some((i) => i.id === "oboe")).toBe(true);
    expect(woodwinds.some((i) => i.id === "clarinet_bb")).toBe(true);
    expect(woodwinds.some((i) => i.id === "bassoon")).toBe(true);
  });

  it("should contain brass instruments", () => {
    const brass = getInstrumentsByFamily("brass");
    expect(brass.length).toBeGreaterThan(0);
    expect(brass.some((i) => i.id === "trumpet_bb")).toBe(true);
    expect(brass.some((i) => i.id === "horn_f")).toBe(true);
    expect(brass.some((i) => i.id === "trombone")).toBe(true);
    expect(brass.some((i) => i.id === "tuba")).toBe(true);
  });

  it("should contain string instruments", () => {
    const strings = getInstrumentsByFamily("strings");
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.some((i) => i.id === "violin")).toBe(true);
    expect(strings.some((i) => i.id === "viola")).toBe(true);
    expect(strings.some((i) => i.id === "cello")).toBe(true);
    expect(strings.some((i) => i.id === "double_bass")).toBe(true);
  });

  it("should contain keyboard instruments", () => {
    const keyboards = getInstrumentsByFamily("keyboard");
    expect(keyboards.length).toBeGreaterThan(0);
    expect(keyboards.some((i) => i.id === "piano")).toBe(true);
  });

  it("should contain percussion instruments", () => {
    const percussion = getInstrumentsByFamily("percussion");
    expect(percussion.length).toBeGreaterThan(0);
    expect(percussion.some((i) => i.id === "timpani")).toBe(true);
    expect(percussion.some((i) => i.id === "drum_kit")).toBe(true);
  });

  it("should contain voice instruments", () => {
    const voices = getInstrumentsByFamily("voice");
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.some((i) => i.id === "voice_soprano")).toBe(true);
    expect(voices.some((i) => i.id === "voice_alto")).toBe(true);
    expect(voices.some((i) => i.id === "voice_tenor")).toBe(true);
    expect(voices.some((i) => i.id === "voice_bass")).toBe(true);
  });

  it("should contain electronic instruments", () => {
    const electronic = getInstrumentsByFamily("electronic");
    expect(electronic.length).toBeGreaterThan(0);
    expect(electronic.some((i) => i.id === "synth_lead")).toBe(true);
    expect(electronic.some((i) => i.id === "synth_pad")).toBe(true);
    expect(electronic.some((i) => i.id === "electric_guitar")).toBe(true);
    expect(electronic.some((i) => i.id === "electric_bass")).toBe(true);
  });
});

describe("getInstrument", () => {
  it("should return instrument by ID", () => {
    const inst = getInstrument("violin");
    expect(inst).toBeDefined();
    expect(inst!.name).toBe("Violin");
    expect(inst!.family).toBe("strings");
  });

  it("should return undefined for unknown ID", () => {
    expect(getInstrument("nonexistent")).toBeUndefined();
  });
});

describe("getAllInstruments", () => {
  it("should return all instruments", () => {
    const all = getAllInstruments();
    expect(all.length).toBe(Object.keys(INSTRUMENTS).length);
  });
});

describe("midiInInstrumentRange", () => {
  it("should return true for notes within range", () => {
    const violin = getInstrument("violin")!;
    expect(midiInInstrumentRange(69, violin)).toBe(true); // A4
    expect(midiInInstrumentRange(55, violin)).toBe(true); // G3 (lowest)
    expect(midiInInstrumentRange(103, violin)).toBe(true); // G6 (highest)
  });

  it("should return false for notes outside range", () => {
    const violin = getInstrument("violin")!;
    expect(midiInInstrumentRange(48, violin)).toBe(false); // C3 (too low)
    expect(midiInInstrumentRange(108, violin)).toBe(false); // C8 (too high)
  });

  it("bass should not play treble notes", () => {
    const bass = getInstrument("double_bass")!;
    expect(midiInInstrumentRange(72, bass)).toBe(false); // C5 way too high
    expect(midiInInstrumentRange(40, bass)).toBe(true); // E2
  });
});

describe("midiInComfortableRange", () => {
  it("should return true for comfortable notes", () => {
    const flute = getInstrument("flute")!;
    expect(midiInComfortableRange(79, flute)).toBe(true); // G5
  });

  it("should return false for extreme but playable notes", () => {
    const flute = getInstrument("flute")!;
    expect(midiInComfortableRange(72, flute)).toBe(false); // C5 lowest, not comfortable
  });
});

describe("instrumentRangeLabel", () => {
  it("should return human-readable range", () => {
    const violin = getInstrument("violin")!;
    const label = instrumentRangeLabel(violin);
    expect(label).toMatch(/^[A-G][#b]?\d+–[A-G][#b]?\d+$/);
  });
});

describe("transposition", () => {
  it("clarinet Bb should transpose -2", () => {
    const clarinet = getInstrument("clarinet_bb")!;
    expect(clarinet.transposition).toBe(-2);
  });

  it("horn in F should transpose -7", () => {
    const horn = getInstrument("horn_f")!;
    expect(horn.transposition).toBe(-7);
  });

  it("piano should not transpose", () => {
    const piano = getInstrument("piano")!;
    expect(piano.transposition).toBe(0);
  });

  it("double bass sounds octave lower", () => {
    const bass = getInstrument("double_bass")!;
    expect(bass.transposition).toBe(-12);
  });
});

describe("isPolyphonic", () => {
  it("piano should be polyphonic", () => {
    expect(getInstrument("piano")!.isPolyphonic).toBe(true);
  });

  it("flute should be monophonic", () => {
    expect(getInstrument("flute")!.isPolyphonic).toBe(false);
  });

  it("violin should be polyphonic", () => {
    expect(getInstrument("violin")!.isPolyphonic).toBe(true);
  });
});
