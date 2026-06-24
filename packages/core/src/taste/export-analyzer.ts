import type { NoteEvent } from "../model/note-event";
import { TempoMap } from "../model/tempo-map";
import { HarmonyPlan } from "../model/harmony-plan";
import { EvidenceExtractor, type ExtractedFeatures } from "./evidence-extractor";
import type { TasteEvidence, TasteParameter } from "./taste-types";
import { TasteDomain } from "./taste-types";
import { TasteGenome } from "./taste-genome";
import type { Distribution } from "./taste-types";
import { randomUUID } from "../util/random-uuid";

export interface GenomeComparison {
  paramKey: string;
  currentValue: string;
  genomeValue: string;
  genomeMean: string;
  genomeStd: string;
  deviation: number;
  domain: TasteDomain;
}

export interface ExportAnalysisResult {
  exportId: string;
  exportRef: string;
  timestamp: string;
  features: ExtractedFeatures;
  evidenceSet: TasteEvidence[];
  genomeComparison: GenomeComparison[];
  tasteDiffSummary: string;
}

const FEATURE_PARAM_MAP: {
  paramKey: string;
  domain: TasteDomain;
  extract: (f: ExtractedFeatures) => number;
}[] = [
  { paramKey: "harmony.chromatic_color", domain: TasteDomain.Harmony, extract: (f) => f.harmony.chromaticColorRatio },
  { paramKey: "harmony.chord_density", domain: TasteDomain.Harmony, extract: (f) => f.harmony.chordDensity },
  { paramKey: "harmony.non_diatonic_tolerance", domain: TasteDomain.Harmony, extract: (f) => f.harmony.borrowedChordRatio },
  { paramKey: "melody.range_width", domain: TasteDomain.Melody, extract: (f) => f.melody.rangeWidth },
  { paramKey: "melody.leap_ratio", domain: TasteDomain.Melody, extract: (f) => f.melody.leapRatio },
  { paramKey: "melody.repetition_tolerance", domain: TasteDomain.Melody, extract: (f) => f.melody.phraseEndPitch },
  { paramKey: "rhythm.syncopation", domain: TasteDomain.Rhythm, extract: (f) => f.rhythm.syncopationRatio },
  { paramKey: "rhythm.swing_amount", domain: TasteDomain.Rhythm, extract: (f) => f.rhythm.swingAmount },
  { paramKey: "rhythm.polyrhythm_tendency", domain: TasteDomain.Rhythm, extract: (f) => f.rhythm.grooveDensity },
  { paramKey: "texture.density", domain: TasteDomain.Texture, extract: (f) => f.texture.density },
  { paramKey: "texture.pad_layering", domain: TasteDomain.Texture, extract: (f) => f.texture.padLayering },
  { paramKey: "timbre.brightness", domain: TasteDomain.Timbre, extract: (f) => f.timbre.brightness },
  { paramKey: "timbre.transient_softness", domain: TasteDomain.Timbre, extract: (f) => f.timbre.transientSoftness },
  { paramKey: "form.section_contrast", domain: TasteDomain.Form, extract: (f) => f.form.sectionContrast },
  { paramKey: "form.bridge_length", domain: TasteDomain.Form, extract: (f) => f.form.bridgeLength },
  { paramKey: "mix.reverb_amount", domain: TasteDomain.Mix, extract: (f) => f.mix.reverbAmount },
  { paramKey: "mix.compression_tendency", domain: TasteDomain.Mix, extract: (f) => f.mix.compressionTendency },
  { paramKey: "mix.stereo_width", domain: TasteDomain.Mix, extract: (f) => f.mix.stereoWidth },
  { paramKey: "reject.triplet_fill_before_drop", domain: TasteDomain.Reject, extract: (f) => f.reject.tripletFillBeforeDrop },
  { paramKey: "reject.excessive_sidechain", domain: TasteDomain.Reject, extract: (f) => f.reject.excessiveSidechain },
];

