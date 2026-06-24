import { randomUUID } from "../util/random-uuid";
import { SectionSchema } from "./zod-schemas";
export { FormRole } from "./form-role";
import { FormRole } from "./form-role";

export interface Section {
  id: string;
  name: string;
  formRole: FormRole;
  startBar: number;
  endBar: number;
  energyLevel: number;
  motifIds: string[];
  phraseIds: string[];
  description?: string;
}

export interface FormStructure {
  id: string;
  name: string;
  sections: Section[];
  timeSignature: { numerator: number; denominator: number };
  tempoMapRef?: string;
  createdAt: string;
}

export function createSection(
  partial: Partial<Section> & Pick<Section, "startBar" | "endBar">
): Section {
  return {
    id: partial.id ?? randomUUID(),
    name: partial.name ?? `Section ${partial.startBar}-${partial.endBar}`,
    formRole: partial.formRole ?? FormRole.Verse,
    startBar: partial.startBar,
    endBar: partial.endBar,
    energyLevel: partial.energyLevel ?? 0.5,
    motifIds: partial.motifIds ?? [],
    phraseIds: partial.phraseIds ?? [],
    description: partial.description,
  };
}

export function sectionToNode(section: Section): {
  type: string;
  data: Record<string, unknown>;
} {
  return {
    type: "Section",
    data: JSON.parse(JSON.stringify(section)) as Record<string, unknown>,
  };
}

export function nodeToSection(data: Record<string, unknown>): Section {
  const result = SectionSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid Section data: ${result.error.message}`);
  }
  return result.data;
}

export function createFormStructure(name: string): FormStructure {
  return {
    id: randomUUID(),
    name,
    sections: [],
    timeSignature: { numerator: 4, denominator: 4 },
    createdAt: new Date().toISOString(),
  };
}

export function addSectionToForm(
  form: FormStructure,
  section: Section
): void {
  form.sections.push(section);
  form.sections.sort((a, b) => a.startBar - b.startBar);
}

export function removeSection(
  form: FormStructure,
  sectionId: string
): void {
  form.sections = form.sections.filter((s) => s.id !== sectionId);
}

export function getSectionsByRole(
  form: FormStructure,
  role: FormRole
): Section[] {
  return form.sections.filter((s) => s.formRole === role);
}

export function getTotalBars(form: FormStructure): number {
  if (form.sections.length === 0) return 0;
  return Math.max(...form.sections.map((s) => s.endBar));
}
