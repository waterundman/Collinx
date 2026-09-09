import { type NoteEvent, midiToSpelling } from "./note-event";

export interface ChordSymbol {
  root: string;
  quality: string;
  bass?: string;
  extensions?: string;
}

export interface HarmonyEntry {
  bar: number;
  beat: number;
  chord: ChordSymbol;
  durationQn: number;
  romanNumeral?: string;
  function?: string;
}

const ROMAN_TO_ROOT: Record<string, number> = {
  "I": 0, "II": 2, "III": 4, "IV": 5, "V": 7, "VI": 9, "VII": 11,
  "i": 0, "ii": 2, "iii": 4, "iv": 5, "v": 7, "vi": 9, "vii": 11,
};

const QUALITY_ALIASES: Record<string, string> = {
  "": "maj",
  "M": "maj",
  "maj": "maj",
  "major": "maj",
  "m": "min",
  "min": "min",
  "minor": "min",
  "-": "min",
  "dim": "dim",
  "diminished": "dim",
  "o": "dim",
  "aug": "aug",
  "augmented": "aug",
  "+": "aug",
  "maj7": "maj7",
  "M7": "maj7",
  "Δ": "maj7",
  "min7": "min7",
  "m7": "min7",
  "-7": "min7",
  "dom7": "dom7",
  "7": "dom7",
  "dim7": "dim7",
  "o7": "dim7",
  "halfdim7": "halfdim7",
  "m7b5": "halfdim7",
  "ø": "halfdim7",
  "ø7": "halfdim7",
  "minMaj7": "minMaj7",
  "mM7": "minMaj7",
  "aug7": "aug7",
  "+7": "aug7",
  "sus2": "sus2",
  "sus4": "sus4",
  "sus": "sus4",
  "6": "maj6",
  "m6": "min6",
  "dom9": "dom9",
  "9": "dom9",
  "maj9": "maj9",
  "min9": "min9",
};

const QUALITY_TO_STRING: Record<string, string> = {
  "maj": "",
  "min": "m",
  "dim": "dim",
  "aug": "aug",
  "maj7": "maj7",
  "min7": "m7",
  "dom7": "7",
  "dim7": "dim7",
  "halfdim7": "m7b5",
  "minMaj7": "mM7",
  "aug7": "aug7",
  "sus2": "sus2",
  "sus4": "sus4",
  "maj6": "6",
  "min6": "m6",
  "dom9": "9",
  "maj9": "maj9",
  "min9": "m9",
};

const MAJOR_SCALE_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 11];

function scaleDegreeName(degree: number): string {
  const names = ["I", "II", "III", "IV", "V", "VI", "VII"];
  return names[((degree % 7) + 7) % 7];
}

function degreeToSemitone(mode: string, degree: number): number {
  const scale = mode === "minor" ? HARMONIC_MINOR_DEGREES : MAJOR_SCALE_DEGREES;
  return scale[((degree % 7) + 7) % 7];
}

