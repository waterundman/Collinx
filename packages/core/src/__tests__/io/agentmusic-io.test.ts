import { describe, it, expect } from "vitest";
import { AgentMusicIO, type AgentMusicData } from "../../io/agentmusic-io";
import { ProjectGraph } from "../../graph/project-graph";
import { serializeGraph } from "../../graph/serialization";
import { createNoteEvent } from "../../model/note-event";
import { createMotif } from "../../model/motif";
import { TasteGenome } from "../../taste/taste-genome";

function createEmptyProjectData(): AgentMusicData {
  const graph = ProjectGraph.create("Test Project", 120);
  const io = new AgentMusicIO();
  const graphData = graph.toJSON();

  return {
    manifest: io.createManifest({ graph: graphData }),
    graph: graphData,
    revisions: [],
    notes: [],
  };
}

function createProjectWithNotes(): AgentMusicData {
  const graph = ProjectGraph.create("Notes Project", 140);
  const io = new AgentMusicIO();
  const graphData = graph.toJSON();

  const notes = [
    createNoteEvent({ trackId: "piano", bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
    createNoteEvent({ trackId: "piano", bar: 1, beat: 2, pitchMidi: 64, durQn: 1 }),
    createNoteEvent({ trackId: "piano", bar: 1, beat: 3, pitchMidi: 67, durQn: 1 }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, pitchMidi: 36, durQn: 2 }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 3, pitchMidi: 40, durQn: 2 }),
  ];

  return {
    manifest: io.createManifest({ graph: graphData, notes }),
    graph: graphData,
    revisions: [],
    notes,
    harmony: [
      { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4, romanNumeral: "I" },
    ],
    motifs: [
      createMotif({ name: "main-theme", bars: 1, instrumentRole: "melody", noteIds: [notes[0].id] }),
    ],
  };
}

function createProjectWithTasteGenome(): AgentMusicData {
  const graph = ProjectGraph.create("Taste Project", 120);
  const io = new AgentMusicIO();
  const graphData = graph.toJSON();

  const genome = TasteGenome.createDefault();
    genome.setParameter("harmony.chromatic_color", {
      value: "0.45",
      distribution: { family: "beta", alpha: "6", beta: "8" },
      confidence: "0.60",
      context: { task: "test" },
      evidence: [],
      timeDecay: { policy: "slow_exp", lambda: "0.001" },
      lastUpdatedAt: new Date().toISOString(),
    });

  const versionEntry = {
    version: 1,
    genomeJson: genome.toJSON(),
    timestamp: new Date().toISOString(),
    message: "v1",
  };

  return {
    manifest: io.createManifest({ graph: graphData }),
    graph: graphData,
    revisions: [],
    notes: [],
    tasteGenome: genome.toJSON(),
    tasteVersions: [versionEntry],
  };
}

function createProjectWithRevisions(): AgentMusicData {
  const graph = ProjectGraph.create("Revision Project", 120);
  const graphData = graph.toJSON();

  const serialized = serializeGraph(graph);
  const revisions = [serialized];

  const io = new AgentMusicIO();

  const diffEntry = {
    diffId: "diff-001",
    baseRevision: graphData.revision_id,
    newRevision: graphData.revision_id,
    actor: { type: "agent" as const, name: "test-agent" },
    summary: "Initial composition",
    opsCount: 1,
    appliedAt: new Date().toISOString(),
    status: "applied" as const,
    rollbackToken: "token-001",
  };

  return {
    manifest: io.createManifest({ graph: graphData }),
    graph: graphData,
    revisions,
    notes: [],
    diffLog: [diffEntry],
  };
}

