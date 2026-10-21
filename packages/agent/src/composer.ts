import type { ToolRegistry, ToolResult, NoteEvent } from "@collinx/core";
import { createNoteEvent, createDiffEnvelope, randomUUID } from "@collinx/core";

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

/** 音高类 → 音名（用于和弦根音显示；此前用 fromCharCode 只会得到 A/B） */
const PITCH_CLASS_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

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
      // v2.4.0 S4：产出可审批的 DiffEnvelope。此前只有 data.notes，没有 diff，
      // 用户在 Agent 面板看不到任何待审提案，"让 AI 生成动机"实际上改不了工程。
      // baseRevision 由 ProjectProvider.alignRevision 在入队时对齐到当前图。
      diff: createDiffEnvelope({
        baseRevision: "",
        actor: { type: "agent", name: "Composer" },
        permissionScope: "proposal_only",
        summary: `生成 ${bars} 小节动机（${key} ${scaleName} / ${styleHint}）`,
        ops: [
          {
            op: "add_node",
            path: "/",
            nodeType: "Motif",
            data: {
              name: `Motif-${key}-${scaleName}`,
              tags: [styleHint],
            },
          },
          { op: "add_note_group", path: "/", notes },
        ],
      }),
      confidence: 0.75,
      requiresUserConfirmation: true,
      auditRef: randomUUID(),
    };
  }

  suggestHarmony(params: {
    bars: number;
    key: string;
    style?: string;
    /**
     * v2.8.0：调式。此前 mode 被硬编码成 "major"，参数里的调性根本没被读 ——
     * 用户要 E 小调，拿到的仍是大调和弦（验收时 AI 主动报出了这个问题）。
     * 缺省 major 保持向后兼容。
     */
    mode?: string;
  }): ToolResult {
    const bars = params.bars ?? 4;
    const key = params.key ?? "C";
    const styleHint = params.style ?? "classical";

    const keyOffset = KEY_MAP[key] ?? 60;
    const modeKey = params.mode === "minor" ? "minor" : "major";
    const scale = modeKey === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    const chords = DIATONIC_CHORDS[modeKey];

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
      const rootNote = keyOffset + (degree === 0 ? 0 : scale[degree % scale.length]);

      harmonyEntries.push({
        bar,
        beat: 1,
        // 修复：原来用 String.fromCharCode(65 + (rootNote%12>4?1:0))，
        // 只会产出 "A" 或 "B"，根音名完全错。改为按音高类取标准音名。
        chord: {
          root: PITCH_CLASS_NAMES[rootNote % 12],
          quality: chord[1],
        },
        durationQn: 4.0,
        romanNumeral: chord[0],
        // 主功能：小调 i / III / VI，大调 I / IV / vi 都算稳定功能；
        // 这里用「首和弦或第七度」近似，够用且不再写死 degree 3/5
        function: degree === 0 ? "tonic" : degree === 4 ? "dominant" : "subdominant",
        // 保留 degree 供下方生成和弦音符
        degree,
      });

      bar++;
    }

    // v2.8.0：把和弦落成**实际音符**并产出可审批 diff。
    // 此前 resultType=proposal 却没有 diff —— 用户在 Agent 面板看不到任何提案，
    // AI 的"和声建议"只是一段文字（与 v2.4.0 修过的 generateMotif 同类缺陷）。
    const notes: NoteEvent[] = [];
    for (const entry of harmonyEntries) {
      const degree = entry.degree as number;
      const bar = entry.bar as number;
      const rootPitch = keyOffset + scale[degree % scale.length];
      const thirdIdx = degree + 2;
      const fifthIdx = degree + 4;
      // 三和弦：根音 / 三度 / 五度；超出音阶长度时升八度
      const thirdPitch = keyOffset + scale[thirdIdx % 7] + (thirdIdx >= 7 ? 12 : 0);
      const fifthPitch = keyOffset + scale[fifthIdx % 7] + (fifthIdx >= 7 ? 12 : 0);

      for (const pitchMidi of [rootPitch, thirdPitch, fifthPitch]) {
        notes.push(
          createNoteEvent({
            trackId: "chords",
            bar,
            beat: 1,
            durQn: 4,
            pitchMidi,
            velocity: 0.6,
          }),
        );
      }
    }

    return {
      status: "ok",
      resultType: "proposal",
      data: {
        key,
        mode: modeKey,
        entries: harmonyEntries,
        pattern: pattern.name,
      },
      diff: createDiffEnvelope({
        baseRevision: "",
        actor: { type: "agent", name: "Composer" },
        permissionScope: "proposal_only",
        summary: `生成 ${harmonyEntries.length} 小节和声（${key} ${modeKey} / ${pattern.name}）`,
        ops: [{ op: "add_note_group", path: "/", notes }],
      }),
      confidence: 0.7,
      requiresUserConfirmation: true,
      auditRef: randomUUID(),
    };
  }
}
