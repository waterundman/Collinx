import {
  EnergyCurve,
  FormRole,
  TasteGenome,
  TasteDomain,
  type FormTemplate,
  type FormStructure,
} from "@collinx/core";

export interface EnergyProfile {
  sectionRole: FormRole;
  baseEnergy: number;
  range: [number, number];
}

export class EnergyCurvePlanner {
  static readonly ROLE_PROFILES: Record<FormRole, EnergyProfile> = {
    [FormRole.Intro]: { sectionRole: FormRole.Intro, baseEnergy: 0.25, range: [0.1, 0.4] },
    [FormRole.Verse]: { sectionRole: FormRole.Verse, baseEnergy: 0.40, range: [0.3, 0.6] },
    [FormRole.PreChorus]: { sectionRole: FormRole.PreChorus, baseEnergy: 0.60, range: [0.5, 0.8] },
    [FormRole.Chorus]: { sectionRole: FormRole.Chorus, baseEnergy: 0.85, range: [0.7, 1.0] },
    [FormRole.Bridge]: { sectionRole: FormRole.Bridge, baseEnergy: 0.50, range: [0.3, 0.7] },
    [FormRole.Solo]: { sectionRole: FormRole.Solo, baseEnergy: 0.75, range: [0.6, 0.95] },
    [FormRole.Outro]: { sectionRole: FormRole.Outro, baseEnergy: 0.30, range: [0.1, 0.5] },
    [FormRole.BuildUp]: { sectionRole: FormRole.BuildUp, baseEnergy: 0.55, range: [0.4, 0.85] },
    [FormRole.Drop]: { sectionRole: FormRole.Drop, baseEnergy: 0.95, range: [0.85, 1.0] },
    [FormRole.Breakdown]: { sectionRole: FormRole.Breakdown, baseEnergy: 0.30, range: [0.15, 0.45] },
    [FormRole.Interlude]: { sectionRole: FormRole.Interlude, baseEnergy: 0.35, range: [0.2, 0.5] },
  };

  planEnergy(template: FormTemplate): EnergyCurve {
    const curve = new EnergyCurve([], "ease_in_out");

    if (template.sections.length === 0) return curve;

    let cursor = 1;
    for (const section of template.sections) {
      const startBar = cursor;
      const endBar = cursor + section.bars - 1;
      const profile = EnergyCurvePlanner.ROLE_PROFILES[section.role];
      const baseEnergy = profile ? profile.baseEnergy : 0.5;

      const blendedEnergy =
        section.energy !== undefined
          ? baseEnergy * 0.5 + section.energy * 0.5
          : baseEnergy;

      curve.addPoint(startBar, blendedEnergy);
      curve.addPoint(endBar, blendedEnergy);

      cursor = endBar + 1;
    }

    return curve;
  }

  adaptToTaste(curve: EnergyCurve, genome: TasteGenome): EnergyCurve {
    const contrastParam = genome.getParameter("form.section_contrast");
    const contrast = contrastParam ? parseFloat(contrastParam.value) : 0.5;

    const amplification = 0.5 + contrast;

    const points = curve.getPoints();
    const adapted = new EnergyCurve([], "ease_in_out");

    for (const p of points) {
      const centered = p.level - 0.5;
      const adjusted = 0.5 + centered * amplification;
      adapted.addPoint(p.bar, Math.max(0, Math.min(1, adjusted)));
    }

    return adapted;
  }

  fromFormStructure(form: FormStructure): EnergyCurve {
    return EnergyCurve.fromSections(form.sections);
  }

  getSectionEnergy(role: FormRole): number {
    const profile = EnergyCurvePlanner.ROLE_PROFILES[role];
    return profile ? profile.baseEnergy : 0.5;
  }

  planSectionEnergy(
    role: FormRole,
    startBar: number,
    endBar: number,
    templateEnergy: number
  ): EnergyCurve {
    const profile = EnergyCurvePlanner.ROLE_PROFILES[role];
    const baseEnergy = profile ? profile.baseEnergy : 0.5;
    const energy = baseEnergy * 0.5 + templateEnergy * 0.5;

    const curve = new EnergyCurve([], "ease_in_out");
    const midBar = Math.round((startBar + endBar) / 2);

    curve.addPoint(startBar, energy * 0.9);
    curve.addPoint(midBar, energy);
    curve.addPoint(endBar, energy * 0.9);

    return curve;
  }

  planTransition(
    fromRole: FormRole,
    toRole: FormRole,
    durationBars: number
  ): EnergyCurve {
    const fromProfile = EnergyCurvePlanner.ROLE_PROFILES[fromRole];
    const toProfile = EnergyCurvePlanner.ROLE_PROFILES[toRole];

    const fromEnergy = fromProfile ? fromProfile.baseEnergy : 0.5;
    const toEnergy = toProfile ? toProfile.baseEnergy : 0.5;

    const curve = new EnergyCurve([], "ease_in_out");
    curve.addPoint(1, fromEnergy);
    curve.addPoint(durationBars, toEnergy);

    return curve;
  }
}
