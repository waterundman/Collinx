import { NoteEvent } from "./note-event";
import { TempoMap } from "./tempo-map";
import { HarmonyPlan } from "./harmony-plan";
import {
  FormRole,
  Section,
  FormStructure,
  createSection,
  createFormStructure,
  addSectionToForm,
} from "./section";

export interface AnalyzerConfig {
  minSectionBars: number;
  similarityThreshold: number;
  energyThreshold: number;
}

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  minSectionBars: 4,
  similarityThreshold: 0.6,
  energyThreshold: 0.15,
};

export interface SectionCandidate {
  startBar: number;
  endBar: number;
  role: FormRole;
  confidence: number;
  features: {
    noteDensity: number;
    chordChangeRate: number;
    melodyRepeatCount: number;
    avgVelocity: number;
    pitchRange: [number, number];
  };
}

interface WindowFeatures {
  noteDensity: number;
  chordChangeRate: number;
  avgVelocity: number;
  pitchRange: [number, number];
}

export class FormAnalyzer {
  private config: AnalyzerConfig;

  constructor(config?: AnalyzerConfig) {
    this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
  }

  detectSections(
    notes: NoteEvent[],
    _tempoMap: TempoMap,
    harmonyPlan?: HarmonyPlan
  ): SectionCandidate[] {
    if (notes.length === 0) return [];

    const maxBar = this.getMaxBar(notes);
    const windowSize = this.config.minSectionBars;
    if (maxBar < windowSize) {
      const features = this.featuresForRange(notes, 1, maxBar, harmonyPlan);
      return [
        {
          startBar: 1,
          endBar: maxBar,
          role: this.inferRole(features.noteDensity, features.chordChangeRate),
          confidence: 0.5,
          features,
        },
      ];
    }

    const windows = this.slideWindows(notes, harmonyPlan, maxBar, windowSize);
    const boundaries = this.findBoundaries(windows, harmonyPlan, maxBar);
    const candidates = this.candidatesFromBoundaries(
      notes,
      harmonyPlan,
      boundaries,
      maxBar
    );

    return this.refineRoles(candidates, notes);
  }

  detectForm(
    sections: SectionCandidate[]
  ): { formType: string; confidence: number } {
    if (sections.length === 0) return { formType: "unknown", confidence: 0 };

    const seq = sections.map((s) => s.role);

    if (
      this.matchSequence(seq, [
        FormRole.Verse,
        FormRole.Chorus,
        FormRole.Verse,
        FormRole.Chorus,
        FormRole.Bridge,
        FormRole.Chorus,
      ])
    ) {
      return { formType: "pop_ababcb", confidence: 0.85 };
    }

    if (
      this.matchSequence(seq, [
        FormRole.BuildUp,
        FormRole.Drop,
        FormRole.Breakdown,
        FormRole.BuildUp,
        FormRole.Drop,
      ])
    ) {
      return { formType: "electronic", confidence: 0.85 };
    }

    if (this.matchSubsequence(seq, [FormRole.Verse, FormRole.Chorus])) {
      return { formType: "pop_ababcb", confidence: 0.5 };
    }

    if (this.matchSubsequence(seq, [FormRole.BuildUp, FormRole.Drop])) {
      return { formType: "electronic", confidence: 0.5 };
    }

    const hasVerse = seq.includes(FormRole.Verse);
    const hasChorus = seq.includes(FormRole.Chorus);
    if (hasVerse && hasChorus) {
      return { formType: "pop_ababcb", confidence: 0.3 };
    }

    const hasBuildUp = seq.includes(FormRole.BuildUp);
    const hasDrop = seq.includes(FormRole.Drop);
    if (hasBuildUp && hasDrop) {
      return { formType: "electronic", confidence: 0.3 };
    }

    return { formType: "unknown", confidence: 0.2 };
  }

