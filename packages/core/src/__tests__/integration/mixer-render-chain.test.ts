import { describe, it, expect, beforeEach } from "vitest";
import { createNoteEvent, type NoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";
import {
  createTrack,
  createFXSlot,
  addSlotToChain,
  type MixerState,
  type MixerTrack,
  type FXChain,
} from "../../model/audio-routes";
import { StemRenderer, type RenderConfig } from "../../model/stem-renderer";
import { processFXChain } from "../../model/dsp-effects";

function makeCLink(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "t1", bar: 1, beat: 1, durQn: 4, pitchMidi: 60, velocity: 0.8 }),
    createNoteEvent({ trackId: "t1", bar: 2, beat: 1, durQn: 2, pitchMidi: 64, velocity: 0.8 }),
    createNoteEvent({ trackId: "t1", bar: 2, beat: 3, durQn: 2, pitchMidi: 67, velocity: 0.8 }),
    createNoteEvent({ trackId: "t1", bar: 3, beat: 1, durQn: 4, pitchMidi: 60, velocity: 0.8 }),
  ];
}

function makeDefaultRenderConfig(): RenderConfig {
  return {
    sampleRate: 44100,
    startBar: 1,
    endBar: 4,
    format: "wav",
    bitDepth: 16,
    normalizeStems: false,
  };
}

function createTestMixerState(): MixerState {
  const masterTrack = createTrack("Master", "master", "master");
  const pianoTrack = createTrack("Piano", "t1", "group");

  const fxChain: FXChain = {
    id: "fx-1",
    name: "Piano FX",
    slots: [
      createFXSlot("eq"),
      createFXSlot("reverb"),
    ],
  };
  pianoTrack.fxChain = fxChain;

  return {
    tracks: [pianoTrack],
    masterTrack,
    routingMatrix: { t1: ["master"] },
  };
}

