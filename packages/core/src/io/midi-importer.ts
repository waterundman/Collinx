import { NoteEvent, TempoMap, createNoteEvent, midiToSpelling } from "../model";
import { randomUUID } from "../util/random-uuid";
import type { GraphNode, GraphEdge } from "../schema/graph-schema";

export interface MIDIImportResult {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  tracks: { name: string; channel: number; noteCount: number }[];
  warnings: string[];
}

interface RawMIDIEvent {
  tick: number;
  status: number;
  channel: number;
  data1: number;
  data2: number;
  metaType?: number;
  metaData?: number[];
}

interface RawTrack {
  events: RawMIDIEvent[];
  name: string;
}

function readUint8(data: Uint8Array, offset: number): number {
  return data[offset];
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]
  );
}

function readVLQ(data: Uint8Array, offset: number): { value: number; bytes: number } {
  let value = 0;
  let bytes = 0;
  let b: number;
  do {
    if (offset + bytes >= data.length) {
      throw new Error("Unexpected end of data reading VLQ");
    }
    b = data[offset + bytes];
    value = (value << 7) | (b & 0x7f);
    bytes++;
  } while (b & 0x80);
  return { value, bytes };
}

function readString(data: Uint8Array, offset: number, length: number): string {
  const bytes = data.slice(offset, offset + length);
  return new TextDecoder().decode(bytes);
}

function parseHeader(data: Uint8Array): {
  format: number;
  ntrks: number;
  division: number;
  ticksPerQuarter: number;
  fps?: number;
  ticksPerFrame?: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (readUint32(data, 0) !== 0x4d546864) {
    throw new Error("Invalid MIDI file: missing MThd chunk");
  }

  const headerLength = readUint32(data, 4);
  if (headerLength < 6) {
    throw new Error("Invalid MIDI header length");
  }

  const format = readUint16(data, 8);
  const ntrks = readUint16(data, 10);
  const division = readUint16(data, 12);

  let ticksPerQuarter: number;
  let fps: number | undefined;
  let ticksPerFrame: number | undefined;

  if (division & 0x8000) {
    fps = -(division >> 8);
    ticksPerFrame = division & 0xff;
    ticksPerQuarter = ticksPerFrame * fps;
    warnings.push(`SMPTE time division (${fps}fps, ${ticksPerFrame} tpf) approximated as ${ticksPerQuarter} PPQ`);
  } else {
    ticksPerQuarter = division;
  }

  if (format > 2) {
    warnings.push(`Unknown MIDI format: ${format}, treating as format 1`);
  }

  return { format, ntrks, division, ticksPerQuarter, fps, ticksPerFrame, warnings };
}

function parseTrack(data: Uint8Array, offset: number, trackIndex: number): { track: RawTrack; endOffset: number; warnings: string[] } {
  const warnings: string[] = [];

  if (offset + 8 > data.length) {
    throw new Error(`Track ${trackIndex}: unexpected end of data`);
  }

  const chunkType = readUint32(data, offset);
  if (chunkType !== 0x4d54726b) {
    throw new Error(`Track ${trackIndex}: missing MTrk chunk at offset ${offset}`);
  }

  const length = readUint32(data, offset + 4);
  const trackStart = offset + 8;
  const trackEnd = trackStart + length;

  const events: RawMIDIEvent[] = [];
  let pos = trackStart;
  let runningStatus: number = 0;
  let trackName = `Track ${trackIndex + 1}`;
  let absTick = 0;

  while (pos < trackEnd) {
    const delta = readVLQ(data, pos);
    pos += delta.bytes;
    absTick += delta.value;

    let status = data[pos];
    pos++;

    if (status < 0x80) {
      if (runningStatus === 0) {
        warnings.push(`Track ${trackIndex}: data byte before status at tick ${absTick}`);
        continue;
      }
      status = runningStatus;
      pos--;
    }

    if (status >= 0x80 && status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      const metaType = data[pos];
      pos++;
      const len = readVLQ(data, pos);
      pos += len.bytes;
      const metaData: number[] = [];
      for (let i = 0; i < len.value && pos + i < trackEnd; i++) {
        metaData.push(data[pos + i]);
      }
      pos += len.value;

      if (metaType === 0x2f) {
        break;
      }

      if (metaType === 0x03) {
        trackName = readString(data, pos - len.value, len.value).replace(/\0+$/, "");
      }

      events.push({
        tick: absTick,
        status: 0xff,
        channel: 0,
        data1: metaType,
        data2: 0,
        metaType,
        metaData,
      });
    } else if (status === 0xf0 || status === 0xf7) {
      const len = readVLQ(data, pos);
      pos += len.bytes + len.value;
      events.push({
        tick: absTick,
        status,
        channel: 0,
        data1: 0,
        data2: 0,
      });
    } else {
      const msgType = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = data[pos];
      pos++;
      let data2 = 0;

      if (msgType !== 0xc0 && msgType !== 0xd0) {
        if (pos < trackEnd) {
          data2 = data[pos];
          pos++;
        }
      }

      events.push({
        tick: absTick,
        status,
        channel,
        data1,
        data2,
      });
    }
  }

  return { track: { events, name: trackName }, endOffset: trackEnd, warnings };
}

