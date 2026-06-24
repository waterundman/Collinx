import { randomUUID } from "../util/random-uuid";
import type { NoteEvent } from "./note-event";
import type { Player } from "./instrument";

export type ClefType = "treble" | "bass" | "alto" | "tenor" | "treble_8vb" | "bass_8vb" | "percussion";
export type Accidental = "natural" | "sharp" | "flat" | "double_sharp" | "double_flat";

export interface Staff {
  id: string;
  clef: ClefType;
  voices: number;
  lines: number;
  label?: string;
}

export interface SystemBreak {
  bar: number;
  type: "system" | "page";
}

export interface Layout {
  id: string;
  name: string;
  type: "full_score" | "part" | "custom";
  staves: Staff[];
  players: string[];
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; bottom: number; left: number; right: number };
  systemBreaks: SystemBreak[];
  globalStaffSize: number;
}

export interface EngravingRule {
  path: string;
  value: string;
}

export interface HouseStyle {
  id: string;
  name: string;
  rules: EngravingRule[];
  smuflFont: string;
}

export interface PartExtractionResult {
  partId: string;
  playerId: string;
  layout: Layout;
  notes: NoteEvent[];
  warnings: string[];
}

export interface StaffOverride {
  staffId: string;
  path: string;
  value: string;
}

export function createLayout(name: string, type: "full_score" | "part" | "custom", players: string[]): Layout {
  return {
    id: randomUUID(),
    name,
    type,
    staves: [],
    players,
    pageWidth: 210,
    pageHeight: 297,
    margins: { top: 15, bottom: 15, left: 15, right: 15 },
    systemBreaks: [],
    globalStaffSize: 7,
  };
}

export function addStaff(layout: Layout, staff: Staff): void {
  layout.staves.push(staff);
}

export function addSystemBreak(layout: Layout, bar: number, type: "system" | "page"): void {
  layout.systemBreaks.push({ bar, type });
}

export function createDefaultHouseStyle(): HouseStyle {
  return {
    id: "default",
    name: "Default House Style",
    rules: [
      { path: "note.spacing", value: "1.0" },
      { path: "slur.thickness", value: "0.16" },
      { path: "beam.thickness", value: "0.5" },
      { path: "staff.distance", value: "8" },
      { path: "system.distance", value: "12" },
      { path: "page.number.offset", value: "4" },
      { path: "tuplet.number.offset", value: "1.5" },
      { path: "articulation.offset", value: "1.0" },
    ],
    smuflFont: "Bravura",
  };
}

export function extractPartFromLayout(
  layout: Layout,
  playerId: string,
  notes: NoteEvent[],
  players: Player[],
): PartExtractionResult {
  const warnings: string[] = [];
  const player = players.find((p) => p.id === playerId);
  if (!player) {
    warnings.push(`Player ${playerId} not found`);
    return {
      partId: playerId,
      playerId,
      layout: { ...layout, id: randomUUID(), name: `${layout.name} - ${playerId}`, type: "part", players: [playerId] },
      notes: [],
      warnings,
    };
  }

  const partLayout = createLayout(`${layout.name} - ${player.name}`, "part", [playerId]);
  partLayout.pageWidth = layout.pageWidth;
  partLayout.pageHeight = layout.pageHeight;
  partLayout.margins = { ...layout.margins };
  partLayout.globalStaffSize = layout.globalStaffSize;

  const playerStaves = layout.staves.filter((s) => s.label?.includes(player.name) ?? false);
  if (playerStaves.length > 0) {
    partLayout.staves = playerStaves.map((s) => ({ ...s, id: s.id }));
  }

  const playerNotes = notes.filter((n) => n.trackId === playerId);
  if (playerNotes.length === 0) {
    warnings.push(`No notes found for player ${player.name}`);
  }

  return {
    partId: playerId,
    playerId,
    layout: partLayout,
    notes: playerNotes,
    warnings,
  };
}