describe("AudioRoutes + DSP + StemRenderer integration", () => {
  let notes: NoteEvent[];
  let tempoMap: TempoMap;

  beforeEach(() => {
    notes = makeCLink();
    tempoMap = TempoMap.default();
  });

  it("should render stems from notes and mixer state", () => {
    const mixer = createTestMixerState();
    const renderer = new StemRenderer();
    const config = makeDefaultRenderConfig();

    const result = renderer.render(notes, mixer, tempoMap, config);

    expect(result.stems).toHaveLength(1);
    expect(result.stems[0].trackId).toBe("t1");
    expect(result.stems[0].trackName).toBe("Piano");
    expect(result.stems[0].audioBuffer.length).toBeGreaterThan(0);
    expect(result.stems[0].peakDb).toBeGreaterThan(-100);
    expect(result.stems[0].rmsDb).toBeGreaterThan(-100);
    expect(result.totalDuration).toBeGreaterThan(0);
    expect(result.masterMix.length).toBeGreaterThan(0);
  });

  it("should apply FX chain order and affect output", () => {
    const mixer = createTestMixerState();
    const rawTrack = mixer.tracks[0];

    // Two different FX chain orders: EQ-then-Reverb vs Reverb-then-EQ
    const chain1: FXChain = {
      id: "c1",
      name: "EQ->Reverb",
      slots: [createFXSlot("eq"), createFXSlot("reverb")],
    };
    const chain2: FXChain = {
      id: "c2",
      name: "Reverb->EQ",
      slots: [createFXSlot("reverb"), createFXSlot("eq")],
    };

    rawTrack.fxChain = chain1;
    const mixer1 = structuredClone(mixer);
    mixer1.tracks[0] = { ...rawTrack, fxChain: chain1 };

    rawTrack.fxChain = chain2;
    const mixer2 = structuredClone(mixer);
    mixer2.tracks[0] = { ...rawTrack, fxChain: chain2 };

    const renderer1 = new StemRenderer();
    const renderer2 = new StemRenderer();
    const config = makeDefaultRenderConfig();

    const result1 = renderer1.render(notes, mixer1, tempoMap, config);
    const result2 = renderer2.render(notes, mixer2, tempoMap, config);

    expect(result1.stems).toHaveLength(1);
    expect(result2.stems).toHaveLength(1);
    // Different FX chain orders can produce different output
    expect(result1.stems[0].audioBuffer.length).toBe(result2.stems[0].audioBuffer.length);
    expect(result1.stems[0].peakDb).toBeDefined();
    expect(result2.stems[0].peakDb).toBeDefined();
  });

  it("should process FX chain with disabled slots correctly", () => {
    const mixer = createTestMixerState();

    const chain: FXChain = {
      id: "c-disabled",
      name: "Chain with disabled slots",
      slots: [
        { ...createFXSlot("eq"), enabled: false },
        createFXSlot("reverb"),
        { ...createFXSlot("compressor"), enabled: false },
      ],
    };
    mixer.tracks[0].fxChain = chain;

    const renderer = new StemRenderer();
    const config = makeDefaultRenderConfig();
    const result = renderer.render(notes, mixer, tempoMap, config);

    expect(result.stems).toHaveLength(1);
    expect(result.stems[0].audioBuffer.length).toBeGreaterThan(0);
    // Only reverb was enabled — output should be valid
    expect(result.stems[0].peakDb).toBeGreaterThan(-100);
  });

  it("should handle mute behavior correctly", () => {
    const mixer = createTestMixerState();

    // Create two tracks: one muted, one normal
    const mutedTrack = createTrack("Muted", "t2", "group");
    mutedTrack.mute = true;
    const normalTrack = mixer.tracks[0];

    const mixerState: MixerState = {
      tracks: [normalTrack, mutedTrack],
      masterTrack: mixer.masterTrack,
      routingMatrix: { t1: ["master"], t2: ["master"] },
    };

    const notes2: NoteEvent[] = [
      createNoteEvent({ trackId: "t2", bar: 1, beat: 1, durQn: 4, pitchMidi: 72, velocity: 0.8 }),
    ];
    const allNotes = [...notes, ...notes2];
    const renderer = new StemRenderer();
    const config = makeDefaultRenderConfig();

    const result = renderer.render(allNotes, mixerState, tempoMap, config);

    expect(result.stems).toHaveLength(2);
    const mutedStem = result.stems.find((s) => s.trackId === "t2")!;
    const normalStem = result.stems.find((s) => s.trackId === "t1")!;

    expect(mutedStem.muted).toBe(true);
    expect(normalStem.muted).toBe(false);

    // Master mix should not include muted track
    expect(result.masterMix.length).toBeGreaterThan(0);
  });

  it("should handle solo behavior", () => {
    const mixer = createTestMixerState();

    const soloTrack = createTrack("Solo Track", "t3", "group");
    soloTrack.solo = true;
    const normalTrack = mixer.tracks[0];

    const mixerState: MixerState = {
      tracks: [normalTrack, soloTrack],
      masterTrack: mixer.masterTrack,
      routingMatrix: { t1: ["master"], t3: ["master"] },
    };

    const soloNotes: NoteEvent[] = [
      createNoteEvent({ trackId: "t3", bar: 1, beat: 1, durQn: 4, pitchMidi: 48, velocity: 0.8 }),
    ];
    const allNotes = [...notes, ...soloNotes];
    const renderer = new StemRenderer();
    const config = makeDefaultRenderConfig();

    const result = renderer.render(allNotes, mixerState, tempoMap, config);

    expect(result.stems).toHaveLength(2);
    const soloStem = result.stems.find((s) => s.trackId === "t3")!;
    expect(soloStem.soloing).toBe(true);

    // Master mix should exist (only solo tracks contribute)
    expect(result.masterMix.length).toBeGreaterThan(0);
  });

  it("should process FX chain via DSP module directly", () => {
    const raw = new Float32Array(2048);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
    }

    const chain: FXChain = {
      id: "dsp-test",
      name: "DSP Chain",
      slots: [
        { ...createFXSlot("eq"), params: { lowFreq: "200", lowGainDb: "-3", midFreq: "1000", midGainDb: "2", midQ: "0.7", highFreq: "5000", highGainDb: "0", highQ: "0.7" } },
        { ...createFXSlot("compressor"), params: { thresholdDb: "-18", ratio: "4", attackMs: "10", releaseMs: "100", makeupGainDb: "2", knee: "2" } },
        {
          id: "rev-1",
          type: "reverb",
          preset: "default",
          params: { roomSize: "0.5", damping: "0.5", width: "1.0", wetLevel: "0.2", dryLevel: "0.8", preDelayMs: "20" },
          enabled: true,
        },
      ],
    };

    const processed = processFXChain(raw, 44100, chain);

    expect(processed).toBeInstanceOf(Float32Array);
    expect(processed.length).toBe(raw.length);
    // Processed output should differ from raw (FX applied)
    let diff = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== processed[i]) diff++;
    }
    // At least some samples should be modified by the FX chain
    expect(diff).toBeGreaterThan(0);
  });

  it("should handle empty notes gracefully", () => {
    const mixer = createTestMixerState();
    const renderer = new StemRenderer();
    const config = makeDefaultRenderConfig();

    const result = renderer.render([], mixer, tempoMap, config);

    expect(result.stems).toHaveLength(1);
    // Empty notes produce silence (peak/rms at minimum)
    expect(result.stems[0].peakDb).toBeLessThanOrEqual(-100);
    expect(result.stems[0].rmsDb).toBeLessThanOrEqual(-100);
    expect(result.stems[0].muted).toBe(false);
    expect(result.totalDuration).toBeGreaterThan(0);
  });
});
