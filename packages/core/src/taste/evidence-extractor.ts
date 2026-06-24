import type { NoteEvent } from "../model/note-event";
import { TempoMap } from "../model/tempo-map";
import { HarmonyPlan } from "../model/harmony-plan";
import type { TasteEvidence, TasteContext } from "./taste-types";
import { EVIDENCE_WEIGHTS, TasteDomain } from "./taste-types";
import { randomUUID } from "../util/random-uuid";

export interface HarmonyFeatures {
  chromaticColorRatio: number;
  chordDensity: number;
  borrowedChordRatio: number;
  cadenceTypeDistribution: Record<string, number>;
}

export interface MelodyFeatures {
  rangeWidth: number;
  leapRatio: number;
  stepRatio: number;
  phraseEndPitch: number;
}

export interface RhythmFeatures {
  syncopationRatio: number;
  swingAmount: number;
  restDensity: number;
  grooveDensity: number;
}

export interface TextureFeatures {
  density: number;
  padLayering: number;
  ostinatoLevel: number;
  voiceIndependence: number;
}

export interface TimbreFeatures {
  brightness: number;
  transientSoftness: number;
}

export interface FormFeatures {
  sectionContrast: number;
  bridgeLength: number;
  introOutro: { hasIntro: boolean; hasOutro: boolean };
}

export interface MixFeatures {
  reverbAmount: number;
  compressionTendency: number;
  stereoWidth: number;
}

export interface RejectFeatures {
  tripletFillBeforeDrop: number;
  excessiveSidechain: number;
}

export interface FeatureSummary {
  totalNotes: number;
  totalBars: number;
  avgTempo: number;
  keySignature: string;
  timeSignature: string;
}

export interface ExtractedFeatures {
  harmony: HarmonyFeatures;
  melody: MelodyFeatures;
  rhythm: RhythmFeatures;
  texture: TextureFeatures;
  timbre: TimbreFeatures;
  form: FormFeatures;
  mix: MixFeatures;
  reject: RejectFeatures;
  summary: FeatureSummary;
}

const NOTE_NAME_TO_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9,
  "A#": 10, Bb: 10, B: 11,
};

function noteToPc(name: string): number {
  return NOTE_NAME_TO_PC[name] ?? 0;
}

function diatonicPcs(tonic: string, mode: string): Set<number> {
  const root = noteToPc(tonic);
  const intervals = mode === "minor"
    ? [0, 2, 3, 5, 7, 8, 10]
    : [0, 2, 4, 5, 7, 9, 11];
  return new Set(intervals.map((i) => (root + i) % 12));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clamp01(numerator / denominator);
}

function keyAtOrDefault(
  tempoMap: TempoMap | undefined,
  bar: number
): { tonic: string; mode: string } {
  if (tempoMap) return tempoMap.keyAt(bar);
  return { tonic: "C", mode: "major" };
}

function getTotalBars(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  return Math.max(...notes.map((n) => n.bar));
}

export class EvidenceExtractor {
  extract(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    harmonyPlan?: HarmonyPlan
  ): ExtractedFeatures {
    return {
      harmony: this.extractHarmony(notes, tempoMap, harmonyPlan),
      melody: this.extractMelody(notes),
      rhythm: this.extractRhythm(notes, tempoMap),
      texture: this.extractTexture(notes, tempoMap),
      timbre: this.extractTimbre(notes),
      form: this.extractForm(notes, tempoMap),
      mix: this.extractMix(notes),
      reject: this.extractReject(notes),
      summary: this.extractSummary(notes, tempoMap),
    };
  }

  extractHarmony(
    notes: NoteEvent[],
    tempoMap?: TempoMap,
    harmonyPlan?: HarmonyPlan
  ): HarmonyFeatures {
    const chromaticColorRatio = computeChromaticColorRatio(notes, tempoMap);
    const chordDensity = computeChordDensity(notes, harmonyPlan);
    const borrowedChordRatio = computeBorrowedChordRatio(notes, tempoMap, harmonyPlan);
    const cadenceTypeDistribution = computeCadenceDistribution(harmonyPlan);
    return { chromaticColorRatio, chordDensity, borrowedChordRatio, cadenceTypeDistribution };
  }

