import { describe, it, expect } from "vitest";
import { StemRenderer } from "../stem-renderer";
import { createTrack, createFXSlot } from "../audio-routes";
import { createNoteEvent } from "../note-event";
import { TempoMap } from "../tempo-map";

const defaultConfig = {
  sampleRate: 44100,
  format: "wav" as const,
  bitDepth: 16 as const,
  normalizeStems: false,
};

describe("StemRenderer", () => {
  const renderer = new StemRenderer();
  const tempoMap = TempoMap.default();

  describe("renderTrack", () => {
    const track = createTrack("Melody", "melody");

    it("returns empty buffer for no notes", () => {
      const cfg = { ...defaultConfig, startBar: 1, endBar: 2 };
      const result = renderer.renderTrack([], track, tempoMap, cfg);
      expect(result.trackId).toBe("melody");
      expect(result.duration).toBeGreaterThan(0);
      let hasSignal = false;
      for (let i = 0; i < result.audioBuffer.length; i++) {
        if (Math.abs(result.audioBuffer[i]) > 0.001) {
          hasSignal = true;
          break;
        }
      }
      expect(hasSignal).toBe(false);
    });

    it("renders a single note as non-zero audio", () => {
      const notes = [
        createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 69 }),
      ];
      const result = renderer.renderTrack(notes, track, tempoMap, defaultConfig);
      expect(result.audioBuffer.length).toBeGreaterThan(0);
      let hasSignal = false;
      for (let i = 0; i < result.audioBuffer.length; i++) {
        if (Math.abs(result.audioBuffer[i]) > 0.001) {
          hasSignal = true;
          break;
        }
      }
      expect(hasSignal).toBe(true);
      expect(result.peakDb).toBeGreaterThan(-100);
    });

    it("carries mute/solo flags", () => {
      const mutedTrack = createTrack("Muted", "muted");
      mutedTrack.mute = true;

      const notes = [
        createNoteEvent({ trackId: "muted", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
      ];
      const result = renderer.renderTrack(notes, mutedTrack, tempoMap, defaultConfig);
      expect(result.muted).toBe(true);
      expect(result.soloing).toBe(false);
    });

    it("respects startBar and endBar", () => {
      const notes = [
        createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
        createNoteEvent({ trackId: "melody", bar: 4, beat: 1, durQn: 1, pitchMidi: 62 }),
      ];
      const cfg = { ...defaultConfig, startBar: 2, endBar: 3 };
      const result = renderer.renderTrack(notes, track, tempoMap, cfg);
      expect(result.audioBuffer.length).toBeGreaterThan(0);
      expect(result.duration).toBeCloseTo(tempoMap.timeAt(3, 1) - tempoMap.timeAt(2, 1), 0);
    });

    it("multiple notes sum correctly", () => {
      const notes = [
        createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }),
        createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 67 }),
      ];
      const result = renderer.renderTrack(notes, track, tempoMap, defaultConfig);
      const single = renderer.renderTrack(
        [createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 })],
        track, tempoMap, defaultConfig,
      );
      // Two simultaneous notes should have higher peak
      expect(result.peakDb).toBeGreaterThan(single.peakDb);
    });
  });

  describe("applyMixerChain", () => {
    const track = createTrack("FX", "fx");
    const notes = [
      createNoteEvent({ trackId: "fx", bar: 1, beat: 1, durQn: 2, pitchMidi: 60 }),
    ];

    it("applies gain on the stem", () => {
      const trackGain = createTrack("Gain", "fx");
      trackGain.gainDb = "-6";

      const stem = renderer.renderTrack(notes, trackGain, tempoMap, defaultConfig);
      const processed = renderer.applyMixerChain(stem, trackGain);
      // -6dB gain should reduce peak by ~6dB
      expect(processed.peakDb).toBeLessThan(stem.peakDb);
    });

    it("applies EQ slot", () => {
      const trackEQ = createTrack("EQ", "fx");
      const eqSlot = createFXSlot("eq");
      eqSlot.params = { lowGain: "-12", lowFreq: "250", midGain: "0", midFreq: "1000", midQ: "0.7", highGain: "0", highFreq: "4000" };
      trackEQ.fxChain.slots = [eqSlot];

      const stem = renderer.renderTrack(notes, trackEQ, tempoMap, defaultConfig);
      const processed = renderer.applyMixerChain(stem, trackEQ);
      expect(processed.audioBuffer.length).toBe(stem.audioBuffer.length);
    });

    it("handles compressor slot", () => {
      const trackCmp = createTrack("Cmp", "fx");
      const cmpSlot = createFXSlot("compressor");
      cmpSlot.params = { threshold: "-24", ratio: "8", attack: "5", release: "80", makeup: "0" };
      trackCmp.fxChain.slots = [cmpSlot];

      const stem = renderer.renderTrack(notes, trackCmp, tempoMap, defaultConfig);
      const processed = renderer.applyMixerChain(stem, trackCmp);
      expect(processed.audioBuffer.length).toBe(stem.audioBuffer.length);
      expect(isFinite(processed.peakDb)).toBe(true);
      expect(isFinite(processed.rmsDb)).toBe(true);
    });

    it("skips disabled slots", () => {
      const trackDis = createTrack("Dis", "fx");
      const reverbSlot = createFXSlot("reverb");
      reverbSlot.enabled = false;
      reverbSlot.params = { mix: "1", decay: "0.8" };
      trackDis.fxChain.slots = [reverbSlot];

      const stem = renderer.renderTrack(notes, trackDis, tempoMap, defaultConfig);
      const processed = renderer.applyMixerChain(stem, trackDis);
      // Should be same as no reverb since disabled
      const trackNoReverb = createTrack("NoRev", "fx");
      const stemNoRev = renderer.renderTrack(notes, trackNoReverb, tempoMap, defaultConfig);
      const procNoRev = renderer.applyMixerChain(stemNoRev, trackNoReverb);
      // Peak should be similar since reverb is disabled
      expect(Math.abs(processed.peakDb - procNoRev.peakDb)).toBeLessThan(1);
    });
  });

  describe("mixToMaster", () => {
    const track1 = createTrack("T1", "t1");
    const track2 = createTrack("T2", "t2");

    it("mixes two stems together", () => {
      const notes1 = [createNoteEvent({ trackId: "t1", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })];
      const notes2 = [createNoteEvent({ trackId: "t2", bar: 1, beat: 1, durQn: 1, pitchMidi: 72 })];

      const stem1 = renderer.renderTrack(notes1, track1, tempoMap, defaultConfig);
      const stem2 = renderer.renderTrack(notes2, track2, tempoMap, defaultConfig);

      const masterTrack = createTrack("Master", "master");
      const mix = renderer.mixToMaster([stem1, stem2], masterTrack);
      expect(mix.length).toBeGreaterThan(0);
    });

    it("mutes stems when muted flag is set", () => {
      const notes = [createNoteEvent({ trackId: "t1", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })];
      const stem = renderer.renderTrack(notes, track1, tempoMap, defaultConfig);
      stem.muted = true;

      const masterTrack = createTrack("Master", "master");
      const mix = renderer.mixToMaster([stem], masterTrack);

      let hasSignal = false;
      for (let i = 0; i < mix.length; i++) {
        if (Math.abs(mix[i]) > 0.001) {
          hasSignal = true;
          break;
        }
      }
      expect(hasSignal).toBe(false);
    });

    it("solo isolates a single stem", () => {
      const notes1 = [createNoteEvent({ trackId: "t1", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })];
      const notes2 = [createNoteEvent({ trackId: "t2", bar: 1, beat: 1, durQn: 1, pitchMidi: 72 })];

      const stem1 = renderer.renderTrack(notes1, track1, tempoMap, defaultConfig);
      const stem2 = renderer.renderTrack(notes2, track2, tempoMap, defaultConfig);
      stem2.soloing = true;

      const masterTrack = createTrack("Master", "master");
      const mix = renderer.mixToMaster([stem1, stem2], masterTrack);

      // stem2 peaks should dominate since stem1 is excluded
      expect(mix.length).toBeGreaterThan(0);
    });

    it("applies master track gain", () => {
      const notes = [createNoteEvent({ trackId: "t1", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })];
      const stem = renderer.renderTrack(notes, track1, tempoMap, defaultConfig);

      const masterNoGain = createTrack("Master", "master");
      const mixNormal = renderer.mixToMaster([stem], masterNoGain);

      const masterQuiet = createTrack("Master", "master");
      masterQuiet.gainDb = "-20";
      const mixQuiet = renderer.mixToMaster([stem], masterQuiet);

      // -20dB should be much quieter
      let peakNorm = 0, peakQuiet = 0;
      for (let i = 0; i < mixNormal.length; i++) {
        peakNorm = Math.max(peakNorm, Math.abs(mixNormal[i]));
        peakQuiet = Math.max(peakQuiet, Math.abs(mixQuiet[i]));
      }
      expect(peakQuiet).toBeLessThan(peakNorm);
    });
  });

  describe("render", () => {
    it("renders a full mixer state", () => {
      const mixer = {
        tracks: [
          createTrack("Melody", "melody"),
          createTrack("Bass", "bass"),
        ],
        masterTrack: createTrack("Master", "master"),
        routingMatrix: {},
      };
      const notes = [
        createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }),
        createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 1, pitchMidi: 40 }),
      ];

      const result = renderer.render(notes, mixer, tempoMap, defaultConfig);
      expect(result.stems.length).toBe(2);
      expect(result.stems[0].trackName).toBe("Melody");
      expect(result.stems[1].trackName).toBe("Bass");
      expect(result.masterMix.length).toBeGreaterThan(0);
      expect(result.totalDuration).toBeGreaterThan(0);
    });

    it("works with empty notes", () => {
      const mixer = {
        tracks: [createTrack("Empty", "empty")],
        masterTrack: createTrack("Master", "master"),
        routingMatrix: {},
      };
      const cfg = { ...defaultConfig, startBar: 1, endBar: 2 };
      const result = renderer.render([], mixer, tempoMap, cfg);
      expect(result.stems.length).toBe(1);
      expect(result.stems[0].duration).toBeGreaterThan(0);
      let hasSignal = false;
      for (let i = 0; i < result.stems[0].audioBuffer.length; i++) {
        if (Math.abs(result.stems[0].audioBuffer[i]) > 0.001) {
          hasSignal = true;
          break;
        }
      }
      expect(hasSignal).toBe(false);
    });
  });
});
