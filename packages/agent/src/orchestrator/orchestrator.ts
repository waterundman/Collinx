import {
  type NoteEvent,
  type HarmonyEntry,
  type Instrument,
  type DiffEnvelope,
  createDiffEnvelope,
  randomUUID,
  ScoringEngine,
  type TasteGenome,
  INSTRUMENTS,
} from "@collinx/core";
import { VoicingEngine } from "./voicing-engine";
import type { VoicingGrid } from "./voicing-engine";
import { RegisterConflictDetector } from "./register-conflict";
import type { RegisterConflict } from "./register-conflict";

export type StyleHint = "classical" | "pop" | "cinematic" | "jazz";

export type PlayabilityPolicy = "strict" | "moderate" | "lenient";

export interface OrchestratorConfig {
  players: string[];
  style?: StyleHint;
  playabilityPolicy: PlayabilityPolicy;
  doubleOctaves?: boolean;
  maxVoices?: number;
  tasteGenome?: TasteGenome;
}

export interface OrchestratorResult {
  voicingPlan: VoicingGrid;
  perPlayerNotes: Map<string, NoteEvent[]>;
  conflicts: RegisterConflict[];
  suggestions: string[];
  diffs: DiffEnvelope[];
  confidence: number;
}

export class Orchestrator {
  private voicingEngine: VoicingEngine;
  private conflictDetector: RegisterConflictDetector;
  private scorer: ScoringEngine;

  constructor() {
    this.voicingEngine = new VoicingEngine();
    this.conflictDetector = new RegisterConflictDetector();
    this.scorer = new ScoringEngine();
  }

  orchestrate(
    notes: NoteEvent[],
    harmony: HarmonyEntry[],
    config: OrchestratorConfig,
  ): OrchestratorResult {
    const instruments = this.resolveInstruments(config.players);
    const playersList = Array.from(instruments.values());

    const voicingPlan = this.voicingEngine.generateVoicing(
      harmony,
      playersList,
      "close",
    );

    const perPlayerNotes = this.buildPerPlayerNotes(voicingPlan, config.players);
    const instrumentsMap = this.resolveInstruments(config.players);

    const conflicts = this.conflictDetector.detectConflicts(perPlayerNotes, instrumentsMap);
    const suggestions = conflicts.map((c) => this.conflictDetector.suggestFix(c));

    for (const [pid, playerNotes] of perPlayerNotes) {
      const inst = instrumentsMap.get(pid);
      if (inst) {
        const { playable, issues } = this.checkPlayability(playerNotes, inst);
        if (!playable) {
          conflicts.push({
            type: "range_violation",
            players: [pid, ""],
            bar: 1,
            beat: 1,
            description: `${inst.name}: ${issues.join("; ")}`,
            severity: "error",
            suggestion: issues.join("; "),
          });
        }
      }
    }

    const diffs = this.toDiff(perPlayerNotes, config.players, "HEAD");
    const confidence = this.computeConfidence(conflicts, perPlayerNotes, config);

    return {
      voicingPlan,
      perPlayerNotes,
      conflicts,
      suggestions,
      diffs,
      confidence,
    };
  }

