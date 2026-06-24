import { describe, it, expect } from "vitest";
import { MIDIImporter } from "../midi-importer";
import { TempoMap } from "../../model";

function createMinimalMIDI(events: number[] = []): Uint8Array {
  const headerSize = 14;
  const trackHeaderSize = 8;
  const endOfTrack = [0x00, 0xff, 0x2f, 0x00];
  const allTrackData = [...events, ...endOfTrack];
  const trackLen = allTrackData.length;

  const data = new Uint8Array(headerSize + trackHeaderSize + trackLen);

  data.set([0x4d, 0x54, 0x68, 0x64], 0);
  data.set([0x00, 0x00, 0x00, 0x06], 4);
  data.set([0x00, 0x00], 8);
  data.set([0x00, 0x01], 10);
  data.set([0x01, 0xe0], 12);

  data.set([0x4d, 0x54, 0x72, 0x6b], headerSize);
  data.set([(trackLen >> 24) & 0xff, (trackLen >> 16) & 0xff, (trackLen >> 8) & 0xff, trackLen & 0xff], headerSize + 4);

  data.set(new Uint8Array(allTrackData), headerSize + trackHeaderSize);

  return data;
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

function noteOnEvent(channel: number, pitch: number, velocity: number, tick: number): number[] {
  const delta = writeVLQ(tick);
  return [...delta, 0x90 | channel, pitch, velocity];
}

function noteOffEvent(channel: number, pitch: number, tick: number): number[] {
  const delta = writeVLQ(tick);
  return [...delta, 0x80 | channel, pitch, 64];
}

function tempoEvent(bpm: number, tick: number): number[] {
  const mpqn = Math.round(60000000 / bpm);
  const delta = writeVLQ(tick);
  return [...delta, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff];
}

function timeSigEvent(num: number, denom: number, tick: number): number[] {
  const denomPower = Math.round(Math.log2(denom));
  const delta = writeVLQ(tick);
  return [...delta, 0xff, 0x58, 0x04, num, denomPower, 24, 8];
}

function keySigEvent(sf: number, mi: number, tick: number): number[] {
  const delta = writeVLQ(tick);
  return [...delta, 0xff, 0x59, 0x02, sf & 0xff, mi & 0xff];
}

function trackNameEvent(name: string, tick: number): number[] {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const delta = writeVLQ(tick);
  return [...delta, 0xff, 0x03, nameBytes.length, ...Array.from(nameBytes)];
}

describe("MIDIImporter", () => {
  describe("fromBuffer", () => {
    it("should parse minimal MIDI file (header only)", () => {
      const data = createMinimalMIDI();
      const result = MIDIImporter.fromBuffer(data);
      expect(result.notes).toHaveLength(0);
      expect(result.tracks).toHaveLength(1);
      expect(result.tempoMap).toBeDefined();
    });

    it("should parse MIDI with note on/off", () => {
      const events = [
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes.length).toBe(1);
      expect(result.notes[0].pitchMidi).toBe(60);
      expect(result.notes[0].bar).toBe(1);
      expect(result.notes[0].beat).toBe(1);
      expect(result.notes[0].durQn).toBe(1);
    });

    it("should parse MIDI with tempo change", () => {
      const events = [
        ...tempoEvent(140, 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.tempoMap.bpmAt(1)).toBe(140);
    });

    it("should parse MIDI with time signature", () => {
      const events = [
        ...timeSigEvent(3, 4, 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.tempoMap.meterAt(1).numerator).toBe(3);
    });

    it("should parse MIDI with key signature", () => {
      const events = [
        ...keySigEvent(1, 0, 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.tempoMap.keyAt(1).tonic).toBe("G");
    });

    it("should parse track name", () => {
      const events = [
        ...trackNameEvent("Melody", 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.tracks.length).toBeGreaterThanOrEqual(1);
      expect(result.tracks[0].name).toBe("Melody");
    });

    it("should convert ticks to bar/beat correctly", () => {
      const events = [
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 960),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes[0].durQn).toBe(2);
    });

    it("should handle note at bar 2 beat 1", () => {
      const events = [
        ...noteOnEvent(0, 64, 100, 1920),
        ...noteOffEvent(0, 64, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes[0].bar).toBe(2);
      expect(result.notes[0].beat).toBe(1);
      expect(result.notes[0].pitchMidi).toBe(64);
    });

    it("should handle multiple notes", () => {
      const events = [
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
        ...noteOnEvent(0, 64, 100, 480),
        ...noteOffEvent(0, 64, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes.length).toBe(2);
    });

    it("should warn about note on without note off", () => {
      const events = [
        ...noteOnEvent(0, 60, 100, 0),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.notes.length).toBe(1);
    });

    it("should handle format 0 MIDI (single track)", () => {
      const data = createMinimalMIDI([
        ...tempoEvent(120, 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ]);

      const orig = new Uint8Array(data);
      orig[9] = 0x00;
      orig[11] = 0x01;

      const result = MIDIImporter.fromBuffer(orig);
      expect(result.notes.length).toBe(1);
    });

    it("should reject invalid MIDI", () => {
      const badData = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(() => MIDIImporter.fromBuffer(badData)).toThrow();
    });

    it("should handle SMPTE division with warning", () => {
      const data = createMinimalMIDI();
      const arr = new Uint8Array(data);
      arr[12] = 0xe8;
      arr[13] = 0x58;

      const result = MIDIImporter.fromBuffer(arr);
      expect(result.warnings.some((w) => w.includes("SMPTE"))).toBe(true);
    });

    it("should handle running status", () => {
      const events = [
        0x00, 0x90, 60, 100,
        0x00, 64, 100,
        0x40, 0x80, 60, 64,
        0x00, 64, 64,
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes.length).toBe(2);
    });

    it("should handle note on with velocity 0 as note off", () => {
      const events = [
        ...noteOnEvent(0, 60, 100, 0),
        0x00, 0x90, 60, 0x00,
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      expect(result.notes.length).toBe(1);
    });
  });

  describe("toProjectGraph", () => {
    it("should convert import result to graph nodes and edges", () => {
      const events = [
        ...trackNameEvent("Test", 0),
        ...noteOnEvent(0, 60, 100, 0),
        ...noteOffEvent(0, 60, 480),
      ];
      const data = createMinimalMIDI(events);
      const result = MIDIImporter.fromBuffer(data);

      const { nodes, edges } = MIDIImporter.toProjectGraph(result);
      expect(nodes.length).toBeGreaterThan(0);
      expect(edges.length).toBeGreaterThan(0);

      const trackNode = nodes.find((n) => n.type === "Track");
      expect(trackNode).toBeDefined();

      const noteNodes = nodes.filter((n) => n.type === "NoteSpan");
      expect(noteNodes.length).toBe(1);
    });
  });
});
