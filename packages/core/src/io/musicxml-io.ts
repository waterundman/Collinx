import { NoteEvent, TempoMap, createNoteEvent, midiToSpelling, spellingToMidi } from "../model";
import { HarmonyPlan, type HarmonyEntry } from "../model";

export interface MusicXMLImportResult {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  harmonyPlan?: HarmonyPlan;
  parts: { id: string; name: string; noteCount: number }[];
  warnings: string[];
}

export interface MusicXMLExportOptions {
  title?: string;
  composer?: string;
  includeLayout?: boolean;
}

interface ParsedMeasure {
  index: number;
  partId: string;
  attributes?: ParsedAttributes;
  notes: ParsedNote[];
  directions: ParsedDirection[];
}

interface ParsedAttributes {
  divisions: number;
  fifths: number;
  mode: string;
  beats: number;
  beatType: number;
  clef?: { sign: string; line: number };
}

interface ParsedNote {
  pitch?: { step: string; alter: number; octave: number };
  duration: number;
  type: string;
  voice: string;
  staff: number;
  rest: boolean;
  chord: boolean;
  grace: boolean;
}

interface ParsedDirection {
  tempo?: number;
  sound?: string;
}

function parseMusicXMLValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function parseTagContent(xml: string, tag: string): ParsedValue {
  const content = parseMusicXMLValue(xml, tag);
  if (content === null) {
    return { raw: "", attributes: {} };
  }
  const attrRegex = new RegExp(`<${tag}\\s+([^>]*)>`, "i");
  const attrMatch = xml.match(attrRegex);
  const attributes: Record<string, string> = {};

  if (attrMatch) {
    const attrStr = attrMatch[1];
    const attrRe = /(\w+)=["']([^"']*)["']/g;
    let aMatch;
    while ((aMatch = attrRe.exec(attrStr)) !== null) {
      attributes[aMatch[1]] = aMatch[2];
    }
  }
  return { raw: content, attributes };
}

interface ParsedValue {
  raw: string;
  attributes: Record<string, string>;
}

