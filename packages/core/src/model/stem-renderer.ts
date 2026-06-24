import { NoteEvent } from "./note-event";
import { TempoMap } from "./tempo-map";
import {
  MixerState,
  MixerTrack,
  FXSlot,
  FXType,
  SendConfig,
} from "./audio-routes";
import { AudioExporter } from "../io/audio-exporter";

const DEFAULT_SAMPLE_RATE = 44100;
const NORMALIZE_CEILING_DB = -0.3;

const oscillatorPhase = (pitchMidi: number, sampleRate: number, phase: number, numSamples: number): Float32Array => {
  const freq = 440 * Math.pow(2, (pitchMidi - 69) / 12);
  const out = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = Math.sin(2 * Math.PI * freq * (phase + i) / sampleRate);
  }
  return out;
};

const applyEnvelope = (buffer: Float32Array, attackSamples: number, releaseSamples: number): void => {
  for (let i = 0; i < buffer.length; i++) {
    let env = 1;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else if (buffer.length - i <= releaseSamples) {
      env = (buffer.length - i) / releaseSamples;
    }
    buffer[i] *= env;
  }
};

function dbToGain(db: number): number {
  if (db <= -100) return 0;
  return Math.pow(10, db / 20);
}

function gainToDb(gain: number): number {
  if (gain <= 0) return -100;
  return 20 * Math.log10(gain);
}

function peakDb(buffer: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  return gainToDb(peak);
}

function rmsDb(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / (buffer.length || 1));
  return gainToDb(rms || 1e-10);
}

function normalizeBuffer(buffer: Float32Array, ceilingDb: number): Float32Array {
  const peak = peakDb(buffer);
  const targetGain = dbToGain(ceilingDb - peak);
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    out[i] = buffer[i] * targetGain;
  }
  return out;
}

/**
 * Soft-clip saturator via tanh
 */
function applySaturator(buffer: Float32Array, driveDb: string): void {
  const drive = dbToGain(parseFloat(driveDb || "0"));
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.tanh(buffer[i] * drive);
  }
}

/**
 * 3-band EQ: low shelf, peaking mid, high shelf
 */
function applyEQ(buffer: Float32Array, params: Record<string, string>, sampleRate: number): void {
  const lowGainDb = parseFloat(params.lowGain ?? "0");
  const lowFreq = parseFloat(params.lowFreq ?? "250");
  const midGainDb = parseFloat(params.midGain ?? "0");
  const midFreq = parseFloat(params.midFreq ?? "1000");
  const midQ = parseFloat(params.midQ ?? "0.7");
  const highGainDb = parseFloat(params.highGain ?? "0");
  const highFreq = parseFloat(params.highFreq ?? "4000");

  if (lowGainDb === 0 && midGainDb === 0 && highGainDb === 0) return;

  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i];

    // Low shelf
    let lowSample = filterShelf(sample, lowFreq, sampleRate, lowGainDb, i, "low");
    // Peaking mid
    let midSample = filterPeak(lowSample, midFreq, sampleRate, midGainDb, midQ, i);
    // High shelf
    let highSample = filterShelf(midSample, highFreq, sampleRate, highGainDb, i, "high");

    buffer[i] = highSample;
  }
}

const eqState: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};

function filterShelf(
  x: number, freq: number, sr: number, db: number, _idx: number, type: "low" | "high"
): number {
  const key = `shelf_${freq}_${type}`;
  if (!eqState[key]) eqState[key] = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const st = eqState[key];

  const gain = dbToGain(db);
  const w0 = 2 * Math.PI * freq / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.sqrt(gain);
  const alpha = sinw / 2;

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

  if (type === "low") {
    b0 = A * ((A + 1) - (A - 1) * cosw + 2 * Math.sqrt(A) * alpha);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
    b2 = A * ((A + 1) - (A - 1) * cosw - 2 * Math.sqrt(A) * alpha);
    a0 = (A + 1) + (A - 1) * cosw + 2 * Math.sqrt(A) * alpha;
    a1 = -2 * ((A - 1) + (A + 1) * cosw);
    a2 = (A + 1) + (A - 1) * cosw - 2 * Math.sqrt(A) * alpha;
  } else {
    b0 = A * ((A + 1) + (A - 1) * cosw + 2 * Math.sqrt(A) * alpha);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
    b2 = A * ((A + 1) + (A - 1) * cosw - 2 * Math.sqrt(A) * alpha);
    a0 = (A + 1) - (A - 1) * cosw + 2 * Math.sqrt(A) * alpha;
    a1 = 2 * ((A - 1) - (A + 1) * cosw);
    a2 = (A + 1) - (A - 1) * cosw - 2 * Math.sqrt(A) * alpha;
  }

  const y = (b0 * x + b1 * st.x1 + b2 * st.x2 - a1 * st.y1 - a2 * st.y2) / a0;
  st.x2 = st.x1; st.x1 = x;
  st.y2 = st.y1; st.y1 = y;
  return y;
}

