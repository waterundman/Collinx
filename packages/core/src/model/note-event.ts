import { randomUUID } from "../util/random-uuid";
import { NoteEventSchema } from "./zod-schemas";

export interface NoteEvent {
  id: string;
  trackId: string;
  phraseId: string | null;
  bar: number;
  beat: number;
  durQn: number;
  pitchMidi: number;
  pitchSpelling: string;
  velocity: number;
  voice: string;
  tags: string[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const SHARP_KEYS = new Set(["G", "D", "A", "E", "B", "F#", "C#"]);
const PREFER_FLAT = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

export function midiToSpelling(midi: number, preferFlat = false): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = ((midi % 12) + 12) % 12;
  const name = preferFlat ? NOTE_NAMES_FLAT[noteIndex] : NOTE_NAMES[noteIndex];
  return `${name}${octave}`;
}

export function spellingToMidi(spelling: string): number {
  const match = spelling.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid pitch spelling: ${spelling}`);
  const [, note, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);
  const noteIndex = NOTE_NAMES.indexOf(`${note}${accidental === "b" ? "" : accidental}`);
  const baseIndex = accidental === "b"
    ? NOTE_NAMES_FLAT.indexOf(`${note}b`)
    : NOTE_NAMES.indexOf(note + (accidental || ""));
  return (octave + 1) * 12 + baseIndex;
}

export function createNoteEvent(
  partial: Partial<NoteEvent> & Pick<NoteEvent, "trackId" | "bar" | "beat">
): NoteEvent {
  const pitchMidi = partial.pitchMidi ?? 60;
  return {
    id: partial.id ?? randomUUID(),
    trackId: partial.trackId,
    phraseId: partial.phraseId ?? null,
    bar: partial.bar,
    beat: partial.beat,
    durQn: partial.durQn ?? 1.0,
    pitchMidi,
    pitchSpelling: partial.pitchSpelling ?? midiToSpelling(Math.round(pitchMidi)),
    velocity: partial.velocity ?? 0.8,
    voice: partial.voice ?? "rh",
    tags: partial.tags ?? [],
  };
}

export function noteEventToNode(note: NoteEvent): { type: "NoteSpan"; data: Record<string, unknown> } {
  return {
    type: "NoteSpan",
    data: JSON.parse(JSON.stringify(note)) as Record<string, unknown>,
  };
}

export function nodeToNoteEvent(data: Record<string, unknown>): NoteEvent {
  const result = NoteEventSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid NoteEvent data: ${result.error.message}`);
  }
  return result.data;
}

export function noteDurationSeconds(note: NoteEvent, bpm: number): number {
  return note.durQn * (60 / bpm);
}

export function noteStartTick(note: NoteEvent, ticksPerQuarter: number): number {
  const beatsPerBar = 4;
  const totalBeats = (note.bar - 1) * beatsPerBar + (note.beat - 1);
  return totalBeats * ticksPerQuarter;
}
