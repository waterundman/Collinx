import { NoteEvent, TempoMap, noteStartTick } from "../model";

export interface MIDIExportOptions {
  ticksPerQuarter?: number;
  tempo?: number;
}

function writeUint32be(value: number): number[] {
  return [
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

function writeUint16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function writeVLQ(value: number): number[] {
  if (value < 0) value = 0;
  const bytes: number[] = [];
  let v = value;
  bytes.push(v & 0x7f);
  v >>= 7;
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  bytes.reverse();
  return bytes;
}

function writeTrackName(name: string): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);
  const result: number[] = [0xff, 0x03];
  result.push(...writeVLQ(bytes.length));
  result.push(...Array.from(bytes));
  return result;
}

function writeTempo(bpm: number): number[] {
  const mpqn = Math.round(60000000 / bpm);
  const result: number[] = [0xff, 0x51, 0x03];
  result.push((mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);
  return result;
}

function writeTimeSig(numerator: number, denominator: number): number[] {
  const denomPower = Math.round(Math.log2(denominator));
  const result: number[] = [0xff, 0x58, 0x04];
  result.push(numerator, denomPower, 24, 8);
  return result;
}

function writeEndOfTrack(): number[] {
  return [0xff, 0x2f, 0x00];
}

export class MIDIExporter {
  static toBuffer(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    options?: MIDIExportOptions
  ): ArrayBuffer {
    const ticksPerQuarter = options?.ticksPerQuarter ?? 480;

    const sortedNotes = [...notes].sort((a, b) => {
      const tickA = noteStartTick(a, ticksPerQuarter);
      const tickB = noteStartTick(b, ticksPerQuarter);
      if (tickA !== tickB) return tickA - tickB;
      const endTickA = tickA + a.durQn * ticksPerQuarter;
      const endTickB = tickB + b.durQn * ticksPerQuarter;
      return endTickB - endTickA;
    });

    const allEvents: { tick: number; bytes: number[] }[] = [];

    allEvents.push({ tick: 0, bytes: writeTrackName("Collinx Export") });

    const maxBar = sortedNotes.length > 0
      ? Math.max(...sortedNotes.map((n) => n.bar))
      : 16;
    const tempoChanges = (tempoMap as unknown as { tempoChanges?: { bar: number; bpm: number }[] }).tempoChanges ?? [];
    for (const tc of tempoChanges) {
      if (tc.bar > maxBar + 2) continue;
      const tick = (tc.bar - 1) * 4 * ticksPerQuarter;
      allEvents.push({ tick, bytes: writeTempo(tc.bpm) });
    }

    const meterChanges = (tempoMap as unknown as { meterChanges?: { bar: number; numerator: number; denominator: number }[] }).meterChanges ?? [];
    for (const mc of meterChanges) {
      if (mc.bar > maxBar + 2) continue;
      const tick = (mc.bar - 1) * 4 * ticksPerQuarter;
      allEvents.push({ tick, bytes: writeTimeSig(mc.numerator, mc.denominator) });
    }

    for (let i = 0; i < sortedNotes.length; i++) {
      const note = sortedNotes[i];
      const startTick = noteStartTick(note, ticksPerQuarter);

      const noteOn: number[] = [0x90, note.pitchMidi, Math.round(note.velocity * 127)];
      allEvents.push({ tick: Math.round(startTick), bytes: noteOn });

      const noteOff: number[] = [0x80, note.pitchMidi, 64];
      const endTick = Math.round(startTick + note.durQn * ticksPerQuarter);
      allEvents.push({ tick: endTick, bytes: noteOff });
    }

    allEvents.sort((a, b) => a.tick - b.tick);
    allEvents.push({ tick: allEvents.length > 0 ? allEvents[allEvents.length - 1].tick + ticksPerQuarter : 0, bytes: writeEndOfTrack() });

    const trackBytes: number[] = [];
    let currentTick = 0;
    for (const event of allEvents) {
      const delta = event.tick - currentTick;
      currentTick = event.tick;
      trackBytes.push(...writeVLQ(delta));
      trackBytes.push(...event.bytes);
    }

    const trackLength = trackBytes.length;
    const totalLength =
      14 +
      8 +
      trackLength;

    const header = new Uint8Array(14);
    header.set([0x4d, 0x54, 0x68, 0x64], 0);
    header.set(writeUint32be(6), 4);
    header.set(writeUint16be(0), 8);
    header.set(writeUint16be(1), 10);
    header.set(writeUint16be(ticksPerQuarter), 12);

    const trackHeader = new Uint8Array(8);
    trackHeader.set([0x4d, 0x54, 0x72, 0x6b], 0);
    trackHeader.set(writeUint32be(trackLength), 4);

    const result = new Uint8Array(totalLength);
    result.set(header, 0);
    result.set(trackHeader, 14);
    result.set(new Uint8Array(trackBytes), 22);

    return (result.buffer as ArrayBuffer).slice(result.byteOffset, result.byteOffset + result.byteLength);
  }

  static async toFile(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    filePath: string,
    options?: MIDIExportOptions
  ): Promise<void> {
    const buffer = MIDIExporter.toBuffer(notes, tempoMap, options);
    const fs = await import("fs/promises");
    const uint8 = new Uint8Array(buffer);
    await fs.writeFile(filePath, uint8);
  }
}