function extractParts(xml: string, warnings: string[]): { id: string; name: string }[] {
  const parts: { id: string; name: string }[] = [];
  const partListMatch = xml.match(/<part-list>([\s\S]*?)<\/part-list>/i);
  if (!partListMatch) {
    warnings.push("No part-list found in MusicXML");
    return parts;
  }

  const partList = partListMatch[1];
  const scorePartRegex = /<score-part\s+id=["'](\w+)["']>([\s\S]*?)<\/score-part>/gi;
  let match;
  while ((match = scorePartRegex.exec(partList)) !== null) {
    const id = match[1];
    const partContent = match[2];
    const nameMatch = partContent.match(/<part-name>([\s\S]*?)<\/part-name>/i);
    const name = nameMatch ? nameMatch[1].trim() : id;
    parts.push({ id, name });
  }

  return parts;
}

function extractPartsXml(xml: string): string[] {
  const results: string[] = [];
  const regex = /<part\s+id=["'](\w+)["']>([\s\S]*?)<\/part>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[0]);
  }
  return results;
}

function parseMeasure(measureXml: string, partId: string, measureIndex: number, warnings: string[]): ParsedMeasure {
  const measure: ParsedMeasure = {
    index: measureIndex,
    partId,
    notes: [],
    directions: [],
  };

  if (/<attributes>/i.test(measureXml)) {
    const attrMatch = measureXml.match(/<attributes>([\s\S]*?)<\/attributes>/i);
    if (attrMatch) {
      const attrXml = attrMatch[1];
      const divisions = parseInt(parseMusicXMLValue(attrXml, "divisions") ?? "1", 10);

      const fifthsStr = parseMusicXMLValue(attrXml, "fifths");
      const fifths = fifthsStr ? parseInt(fifthsStr, 10) : 0;

      const modeStr = parseMusicXMLValue(attrXml, "mode");
      const mode = modeStr || "major";

      const beatsStr = parseMusicXMLValue(attrXml, "beats");
      const beats = beatsStr ? parseInt(beatsStr, 10) : 4;

      const beatTypeStr = parseMusicXMLValue(attrXml, "beat-type");
      const beatType = beatTypeStr ? parseInt(beatTypeStr, 10) : 4;

      const clefXml = attrXml.match(/<clef[^>]*>([\s\S]*?)<\/clef>/i)?.[1];
      let clef: { sign: string; line: number } | undefined;
      if (clefXml) {
        const sign = parseMusicXMLValue(clefXml, "sign") ?? "G";
        const line = parseInt(parseMusicXMLValue(clefXml, "line") ?? "2", 10);
        clef = { sign, line };
      }

      measure.attributes = { divisions, fifths, mode, beats, beatType, clef };
    }
  }

  if (/<direction/i.test(measureXml)) {
    const dirRegex = /<direction[^>]*>([\s\S]*?)<\/direction>/gi;
    let dirMatch;
    while ((dirMatch = dirRegex.exec(measureXml)) !== null) {
      const dirXml = dirMatch[1];
      const dir: ParsedDirection = {};

      const soundMatch = dirXml.match(/<sound\s+[^>]*tempo=["'](\d+(?:\.\d+)?)["']/i);
      if (soundMatch) {
        dir.tempo = parseFloat(soundMatch[1]);
      }

      const metronomeMatch = dirXml.match(/<beat-unit>(\w+)<\/beat-unit>\s*<per-minute>(\d+)<\/per-minute>/i);
      if (metronomeMatch) {
        let bpm = parseInt(metronomeMatch[2], 10);
        if (metronomeMatch[1] === "half") bpm = bpm / 2;
        if (metronomeMatch[1] === "eighth") bpm = bpm * 2;
        dir.tempo = bpm;
      }

      if (dir.tempo) {
        measure.directions.push(dir);
      }
    }
  }

  if (/<harmony/i.test(measureXml)) {
    warnings.push(`Measure ${measureIndex + 1}: harmony elements found but not fully parsed`);
  }

  const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
  let noteMatch;
  while ((noteMatch = noteRegex.exec(measureXml)) !== null) {
    const noteXml = noteMatch[1];
    const note: ParsedNote = {
      duration: 0,
      type: "quarter",
      voice: "1",
      staff: 1,
      rest: false,
      chord: false,
      grace: false,
    };

    if (/<rest\/?>/.test(noteXml) || /<rest>/.test(noteXml)) {
      note.rest = true;
    }

    if (/<chord\/?>/.test(noteXml)) {
      note.chord = true;
    }

    if (/<grace\/?>/.test(noteXml)) {
      note.grace = true;
      warnings.push(`Measure ${measureIndex + 1}: grace note found (skipped)`);
      continue;
    }

    const durationStr = parseMusicXMLValue(noteXml, "duration");
    if (durationStr) {
      note.duration = parseInt(durationStr, 10);
    }

    const typeStr = parseMusicXMLValue(noteXml, "type");
    if (typeStr) {
      note.type = typeStr;
    }

    const voiceStr = parseMusicXMLValue(noteXml, "voice");
    if (voiceStr) {
      note.voice = voiceStr;
    }

    const staffStr = parseMusicXMLValue(noteXml, "staff");
    if (staffStr) {
      note.staff = parseInt(staffStr, 10);
    }

    if (!note.rest) {
      const pitchXml = noteXml.match(/<pitch>([\s\S]*?)<\/pitch>/i)?.[1];
      if (pitchXml) {
        const step = parseMusicXMLValue(pitchXml, "step");
        const alterStr = parseMusicXMLValue(pitchXml, "alter");
        const octaveStr = parseMusicXMLValue(pitchXml, "octave");
        if (step && octaveStr) {
          note.pitch = {
            step,
            alter: alterStr ? parseFloat(alterStr) : 0,
            octave: parseInt(octaveStr, 10),
          };
        }
      }
    }

    measure.notes.push(note);
  }

  return measure;
}

function musicXMLPitchToMidi(pitch: { step: string; alter: number; octave: number }): number {
  const stepMap: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };
  const base = stepMap[pitch.step.toUpperCase()] ?? 0;
  return (pitch.octave + 1) * 12 + base + pitch.alter;
}

function musicXMLPitchToSpelling(pitch: { step: string; alter: number; octave: number }): string {
  const step = pitch.step.toUpperCase();
  let accidental = "";
  if (pitch.alter >= 1) accidental = "#";
  if (pitch.alter <= -1) accidental = "b";
  if (Math.abs(pitch.alter) >= 2) accidental = pitch.alter > 0 ? "##" : "bb";
  return `${step}${accidental}${pitch.octave}`;
}

function typeToDurQn(type: string): number {
  const map: Record<string, number> = {
    "1024th": 1 / 256,
    "512th": 1 / 128,
    "256th": 1 / 64,
    "128th": 1 / 32,
    "64th": 1 / 16,
    "32nd": 1 / 8,
    "16th": 1 / 4,
    eighth: 1 / 2,
    quarter: 1,
    half: 2,
    whole: 4,
    breve: 8,
    long: 16,
  };
  return map[type] ?? 1;
}

export class MusicXMLIO {
  static importFromXML(xml: string): MusicXMLImportResult {
    const warnings: string[] = [];

    if (xml.includes("<!DOCTYPE score-partwise>")) {
      warnings.push("DOCTYPE declaration found - some entities may not parse correctly");
    }

    const parts = extractParts(xml, warnings);
    const partXmls = extractPartsXml(xml);

    if (partXmls.length === 0) {
      warnings.push("No parts found in MusicXML - attempting single-part parse");
      const measureRegex = /<measure[^>]*>([\s\S]*?)<\/measure>/gi;
      const measures: ParsedMeasure[] = [];
      let mIdx = 0;
      let mMatch;
      while ((mMatch = measureRegex.exec(xml)) !== null) {
        measures.push(parseMeasure(mMatch[1], "P1", mIdx++, warnings));
      }
      if (measures.length > 0) {
        return MusicXMLIO.buildResult(measures, [{ id: "P1", name: "Part 1" }], warnings);
      }
      return {
        notes: [],
        tempoMap: TempoMap.default(),
        parts: [],
        warnings: [...warnings, "Empty MusicXML"],
      };
    }

    const allMeasures: ParsedMeasure[] = [];
    for (const partXml of partXmls) {
      const idMatch = partXml.match(/<part\s+id=["'](\w+)["']>/i);
      const partId = idMatch ? idMatch[1] : "P0";
      const measureRegex = /<measure[^>]*>([\s\S]*?)<\/measure>/gi;
      let mIdx = 0;
      let mMatch;
      while ((mMatch = measureRegex.exec(partXml)) !== null) {
        allMeasures.push(parseMeasure(mMatch[1], partId, mIdx++, warnings));
      }
    }

    return MusicXMLIO.buildResult(allMeasures, parts, warnings);
  }

  static async importFromMXL(buffer: ArrayBuffer): Promise<MusicXMLImportResult> {
    try {
      const { unzipSync, strFromU8 } = await import("fflate") as { unzipSync: (data: Uint8Array) => Record<string, Uint8Array>; strFromU8: (data: Uint8Array) => string };
      const data = new Uint8Array(buffer);
      const decompressed = unzipSync(data);

      let containerXml: string | undefined;
      for (const [filename, fileData] of Object.entries(decompressed)) {
        if (filename === "META-INF/container.xml") {
          containerXml = strFromU8(fileData as Uint8Array);
        }
      }

      if (!containerXml) {
        return {
          notes: [],
          tempoMap: TempoMap.default(),
          parts: [],
          warnings: ["container.xml not found in MXL"],
        };
      }

      const rootfileMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
      if (!rootfileMatch) {
        return {
          notes: [],
          tempoMap: TempoMap.default(),
          parts: [],
          warnings: ["No rootfile found in container.xml"],
        };
      }

      const rootFilePath = rootfileMatch[1];
      const musicXmlData = decompressed[rootFilePath];
      if (!musicXmlData) {
        return {
          notes: [],
          tempoMap: TempoMap.default(),
          parts: [],
          warnings: [`Root file ${rootFilePath} not found in MXL`],
        };
      }

      const xml = strFromU8(musicXmlData as Uint8Array);
      return MusicXMLIO.importFromXML(xml);
    } catch (e) {
      return {
        notes: [],
        tempoMap: TempoMap.default(),
        parts: [],
        warnings: [`Failed to decompress MXL: ${e}`],
      };
    }
  }

  private static buildResult(
    measures: ParsedMeasure[],
    parts: { id: string; name: string }[],
    warnings: string[]
  ): MusicXMLImportResult {
    const notes: NoteEvent[] = [];
    const tempoChanges: { bar: number; bpm: number }[] = [];
    const meterChanges: { bar: number; numerator: number; denominator: number }[] = [];
    const keyChanges: { bar: number; tonic: string; mode: string }[] = [];

    const partNoteCounts = new Map<string, number>();
    let currentTempo = 120;
    let currentFifths = 0;
    let currentMode = "major";

    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i];
      const bar = i + 1;

      if (measure.attributes) {
        const attr = measure.attributes;
        currentFifths = attr.fifths;
        currentMode = attr.mode;

        const keyName = MusicXMLIO.fifthsToKeyName(attr.fifths, attr.mode);
        keyChanges.push({ bar, tonic: keyName.tonic, mode: keyName.mode });

        meterChanges.push({ bar, numerator: attr.beats, denominator: attr.beatType });
      }

      for (const dir of measure.directions) {
        if (dir.tempo) {
          currentTempo = dir.tempo;
          tempoChanges.push({ bar, bpm: dir.tempo });
        }
      }

      let currentBeat = 1;
      let prevBeat = 1;
      for (const note of measure.notes) {
        const durQn = measure.attributes
          ? note.duration / measure.attributes.divisions
          : typeToDurQn(note.type);

        const noteStartBeat = note.chord ? prevBeat : currentBeat;

        if (note.rest) {
          if (!note.chord) {
            prevBeat = currentBeat;
            currentBeat += durQn;
          }
          continue;
        }

        if (note.pitch) {
          const pitchMidi = musicXMLPitchToMidi(note.pitch);
          const spelling = musicXMLPitchToSpelling(note.pitch);

          notes.push(createNoteEvent({
            trackId: measure.partId,
            bar,
            beat: noteStartBeat,
            durQn: Math.round(durQn * 10000) / 10000,
            pitchMidi,
            pitchSpelling: spelling,
            velocity: 0.8,
            voice: note.voice,
          }));

          partNoteCounts.set(measure.partId, (partNoteCounts.get(measure.partId) ?? 0) + 1);
        }

        if (!note.chord) {
          prevBeat = currentBeat;
          currentBeat += durQn;
        }
      }
    }

    const tempoMap = new TempoMap(
      tempoChanges.length > 0 ? tempoChanges : [{ bar: 1, bpm: 120 }],
      meterChanges.length > 0 ? meterChanges : [{ bar: 1, numerator: 4, denominator: 4 }],
      keyChanges.length > 0 ? keyChanges : undefined
    );

    const partInfos = parts.map((p) => ({
      id: p.id,
      name: p.name,
      noteCount: partNoteCounts.get(p.id) ?? 0,
    }));

    if (tempoChanges.length === 0) {
      tempoMap.addTempoChange({ bar: 1, bpm: 120 });
    }

    const result: MusicXMLImportResult = {
      notes,
      tempoMap,
      parts: partInfos,
      warnings,
    };

    return MusicXMLIO.cleanImport(result);
  }

  static cleanImport(result: MusicXMLImportResult): MusicXMLImportResult {
    const warnings = [...result.warnings];

    const sorted = [...result.notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });

    const merged: NoteEvent[] = [];
    let prev: NoteEvent | null = null;
    for (const note of sorted) {
      if (prev && prev.pitchMidi === note.pitchMidi && prev.bar === note.bar && prev.beat === note.beat) {
        prev = Object.assign({}, prev, {
          durQn: Math.max(prev.durQn, note.durQn),
          velocity: Math.max(prev.velocity, note.velocity),
        });
        warnings.push(`Merged overlapping note at bar ${note.bar} beat ${note.beat} pitch ${note.pitchMidi}`);
        continue;
      }
      if (prev) merged.push(prev);
      prev = note;
    }
    if (prev) merged.push(prev);

    const cleaned = merged.map((note) => {
      const tempoMap = result.tempoMap;
      const key = tempoMap.keyAt(note.bar);
      const preferFlat = key.tonic.includes("b") || key.tonic === "F";
      const correctedSpelling = midiToSpelling(note.pitchMidi, preferFlat);
      if (correctedSpelling !== note.pitchSpelling) {
        return { ...note, pitchSpelling: correctedSpelling };
      }
      return note;
    });

      return Object.assign({}, result, { notes: cleaned, warnings });
  }

  static exportToXML(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    options?: MusicXMLExportOptions
  ): string {
    const title = options?.title ?? "Collinx Export";
    const composer = options?.composer ?? "Collinx";

    const parts = new Map<string, NoteEvent[]>();
    for (const note of notes) {
      const partId = note.trackId;
      if (!parts.has(partId)) parts.set(partId, []);
      parts.get(partId)!.push(note);
    }

    const partIds = Array.from(parts.keys()).sort();
    if (partIds.length === 0) {
      partIds.push("P1");
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
    xml += '<score-partwise version="4.0">\n';
    xml += `  <work><work-title>${MusicXMLIO.escapeXml(title)}</work-title></work>\n`;
    xml += `  <identification><creator type="composer">${MusicXMLIO.escapeXml(composer)}</creator></identification>\n`;

    xml += '  <part-list>\n';
    for (const partId of partIds) {
      xml += `    <score-part id="${partId}"><part-name>${MusicXMLIO.escapeXml(partId)}</part-name></score-part>\n`;
    }
    xml += '  </part-list>\n';

    const divisions = 480;

    for (const partId of partIds) {
      const partNotes = parts.get(partId) ?? [];
      xml += `  <part id="${partId}">\n`;

      const maxBar = partNotes.length > 0
        ? Math.max(...partNotes.map((n) => n.bar))
        : 1;

      for (let bar = 1; bar <= maxBar; bar++) {
        xml += `    <measure number="${bar}">\n`;

        if (bar === 1) {
          xml += '      <attributes>\n';
          xml += `        <divisions>${divisions}</divisions>\n`;
          xml += '        <key><fifths>0</fifths></key>\n';
          xml += '        <time><beats>4</beats><beat-type>4</beat-type></time>\n';
          xml += '        <clef><sign>G</sign><line>2</line></clef>\n';
          xml += '      </attributes>\n';

          const bpm = tempoMap.bpmAt(1);
          xml += `      <direction placement="above"><sound tempo="${bpm}"/></direction>\n`;
        }

        const barNotes = partNotes.filter((n) => n.bar === bar).sort((a, b) => a.beat - b.beat);

        for (const note of barNotes) {
          const durDivisions = Math.round(note.durQn * divisions);
          const noteType = MusicXMLIO.durQnToType(note.durQn);

          xml += '      <note>\n';
          xml += '        <pitch>\n';
          const spelling = note.pitchSpelling;
          const stepMatch = spelling.match(/^([A-G])/);
          const octaveMatch = spelling.match(/(-?\d+)$/);
          const alterMatch = spelling.match(/[#b]/g);
          const alter = alterMatch
            ? alterMatch.filter((c) => c === "#").length - alterMatch.filter((c) => c === "b").length
            : 0;
          xml += `          <step>${stepMatch?.[1] ?? "C"}</step>\n`;
          if (alter !== 0) xml += `          <alter>${alter}</alter>\n`;
          xml += `          <octave>${octaveMatch?.[1] ?? "4"}</octave>\n`;
          xml += '        </pitch>\n';
          xml += `        <duration>${durDivisions}</duration>\n`;
          xml += `        <voice>${note.voice}</voice>\n`;
          xml += `        <type>${noteType}</type>\n`;
          xml += '      </note>\n';
        }

        xml += '    </measure>\n';
      }

      xml += '  </part>\n';
    }

    xml += '</score-partwise>';
    return xml;
  }

  private static fifthsToKeyName(fifths: number, mode: string): { tonic: string; mode: string } {
    const majorKeys: Record<number, string> = {
      0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
      [-1]: "F", [-2]: "Bb", [-3]: "Eb", [-4]: "Ab", [-5]: "Db", [-6]: "Gb", [-7]: "Cb",
    };

    const minorKeys: Record<number, string> = {
      0: "A", 1: "E", 2: "B", 3: "F#", 4: "C#", 5: "G#", 6: "D#", 7: "A#",
      [-1]: "D", [-2]: "G", [-3]: "C", [-4]: "F", [-5]: "Bb", [-6]: "Eb", [-7]: "Ab",
    };

    if (mode === "minor") {
      return { tonic: minorKeys[fifths] ?? "A", mode: "minor" };
    }
    return { tonic: majorKeys[fifths] ?? "C", mode: "major" };
  }

  private static durQnToType(durQn: number): string {
    if (durQn >= 8) return "breve";
    if (durQn >= 4) return "whole";
    if (durQn >= 2) return "half";
    if (durQn >= 1) return "quarter";
    if (durQn >= 0.5) return "eighth";
    if (durQn >= 0.25) return "16th";
    if (durQn >= 0.125) return "32nd";
    return "64th";
  }

  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