const FUNCTION_MAP: Record<string, string> = {
  "I": "tonic", "i": "tonic",
  "III": "tonic", "iii": "tonic",
  "VI": "tonic", "vi": "tonic",
  "V": "dominant", "v": "dominant",
  "VII": "dominant", "vii": "dominant",
  "IV": "subdominant", "iv": "subdominant",
  "II": "subdominant", "ii": "subdominant",
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function noteToSemitone(note: string): number {
  for (let i = 0; i < 12; i++) {
    if (NOTE_NAMES[i] === note || NOTE_NAMES_FLAT[i] === note) return i;
  }
  throw new Error(`Unknown note: ${note}`);
}

function semitoneToNote(semi: number, preferSharp = true): string {
  const idx = ((semi % 12) + 12) % 12;
  return preferSharp ? NOTE_NAMES[idx] : NOTE_NAMES_FLAT[idx];
}

const CADENCE_PATTERNS: { pattern: string[]; type: string }[] = [
  { pattern: ["V", "I"], type: "authentic" },
  { pattern: ["V7", "I"], type: "authentic" },
  { pattern: ["vii°", "I"], type: "authentic" },
  { pattern: ["IV", "I"], type: "plagal" },
  { pattern: ["iv", "I"], type: "plagal" },
  { pattern: ["V", "vi"], type: "deceptive" },
  { pattern: ["V7", "vi"], type: "deceptive" },
  { pattern: ["ii", "V", "I"], type: "ii-V-I" },
  { pattern: ["ii7", "V7", "I"], type: "ii-V-I" },
  { pattern: ["ii", "V7", "i"], type: "ii-V-i" },
  { pattern: ["IV", "V", "I"], type: "IV-V-I" },
  { pattern: ["bVII", "I"], type: "backdoor" },
];

const PITCH_TOKEN_RE = /^[A-G][#b]?$/;

interface IntervalQuality {
  intervals: number[];
  quality: "maj" | "min" | "dim" | "aug" | "maj7" | "dom7" | "min7" | "halfdim7" | "dim7";
  seventh: boolean;
}

// 三和弦：按相对根音的半音差集合判定质量
const TRIAD_QUALITIES: IntervalQuality[] = [
  { intervals: [3, 6], quality: "dim", seventh: false },
  { intervals: [3, 7], quality: "min", seventh: false },
  { intervals: [4, 7], quality: "maj", seventh: false },
  { intervals: [4, 8], quality: "aug", seventh: false },
];

// 七和弦（可选支持）：仍以三音性质定大小写
const SEVENTH_QUALITIES: IntervalQuality[] = [
  { intervals: [3, 6, 9], quality: "dim7", seventh: true },
  { intervals: [3, 6, 10], quality: "halfdim7", seventh: true },
  { intervals: [3, 7, 10], quality: "min7", seventh: true },
  { intervals: [4, 7, 10], quality: "dom7", seventh: true },
  { intervals: [4, 7, 11], quality: "maj7", seventh: true },
];

/**
 * 单一事实源：从一组音名（音级集合）检测根音与质量。
 *
 * - 必须传入数组；空数组 / 非数组 → undefined。
 * - 每个 token 必须匹配 ^[A-G][#b]?$；"B#" / "Cb" 等能通过正则但不在音名表内
 *   会抛错，捕获后返回 undefined（绝不向上抛）。
 * - 去重后独立音级 <3 → undefined（无法判定三音）。
 * - 遍历每个独立音级作为候选根音，用音程集合匹配三/七和弦质量表；
 *   首个匹配即返回其原始 token（保序、最早出现者）作为 root，并携带 rootPc。
 *
 * 返回 undefined 表示无法识别（非三度叠置 / 音级不足 / 坏 token）。
 */
function matchChord(
  pitches: string[],
): { root: string; rootPc: number; quality: IntervalQuality["quality"] } | undefined {
  if (!Array.isArray(pitches) || pitches.length === 0) return undefined;

  for (const p of pitches) {
    if (typeof p !== "string" || !PITCH_TOKEN_RE.test(p)) return undefined;
  }

  let pcs: number[];
  try {
    pcs = Array.from(new Set(pitches.map((p) => noteToSemitone(p))));
  } catch {
    // "B#"/"Cb" 等能通过 PITCH_TOKEN_RE 但不在音名表内 → 绝不抛错
    return undefined;
  }
  if (pcs.length < 3) return undefined;

  const qualities = pcs.length === 3 ? TRIAD_QUALITIES : SEVENTH_QUALITIES;

  for (const semi of pcs) {
    const rootToken = pitches.find((p) => noteToSemitone(p) === semi);
    if (!rootToken) continue;
    const rootPc = semi;

    const intervals = pcs
      .filter((pc) => pc !== rootPc)
      .map((pc) => (((pc - rootPc) % 12) + 12) % 12)
      .sort((a, b) => a - b);

    const match = qualities.find((q) => q.intervals.every((v) => intervals.includes(v)));
    if (!match) continue;

    return { root: rootToken, rootPc, quality: match.quality };
  }

  return undefined;
}

/**
 * 将一组不带八度的音名（如 ["E","G#","B"]）识别为和弦符号 { root, quality }。
 *
 * quality 使用文件内 QUALITY_ALIASES 的 canonical value（"maj"/"min"/"dim"/
 * "aug"/"maj7"/"dom7"/"min7"/"halfdim7"/"dim7"）。无法识别（非三度叠置 / <3 pcs /
 * 坏 token / 空数组）→ undefined，绝不 throw。
 */
export function pitchSetToChordSymbol(pitches: string[]): ChordSymbol | undefined {
  const match = matchChord(pitches);
  if (!match) return undefined;
  return { root: match.root, quality: match.quality };
}

/**
 * 将一组音名（音级集合）在给定调性下转换为罗马数字。
 *
 * - 音名 token 必须匹配 ^[A-G][#b]?$，任何非法 token → undefined（绝不抛错）。
 * - 去重后独立音级 <3 → undefined（无法判定三音）。
 * - 遍历每个独立音级作为候选根音，用音程集合匹配质量；
 *   根音相对 tonic 的半音差必须落在调式自然音级集合内，否则 undefined。
 * - 大小写来自实际音程（大三度→大写），不是音阶默认推断；dim 追加 "°"。
 *
 * 根音/质量检测复用单一事实源 matchChord()，保持既有的行为。
 */
export function pitchSetToRomanNumeral(
  pitches: string[],
  tonic: string,
  mode: string
): string | undefined {
  const chord = matchChord(pitches);
  if (!chord) return undefined;

  let tonicSemi: number;
  try {
    tonicSemi = noteToSemitone(tonic);
  } catch {
    return undefined;
  }

  const scale = mode === "minor" ? NATURAL_MINOR_DEGREES : MAJOR_SCALE_DEGREES;
  const diff = (((chord.rootPc - tonicSemi) % 12) + 12) % 12;
  const degreeIdx = scale.indexOf(diff);
  if (degreeIdx < 0) return undefined;

  let casing: "upper" | "lower" = "upper";
  let isDim = false;
  let isAug = false;
  if (chord.quality === "maj7" || chord.quality === "dom7") {
    casing = "upper";
  } else if (
    chord.quality === "min7" ||
    chord.quality === "halfdim7" ||
    chord.quality === "dim7"
  ) {
    casing = "lower";
  } else {
    if (chord.quality === "maj" || chord.quality === "aug") casing = "upper";
    else casing = "lower";
    if (chord.quality === "dim") isDim = true;
    if (chord.quality === "aug") isAug = true;
  }

  let roman = scaleDegreeName(degreeIdx);
  if (casing === "lower") roman = roman.toLowerCase();
  if (isDim) roman += "°";
  if (isAug) roman += "+";

  return roman;
}

/**
 * 从和弦轨音符派生 HarmonyEntry[]。
 *
 * 已知限界（v1.22.0）：
 * - 仅按 bar 分组，bar 内多于一个和弦的变化会被合并为单一 entry；
 * - 无法识别为三/七和弦的 bar 整体丢失（不产生 entry）；
 * - 不处理重叠/跨小节的连音与装饰音。
 *
 * 规则：
 * 1. 空数组 / 全无效输入 → []。
 * 2. 按 bar 分组（对齐 v1.19 App.tsx:544 chordProgression 先例）。
 * 3. 每组 pitch names = 组内音符 pitchSpelling 去八度数字（`replace(/\d+$/, "")`）
 *    去重保序；pitchSpelling 非法/空时回退由 pitchMidi 推名（midiToSpelling）。
 * 4. entry.beat = 组内最小 beat；durationQn = 组内时间跨度
 *    max(beat+durQn) − min(beat)（同时态三音组求和会翻倍，跨度才正确）。
 * 5. chord = pitchSetToChordSymbol(names)；undefined → 跳过该 bar。
 * 6. 有 key 时：romanNumeral = pitchSetToRomanNumeral(names, tonic, mode)，
 *    undefined 则省略字段；无 key 省略。
 * 7. 按 bar 升序输出。
 */
export function notesToHarmonyEntries(
  chordNotes: NoteEvent[],
  key?: { tonic: string; mode: string },
): HarmonyEntry[] {
  if (!Array.isArray(chordNotes) || chordNotes.length === 0) return [];

  const byBar = new Map<number, NoteEvent[]>();
  for (const note of chordNotes) {
    if (!note || typeof note.bar !== "number") continue;
    const group = byBar.get(note.bar) ?? [];
    group.push(note);
    byBar.set(note.bar, group);
  }
  if (byBar.size === 0) return [];

  const entries: HarmonyEntry[] = [];

  for (const [bar, group] of byBar) {
    const names: string[] = [];
    for (const n of group) {
      let name = n.pitchSpelling ? n.pitchSpelling.replace(/\d+$/, "") : "";
      if (!name || !PITCH_TOKEN_RE.test(name)) {
        name = midiToSpelling(n.pitchMidi).replace(/\d+$/, "");
      }
      if (!names.includes(name)) names.push(name);
    }

    const chord = pitchSetToChordSymbol(names);
    if (!chord) continue;

    const beats = group.map((n) => n.beat);
    const minBeat = Math.min(...beats);
    const maxEnd = Math.max(...group.map((n) => n.beat + (n.durQn ?? 0)));
    const durationQn = maxEnd - minBeat;

    const entry: HarmonyEntry = {
      bar,
      beat: minBeat,
      chord,
      durationQn,
    };

    if (key) {
      const rn = pitchSetToRomanNumeral(names, key.tonic, key.mode);
      if (rn) entry.romanNumeral = rn;
    }

    entries.push(entry);
  }

  entries.sort((a, b) => {
    if (a.bar !== b.bar) return a.bar - b.bar;
    return a.beat - b.beat;
  });

  return entries;
}

export class HarmonyPlan {
  private entries: HarmonyEntry[];

  constructor(entries: HarmonyEntry[] = []) {
    this.entries = [...entries].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });
  }

  addEntry(entry: HarmonyEntry): void {
    this.entries = this.entries.filter(
      (e) => !(e.bar === entry.bar && e.beat === entry.beat)
    );
    this.entries.push(entry);
    this.entries.sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });
  }

  removeEntry(bar: number, beat: number): void {
    this.entries = this.entries.filter(
      (e) => !(e.bar === bar && e.beat === beat)
    );
  }

  chordAt(bar: number, beat: number = 1): ChordSymbol | undefined {
    let best: HarmonyEntry | undefined;
    for (const entry of this.entries) {
      if (entry.bar > bar || (entry.bar === bar && entry.beat > beat)) continue;
      if (
        !best ||
        entry.bar > best.bar ||
        (entry.bar === best.bar && entry.beat > best.beat)
      ) {
        best = entry;
      }
    }
    return best?.chord;
  }

  getEntriesInRange(startBar: number, endBar: number): HarmonyEntry[] {
    return this.entries.filter(
      (e) => e.bar >= startBar && e.bar <= endBar
    );
  }

  getAllEntries(): HarmonyEntry[] {
    return [...this.entries];
  }

  getChordProgression(): string[] {
    return this.entries.map((e) => {
      const rn = e.romanNumeral ?? "";
      return rn || HarmonyPlan.formatChordSymbol(e.chord);
    });
  }

  detectCadences(): { bar: number; type: string }[] {
    const results: { bar: number; type: string }[] = [];
    const symbols = this.entries.map((e) => {
      if (e.romanNumeral) return e.romanNumeral;
      return null;
    });

    for (let i = 0; i <= symbols.length - 2; i++) {
      for (const pat of CADENCE_PATTERNS) {
        const len = pat.pattern.length;
        if (i + len > symbols.length) continue;
        let match = true;
        for (let j = 0; j < len; j++) {
          const expected = pat.pattern[j];
          const actual = symbols[i + j];
          if (!actual) { match = false; break; }
          if (actual.replace(/7$/, "") !== expected.replace(/7$|°$/, "")) {
            match = false;
            break;
          }
        }
        if (match) {
          results.push({
            bar: this.entries[i + len - 1].bar,
            type: pat.type,
          });
          i += len - 1;
          break;
        }
      }
    }

    return results;
  }

  static fromNodeData(data: Record<string, unknown>): HarmonyPlan {
    const entries = (data.entries as HarmonyEntry[]) ?? [];
    return new HarmonyPlan(entries);
  }

  toNodeData(): Record<string, unknown> {
    return { entries: this.entries };
  }

  static parseChordSymbol(symbol: string): ChordSymbol {
    const trimmed = symbol.trim();
    if (!trimmed) return { root: "C", quality: "maj" };

    let remaining = trimmed;
    let bass: string | undefined;

    const slashIdx = remaining.indexOf("/");
    if (slashIdx > 0) {
      bass = remaining.slice(slashIdx + 1);
      remaining = remaining.slice(0, slashIdx);
    }

    const rootMatch = remaining.match(/^([A-G])([#b]?)/);
    if (!rootMatch) throw new Error(`Cannot parse chord root: ${symbol}`);
    const root = rootMatch[0];
    let rest = remaining.slice(rootMatch[0].length);

    const origRest = rest;

    let quality = "maj";
    let extensions: string | undefined;

    for (const alias of Object.keys(QUALITY_ALIASES).sort((a, b) => b.length - a.length)) {
      if (alias && rest.startsWith(alias)) {
        quality = QUALITY_ALIASES[alias];
        rest = rest.slice(alias.length);
        break;
      }
    }

    if (!rest && origRest === "M") {
      quality = "maj";
    }

    if (rest && /^([#b]?\d{1,2}([#b]\d{1,2})?)/.test(rest)) {
      const extMatch = rest.match(/^([#b]?\d{1,2}([#b]\d{1,2})?)/);
      extensions = extMatch![0];
      rest = rest.slice(extensions!.length);
    }

    if (!extensions && rest) {
      extensions = rest;
    }

    const result: ChordSymbol = { root, quality };
    if (bass) result.bass = bass;
    if (extensions) result.extensions = extensions;
    return result;
  }

  static formatChordSymbol(chord: ChordSymbol): string {
    let result = chord.root;
    const qStr = QUALITY_TO_STRING[chord.quality] ?? chord.quality;
    result += qStr;
    if (chord.extensions) {
      result += chord.extensions;
    }
    if (chord.bass) {
      result += "/" + chord.bass;
    }
    return result;
  }
}
