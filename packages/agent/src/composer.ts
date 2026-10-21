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

/**
 * melody 轨硬上限：每小节音符数。
 *
 * 验收时用户指着钢琴卷帘说「一个小节里面怎么有那么多音符」。旧实现每拍随机
 * 挑一个节奏模板，而模板池里混着 [0.25,0.25,0.25,0.25]（16 分），
 * 48 小节实测平均 5~8 音/小节、最多 12 音 —— 谱面密到不可读。
 * 现在改成整小节模板 + 这条硬上限（DAW 里旋律轨通常 2~8 音/小节）。
 */
const MAX_MELODY_NOTES_PER_BAR = 8;

interface BarRhythmTemplate {
  /** 整小节的时值序列，总和 = 4 拍 */
  beats: number[];
  /** 相对权重（四分/二分主导，16 分只作点缀） */
  weight: number;
}

/**
 * 整小节节奏模板（v2.8.1）。
 *
 * 权重设计：二分/四分占绝对多数，八分为辅，16 分只在 [1,1,.5,.25,.25,1]
 * 里作一次点缀 —— 与旧实现「每拍独立随机」相比，实测平均 5~8 → 2.7~4.0 音/小节，
 * 单小节上限 12 → 6 音。
 */
const BAR_RHYTHM_TEMPLATES: BarRhythmTemplate[] = [
  { beats: [4], weight: 1 }, // 全音符
  { beats: [2, 2], weight: 4 }, // 两个二分，天然呼吸
  { beats: [3, 1], weight: 2 },
  { beats: [1, 3], weight: 1 },
  { beats: [2, 1, 1], weight: 4 },
  { beats: [1, 1, 2], weight: 4 },
  { beats: [1, 1, 1, 1], weight: 3 }, // 四分音符走句
  { beats: [1.5, 1.5, 1], weight: 2 },
  { beats: [1, 1, 1.5, 0.5], weight: 2 },
  { beats: [1, 1, 0.5, 0.5, 1], weight: 3 }, // 八分为辅
  { beats: [1, 0.5, 0.5, 1, 1], weight: 2 },
  { beats: [1, 1, 1, 0.5, 0.5], weight: 2 },
  { beats: [2, 0.5, 0.5, 1], weight: 2 },
  { beats: [1, 0.5, 0.5, 2], weight: 2 }, // 长音收尾
  { beats: [1, 1, 0.5, 0.25, 0.25, 1], weight: 1 }, // 16 分点缀，唯一含 16 分的模板
];

/** 风格 → 目标音数/小节（用于对模板权重做偏好，不是硬约束） */
const STYLE_TARGET_NOTES: Record<string, number> = {
  classical: 4,
  jazz: 5,
  pop: 4,
  rock: 4,
  electronic: 5,
  minimal: 2,
};

/** 模板音数偏离风格目标的指数惩罚，越偏离越不可能被选中 */
function densityBias(noteCount: number, target: number): number {
  return Math.pow(0.55, Math.abs(noteCount - target));
}

