import { describe, it, expect } from "vitest";
import {
  createNoteEvent,
  noteEventToNode,
  nodeToNoteEvent,
  noteDurationSeconds,
  noteStartTick,
  midiToSpelling,
  spellingToMidi,
} from "../note-event";

describe("NoteEvent", () => {
  describe("createNoteEvent", () => {
    it("should create a note with required fields", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
      });
      expect(note.id).toBeDefined();
      expect(typeof note.id).toBe("string");
      expect(note.trackId).toBe("track-1");
      expect(note.bar).toBe(1);
      expect(note.beat).toBe(1);
    });

    it("should set defaults for optional fields", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
      });
      expect(note.durQn).toBe(1.0);
      expect(note.pitchMidi).toBe(60);
      expect(note.velocity).toBe(0.8);
      expect(note.voice).toBe("rh");
      expect(note.tags).toEqual([]);
      expect(note.phraseId).toBeNull();
    });

    it("should compute pitchSpelling from pitchMidi", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
        pitchMidi: 60,
      });
      expect(note.pitchSpelling).toBe("C4");
    });

    it("should accept all field overrides", () => {
      const note = createNoteEvent({
        id: "custom-id",
        trackId: "track-1",
        phraseId: "phrase-1",
        bar: 3,
        beat: 2.5,
        durQn: 0.5,
        pitchMidi: 64,
        pitchSpelling: "E4",
        velocity: 1.0,
        voice: "lh",
        tags: ["motif_a"],
      });
      expect(note.id).toBe("custom-id");
      expect(note.phraseId).toBe("phrase-1");
      expect(note.bar).toBe(3);
      expect(note.beat).toBe(2.5);
      expect(note.durQn).toBe(0.5);
      expect(note.pitchMidi).toBe(64);
      expect(note.pitchSpelling).toBe("E4");
      expect(note.velocity).toBe(1.0);
      expect(note.voice).toBe("lh");
      expect(note.tags).toEqual(["motif_a"]);
    });
  });

  describe("noteEventToNode / nodeToNoteEvent", () => {
    it("should roundtrip NoteEvent through NoteSpan node data", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1.5,
        pitchMidi: 72,
        velocity: 0.9,
      });
      const node = noteEventToNode(note);
      expect(node.type).toBe("NoteSpan");
      expect(node.data).toBeDefined();

      const restored = nodeToNoteEvent(node.data);
      expect(restored.id).toBe(note.id);
      expect(restored.trackId).toBe(note.trackId);
      expect(restored.bar).toBe(note.bar);
      expect(restored.beat).toBe(note.beat);
      expect(restored.pitchMidi).toBe(note.pitchMidi);
      expect(restored.velocity).toBe(note.velocity);
    });
  });

  describe("midiToSpelling", () => {
    it("should convert MIDI 60 to C4", () => {
      expect(midiToSpelling(60)).toBe("C4");
    });

    it("should convert MIDI 69 to A4", () => {
      expect(midiToSpelling(69)).toBe("A4");
    });

    it("should convert MIDI 0 to C-1", () => {
      expect(midiToSpelling(0)).toBe("C-1");
    });

    it("should convert MIDI 127 to G9", () => {
      expect(midiToSpelling(127)).toBe("G9");
    });

    it("should handle sharp notes", () => {
      expect(midiToSpelling(61)).toBe("C#4");
      expect(midiToSpelling(66)).toBe("F#4");
    });

    it("should support preferFlat option", () => {
      expect(midiToSpelling(61, true)).toBe("Db4");
      expect(midiToSpelling(66, true)).toBe("Gb4");
    });
  });

  describe("spellingToMidi", () => {
    it("should convert C4 to 60", () => {
      expect(spellingToMidi("C4")).toBe(60);
    });

    it("should convert A4 to 69", () => {
      expect(spellingToMidi("A4")).toBe(69);
    });

    it("should handle sharps", () => {
      expect(spellingToMidi("F#4")).toBe(66);
      expect(spellingToMidi("C#4")).toBe(61);
    });

    it("should handle flats", () => {
      expect(spellingToMidi("Eb4")).toBe(63);
      expect(spellingToMidi("Bb3")).toBe(58);
    });

    it("should handle negative octaves", () => {
      expect(spellingToMidi("C-1")).toBe(0);
    });

    it("should throw for invalid spelling", () => {
      expect(() => spellingToMidi("H4")).toThrow();
      expect(() => spellingToMidi("")).toThrow();
    });
  });

  describe("noteDurationSeconds", () => {
    it("should compute quarter note duration at 120bpm", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
        durQn: 1.0,
      });
      expect(noteDurationSeconds(note, 120)).toBe(0.5);
    });

    it("should compute half note duration at 60bpm", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
        durQn: 2.0,
      });
      expect(noteDurationSeconds(note, 60)).toBe(2.0);
    });

    it("should compute eighth note duration at 120bpm", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
        durQn: 0.5,
      });
      expect(noteDurationSeconds(note, 120)).toBe(0.25);
    });
  });

  describe("noteStartTick", () => {
    it("should compute tick at bar 1 beat 1", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 1,
      });
      expect(noteStartTick(note, 480)).toBe(0);
    });

    it("should compute tick at bar 1 beat 2", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 1,
        beat: 2,
      });
      expect(noteStartTick(note, 480)).toBe(480);
    });

    it("should compute tick at bar 2 beat 1", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 2,
        beat: 1,
      });
      expect(noteStartTick(note, 480)).toBe(1920);
    });

    it("should compute tick at bar 2 beat 3.5 with 960 PPQ", () => {
      const note = createNoteEvent({
        trackId: "track-1",
        bar: 2,
        beat: 3.5,
      });
      expect(noteStartTick(note, 960)).toBe(6240);
    });
  });
});
