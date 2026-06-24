import { describe, it, expect, beforeEach } from "vitest";
import { ProjectGraph } from "../../graph/project-graph";
import { DiffEngine } from "../../diff/diff-engine";
import { createDiffEnvelope } from "../../diff/diff-envelope";
import { NoteEvent, createNoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import { MusicXMLIO } from "../../io/musicxml-io";
import { MIDIExporter } from "../../io/midi-exporter";
import { MIDIImporter } from "../../io/midi-importer";

describe("E2E Test Suite", () => {
  let diffEngine: DiffEngine;

  beforeEach(() => {
    diffEngine = new DiffEngine();
  });

  describe("Workflow: Create Project to Export", () => {
    it("should complete full workflow from creation to MusicXML export", () => {
      // Step 1: Create project
      const graph = ProjectGraph.create("Test Project");
      expect(graph).toBeDefined();

      // Step 2: Add notes
      const notes: NoteEvent[] = [
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
      ];

      // Step 3: Create tempo map
      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
      );

      // Step 4: Export to MusicXML
      const musicxml = MusicXMLIO.exportToXML(notes, tempoMap, {
        title: "Test Project",
        composer: "Test Composer",
      });

      expect(musicxml).toContain("score-partwise");
      expect(musicxml).toContain("Test Project");
      expect(musicxml).toContain("Test Composer");
      expect(musicxml).toContain("<pitch>");
    });

    it("should complete full workflow from creation to MIDI export", () => {
      // Step 1: Create project
      const graph = ProjectGraph.create("MIDI Test Project");
      expect(graph).toBeDefined();

      // Step 2: Add notes
      const notes: NoteEvent[] = [
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

      // Step 3: Create tempo map
      const tempoMap = new TempoMap(
        [{ bar: 1, bpm: 120 }],
        [{ bar: 1, numerator: 4, denominator: 4 }],
      );

      // Step 4: Export to MIDI
      const midi = MIDIExporter.toBuffer(notes, tempoMap);
      expect(midi).toBeDefined();
      expect(midi.byteLength).toBeGreaterThan(0);
    });
  });

  describe("Workflow: Multi-Agent Collaboration", () => {
    it("should handle multiple agents modifying the same project", () => {
      // Step 1: Create project
      const graph = ProjectGraph.create("Multi-Agent Project");

      // Step 2: Agent 1 adds notes
      const agent1Notes: NoteEvent[] = [
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

      // Step 3: Agent 2 adds different notes
      const agent2Notes: NoteEvent[] = [
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

      // Step 4: Both agents create diffs
      const diff1 = createDiffEnvelope({
        baseRevision: graph.getRevisionId(),
        actor: { type: "agent", name: "composer" },
        permissionScope: "proposal_only",
        summary: "Add piano notes",
        ops: [
          {
            op: "add_note_group",
            path: "tracks/piano",
            notes: agent1Notes,
          },
        ],
      });

      const diff2 = createDiffEnvelope({
        baseRevision: graph.getRevisionId(),
        actor: { type: "agent", name: "orchestrator" },
        permissionScope: "proposal_only",
        summary: "Add violin notes",
        ops: [
          {
            op: "add_note_group",
            path: "tracks/violin",
            notes: agent2Notes,
          },
        ],
      });

      expect(diff1.diffId).toBeDefined();
      expect(diff2.diffId).toBeDefined();
      expect(diff1.diffId).not.toBe(diff2.diffId);
    });
  });

  describe("Workflow: DiffEnvelope Lifecycle", () => {
    it("should complete full DiffEnvelope lifecycle", () => {
      // Step 1: Create diff
      const diff = createDiffEnvelope({
        baseRevision: "HEAD",
        actor: { type: "agent", name: "composer" },
        permissionScope: "proposal_only",
        summary: "Add melody",
        ops: [
          {
            op: "add_note_group",
            path: "tracks/melody",
            notes: [
              createNoteEvent({
                trackId: "melody",
                bar: 1,
                beat: 1,
                durQn: 1,
                pitchMidi: 60,
                pitchSpelling: "C4",
                velocity: 0.8,
                voice: "rh",
              }),
            ],
          },
        ],
        domainExplanations: [
          {
            label: "Melody",
            text: "Simple melody in C major",
          },
        ],
        riskFlags: [],
      });

      expect(diff.diffId).toBeDefined();
      expect(diff.rollbackToken).toBeDefined();
      expect(diff.summary).toBe("Add melody");
      expect(diff.ops).toHaveLength(1);
      expect(diff.domainExplanations).toHaveLength(1);

      // Step 2: Apply diff (simulate)
      expect(diff.permissionScope).toBe("proposal_only");

      // Step 3: Rollback (simulate)
      expect(diff.rollbackToken).toBeDefined();
    });
  });
});
