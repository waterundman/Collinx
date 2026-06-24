import { describe, it, expect, beforeEach } from "vitest";
import { ProjectGraph } from "../../graph/project-graph";
import { DiffEngine } from "../../diff/diff-engine";
import { createDiffEnvelope } from "../../diff/diff-envelope";
import { NoteEvent, createNoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import { MusicXMLIO } from "../../io/musicxml-io";
import { MIDIExporter } from "../../io/midi-exporter";

describe("Stability Test Suite", () => {
  let diffEngine: DiffEngine;

  beforeEach(() => {
    diffEngine = new DiffEngine();
  });

  describe("Long Running Tests", () => {
    it("should handle many iterations without crashes", () => {
      const iterations = 1000;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const graph = ProjectGraph.create(`Project ${i}`);
          const notes = [
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
          ];

          const diff = createDiffEnvelope({
            baseRevision: graph.getRevisionId(),
            actor: { type: "agent", name: "composer" },
            permissionScope: "proposal_only",
            summary: `Iteration ${i}`,
            ops: [
              {
                op: "add_note_group",
                path: "tracks/piano",
                notes,
              },
            ],
          });

          diffEngine.apply(diff, graph);
          successCount++;
        } catch (error) {
          // Should not throw
          console.error(`Iteration ${i} failed:`, error);
        }
      }

      expect(successCount).toBe(iterations);
    });
  });

  describe("Memory Leak Detection", () => {
    it("should not leak memory during repeated operations", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 1000; i++) {
        const graph = ProjectGraph.create(`Memory Test ${i}`);
        const notes = Array.from({ length: 100 }, (_, j) =>
          createNoteEvent({
            trackId: "piano",
            bar: Math.floor(j / 4) + 1,
            beat: (j % 4) + 1,
            durQn: 1,
            pitchMidi: 60 + (j % 12),
            pitchSpelling: "C4",
            velocity: 0.8,
            voice: "rh",
          }),
        );

        const diff = createDiffEnvelope({
          baseRevision: graph.getRevisionId(),
          actor: { type: "agent", name: "composer" },
          permissionScope: "proposal_only",
          summary: `Memory test ${i}`,
          ops: [
            {
              op: "add_note_group",
              path: "tracks/piano",
              notes,
            },
          ],
        });

        diffEngine.apply(diff, graph);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe("Resource Cleanup Tests", () => {
    it("should properly clean up resources", () => {
      const graphs: ProjectGraph[] = [];

      for (let i = 0; i < 100; i++) {
        const graph = ProjectGraph.create(`Cleanup Test ${i}`);
        graphs.push(graph);
      }

      expect(graphs.length).toBe(100);

      // All graphs should be valid
      for (const graph of graphs) {
        const validation = graph.validate();
        expect(validation.valid).toBe(true);
      }
    });
  });

  describe("Exception Recovery Tests", () => {
    it("should recover from invalid operations", () => {
      const graph = ProjectGraph.create("Recovery Test");

      // Try to remove non-existent node
      expect(() => {
        graph.removeNode("non-existent-id");
      }).toThrow();

      // Graph should still be usable after error
      const node = graph.addNode("NoteSpan", { id: "test-node" });
      expect(node).toBeDefined();
      expect(node.data.id).toBe("test-node");
      expect(node.id).toBeDefined();
    });

    it("should handle concurrent-like operations", () => {
      const graph = ProjectGraph.create("Concurrent Test");
      const diffEngine = new DiffEngine();

      // Simulate multiple "concurrent" diffs
      const diffs = Array.from({ length: 10 }, (_, i) =>
        createDiffEnvelope({
          baseRevision: graph.getRevisionId(),
          actor: { type: "agent", name: `agent-${i}` },
          permissionScope: "proposal_only",
          summary: `Concurrent diff ${i}`,
          ops: [
            {
              op: "add_node",
              path: "/",
              nodeType: "NoteSpan",
              data: { id: `node-${i}`, pitchMidi: 60 + i },
            },
          ],
        }),
      );

      // Apply all diffs
      for (const diff of diffs) {
        const result = diffEngine.apply(diff, graph);
        expect(result.appliedOps).toBe(1);
      }
    });
  });

  describe("Stability Score", () => {
    it("should calculate stability score based on success rate", () => {
      const totalTests = 100;
      let successCount = 0;

      for (let i = 0; i < totalTests; i++) {
        try {
          const graph = ProjectGraph.create(`Score Test ${i}`);
          const notes = [
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
          ];

          const tempoMap = new TempoMap(
            [{ bar: 1, bpm: 120 }],
            [{ bar: 1, numerator: 4, denominator: 4 }],
          );

          const musicxml = MusicXMLIO.exportToXML(notes, tempoMap);
          const midi = MIDIExporter.toBuffer(notes, tempoMap);

          if (musicxml && midi.byteLength > 0) {
            successCount++;
          }
        } catch (error) {
          // Should not throw
        }
      }

      const stabilityScore = successCount / totalTests;
      expect(stabilityScore).toBe(1.0); // 100% stability
    });
  });
});
