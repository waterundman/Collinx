import {
  type ChordSymbol,
  type HarmonyEntry,
  type Instrument,
  midiToSpelling,
} from "@collinx/core";

export interface VoicingNote {
  pitchMidi: number;
  pitchSpelling: string;
  voiceIndex: number;
  playerId: string;
  instrumentId: string;
}

export interface VoicingChord {
  notes: VoicingNote[];
  bar: number;
  beat: number;
  chord: ChordSymbol;
}

export interface VoicingGrid {
  chords: VoicingChord[];
  players: string[];
  totalVoices: number;
}

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9,
  "A#": 10, Bb: 10, B: 11,
};

const CHORD_TONES: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  halfdim7: [0, 3, 6, 10],
  minMaj7: [0, 3, 7, 11],
  aug7: [0, 4, 8, 10],
  dom9: [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  min9: [0, 3, 7, 10, 2],
};

function rootToSemitone(root: string): number {
  const s = NOTE_TO_SEMITONE[root];
  if (s === undefined) throw new Error(`Unknown root note: ${root}`);
  return s;
}

function chordPitchClasses(chord: ChordSymbol): number[] {
  const rootST = rootToSemitone(chord.root);
  const tones = CHORD_TONES[chord.quality];
  if (!tones) {
    return [rootST, (rootST + 4) % 12, (rootST + 7) % 12];
  }
  if (chord.extensions) {
    const extIntervals = parseExtensions(chord.extensions);
    const allTones = new Set(tones);
    for (const interval of extIntervals) {
      allTones.add(interval % 12);
    }
    return Array.from(allTones).sort((a, b) => a - b);
  }
  return tones.map((t) => (rootST + t) % 12);
}