function filterPeak(
  x: number, freq: number, sr: number, db: number, Q: number, _idx: number
): number {
  const key = `peak_${freq}_${Q}`;
  if (!eqState[key]) eqState[key] = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const st = eqState[key];

  const gain = dbToGain(db);
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const A = Math.sqrt(gain);

  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;

  const y = (b0 * x + b1 * st.x1 + b2 * st.x2 - a1 * st.y1 - a2 * st.y2) / a0;
  st.x2 = st.x1; st.x1 = x;
  st.y2 = st.y1; st.y1 = y;
  return y;
}

function resetEQState(): void {
  for (const key of Object.keys(eqState)) {
    delete eqState[key];
  }
}

/**
 * Compressor: simple feed-forward with threshold, ratio, attack, release
 */
function applyCompressor(buffer: Float32Array, params: Record<string, string>, sampleRate: number): void {
  const thresholdDb = parseFloat(params.threshold ?? "-24");
  const ratio = parseFloat(params.ratio ?? "4");
  const attackMs = parseFloat(params.attack ?? "10");
  const releaseMs = parseFloat(params.release ?? "100");
  const makeupDb = parseFloat(params.makeup ?? "0");

  const threshold = dbToGain(thresholdDb);
  const attackCoef = Math.exp(-1 / (sampleRate * attackMs / 1000));
  const releaseCoef = Math.exp(-1 / (sampleRate * releaseMs / 1000));
  const makeup = dbToGain(makeupDb);

  let env = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > env) {
      env = attackCoef * env + (1 - attackCoef) * abs;
    } else {
      env = releaseCoef * env + (1 - releaseCoef) * abs;
    }

    let gain = 1;
    if (env > threshold) {
      const overshoot = env / threshold;
      gain = 1 / (1 + (overshoot - 1) / ratio);
    }

    buffer[i] *= gain * makeup;
  }
}

/**
 * Simple Schroeder reverb
 */
function applyReverb(buffer: Float32Array, params: Record<string, string>, sampleRate: number): void {
  const mix = parseFloat(params.mix ?? "0.3");
  const decay = parseFloat(params.decay ?? "0.5");
  if (mix <= 0) return;

  const combDelays = [Math.floor(sampleRate * 0.0297), Math.floor(sampleRate * 0.0371),
    Math.floor(sampleRate * 0.0411), Math.floor(sampleRate * 0.0437)];
  const apDelays = [Math.floor(sampleRate * 0.005), Math.floor(sampleRate * 0.0017)];

  const combBufs = combDelays.map(d => new Float32Array(d));
  const apBufs = apDelays.map(d => new Float32Array(d));
  let combIdx = new Array(4).fill(0);
  let apIdx = new Array(2).fill(0);

  const wet = new Float32Array(buffer.length);

  for (let i = 0; i < buffer.length; i++) {
    const inSample = buffer[i];

    let combOut = 0;
    for (let c = 0; c < 4; c++) {
      const delay = combDelays[c];
      const delayed = combBufs[c][combIdx[c]];
      combBufs[c][combIdx[c]] = inSample + delayed * decay;
      combIdx[c] = (combIdx[c] + 1) % delay;
      combOut += delayed;
    }
    combOut *= 0.25;

    let apOut = combOut;
    for (let a = 0; a < 2; a++) {
      const delay = apDelays[a];
      const delayed = apBufs[a][apIdx[a]];
      const feed = apOut + delayed * 0.5;
      apBufs[a][apIdx[a]] = feed;
      apIdx[a] = (apIdx[a] + 1) % delay;
      apOut = delayed - feed * 0.5;
    }

    wet[i] = apOut;
  }

  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = buffer[i] * (1 - mix) + wet[i] * mix;
  }
}

/**
 * Feedback delay
 */
function applyDelay(buffer: Float32Array, params: Record<string, string>, sampleRate: number): void {
  const mix = parseFloat(params.mix ?? "0.3");
  const timeMs = parseFloat(params.time ?? "250");
  const feedback = parseFloat(params.feedback ?? "0.4");
  if (mix <= 0) return;

  const delaySamples = Math.max(1, Math.floor(sampleRate * timeMs / 1000));
  const delayBuf = new Float32Array(delaySamples);
  let delayIdx = 0;

  for (let i = 0; i < buffer.length; i++) {
    const delayed = delayBuf[delayIdx];
    delayBuf[delayIdx] = buffer[i] + delayed * feedback;
    delayIdx = (delayIdx + 1) % delaySamples;

    buffer[i] = buffer[i] * (1 - mix) + delayed * mix;
  }
}

