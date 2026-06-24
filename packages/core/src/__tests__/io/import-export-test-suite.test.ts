import { describe, it, expect, beforeEach } from "vitest";
import { MusicXMLIO } from "../../io/musicxml-io";
import { MIDIExporter } from "../../io/midi-exporter";
import { MIDIImporter } from "../../io/midi-importer";
import { NoteEvent, createNoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";

describe("Import/Export Test Suite", () => {
  let sampleNotes: NoteEvent[];
  let sampleTempoMap: TempoMap;

  beforeEach(() => {
    sampleNotes = [
      createNoteEvent({
        trackId: "piano",
        bar: 1,
        beat: 1,
        durQn: 1,
        pitchMidi: 60,
        pitchSpelling: "C4",
        velocity: 0.8,
        voice: "rh",
      }),
      createNoteEvent({
        trackId: "piano",
        bar: 1,
        beat: 2,
        durQn: 1,
        pitchMidi: 64,
        pitchSpelling: "E4",
        velocity: 0.8,
        voice: "rh",
      }),
      createNoteEvent({
        trackId: "piano",
        bar: 1,
        beat: 3,
        durQn: 1,
        pitchMidi: 67,
        pitchSpelling: "G4",
        velocity: 0.8,
        voice: "rh",
      }),
    ];

    sampleTempoMap = new TempoMap(
      [{ bar: 1, bpm: 120 }],
      [{ bar: 1, numerator: 4, denominator: 4 }],
    );
  });

  describe("MIDI Round-trip Test", () => {
    it("should export and import MIDI with data integrity", () => {
      // Step 1: Export to MIDI
      const midiBuffer = MIDIExporter.toBuffer(sampleNotes, sampleTempoMap);
      expect(midiBuffer).toBeDefined();
      expect(midiBuffer.byteLength).toBeGreaterThan(0);

      // Step 2: Import from MIDI
      const imported = MIDIImporter.fromBuffer(midiBuffer);
      expect(imported.notes).toBeDefined();
      expect(imported.notes.length).toBeGreaterThan(0);

      // Step 3: Verify data integrity
      expect(imported.notes.length).toBe(sampleNotes.length);
      for (let i = 0; i < sampleNotes.length; i++) {
        expect(imported.notes[i].pitchMidi).toBe(sampleNotes[i].pitchMidi);
        // Note: trackId is auto-generated during MIDI import, so we don't check it
      }
    });
  });

  describe("MusicXML Round-trip Test", () => {
    it("should export and import MusicXML with data integrity", () => {
      // Step 1: Export to MusicXML
      const musicxml = MusicXMLIO.exportToXML(sampleNotes, sampleTempoMap, {
        title: "Round-trip Test",
        composer: "Test",
      });
      expect(musicxml).toContain("score-partwise");
      expect(musicxml).toContain("<pitch>");

      // Step 2: Import from MusicXML
      const imported = MusicXMLIO.importFromXML(musicxml);
      expect(imported.notes).toBeDefined();
      expect(imported.notes.length).toBeGreaterThan(0);

      // Step 3: Verify data integrity
      expect(imported.notes.length).toBe(sampleNotes.length);
      for (let i = 0; i < sampleNotes.length; i++) {
        expect(imported.notes[i].pitchMidi).toBe(sampleNotes[i].pitchMidi);
      }
    });
  });

  describe("Compatibility Test", () => {
    it("should handle empty notes gracefully", () => {
      const emptyNotes: NoteEvent[] = [];
      const musicxml = MusicXMLIO.exportToXML(emptyNotes, sampleTempoMap);
      expect(musicxml).toContain("score-partwise");

      const imported = MusicXMLIO.importFromXML(musicxml);
      expect(imported.notes).toHaveLength(0);
    });

    it("should handle multiple tracks", () => {
      const multiTrackNotes = [
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          pitchSpelling: "C4",
          velocity: 0.8,
          voice: "rh",
        }),
        createNoteEvent({
          trackId: "violin",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 72,
          pitchSpelling: "C5",
          velocity: 0.7,
          voice: "rh",
        }),
      ];

      const musicxml = MusicXMLIO.exportToXML(multiTrackNotes, sampleTempoMap);
      expect(musicxml).toContain("piano");
      expect(musicxml).toContain("violin");

      const imported = MusicXMLIO.importFromXML(musicxml);
      expect(imported.notes.length).toBe(2);
    });

    it("should handle different note durations", () => {
      const durationNotes = [
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: 1,
          durQn: 0.25,
          pitchMidi: 60,
          pitchSpelling: "C4",
          velocity: 0.8,
          voice: "rh",
        }),
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: 1.25,
          durQn: 0.5,
          pitchMidi: 64,
          pitchSpelling: "E4",
          velocity: 0.8,
          voice: "rh",
        }),
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: 1.75,
          durQn: 1,
          pitchMidi: 67,
          pitchSpelling: "G4",
          velocity: 0.8,
          voice: "rh",
        }),
      ];

      const musicxml = MusicXMLIO.exportToXML(durationNotes, sampleTempoMap);
      const imported = MusicXMLIO.importFromXML(musicxml);
      expect(imported.notes.length).toBe(3);
    });
  });
});
