import type { NoteEvent } from "../model/note-event";
import { midiToSpelling } from "../model/note-event";
import { TempoMap } from "../model/tempo-map";
import type { MusicXMLImportResult } from "./musicxml-io";
import { MusicXMLIO } from "./musicxml-io";

export class MusicXMLOptimizer {
  cleanImport(result: MusicXMLImportResult): MusicXMLImportResult {
    const warnings = [...result.warnings];

    const sorted = [...result.notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });

    const merged: NoteEvent[] = [];
    let prev: NoteEvent | null = null;
    for (const note of sorted) {
      if (
        prev &&
        prev.pitchMidi === note.pitchMidi &&
        prev.bar === note.bar &&
        prev.beat === note.beat
      ) {
        prev = Object.assign({}, prev, {
          durQn: Math.max(prev.durQn, note.durQn),
          velocity: Math.max(prev.velocity, note.velocity),
        });
        warnings.push(
          `Merged overlapping note at bar ${note.bar} beat ${note.beat} pitch ${note.pitchMidi}`,
        );
        continue;
      }
      if (prev) merged.push(prev);
      prev = note;
    }
    if (prev) merged.push(prev);

    const cleaned = merged.map((note) => {
      const key = result.tempoMap.keyAt(note.bar);
      const preferFlat = key.tonic.includes("b") || key.tonic === "F";
      const correctedSpelling = midiToSpelling(note.pitchMidi, preferFlat);
      if (correctedSpelling !== note.pitchSpelling) {
        return { ...note, pitchSpelling: correctedSpelling };
      }
      return note;
    });

    const fixedNotes = cleaned.map((note) => {
      let fixed = { ...note };

      if (fixed.pitchMidi < 0 || fixed.pitchMidi > 127) {
        warnings.push(
          `Fixed out-of-range pitch ${fixed.pitchMidi} at bar ${fixed.bar} beat ${fixed.beat}`,
        );
        fixed = { ...fixed, pitchMidi: Math.max(0, Math.min(127, fixed.pitchMidi)) };
      }

      if (fixed.velocity <= 0 || fixed.velocity > 1) {
        fixed = { ...fixed, velocity: Math.max(0.01, Math.min(1, fixed.velocity)) };
      }

      if (fixed.durQn <= 0) {
        warnings.push(
          `Fixed invalid duration ${fixed.durQn} at bar ${fixed.bar} beat ${fixed.beat}`,
        );
        fixed = { ...fixed, durQn: 1.0 };
      }

      if (!fixed.pitchSpelling || fixed.pitchSpelling === "undefined") {
        fixed = {
          ...fixed,
          pitchSpelling: midiToSpelling(Math.round(fixed.pitchMidi)),
        };
      }

      return fixed;
    });

    return { ...result, notes: fixedNotes, warnings };
  }

  validateRoundTrip(
    notes: NoteEvent[],
    tempoMap: TempoMap,
  ): { passed: boolean; differences: string[] } {
    const differences: string[] = [];

    const xml = MusicXMLIO.exportToXML(notes, tempoMap);
    const reimported = MusicXMLIO.importFromXML(xml);

    if (reimported.notes.length !== notes.length) {
      differences.push(
        `Note count differs: original ${notes.length}, roundtrip ${reimported.notes.length}`,
      );
    }

    const origSorted = [...notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      if (a.beat !== b.beat) return a.beat - b.beat;
      return a.pitchMidi - b.pitchMidi;
    });

    const rtSorted = [...reimported.notes].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      if (a.beat !== b.beat) return a.beat - b.beat;
      return a.pitchMidi - b.pitchMidi;
    });

    const maxLen = Math.min(origSorted.length, rtSorted.length);
    for (let i = 0; i < maxLen; i++) {
      const orig = origSorted[i];
      const rt = rtSorted[i];

      if (orig.pitchMidi !== rt.pitchMidi) {
        differences.push(
          `Note[${i}] pitch mismatch: ${orig.pitchMidi} (orig) vs ${rt.pitchMidi} (rt)`,
        );
      }

      if (Math.abs(orig.durQn - rt.durQn) > 0.01) {
        differences.push(
          `Note[${i}] duration mismatch: ${orig.durQn} (orig) vs ${rt.durQn} (rt)`,
        );
      }

      if (orig.bar !== rt.bar) {
        differences.push(
          `Note[${i}] bar mismatch: ${orig.bar} (orig) vs ${rt.bar} (rt)`,
        );
      }
    }

    const origBpm = tempoMap.bpmAt(1);
    const rtBpm = reimported.tempoMap.bpmAt(1);
    if (Math.abs(origBpm - rtBpm) > 1) {
      differences.push(
        `Tempo mismatch: ${origBpm} (orig) vs ${rtBpm} (rt)`,
      );
    }

    return {
      passed: differences.length === 0,
      differences,
    };
  }

  computeDiff(
    xmlA: string,
    xmlB: string,
  ): { added: number; removed: number; modified: number } {
    const resultA = MusicXMLIO.importFromXML(xmlA);
    const resultB = MusicXMLIO.importFromXML(xmlB);

    const notesA = new Set(resultA.notes.map((n) => n.id));
    const notesB = new Set(resultB.notes.map((n) => n.id));

    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const id of notesB) {
      if (!notesA.has(id)) {
        added++;
      }
    }

    for (const id of notesA) {
      if (!notesB.has(id)) {
        removed++;
      }
    }

    const commonIds = [...notesA].filter((id) => notesB.has(id));
    const mapA = new Map(resultA.notes.map((n) => [n.id, n]));
    const mapB = new Map(resultB.notes.map((n) => [n.id, n]));

    for (const id of commonIds) {
      const a = mapA.get(id)!;
      const b = mapB.get(id)!;
      if (
        a.pitchMidi !== b.pitchMidi ||
        Math.abs(a.durQn - b.durQn) > 0.001 ||
        a.bar !== b.bar ||
        a.beat !== b.beat ||
        Math.abs(a.velocity - b.velocity) > 0.001
      ) {
        modified++;
      }
    }

    return { added, removed, modified };
  }

  batchTest(
    files: string[],
  ): { file: string; passed: boolean; warnings: string[] }[] {
    return files.map((file) => {
      try {
        const result = MusicXMLIO.importFromXML(file);
        const cleaned = this.cleanImport(result);
        return {
          file,
          passed: cleaned.warnings.every(
            (w) => !w.toLowerCase().includes("error"),
          ),
          warnings: cleaned.warnings,
        };
      } catch (e) {
        return {
          file,
          passed: false,
          warnings: [`Exception: ${String(e)}`],
        };
      }
    });
  }
}