describe("AgentMusicIO", () => {
  const io = new AgentMusicIO();

  describe("save and load", () => {
    it("should save empty project and load with correct structure", async () => {
      const data = createEmptyProjectData();
      const buffer = await io.save(data);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);

      const loaded = await io.load(buffer);
      expect(loaded.manifest).toBeDefined();
      expect(loaded.manifest.title).toBe("Test Project");
      expect(loaded.manifest.version).toBe("1.1.0");
      expect(loaded.graph).toBeDefined();
      expect(loaded.graph.meta.title).toBe("Test Project");
      expect(loaded.notes).toEqual([]);
    });

    it("should preserve notes through round-trip", async () => {
      const data = createProjectWithNotes();
      const buffer = await io.save(data);
      const loaded = await io.load(buffer);

      expect(loaded.notes.length).toBe(5);
      expect(loaded.notes[0].trackId).toBe("piano");
      expect(loaded.notes[0].pitchMidi).toBe(60);
      expect(loaded.notes[0].bar).toBe(1);
      expect(loaded.notes[0].beat).toBe(1);
      expect(loaded.notes[3].trackId).toBe("bass");
      expect(loaded.notes[3].pitchMidi).toBe(36);
    });

    it("should preserve taste genome through round-trip", async () => {
      const data = createProjectWithTasteGenome();
      const buffer = await io.save(data);
      const loaded = await io.load(buffer);

      expect(loaded.tasteGenome).toBeDefined();
      expect(loaded.tasteGenome!.genomeId).toBe(data.tasteGenome!.genomeId);
      expect(loaded.tasteGenome!.domains["harmony.chromatic_color"].value).toBe("0.45");
      expect(loaded.tasteVersions).toBeDefined();
      expect(loaded.tasteVersions!.length).toBe(1);
      expect(loaded.tasteVersions![0].version).toBe(1);
    });

    it("should preserve revisions and diff log through round-trip", async () => {
      const data = createProjectWithRevisions();
      const buffer = await io.save(data);
      const loaded = await io.load(buffer);

      expect(loaded.revisions.length).toBe(1);
      expect(typeof loaded.revisions[0]).toBe("string");
      expect(loaded.revisions[0]).toContain("Revision Project");

      expect(loaded.diffLog).toBeDefined();
      expect(loaded.diffLog!.length).toBe(1);
      expect(loaded.diffLog![0].diffId).toBe("diff-001");
      expect(loaded.diffLog![0].status).toBe("applied");
    });

    it("should preserve harmony and motifs through round-trip", async () => {
      const data = createProjectWithNotes();
      const buffer = await io.save(data);
      const loaded = await io.load(buffer);

      expect(loaded.harmony).toBeDefined();
      expect(loaded.harmony!.length).toBe(1);
      expect(loaded.harmony![0].chord.root).toBe("C");
      expect(loaded.harmony![0].romanNumeral).toBe("I");

      expect(loaded.motifs).toBeDefined();
      expect(loaded.motifs!.length).toBe(1);
      expect(loaded.motifs![0].name).toBe("main-theme");
      expect(loaded.motifs![0].bars).toBe(1);
    });

    it("should perform full round-trip with all fields", async () => {
      const graph = ProjectGraph.create("Full Project", 160);
      const graphData = graph.toJSON();
      const notes = [
        createNoteEvent({ trackId: "v1", bar: 1, beat: 1, pitchMidi: 72 }),
        createNoteEvent({ trackId: "v1", bar: 2, beat: 1, pitchMidi: 74 }),
      ];
      const genome = TasteGenome.createDefault();

      const fullData: AgentMusicData = {
        manifest: {
          version: "1.1.0",
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-06-13T00:00:00.000Z",
          title: "Full Project",
          bpm: 160,
          keySignature: "C major",
          timeSignature: "4/4",
          totalBars: 2,
          trackCount: 1,
        },
        graph: graphData,
        revisions: [serializeGraph(graph)],
        notes,
        harmony: [{ bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 }],
        form: { sections: [{ name: "A", startBar: 1, endBar: 8 }] },
        motifs: [createMotif({ name: "hook", bars: 2 })],
        tempoCurves: { changes: [{ bar: 1, bpm: 160 }] },
        routing: {
          tracks: [],
          masterTrack: {
            id: "master",
            name: "Master",
            sourceTrackId: "",
            busType: "master",
            gainDb: "0",
            pan: "0",
            mute: false,
            solo: false,
            fxChain: { id: "fx-master", name: "Master FX", slots: [] },
            sends: [],
            meterLevel: "0",
          },
          routingMatrix: {},
        },
        tasteGenome: genome.toJSON(),
        tasteVersions: [
          { version: 1, genomeJson: genome.toJSON(), timestamp: "2026-01-01T00:00:00.000Z", message: "v1" },
        ],
        diffLog: [
          {
            diffId: "d1",
            baseRevision: graphData.revision_id,
            newRevision: graphData.revision_id,
            actor: { type: "agent", name: "composer" },
            summary: "added notes",
            opsCount: 2,
            appliedAt: "2026-06-13T00:00:00.000Z",
            status: "applied",
            rollbackToken: "rb-1",
          },
        ],
      };

      const buffer = await io.save(fullData);
      const loaded = await io.load(buffer);

      expect(loaded.manifest.title).toBe("Full Project");
      expect(loaded.manifest.bpm).toBe(160);
      expect(loaded.graph.meta.title).toBe("Full Project");
      expect(loaded.revisions.length).toBe(1);
      expect(loaded.notes.length).toBe(2);
      expect(loaded.notes[1].pitchMidi).toBe(74);
      expect(loaded.harmony!.length).toBe(1);
      expect(loaded.form).toEqual({ sections: [{ name: "A", startBar: 1, endBar: 8 }] });
      expect(loaded.motifs!.length).toBe(1);
      expect(loaded.tempoCurves).toEqual({ changes: [{ bar: 1, bpm: 160 }] });
      expect(loaded.routing!.masterTrack.name).toBe("Master");
      expect(loaded.tasteGenome).toBeDefined();
      expect(loaded.tasteVersions!.length).toBe(1);
      expect(loaded.diffLog!.length).toBe(1);
    });
  });

  describe("createManifest", () => {
    it("should derive manifest from graph meta", () => {
      const graph = ProjectGraph.create("My Song", 140);
      const graphData = graph.toJSON();

      const manifest = io.createManifest({
        graph: graphData,
        notes: [
          createNoteEvent({ trackId: "piano", bar: 1, beat: 1, pitchMidi: 60 }),
          createNoteEvent({ trackId: "piano", bar: 2, beat: 1, pitchMidi: 62 }),
          createNoteEvent({ trackId: "bass", bar: 1, beat: 1, pitchMidi: 36 }),
        ],
      });

      expect(manifest.title).toBe("My Song");
      expect(manifest.bpm).toBe(140);
      expect(manifest.keySignature).toBe("C major");
      expect(manifest.timeSignature).toBe("4/4");
      expect(manifest.totalBars).toBe(2);
      expect(manifest.trackCount).toBe(2);
      expect(manifest.version).toBe("1.1.0");
    });

    it("should handle empty data with defaults", () => {
      const manifest = io.createManifest({});
      expect(manifest.title).toBe("Untitled");
      expect(manifest.bpm).toBe(120);
      expect(manifest.keySignature).toBe("C major");
      expect(manifest.timeSignature).toBe("4/4");
    });
  });

  describe("error handling", () => {
    it("should throw on invalid buffer", async () => {
      const badBuffer = new Uint8Array([1, 2, 3]);
      await expect(io.load(badBuffer)).rejects.toThrow();
    });
  });
});
