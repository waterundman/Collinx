import { describe, it, expect } from "vitest";
import { MusicXMLIO } from "../musicxml-io";
import { createNoteEvent, TempoMap } from "../../model";

function createMinimalXML(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${content}
  </part>
</score-partwise>`;
}

function singleNoteMeasure(bar: number): string {
  return `    <measure number="${bar}">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    </measure>`;
}

describe("MusicXMLIO", () => {
  describe("importFromXML", () => {
    it("should parse minimal MusicXML (single part, single note)", () => {
      const xml = createMinimalXML(singleNoteMeasure(1));
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].pitchMidi).toBe(60);
      expect(result.notes[0].bar).toBe(1);
      expect(result.parts.length).toBe(1);
      expect(result.parts[0].name).toBe("Piano");
    });

    it("should parse multiple measures", () => {
      const measures = [1, 2, 3].map((b) => singleNoteMeasure(b)).join("\n");
      const xml = createMinimalXML(measures);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(3);
    });

    it("should parse notes with accidentals", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].pitchMidi).toBe(66);
      expect(result.notes[0].pitchSpelling).toBe("F#4");
    });

    it("should parse MusicXML with key signature", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.tempoMap.keyAt(1).tonic).toBe("D");
      expect(result.tempoMap.keyAt(1).mode).toBe("major");
    });

    it("should parse MusicXML with tempo direction", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><sound tempo="160"/></direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.tempoMap.bpmAt(1)).toBe(160);
    });

    it("should parse MusicXML with time signature", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.tempoMap.meterAt(1).numerator).toBe(3);
    });

    it("should handle MusicXML with rests", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].pitchMidi).toBe(64);
    });

    it("should handle chord notes", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(2);
      expect(result.notes[0].bar).toBe(1);
      expect(result.notes[0].beat).toBe(1);
      expect(result.notes[1].beat).toBe(1);
    });

    it("should handle empty MusicXML with warnings", () => {
      const xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"></score-partwise>';
      const result = MusicXMLIO.importFromXML(xml);

      expect(result.notes.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("cleanImport", () => {
    it("should merge overlapping notes", () => {
      const xml = createMinimalXML(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>`);
      const result = MusicXMLIO.importFromXML(xml);

      const duplicateNote = {
        ...result.notes[0],
        durQn: 2,
      };
      const dirty = Object.assign({}, result, { notes: [...result.notes, duplicateNote], warnings: [] });
      const cleaned = MusicXMLIO.cleanImport(dirty);

      expect(cleaned.notes.length).toBe(1);
      expect(cleaned.notes[0].durQn).toBe(2);
    });
  });

  describe("exportToXML", () => {
    it("should export notes to MusicXML", () => {
      const notes = [
        createNoteEvent({
          trackId: "P1",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          pitchSpelling: "C4",
        }),
      ];
      const tempoMap = TempoMap.default();

      const xml = MusicXMLIO.exportToXML(notes, tempoMap, { title: "Test" });
      expect(xml).toContain("<step>C</step>");
      expect(xml).toContain("<work-title>Test</work-title>");
    });

    it("should round-trip export and import", () => {
      const notes = [
        createNoteEvent({
          trackId: "P1",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          pitchSpelling: "C4",
        }),
        createNoteEvent({
          trackId: "P1",
          bar: 2,
          beat: 1,
          durQn: 2,
          pitchMidi: 67,
          pitchSpelling: "G4",
        }),
      ];
      const tempoMap = TempoMap.default();

      const xml = MusicXMLIO.exportToXML(notes, tempoMap, { title: "Roundtrip" });
      const imported = MusicXMLIO.importFromXML(xml);

      expect(imported.notes.length).toBe(2);
    });

    it("should handle multipart export", () => {
      const notes = [
        createNoteEvent({
          trackId: "P1",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 60,
          pitchSpelling: "C4",
        }),
        createNoteEvent({
          trackId: "P2",
          bar: 1,
          beat: 1,
          durQn: 1,
          pitchMidi: 67,
          pitchSpelling: "G4",
        }),
      ];
      const tempoMap = TempoMap.default();

      const xml = MusicXMLIO.exportToXML(notes, tempoMap);
      expect(xml).toContain('id="P1"');
      expect(xml).toContain('id="P2"');
    });
  });
});
