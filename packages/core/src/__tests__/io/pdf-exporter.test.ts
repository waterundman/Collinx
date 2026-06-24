import { describe, it, expect } from "vitest";
import { PDFExporter } from "../../io/pdf-exporter";
import { createLayout, type Layout } from "../../model/score-model";
import { createNoteEvent, type NoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";

function generatePianoNotes(bars: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const rhPitches = [60, 62, 64, 65, 67, 69, 71, 72];
  const lhPitches = [48, 50, 52, 53, 55, 57, 59, 60];

  for (let bar = 1; bar <= bars; bar++) {
    for (let beat = 1; beat <= 4; beat++) {
      const rhIdx = ((bar - 1) * 4 + (beat - 1)) % rhPitches.length;
      const lhIdx = ((bar - 1) * 4 + (beat - 1)) % lhPitches.length;

      notes.push(
        createNoteEvent({
          trackId: "piano",
          bar,
          beat,
          durQn: 1,
          pitchMidi: rhPitches[rhIdx],
          velocity: 0.8,
          voice: "rh",
        }),
      );
      notes.push(
        createNoteEvent({
          trackId: "piano",
          bar,
          beat,
          durQn: 1,
          pitchMidi: lhPitches[lhIdx],
          velocity: 0.7,
          voice: "lh",
        }),
      );
    }
  }
  return notes;
}

function createDefaultLayout(): Layout {
  const layout = createLayout("Test Score", "full_score", ["piano"]);
  layout.staves = [
    { id: "treble", clef: "treble", voices: 1, lines: 5, label: "Piano RH" },
    { id: "bass", clef: "bass", voices: 1, lines: 5, label: "Piano LH" },
  ];
  return layout;
}

describe("PDFExporter", () => {
  const exporter = new PDFExporter();
  const tempoMap = new TempoMap(
    [{ bar: 1, bpm: 120 }],
    [{ bar: 1, numerator: 4, denominator: 4 }],
  );

  describe("Basic PDF generation", () => {
    it("should generate a PDF buffer for 16 bars piano", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(16);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap);

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]).toBe(0x25); // PDF header starts with %
      expect(buffer.toString("ascii", 0, 5)).toBe("%PDF-");
    });

    it("should generate a valid PDF with metadata", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap, {
        title: "Test Score",
        composer: "Test Composer",
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe("Multi-page PDF", () => {
    it("should generate multiple pages for a long score", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(64);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap);

      expect(buffer).toBeDefined();
      const content = buffer.toString("latin1");
      const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
      expect(pageMatches).not.toBeNull();
      expect(pageMatches!.length).toBeGreaterThan(1);
    });
  });

  describe("Page sizes", () => {
    it("should generate A4 PDF", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap, {
        pageSize: "A4",
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should generate Letter PDF", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap, {
        pageSize: "Letter",
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should generate landscape PDF", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap, {
        pageSize: "A4",
        orientation: "landscape",
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe("Title page", () => {
    it("should include a title page when title is provided", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const bufferWithTitle = await exporter.exportToPDF(layout, notes, tempoMap, {
        title: "My Composition",
        composer: "Composer Name",
      });

      const bufferWithoutTitle = await exporter.exportToPDF(layout, notes, tempoMap);

      expect(bufferWithTitle.length).toBeGreaterThan(bufferWithoutTitle.length);
    });

    it("should include title without composer", async () => {
      const layout = createDefaultLayout();
      const notes = generatePianoNotes(8);

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap, {
        title: "Untitled",
      });

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty notes", async () => {
      const layout = createDefaultLayout();

      const buffer = await exporter.exportToPDF(layout, [], tempoMap);

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should handle single staff layout", async () => {
      const layout = createLayout("Treble Only", "part", ["piano"]);
      layout.staves = [
        { id: "treble", clef: "treble", voices: 1, lines: 5 },
      ];

      const notes = [
        createNoteEvent({
          trackId: "piano",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          velocity: 0.8,
          voice: "rh",
        }),
      ];

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap);

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should handle different note durations", async () => {
      const layout = createDefaultLayout();
      const notes: NoteEvent[] = [
        createNoteEvent({ trackId: "piano", bar: 1, beat: 1, durQn: 4, pitchMidi: 60, voice: "rh" }),
        createNoteEvent({ trackId: "piano", bar: 1, beat: 1, durQn: 2, pitchMidi: 48, voice: "lh" }),
        createNoteEvent({ trackId: "piano", bar: 2, beat: 1, durQn: 1, pitchMidi: 64, voice: "rh" }),
        createNoteEvent({ trackId: "piano", bar: 2, beat: 1, durQn: 0.5, pitchMidi: 52, voice: "lh" }),
        createNoteEvent({ trackId: "piano", bar: 2, beat: 2, durQn: 0.25, pitchMidi: 67, voice: "rh" }),
      ];

      const buffer = await exporter.exportToPDF(layout, notes, tempoMap);

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });
  });
});
