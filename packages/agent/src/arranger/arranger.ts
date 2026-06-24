import {
  type NoteEvent,
  type Section,
  type FormStructure,
  type FormTemplate,
  type DiffEnvelope,
  type CandidateFeatures,
  type TasteContext,
  type TasteGenome,
  ScoringEngine,
  EnergyCurve,
  FormRole,
  createSection,
  createFormStructure,
  addSectionToForm,
  createDiffEnvelope,
  getTemplate,
  applyTemplate,
  randomUUID,
} from "@collinx/core";
import { VariantGenerator, type Variant, type VariantConfig } from "./variant-generator";

export interface ArrangerConfig {
  formTemplate: string;
  barCount: number;
  tasteGenome?: TasteGenome;
  tasteContext?: TasteContext;
  energyTarget?: number;
  variantCount?: number;
}

export interface ArrangerResult {
  variants: Variant[];
  selectedVariant: Variant;
  diffs: DiffEnvelope[];
  formStructure: FormStructure;
  energyCurve: EnergyCurve;
  tasteScore: number;
  confidence: number;
}

export class Arranger {
  private generator: VariantGenerator;
  private scorer: ScoringEngine | null;

  constructor(scorer?: ScoringEngine) {
    this.generator = new VariantGenerator();
    this.scorer = scorer ?? null;
  }

  arrange(motifs: NoteEvent[][], config: ArrangerConfig): ArrangerResult {
    const template = getTemplate(config.formTemplate);
    if (!template) {
      throw new Error(`Form template not found: ${config.formTemplate}`);
    }

    const formStructure = applyTemplate(template);
    const allVariants: Variant[] = [];
    const allDiffs: DiffEnvelope[] = [];
    let totalScore = 0;
    let totalConfidence = 0;

    for (const section of formStructure.sections) {
      const motifIndex = this.selectMotifIndex(section, motifs.length);
      const sourceMotif = motifs[motifIndex] ?? [];

      const result = this.expandSection(sourceMotif, section, config);

      allVariants.push(...result.variants);
      allDiffs.push(...result.diffs);
      totalScore += result.tasteScore;
      totalConfidence += result.confidence;
    }

    const energyCurve = EnergyCurve.fromSections(formStructure.sections);
    const sortedVariants = this.sortByScore(allVariants);
    const sectionCount = formStructure.sections.length || 1;

    return {
      variants: sortedVariants,
      selectedVariant: sortedVariants[0] ?? this.emptyVariant(),
      diffs: allDiffs,
      formStructure,
      energyCurve,
      tasteScore: totalScore / sectionCount,
      confidence: totalConfidence / sectionCount,
    };
  }

  expandSection(
    source: NoteEvent[],
    target: Section,
    config: ArrangerConfig
  ): ArrangerResult {
    const result = this.generateVariants(source, target, config);

    if (config.tasteGenome && this.scorer) {
      const ranked = this.rankVariants(result.variants, config.tasteGenome);
      result.variants = ranked;
      result.selectedVariant = ranked[0] ?? result.selectedVariant;
      result.tasteScore = ranked[0]?.variationScore ?? 0;
    }

    return result;
  }

  generateVariants(
    source: NoteEvent[],
    section: Section,
    config: ArrangerConfig
  ): ArrangerResult {
    const count = config.variantCount ?? 3;
    const energyLevel = config.energyTarget ?? section.energyLevel;
    const variationDegree = this.computeVariationDegree(energyLevel);

    const variantConfig: VariantConfig = {
      count,
      variationDegree,
      preserveOriginal: true,
    };

    const variants = this.generator.generateVariants(source, variantConfig);

    const diffs: DiffEnvelope[] = variants.map((v) =>
      this.variantToDiff(v, `section-${section.id}`)
    );

    const energyCurve = new EnergyCurve([
      { bar: section.startBar, level: section.energyLevel },
      { bar: section.endBar, level: section.energyLevel },
    ]);

    const tasteScore = variants.length > 0 ? variants[0].variationScore : 0;

    return {
      variants,
      selectedVariant: variants[0] ?? this.emptyVariant(),
      diffs,
      formStructure: {
        id: randomUUID(),
        name: `Section ${section.name}`,
        sections: [section],
        timeSignature: { numerator: 4, denominator: 4 },
        createdAt: new Date().toISOString(),
      },
      energyCurve,
      tasteScore,
      confidence: variants.length > 0 ? 0.8 : 0,
    };
  }

