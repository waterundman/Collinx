import type { NoteEvent } from "./note-event";
import { TempoMap } from "./tempo-map";
import type { Player } from "./instrument";
import type {
  Layout,
  HouseStyle,
  SystemBreak,
  PartExtractionResult,
  StaffOverride,
} from "./score-model";
import { extractPartFromLayout } from "./score-model";

export interface EngravingContext {
  layout: Layout;
  notes: NoteEvent[];
  houseStyle: HouseStyle;
  tempoMap: TempoMap;
}

export interface PageBreak {
  bar: number;
  page: number;
}

export interface EngravingResult {
  pages: PageBreak[];
  systemBreaks: SystemBreak[];
  collisions: CollisionWarning[];
  staffOverrides: StaffOverride[];
}

export interface CollisionWarning {
  bar: number;
  beat: number;
  type: "note" | "slur" | "articulation" | "dynamic" | "text";
  description: string;
  severity: "warning" | "error";
  fix?: string;
}

const STAFF_HEIGHT_MM = 7;
const SYSTEM_PADDING_MM = 5;
const NOTE_SPACING_MM = 3;

export class EngravingEngine {
  autoLayout(ctx: EngravingContext): EngravingResult {
    const systemBreaks = this.computeSystemBreaks(ctx.notes, ctx.layout);
    const pages = this.computePageBreaks(systemBreaks, ctx.layout);
    const collisions = this.detectCollisions(ctx);
    const staffOverrides = this.beautify(ctx);

    return {
      pages,
      systemBreaks,
      collisions,
      staffOverrides,
    };
  }

