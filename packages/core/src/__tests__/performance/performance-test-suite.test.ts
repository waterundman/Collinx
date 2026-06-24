import { describe, it, expect, beforeEach } from "vitest";
import { ProjectGraph } from "../../graph/project-graph";
import { DiffEngine } from "../../diff/diff-engine";
import { createDiffEnvelope } from "../../diff/diff-envelope";
import { NoteEvent, createNoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import { MusicXMLIO } from "../../io/musicxml-io";
import { MIDIExporter } from "../../io/midi-exporter";
import { MIDIImporter } from "../../io/midi-importer";

describe("Performance Test Suite", () => {
  let diffEngine: DiffEngine;

  beforeEach(() => {
    diffEngine = new DiffEngine();
  });

  describe("Response Time Tests", () => {
    it("should measure ProjectGraph creation time", () => {
      const startTime = performance.now();
      for (let i = 0; i < 1000; i++) {
        ProjectGraph.create(`Project ${i}`);
      }
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it("should measure DiffEngine apply time", () => {
      const graph = ProjectGraph.create("Performance Test");
      const notes = Array.from({ length: 100 }, (_, i) =>
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: i + 1,
          durQn: 1,
          pitchMidi: 60 + (i % 12),
          pitchSpelling: "C4",
          velocity: 0.8,
          voice: "rh",
        }),
      );

      const diff = createDiffEnvelope({
        baseRevision: graph.getRevisionId(),
        actor: { type: "agent", name: "composer" },
        permissionScope: "proposal_only",
        summary: "Add many notes",
        ops: [
          {
            op: "add_note_group",
            path: "tracks/piano",
            notes,
          },
        ],
      });

      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        diffEngine.apply(diff, graph);
      }
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });

  describe("Memory Usage Tests", () => {
    it("should measure memory usage for large graphs", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      const graph = ProjectGraph.create("Memory Test");
      for (let i = 0; i < 10000; i++) {
        graph.addNode("NoteSpan", {
          id: `note-${i}`,
          pitchMidi: 60 + (i % 12),
          bar: Math.floor(i / 4) + 1,
          beat: (i % 4) + 1,
        });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 100MB)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });
  });

  describe("Throughput Tests", () => {
    it("should measure MusicXML export throughput", () => {
      const notes = Array.from({ length: 1000 }, (_, i) =>
        createNoteEvent({
          trackId: "piano",
          bar: Math.floor(i / 4) + 1,
          beat: (i % 4) + 1,
          durQn: 1,
          pitchMidi: 60 + (i % 12),
          pitchSpelling: "C4",
          velocity: 0.8,
          voice: "rh",
        }),
      );

      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
      );

      const startTime = performance.now();
      const musicxml = MusicXMLIO.exportToXML(notes, tempoMap, {
        title: "Throughput Test",
        composer: "Test",
      });
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(musicxml).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it("should measure MIDI export throughput", () => {
      const notes = Array.from({ length: 1000 }, (_, i) =>
        createNoteEvent({
          trackId: "piano",
          bar: Math.floor(i / 4) + 1,
          beat: (i % 4) + 1,
          durQn: 1,
          pitchMidi: 60 + (i % 12),
          pitchSpelling: "C4",
          velocity: 0.8,
          voice: "rh",
        }),
      );

      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
      );

      const startTime = performance.now();
      const midi = MIDIExporter.toBuffer(notes, tempoMap);
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(midi).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });

  describe("Error Rate Tests", () => {
    it("should handle edge cases without errors", () => {
      // Test with empty notes
      const emptyNotes: NoteEvent[] = [];
      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
      );

      expect(() => {
        MusicXMLIO.exportToXML(emptyNotes, tempoMap);
      }).not.toThrow();

      expect(() => {
        MIDIExporter.toBuffer(emptyNotes, tempoMap);
      }).not.toThrow();
    });

    it("should handle invalid data gracefully", () => {
      const graph = ProjectGraph.create("Error Test");

      // Test with invalid node data
      expect(() => {
        graph.addNode("NoteSpan", {});
      }).not.toThrow();
    });
  });
});
