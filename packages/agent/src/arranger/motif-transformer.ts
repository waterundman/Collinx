import { NoteEvent, midiToSpelling } from "@collinx/core";

function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function calcBarBeat(cumulativeQn: number): { bar: number; beat: number } {
  const bar = Math.floor(cumulativeQn / 4) + 1;
  const beat = ((cumulativeQn % 4) + 4) % 4 + 1;
  return { bar, beat };
}

function recalcPositions(notes: NoteEvent[], startQn = 0): NoteEvent[] {
  let cumulative = startQn;
  return notes.map((n) => {
    const pos = calcBarBeat(cumulative);
    cumulative += n.durQn;
    return { ...n, bar: pos.bar, beat: pos.beat };
  });
}

export class MotifTransformer {
  /** Transpose all notes by semitones, updating pitchSpelling */
  static transpose(notes: NoteEvent[], semitones: number): NoteEvent[] {
    if (semitones === 0) return notes;
    return notes.map((n) => ({
      ...n,
      pitchMidi: n.pitchMidi + semitones,
      pitchSpelling: midiToSpelling(n.pitchMidi + semitones),
    }));
  }

  /** Apply random rhythmic perturbation based on degree (0-1) */
  static rhythmicVariation(notes: NoteEvent[], degree: number): NoteEvent[] {
    if (degree <= 0) return notes;
    const clamped = Math.min(1, degree);
    return notes.map((n, i) => {
      const r = seededRand(i * 7 + 13);
      const offsetDelta = (r * 2 - 1) * clamped * 0.5;
      const durFactor = 1 + (r * 2 - 1) * clamped * 0.5;
      const totalBeats = (n.bar - 1) * 4 + (n.beat - 1) + offsetDelta;
      const pos = calcBarBeat(totalBeats);
      return {
        ...n,
        bar: pos.bar,
        beat: pos.beat,
        durQn: Math.max(0.0625, n.durQn * durFactor),
      };
    });
  }

  /** Mirror pitches around the first note's pitch axis */
  static invert(notes: NoteEvent[]): NoteEvent[] {
    if (notes.length === 0) return [];
    const axis = notes[0].pitchMidi;
    return notes.map((n) => {
      const newPitch = 2 * axis - n.pitchMidi;
      return {
        ...n,
        pitchMidi: newPitch,
        pitchSpelling: midiToSpelling(newPitch),
      };
    });
  }

  /** Reverse note order and recalculate bar/beat positions */
  static retrograde(notes: NoteEvent[]): NoteEvent[] {
    if (notes.length <= 1) return notes;
    const reversed = [...notes].reverse();
    const startQn = (notes[0].bar - 1) * 4 + (notes[0].beat - 1);
    return recalcPositions(reversed, startQn);
  }

  /** Stretch durations by factor, spreading positions proportionally */
  static augment(notes: NoteEvent[], factor: number): NoteEvent[] {
    if (factor <= 0) return notes;
    const newDurs = notes.map((n) => n.durQn * factor);
    let cumulative = 0;
    return notes.map((n, i) => {
      const pos = calcBarBeat(cumulative);
      cumulative += newDurs[i];
      return {
        ...n,
        bar: pos.bar,
        beat: pos.beat,
        durQn: Math.max(0.0625, newDurs[i]),
      };
    });
  }

  /** Compress durations by factor, tightening positions proportionally */
  static diminish(notes: NoteEvent[], factor: number): NoteEvent[] {
    if (factor <= 0) return notes;
    const newDurs = notes.map((n) => n.durQn / factor);
    let cumulative = 0;
    return notes.map((n, i) => {
      const pos = calcBarBeat(cumulative);
      cumulative += newDurs[i];
      return {
        ...n,
        bar: pos.bar,
        beat: pos.beat,
        durQn: Math.max(0.0625, newDurs[i]),
      };
    });
  }

  /** Shift all velocities by delta, clamped to [0, 1] */
  static velocityShift(notes: NoteEvent[], delta: number): NoteEvent[] {
    if (delta === 0) return notes;
    return notes.map((n) => ({
      ...n,
      velocity: Math.max(0, Math.min(1, n.velocity + delta)),
    }));
  }

  /** Shift all notes up or down by octaves */
  static octaveShift(notes: NoteEvent[], octaves: number): NoteEvent[] {
    return MotifTransformer.transpose(notes, octaves * 12);
  }

  /** Apply a sequence of transformations with controlled intensity */
  static combine(
    notes: NoteEvent[],
    operations: (keyof typeof MotifTransformer)[],
    degree: number
  ): NoteEvent[] {
    let result = [...notes];
    for (const op of operations) {
      if (op === "combine") continue;
      const method = (MotifTransformer as unknown as Record<string, unknown>)[op] as
        | ((notes: NoteEvent[], arg: number) => NoteEvent[])
        | ((notes: NoteEvent[]) => NoteEvent[])
        | undefined;
      if (typeof method !== "function") continue;

      switch (op) {
        case "transpose":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(
            result,
            Math.round(degree * 11 - 5)
          );
          break;
        case "rhythmicVariation":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(result, degree);
          break;
        case "augment":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(
            result,
            1 + degree
          );
          break;
        case "diminish":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(
            result,
            1 + degree
          );
          break;
        case "octaveShift":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(
            result,
            Math.round(degree * 2 - 1)
          );
          break;
        case "velocityShift":
          result = (method as (notes: NoteEvent[], arg: number) => NoteEvent[])(
            result,
            degree * 0.4 - 0.2
          );
          break;
        default:
          result = (method as (notes: NoteEvent[]) => NoteEvent[])(result);
          break;
      }
    }
    return result;
  }
}
