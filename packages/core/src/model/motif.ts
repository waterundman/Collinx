import { MotifDataSchema } from "./zod-schemas";

export interface MotifData {
  name: string;
  description?: string;
  bars: number;
  instrumentRole: string;
  tags: string[];
  noteIds: string[];
}

export function createMotif(
  partial: Partial<MotifData> & Pick<MotifData, "name" | "bars">
): MotifData {
  return {
    name: partial.name,
    description: partial.description,
    bars: partial.bars,
    instrumentRole: partial.instrumentRole ?? "melody",
    tags: partial.tags ?? [],
    noteIds: partial.noteIds ?? [],
  };
}

export function motifToNode(motif: MotifData): { type: "Motif"; data: Record<string, unknown> } {
  return {
    type: "Motif",
    data: JSON.parse(JSON.stringify(motif)) as Record<string, unknown>,
  };
}

export function nodeToMotif(data: Record<string, unknown>): MotifData {
  const result = MotifDataSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid MotifData data: ${result.error.message}`);
  }
  return result.data;
}