/**
 * Look-ahead brickwall limiter
 */
function applyLimiter(buffer: Float32Array, params: Record<string, string>, _sampleRate: number): void {
  const ceilingDb = parseFloat(params.ceiling ?? "-0.3");
  const releaseMs = parseFloat(params.release ?? "50");
  const ceiling = dbToGain(ceilingDb);
  const releaseCoef = Math.exp(-1 / (_sampleRate * releaseMs / 1000));

  let gainReduction = 0;
  let holdSamples = Math.floor(_sampleRate * 0.001); // 1ms look-ahead

  for (let i = 0; i < buffer.length; i++) {
    let peak = 0;
    for (let j = 0; j < holdSamples && i + j < buffer.length; j++) {
      const abs = Math.abs(buffer[i + j]);
      if (abs > peak) peak = abs;
    }

    const targetGr = peak > ceiling ? ceiling / peak : 1;
    gainReduction = targetGr < gainReduction
      ? targetGr
      : releaseCoef * gainReduction + (1 - releaseCoef) * 1;

    buffer[i] = Math.max(-ceiling, Math.min(ceiling, buffer[i] * (gainReduction < 1 ? gainReduction : 1)));
  }
}

export interface RenderConfig {
  sampleRate: number;
  startBar?: number;
  endBar?: number;
  format: "wav" | "aiff";
  bitDepth: 16 | 24 | 32;
  normalizeStems: boolean;
}

export interface StemResult {
  trackId: string;
  trackName: string;
  busId: string;
  audioBuffer: Float32Array;
  peakDb: number;
  rmsDb: number;
  duration: number;
  muted: boolean;
  soloing: boolean;
}

export interface RenderResult {
  stems: StemResult[];
  masterMix: Float32Array;
  totalDuration: number;
  config: RenderConfig;
}

const RENDER_FX_ORDER: FXType[] = ["eq", "compressor", "saturator", "delay", "reverb", "limiter"];

export class StemRenderer {
  render(
    notes: NoteEvent[],
    mixer: MixerState,
    tempoMap: TempoMap,
    config: RenderConfig,
  ): RenderResult {
    resetEQState();
    const stems: StemResult[] = [];
    const allTracks = [...mixer.tracks, mixer.masterTrack];

    for (const track of mixer.tracks) {
      const trackNotes = notes.filter(n => n.trackId === track.sourceTrackId);
      const stem = this.renderTrack(trackNotes, track, tempoMap, config);
      const processed = this.applyMixerChain(stem, track);
      stems.push(processed);
    }

    const masterMix = this.mixToMaster(stems, mixer.masterTrack);
    const totalDuration = masterMix.length / config.sampleRate;

    return {
      stems,
      masterMix,
      totalDuration,
      config,
    };
  }

  renderTrack(
    notes: NoteEvent[],
    track: MixerTrack,
    tempoMap: TempoMap,
    config: RenderConfig,
  ): StemResult {
    const sampleRate = config.sampleRate;
    const startBar = config.startBar ?? 1;
    const endBar = config.endBar ?? Math.ceil(tempoMap.getBarsDuration());

    const startTime = tempoMap.timeAt(startBar, 1);
    const endTime = tempoMap.timeAt(endBar, 1);
    const duration = endTime - startTime;

    if (duration <= 0) {
      return {
        trackId: track.sourceTrackId,
        trackName: track.name,
        busId: track.id,
        audioBuffer: new Float32Array(0),
        peakDb: -100,
        rmsDb: -100,
        duration: 0,
        muted: track.mute,
        soloing: track.solo,
      };
    }

    const numSamples = Math.max(1, Math.floor(duration * sampleRate));
    const buffer = new Float32Array(numSamples);

    for (const note of notes) {
      const noteStartSec = tempoMap.timeAt(note.bar, note.beat);
      if (noteStartSec >= endTime) continue;

      const noteDurSec = tempoMap.timeAt(
        note.bar,
        note.beat + note.durQn,
      ) - noteStartSec;

      const noteEndSec = noteStartSec + noteDurSec;
      if (noteEndSec <= startTime) continue;

      const renderStart = Math.max(0, Math.floor((noteStartSec - startTime) * sampleRate));
      const renderEnd = Math.min(numSamples, Math.ceil((noteEndSec - startTime) * sampleRate));
      const renderLen = renderEnd - renderStart;
      if (renderLen <= 0) continue;

      const vel = Math.max(0, Math.min(1, note.velocity));
      const attackSamples = Math.min(renderLen, Math.floor(sampleRate * 0.002)); // 2ms attack
      const releaseSamples = Math.min(renderLen, Math.floor(sampleRate * noteDurSec * 0.1)); // 10% release

      const oscBuf = oscillatorPhase(note.pitchMidi, sampleRate, noteStartSec * sampleRate + renderStart - startTime * sampleRate, renderLen);
      applyEnvelope(oscBuf, attackSamples, releaseSamples);

      for (let i = 0; i < renderLen; i++) {
        const idx = renderStart + i;
        if (idx >= 0 && idx < numSamples) {
          buffer[idx] += oscBuf[i] * vel;
        }
      }
    }

    return {
      trackId: track.sourceTrackId,
      trackName: track.name,
      busId: track.id,
      audioBuffer: buffer,
      peakDb: peakDb(buffer),
      rmsDb: rmsDb(buffer),
      duration,
      muted: track.mute,
      soloing: track.solo,
    };
  }