function processTempoChanges(
  events: RawMIDIEvent[],
  division: number,
  ticksPerQuarter: number,
  warnings: string[]
): {
  tempoChanges: { bar: number; bpm: number }[];
  meterChanges: { bar: number; numerator: number; denominator: number }[];
  keyChanges: { bar: number; tonic: string; mode: string }[];
  tickToBpm: Map<number, number>;
  tickToMeter: Map<number, { numerator: number; denominator: number }>;
  tickToKey: Map<number, { tonic: string; mode: string }>;
} {
  const tempoChanges: { bar: number; bpm: number }[] = [];
  const meterChanges: { bar: number; numerator: number; denominator: number }[] = [];
  const keyChanges: { bar: number; tonic: string; mode: string }[] = [];

  const tickToBpm = new Map<number, number>();
  const tickToMeter = new Map<number, { numerator: number; denominator: number }>();
  const tickToKey = new Map<number, { tonic: string; mode: string }>();

  tickToBpm.set(0, 120);
  tickToMeter.set(0, { numerator: 4, denominator: 4 });
  tickToKey.set(0, { tonic: "C", mode: "major" });

  let currentTempo = 120;
  let currentNumerator = 4;
  let currentDenominator = 4;
  let currentKeyTonic = "C";
  let currentKeyMode = "major";

  for (const event of events) {
    if (event.status !== 0xff) continue;

    if (event.metaType === 0x51 && event.metaData && event.metaData.length >= 3) {
      const mpqn = (event.metaData[0] << 16) | (event.metaData[1] << 8) | event.metaData[2];
      currentTempo = Math.round(60000000 / mpqn);
      tickToBpm.set(event.tick, currentTempo);
    }

    if (event.metaType === 0x58 && event.metaData && event.metaData.length >= 4) {
      currentNumerator = event.metaData[0];
      currentDenominator = Math.pow(2, event.metaData[1]);
      tickToMeter.set(event.tick, { numerator: currentNumerator, denominator: currentDenominator });
    }

    if (event.metaType === 0x59 && event.metaData && event.metaData.length >= 2) {
      const sf = event.metaData[0];
      const smi = event.metaData[1];
      const { tonic, mode } = keySigToName(sf, smi);
      currentKeyTonic = tonic;
      currentKeyMode = mode;
      tickToKey.set(event.tick, { tonic, mode });
    }
  }

  const sortedTempoTicks = Array.from(tickToBpm.keys()).sort((a, b) => a - b);
  for (const tick of sortedTempoTicks) {
    const pos = tickToBarBeat(tick, tickToMeter, ticksPerQuarter);
    tempoChanges.push({ bar: pos.bar, bpm: tickToBpm.get(tick)! });
  }

  const sortedMeterTicks = Array.from(tickToMeter.keys()).sort((a, b) => a - b);
  for (const tick of sortedMeterTicks) {
    const pos = tickToBarBeat(tick, tickToMeter, ticksPerQuarter);
    const m = tickToMeter.get(tick)!;
    meterChanges.push({ bar: pos.bar, numerator: m.numerator, denominator: m.denominator });
  }

  const sortedKeyTicks = Array.from(tickToKey.keys()).sort((a, b) => a - b);
  for (const tick of sortedKeyTicks) {
    const pos = tickToBarBeat(tick, tickToMeter, ticksPerQuarter);
    const k = tickToKey.get(tick)!;
    keyChanges.push({ bar: pos.bar, tonic: k.tonic, mode: k.mode });
  }

  return { tempoChanges, meterChanges, keyChanges, tickToBpm, tickToMeter, tickToKey };
}