  computeTransitions(
    sections: SectionCandidate[]
  ): { fromBar: number; toBar: number; energyDelta: number }[] {
    const transitions: {
      fromBar: number;
      toBar: number;
      energyDelta: number;
    }[] = [];

    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1];
      const curr = sections[i];
      transitions.push({
        fromBar: prev.endBar,
        toBar: curr.startBar,
        energyDelta:
          this.estimateEnergy(curr.features) -
          this.estimateEnergy(prev.features),
      });
    }

    return transitions;
  }

  toSections(candidates: SectionCandidate[]): Section[] {
    return candidates.map((c, i) => {
      const repeatIdx = this.countPreviousSameRole(candidates, i);
      const roleName = this.formatRoleName(c.role);
      const name =
        repeatIdx > 0 ? `${roleName} ${repeatIdx + 1}` : roleName;
      return createSection({
        name,
        formRole: c.role,
        startBar: c.startBar,
        endBar: c.endBar,
        energyLevel: this.estimateEnergy(c.features),
      });
    });
  }

  toFormStructure(
    candidates: SectionCandidate[],
    name?: string
  ): FormStructure {
    const formType = this.detectForm(candidates);
    const form = createFormStructure(name ?? formType.formType);
    const sections = this.toSections(candidates);
    for (const s of sections) {
      addSectionToForm(form, s);
    }
    return form;
  }

  melodySimilarity(notesA: NoteEvent[], notesB: NoteEvent[]): number {
    if (notesA.length === 0 && notesB.length === 0) return 1;
    if (notesA.length === 0 || notesB.length === 0) return 0;

    const contourA = this.pitchContour(notesA);
    const contourB = this.pitchContour(notesB);
    const rhythmA = this.normalizedRhythm(notesA);
    const rhythmB = this.normalizedRhythm(notesB);

    const maxLen = Math.max(contourA.length, contourB.length);
    const pitchSim = this.cosineSimilarity(
      this.padOrTruncate(contourA, maxLen),
      this.padOrTruncate(contourB, maxLen)
    );
    const rhythmSim = this.cosineSimilarity(
      this.padOrTruncate(rhythmA, maxLen),
      this.padOrTruncate(rhythmB, maxLen)
    );

    return 0.6 * pitchSim + 0.4 * rhythmSim;
  }

  // ---- private helpers --------------------------------------------------------

  private getMaxBar(notes: NoteEvent[]): number {
    let max = 1;
    for (const n of notes) {
      if (n.bar > max) max = n.bar;
    }
    return max;
  }

  private notesInRange(
    notes: NoteEvent[],
    startBar: number,
    endBar: number
  ): NoteEvent[] {
    return notes.filter((n) => n.bar >= startBar && n.bar <= endBar);
  }

  private featuresForRange(
    notes: NoteEvent[],
    startBar: number,
    endBar: number,
    harmonyPlan?: HarmonyPlan
  ): SectionCandidate["features"] {
    const rangeNotes = this.notesInRange(notes, startBar, endBar);
    const span = endBar - startBar + 1;

    const noteDensity =
      span > 0 ? rangeNotes.length / span : 0;

    let chordChangeRate = 0;
    if (harmonyPlan && span > 0) {
      const entries = harmonyPlan.getEntriesInRange(startBar, endBar);
      chordChangeRate = entries.length / span;
    }

    const velocities = rangeNotes.map((n) => n.velocity);
    const avgVelocity =
      velocities.length > 0
        ? velocities.reduce((a, b) => a + b, 0) / velocities.length
        : 0;

    const pitches = rangeNotes.map((n) => n.pitchMidi);
    const pitchRange: [number, number] =
      pitches.length > 0
        ? [Math.min(...pitches), Math.max(...pitches)]
        : [60, 60];

    const melodyRepeatCount = this.computeMelodyRepeatCount(rangeNotes);

    return {
      noteDensity,
      chordChangeRate,
      melodyRepeatCount,
      avgVelocity,
      pitchRange,
    };
  }

  private slideWindows(
    notes: NoteEvent[],
    harmonyPlan: HarmonyPlan | undefined,
    maxBar: number,
    windowSize: number
  ): WindowFeatures[] {
    const results: WindowFeatures[] = [];
    for (let i = 0; i + windowSize <= maxBar; i++) {
      const start = i + 1;
      const end = i + windowSize;
      const rangeNotes = this.notesInRange(notes, start, end);
      const span = end - start + 1;

      const noteDensity =
        span > 0 ? rangeNotes.length / span : 0;

      let chordChangeRate = 0;
      if (harmonyPlan && span > 0) {
        const entries = harmonyPlan.getEntriesInRange(start, end);
        chordChangeRate = entries.length / span;
      }

      const velocities = rangeNotes.map((n) => n.velocity);
      const avgVelocity =
        velocities.length > 0
          ? velocities.reduce((a, b) => a + b, 0) / velocities.length
          : 0;

      const pitches = rangeNotes.map((n) => n.pitchMidi);
      const pitchRange: [number, number] =
        pitches.length > 0
          ? [Math.min(...pitches), Math.max(...pitches)]
          : [60, 60];

      results.push({
        noteDensity,
        chordChangeRate,
        avgVelocity,
        pitchRange,
      });
    }
    return results;
  }

  private findBoundaries(
    windows: WindowFeatures[],
    harmonyPlan: HarmonyPlan | undefined,
    _maxBar: number
  ): number[] {
    if (windows.length < 2) return [];

    const wSize = this.config.minSectionBars;
    const densities = windows.map((w) => w.noteDensity);
    const chordRates = windows.map((w) => w.chordChangeRate);

    const dDiff = this.differentiate(densities);
    const cDiff = this.differentiate(chordRates);

    const maxD = Math.max(...dDiff.map(Math.abs), 1e-9);
    const maxC = Math.max(...cDiff.map(Math.abs), 1e-9);

    const boundarySet = new Set<number>();

    for (let i = 1; i < dDiff.length; i++) {
      const score =
        0.5 * (Math.abs(dDiff[i]) / maxD) +
        0.5 * (Math.abs(cDiff[i]) / maxC);

      if (score > this.config.energyThreshold) {
        boundarySet.add(i + 1);
      }
    }

    if (harmonyPlan) {
      const cadences = harmonyPlan.detectCadences();
      for (const c of cadences) {
        const bar = c.bar;
        boundarySet.add(bar);
      }
    }

    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

    return this.filterBoundaries(boundaries, wSize);
  }

  private filterBoundaries(
    boundaries: number[],
    minGap: number
  ): number[] {
    if (boundaries.length === 0) return [];
    const result: number[] = [];
    let last = -minGap;
    for (const b of boundaries) {
      if (b - last >= minGap) {
        result.push(b);
        last = b;
      }
    }
    return result;
  }

  private candidatesFromBoundaries(
    notes: NoteEvent[],
    harmonyPlan: HarmonyPlan | undefined,
    boundaries: number[],
    maxBar: number
  ): SectionCandidate[] {
    if (boundaries.length === 0) {
      const features = this.featuresForRange(
        notes,
        1,
        maxBar,
        harmonyPlan
      );
      return [
        {
          startBar: 1,
          endBar: maxBar,
          role: this.inferRole(
            features.noteDensity,
            features.chordChangeRate
          ),
          confidence: 0.5,
          features,
        },
      ];
    }

    const candidates: SectionCandidate[] = [];
    const edges = [1, ...boundaries, maxBar + 1];

    for (let i = 0; i < edges.length - 1; i++) {
      const startBar = edges[i];
      const endBar = edges[i + 1] - 1;

      if (endBar - startBar + 1 < this.config.minSectionBars) continue;

      const features = this.featuresForRange(
        notes,
        startBar,
        endBar,
        harmonyPlan
      );
      const role = this.inferRole(
        features.noteDensity,
        features.chordChangeRate
      );

      candidates.push({
        startBar,
        endBar,
        role,
        confidence: 0.7,
        features,
      });
    }

    return candidates;
  }

  private inferRole(
    noteDensity: number,
    chordChangeRate: number
  ): FormRole {
    const combined = noteDensity * 0.6 + chordChangeRate * 0.4;

    if (combined > 4.5) return FormRole.Chorus;
    if (combined > 2.5) return FormRole.Verse;
    if (combined > 1.5) return FormRole.Bridge;
    if (combined > 0.8) return FormRole.PreChorus;
    return FormRole.Intro;
  }

  private refineRoles(
    candidates: SectionCandidate[],
    notes: NoteEvent[]
  ): SectionCandidate[] {
    if (candidates.length <= 1) return candidates;

    for (let i = 0; i < candidates.length; i++) {
      const notesA = this.notesInRange(
        notes,
        candidates[i].startBar,
        candidates[i].endBar
      );

      for (let j = i + 1; j < candidates.length; j++) {
        const notesB = this.notesInRange(
          notes,
          candidates[j].startBar,
          candidates[j].endBar
        );
        const sim = this.melodySimilarity(notesA, notesB);

        if (sim > this.config.similarityThreshold) {
          if (candidates[i].confidence >= candidates[j].confidence) {
            candidates[j] = {
              ...candidates[j],
              role: candidates[i].role,
            };
          } else {
            candidates[i] = {
              ...candidates[i],
              role: candidates[j].role,
            };
          }
        }
      }
    }

    return this.mergeAdjacentSameRole(candidates, notes);
  }

  private mergeAdjacentSameRole(
    candidates: SectionCandidate[],
    _notes: NoteEvent[]
  ): SectionCandidate[] {
    const result: SectionCandidate[] = [];
    for (const c of candidates) {
      if (result.length === 0) {
        result.push({ ...c });
        continue;
      }
      const prev = result[result.length - 1];
      if (c.role === prev.role) {
        result[result.length - 1] = {
          ...prev,
          endBar: c.endBar,
          features: {
            ...prev.features,
            noteDensity:
              (prev.features.noteDensity + c.features.noteDensity) / 2,
            chordChangeRate:
              (prev.features.chordChangeRate +
                c.features.chordChangeRate) /
              2,
            avgVelocity:
              (prev.features.avgVelocity + c.features.avgVelocity) / 2,
            pitchRange: [
              Math.min(
                prev.features.pitchRange[0],
                c.features.pitchRange[0]
              ),
              Math.max(
                prev.features.pitchRange[1],
                c.features.pitchRange[1]
              ),
            ],
            melodyRepeatCount:
              prev.features.melodyRepeatCount +
              c.features.melodyRepeatCount,
          },
        };
      } else {
        result.push({ ...c });
      }
    }
    return result;
  }

  private estimateEnergy(
    features: SectionCandidate["features"]
  ): number {
    const dNorm = Math.min(features.noteDensity / 8, 1);
    const vNorm = features.avgVelocity;
    const raw = dNorm * 0.5 + vNorm * 0.5;
    return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
  }

  private matchSequence<T>(sequence: T[], pattern: T[]): boolean {
    if (sequence.length !== pattern.length) return false;
    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] !== pattern[i]) return false;
    }
    return true;
  }

  private matchSubsequence<T>(sequence: T[], pattern: T[]): boolean {
    for (let i = 0; i <= sequence.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (sequence[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  private countPreviousSameRole(
    candidates: SectionCandidate[],
    index: number
  ): number {
    let count = 0;
    for (let i = 0; i < index; i++) {
      if (candidates[i].role === candidates[index].role) count++;
    }
    return count;
  }

  private formatRoleName(role: FormRole): string {
    switch (role) {
      case FormRole.Verse:
        return "Verse";
      case FormRole.Chorus:
        return "Chorus";
      case FormRole.Bridge:
        return "Bridge";
      case FormRole.Intro:
        return "Intro";
      case FormRole.Outro:
        return "Outro";
      case FormRole.PreChorus:
        return "Pre-Chorus";
      case FormRole.Solo:
        return "Solo";
      case FormRole.BuildUp:
        return "Build-Up";
      case FormRole.Drop:
        return "Drop";
      case FormRole.Breakdown:
        return "Breakdown";
      case FormRole.Interlude:
        return "Interlude";
      default:
        return role;
    }
  }

  private pitchContour(notes: NoteEvent[]): number[] {
    const sorted = [...notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });
    if (sorted.length === 0) return [];
    const avg =
      sorted.reduce((s, n) => s + n.pitchMidi, 0) / sorted.length;
    return sorted.map((n) => n.pitchMidi - avg);
  }

  private normalizedRhythm(notes: NoteEvent[]): number[] {
    const sorted = [...notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });
    return sorted.map((n) => n.durQn);
  }

  private padOrTruncate(arr: number[], length: number): number[] {
    if (arr.length >= length) return arr.slice(0, length);
    return [...arr, ...new Array(length - arr.length).fill(0)];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 && magB === 0) return 1;
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private differentiate(arr: number[]): number[] {
    const diff = new Array(arr.length).fill(0) as number[];
    for (let i = 1; i < arr.length; i++) {
      diff[i] = arr[i] - arr[i - 1];
    }
    return diff;
  }

  private computeMelodyRepeatCount(notes: NoteEvent[]): number {
    if (notes.length < 8) return 0;
    const sorted = [...notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });
    const pitches = sorted.map((n) => n.pitchMidi);
    let repeats = 0;
    const patternLen = 4;
    const matched = new Set<string>();

    for (let i = 0; i <= pitches.length - patternLen * 2; i++) {
      for (let j = i + patternLen; j <= pitches.length - patternLen; j++) {
        let match = true;
        for (let k = 0; k < patternLen; k++) {
          if (Math.abs(pitches[i + k] - pitches[j + k]) > 0.5) {
            match = false;
            break;
          }
        }
        const key = `${i},${j}`;
        if (match && !matched.has(key)) {
          repeats++;
          matched.add(key);
        }
      }
    }

    return repeats;
  }
}
