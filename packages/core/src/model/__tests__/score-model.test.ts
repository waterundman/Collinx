import { describe, it, expect } from "vitest";
import {
  createLayout,
  addStaff,
  addSystemBreak,
  createDefaultHouseStyle,
  extractPartFromLayout,
} from "../score-model";
import type { Layout, Staff, HouseStyle, SystemBreak, PartExtractionResult } from "../score-model";
import { createNoteEvent } from "../note-event";
import { INSTRUMENTS } from "../instrument";

describe("Score Model", () => {
  describe("createLayout", () => {
    it("should create a layout with default values", () => {
      const layout = createLayout("Test Score", "full_score", ["p1", "p2"]);
      expect(layout.id).toBeDefined();
      expect(typeof layout.id).toBe("string");
      expect(layout.name).toBe("Test Score");
      expect(layout.type).toBe("full_score");
      expect(layout.players).toEqual(["p1", "p2"]);
      expect(layout.pageWidth).toBe(210);
      expect(layout.pageHeight).toBe(297);
      expect(layout.margins).toEqual({ top: 15, bottom: 15, left: 15, right: 15 });
      expect(layout.staves).toEqual([]);
      expect(layout.systemBreaks).toEqual([]);
      expect(layout.globalStaffSize).toBe(7);
    });

    it("should create a part layout", () => {
      const layout = createLayout("Violin Part", "part", ["v1"]);
      expect(layout.type).toBe("part");
      expect(layout.players).toHaveLength(1);
    });

    it("should create a custom layout", () => {
      const layout = createLayout("Custom View", "custom", []);
      expect(layout.type).toBe("custom");
      expect(layout.players).toHaveLength(0);
    });

    it("should generate unique IDs per layout", () => {
      const a = createLayout("A", "full_score", []);
      const b = createLayout("B", "full_score", []);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("addStaff", () => {
    it("should add a staff to the layout", () => {
      const layout = createLayout("Score", "full_score", []);
      const staff: Staff = {
        id: "staff-1",
        clef: "treble",
        voices: 1,
        lines: 5,
        label: "Violin I",
      };
      addStaff(layout, staff);
      expect(layout.staves).toHaveLength(1);
      expect(layout.staves[0].clef).toBe("treble");
      expect(layout.staves[0].label).toBe("Violin I");
    });

    it("should add multiple staves", () => {
      const layout = createLayout("Score", "full_score", []);
      addStaff(layout, { id: "s1", clef: "treble", voices: 1, lines: 5 });
      addStaff(layout, { id: "s2", clef: "bass", voices: 1, lines: 5 });
      expect(layout.staves).toHaveLength(2);
    });

    it("should support alto and tenor clefs", () => {
      const layout = createLayout("Score", "full_score", []);
      addStaff(layout, { id: "vla", clef: "alto", voices: 1, lines: 5, label: "Viola" });
      addStaff(layout, { id: "ten", clef: "tenor", voices: 1, lines: 5, label: "Tenor" });
      expect(layout.staves[0].clef).toBe("alto");
      expect(layout.staves[1].clef).toBe("tenor");
    });

    it("should support octave-transposed clefs", () => {
      const layout = createLayout("Score", "full_score", []);
      addStaff(layout, { id: "tenor_voice", clef: "treble_8vb", voices: 1, lines: 5 });
      addStaff(layout, { id: "picc", clef: "bass_8vb", voices: 1, lines: 5 });
      expect(layout.staves[0].clef).toBe("treble_8vb");
      expect(layout.staves[1].clef).toBe("bass_8vb");
    });

    it("should support percussion clef", () => {
      const layout = createLayout("Score", "full_score", []);
      addStaff(layout, { id: "perc", clef: "percussion", voices: 1, lines: 1, label: "Percussion" });
      expect(layout.staves[0].clef).toBe("percussion");
      expect(layout.staves[0].lines).toBe(1);
    });

    it("should support polyphonic voices", () => {
      const layout = createLayout("Score", "full_score", []);
      addStaff(layout, { id: "piano_rh", clef: "treble", voices: 2, lines: 5, label: "Piano RH" });
      expect(layout.staves[0].voices).toBe(2);
    });
  });

  describe("addSystemBreak", () => {
    it("should add a system break", () => {
      const layout = createLayout("Score", "full_score", []);
      addSystemBreak(layout, 4, "system");
      expect(layout.systemBreaks).toHaveLength(1);
      expect(layout.systemBreaks[0]).toEqual({ bar: 4, type: "system" });
    });

    it("should add a page break", () => {
      const layout = createLayout("Score", "full_score", []);
      addSystemBreak(layout, 8, "page");
      expect(layout.systemBreaks[0].type).toBe("page");
    });

    it("should add multiple breaks in order", () => {
      const layout = createLayout("Score", "full_score", []);
      addSystemBreak(layout, 4, "system");
      addSystemBreak(layout, 8, "page");
      addSystemBreak(layout, 12, "system");
      expect(layout.systemBreaks).toHaveLength(3);
      expect(layout.systemBreaks.map((b: SystemBreak) => b.bar)).toEqual([4, 8, 12]);
    });
  });

  describe("createDefaultHouseStyle", () => {
    it("should create a house style with Bravura font", () => {
      const style = createDefaultHouseStyle();
      expect(style.id).toBe("default");
      expect(style.name).toBe("Default House Style");
      expect(style.smuflFont).toBe("Bravura");
    });

    it("should include engraving rules", () => {
      const style = createDefaultHouseStyle();
      expect(style.rules.length).toBeGreaterThan(0);

      const noteSpacing = style.rules.find((r) => r.path === "note.spacing");
      expect(noteSpacing).toBeDefined();
      expect(noteSpacing!.value).toBe("1.0");

      const slurThickness = style.rules.find((r) => r.path === "slur.thickness");
      expect(slurThickness).toBeDefined();
      expect(slurThickness!.value).toBe("0.16");

      const staffDist = style.rules.find((r) => r.path === "staff.distance");
      expect(staffDist).toBeDefined();
      expect(staffDist!.value).toBe("8");

      const systemDist = style.rules.find((r) => r.path === "system.distance");
      expect(systemDist).toBeDefined();
      expect(systemDist!.value).toBe("12");
    });

    it("should return unique style instances", () => {
      const a = createDefaultHouseStyle();
      const b = createDefaultHouseStyle();
      expect(a.rules).not.toBe(b.rules);
    });
  });

  describe("extractPartFromLayout", () => {
    const players = [
      { id: "p1", name: "Violin I", instrumentId: "violin" },
      { id: "p2", name: "Cello", instrumentId: "cello" },
    ];

    it("should extract notes for a specific player", () => {
      const layout = createLayout("Full Score", "full_score", ["p1", "p2"]);
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 67 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 2, pitchMidi: 69 }),
        createNoteEvent({ trackId: "p2", bar: 1, beat: 1, pitchMidi: 43 }),
      ];

      const result = extractPartFromLayout(layout, "p1", notes, players);
      expect(result.playerId).toBe("p1");
      expect(result.partId).toBe("p1");
      expect(result.notes).toHaveLength(2);
      expect(result.layout.type).toBe("part");
    });

    it("should warn if player not found", () => {
      const layout = createLayout("Full Score", "full_score", ["p1"]);
      const notes: ReturnType<typeof createNoteEvent>[] = [];
      const result = extractPartFromLayout(layout, "unknown", notes, players);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("not found");
    });

    it("should warn if no notes for player", () => {
      const layout = createLayout("Full Score", "full_score", ["p1", "p2"]);
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60 }),
      ];
      const result = extractPartFromLayout(layout, "p2", notes, players);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("No notes found");
    });

    it("should carry over page dimensions from parent layout", () => {
      const layout = createLayout("Full Score", "full_score", ["p1"]);
      layout.pageWidth = 300;
      layout.pageHeight = 400;
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60 }),
      ];
      const result = extractPartFromLayout(layout, "p1", notes, players);
      expect(result.layout.pageWidth).toBe(300);
      expect(result.layout.pageHeight).toBe(400);
    });
  });

  describe("HouseStyle", () => {
    it("should support custom engraving rules", () => {
      const style: HouseStyle = {
        id: "custom",
        name: "Custom Style",
        rules: [
          { path: "note.spacing", value: "1.2" },
          { path: "beam.angle", value: "15" },
        ],
        smuflFont: "Leland",
      };
      expect(style.rules).toHaveLength(2);
      expect(style.smuflFont).toBe("Leland");
      expect(style.rules[0].path).toBe("note.spacing");
      expect(style.rules[0].value).toBe("1.2");
    });
  });
});
