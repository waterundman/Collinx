import { PhraseDataSchema } from "./zod-schemas";

export interface PhraseData {
  name: string;
  formRole: string;
  startBar: number;
  endBar: number;
  motifIds: string[];
  harmonyPlanRef?: string;
}

export function createPhrase(
  partial: Partial<PhraseData> & Pick<PhraseData, "name" | "startBar" | "endBar">
): PhraseData {
  return {
    name: partial.name,
    formRole: partial.formRole ?? "verse",
    startBar: partial.startBar,
    endBar: partial.endBar,
    motifIds: partial.motifIds ?? [],
    harmonyPlanRef: partial.harmonyPlanRef,
  };
}

export function phraseToNode(phrase: PhraseData): { type: "Phrase"; data: Record<string, unknown> } {
  return {
    type: "Phrase",
    data: JSON.parse(JSON.stringify(phrase)) as Record<string, unknown>,
  };
}

export function nodeToPhrase(data: Record<string, unknown>): PhraseData {
  const result = PhraseDataSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid PhraseData data: ${result.error.message}`);
  }
  return result.data;
}
