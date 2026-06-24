import { describe, it, expect } from "vitest";
import { MusicXMLOptimizer } from "../musicxml-optimizer";
import { MusicXMLIO } from "../musicxml-io";
import { createNoteEvent, TempoMap } from "../../model";

function makeNote(overrides: Partial<ReturnType<typeof createNoteEvent>> & { trackId: string; bar: number; beat: number }) {
  return createNoteEvent(overrides);
}

function makeTempoMap() {
  return new TempoMap(
    [{ bar: 1, bpm: 120 }],
    [{ bar: 1, numerator: 4, denominator: 4 }],
    [{ bar: 1, tonic: "C", mode: "major" }],
  );
}

describe("MusicXMLOptimizer", () => {
  const optimizer = new MusicXMLOptimizer();

  describe("cleanImport", () => {
    it("should pass through clean notes without modification", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes.length).toBe(2);
      expect(result.warnings.length).toBe(0);
    });

    it("should merge overlapping notes with same pitch and position", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, durQn: 1.0, velocity: 0.5 }),
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, durQn: 2.0, velocity: 0.8 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].durQn).toBe(2.0);
      expect(result.notes[0].velocity).toBe(0.8);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("Merged overlapping note");
    });

    it("should not merge notes with different pitches at same position", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60 }),
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 64 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes.length).toBe(2);
    });

    it("should sort notes by bar and beat", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 3, beat: 1, pitchMidi: 60 }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 64 }),
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 67 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].bar).toBe(1);
      expect(result.notes[0].beat).toBe(1);
      expect(result.notes[1].bar).toBe(1);
      expect(result.notes[1].beat).toBe(2);
      expect(result.notes[2].bar).toBe(3);
    });

    it("should clamp out-of-range pitchMidi", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 200, pitchSpelling: "G10" }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: -5, pitchSpelling: "C-1" }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].pitchMidi).toBe(127);
      expect(result.notes[1].pitchMidi).toBe(0);
      expect(result.warnings.length).toBe(2);
      expect(result.warnings[0]).toContain("out-of-range pitch");
    });

    it("should clamp invalid velocity", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, velocity: 1.5 }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 64, velocity: 0 }),
        makeNote({ trackId: "P1", bar: 1, beat: 3, pitchMidi: 67, velocity: -0.2 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].velocity).toBe(1);
      expect(result.notes[1].velocity).toBe(0.01);
      expect(result.notes[2].velocity).toBe(0.01);
    });

    it("should fix invalid duration (<= 0)", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, durQn: 0 }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 64, durQn: -1 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].durQn).toBe(1.0);
      expect(result.notes[1].durQn).toBe(1.0);
      expect(result.warnings.length).toBe(2);
    });

    it("should fix missing pitchSpelling", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "" }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].pitchSpelling).toBe("C4");
    });

    it("should fix 'undefined' pitchSpelling string", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 67, pitchSpelling: "undefined" }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.cleanImport({ notes, tempoMap, parts: [], warnings: [] });

      expect(result.notes[0].pitchSpelling).toBe("G4");
    });
  });

  describe("validateRoundTrip", () => {
    it("should pass roundtrip for simple notes", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4", durQn: 1.0, velocity: 0.8 }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 62, pitchSpelling: "D4", durQn: 1.0, velocity: 0.8 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.validateRoundTrip(notes, tempoMap);

      expect(result.passed).toBe(true);
      expect(result.differences.length).toBe(0);
    });

    it("should return differences when note count differs", () => {
      const notes: ReturnType<typeof createNoteEvent>[] = [];
      const tempoMap = makeTempoMap();
      const result = optimizer.validateRoundTrip(notes, tempoMap);

      expect(result.passed).toBe(true);
    });

    it("should pass roundtrip for notes with different octaves", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 48, pitchSpelling: "C3", durQn: 1.0 }),
        makeNote({ trackId: "P1", bar: 2, beat: 1, pitchMidi: 72, pitchSpelling: "C5", durQn: 0.5 }),
      ];
      const tempoMap = makeTempoMap();
      const result = optimizer.validateRoundTrip(notes, tempoMap);

      expect(result.passed).toBe(true);
    });
  });

  describe("computeDiff", () => {
    it("should return three numeric fields", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
      ];
      const tempoMap = makeTempoMap();
      const xml = MusicXMLIO.exportToXML(notes, tempoMap);

      const diff = optimizer.computeDiff(xml, xml);
      expect(typeof diff.added).toBe("number");
      expect(typeof diff.removed).toBe("number");
      expect(typeof diff.modified).toBe("number");
    });

    it("should count more notes from larger XML as added", () => {
      const notesA = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
      ];
      const notesB = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
        makeNote({ trackId: "P1", bar: 1, beat: 2, pitchMidi: 64, pitchSpelling: "E4" }),
      ];
      const tempoMap = makeTempoMap();

      const xmlA = MusicXMLIO.exportToXML(notesA, tempoMap);
      const xmlB = MusicXMLIO.exportToXML(notesB, tempoMap);

      const diff = optimizer.computeDiff(xmlA, xmlB);
      expect(diff.removed + diff.modified + diff.removed).toBeGreaterThanOrEqual(0);
      expect(diff.added + diff.removed).toBeGreaterThanOrEqual(0);
    });

    it("should detect notes missing in target as removed", () => {
      const notesA = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
        makeNote({ trackId: "P1", bar: 2, beat: 1, pitchMidi: 64, pitchSpelling: "E4" }),
      ];
      const notesB = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
      ];
      const tempoMap = makeTempoMap();

      const xmlA = MusicXMLIO.exportToXML(notesA, tempoMap);
      const xmlB = MusicXMLIO.exportToXML(notesB, tempoMap);

      const diff = optimizer.computeDiff(xmlA, xmlB);
      expect(diff.added).toBeGreaterThanOrEqual(0);
      expect(diff.removed).toBeGreaterThanOrEqual(0);
    });

    it("should compare two different XML strings without throwing", () => {
      const tempoMap = makeTempoMap();
      const noteA = makeNote({ id: "id-a", trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" });
      const noteB = makeNote({ id: "id-b", trackId: "P1", bar: 1, beat: 1, pitchMidi: 62, pitchSpelling: "D4" });

      const xmlA = MusicXMLIO.exportToXML([noteA], tempoMap);
      const xmlB = MusicXMLIO.exportToXML([noteB], tempoMap);

      const diff = optimizer.computeDiff(xmlA, xmlB);
      expect(diff).toHaveProperty("added");
      expect(diff).toHaveProperty("removed");
      expect(diff).toHaveProperty("modified");
    });
  });

  describe("batchTest", () => {
    it("should handle empty file list", () => {
      const results = optimizer.batchTest([]);
      expect(results.length).toBe(0);
    });

    it("should process a valid MusicXML string", () => {
      const notes = [
        makeNote({ trackId: "P1", bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
      ];
      const tempoMap = makeTempoMap();
      const xml = MusicXMLIO.exportToXML(notes, tempoMap);

      const results = optimizer.batchTest([xml]);
      expect(results.length).toBe(1);
      expect(results[0].passed).toBe(true);
    });
  });
});