function tickToBarBeat(
  tick: number,
  tickToMeter: Map<number, { numerator: number; denominator: number }>,
  ticksPerQuarter: number
): { bar: number; beat: number } {
  if (tick <= 0) return { bar: 1, beat: 1 };

  const sortedMeters = Array.from(tickToMeter.entries()).sort((a, b) => a[0] - b[0]);
  if (sortedMeters.length === 0) {
    sortedMeters.push([0, { numerator: 4, denominator: 4 }]);
  }

  let currentBar = 1;
  let remainingTick = tick;
  let meterIdx = 0;

  while (remainingTick >= 0) {
    const currentMeter = tickToMeter.get(sortedMeters[meterIdx][0])!;
    const ticksPerBar = currentMeter.numerator * ticksPerQuarter;

    if (remainingTick < ticksPerBar) {
      const beat = 1 + remainingTick / ticksPerQuarter;
      return { bar: currentBar, beat: Math.round(beat * 10000) / 10000 };
    }

    remainingTick -= ticksPerBar;
    currentBar++;

    if (meterIdx + 1 < sortedMeters.length) {
      const nextMeterTick = sortedMeters[meterIdx + 1][0];
      const tickAtCurrentBarStart = tick - remainingTick;
      if (tickAtCurrentBarStart >= nextMeterTick) {
        meterIdx++;
      }
    }
  }

  return { bar: currentBar, beat: 1 };
}

function keySigToName(sf: number, mi: number): { tonic: string; mode: string } {
  const mode = mi === 0 ? "major" : "minor";

  const majorKeys: Record<number, string> = {
    0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
    [-1]: "F", [-2]: "Bb", [-3]: "Eb", [-4]: "Ab", [-5]: "Db", [-6]: "Gb", [-7]: "Cb",
  };

  const minorKeys: Record<number, string> = {
    0: "A", 1: "E", 2: "B", 3: "F#", 4: "C#", 5: "G#", 6: "D#", 7: "A#",
    [-1]: "D", [-2]: "G", [-3]: "C", [-4]: "F", [-5]: "Bb", [-6]: "Eb", [-7]: "Ab",
  };

  const tonic = mode === "major" ? (majorKeys[sf] ?? "C") : (minorKeys[sf] ?? "A");
  if (!(sf in majorKeys) && !(sf in minorKeys)) {
    return { tonic: "C", mode: "major" };
  }
  return { tonic, mode };
}

function extractNotes(
  events: RawMIDIEvent[],
  trackId: string,
  tickToMeter: Map<number, { numerator: number; denominator: number }>,
  ticksPerQuarter: number,
  warnings: string[]
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const pendingNotes = new Map<string, { pitchMidi: number; velocity: number; tick: number; channel: number }>();

  for (const event of events) {
    const msgType = event.status & 0xf0;

    if (msgType === 0x90 && event.data2 > 0) {
      const key = `${event.channel}:${event.data1}`;
      if (pendingNotes.has(key)) {
        warnings.push(`Track ${trackId}: overlapping note on pitch ${event.data1} channel ${event.channel} - ending previous`);
        const prev = pendingNotes.get(key)!;
        const pos = tickToBarBeat(prev.tick, tickToMeter, ticksPerQuarter);
        const endPos = tickToBarBeat(event.tick, tickToMeter, ticksPerQuarter);
        notes.push(createNoteEvent({
          trackId,
          bar: pos.bar,
          beat: pos.beat,
          durQn: Math.max(0.01, Math.round((endPos.beat - pos.beat + (endPos.bar - pos.bar) * 4) * 100) / 100),
          pitchMidi: prev.pitchMidi,
          velocity: prev.velocity / 127,
        }));
      }
      pendingNotes.set(key, {
        pitchMidi: event.data1,
        velocity: event.data2,
        tick: event.tick,
        channel: event.channel,
      });
    }

    if ((msgType === 0x80) || (msgType === 0x90 && event.data2 === 0)) {
      const key = `${event.channel}:${event.data1}`;
      const noteOn = pendingNotes.get(key);
      if (noteOn) {
        pendingNotes.delete(key);
        const startPos = tickToBarBeat(noteOn.tick, tickToMeter, ticksPerQuarter);
        const endPos = tickToBarBeat(event.tick, tickToMeter, ticksPerQuarter);
        const endBeats = (endPos.bar - startPos.bar) * 4 + (endPos.beat - startPos.beat);
        notes.push(createNoteEvent({
          trackId,
          bar: startPos.bar,
          beat: startPos.beat,
          durQn: Math.max(0.01, Math.round(endBeats * 100) / 100),
          pitchMidi: noteOn.pitchMidi,
          velocity: noteOn.velocity / 127,
        }));
      }
    }
  }

  for (const [key, noteOn] of pendingNotes) {
    warnings.push(`Track ${trackId}: note on pitch ${noteOn.pitchMidi} without note off - adding short duration`);
    const startPos = tickToBarBeat(noteOn.tick, tickToMeter, ticksPerQuarter);
    notes.push(createNoteEvent({
      trackId,
      bar: startPos.bar,
      beat: startPos.beat,
      durQn: 0.25,
      pitchMidi: noteOn.pitchMidi,
      velocity: noteOn.velocity / 127,
    }));
  }

  return notes.sort((a, b) => {
    if (a.bar !== b.bar) return a.bar - b.bar;
    return a.beat - b.beat;
  });
}

