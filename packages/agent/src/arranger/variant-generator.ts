import { NoteEvent, randomUUID } from "@collinx/core";
import { MotifTransformer } from "./motif-transformer";

export interface VariantConfig {
  count: number;
  variationDegree: number;
  allowedOperations?: string[];
  preserveOriginal?: boolean;
}

export interface Variant {
  id: string;
  notes: NoteEvent[];
  operations: string[];
  variationScore: number;
  description: string;
}

const ALL_OPS = [
  "transpose",
  "rhythmicVariation",
  "invert",
  "retrograde",
  "augment",
  "diminish",
  "velocityShift",
  "octaveShift",
] as const;

type OpName = (typeof ALL_OPS)[number];

export class VariantGenerator {
  generateVariants(source: NoteEvent[], config: VariantConfig): Variant[] {
    const variants: Variant[] = [];
    const allowed = config.allowedOperations ?? [...ALL_OPS];

    if (config.preserveOriginal) {
      variants.push({
        id: randomUUID(),
        notes: [...source],
        operations: [],
        variationScore: 0,
        description: "Original (no variation)",
      });
    }

    for (let i = variants.length; i < config.count; i++) {
      const { notes, opsApplied } = this.applyRandomTransforms(
        source,
        config.variationDegree,
        allowed
      );
      const score = this.computeVariationScore(source, notes);
      variants.push({
        id: randomUUID(),
        notes,
        operations: opsApplied,
        variationScore: score,
        description: opsApplied.length > 0 ? opsApplied.join(" + ") : "No variation",
      });
    }

    return variants;
  }

  private applyRandomTransforms(
    notes: NoteEvent[],
    degree: number,
    allowedOps: string[]
  ): { notes: NoteEvent[]; opsApplied: string[] } {
    const clamped = Math.max(0, Math.min(1, degree));
    if (clamped === 0) return { notes: [...notes], opsApplied: [] };

    const available = allowedOps.filter((op) => ALL_OPS.includes(op as OpName)) as OpName[];

    const opsApplied: string[] = [];
    let result = [...notes];

    if (clamped <= 0.3) {
      const opts = available.filter((o) => o === "rhythmicVariation" || o === "velocityShift");
      if (opts.length === 0) return { notes: result, opsApplied };
      const op = opts[Math.floor(Math.random() * opts.length)];
      if (op === "rhythmicVariation") {
        result = MotifTransformer.rhythmicVariation(result, clamped);
      } else {
        result = MotifTransformer.velocityShift(result, clamped * 0.4 - 0.2);
      }
      opsApplied.push(op);
    } else if (clamped <= 0.5) {
      if (available.includes("transpose")) {
        const semis = Math.floor(Math.random() * 7) - 3;
        result = MotifTransformer.transpose(result, semis);
        opsApplied.push("transpose");
      }
      if (available.includes("rhythmicVariation")) {
        result = MotifTransformer.rhythmicVariation(result, clamped * 0.5);
        opsApplied.push("rhythmicVariation");
      }
      if (opsApplied.length === 0 && available.length > 0) {
        result = MotifTransformer.rhythmicVariation(result, clamped);
        opsApplied.push("rhythmicVariation");
      }
    } else if (clamped <= 0.8) {
      const heavyOps = available.filter((o) => o === "invert" || o === "retrograde");
      const durOps = available.filter((o) => o === "augment" || o === "diminish");

      if (heavyOps.length > 0) {
        const ho = heavyOps[Math.floor(Math.random() * heavyOps.length)];
        if (ho === "invert") {
          result = MotifTransformer.invert(result);
        } else {
          result = MotifTransformer.retrograde(result);
        }
        opsApplied.push(ho);
      }

      if (durOps.length > 0) {
        const dOp = durOps[Math.floor(Math.random() * durOps.length)];
        const factor = 1.5 + Math.random() * 1.5;
        if (dOp === "augment") {
          result = MotifTransformer.augment(result, factor);
        } else {
          result = MotifTransformer.diminish(result, factor);
        }
        opsApplied.push(dOp);
      }
    } else {
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const count = Math.min(3, Math.floor(clamped * 4));
      const selected = shuffled.slice(0, count);
      for (const op of selected) {
        switch (op) {
          case "transpose":
            result = MotifTransformer.transpose(result, Math.round(clamped * 11 - 5));
            break;
          case "rhythmicVariation":
            result = MotifTransformer.rhythmicVariation(result, clamped);
            break;
          case "augment":
            result = MotifTransformer.augment(result, 1 + clamped);
            break;
          case "diminish":
            result = MotifTransformer.diminish(result, 1 + clamped);
            break;
          case "octaveShift":
            result = MotifTransformer.octaveShift(result, Math.round(clamped * 2 - 1));
            break;
          case "velocityShift":
            result = MotifTransformer.velocityShift(result, clamped * 0.4 - 0.2);
            break;
          default:
            result = (MotifTransformer as unknown as Record<string, Function>)[op](result);
            break;
        }
        opsApplied.push(op);
      }
    }

    return { notes: result, opsApplied };
  }

  private computeVariationScore(original: NoteEvent[], variant: NoteEvent[]): number {
    if (original.length === 0) return variant.length === 0 ? 0 : 1;

    let pitchDiff = 0;
    let rhythmDiff = 0;
    let posDiff = 0;
    const len = Math.max(original.length, variant.length);

    for (let i = 0; i < len; i++) {
      const o = original[i];
      const v = variant[i];
      if (o && v) {
        pitchDiff += Math.abs(o.pitchMidi - v.pitchMidi) / 88;
        rhythmDiff += Math.abs(o.durQn - v.durQn) / 4;
        const oBeats = (o.bar - 1) * 4 + (o.beat - 1);
        const vBeats = (v.bar - 1) * 4 + (v.beat - 1);
        posDiff += Math.abs(oBeats - vBeats) / 16;
      } else {
        pitchDiff += 1;
        rhythmDiff += 1;
        posDiff += 1;
      }
    }

    return Math.min(1, (pitchDiff / len + rhythmDiff / len + posDiff / len) / 3);
  }
}