  extractMelody(notes: NoteEvent[]): MelodyFeatures {
    const rangeWidth = computeRangeWidth(notes);
    const { leapRatio, stepRatio } = computeIntervalRatios(notes);
    const phraseEndPitch = computePhraseEndStability(notes);
    return { rangeWidth, leapRatio, stepRatio, phraseEndPitch };
  }

  extractRhythm(notes: NoteEvent[], _tempoMap: TempoMap): RhythmFeatures {
    const syncopationRatio = computeSyncopationRatio(notes);
    const swingAmount = computeSwingAmount(notes);
    const restDensity = computeRestDensity(notes);
    const grooveDensity = computeGrooveDensity(notes);
    return { syncopationRatio, swingAmount, restDensity, grooveDensity };
  }

  extractTexture(notes: NoteEvent[], _tempoMap: TempoMap): TextureFeatures {
    const density = computeDensity(notes);
    const padLayering = computePadLayering(notes);
    const ostinatoLevel = computeOstinatoLevel(notes);
    const voiceIndependence = computeVoiceIndependence(notes);
    return { density, padLayering, ostinatoLevel, voiceIndependence };
  }

  extractTimbre(notes: NoteEvent[]): TimbreFeatures {
    const brightness = computeBrightness(notes);
    const transientSoftness = computeTransientSoftness(notes);
    return { brightness, transientSoftness };
  }

  extractForm(notes: NoteEvent[], _tempoMap: TempoMap): FormFeatures {
    const sectionContrast = computeSectionContrast(notes);
    const bridgeLength = computeBridgeLength(notes);
    const introOutro = computeIntroOutro(notes);
    return { sectionContrast, bridgeLength, introOutro };
  }

  extractMix(notes: NoteEvent[]): MixFeatures {
    const reverbAmount = computeReverbAmount(notes);
    const compressionTendency = computeCompressionTendency(notes);
    const stereoWidth = computeStereoWidth(notes);
    return { reverbAmount, compressionTendency, stereoWidth };
  }

  extractReject(notes: NoteEvent[]): RejectFeatures {
    const tripletFillBeforeDrop = computeTripletFillBeforeDrop(notes);
    const excessiveSidechain = computeExcessiveSidechain(notes);
    return { tripletFillBeforeDrop, excessiveSidechain };
  }

  private extractSummary(notes: NoteEvent[], tempoMap: TempoMap): FeatureSummary {
    const totalNotes = notes.length;
    const totalBars = getTotalBars(notes);
    const avgBars = totalBars > 1 ? totalBars : 1;
    let avgTempo = 120;
    if (tempoMap && totalBars > 0) {
      let sum = 0;
      for (let bar = 1; bar <= totalBars; bar++) {
        sum += tempoMap.bpmAt(bar);
      }
      avgTempo = Math.round(sum / totalBars);
    }
    const key = keyAtOrDefault(tempoMap, 1);
    const keySignature = `${key.tonic} ${key.mode}`;
    const meter = tempoMap ? tempoMap.meterAt(1) : { numerator: 4, denominator: 4 };
    const timeSignature = `${meter.numerator}/${meter.denominator}`;
    return { totalNotes, totalBars, avgTempo, keySignature, timeSignature };
  }

