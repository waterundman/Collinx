import { describe, it, expect } from "vitest";
import {
  FormAnalyzer,
  AnalyzerConfig,
  SectionCandidate,
} from "../form-analyzer";
import { FormRole } from "../section";
import { NoteEvent, createNoteEvent } from "../note-event";
import { TempoMap } from "../tempo-map";
import { HarmonyPlan } from "../harmony-plan";

function makeNote(
  bar: number,
  beat: number,
  pitch: number,
  vel = 0.8,
  dur = 1.0
): NoteEvent {
  return createNoteEvent({
    trackId: "t1",
    bar,
    beat,
    pitchMidi: pitch,
    velocity: vel,
    durQn: dur,
  });
}

function sparseNotes(
  startBar: number,
  endBar: number,
  basePitch = 60
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = startBar; bar <= endBar; bar++) {
    notes.push(makeNote(bar, 1, basePitch, 0.5));
    notes.push(makeNote(bar, 2.5, basePitch + 2, 0.5));
  }
  return notes;
}

function denseNotes(
  startBar: number,
  endBar: number,
  basePitch = 64
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = startBar; bar <= endBar; bar++) {
    for (let beat = 1; beat <= 4; beat++) {
      notes.push(
        makeNote(bar, beat, basePitch + ((beat - 1) % 4) * 2, 0.85)
      );
    }
  }
  return notes;
}

function similarMelody(
  startBar: number,
  endBar: number,
  basePitch = 60
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = startBar; bar <= endBar; bar++) {
    notes.push(makeNote(bar, 1, basePitch, 0.8, 1.5));
    notes.push(makeNote(bar, 3, basePitch + 4, 0.8, 1.5));
  }
  return notes;
}

