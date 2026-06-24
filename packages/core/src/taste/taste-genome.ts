import { randomUUID } from "../util/random-uuid";
import { z } from "zod";
import {
  TasteDomain,
  type TasteParameter,
} from "./taste-types";
import { TasteGenomeSchema } from "./zod-schemas";

export type TasteGenomeData = z.infer<typeof TasteGenomeSchema>;

function generateId(): string {
  return randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function betaParam(alpha: number, beta: number) {
  return {
    family: "beta" as const,
    alpha: String(alpha),
    beta: String(beta),
  };
}

function bernParam(p: number) {
  return {
    family: "bernoulli" as const,
    p: String(p),
  };
}

function dirichParam(alphas: Record<string, number>) {
  const stringAlphas: Record<string, string> = {};
  for (const [k, v] of Object.entries(alphas)) {
    stringAlphas[k] = String(v);
  }
  return {
    family: "dirichlet" as const,
    alphas: stringAlphas,
  };
}

function defaultParam(
  key: string,
  defaultValue: string,
  distribution: TasteParameter["distribution"]
): TasteParameter {
  return {
    value: defaultValue,
    distribution,
    confidence: "0.50",
    context: {},
    evidence: [],
    timeDecay: { policy: "slow_exp", lambda: "0.001" },
    lastUpdatedAt: now(),
  };
}

// === Embedding Layer ===

export interface EmbeddingLayer {
  symbolicEmbeddingRef?: string;
  audioEmbeddingRef?: string;
  tagLayer: { tag: string; strength: string }[];
}

// === Genome ===

export class TasteGenome {
  private data: TasteGenomeData;

  constructor(genomeId?: string) {
    this.data = {
      genomeId: genomeId ?? generateId(),
      version: 0,
      numericEncoding: "decimal128_string",
      updatedAt: now(),
      domains: {},
      embeddingLayer: { tagLayer: [] },
    };
  }

  // ─── Accessors ──────────────────────────────────────────────

  get genomeId(): string {
    return this.data.genomeId;
  }

  get version(): number {
    return this.data.version;
  }

  get domains(): Record<string, TasteParameter> {
    return this.data.domains;
  }

  get embeddingLayer(): EmbeddingLayer {
    return this.data.embeddingLayer;
  }

  // ─── Parameter operations ───────────────────────────────────

  getParameter(key: string): TasteParameter | undefined {
    return this.data.domains[key];
  }

  setParameter(key: string, param: TasteParameter): void {
    this.data.domains[key] = {
      ...param,
      lastUpdatedAt: now(),
    };
  }

  removeParameter(key: string): void {
    delete this.data.domains[key];
  }

  listParameters(domain?: TasteDomain): [string, TasteParameter][] {
    const entries = Object.entries(this.data.domains);
    if (!domain) return entries;
    const prefix = domain + ".";
    return entries.filter(([key]) => key.startsWith(prefix));
  }

  // ─── Version management ─────────────────────────────────────

  incrementVersion(): void {
    this.data.version += 1;
    this.data.updatedAt = now();
  }

  // ─── Serialization ──────────────────────────────────────────

  toJSON(): TasteGenomeData {
    return structuredClone(this.data);
  }

  static fromJSON(json: unknown): TasteGenome {
    const parsed = TasteGenomeSchema.parse(json);
    const genome = new TasteGenome(parsed.genomeId);
    genome.data = parsed;
    return genome;
  }

  // ─── Factory ────────────────────────────────────────────────

  static create(genomeId?: string): TasteGenome {
    return new TasteGenome(genomeId);
  }

  static createDefault(): TasteGenome {
    const genome = new TasteGenome();

    const defaults: [string, string, TasteParameter["distribution"]][] = [
      // Harmony
      ["harmony.chromatic_color", "0.33", betaParam(5, 10)],
      ["harmony.chord_density", "0.40", betaParam(4, 6)],
      ["harmony.non_diatonic_tolerance", "0.25", betaParam(3, 9)],
      ["harmony.modal_preference", "0.35", dirichParam({ major: 5, minor: 8, dorian: 3, mixolydian: 2, lydian: 1, phrygian: 1 })],
      // Melody
      ["melody.range_width", "0.58", betaParam(7, 5)],
      ["melody.leap_ratio", "0.25", betaParam(3, 9)],
      ["melody.repetition_tolerance", "0.60", betaParam(6, 4)],
      // Rhythm
      ["rhythm.syncopation", "0.50", betaParam(3, 3)],
      ["rhythm.swing_amount", "0.20", betaParam(2, 8)],
      ["rhythm.polyrhythm_tendency", "0.18", betaParam(2, 9)],
      // Texture
      ["texture.density", "0.50", betaParam(5, 5)],
      ["texture.pad_layering", "0.40", betaParam(4, 6)],
      // Timbre
      ["timbre.brightness", "0.60", betaParam(6, 4)],
      ["timbre.transient_softness", "0.50", betaParam(5, 5)],
      // Form
      ["form.section_contrast", "0.50", betaParam(4, 4)],
      ["form.bridge_length", "0.375", betaParam(3, 5)],
      // Mix
      ["mix.reverb_amount", "0.30", betaParam(3, 7)],
      ["mix.compression_tendency", "0.40", betaParam(4, 6)],
      ["mix.stereo_width", "0.55", betaParam(5, 5)],
      // Reject
      ["reject.triplet_fill_before_drop", "0.10", bernParam(0.1)],
      ["reject.excessive_sidechain", "0.30", bernParam(0.3)],
    ];

    for (const [key, value, distribution] of defaults) {
      const param = defaultParam(key, value, distribution);
      param.confidence = "0.20";
      genome.setParameter(key, param);
    }

    return genome;
  }

  // ─── Query helpers ──────────────────────────────────────────

  getEffectiveGenome(overlay?: Record<string, string>): TasteGenome {
    const effective = new TasteGenome(this.data.genomeId);
    effective.data.domains = structuredClone(this.data.domains);
    effective.data.version = this.data.version;
    effective.data.updatedAt = this.data.updatedAt;
    effective.data.embeddingLayer = structuredClone(this.data.embeddingLayer);

    if (overlay) {
      for (const [key, value] of Object.entries(overlay)) {
        const existing = effective.data.domains[key];
        if (existing) {
          effective.data.domains[key] = {
            ...existing,
            value,
            confidence: "0.80",
            context: { ...existing.context, task: "overlay" },
            lastUpdatedAt: now(),
          };
        }
      }
    }

    return effective;
  }

  clone(): TasteGenome {
    return TasteGenome.fromJSON(this.toJSON());
  }
}