  toEvidenceSet(features: ExtractedFeatures, exportRef: string): TasteEvidence[] {
    const now = new Date().toISOString();
    const ctx: TasteContext = {
      tempoBpmRange: [features.summary.avgTempo - 10, features.summary.avgTempo + 10],
    };

    const evidence: TasteEvidence[] = [];

    const add = (key: string, pointEstimate: number) => {
      evidence.push({
        id: randomUUID(),
        type: "confirmed_export_diff" as const,
        paramKey: key,
        pointEstimate: String(clamp01(pointEstimate)),
        context: ctx,
        sourceQuality: EVIDENCE_WEIGHTS.confirmed_export_diff,
        timestamp: now,
        ref: exportRef,
        confirmed: false,
      });
    };

    const addBernoulli = (key: string, pointEstimate: number) => {
      evidence.push({
        id: randomUUID(),
        type: "confirmed_export_diff" as const,
        paramKey: key,
        pointEstimate: String(clamp01(pointEstimate)),
        context: ctx,
        sourceQuality: EVIDENCE_WEIGHTS.confirmed_export_diff,
        timestamp: now,
        ref: exportRef,
        confirmed: false,
      });
    };

    add("harmony.chromatic_color", features.harmony.chromaticColorRatio);
    add("harmony.chord_density", features.harmony.chordDensity);
    add("harmony.non_diatonic_tolerance", features.harmony.borrowedChordRatio);

    if (Object.keys(features.harmony.cadenceTypeDistribution).length > 0) {
      const total = Object.values(features.harmony.cadenceTypeDistribution).reduce((a, b) => a + b, 0);
      const mass: Record<string, string> = {};
      for (const [type, count] of Object.entries(features.harmony.cadenceTypeDistribution)) {
        mass[type] = String(total > 0 ? count / total : 0);
      }
      evidence.push({
        id: randomUUID(),
        type: "confirmed_export_diff" as const,
        paramKey: "harmony.modal_preference",
        categoryMass: mass,
        context: ctx,
        sourceQuality: EVIDENCE_WEIGHTS.confirmed_export_diff,
        timestamp: now,
        ref: exportRef,
        confirmed: false,
      });
    } else {
      add("harmony.modal_preference", 0.35);
    }

    add("melody.range_width", features.melody.rangeWidth);
    add("melody.leap_ratio", features.melody.leapRatio);
    add("melody.repetition_tolerance", features.melody.phraseEndPitch);

    add("rhythm.syncopation", features.rhythm.syncopationRatio);
    add("rhythm.swing_amount", features.rhythm.swingAmount);
    add("rhythm.polyrhythm_tendency", features.rhythm.grooveDensity);

    add("texture.density", features.texture.density);
    add("texture.pad_layering", features.texture.padLayering);

    add("timbre.brightness", features.timbre.brightness);
    add("timbre.transient_softness", features.timbre.transientSoftness);

    add("form.section_contrast", features.form.sectionContrast);
    add("form.bridge_length", features.form.bridgeLength);

    add("mix.reverb_amount", features.mix.reverbAmount);
    add("mix.compression_tendency", features.mix.compressionTendency);
    add("mix.stereo_width", features.mix.stereoWidth);

    addBernoulli("reject.triplet_fill_before_drop", features.reject.tripletFillBeforeDrop);
    addBernoulli("reject.excessive_sidechain", features.reject.excessiveSidechain);

    return evidence;
  }
}

// === Harmony helpers ===

function computeChromaticColorRatio(notes: NoteEvent[], tempoMap?: TempoMap): number {
  if (notes.length === 0) return 0;
  let nonDiatonic = 0;
  for (const note of notes) {
    const key = keyAtOrDefault(tempoMap, note.bar);
    const diatonic = diatonicPcs(key.tonic, key.mode);
    if (!diatonic.has(((note.pitchMidi % 12) + 12) % 12)) {
      nonDiatonic++;
    }
  }
  return safeRatio(nonDiatonic, notes.length);
}

function computeChordDensity(notes: NoteEvent[], harmonyPlan?: HarmonyPlan): number {
  if (harmonyPlan) {
    const entries = harmonyPlan.getAllEntries();
    if (entries.length === 0) return 0;
    const bars = new Set(entries.map((e) => e.bar));
    const uniqueBars = Math.max(1, bars.size);
    return clamp01(entries.length / (uniqueBars * 4));
  }
  if (notes.length === 0) return 0;
  const totalBars = getTotalBars(notes);
  const barSet = new Map<number, Set<number>>();
  for (const note of notes) {
    if (!barSet.has(note.bar)) barSet.set(note.bar, new Set());
    barSet.get(note.bar)!.add(((note.pitchMidi % 12) + 12) % 12);
  }
  let chordChanges = 0;
  const bars = [...new Set(notes.map((n) => n.bar))].sort();
  for (let i = 1; i < bars.length; i++) {
    const prev = barSet.get(bars[i - 1]);
    const curr = barSet.get(bars[i]);
    if (prev && curr && !setsEqual(prev, curr)) {
      chordChanges++;
    }
  }
  return clamp01(chordChanges / Math.max(1, totalBars * 4));
}

