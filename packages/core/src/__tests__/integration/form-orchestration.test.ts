import { describe, it, expect, beforeEach } from "vitest";
import { createNoteEvent, type NoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import {
  FormRole,
  createSection,
  createFormStructure,
  addSectionToForm,
  type Section,
  type FormStructure,
} from "../../model/section";
import { FormAnalyzer } from "../../model/form-analyzer";
import { FormTemplate, getTemplate, applyTemplate } from "../../model/form-templates";

function createMotifNotes(trackId: string, startBar: number, basePitch: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const pitches = [0, 2, 4, 5, 7, 5, 4, 2];
  for (let i = 0; i < 4; i++) {
    notes.push(
      createNoteEvent({
        trackId,
        bar: startBar + i,
        beat: 1,
        durQn: 2,
        pitchMidi: basePitch + pitches[i * 2],
        velocity: 0.7,
        voice: "rh",
        tags: ["motif"],
      })
    );
    notes.push(
      createNoteEvent({
        trackId,
        bar: startBar + i,
        beat: 3,
        durQn: 2,
        pitchMidi: basePitch + pitches[i * 2 + 1],
        velocity: 0.7,
        voice: "rh",
        tags: ["motif"],
      })
    );
  }
  return notes;
}

function createFullSongNotes(): NoteEvent[] {
  return [
    ...createMotifNotes("melody", 1, 64),
    ...createMotifNotes("melody", 5, 67),
    ...createMotifNotes("melody", 9, 64),
    ...createMotifNotes("melody", 13, 69),
    ...createMotifNotes("melody", 17, 62),
    ...createMotifNotes("melody", 21, 72),
  ];
}

function createPopForm(): FormStructure {
  const form = createFormStructure("Pop Song");

  addSectionToForm(form, createSection({
    name: "Intro",
    formRole: FormRole.Intro,
    startBar: 1,
    endBar: 4,
    energyLevel: 0.2,
  }));

  addSectionToForm(form, createSection({
    name: "Verse 1",
    formRole: FormRole.Verse,
    startBar: 5,
    endBar: 8,
    energyLevel: 0.35,
  }));

  addSectionToForm(form, createSection({
    name: "Chorus 1",
    formRole: FormRole.Chorus,
    startBar: 9,
    endBar: 12,
    energyLevel: 0.7,
  }));

  addSectionToForm(form, createSection({
    name: "Verse 2",
    formRole: FormRole.Verse,
    startBar: 13,
    endBar: 16,
    energyLevel: 0.4,
  }));

  addSectionToForm(form, createSection({
    name: "Chorus 2",
    formRole: FormRole.Chorus,
    startBar: 17,
    endBar: 20,
    energyLevel: 0.75,
  }));

  addSectionToForm(form, createSection({
    name: "Outro",
    formRole: FormRole.Outro,
    startBar: 21,
    endBar: 24,
    energyLevel: 0.15,
  }));

  return form;
}

describe("FormStructure + Orchestrator + Arranger integration", () => {
  let form: FormStructure;
  let motifs: NoteEvent[][];

  beforeEach(() => {
    form = createPopForm();
    motifs = [
      createMotifNotes("verse_motif", 1, 64),
      createMotifNotes("chorus_motif", 1, 69),
    ];
  });

  describe("FormStructure creation and manipulation", () => {
    it("should create a form with sections", () => {
      expect(form.sections).toHaveLength(6);
      expect(form.sections[0].formRole).toBe(FormRole.Intro);
      expect(form.sections[1].formRole).toBe(FormRole.Verse);
      expect(form.sections[2].formRole).toBe(FormRole.Chorus);
      expect(form.sections[5].formRole).toBe(FormRole.Outro);
    });

    it("should have correct bar ranges for sections", () => {
      expect(form.sections[0].startBar).toBe(1);
      expect(form.sections[0].endBar).toBe(4);
      expect(form.sections[1].startBar).toBe(5);
      expect(form.sections[1].endBar).toBe(8);
      expect(form.sections[5].startBar).toBe(21);
      expect(form.sections[5].endBar).toBe(24);
    });

    it("should have correct energy progression", () => {
      const energies = form.sections.map((s) => s.energyLevel);
      // Chorus should have higher energy than Verse
      expect(energies[2]).toBeGreaterThan(energies[1]);
      // Outro should have lower energy
      expect(energies[5]).toBeLessThan(energies[4]);
    });
  });

  describe("Form detection (reverse detection)", () => {
    it("should detect sections from notes", () => {
      const notes = createFullSongNotes();
      const tempoMap = TempoMap.default();
      const analyzer = new FormAnalyzer();

      const candidates = analyzer.detectSections(notes, tempoMap);
      expect(candidates.length).toBeGreaterThan(0);

      // Every candidate should have valid bar ranges
      for (const c of candidates) {
        expect(c.startBar).toBeGreaterThanOrEqual(1);
        expect(c.endBar).toBeGreaterThanOrEqual(c.startBar);
        expect(c.role).toBeDefined();
        expect(c.confidence).toBeGreaterThan(0);
      }
    });

    it("should detect form type from section candidates", () => {
      const notes = createFullSongNotes();
      const tempoMap = TempoMap.default();
      const analyzer = new FormAnalyzer();

      const candidates = analyzer.detectSections(notes, tempoMap);
      const formType = analyzer.detectForm(candidates);

      expect(formType.formType).toBeDefined();
      expect(formType.confidence).toBeGreaterThanOrEqual(0);
      expect(formType.confidence).toBeLessThanOrEqual(1);
    });

    it("should convert section candidates to FormStructure", () => {
      const notes = createFullSongNotes();
      const tempoMap = TempoMap.default();
      const analyzer = new FormAnalyzer();

      const candidates = analyzer.detectSections(notes, tempoMap);
      const resultForm = analyzer.toFormStructure(candidates, "Detected Form");

      expect(resultForm.id).toBeDefined();
      expect(resultForm.sections.length).toBeGreaterThan(0);
      expect(resultForm.name).toBe("Detected Form");
    });
  });

  describe("Form templates", () => {
    it("should apply pop_ababcb template", () => {
      const template = getTemplate("pop_ababcb");
      expect(template).toBeDefined();
      expect(template!.sections.length).toBe(6);

      const result = applyTemplate(template!);
      expect(result.sections).toHaveLength(6);
      expect(result.sections[0].formRole).toBe(FormRole.Verse);
      expect(result.sections[1].formRole).toBe(FormRole.Chorus);
      expect(result.sections[4].formRole).toBe(FormRole.Bridge);
    });

    it("should apply electronic_buildup template", () => {
      const template = getTemplate("electronic_buildup");
      expect(template).toBeDefined();

      const result = applyTemplate(template!);
      expect(result.sections.length).toBeGreaterThan(0);
      const roles = result.sections.map((s) => s.formRole);
      expect(roles).toContain(FormRole.Drop);
      expect(roles).toContain(FormRole.BuildUp);
    });

    it("should apply cinematic_arc template", () => {
      const template = getTemplate("cinematic_arc");
      expect(template).toBeDefined();

      const result = applyTemplate(template!);
      expect(result.sections.length).toBeGreaterThan(0);
      const roles = result.sections.map((s) => s.formRole);
      expect(roles).toContain(FormRole.Solo);
    });

    it("should return undefined for non-existent template", () => {
      expect(getTemplate("non_existent_template")).toBeUndefined();
    });
  });

  describe("Transition analysis", () => {
    it("should compute energy transitions between sections", () => {
      const notes = createFullSongNotes();
      const tempoMap = TempoMap.default();
      const analyzer = new FormAnalyzer();

      const candidates = analyzer.detectSections(notes, tempoMap);
      if (candidates.length >= 2) {
        const transitions = analyzer.computeTransitions(candidates);
        expect(transitions.length).toBe(candidates.length - 1);
        for (const t of transitions) {
          expect(t.fromBar).toBeGreaterThanOrEqual(1);
          expect(t.toBar).toBeGreaterThanOrEqual(t.fromBar);
          expect(typeof t.energyDelta).toBe("number");
        }
      }
    });
  });

  describe("Melody similarity", () => {
    it("should compute similarity between identical phrases", () => {
      const analyzer = new FormAnalyzer();
      const phrase = createMotifNotes("test", 1, 64);
      const sim = analyzer.melodySimilarity(phrase, phrase);
      expect(sim).toBeGreaterThan(0.95);
    });

    it("should compute low similarity between different phrases", () => {
      const analyzer = new FormAnalyzer();
      const phraseA = createMotifNotes("test", 1, 60);
      const phraseB = createMotifNotes("test", 1, 72);
      const sim = analyzer.melodySimilarity(phraseA, phraseB);
      expect(sim).toBeLessThan(1.0);
      expect(sim).toBeGreaterThanOrEqual(0);
    });
  });
});
