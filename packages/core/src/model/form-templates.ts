import {
  FormRole,
  FormStructure,
  createFormStructure,
  createSection,
  addSectionToForm,
} from "./section";

export interface FormTemplate {
  name: string;
  description: string;
  sections: { role: FormRole; bars: number; energy: number }[];
}

export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  pop_ababcb: {
    name: "Pop ABABCB",
    description: "Verse-Chorus alternating with a bridge and final chorus",
    sections: [
      { role: FormRole.Verse, bars: 8, energy: 0.3 },
      { role: FormRole.Chorus, bars: 8, energy: 0.7 },
      { role: FormRole.Verse, bars: 8, energy: 0.35 },
      { role: FormRole.Chorus, bars: 8, energy: 0.75 },
      { role: FormRole.Bridge, bars: 8, energy: 0.5 },
      { role: FormRole.Chorus, bars: 8, energy: 0.8 },
    ],
  },

  electronic_buildup: {
    name: "Electronic Buildup",
    description: "Intro, two buildups and drops with breakdown",
    sections: [
      { role: FormRole.Intro, bars: 8, energy: 0.2 },
      { role: FormRole.BuildUp, bars: 16, energy: 0.1 },
      { role: FormRole.Drop, bars: 16, energy: 0.9 },
      { role: FormRole.Breakdown, bars: 8, energy: 0.2 },
      { role: FormRole.BuildUp, bars: 8, energy: 0.15 },
      { role: FormRole.Drop, bars: 16, energy: 0.95 },
      { role: FormRole.Outro, bars: 8, energy: 0.1 },
    ],
  },

  cinematic_arc: {
    name: "Cinematic Arc",
    description: "Full orchestral arc with intro, solo, and outro",
    sections: [
      { role: FormRole.Intro, bars: 4, energy: 0.1 },
      { role: FormRole.Verse, bars: 8, energy: 0.25 },
      { role: FormRole.Chorus, bars: 8, energy: 0.6 },
      { role: FormRole.Verse, bars: 8, energy: 0.3 },
      { role: FormRole.Bridge, bars: 8, energy: 0.45 },
      { role: FormRole.Chorus, bars: 8, energy: 0.7 },
      { role: FormRole.Solo, bars: 8, energy: 0.85 },
      { role: FormRole.Chorus, bars: 8, energy: 0.9 },
      { role: FormRole.Outro, bars: 4, energy: 0.1 },
    ],
  },

  minimal: {
    name: "Minimal",
    description: "A simple Verse-Chorus cycle",
    sections: [
      { role: FormRole.Verse, bars: 8, energy: 0.35 },
      { role: FormRole.Chorus, bars: 8, energy: 0.7 },
    ],
  },
};

export function getTemplate(name: string): FormTemplate | undefined {
  return FORM_TEMPLATES[name];
}

export function listTemplates(): FormTemplate[] {
  return Object.values(FORM_TEMPLATES);
}

export function applyTemplate(template: FormTemplate): FormStructure {
  const form = createFormStructure(template.name);

  let cursor = 1;
  for (const s of template.sections) {
    const section = createSection({
      name: formatSectionName(s.role, cursor),
      formRole: s.role,
      startBar: cursor,
      endBar: cursor + s.bars - 1,
      energyLevel: s.energy,
    });
    addSectionToForm(form, section);
    cursor += s.bars;
  }

  return form;
}

function formatSectionName(role: FormRole, bar: number): string {
  const roleName = role.charAt(0).toUpperCase() + role.slice(1);
  return `${roleName}@${bar}`;
}