function pickWeighted<T extends { weight: number }>(rand: () => number, pool: T[]): T {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let r = rand() * total;
  for (const item of pool) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * 音阶名归一化（v2.8.1）。
 *
 * 端到端实测：AI 在对话里明确说「E 小调」，落进工程的却是 E 大调。
 * 根因不在行为层（AI 确实传了 scale），而是 SCALE_MAP 只认精确的小写 key：
 * AI 按自然语言习惯传 "E minor" / "Natural Minor" / "natural minor" 时全部
 * miss，静默 fallback 到 MAJOR_SCALE。
 *
 * 这里把「调名 + 调式」「大小写/空格/连字符/中文」各种写法统一成
 * SCALE_MAP 的 canonical key；无法识别时返回 null（由调用方回退大调）。
 */
const SCALE_ALIASES: Record<string, string> = {
  major: "major",
  maj: "major",
  ionian: "ionian",
  minor: "minor",
  min: "minor",
  m: "minor",
  naturalminor: "natural_minor",
  natminor: "natural_minor",
  aeolian: "aeolian",
  harmonicminor: "harmonic_minor",
  harmminor: "harmonic_minor",
  melodicminor: "melodic_minor",
  melminor: "melodic_minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  locrian: "locrian",
  pentatonicmajor: "pentatonic_major",
  pentatonicminor: "pentatonic_minor",
  blues: "blues",
};

const CHINESE_MODE_HINTS: { test: RegExp; scale: string }[] = [
  { test: /和声小调/, scale: "harmonic_minor" },
  { test: /旋律小调/, scale: "melodic_minor" },
  { test: /自然小调|小调/, scale: "natural_minor" },
  { test: /大调/, scale: "major" },
];

export function normalizeScaleName(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim().toLowerCase();
  if (s === "") return null;

  for (const hint of CHINESE_MODE_HINTS) {
    if (hint.test.test(s)) return hint.scale;
  }

  // 去掉括号注释（"minor（自然小调）"）与 "key of" 前缀
  s = s
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/\bkey\s*(of)?\s*/g, " ")
    .replace(/\bsharp\b/g, "#")
    .replace(/\bflat\b/g, "b");
  // 统一分隔符后只留字母："E minor" / "e-minor" / "natural_minor" / "F# minor"
  const flat = s.replace(/[\s\-_]+/g, "").replace(/[^a-z]/g, "");

  if (flat === "") return null;
  if (SCALE_ALIASES[flat]) return SCALE_ALIASES[flat];

  // "eminor" / "bbminor" / "fminor" —— 先按整体查，查不到再剥掉开头的调名。
  // 必须「先整体后剥离」，否则 "aeolian" 会被当成 a + eolian。
  const withoutKey = flat.replace(/^[a-g](#|b)?/, "");
  if (withoutKey !== flat && SCALE_ALIASES[withoutKey]) return SCALE_ALIASES[withoutKey];

  return null;
}

/**
 * 调性归一化：接受 "E" / "e" / "E minor" / "Eb" / "f#" / "F sharp"。
 * 返回 canonical key（KEY_MAP 的 key）以及从字符串里解析出的调式（若有）。
 */
export function normalizeKeyName(raw?: string | null): { key: string; mode: string | null } | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === "") return null;

  const match = s.match(/^([a-gA-G])\s*(#[#]?|♯|sharp|b{1,2}|♭|flat)?/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const rawAccidental = match[2] ?? "";
  const accidental =
    rawAccidental.includes("#") || rawAccidental.includes("♯") || rawAccidental === "sharp"
      ? "#"
      : rawAccidental.includes("b") || rawAccidental.includes("♭") || rawAccidental === "flat"
        ? "b"
        : "";
  const key = `${letter}${accidental}`;
  if (!(key in KEY_MAP)) return null;

  const rest = s.slice(match[0].length);
  return { key, mode: normalizeScaleName(rest) };
}

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
    /** 调性根音，可为合成串（"E" / "E minor" / "Eb"） */
    key?: string;
    /** 调式；接受 major/minor/aeolian/"E minor" 等写法 */
    scale?: string;
    /** scale 的别名（AI 沿用 suggestHarmony 的字段习惯时会传 mode） */
    mode?: string;
  }): ToolResult {
    const bars = params.bars ?? 4;
    const register = params.register ?? "mid";
    const styleHint = params.styleHint ?? "classical";

    // v2.8.1：key / scale 都做归一化。
    // 实测 AI 传 "E minor" 时旧实现 key、scale 双双 miss（"E minor" 不在 KEY_MAP，
    // "e minor"/"natural minor" 不在 SCALE_MAP），于是静默生成 C 大调的音 ——
    // AI 在对话里说自己写的是 E 小调，工程里听到的却是大调。
    const keyInfo = normalizeKeyName(params.key) ?? { key: "C", mode: null };
    const key = keyInfo.key;
    const scaleName =
      normalizeScaleName(params.scale) ??
      normalizeScaleName(params.mode) ??
      keyInfo.mode ??
      "major";

    const scaleIntervals = SCALE_MAP[scaleName] ?? MAJOR_SCALE;
    const keyOffset = KEY_MAP[key] ?? 60;
    const targetNotes = STYLE_TARGET_NOTES[styleHint] ?? STYLE_TARGET_NOTES.classical;
    const rand = seededRand(Date.now());

    const registerOffset: Record<string, number> = {
      low: -12,
      mid: 0,
      high: 12,
    };
    const baseOctave = registerOffset[register] ?? 0;

    const notes: NoteEvent[] = [];

    /**
     * v2.8.0：旋律生成从随机选音改为级进为主。
     *
     * 原实现  会让相邻音**完全无关**，
     * 且 interval ≥ 7 时  直接随机跳八度 ——
     * 听感是随机音阶练习，不是动机。验收时用户的原话是
     * 「这音符写的什么东西？这合规吗？」
     *
     * 现在：在调内音池（两个八度）里，从上一个音出发取**邻域候选**
     * （±4 半音，即级进/三度内），20% 概率放宽到 ±7 半音做小跳。
     * 八度只在音池范围内自然出现，不再随机跳。
     *
     * v2.8.1：改成**音级走位**（walk）而不是「在邻域里随机挑一个」。
     * 随机挑邻域仍会来回乱蹦（没有方向感，听起来像即兴试音），
     * 现在沿音阶走 1~3 级，30% 换向，并被"家"附近的引力拉回 ——
     * 得到一条有轮廓、也不会跑出音区的旋律线。
     */
    const scalePitches: number[] = [];
    for (let oct = 0; oct <= 1; oct++) {
      for (const iv of scaleIntervals) {
        const p = keyOffset + baseOctave + iv + oct * 12;
        if (p >= 21 && p <= 108) scalePitches.push(p);
      }
    }
    // 起点取主音（调内最稳的落点）
    let scaleIdx = 0;
    let direction = 1;
    const nextPitch = (): number => {
      if (rand() < 0.3) direction = -direction;
      // 引力：走到第 5 级以上就往回走，落到主音就往回走 ——
      // 保证旋律围绕主音，且不会把音区拉偏（register 语义要可验证）
      if (scaleIdx >= 4) direction = -1;
      if (scaleIdx <= 0) direction = 1;

      const r = rand();
      const leap = r < 0.12 ? 3 : r < 0.35 ? 2 : 1; // 12% 三度级进、23% 二度、余下级进
      let next = scaleIdx + direction * leap;
      if (next < 0 || next >= scalePitches.length) {
        direction = -direction;
        next = scaleIdx + direction;
      }
      scaleIdx = Math.max(0, Math.min(scalePitches.length - 1, next));
      return scalePitches[scaleIdx];
    };

    for (let bar = 1; bar <= bars; bar++) {
      let remainingBeats = 4.0;
      let currentBeat = 1.0;

      /**
       * v2.8.1：整小节节奏模板（旧实现是每拍随机挑模板）。
       *
       * 每 4 小节的最后一小节是「终止小节」，只从**以 ≥2 拍长音收尾**的
       * 模板里选 —— 乐句必须有呼吸，否则 48 小节全是没有落点的连续音符。
       */
      const isCadenceBar = bar % 4 === 0;
      const pool = BAR_RHYTHM_TEMPLATES.filter(
        (t) => !isCadenceBar || t.beats[t.beats.length - 1] >= 2,
      ).map((t) => ({
        ...t,
        weight: t.weight * densityBias(t.beats.length, targetNotes),
      }));
      const template = pickWeighted(rand, pool);

      let notesInBar = 0;
      let lastNoteIdx = -1;

      for (const beatDur of template.beats) {
        if (remainingBeats <= 0.05) break;
        // 硬上限：melody 轨每小节最多 8 个音
        if (notesInBar >= MAX_MELODY_NOTES_PER_BAR) break;

        const dur = Math.min(beatDur, remainingBeats);
        const pitch = nextPitch();

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
          }),
        );
        lastNoteIdx = notes.length - 1;
        notesInBar++;

        currentBeat += dur;
        remainingBeats -= dur;
      }

      // 触发硬上限或模板没铺满时，把余下的拍并进最后一个音，不留残拍空档
      if (remainingBeats > 0.05 && lastNoteIdx >= 0) {
        notes[lastNoteIdx].durQn += remainingBeats;
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
    /** 也可以用它表达调式（AI 常用这个字段，如 "minor" / "harmonic_minor"） */
    scale?: string;
  }): ToolResult {
    const bars = params.bars ?? 4;
    const key = params.key ?? "C";
    const styleHint = params.style ?? "classical";

    const keyOffset = KEY_MAP[key] ?? 60;
    // 调式来源：mode 优先，其次 scale。
    // AI 习惯用 scale 表达调式（"e minor" / "harmonic_minor"），
    // 只认 mode 会让它的调用静默退化成大调 —— 实测就是这种情况：
    // AI 明明在说 E 小调，落进工程的却是大调和弦。
    const modeHint = String(params.mode ?? params.scale ?? "").toLowerCase();
    const modeKey =
      modeHint.includes("minor") || modeHint.includes("aeolian") || modeHint.includes("dorian") ||
      modeHint.includes("phrygian") || modeHint.includes("locrian")
        ? "minor"
        : "major";
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