  detectCollisions(ctx: EngravingContext): CollisionWarning[] {
    const warnings: CollisionWarning[] = [];

    const notesByBar = new Map<number, NoteEvent[]>();
    for (const note of ctx.notes) {
      const existing = notesByBar.get(note.bar) || [];
      existing.push(note);
      notesByBar.set(note.bar, existing);
    }

    for (const [bar, barNotes] of notesByBar) {
      const sorted = [...barNotes].sort((a, b) => a.beat - b.beat);

      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];

        const aEnd = a.beat + a.durQn;
        if (b.beat < aEnd) {
          if (a.pitchMidi === b.pitchMidi) {
            warnings.push({
              bar,
              beat: b.beat,
              type: "note",
              description: `Unison collision at beat ${b.beat}`,
              severity: "warning",
              fix: "Check voice assignment or shorten overlapping note",
            });
          } else if (Math.abs(a.pitchMidi - b.pitchMidi) < 2) {
            warnings.push({
              bar,
              beat: b.beat,
              type: "note",
              description: `Cluster collision (semi tone) at beat ${b.beat}`,
              severity: "warning",
              fix: "Check harmonic context",
            });
          }
        }

        if (a.pitchMidi !== -1 && b.pitchMidi !== -1 && Math.abs(a.pitchMidi - b.pitchMidi) > 24) {
          warnings.push({
            bar,
            beat: b.beat,
            type: "note",
            description: `Large interval leap (${Math.abs(a.pitchMidi - b.pitchMidi)} semitones) at beat ${b.beat}`,
            severity: "warning",
            fix: "Consider smoother voice leading",
          });
        }
      }
    }

    const noteDensityByBar = new Map<number, number>();
    for (const [bar, barNotes] of notesByBar) {
      const totalBeats = barNotes.reduce((sum, n) => sum + n.durQn, 0);
      const meter = ctx.tempoMap.meterAt(bar);
      const beatsPerBar = meter.numerator * (4 / meter.denominator);
      noteDensityByBar.set(bar, totalBeats / Math.max(1, beatsPerBar));
    }

    for (const [bar, density] of noteDensityByBar) {
      if (density > 8) {
        warnings.push({
          bar,
          beat: 1,
          type: "text",
          description: `High note density (${density.toFixed(1)}x) in bar ${bar}`,
          severity: "error",
          fix: "Consider reducing voice count or simplifying rhythm",
        });
      }
    }

    return warnings;
  }

  extractParts(
    notes: NoteEvent[],
    layout: Layout,
    players: Player[],
  ): PartExtractionResult[] {
    const results: PartExtractionResult[] = [];

    for (const playerId of layout.players) {
      results.push(extractPartFromLayout(layout, playerId, notes, players));
    }

    return results;
  }

  beautify(ctx: EngravingContext): StaffOverride[] {
    const overrides: StaffOverride[] = [];

    const targetSpacing = this.getRuleValue(ctx.houseStyle, "note.spacing", "1.0");
    for (const staff of ctx.layout.staves) {
      overrides.push({
        staffId: staff.id,
        path: "note.spacing",
        value: targetSpacing,
      });
    }

    const stemDirections = new Map<string, "up" | "down">();
    for (const note of ctx.notes) {
      const key = `${note.trackId}:${note.voice}`;
      if (!stemDirections.has(key)) {
        const voiceNum = parseInt(note.voice, 10) || 1;
        stemDirections.set(key, voiceNum === 1 ? "up" : "down");
      }
    }

    for (const staff of ctx.layout.staves) {
      for (let v = 1; v <= staff.voices; v++) {
        const voiceKey = `${staff.id}:${v}`;
        const dir = stemDirections.get(voiceKey) ?? (v === 1 ? "up" : "down");
        overrides.push({
          staffId: staff.id,
          path: `voice.${v}.stem.direction`,
          value: dir,
        });
      }
    }

    const slurThickness = this.getRuleValue(ctx.houseStyle, "slur.thickness", "0.16");
    for (const staff of ctx.layout.staves) {
      overrides.push({
        staffId: staff.id,
        path: "slur.thickness",
        value: slurThickness,
      });
    }

    return overrides;
  }

  computeSystemBreaks(notes: NoteEvent[], layout: Layout): SystemBreak[] {
    if (notes.length === 0) return [];

    const breaks: SystemBreak[] = [];

    if (layout.systemBreaks.length > 0) {
      return layout.systemBreaks;
    }

    const availableWidth = layout.pageWidth - layout.margins.left - layout.margins.right;
    const staffCount = layout.staves.length || 1;
    const totalStaffHeight = staffCount * layout.globalStaffSize + (staffCount - 1) * STAFF_HEIGHT_MM;
    const availableHeight = layout.pageHeight - layout.margins.top - layout.margins.bottom;
    const maxSystemsPerPage = Math.max(1, Math.floor(availableHeight / (totalStaffHeight + SYSTEM_PADDING_MM)));

    const notesByBar = new Map<number, NoteEvent[]>();
    let maxBar = 1;
    for (const note of notes) {
      const existing = notesByBar.get(note.bar) || [];
      existing.push(note);
      notesByBar.set(note.bar, existing);
      maxBar = Math.max(maxBar, note.bar);
    }

    const barsPerSystem = Math.max(1, Math.floor(availableWidth / (NOTE_SPACING_MM * 16)));
    let systemIndex = 0;
    for (let bar = 1; bar <= maxBar; bar += barsPerSystem) {
      if (systemIndex > 0 && systemIndex % maxSystemsPerPage === 0) {
        breaks.push({ bar, type: "page" });
      }
      breaks.push({ bar, type: "system" });
      systemIndex++;
    }

    return breaks;
  }

  estimatePages(ctx: EngravingContext): number {
    const systemBreaks = this.computeSystemBreaks(ctx.notes, ctx.layout);
    const pageBreaks = this.computePageBreaks(systemBreaks, ctx.layout);
    if (pageBreaks.length === 0) return 1;
    const maxPage = Math.max(...pageBreaks.map((p) => p.page));
    return maxPage + 1;
  }

  toMusicXMLLayout(ctx: EngravingContext): string {
    const pageWidthTenths = Math.round(ctx.layout.pageWidth * (40 / 7));
    const pageHeightTenths = Math.round(ctx.layout.pageHeight * (40 / 7));
    const marginLeftTenths = Math.round(ctx.layout.margins.left * (40 / 7));
    const marginRightTenths = Math.round(ctx.layout.margins.right * (40 / 7));
    const marginTopTenths = Math.round(ctx.layout.margins.top * (40 / 7));
    const marginBottomTenths = Math.round(ctx.layout.margins.bottom * (40 / 7));

    let xml = "<defaults>\n";
    xml += `  <scaling><millimeters>${ctx.layout.globalStaffSize.toFixed(1)}</millimeters><tenths>40</tenths></scaling>\n`;
    xml += "  <page-layout>\n";
    xml += `    <page-height>${pageHeightTenths}</page-height>\n`;
    xml += `    <page-width>${pageWidthTenths}</page-width>\n`;
    xml += "    <page-margins>\n";
    xml += `      <left-margin>${marginLeftTenths}</left-margin>\n`;
    xml += `      <right-margin>${marginRightTenths}</right-margin>\n`;
    xml += `      <top-margin>${marginTopTenths}</top-margin>\n`;
    xml += `      <bottom-margin>${marginBottomTenths}</bottom-margin>\n`;
    xml += "    </page-margins>\n";
    xml += "  </page-layout>\n";

    if (ctx.layout.systemBreaks.length > 0) {
      xml += "  <system-layout>\n";
      for (const sb of ctx.layout.systemBreaks) {
        xml += `    <system-distance>${Math.round(12 * (40 / 7))}</system-distance>\n`;
      }
      xml += "  </system-layout>\n";
    }

    xml += "  <staff-layout>\n";
    for (let i = 0; i < ctx.layout.staves.length; i++) {
      xml += `    <staff-distance>${Math.round(8 * (40 / 7))}</staff-distance>\n`;
    }
    xml += "  </staff-layout>\n";
    xml += "</defaults>";

    return xml;
  }

  private computePageBreaks(systemBreaks: SystemBreak[], layout: Layout): PageBreak[] {
    if (systemBreaks.length === 0) return [];

    const pageBreaks: PageBreak[] = [];
    const staffCount = layout.staves.length || 1;
    const totalStaffHeight =
      staffCount * layout.globalStaffSize + (staffCount - 1) * STAFF_HEIGHT_MM;
    const availableHeight =
      layout.pageHeight - layout.margins.top - layout.margins.bottom;
    const maxSystemsPerPage = Math.max(
      1,
      Math.floor(availableHeight / (totalStaffHeight + SYSTEM_PADDING_MM)),
    );

    let currentPage = 1;
    let systemsThisPage = 1;

    for (let i = 0; i < systemBreaks.length; i++) {
      const sb = systemBreaks[i];
      if (systemsThisPage >= maxSystemsPerPage) {
        currentPage++;
        systemsThisPage = 0;
      }
      pageBreaks.push({ bar: sb.bar, page: currentPage });
      systemsThisPage++;
    }

    return pageBreaks;
  }

  private getRuleValue(style: HouseStyle, path: string, fallback: string): string {
    const rule = style.rules.find((r) => r.path === path);
    return rule?.value ?? fallback;
  }
}
