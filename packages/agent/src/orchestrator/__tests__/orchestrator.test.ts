import { describe, it, expect } from "vitest";
import { Orchestrator } from "../orchestrator";
import type { OrchestratorConfig } from "../orchestrator";
import type { NoteEvent, HarmonyEntry } from "@collinx/core";

function makeNote(
  overrides: Partial<NoteEvent> & { bar: number; beat: number },
): NoteEvent {
  return {
    id: `n-${overrides.bar}-${overrides.beat}`,
    trackId: "t1",
    phraseId: null,
    bar: overrides.bar,
    beat: overrides.beat,
    durQn: overrides.durQn ?? 1,
    pitchMidi: overrides.pitchMidi ?? 60,
    pitchSpelling: overrides.pitchSpelling ?? "C4",
    velocity: overrides.velocity ?? 0.8,
    voice: "rh",
    tags: [],
  };
}

function makeHarmony(): HarmonyEntry[] {
  return [
    { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
    { bar: 2, beat: 1, chord: { root: "F", quality: "maj" }, durationQn: 4 },
    { bar: 3, beat: 1, chord: { root: "G", quality: "dom7" }, durationQn: 4 },
    { bar: 4, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
  ];
}

describe("Orchestrator", () => {
  const orchestrator = new Orchestrator();

  describe("orchestrate()", () => {
    it("should produce orchestration for string trio", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 72, pitchSpelling: "C5" }),
        makeNote({ bar: 1, beat: 2, pitchMidi: 74, pitchSpelling: "D5" }),
      ];
      const harmony = makeHarmony();
      const config: OrchestratorConfig = {
        players: ["violin", "viola", "cello"],
        playabilityPolicy: "moderate",
        style: "classical",
      };
      const result = orchestrator.orchestrate(notes, harmony, config);

      expect(result.voicingPlan).toBeDefined();
      expect(result.voicingPlan.chords.length).toBeGreaterThan(0);
      expect(result.perPlayerNotes.size).toBe(3);
      expect(result.conflicts).toBeDefined();
      expect(result.diffs.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should produce diffs with valid DiffEnvelope structure", () => {
      const notes = [makeNote({ bar: 1, beat: 1 })];
      const harmony = makeHarmony();
      const config: OrchestratorConfig = {
        players: ["violin", "viola", "cello"],
        playabilityPolicy: "moderate",
      };
      const result = orchestrator.orchestrate(notes, harmony, config);

      for (const diff of result.diffs) {
        expect(diff.diffId).toBeTruthy();
        expect(diff.baseRevision).toBeTruthy();
        expect(diff.actor.type).toBe("agent");
        expect(diff.actor.name).toBe("orchestrator");
        expect(diff.permissionScope).toBe("proposal_only");
        expect(diff.summary).toBeTruthy();
        expect(diff.ops.length).toBeGreaterThan(0);
        expect(diff.rollbackToken).toBeTruthy();
      }
    });

    it("should work with larger ensembles", () => {
      const notes = [makeNote({ bar: 1, beat: 1, pitchMidi: 72 })];
      const harmony = makeHarmony();
      const config: OrchestratorConfig = {
        players: ["violin", "viola", "cello", "double_bass"],
        playabilityPolicy: "moderate",
      };
      const result = orchestrator.orchestrate(notes, harmony, config);

      expect(result.perPlayerNotes.size).toBe(4);
    });
  });

  describe("voicingPlan()", () => {
    it("should generate voicing plan with default harmony", () => {
      const config: OrchestratorConfig = {
        players: ["piano", "cello"],
        playabilityPolicy: "moderate",
      };
      const result = orchestrator.voicingPlan("phrase1", ["piano", "cello"], config);

      expect(result.voicingPlan).toBeDefined();
      expect(result.perPlayerNotes.size).toBe(2);
      expect(result.diffs.length).toBeGreaterThan(0);
    });
  });

  describe("checkPlayability()", () => {
    it("should return playable for notes within range", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 60, pitchSpelling: "C4" }),
      ];
      const violin = {
        id: "violin", name: "Violin", family: "strings" as const,
        range: { minMidi: 55, maxMidi: 103, comfortableLow: 60, comfortableHigh: 91 },
        transposition: 0, clef: "treble" as const,
        techniques: [], isPolyphonic: true,
        defaultVelocity: 0.7,
      };
      const result = orchestrator.checkPlayability(notes, violin);
      expect(result.playable).toBe(true);
    });

    it("should detect out-of-range notes", () => {
      const notes = [
        makeNote({ bar: 1, beat: 1, pitchMidi: 20, pitchSpelling: "E0" }),
      ];
      const violin = {
        id: "violin", name: "Violin", family: "strings" as const,
        range: { minMidi: 55, maxMidi: 103, comfortableLow: 60, comfortableHigh: 91 },
        transposition: 0, clef: "treble" as const,
        techniques: [], isPolyphonic: true,
        defaultVelocity: 0.7,
      };
      const result = orchestrator.checkPlayability(notes, violin);
      expect(result.playable).toBe(false);
      expect(result.issues.length).toBe(1);
    });
  });

  describe("toDiff()", () => {
    it("should produce one diff per player with notes", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("violin", [makeNote({ bar: 1, beat: 1 })]);
      perPlayerNotes.set("cello", [makeNote({ bar: 1, beat: 1, pitchMidi: 36 })]);

      const diffs = orchestrator.toDiff(perPlayerNotes, ["violin", "cello"], "HEAD");
      expect(diffs).toHaveLength(2);

      for (const diff of diffs) {
        expect(diff.ops[0].op).toBe("add_note_group");
      }
    });

    it("should skip players with no notes", () => {
      const perPlayerNotes = new Map<string, NoteEvent[]>();
      perPlayerNotes.set("violin", [makeNote({ bar: 1, beat: 1 })]);
      perPlayerNotes.set("cello", []);

      const diffs = orchestrator.toDiff(perPlayerNotes, ["violin", "cello"], "HEAD");
      expect(diffs).toHaveLength(1);
    });
  });

  describe("suggestInstrumentation()", () => {
    it("should suggest string quartet for classical small", () => {
      const result = orchestrator.suggestInstrumentation("classical", "calm", "small");
      expect(result).toContain("violin");
      expect(result).toContain("cello");
      expect(result).toContain("viola");
    });

    it("should suggest jazz trio for jazz small", () => {
      const result = orchestrator.suggestInstrumentation("jazz", "swing", "small");
      expect(result).toContain("piano");
      expect(result).toContain("double_bass");
      expect(result).toContain("trumpet_bb");
    });

    it("should suggest synth-based for electronic", () => {
      const result = orchestrator.suggestInstrumentation("electronic", "dark", "small");
      expect(result).toContain("synth_lead");
      expect(result).toContain("synth_bass");
    });
  });
});