function computeBorrowedChordRatio(
  notes: NoteEvent[],
  tempoMap?: TempoMap,
  harmonyPlan?: HarmonyPlan
): number {
  if (!harmonyPlan) return 0;
  const entries = harmonyPlan.getAllEntries();
  if (entries.length === 0) return 0;
  let borrowed = 0;
  for (const entry of entries) {
    const key = keyAtOrDefault(tempoMap, entry.bar);
    const diatonic = diatonicPcs(key.tonic, key.mode);
    const rootPc = noteToPc(entry.chord.root);
    if (!diatonic.has(rootPc)) {
      borrowed++;
    }
  }
  return safeRatio(borrowed, entries.length);
}

function computeCadenceDistribution(
  harmonyPlan?: HarmonyPlan
): Record<string, number> {
  if (!harmonyPlan) return {};
  const cadences = harmonyPlan.detectCadences();
  const dist: Record<string, number> = {};
  for (const c of cadences) {
    dist[c.type] = (dist[c.type] ?? 0) + 1;
  }
  return dist;
}

// === Melody helpers ===

function computeRangeWidth(notes: NoteEvent[]): number {
  const pitches = notes.map((n) => n.pitchMidi);
  if (pitches.length === 0) return 0;
  const min = Math.min(...pitches);
  const max = Math.max(...pitches);
  return clamp01((max - min) / 48);
}

function computeIntervalRatios(
  notes: NoteEvent[]
): { leapRatio: number; stepRatio: number } {
  const sorted = [...notes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  if (sorted.length < 2) return { leapRatio: 0, stepRatio: 0 };
  let leaps = 0;
  let steps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const interval = Math.abs(sorted[i].pitchMidi - sorted[i - 1].pitchMidi);
    if (interval >= 5) leaps++;
    if (interval <= 2 && interval > 0) steps++;
  }
  const total = sorted.length - 1;
  return {
    leapRatio: safeRatio(leaps, total),
    stepRatio: safeRatio(steps, total),
  };
}