  applyMixerChain(stem: StemResult, track: MixerTrack): StemResult {
    let buf = new Float32Array(stem.audioBuffer);
    const sampleRate = DEFAULT_SAMPLE_RATE;

    for (const slot of track.fxChain.slots) {
      if (!slot.enabled) continue;
      switch (slot.type as FXType) {
        case "eq":
          applyEQ(buf, slot.params, sampleRate);
          break;
        case "compressor":
          applyCompressor(buf, slot.params, sampleRate);
          break;
        case "saturator":
          applySaturator(buf, slot.params.drive ?? "0");
          break;
        case "delay":
          applyDelay(buf, slot.params, sampleRate);
          break;
        case "reverb":
          applyReverb(buf, slot.params, sampleRate);
          break;
        case "limiter":
          applyLimiter(buf, slot.params, sampleRate);
          break;
      }
    }

    const gain = dbToGain(parseFloat(track.gainDb || "0"));

    for (let i = 0; i < buf.length; i++) {
      buf[i] *= gain;
    }

    return {
      ...stem,
      audioBuffer: buf,
      peakDb: peakDb(buf),
      rmsDb: rmsDb(buf),
    };
  }

  mixToMaster(stems: StemResult[], masterTrack: MixerTrack): Float32Array {
    const maxLen = Math.max(0, ...stems.map(s => s.audioBuffer.length));
    if (maxLen === 0) return new Float32Array(0);

    const mix = new Float32Array(maxLen);
    const activeStems = stems.filter(s => !s.muted);
    const hasSolo = activeStems.some(s => s.soloing);

    const toMix = hasSolo ? activeStems.filter(s => s.soloing) : activeStems;

    for (const stem of toMix) {
      for (let i = 0; i < stem.audioBuffer.length; i++) {
        mix[i] += stem.audioBuffer[i];
      }
    }

    const gain = dbToGain(parseFloat(masterTrack.gainDb || "0"));
    for (let i = 0; i < mix.length; i++) {
      mix[i] *= gain;
    }

    for (const slot of masterTrack.fxChain.slots) {
      if (!slot.enabled) continue;
      switch (slot.type as FXType) {
        case "eq":
          applyEQ(mix, slot.params, DEFAULT_SAMPLE_RATE);
          break;
        case "compressor":
          applyCompressor(mix, slot.params, DEFAULT_SAMPLE_RATE);
          break;
        case "limiter":
          applyLimiter(mix, slot.params, DEFAULT_SAMPLE_RATE);
          break;
        case "saturator":
          applySaturator(mix, slot.params.drive ?? "0");
          break;
        case "delay":
          applyDelay(mix, slot.params, DEFAULT_SAMPLE_RATE);
          break;
        case "reverb":
          applyReverb(mix, slot.params, DEFAULT_SAMPLE_RATE);
          break;
      }
    }

    return mix;
  }

  async exportStems(result: RenderResult, outputDir: string): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    await fs.mkdir(outputDir, { recursive: true });

    for (const stem of result.stems) {
      const safeName = stem.trackName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
      const filePath = path.join(outputDir, `${safeName}.wav`);

      let buffer = stem.audioBuffer;
      if (result.config.normalizeStems) {
        buffer = normalizeBuffer(buffer, NORMALIZE_CEILING_DB);
      }

      const wav = AudioExporter.encodeWAV([buffer], {
        sampleRate: result.config.sampleRate,
        bitDepth: result.config.bitDepth,
        channels: 1,
      });

      await fs.writeFile(filePath, new Uint8Array(wav));
    }

    let masterBuffer = result.masterMix;
    if (result.config.normalizeStems) {
      masterBuffer = normalizeBuffer(masterBuffer, NORMALIZE_CEILING_DB);
    }

    const masterWav = AudioExporter.encodeWAV([masterBuffer], {
      sampleRate: result.config.sampleRate,
      bitDepth: result.config.bitDepth,
      channels: 1,
    });

    const masterPath = path.join(outputDir, "master.wav");
    await fs.writeFile(masterPath, new Uint8Array(masterWav));
  }
}
