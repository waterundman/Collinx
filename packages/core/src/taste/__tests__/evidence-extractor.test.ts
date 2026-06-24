import { describe, it, expect, beforeEach } from "vitest";
import { EvidenceExtractor } from "../evidence-extractor";
import { TempoMap } from "../../model/tempo-map";
import { HarmonyPlan } from "../../model/harmony-plan";
import type { NoteEvent } from "../../model/note-event";
import { randomUUID } from "../../util/random-uuid";

function makeNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    id: randomUUID(),
    trackId: "track-1",
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1.0,
    pitchMidi: 60,
    pitchSpelling: "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
    ...overrides,
  };
}

function makeNotes(count: number, factory: (i: number) => Partial<NoteEvent>): NoteEvent[] {
  return Array.from({ length: count }, (_, i) => makeNote(factory(i)));
}

const defaultTempoMap = TempoMap.default();

describe("EvidenceExtractor", () => {
  let extractor: EvidenceExtractor;

  beforeEach(() => {
    extractor = new EvidenceExtractor();
  });

  describe("extract() - full pipeline", () => {
    it("should return all 8 domain features and summary", () => {
      const notes = makeNotes(4, (i) => ({
        bar: 1,
        beat: i + 1,
        pitchMidi: 60 + i * 2,
        durQn: 1.0,
      }));

      const result = extractor.extract(notes, defaultTempoMap);

      expect(result.harmony).toBeDefined();
      expect(result.melody).toBeDefined();
      expect(result.rhythm).toBeDefined();
      expect(result.texture).toBeDefined();
      expect(result.timbre).toBeDefined();
      expect(result.form).toBeDefined();
      expect(result.mix).toBeDefined();
      expect(result.reject).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalNotes).toBe(4);
    });
  });

  describe("extractHarmony", () => {
    it("should return chromaticColorRatio of 0 for empty notes", () => {
      const f = extractor.extractHarmony([], defaultTempoMap);
      expect(f.chromaticColorRatio).toBe(0);
      expect(f.chordDensity).toBe(0);
      expect(f.borrowedChordRatio).toBe(0);
      expect(f.cadenceTypeDistribution).toEqual({});
    });

    it("should return chromaticColorRatio = 0 for diatonic notes in C major", () => {
      const diatonicPitches = [60, 62, 64, 65, 67, 69, 71];
      const notes = diatonicPitches.map((p, i) =>
        makeNote({ pitchMidi: p, bar: 1, beat: i + 1 })
      );

      const f = extractor.extractHarmony(notes, defaultTempoMap);
      expect(f.chromaticColorRatio).toBe(0);
    });

    it("should detect chromatic notes outside C major", () => {
      const notes = [
        makeNote({ pitchMidi: 61, bar: 1, beat: 1 }),
        makeNote({ pitchMidi: 63, bar: 1, beat: 2 }),
      ];

      const f = extractor.extractHarmony(notes, defaultTempoMap);
      expect(f.chromaticColorRatio).toBe(1);
    });

    it("should compute chordDensity from HarmonyPlan", () => {
      const hp = new HarmonyPlan([
        { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
        { bar: 2, beat: 1, chord: { root: "F", quality: "maj" }, durationQn: 4 },
        { bar: 3, beat: 1, chord: { root: "G", quality: "maj" }, durationQn: 4 },
        { bar: 4, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      ]);

      const notes = makeNotes(4, (i) => ({ bar: i + 1, beat: 1, pitchMidi: 60 }));
      const f = extractor.extractHarmony(notes, defaultTempoMap, hp);
      expect(f.chordDensity).toBe(0.25);
    });

    it("should detect borrowed chords", () => {
      const hp = new HarmonyPlan([
        { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
        { bar: 2, beat: 1, chord: { root: "Eb", quality: "maj" }, durationQn: 4 },
      ]);

      const notes = makeNotes(2, (i) => ({ bar: i + 1, beat: 1, pitchMidi: 60 }));
      const f = extractor.extractHarmony(notes, defaultTempoMap, hp);
      expect(f.borrowedChordRatio).toBe(0.5);
    });
  });

  describe("extractMelody", () => {
    it("should return rangeWidth = 0 for single note", () => {
      const notes = [makeNote({ pitchMidi: 60 })];
      const f = extractor.extractMelody(notes);
      expect(f.rangeWidth).toBe(0);
    });

    it("should compute rangeWidth for two octaves", () => {
      const notes = [
        makeNote({ pitchMidi: 60, bar: 1, beat: 1 }),
        makeNote({ pitchMidi: 84, bar: 1, beat: 2 }),
      ];
      const f = extractor.extractMelody(notes);
      expect(f.rangeWidth).toBe(0.5);
    });

    it("should return leapRatio near 0 for stepwise melody", () => {
      const notes = makeNotes(5, (i) => ({
        pitchMidi: 60 + i,
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractMelody(notes);
      expect(f.leapRatio).toBe(0);
      expect(f.stepRatio).toBeGreaterThan(0.5);
    });

    it("should return leapRatio near 1 for leaping melody", () => {
      const notes = makeNotes(5, (i) => ({
        pitchMidi: 60 + i * 7,
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractMelody(notes);
      expect(f.leapRatio).toBe(1);
      expect(f.stepRatio).toBe(0);
    });

    it("should compute phraseEndPitch", () => {
      const notes = [
        makeNote({ pitchMidi: 60, phraseId: "A", bar: 1, beat: 1 }),
        makeNote({ pitchMidi: 64, phraseId: "A", bar: 1, beat: 2 }),
        makeNote({ pitchMidi: 60, phraseId: "B", bar: 2, beat: 1 }),
        makeNote({ pitchMidi: 64, phraseId: "B", bar: 2, beat: 2 }),
        makeNote({ pitchMidi: 60, phraseId: "C", bar: 3, beat: 1 }),
        makeNote({ pitchMidi: 72, phraseId: "C", bar: 3, beat: 2 }),
      ];
      const f = extractor.extractMelody(notes);
      expect(f.phraseEndPitch).toBeGreaterThanOrEqual(0);
      expect(f.phraseEndPitch).toBeLessThanOrEqual(1);
    });
  });

  describe("extractRhythm", () => {
    it("should return syncopationRatio near 0 for downbeat notes", () => {
      const notes = makeNotes(4, (i) => ({
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractRhythm(notes, defaultTempoMap);
      expect(f.syncopationRatio).toBe(0);
    });

    it("should return syncopationRatio > 0.5 for offbeat notes", () => {
      const notes = makeNotes(4, (i) => ({
        bar: 1,
        beat: i + 1.5,
      }));
      const f = extractor.extractRhythm(notes, defaultTempoMap);
      expect(f.syncopationRatio).toBe(1);
    });

    it("should return 0 for empty notes", () => {
      const f = extractor.extractRhythm([], defaultTempoMap);
      expect(f.syncopationRatio).toBe(0);
      expect(f.swingAmount).toBe(0);
      expect(f.restDensity).toBe(0);
      expect(f.grooveDensity).toBe(0);
    });
  });

  describe("extractTexture", () => {
    it("should return density > 0 for dense textures", () => {
      const notes = makeNotes(12, (i) => ({
        pitchMidi: 40 + (i % 6) * 7,
        bar: 1,
        beat: 1 + (i % 4) * 0.25,
        durQn: 1.0,
      }));
      const f = extractor.extractTexture(notes, defaultTempoMap);
      expect(f.density).toBeGreaterThan(0);
    });

    it("should return density = 0 for empty notes", () => {
      const f = extractor.extractTexture([], defaultTempoMap);
      expect(f.density).toBe(0);
    });

    it("should detect pad layering from long notes", () => {
      const notes = [
        makeNote({ durQn: 4.0, bar: 1, beat: 1 }),
        makeNote({ durQn: 0.5, bar: 1, beat: 2 }),
      ];
      const f = extractor.extractTexture(notes, defaultTempoMap);
      expect(f.padLayering).toBe(0.5);
    });
  });

  describe("extractTimbre", () => {
    it("should return brightness > 0 for high-pitch notes", () => {
      const notes = makeNotes(4, (i) => ({
        pitchMidi: 80 + i * 2,
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractTimbre(notes);
      expect(f.brightness).toBe(1);
    });

    it("should return brightness = 0 for low-pitch notes", () => {
      const notes = makeNotes(4, (i) => ({
        pitchMidi: 40 + i * 2,
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractTimbre(notes);
      expect(f.brightness).toBe(0);
    });

    it("should compute transientSoftness from velocity", () => {
      const softNotes = makeNotes(3, (i) => ({
        velocity: 0.2,
        bar: 1,
        beat: i + 1,
      }));
      const hardNotes = makeNotes(3, (i) => ({
        velocity: 0.9,
        bar: 1,
        beat: i + 1,
      }));

      const soft = extractor.extractTimbre(softNotes);
      const hard = extractor.extractTimbre(hardNotes);

      expect(soft.transientSoftness).toBeGreaterThan(hard.transientSoftness);
    });
  });

  describe("extractForm", () => {
    it("should return sectionContrast = 0 for single phrase", () => {
      const notes = makeNotes(4, (i) => ({
        phraseId: "A",
        bar: 1,
        beat: i + 1,
      }));
      const f = extractor.extractForm(notes, defaultTempoMap);
      expect(f.sectionContrast).toBe(0);
    });

    it("should detect contrast between phrases", () => {
      const verse = makeNotes(2, (i) => ({
        phraseId: "verse",
        bar: 1,
        beat: i + 1,
      }));
      const chorus = makeNotes(6, (i) => ({
        phraseId: "chorus",
        bar: 2,
        beat: i * 0.5 + 1,
      }));
      const f = extractor.extractForm([...verse, ...chorus], defaultTempoMap);
      expect(f.sectionContrast).toBeGreaterThan(0);
    });

    it("should detect intro/outro for thin sections at edges", () => {
      const intro = makeNotes(1, (i) => ({
        phraseId: "intro",
        bar: 1,
        beat: 1,
      }));
      const body = makeNotes(8, (i) => ({
        phraseId: "body",
        bar: 2,
        beat: i + 1,
      }));
      const outro = makeNotes(1, (i) => ({
        phraseId: "outro",
        bar: 10,
        beat: 1,
      }));

      const f = extractor.extractForm([...intro, ...body, ...outro], defaultTempoMap);
      expect(typeof f.introOutro.hasIntro).toBe("boolean");
      expect(typeof f.introOutro.hasOutro).toBe("boolean");
    });
  });

  describe("extractReject", () => {
    it("should return 0 for empty notes", () => {
      const f = extractor.extractReject([]);
      expect(f.tripletFillBeforeDrop).toBe(0);
      expect(f.excessiveSidechain).toBe(0);
    });

    it("should detect triplet fill pattern", () => {
      const notes = makeNotes(3, (i) => ({
        bar: 1,
        beat: 1 + i * 0.33,
        durQn: 0.33,
        pitchMidi: 60 + i,
      }));
      const f = extractor.extractReject(notes);
      expect(f.tripletFillBeforeDrop).toBe(1);
    });
  });

  describe("toEvidenceSet", () => {
    it("should generate evidence for all mapped parameters", () => {
      const notes = makeNotes(4, (i) => ({
        bar: 1,
        beat: i + 1,
        pitchMidi: 60 + i,
      }));
      const features = extractor.extract(notes, defaultTempoMap);
      const evidence = extractor.toEvidenceSet(features, "export://test");

      expect(evidence.length).toBeGreaterThanOrEqual(18);
      expect(evidence.every((e) => e.type === "confirmed_export_diff")).toBe(true);
      expect(evidence.every((e) => e.ref === "export://test")).toBe(true);
    });

    it("should generate evidence with correct paramKey prefix", () => {
      const notes = makeNotes(4, (i) => ({ bar: 1, beat: i + 1, pitchMidi: 60 + i }));
      const features = extractor.extract(notes, defaultTempoMap);
      const evidence = extractor.toEvidenceSet(features, "export://test");

      const keys = evidence.map((e) => e.paramKey);
      expect(keys.some((k) => k.startsWith("harmony."))).toBe(true);
      expect(keys.some((k) => k.startsWith("melody."))).toBe(true);
      expect(keys.some((k) => k.startsWith("rhythm."))).toBe(true);
      expect(keys.some((k) => k.startsWith("texture."))).toBe(true);
      expect(keys.some((k) => k.startsWith("timbre."))).toBe(true);
      expect(keys.some((k) => k.startsWith("form."))).toBe(true);
      expect(keys.some((k) => k.startsWith("mix."))).toBe(true);
      expect(keys.some((k) => k.startsWith("reject."))).toBe(true);
    });
  });

  describe("summary", () => {
    it("should compute summary stats", () => {
      const notes = makeNotes(8, (i) => ({
        bar: Math.ceil((i + 1) / 2),
        beat: (i % 2) + 1,
        pitchMidi: 60 + i,
      }));
      const features = extractor.extract(notes, defaultTempoMap);
      expect(features.summary.totalNotes).toBe(8);
      expect(features.summary.totalBars).toBe(4);
      expect(features.summary.avgTempo).toBe(120);
      expect(features.summary.keySignature).toBe("C major");
      expect(features.summary.timeSignature).toBe("4/4");
    });
  });
});
