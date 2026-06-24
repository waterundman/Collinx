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