describe("FormAnalyzer", () => {
  describe("constructor", () => {
    it("should use default config", () => {
      const analyzer = new FormAnalyzer();
      const result = analyzer.detectSections([], TempoMap.default());
      expect(result).toEqual([]);
    });

    it("should accept custom config", () => {
      const config: AnalyzerConfig = {
        minSectionBars: 8,
        similarityThreshold: 0.8,
        energyThreshold: 0.3,
      };
      const analyzer = new FormAnalyzer(config);
      const notes = [
        ...sparseNotes(1, 8, 60),
        ...denseNotes(9, 16, 72),
      ];
      const result = analyzer.detectSections(notes, TempoMap.default());
      expect(result).toHaveLength(1);
    });
  });

  describe("detectSections", () => {
    it("should return empty for empty notes", () => {
      const analyzer = new FormAnalyzer();
      const result = analyzer.detectSections([], TempoMap.default());
      expect(result).toEqual([]);
    });

    it("should return single section for short song", () => {
      const analyzer = new FormAnalyzer();
      const notes = [makeNote(1, 1, 60), makeNote(2, 1, 62)];
      const result = analyzer.detectSections(notes, TempoMap.default());
      expect(result).toHaveLength(1);
      expect(result[0].startBar).toBe(1);
      expect(result[0].endBar).toBe(2);
    });

    it("should detect sections with density contrast", () => {
      const analyzer = new FormAnalyzer();
      const notes = [
        ...sparseNotes(1, 8, 60),
        ...denseNotes(9, 16, 72),
      ];
      const result = analyzer.detectSections(notes, TempoMap.default());
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].startBar).toBe(1);
      expect(result[result.length - 1].endBar).toBe(16);
    });

    it("should classify high-density section as Chorus", () => {
      const analyzer = new FormAnalyzer();
      const notes: NoteEvent[] = [];
      for (let bar = 1; bar <= 8; bar++) {
        for (let beat = 1; beat <= 4; beat += 0.25) {
          notes.push(makeNote(bar, beat, 72 + (beat % 3) * 2, 0.95));
        }
      }
      const result = analyzer.detectSections(notes, TempoMap.default());
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].role).toBe(FormRole.Chorus);
    });

    it("should use cadence boundaries from harmony plan", () => {
      const analyzer = new FormAnalyzer();
      const notes = [
        ...sparseNotes(1, 8, 60),
        ...denseNotes(9, 16, 72),
        ...sparseNotes(17, 24, 62),
      ];

      const harmonyPlan = new HarmonyPlan();
      harmonyPlan.addEntry({
        bar: 8,
        beat: 3,
        chord: { root: "G", quality: "dom7" },
        durationQn: 2,
        romanNumeral: "V7",
      });
      harmonyPlan.addEntry({
        bar: 9,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      });
      harmonyPlan.addEntry({
        bar: 16,
        beat: 3,
        chord: { root: "G", quality: "dom7" },
        durationQn: 2,
        romanNumeral: "V7",
      });
      harmonyPlan.addEntry({
        bar: 17,
        beat: 1,
        chord: { root: "C", quality: "maj" },
        durationQn: 4,
        romanNumeral: "I",
      });

      const result = analyzer.detectSections(
        notes,
        TempoMap.default(),
        harmonyPlan
      );
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should unify similar melody sections to same role", () => {
      const analyzer = new FormAnalyzer();
      const notes = [
        ...similarMelody(1, 8, 60),
        ...denseNotes(9, 12, 72),
        ...similarMelody(13, 20, 62),
      ];
      const result = analyzer.detectSections(notes, TempoMap.default());
      const roles = result.map((s) => s.role);
      const uniqueRoles = new Set(roles);
      expect(uniqueRoles.size).toBeLessThanOrEqual(2);
    });
  });

  describe("detectForm", () => {
    it("should detect pop_ababcb", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.8,
            pitchRange: [55, 80],
          },
        },
        {
          startBar: 17, endBar: 24,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 25, endBar: 32,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.8,
            pitchRange: [55, 80],
          },
        },
        {
          startBar: 33, endBar: 40,
          role: FormRole.Bridge,
          confidence: 0.6,
          features: {
            noteDensity: 3, chordChangeRate: 2,
            melodyRepeatCount: 0, avgVelocity: 0.6,
            pitchRange: [48, 75],
          },
        },
        {
          startBar: 41, endBar: 48,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 7, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.9,
            pitchRange: [55, 84],
          },
        },
      ];
      const result = analyzer.detectForm(candidates);
      expect(result.formType).toBe("pop_ababcb");
      expect(result.confidence).toBe(0.85);
    });

    it("should detect electronic", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 16,
          role: FormRole.BuildUp,
          confidence: 0.7,
          features: {
            noteDensity: 1, chordChangeRate: 0.5,
            melodyRepeatCount: 0, avgVelocity: 0.3,
            pitchRange: [48, 65],
          },
        },
        {
          startBar: 17, endBar: 32,
          role: FormRole.Drop,
          confidence: 0.9,
          features: {
            noteDensity: 8, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.95,
            pitchRange: [40, 90],
          },
        },
        {
          startBar: 33, endBar: 40,
          role: FormRole.Breakdown,
          confidence: 0.6,
          features: {
            noteDensity: 1, chordChangeRate: 0.3,
            melodyRepeatCount: 0, avgVelocity: 0.2,
            pitchRange: [45, 60],
          },
        },
        {
          startBar: 41, endBar: 48,
          role: FormRole.BuildUp,
          confidence: 0.7,
          features: {
            noteDensity: 1.5, chordChangeRate: 0.5,
            melodyRepeatCount: 0, avgVelocity: 0.35,
            pitchRange: [48, 68],
          },
        },
        {
          startBar: 49, endBar: 64,
          role: FormRole.Drop,
          confidence: 0.9,
          features: {
            noteDensity: 9, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.95,
            pitchRange: [40, 96],
          },
        },
      ];
      const result = analyzer.detectForm(candidates);
      expect(result.formType).toBe("electronic");
      expect(result.confidence).toBe(0.85);
    });

    it("should detect partial pop pattern", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.8,
            pitchRange: [55, 80],
          },
        },
      ];
      const result = analyzer.detectForm(candidates);
      expect(result.formType).toBe("pop_ababcb");
      expect(result.confidence).toBe(0.5);
    });

    it("should return unknown for empty sections", () => {
      const analyzer = new FormAnalyzer();
      const result = analyzer.detectForm([]);
      expect(result.formType).toBe("unknown");
      expect(result.confidence).toBe(0);
    });

    it("should return unknown for unrecognized pattern", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Intro,
          confidence: 0.5,
          features: {
            noteDensity: 0.5, chordChangeRate: 0.2,
            melodyRepeatCount: 0, avgVelocity: 0.2,
            pitchRange: [55, 65],
          },
        },
      ];
      const result = analyzer.detectForm(candidates);
      expect(result.formType).toBe("unknown");
    });
  });

  describe("computeTransitions", () => {
    it("should compute energy deltas between sections", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.4,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 7, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.9,
            pitchRange: [55, 80],
          },
        },
        {
          startBar: 17, endBar: 24,
          role: FormRole.Bridge,
          confidence: 0.6,
          features: {
            noteDensity: 3, chordChangeRate: 2,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [48, 72],
          },
        },
      ];
      const transitions = analyzer.computeTransitions(candidates);
      expect(transitions).toHaveLength(2);

      expect(transitions[0].fromBar).toBe(8);
      expect(transitions[0].toBar).toBe(9);
      expect(transitions[0].energyDelta).toBeGreaterThan(0);

      expect(transitions[1].fromBar).toBe(16);
      expect(transitions[1].toBar).toBe(17);
      expect(transitions[1].energyDelta).toBeLessThan(0);
    });

    it("should return empty for single section", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
      ];
      const transitions = analyzer.computeTransitions(candidates);
      expect(transitions).toEqual([]);
    });
  });

  describe("toSections", () => {
    it("should convert candidates to Section objects", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.85,
            pitchRange: [55, 80],
          },
        },
      ];
      const sections = analyzer.toSections(candidates);
      expect(sections).toHaveLength(2);
      expect(sections[0].startBar).toBe(1);
      expect(sections[0].endBar).toBe(8);
      expect(sections[0].formRole).toBe(FormRole.Verse);
      expect(sections[0].name).toBe("Verse");
      expect(sections[0].energyLevel).toBe(0.38);

      expect(sections[1].startBar).toBe(9);
      expect(sections[1].endBar).toBe(16);
      expect(sections[1].formRole).toBe(FormRole.Chorus);
      expect(sections[1].name).toBe("Chorus");
      expect(sections[1].energyLevel).toBeGreaterThan(0.7);
    });

    it("should number repeated roles", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.8,
            pitchRange: [55, 80],
          },
        },
        {
          startBar: 17, endBar: 24,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2.5, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
      ];
      const sections = analyzer.toSections(candidates);
      expect(sections).toHaveLength(3);
      expect(sections[0].name).toBe("Verse");
      expect(sections[2].name).toBe("Verse 2");
    });

    it("should handle empty candidates", () => {
      const analyzer = new FormAnalyzer();
      const sections = analyzer.toSections([]);
      expect(sections).toEqual([]);
    });
  });

  describe("toFormStructure", () => {
    it("should build a form structure from candidates", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
        {
          startBar: 9, endBar: 16,
          role: FormRole.Chorus,
          confidence: 0.8,
          features: {
            noteDensity: 6, chordChangeRate: 1.5,
            melodyRepeatCount: 0, avgVelocity: 0.8,
            pitchRange: [55, 80],
          },
        },
      ];
      const form = analyzer.toFormStructure(candidates);
      expect(form.sections).toHaveLength(2);
      expect(form.name).toBe("pop_ababcb");
      expect(form.timeSignature).toEqual({ numerator: 4, denominator: 4 });
      expect(form.sections[0].formRole).toBe(FormRole.Verse);
      expect(form.sections[1].formRole).toBe(FormRole.Chorus);
    });

    it("should use custom name if provided", () => {
      const analyzer = new FormAnalyzer();
      const candidates: SectionCandidate[] = [
        {
          startBar: 1, endBar: 8,
          role: FormRole.Verse,
          confidence: 0.7,
          features: {
            noteDensity: 2, chordChangeRate: 1,
            melodyRepeatCount: 0, avgVelocity: 0.5,
            pitchRange: [50, 70],
          },
        },
      ];
      const form = analyzer.toFormStructure(candidates, "My Song");
      expect(form.name).toBe("My Song");
    });
  });

  describe("melodySimilarity", () => {
    it("should return 1 for two empty arrays", () => {
      const analyzer = new FormAnalyzer();
      const sim = analyzer.melodySimilarity([], []);
      expect(sim).toBe(1);
    });

    it("should return 0 when one array is empty", () => {
      const analyzer = new FormAnalyzer();
      const notes = [makeNote(1, 1, 60)];
      const sim = analyzer.melodySimilarity(notes, []);
      expect(sim).toBe(0);
    });

    it("should return high similarity for identical melodies", () => {
      const analyzer = new FormAnalyzer();
      const notesA = [
        makeNote(1, 1, 60, 0.8, 1.0),
        makeNote(1, 2, 64, 0.8, 0.5),
        makeNote(1, 3, 67, 0.8, 0.5),
        makeNote(1, 4, 64, 0.8, 1.0),
      ];
      const notesB = notesA.map((n) =>
        makeNote(n.bar + 4, n.beat, n.pitchMidi, n.velocity, n.durQn)
      );
      const sim = analyzer.melodySimilarity(notesA, notesB);
      expect(sim).toBeGreaterThan(0.9);
    });

    it("should return high similarity for transposed melodies", () => {
      const analyzer = new FormAnalyzer();
      const notesA = [
        makeNote(1, 1, 60, 0.8, 1.0),
        makeNote(1, 3, 64, 0.8, 1.0),
      ];
      const notesB = [
        makeNote(5, 1, 67, 0.8, 1.0),
        makeNote(5, 3, 71, 0.8, 1.0),
      ];
      const sim = analyzer.melodySimilarity(notesA, notesB);
      expect(sim).toBeGreaterThan(0.8);
    });

    it("should return low similarity for different melodies", () => {
      const analyzer = new FormAnalyzer();
      const notesA = [
        makeNote(1, 1, 60, 0.8, 1.0),
        makeNote(1, 2, 62, 0.8, 1.0),
        makeNote(1, 3, 64, 0.8, 1.0),
      ];
      const notesB = [
        makeNote(2, 1, 72, 0.8, 1.0),
        makeNote(2, 2, 70, 0.8, 1.0),
        makeNote(2, 3, 68, 0.8, 1.0),
      ];
      const sim = analyzer.melodySimilarity(notesA, notesB);
      expect(sim).toBeLessThan(0.5);
    });

    it("should handle different length melodies", () => {
      const analyzer = new FormAnalyzer();
      const notesA = [
        makeNote(1, 1, 60),
        makeNote(1, 2, 64),
      ];
      const notesB = [
        makeNote(2, 1, 60),
        makeNote(2, 2, 64),
        makeNote(2, 3, 67),
        makeNote(2, 4, 72),
      ];
      const sim = analyzer.melodySimilarity(notesA, notesB);
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });
  });
});