function computePhraseEndStability(notes: NoteEvent[]): number {
  const phraseMap = new Map<string, NoteEvent[]>();
  for (const note of notes) {
    const pid = note.phraseId ?? "_default";
    if (!phraseMap.has(pid)) phraseMap.set(pid, []);
    phraseMap.get(pid)!.push(note);
  }
  const endPitches: number[] = [];
  for (const [, phraseNotes] of phraseMap) {
    const sorted = [...phraseNotes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
    if (sorted.length > 0) {
      endPitches.push(sorted[sorted.length - 1].pitchMidi);
    }
  }
  if (endPitches.length < 2) return 0.5;
  const mean = endPitches.reduce((a, b) => a + b, 0) / endPitches.length;
  const variance = endPitches.reduce((sum, p) => sum + (p - mean) ** 2, 0) / endPitches.length;
  const std = Math.sqrt(variance);
  return clamp01(1 - std / 24);
}

// === Rhythm helpers ===

function computeSyncopationRatio(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  let sync = 0;
  for (const note of notes) {
    const fracBeat = note.beat - Math.floor(note.beat);
    if (fracBeat > 0.2 && fracBeat < 0.8) {
      sync++;
    }
  }
  return safeRatio(sync, notes.length);
}

function computeSwingAmount(notes: NoteEvent[]): number {
  if (notes.length < 4) return 0;
  const evenEighthOffsets: number[] = [];
  for (const note of notes) {
    const frac = note.beat - Math.floor(note.beat);
    const isEighth = Math.abs(frac - 0.5) < 0.05;
    if (isEighth) {
      evenEighthOffsets.push(Math.abs(frac - 0.5));
    }
  }
  if (evenEighthOffsets.length === 0) return 0;
  const avgOffset = evenEighthOffsets.reduce((a, b) => a + b, 0) / evenEighthOffsets.length;
  const swing = avgOffset > 0.02 ? 1 - avgOffset / 0.15 : 0;
  return clamp01(swing);
}

function computeRestDensity(notes: NoteEvent[]): number {
  if (notes.length < 2) return 0;
  const sorted = [...notes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  let totalDur = 0;
  let gapDur = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev.bar * 4 + prev.beat - 1 + prev.durQn;
    const currStart = curr.bar * 4 + curr.beat - 1;
    if (currStart > prevEnd) {
      gapDur += currStart - prevEnd;
    }
    totalDur += prev.durQn;
  }
  totalDur += sorted[sorted.length - 1].durQn;
  if (totalDur + gapDur <= 0) return 0;
  return clamp01(gapDur / (totalDur + gapDur));
}

function computeGrooveDensity(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  const drumNotes = notes.filter((n) => n.pitchMidi <= 72);
  const others = notes.filter((n) => n.pitchMidi > 72);
  const total = notes.length;
  return safeRatio(drumNotes.length, total);
}

// === Texture helpers ===

function computeDensity(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  const timeline = new Map<number, number>();
  for (const note of notes) {
    const pos = note.bar * 4 + note.beat;
    const end = pos + note.durQn;
    for (let t = Math.floor(pos); t < Math.ceil(end); t++) {
      timeline.set(t, (timeline.get(t) ?? 0) + 1);
    }
  }
  if (timeline.size === 0) return 0;
  const values = [...timeline.values()];
  const avgSimultaneous = values.reduce((a, b) => a + b, 0) / values.length;
  return clamp01(avgSimultaneous / 16);
}

function computePadLayering(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  const longNotes = notes.filter((n) => n.durQn > 2);
  return safeRatio(longNotes.length, notes.length);
}

function computeOstinatoLevel(notes: NoteEvent[]): number {
  if (notes.length < 4) return 0;
  const sorted = [...notes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  let repeatCount = 0;
  let windowSize = 4;
  for (let i = 0; i <= sorted.length - windowSize; i++) {
    const window = sorted.slice(i, i + windowSize);
    let repeats = 0;
    for (let j = i + windowSize; j <= sorted.length - windowSize; j += windowSize) {
      const candidate = sorted.slice(j, j + windowSize);
      if (isPitchPatternMatch(window, candidate)) {
        repeats++;
      }
    }
    repeatCount = Math.max(repeatCount, repeats);
  }
  return clamp01(repeatCount / 8);
}

function isPitchPatternMatch(a: NoteEvent[], b: NoteEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pitchMidi !== b[i].pitchMidi) return false;
  }
  return true;
}

function computeVoiceIndependence(notes: NoteEvent[]): number {
  const voices = new Set(notes.map((n) => n.voice));
  if (voices.size <= 1) return 0;
  return clamp01((voices.size - 1) / 3);
}

// === Timbre helpers ===

function computeBrightness(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0;
  const bright = notes.filter((n) => n.pitchMidi > 72);
  return safeRatio(bright.length, notes.length);
}

function computeTransientSoftness(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0.5;
  const avgVel = notes.reduce((sum, n) => sum + (n.velocity ?? 0.8), 0) / notes.length;
  return clamp01(1 - avgVel);
}

// === Form helpers ===

function groupByPhrase(notes: NoteEvent[]): NoteEvent[][] {
  const map = new Map<string, NoteEvent[]>();
  for (const note of notes) {
    const pid = note.phraseId ?? "_default";
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(note);
  }
  const groups = [...map.values()].filter((g) => g.length > 0);
  groups.sort((a, b) => {
    const aFirst = a.reduce((min, n) => Math.min(min, n.bar * 4 + n.beat), Infinity);
    const bFirst = b.reduce((min, n) => Math.min(min, n.bar * 4 + n.beat), Infinity);
    return aFirst - bFirst;
  });
  return groups;
}

function phraseDensity(phrase: NoteEvent[]): number {
  if (phrase.length === 0) return 0;
  const bars = new Set(phrase.map((n) => n.bar));
  return phrase.length / Math.max(1, bars.size);
}

function computeSectionContrast(notes: NoteEvent[]): number {
  const phrases = groupByPhrase(notes);
  if (phrases.length < 2) return 0;
  const densities = phrases.map(phraseDensity);
  let totalContrast = 0;
  let comparisons = 0;
  for (let i = 1; i < densities.length; i++) {
    const diff = Math.abs(densities[i] - densities[i - 1]);
    totalContrast += diff;
    comparisons++;
  }
  if (comparisons === 0) return 0;
  const avgContrast = totalContrast / comparisons;
  return clamp01(avgContrast / 8);
}