  voicingPlan(
    phraseRef: string,
    _players: string[],
    config: OrchestratorConfig,
  ): OrchestratorResult {
    const harmony: HarmonyEntry[] = [
      { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      { bar: 2, beat: 1, chord: { root: "F", quality: "maj" }, durationQn: 2 },
      { bar: 2, beat: 3, chord: { root: "G", quality: "dom7" }, durationQn: 2 },
      { bar: 3, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
      { bar: 4, beat: 1, chord: { root: "A", quality: "min" }, durationQn: 2 },
      { bar: 4, beat: 3, chord: { root: "F", quality: "maj" }, durationQn: 2 },
    ];

    const notes: NoteEvent[] = [];
    for (const entry of harmony) {
      notes.push({
        id: randomUUID(),
        trackId: phraseRef,
        phraseId: null,
        bar: entry.bar,
        beat: entry.beat,
        durQn: entry.durationQn,
        pitchMidi: 60,
        pitchSpelling: "C4",
        velocity: 0.8,
        voice: "rh",
        tags: [],
      });
    }

    return this.orchestrate(notes, harmony, config);
  }

  checkPlayability(
    notes: NoteEvent[],
    instrument: Instrument,
  ): { playable: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const note of notes) {
      if (note.pitchMidi < instrument.range.minMidi) {
        issues.push(
          `音符 ${note.pitchMidi} 低于 ${instrument.name} 最低音域 ${instrument.range.minMidi}`,
        );
      }
      if (note.pitchMidi > instrument.range.maxMidi) {
        issues.push(
          `音符 ${note.pitchMidi} 超出 ${instrument.name} 最高音域 ${instrument.range.maxMidi}`,
        );
      }
    }

    return { playable: issues.length === 0, issues };
  }

  toDiff(
    perPlayerNotes: Map<string, NoteEvent[]>,
    players: string[],
    baseRevision: string,
  ): DiffEnvelope[] {
    const diffs: DiffEnvelope[] = [];

    for (const pid of players) {
      const notes = perPlayerNotes.get(pid);
      if (!notes || notes.length === 0) continue;

      const inst = INSTRUMENTS[pid];
      const instName = inst?.name ?? pid;

      diffs.push(
        createDiffEnvelope({
          baseRevision,
          actor: { type: "agent", name: "orchestrator" },
          permissionScope: "proposal_only",
          summary: `编制方案: ${instName} (${pid}) — ${notes.length} 音符`,
          ops: [
            {
              op: "add_note_group",
              path: `tracks/${pid}`,
              notes,
            },
          ],
          domainExplanations: [
            {
              label: instName,
              text: `${pid}: ${notes.length} 音符, 音域 ${inst?.range.minMidi ?? "?"}-${inst?.range.maxMidi ?? "?"}`,
            },
          ],
          riskFlags: [],
        }),
      );
    }

    return diffs;
  }

  suggestInstrumentation(
    genre: string,
    _mood: string,
    size: "small" | "medium" | "large",
  ): string[] {
    const genreLower = genre.toLowerCase();

    if (genreLower === "classical") {
      if (size === "small") return ["violin", "violin", "viola", "cello"];
      if (size === "medium") return ["violin", "violin", "viola", "cello", "flute", "oboe", "clarinet_bb", "bassoon"];
      return ["violin", "violin", "violin", "viola", "viola", "cello", "cello", "double_bass", "flute", "flute", "oboe", "oboe", "clarinet_bb", "clarinet_bb", "bassoon", "bassoon", "horn_f", "horn_f", "trumpet_bb", "trumpet_bb", "trombone", "tuba", "timpani"];
    }

    if (genreLower === "jazz") {
      if (size === "small") return ["piano", "double_bass", "trumpet_bb"];
      if (size === "medium") return ["piano", "double_bass", "trumpet_bb", "trombone", "alto_flute", "clarinet_bb"];
      return ["piano", "double_bass", "trumpet_bb", "trumpet_bb", "trombone", "trombone", "alto_flute", "clarinet_bb", "clarinet_bb"];
    }

    if (genreLower === "pop") {
      if (size === "small") return ["piano", "synth_bass", "classical_guitar"];
      if (size === "medium") return ["piano", "synth_bass", "classical_guitar", "synth_pad", "violin"];
      return ["piano", "synth_bass", "classical_guitar", "synth_pad", "violin", "violin", "viola", "cello", "flute", "synth_lead"];
    }

    if (genreLower === "electronic") {
      if (size === "small") return ["synth_lead", "synth_bass"];
      if (size === "medium") return ["synth_lead", "synth_bass", "synth_pad", "piano"];
      return ["synth_lead", "synth_bass", "synth_pad", "synth_pad", "piano", "violin", "cello"];
    }

    return size === "small" ? ["piano", "violin", "cello"] : size === "medium" ? ["piano", "violin", "violin", "viola", "cello"] : ["violin", "violin", "viola", "cello", "double_bass", "flute", "oboe", "clarinet_bb", "bassoon", "horn_f", "trumpet_bb", "trombone", "tuba", "piano"];
  }

  private buildPerPlayerNotes(
    grid: VoicingGrid,
    playerIds: string[],
  ): Map<string, NoteEvent[]> {
    const perPlayer = new Map<string, NoteEvent[]>();
    for (const pid of playerIds) {
      perPlayer.set(pid, []);
    }

    for (const chord of grid.chords) {
      for (let i = 0; i < chord.notes.length; i++) {
        const voicingNote = chord.notes[i];
        const playerId = voicingNote.playerId && playerIds.includes(voicingNote.playerId)
          ? voicingNote.playerId
          : playerIds[i % playerIds.length];
        const playerNotes = perPlayer.get(playerId);
        if (!playerNotes) continue;

        const note: NoteEvent = {
          id: randomUUID(),
          trackId: playerId,
          phraseId: null,
          bar: chord.bar,
          beat: chord.beat,
          durQn: 1,
          pitchMidi: voicingNote.pitchMidi,
          pitchSpelling: voicingNote.pitchSpelling,
          velocity: voicingNote.voiceIndex < 2 ? 0.75 : 0.7,
          voice: voicingNote.voiceIndex < 2 ? "rh" : "lh",
          tags: [],
        };
        playerNotes.push(note);
      }
    }

    return perPlayer;
  }

  private resolveInstruments(playerIds: string[]): Map<string, Instrument> {
    const map = new Map<string, Instrument>();
    for (const pid of playerIds) {
      const inst = INSTRUMENTS[pid];
      if (inst) {
        map.set(pid, inst);
      }
    }
    return map;
  }

  private computeConfidence(
    conflicts: RegisterConflict[],
    perPlayerNotes: Map<string, NoteEvent[]>,
    config: OrchestratorConfig,
  ): number {
    let base = 0.85;

    const errors = conflicts.filter((c) => c.severity === "error").length;
    const warnings = conflicts.filter((c) => c.severity === "warning").length;
    base -= errors * 0.15 + warnings * 0.05;

    const totalNotes = Array.from(perPlayerNotes.values()).reduce(
      (sum, notes) => sum + notes.length,
      0,
    );
    if (totalNotes === 0) base -= 0.3;

    if (config.style === "jazz") base += 0.05;

    return Math.max(0, Math.min(1, base));
  }
}