function distributionMean(dist: Distribution): number {
  switch (dist.family) {
    case "beta": {
      const a = parseFloat(dist.alpha);
      const b = parseFloat(dist.beta);
      return a / (a + b);
    }
    case "bernoulli":
      return parseFloat(dist.p);
    case "gaussian":
      return parseFloat(dist.mean);
    case "dirichlet": {
      let maxVal = 0;
      for (const v of Object.values(dist.alphas)) {
        maxVal = Math.max(maxVal, parseFloat(v));
      }
      return maxVal;
    }
    case "von_mises":
      return parseFloat(dist.mu);
    default:
      return 0.5;
  }
}

function distributionStd(dist: Distribution): number {
  switch (dist.family) {
    case "beta": {
      const a = parseFloat(dist.alpha);
      const b = parseFloat(dist.beta);
      const denominator = (a + b) ** 2 * (a + b + 1);
      if (denominator <= 0) return 0.25;
      return Math.sqrt((a * b) / denominator);
    }
    case "bernoulli": {
      const p = parseFloat(dist.p);
      return Math.sqrt(p * (1 - p));
    }
    case "gaussian":
      return Math.sqrt(Math.max(0, parseFloat(dist.variance)));
    case "von_mises": {
      const k = parseFloat(dist.kappa);
      if (k <= 0) return 0.5;
      return 1 / Math.sqrt(k);
    }
    default:
      return 0.25;
  }
}

export class ExportAnalyzer {
  private extractor: EvidenceExtractor;

  constructor() {
    this.extractor = new EvidenceExtractor();
  }

  analyze(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    genome: TasteGenome,
    harmonyPlan?: HarmonyPlan,
    exportRef?: string
  ): ExportAnalysisResult {
    const exportId = randomUUID();
    const ref = exportRef ?? `export://${exportId}`;
    const now = new Date().toISOString();

    const features = this.extractor.extract(notes, tempoMap, harmonyPlan);
    const evidenceSet = this.extractor.toEvidenceSet(features, ref);
    const comparisons = this.compareWithGenome(features, genome);

    return {
      exportId,
      exportRef: ref,
      timestamp: now,
      features,
      evidenceSet,
      genomeComparison: comparisons,
      tasteDiffSummary: this.generateSummary(comparisons),
    };
  }

  compareWithGenome(
    features: ExtractedFeatures,
    genome: TasteGenome
  ): GenomeComparison[] {
    const results: GenomeComparison[] = [];

    for (const mapping of FEATURE_PARAM_MAP) {
      const param = genome.getParameter(mapping.paramKey);
      const currentVal = mapping.extract(features);
      const genomeVal = param?.value ?? "0.5";
      const mean = param ? distributionMean(param.distribution) : 0.5;
      const std = param ? distributionStd(param.distribution) : 0.25;
      const deviation = std > 0 ? Math.abs(currentVal - mean) / std : 0;

      results.push({
        paramKey: mapping.paramKey,
        currentValue: String(currentVal),
        genomeValue: genomeVal,
        genomeMean: String(mean),
        genomeStd: String(std),
        deviation,
        domain: mapping.domain,
      });
    }

    return results;
  }

  generateSummary(comparisons: GenomeComparison[]): string {
    if (comparisons.length === 0) return "No comparisons available.";

    const sorted = [...comparisons].sort((a, b) => b.deviation - a.deviation);
    const top3 = sorted.slice(0, 3);
    const maxDev = top3[0];

    if (maxDev.deviation < 0.5) {
      return "This export closely matches your taste profile across all domains.";
    }

    const parts: string[] = [];

    for (const c of top3) {
      if (c.deviation < 0.5) continue;
      const paramName = c.paramKey.split(".").pop() ?? c.paramKey;
      const direction = Number(c.currentValue) > Number(c.genomeMean) ? "higher than" : "lower than";
      parts.push(
        `${paramName.replace(/_/g, " ")} is ${direction} your typical preference`
      );
    }

    if (parts.length === 0) {
      return "This export closely matches your taste profile across all domains.";
    }

    if (maxDev.deviation > 2.0) {
      parts.push("This is a significant departure from your established preferences.");
    }

    return parts.join(". ") + ".";
  }

  shouldSuggestUpdate(result: ExportAnalysisResult): boolean {
    const threshold = 2.0;
    return result.genomeComparison.some((c) => c.deviation > threshold);
  }
}