function parseExtensions(extStr: string): number[] {
  const intervals: number[] = [];
  const matches = extStr.matchAll(/([#b]?)(\d{1,2})/g);
  for (const m of matches) {
    let interval = parseInt(m[2], 10);
    if (m[1] === "#") interval += 1;
    if (m[1] === "b") interval -= 1;
    intervals.push(interval - 1);
  }
  return intervals;
}

function pitchesAscending(startMidi: number, pitchClasses: number[], count: number): number[] {
  const existing = new Set<number>();
  const result: number[] = [];
  const sorted = [...pitchClasses].sort((a, b) => a - b);
  let base = startMidi;

  let safety = 0;
  while (result.length < count && safety < 200) {
    safety++;
    for (const pc of sorted) {
      const octaveOffset = Math.floor(base / 12) * 12;
      let midi = octaveOffset + (pc % 12);
      while (midi < base) midi += 12;
      if (midi < 0 || midi > 127) continue;
      if (!existing.has(midi)) {
        existing.add(midi);
        result.push(midi);
        if (result.length >= count) break;
      }
    }
    base++;
  }

  result.sort((a, b) => a - b);
  return result.slice(0, count);
}

function maxVoiceMovement(
  prev: VoicingChord,
  nextNotes: number[],
): VoicingNote[] {
  const notePool = [...nextNotes].sort((a, b) => a - b);
  const prevPitches = prev.notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
  const used = new Array(notePool.length).fill(false);
  const assigned: { prevIdx: number; nextIdx: number; distance: number }[] = [];

  for (let i = 0; i < prevPitches.length; i++) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < notePool.length; j++) {
      if (used[j]) continue;
      const dist = Math.abs(prevPitches[i] - notePool[j]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      assigned.push({ prevIdx: i, nextIdx: bestIdx, distance: bestDist });
    }
  }

  const result: VoicingNote[] = [];
  const sortedAssigned = [...assigned].sort((a, b) => a.prevIdx - b.prevIdx);

  for (const a of sortedAssigned) {
    result.push({
      pitchMidi: notePool[a.nextIdx],
      pitchSpelling: midiToSpelling(notePool[a.nextIdx]),
      voiceIndex: prev.notes[a.prevIdx].voiceIndex,
      playerId: prev.notes[a.prevIdx].playerId,
      instrumentId: prev.notes[a.prevIdx].instrumentId,
    });
  }

  for (let j = 0; j < notePool.length; j++) {
    if (!used[j]) {
      const maxVI = result.length > 0
        ? Math.max(...result.map((n) => n.voiceIndex)) + 1
        : 0;
      result.push({
        pitchMidi: notePool[j],
        pitchSpelling: midiToSpelling(notePool[j]),
        voiceIndex: maxVI,
        playerId: "",
        instrumentId: "",
      });
    }
  }

  result.sort((a, b) => a.pitchMidi - b.pitchMidi);
  return result;
}

export class VoicingEngine {
  generateVoicing(
    chords: HarmonyEntry[],
    players: Instrument[],
    style: string = "close",
  ): VoicingGrid {
    const playerIds = players.map((p) => p.id);
    const playerCount = players.length;
    const totalVoices = Math.max(4, playerCount);
    const voicingChords: VoicingChord[] = [];

    const sortedChords = [...chords].sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });

    for (const entry of sortedChords) {
      let midiPitches: number[];

      switch (style) {
        case "drop2":
          midiPitches = this.drop2Voicing(entry.chord, [40, 84]);
          break;
        case "drop24":
          midiPitches = this.closeVoicing(entry.chord, [36, 88], totalVoices);
          if (midiPitches.length >= 4) {
            const close = [...midiPitches].sort((a, b) => b - a);
            close[1] -= 12;
            close[3] -= 12;
            midiPitches = close.sort((a, b) => a - b);
          }
          break;
        case "open":
          midiPitches = this.closeVoicing(entry.chord, [36, 88], totalVoices);
          if (midiPitches.length >= 4) {
            const open = [...midiPitches].sort((a, b) => a - b);
            open[0] -= 12;
            open[2] += 12;
            midiPitches = open.sort((a, b) => a - b);
          }
          break;
        default:
          midiPitches = this.closeVoicing(entry.chord, [40, 84], totalVoices);
          break;
      }

      const notes: VoicingNote[] = midiPitches.map((pitch, i) => ({
        pitchMidi: pitch,
        pitchSpelling: midiToSpelling(pitch),
        voiceIndex: i,
        playerId: i < playerIds.length ? playerIds[i] : "",
        instrumentId: i < players.length ? players[i].id : "",
      }));

      voicingChords.push({
        notes,
        bar: entry.bar,
        beat: entry.beat,
        chord: { ...entry.chord },
      });
    }

    for (let i = 1; i < voicingChords.length; i++) {
      voicingChords[i] = this.voiceLeading(
        voicingChords[i - 1],
        voicingChords[i],
      );
    }

    return {
      chords: voicingChords,
      players: playerIds,
      totalVoices,
    };
  }

  voiceLeading(prev: VoicingChord, next: VoicingChord): VoicingChord {
    const nextNotes = next.notes.map((n) => n.pitchMidi);
    const ledNotes = maxVoiceMovement(prev, nextNotes);

    return {
      ...next,
      notes: ledNotes.map((n, i) => ({
        ...n,
        playerId: next.notes[Math.min(i, next.notes.length - 1)].playerId,
        instrumentId: next.notes[Math.min(i, next.notes.length - 1)].instrumentId,
        voiceIndex: i,
      })),
    };
  }

  closeVoicing(
    chord: ChordSymbol,
    range: [number, number],
    count: number,
  ): number[] {
    const pcs = chordPitchClasses(chord);
    const uniqueCount = pcs.length;

    if (count <= uniqueCount) {
      return pitchesAscending(range[0], pcs, count);
    }

    const doubled = [...pcs];
    while (doubled.length < count) {
      doubled.push(pcs[0]);
    }

    return pitchesAscending(range[0], doubled, count);
  }

  drop2Voicing(chord: ChordSymbol, range: [number, number]): number[] {
    const close = this.closeVoicing(chord, range, 4);
    if (close.length < 4) return close;

    const sorted = [...close].sort((a, b) => b - a);
    sorted[1] -= 12;
    return sorted.sort((a, b) => a - b);
  }

  assignPlayers(voicing: VoicingGrid, instruments: Instrument[]): void {
    const playerIds = voicing.players;
    for (const chord of voicing.chords) {
      for (let i = 0; i < chord.notes.length; i++) {
        const note = chord.notes[i];
        if (i < playerIds.length) {
          note.playerId = playerIds[i];
          note.instrumentId = instruments[i]?.id ?? "";
        }
      }
    }
  }

  checkSpacing(voicing: VoicingChord): {
    valid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];
    const sorted = [...voicing.notes].sort((a, b) => a.pitchMidi - b.pitchMidi);

    if (sorted.length < 3) {
      return { valid: true, violations: [] };
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const diff = sorted[i + 1].pitchMidi - sorted[i].pitchMidi;
      if (diff > 12) {
        violations.push(
          `Voice ${sorted[i].voiceIndex}–${sorted[i + 1].voiceIndex}: ${diff} semitones exceeds octave`,
        );
      }
    }

    return { valid: violations.length === 0, violations };
  }
}
