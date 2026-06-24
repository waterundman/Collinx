import type { ToolRegistry, ToolResult, NoteEvent } from "@collinx/core";
import { createNoteEvent, randomUUID } from "@collinx/core";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

const SCALE_MAP: Record<string, number[]> = {
  major: MAJOR_SCALE,
  ionian: MAJOR_SCALE,
  minor: MINOR_SCALE,
  natural_minor: MINOR_SCALE,
  aeolian: MINOR_SCALE,
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

const KEY_MAP: Record<string, number> = {
  C: 60, "C#": 61, Db: 61, D: 62, "D#": 63, Eb: 63, E: 64,
  F: 65, "F#": 66, Gb: 66, G: 67, "G#": 68, Ab: 68,
  A: 69, "A#": 70, Bb: 70, B: 71,
};

const RHYTHM_TEMPLATES: number[][] = [
  [1.0, 0.5, 0.5],
  [0.5, 0.5, 1.0],
  [0.25, 0.25, 0.25, 0.25],
  [1.0, 1.0, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.5],
  [1.5, 0.5],
  [2.0, 1.0, 1.0],
  [3.0, 1.0],
];

const STYLE_TEMPLATES: Record<string, { rhythmIdx: number[]; intervals: number[]; density: number }> = {
  classical: { rhythmIdx: [0, 1, 2, 3], intervals: [0, 2, 4, 5, 7], density: 2 },
  jazz: { rhythmIdx: [1, 2, 4, 6], intervals: [0, 2, 3, 5, 7, 10], density: 2.5 },
  pop: { rhythmIdx: [0, 2, 3, 4], intervals: [0, 2, 4, 5, 7], density: 1.5 },
  rock: { rhythmIdx: [0, 3, 5], intervals: [0, 3, 5, 7], density: 1.5 },
  electronic: { rhythmIdx: [2, 4, 7], intervals: [0, 2, 4, 7], density: 3 },
  minimal: { rhythmIdx: [0, 5], intervals: [0, 4, 7], density: 1 },
};

const DIATONIC_CHORDS: Record<string, string[][]> = {
  major: [
    ["I", "maj"], ["ii", "min"], ["iii", "min"],
    ["IV", "maj"], ["V", "maj"], ["vi", "min"], ["vii°", "dim"],
  ],
  minor: [
    ["i", "min"], ["ii°", "dim"], ["III", "maj"],
    ["iv", "min"], ["v", "min"], ["VI", "maj"], ["VII", "maj"],
  ],
};

const PROGRESSION_PATTERNS: { name: string; pattern: number[]; style: string }[] = [
  { name: "I-IV-V-I", pattern: [0, 3, 4, 0], style: "classical" },
  { name: "I-V-vi-IV", pattern: [0, 4, 5, 3], style: "pop" },
  { name: "ii-V-I", pattern: [1, 4, 0], style: "jazz" },
  { name: "vi-IV-I-V", pattern: [5, 3, 0, 4], style: "pop" },
  { name: "I-vi-IV-V", pattern: [0, 5, 3, 4], style: "classical" },
  { name: "i-iv-V-i", pattern: [0, 3, 4, 0], style: "classical" },
  { name: "i-VI-III-VII", pattern: [0, 5, 2, 6], style: "pop" },
  { name: "I-IV-vi-V", pattern: [0, 3, 5, 4], style: "rock" },
];

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export class Composer {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  generateMotif(params: {
    bars: number;
    register: "low" | "mid" | "high";
    styleHint?: string;
    key?: string;
    scale?: string;
  }): ToolResult {
    const bars = params.bars ?? 4;
    const register = params.register ?? "mid";
    const styleHint = params.styleHint ?? "classical";
    const key = params.key ?? "C";
    const scaleName = params.scale ?? "major";

    const scaleIntervals = SCALE_MAP[scaleName] ?? MAJOR_SCALE;
    const keyOffset = KEY_MAP[key] ?? 60;
    const style = STYLE_TEMPLATES[styleHint] ?? STYLE_TEMPLATES.classical;
    const rand = seededRand(Date.now());

    const registerOffset: Record<string, number> = {
      low: -12,
      mid: 0,
      high: 12,
    };
    const baseOctave = registerOffset[register] ?? 0;

    const notes: NoteEvent[] = [];
    let noteId = 0;
    let currentBeat = 1.0;

    for (let bar = 1; bar <= bars; bar++) {
      let remainingBeats = 4.0;
      currentBeat = 1.0;

      while (remainingBeats > 0.05) {
        const rhythmIdx = style.rhythmIdx[Math.floor(rand() * style.rhythmIdx.length)];
        let dur = RHYTHM_TEMPLATES[rhythmIdx][noteId % RHYTHM_TEMPLATES[rhythmIdx].length];

        if (dur > remainingBeats) {
          dur = remainingBeats;
        }

        const intervalIdx = Math.floor(rand() * style.intervals.length);
        const interval = style.intervals[intervalIdx];
        const scaleDegree = interval % scaleIntervals.length;
        const octaveShift = Math.floor(interval / scaleIntervals.length);
        const pitch = keyOffset + scaleIntervals[scaleDegree] + baseOctave + octaveShift * 12;

        if (pitch >= 21 && pitch <= 108) {
          notes.push(
            createNoteEvent({
              trackId: "melody",
              bar,
              beat: currentBeat,
              durQn: dur,
              pitchMidi: pitch,
              velocity: 0.7 + rand() * 0.3,
              voice: "rh",
              tags: [styleHint],
            })
          );
        }

        noteId++;
        currentBeat += dur;
        remainingBeats -= dur;

        if (remainingBeats <= 0.05) break;
      }
    }

    return {
      status: "ok",
      resultType: "proposal",
      data: {
        motif: {
          name: `Motif-${key}-${scaleName}`,
          bars,
          instrumentRole: "melody",
          tags: [styleHint],
          noteIds: notes.map((n) => n.id),
        },
        notes,
      },
      confidence: 0.75,
      requiresUserConfirmation: true,
      auditRef: randomUUID(),
    };
  }

  suggestHarmony(params: {
    bars: number;
    key: string;
    style?: string;
  }): ToolResult {
    const bars = params.bars ?? 4;
    const key = params.key ?? "C";
    const styleHint = params.style ?? "classical";

    const keyOffset = KEY_MAP[key] ?? 60;
    const mode = "major";
    const chords = DIATONIC_CHORDS[mode];

    const matchingPatterns = PROGRESSION_PATTERNS.filter(
      (p) => p.style === styleHint || p.style === "classical"
    );
    const pattern =
      matchingPatterns[Math.floor(seededRand(Date.now() + 1)() * matchingPatterns.length)] ??
      PROGRESSION_PATTERNS[0];

    const harmonyEntries: Record<string, unknown>[] = [];
    let bar = 1;

    for (let i = 0; i < pattern.pattern.length && bar <= bars; i++) {
      const degree = pattern.pattern[i];
      const chord = chords[degree % chords.length];
      const rootNote = keyOffset + (degree === 0 ? 0 : MAJOR_SCALE[degree % MAJOR_SCALE.length]);

      harmonyEntries.push({
        bar,
        beat: 1,
        chord: {
          root: String.fromCharCode(65 + (rootNote % 12 > 4 ? 1 : 0)),
          quality: chord[1],
        },
        durationQn: 4.0,
        romanNumeral: chord[0],
        function: degree === 0 || degree === 5 || degree === 3 ? "tonic" : "subdominant",
      });

      bar++;
    }

    return {
      status: "ok",
      resultType: "proposal",
      data: {
        key,
        mode,
        entries: harmonyEntries,
        pattern: pattern.name,
      },
      confidence: 0.7,
      requiresUserConfirmation: true,
      auditRef: randomUUID(),
    };
  }
}