export class MIDIImporter {
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): MIDIImportResult {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const warnings: string[] = [];

    const headerInfo = parseHeader(data);
    warnings.push(...headerInfo.warnings);

    const { format, ntrks, ticksPerQuarter } = headerInfo;

    const tracks: RawTrack[] = [];
    let offset = 14;

    for (let i = 0; i < ntrks; i++) {
      const result = parseTrack(data, offset, i);
      tracks.push(result.track);
      offset = result.endOffset;
      warnings.push(...result.warnings);
    }

    if (tracks.length === 0) {
      return {
        notes: [],
        tempoMap: TempoMap.default(),
        tracks: [],
        warnings: [...warnings, "No tracks found in MIDI file"],
      };
    }

    const metaTrack = tracks[0];
    const allMetaEvents = metaTrack.events.filter((e) => e.status === 0xff);
    for (const track of tracks.slice(1)) {
      const trackMetaEvents = track.events.filter((e) => e.status === 0xff);
      allMetaEvents.push(...trackMetaEvents);
    }

    const {
      tempoChanges,
      meterChanges,
      keyChanges,
      tickToMeter,
    } = processTempoChanges(allMetaEvents, headerInfo.division, ticksPerQuarter, warnings);

    const tempoMap = new TempoMap(
      tempoChanges.map((t) => ({ bar: t.bar, bpm: t.bpm })),
      meterChanges.length > 0 ? meterChanges : undefined,
      keyChanges.length > 0 ? keyChanges : undefined
    );

    const trackInfos: { name: string; channel: number; noteCount: number }[] = [];
    const allNotes: NoteEvent[] = [];
    const musicTracks = format === 0 || tracks.length <= 1 ? tracks : tracks.slice(1);

    for (let i = 0; i < musicTracks.length; i++) {
      const track = musicTracks[i];
      const trackId = `track-${i}`;

      const channels = new Set<number>();
      for (const event of track.events) {
        if (event.status >= 0x80 && event.status < 0xf0) {
          channels.add(event.channel);
        }
      }
      const primaryChannel = channels.size > 0 ? Array.from(channels)[0] : 0;

      const notes = extractNotes(track.events, trackId, tickToMeter, ticksPerQuarter, warnings);
      trackInfos.push({ name: track.name, channel: primaryChannel, noteCount: notes.length });
      allNotes.push(...notes);
    }

    allNotes.sort((a, b) => {
      if (a.bar !== b.bar) return a.bar - b.bar;
      return a.beat - b.beat;
    });

    return { notes: allNotes, tempoMap, tracks: trackInfos, warnings };
  }

  static async fromFile(filePath: string): Promise<MIDIImportResult> {
    const fs = await import("fs/promises");
    const buffer = await fs.readFile(filePath);
    return MIDIImporter.fromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  }

  static toProjectGraph(result: MIDIImportResult): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const now = new Date().toISOString();

    const tempoNode: GraphNode = {
      id: randomUUID(),
      type: "CompositionUnit",
      data: result.tempoMap.toNodeData(),
      created_at: now,
      updated_at: now,
    };
    nodes.push(tempoNode);

    for (const track of result.tracks) {
      const trackNode: GraphNode = {
        id: randomUUID(),
        type: "Track",
        data: { name: track.name, channel: track.channel },
        created_at: now,
        updated_at: now,
      };
      nodes.push(trackNode);

      edges.push({
        id: randomUUID(),
        type: "contains",
        source_id: tempoNode.id,
        target_id: trackNode.id,
        data: {},
      });

      const trackNotes = result.notes.filter((n) => n.trackId === `track-${result.tracks.indexOf(track)}`);
      const noteNodeIds: string[] = [];
      for (const note of trackNotes) {
        const noteNode: GraphNode = {
          id: randomUUID(),
          type: "NoteSpan",
          data: note as unknown as Record<string, unknown>,
          created_at: now,
          updated_at: now,
        };
        nodes.push(noteNode);
        noteNodeIds.push(noteNode.id);
      }

      let prevNoteNodeId: string | null = null;
      for (const noteNodeId of noteNodeIds) {
        edges.push({
          id: randomUUID(),
          type: "contains",
          source_id: trackNode.id,
          target_id: noteNodeId,
          data: {},
        });
        if (prevNoteNodeId) {
          edges.push({
            id: randomUUID(),
            type: "contains",
            source_id: prevNoteNodeId,
            target_id: noteNodeId,
            data: {},
          });
        }
        prevNoteNodeId = noteNodeId;
      }
    }

    return { nodes, edges };
  }
}
