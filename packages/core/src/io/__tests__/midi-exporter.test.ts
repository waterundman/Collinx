import { describe, it, expect } from "vitest";
import { MIDIExporter } from "../midi-exporter";
import { MIDIImporter } from "../midi-importer";
import { createNoteEvent, TempoMap } from "../../model";

describe("MIDIExporter", () => {
  describe("toBuffer", () => {
    it("should export empty notes list", () => {
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer([], tempoMap);
      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it("should export single note", () => {
      const notes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(notes, tempoMap);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it("should round-trip single note", () => {
      const originalNotes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          velocity: 0.8,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(originalNotes, tempoMap);

      const imported = MIDIImporter.fromBuffer(buffer);
      expect(imported.notes.length).toBe(1);
      expect(imported.notes[0].pitchMidi).toBe(60);
      expect(imported.notes[0].bar).toBe(1);
    });

    it("should round-trip multiple notes", () => {
      const originalNotes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 2,
          durQn: 0.5,
          pitchMidi: 64,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 2,
          beat: 1,
          durQn: 2,
          pitchMidi: 67,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(originalNotes, tempoMap);

      const imported = MIDIImporter.fromBuffer(buffer);
      expect(imported.notes.length).toBe(3);

      const pitches = imported.notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
      expect(pitches).toEqual([60, 64, 67]);
    });

    it("should round-trip with tempo map changes", () => {
      const notes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 3,
          beat: 1,
          durQn: 1,
          pitchMidi: 67,
        }),
      ];
      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }, { bar: 3, bpm: 80 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
        [{ bar: 1, tonic: "C", mode: "major" }]
      );

      const buffer = MIDIExporter.toBuffer(notes, tempoMap);
      const imported = MIDIImporter.fromBuffer(buffer);

      expect(imported.notes.length).toBe(2);
    });

    it("should round-trip preserve pitch MIDI values", () => {
      const notes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 0.5,
          pitchMidi: 72,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1.5,
          durQn: 0.5,
          pitchMidi: 74,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(notes, tempoMap);

      const imported = MIDIImporter.fromBuffer(buffer);

      expect(imported.notes.length).toBe(2);
      const importedPitches = imported.notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
      expect(importedPitches).toEqual([72, 74]);
    });

    it("should use custom ticksPerQuarter", () => {
      const notes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(notes, tempoMap, { ticksPerQuarter: 960 });

      const imported = MIDIImporter.fromBuffer(buffer);
      expect(imported.notes.length).toBe(1);
    });

    it("should export chord (simultaneous notes)", () => {
      const notes = [
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 2,
          pitchMidi: 60,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 2,
          pitchMidi: 64,
        }),
        createNoteEvent({
          trackId: "track-0",
          bar: 1,
          beat: 1,
          durQn: 2,
          pitchMidi: 67,
        }),
      ];
      const tempoMap = TempoMap.default();
      const buffer = MIDIExporter.toBuffer(notes, tempoMap);

      const imported = MIDIImporter.fromBuffer(buffer);
      expect(imported.notes.length).toBe(3);

      const pitches = imported.notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
      expect(pitches).toEqual([60, 64, 67]);
    });
  });
});
