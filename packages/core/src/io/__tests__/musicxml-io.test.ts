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

// ── v1.15 Stage 0: real export path (round-trip + field fidelity) ───────────
describe("MusicXMLIO export v1.15 (Stage 0)", () => {
  // T01 (unit, critical): the exported XML must round-trip through
  // importFromXML with bar/beat/pitchMidi/durQn preserved. Covers chords
  // (same-beat pitches), gaps between attacks and multiple parts.
  it("T01: exportToXML 可被 importFromXML 往返解析(bar/beat/pitchMidi/durQn) (critical)", () => {
    const notes = [
      createNoteEvent({ trackId: "P1", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
      createNoteEvent({ trackId: "P1", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }), // chord
      createNoteEvent({ trackId: "P1", bar: 1, beat: 3, durQn: 1, pitchMidi: 67 }), // gap at beat 2
      createNoteEvent({ trackId: "P1", bar: 2, beat: 1, durQn: 2, pitchMidi: 62 }),
      createNoteEvent({ trackId: "P1", bar: 2, beat: 3, durQn: 0.5, pitchMidi: 69 }),
      createNoteEvent({ trackId: "P2", bar: 1, beat: 1, durQn: 4, pitchMidi: 40 }),
    ];
    const tempoMap = TempoMap.default();

    const xml = MusicXMLIO.exportToXML(notes, tempoMap, { title: "Roundtrip-15" });
    const imported = MusicXMLIO.importFromXML(xml);

    expect(imported.notes.length).toBe(notes.length);
    for (const original of notes) {
      const match = imported.notes.find(
        (n) =>
          n.trackId === original.trackId &&
          n.bar === original.bar &&
          Math.abs(n.beat - original.beat) < 1e-6 &&
          n.pitchMidi === original.pitchMidi
      );
      expect(match).toBeDefined();
      expect(match!.durQn).toBeCloseTo(original.durQn, 4);
    }
  });

  // T03 (unit, critical): XML string assertions on the exported fields —
  // note pitch/duration/type, time signature and key signature.
  it("T03: exportToXML 输出音符/拍号/调号字段正确 (critical)", () => {
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
        bar: 1,
        beat: 2,
        durQn: 0.5,
        pitchMidi: 66,
        pitchSpelling: "F#4",
      }),
    ];
    const tempoMap = TempoMap.default();

    const xml = MusicXMLIO.exportToXML(notes, tempoMap, {
      title: "T3",
      composer: "Test Composer",
    });

    // score-partwise skeleton + part-list + work/creator metadata.
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<part-list>');
    expect(xml).toContain('id="P1"');
    expect(xml).toContain("<work-title>T3</work-title>");
    expect(xml).toContain('<creator type="composer">Test Composer</creator>');

    // 拍号: TempoMap.default() is 4/4.
    expect(xml).toContain("<time><beats>4</beats><beat-type>4</beat-type></time>");
    // 调号: C major -> fifths 0.
    expect(xml).toContain("<key><fifths>0</fifths><mode>major</mode></key>");
    // 速度方向.
    expect(xml).toContain('<sound tempo="120"/>');

    // 音符: pitch step/octave + duration + type.
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("<octave>4</octave>");
    expect(xml).toContain("<duration>480</duration>");
    expect(xml).toContain("<type>quarter</type>");
    // 升号音符 F#4 -> alter 1, eighth -> 240 divisions.
    expect(xml).toContain("<alter>1</alter>");
    expect(xml).toContain("<duration>240</duration>");
    expect(xml).toContain("<type>eighth</type>");

    // Non-default time/key from the tempo map propagate into the XML.
    const gMajorTempo = new TempoMap(
      [{ bar: 1, bpm: 90 }],
      [{ bar: 1, numerator: 3, denominator: 4 }],
      [{ bar: 1, tonic: "G", mode: "major" }]
    );
    const xml2 = MusicXMLIO.exportToXML(notes, gMajorTempo);
    expect(xml2).toContain("<time><beats>3</beats><beat-type>4</beat-type></time>");
    expect(xml2).toContain("<key><fifths>1</fifths><mode>major</mode></key>");
    expect(xml2).toContain('<sound tempo="90"/>');
  });
});
