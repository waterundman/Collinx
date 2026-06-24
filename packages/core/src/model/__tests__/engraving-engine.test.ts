import { describe, it, expect } from "vitest";
import { EngravingEngine } from "../engraving-engine";
import type { EngravingContext, EngravingResult, CollisionWarning, PageBreak } from "../engraving-engine";
import { createLayout, addStaff, createDefaultHouseStyle } from "../score-model";
import { createNoteEvent } from "../note-event";
import { TempoMap } from "../tempo-map";
import type { Player } from "../instrument";
import type { Staff } from "../score-model";

function makeContext(staves: Staff[] = [], notes: ReturnType<typeof createNoteEvent>[] = []): EngravingContext {
  const layout = createLayout("Test", "full_score", ["p1"]);
  for (const staff of staves) {
    addStaff(layout, staff);
  }
  return {
    layout,
    notes,
    houseStyle: createDefaultHouseStyle(),
    tempoMap: TempoMap.default(),
  };
}

describe("EngravingEngine", () => {
  const engine = new EngravingEngine();

  describe("autoLayout", () => {
    it("should return an engraving result with all fields", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 2, pitchMidi: 64, durQn: 1 }),
      ];
      const ctx = makeContext([], notes);
      const result = engine.autoLayout(ctx);

      expect(result).toBeDefined();
      expect(Array.isArray(result.pages)).toBe(true);
      expect(Array.isArray(result.systemBreaks)).toBe(true);
      expect(Array.isArray(result.collisions)).toBe(true);
      expect(Array.isArray(result.staffOverrides)).toBe(true);
    });

    it("should return empty result for empty notes", () => {
      const ctx = makeContext();
      const result = engine.autoLayout(ctx);
      expect(result.systemBreaks).toHaveLength(0);
    });
  });

  describe("detectCollisions", () => {
    it("should detect unison collisions at the same beat", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 2 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1.5, pitchMidi: 60, durQn: 1 }),
      ];
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);

      const unison = collisions.filter((c: CollisionWarning) => c.type === "note" && c.description.includes("Unison"));
      expect(unison.length).toBeGreaterThan(0);
    });

    it("should detect semi-tone cluster collisions", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 2 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1.5, pitchMidi: 61, durQn: 1 }),
      ];
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);

      const cluster = collisions.filter((c: CollisionWarning) => c.description.includes("Cluster"));
      expect(cluster.length).toBeGreaterThan(0);
    });

    it("should detect large interval leaps", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 0.5 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1.5, pitchMidi: 90, durQn: 0.5 }),
      ];
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);

      const leap = collisions.filter((c: CollisionWarning) => c.description.includes("leap"));
      expect(leap.length).toBeGreaterThan(0);
    });

    it("should detect high note density", () => {
      const notes = Array.from({ length: 70 }, (_, i) =>
        createNoteEvent({
          trackId: "p1",
          bar: 1,
          beat: 1 + (i % 35) * 0.125,
          pitchMidi: 60 + (i % 12),
          durQn: 0.5,
          voice: i < 35 ? "1" : "2",
        }),
      );
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);

      const density = collisions.filter((c: CollisionWarning) => c.description.includes("density"));
      expect(density.length).toBeGreaterThan(0);
      expect(density[0].severity).toBe("error");
    });

    it("should return no collisions for clean input", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 2, pitchMidi: 62, durQn: 1 }),
        createNoteEvent({ trackId: "p1", bar: 2, beat: 1, pitchMidi: 64, durQn: 2 }),
      ];
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);
      expect(collisions).toHaveLength(0);
    });

    it("should include severity and description in warnings", () => {
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 2 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60, durQn: 1 }),
      ];
      const ctx = makeContext([], notes);
      const collisions = engine.detectCollisions(ctx);

      for (const c of collisions) {
        expect(c.severity).toMatch(/^(warning|error)$/);
        expect(typeof c.description).toBe("string");
        expect(c.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("extractParts", () => {
    const players: Player[] = [
      { id: "p1", name: "Violin", instrumentId: "violin" },
      { id: "p2", name: "Cello", instrumentId: "cello" },
    ];

    it("should extract parts for all players in layout", () => {
      const layout = createLayout("Score", "full_score", ["p1", "p2"]);
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 67 }),
        createNoteEvent({ trackId: "p2", bar: 1, beat: 1, pitchMidi: 43 }),
      ];

      const results = engine.extractParts(notes, layout, players);
      expect(results).toHaveLength(2);
      expect(results[0].playerId).toBe("p1");
      expect(results[1].playerId).toBe("p2");
    });

    it("should assign correct notes to each part", () => {
      const layout = createLayout("Score", "full_score", ["p1", "p2"]);
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60 }),
        createNoteEvent({ trackId: "p1", bar: 1, beat: 2, pitchMidi: 62 }),
        createNoteEvent({ trackId: "p2", bar: 1, beat: 1, pitchMidi: 48 }),
      ];

      const results = engine.extractParts(notes, layout, players);
      const part1 = results.find((r) => r.playerId === "p1")!;
      const part2 = results.find((r) => r.playerId === "p2")!;
      expect(part1.notes).toHaveLength(2);
      expect(part2.notes).toHaveLength(1);
    });
  });

  describe("beautify", () => {
    it("should produce staff overrides", () => {
      const staff: Staff = { id: "s1", clef: "treble", voices: 2, lines: 5, label: "Piano" };
      const ctx = makeContext([staff], []);
      const overrides = engine.beautify(ctx);

      expect(overrides.length).toBeGreaterThan(0);
      const spacingOverride = overrides.find((o) => o.path === "note.spacing");
      expect(spacingOverride).toBeDefined();
      expect(spacingOverride!.value).toBe("1.0");
    });

    it("should set stem directions for multiple voices", () => {
      const staff: Staff = { id: "s1", clef: "treble", voices: 2, lines: 5, label: "Piano" };
      const ctx = makeContext([staff], []);
      const overrides = engine.beautify(ctx);

      const stemOverrides = overrides.filter((o) => o.path.includes("stem.direction"));
      expect(stemOverrides.length).toBeGreaterThanOrEqual(2);
    });

    it("should include slur thickness overrides", () => {
      const staff: Staff = { id: "s1", clef: "treble", voices: 1, lines: 5 };
      const ctx = makeContext([staff], []);
      const overrides = engine.beautify(ctx);

      const slurOverride = overrides.find((o) => o.path === "slur.thickness");
      expect(slurOverride).toBeDefined();
    });

    it("should apply note spacing per staff", () => {
      const staves: Staff[] = [
        { id: "s1", clef: "treble", voices: 1, lines: 5 },
        { id: "s2", clef: "bass", voices: 1, lines: 5 },
      ];
      const ctx = makeContext(staves, []);
      const overrides = engine.beautify(ctx);

      const spacingOverrides = overrides.filter((o) => o.path === "note.spacing");
      expect(spacingOverrides).toHaveLength(2);
    });

    it("should use custom house style values", () => {
      const staff: Staff = { id: "s1", clef: "treble", voices: 1, lines: 5 };
      const layout = createLayout("Test", "full_score", ["p1"]);
      addStaff(layout, staff);
      const style = createDefaultHouseStyle();
      const spacingRule = style.rules.find((r) => r.path === "note.spacing")!;
      spacingRule.value = "1.5";

      const ctx: EngravingContext = { layout, notes: [], houseStyle: style, tempoMap: TempoMap.default() };
      const overrides = engine.beautify(ctx);

      const spacingOverride = overrides.find((o) => o.path === "note.spacing");
      expect(spacingOverride!.value).toBe("1.5");
    });
  });

  describe("computeSystemBreaks", () => {
    it("should return breaks for notes spanning multiple bars", () => {
      const notes = Array.from({ length: 64 }, (_, i) =>
        createNoteEvent({
          trackId: "p1",
          bar: Math.floor(i / 4) + 1,
          beat: ((i % 4) + 1),
          pitchMidi: 60 + (i % 12),
          durQn: 1,
        }),
      );
      const ctx = makeContext([], notes);
      const breaks = engine.computeSystemBreaks(notes, ctx.layout);

      expect(breaks.length).toBeGreaterThan(0);
      for (const sb of breaks) {
        expect(["system", "page"]).toContain(sb.type);
        expect(sb.bar).toBeGreaterThanOrEqual(1);
      }
    });

    it("should return empty for empty notes", () => {
      const ctx = makeContext();
      const breaks = engine.computeSystemBreaks([], ctx.layout);
      expect(breaks).toHaveLength(0);
    });

    it("should respect existing system breaks in layout", () => {
      const layout = createLayout("Test", "full_score", ["p1"]);
      layout.systemBreaks = [{ bar: 4, type: "system" }, { bar: 8, type: "page" }];
      const ctx: EngravingContext = { layout, notes: [], houseStyle: createDefaultHouseStyle(), tempoMap: TempoMap.default() };
      const notes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60 }),
      ];
      const breaks = engine.computeSystemBreaks(notes, ctx.layout);
      expect(breaks).toEqual([{ bar: 4, type: "system" }, { bar: 8, type: "page" }]);
    });
  });

  describe("estimatePages", () => {
    it("should return at least 1 page", () => {
      const ctx = makeContext();
      const pages = engine.estimatePages(ctx);
      expect(pages).toBeGreaterThanOrEqual(1);
    });

    it("should return more pages for longer pieces", () => {
      const shortNotes = [
        createNoteEvent({ trackId: "p1", bar: 1, beat: 1, pitchMidi: 60 }),
      ];
      const longNotes = Array.from({ length: 200 }, (_, i) =>
        createNoteEvent({
          trackId: "p1",
          bar: Math.floor(i / 4) + 1,
          beat: ((i % 4) + 1),
          pitchMidi: 60 + (i % 12),
          durQn: 1,
        }),
      );

      const shortCtx = makeContext([], shortNotes);
      const longCtx = makeContext([], longNotes);

      expect(engine.estimatePages(longCtx)).toBeGreaterThanOrEqual(engine.estimatePages(shortCtx));
    });

    it("should increase pages with more staves", () => {
      const notes = Array.from({ length: 32 }, (_, i) =>
        createNoteEvent({
          trackId: "p1",
          bar: Math.floor(i / 4) + 1,
          beat: ((i % 4) + 1),
          pitchMidi: 60 + (i % 12),
          durQn: 1,
        }),
      );

      const singleStaff = makeContext([
        { id: "s1", clef: "treble", voices: 1, lines: 5 },
      ], notes);
      const manyStaves = makeContext(
        Array.from({ length: 10 }, (_, i) => ({
          id: `s${i}`,
          clef: "treble" as const,
          voices: 1,
          lines: 5,
        })),
        notes,
      );

      expect(engine.estimatePages(manyStaves)).toBeGreaterThanOrEqual(engine.estimatePages(singleStaff));
    });
  });

  describe("toMusicXMLLayout", () => {
    it("should return a valid XML defaults element", () => {
      const ctx = makeContext();
      const xml = engine.toMusicXMLLayout(ctx);

      expect(xml).toContain("<defaults>");
      expect(xml).toContain("</defaults>");
      expect(xml).toContain("<page-layout>");
      expect(xml).toContain("<scaling>");
      expect(xml).toContain("<page-height>");
      expect(xml).toContain("<page-width>");
      expect(xml).toContain("<page-margins>");
    });

    it("should include system layout when breaks exist", () => {
      const layout = createLayout("Test", "full_score", ["p1"]);
      layout.systemBreaks = [{ bar: 4, type: "system" }];
      const ctx: EngravingContext = { layout, notes: [], houseStyle: createDefaultHouseStyle(), tempoMap: TempoMap.default() };
      const xml = engine.toMusicXMLLayout(ctx);
      expect(xml).toContain("<system-layout>");
    });

    it("should include staff layout", () => {
      const staff: Staff = { id: "s1", clef: "treble", voices: 1, lines: 5 };
      const ctx = makeContext([staff]);
      const xml = engine.toMusicXMLLayout(ctx);
      expect(xml).toContain("<staff-layout>");
      expect(xml).toContain("<staff-distance>");
    });
  });
});