function computeBridgeLength(notes: NoteEvent[]): number {
  const totalBars = getTotalBars(notes);
  if (totalBars <= 1) return 0;
  const phrases = groupByPhrase(notes);
  if (phrases.length < 3) return 0;
  const midIdx = Math.floor(phrases.length / 2);
  const midPhrase = phrases[midIdx];
  const midBars = new Set(midPhrase.map((n) => n.bar));
  return clamp01(midBars.size / totalBars);
}

function computeIntroOutro(notes: NoteEvent[]): { hasIntro: boolean; hasOutro: boolean } {
  const phrases = groupByPhrase(notes);
  if (phrases.length === 0) return { hasIntro: false, hasOutro: false };
  if (phrases.length === 1) {
    return { hasIntro: false, hasOutro: false };
  }
  const avgDensity = phraseDensity(
    phrases.flatMap((p) => p)
  ) / Math.max(1, phrases.length);
  const firstDensity = phraseDensity(phrases[0]);
  const lastDensity = phraseDensity(phrases[phrases.length - 1]);
  const totalBars = getTotalBars(notes);
  const firstBars = new Set(phrases[0].map((n) => n.bar));
  const lastBars = new Set(phrases[phrases.length - 1].map((n) => n.bar));

  return {
    hasIntro: (firstBars.size <= totalBars * 0.15 && firstDensity < avgDensity * 0.8),
    hasOutro: (lastBars.size <= totalBars * 0.15 && lastDensity < avgDensity * 0.8),
  };
}

// === Mix helpers ===

function computeReverbAmount(notes: NoteEvent[]): number {
  if (notes.length < 2) return 0.3;
  const velocities = notes.map((n) => n.velocity ?? 0.8);
  const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const variance = velocities.reduce((s, v) => s + (v - mean) ** 2, 0) / velocities.length;
  return clamp01(variance / 0.25);
}

function computeCompressionTendency(notes: NoteEvent[]): number {
  if (notes.length < 2) return 0.4;
  const velocities = notes.map((n) => n.velocity ?? 0.8);
  const min = Math.min(...velocities);
  const max = Math.max(...velocities);
  const range = max - min;
  return clamp01(1 - range);
}

function computeStereoWidth(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0.5;
  const tracks = new Set(notes.map((n) => n.trackId));
  const voices = new Set(notes.map((n) => n.voice));
  const diversity = (tracks.size + voices.size) / 4 + 0.25;
  return clamp01(diversity);
}

// === Reject helpers ===

function computeTripletFillBeforeDrop(notes: NoteEvent[]): number {
  if (notes.length < 3) return 0;
  const sorted = [...notes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
  for (let i = 0; i < sorted.length - 2; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const c = sorted[i + 2];
    const durs = [a.durQn, b.durQn, c.durQn];
    const allShort = durs.every((d) => d >= 0.25 && d <= 0.4);
    const spacing1 = (b.bar - a.bar) * 4 + (b.beat - a.beat);
    const spacing2 = (c.bar - b.bar) * 4 + (c.beat - b.beat);
    const evenSpacing = Math.abs(spacing1 - spacing2) < 0.15 && spacing1 > 0;
    if (allShort && evenSpacing) {
      return 1;
    }
  }
  return 0;
}

function computeExcessiveSidechain(notes: NoteEvent[]): number {
  const bassNotes = notes.filter((n) => n.pitchMidi < 48).sort(
    (a, b) => a.bar - b.bar || a.beat - b.beat
  );
  if (bassNotes.length < 4) return 0;
  let oscillationCount = 0;
  for (let i = 1; i < bassNotes.length - 1; i++) {
    const prev = bassNotes[i - 1].velocity ?? 0.8;
    const curr = bassNotes[i].velocity ?? 0.8;
    const next = bassNotes[i + 1].velocity ?? 0.8;
    if (curr < prev * 0.6 && next > curr * 1.4) {
      oscillationCount++;
    }
  }
  return oscillationCount >= 2 ? 1 : 0;
}

// === Utility ===

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