  rankVariants(variants: Variant[], genome: TasteGenome): Variant[] {
    if (!this.scorer) {
      return this.sortByScore(variants);
    }

    const context: TasteContext = {};

    const candidatesList: CandidateFeatures[][] = variants.map((v) =>
      this.extractFeatures(v)
    );

    const ranked = this.scorer.rank(candidatesList, genome, context);

    return variants
      .map((v, i) => ({
        variant: v,
        score: ranked[i]?.score.totalScore ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.variant);
  }

  variantToDiff(variant: Variant, baseRevision: string): DiffEnvelope {
    return createDiffEnvelope({
      baseRevision,
      actor: { type: "agent", name: "arranger" },
      permissionScope: "proposal_only",
      summary: `Variant: ${variant.description}`,
      ops: [
        {
          op: "add_note_group",
          path: "/",
          notes: variant.notes,
        },
      ],
      domainExplanations: [
        {
          label: "operations",
          text: variant.operations.length > 0
            ? variant.operations.join(", ")
            : "original",
        },
      ],
    });
  }

  fillTemplate(template: FormTemplate, _motifs: NoteEvent[][]): FormStructure {
    return applyTemplate(template);
  }

  // ─── Private helpers ─────────────────────────────────────────

  private selectMotifIndex(section: Section, motifCount: number): number {
    if (motifCount === 0) return 0;

    const roleMap: Record<string, number> = {
      [FormRole.Intro]: 0,
      [FormRole.Verse]: 0,
      [FormRole.PreChorus]: 1,
      [FormRole.Chorus]: 1,
      [FormRole.Bridge]: motifCount > 1 ? Math.min(motifCount - 1, 2) : 0,
      [FormRole.Solo]: motifCount > 1 ? Math.min(motifCount - 1, 2) : 0,
      [FormRole.Outro]: 0,
      [FormRole.BuildUp]: 0,
      [FormRole.Drop]: 1,
      [FormRole.Breakdown]: 0,
      [FormRole.Interlude]: motifCount > 1 ? Math.min(motifCount - 1, 1) : 0,
    };

    return roleMap[section.formRole] ?? 0;
  }

  private computeVariationDegree(energyLevel: number): number {
    return Math.max(0.1, Math.min(1.0, energyLevel * 0.8 + 0.2));
  }

  private sortByScore(variants: Variant[]): Variant[] {
    return [...variants].sort((a, b) => b.variationScore - a.variationScore);
  }

  private extractFeatures(variant: Variant): CandidateFeatures[] {
    const notes = variant.notes;

    if (notes.length === 0) {
      return [];
    }

    const pitches = notes.map((n) => n.pitchMidi);
    const pitchRange = Math.max(...pitches) - Math.min(...pitches);
    const avgPitch = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    const beats = notes.map((n) => (n.bar - 1) * 4 + (n.beat - 1));
    const minBeat = Math.min(...beats);
    const maxBeat = Math.max(...beats);
    const totalBeats = maxBeat - minBeat + 1;
    const density = totalBeats > 0 ? notes.length / totalBeats : 0;

    let offBeatCount = 0;
    for (const n of notes) {
      const subBeat = (n.beat - 1) % 1;
      if (subBeat > 0.2 && subBeat < 0.8) offBeatCount++;
    }
    const syncopation = notes.length > 0 ? offBeatCount / notes.length : 0;

    let leapCount = 0;
    for (let i = 1; i < notes.length; i++) {
      if (Math.abs(notes[i].pitchMidi - notes[i - 1].pitchMidi) > 4) leapCount++;
    }
    const leapRatio = notes.length > 1 ? leapCount / (notes.length - 1) : 0;

    const uniquePitches = new Set(pitches).size;
    const repetitionTolerance = notes.length > 0 ? 1 - (uniquePitches / notes.length) : 0;

    return [
      { paramKey: "melody.range_width", value: pitchRange / 88 },
      { paramKey: "melody.leap_ratio", value: leapRatio },
      { paramKey: "melody.repetition_tolerance", value: repetitionTolerance },
      { paramKey: "rhythm.syncopation", value: syncopation },
      { paramKey: "texture.density", value: Math.min(1, density) },
      { paramKey: "timbre.brightness", value: avgPitch / 127 },
    ];
  }

  private emptyVariant(): Variant {
    return {
      id: randomUUID(),
      notes: [],
      operations: [],
      variationScore: 0,
      description: "Empty",
    };
  }
}
