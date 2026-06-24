import type { FXChain } from "./audio-routes";

export interface EQParams {
  lowGainDb: string;
  lowFreq: string;
  lowQ: string;
  midGainDb: string;
  midFreq: string;
  midQ: string;
  highGainDb: string;
  highFreq: string;
  highQ: string;
}

export interface CompressorParams {
  thresholdDb: string;
  ratio: string;
  attackMs: string;
  releaseMs: string;
  makeupGainDb: string;
  knee: string;
}

export interface ReverbParams {
  roomSize: string;
  damping: string;
  width: string;
  wetLevel: string;
  dryLevel: string;
  preDelayMs: string;
}

export interface DelayParams {
  timeMs: string;
  feedback: string;
  wetLevel: string;
  pingPong: boolean;
  lowCutHz: string;
  highCutHz: string;
}

function biquadLowShelf(
  input: Float32Array,
  sampleRate: number,
  freq: number,
  gainDb: number,
  q: number
): Float32Array {
  const output = new Float32Array(input.length);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sinW0 / (2 * q);
  const Aplus1 = A + 1;
  const Aminus1 = A - 1;

  const b0 = A * (Aplus1 - Aminus1 * cosW0 + alpha);
  const b1 = 2 * A * (Aminus1 - Aplus1 * cosW0);
  const b2 = A * (Aplus1 - Aminus1 * cosW0 - alpha);
  const a0 = Aplus1 + Aminus1 * cosW0 + alpha;
  const a1 = -2 * (Aminus1 + Aplus1 * cosW0);
  const a2 = Aplus1 + Aminus1 * cosW0 - alpha;

  const b0n = b0 / a0;
  const b1n = b1 / a0;
  const b2n = b2 / a0;
  const a1n = a1 / a0;
  const a2n = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0n * x0 + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function biquadPeak(
  input: Float32Array,
  sampleRate: number,
  freq: number,
  gainDb: number,
  q: number
): Float32Array {
  const output = new Float32Array(input.length);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sinW0 / (2 * q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  const b0n = b0 / a0;
  const b1n = b1 / a0;
  const b2n = b2 / a0;
  const a1n = a1 / a0;
  const a2n = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0n * x0 + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function biquadHighShelf(
  input: Float32Array,
  sampleRate: number,
  freq: number,
  gainDb: number,
  q: number
): Float32Array {
  const output = new Float32Array(input.length);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sinW0 / (2 * q);
  const Aplus1 = A + 1;
  const Aminus1 = A - 1;

  const b0 = A * (Aplus1 + Aminus1 * cosW0 + alpha);
  const b1 = -2 * A * (Aminus1 + Aplus1 * cosW0);
  const b2 = A * (Aplus1 + Aminus1 * cosW0 - alpha);
  const a0 = Aplus1 - Aminus1 * cosW0 + alpha;
  const a1 = 2 * (Aminus1 - Aplus1 * cosW0);
  const a2 = Aplus1 - Aminus1 * cosW0 - alpha;

  const b0n = b0 / a0;
  const b1n = b1 / a0;
  const b2n = b2 / a0;
  const a1n = a1 / a0;
  const a2n = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0n * x0 + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

export function applyEQ(
  samples: Float32Array,
  sampleRate: number,
  params: EQParams
): Float32Array {
  let out = samples;
  const lowGain = parseFloat(params.lowGainDb);
  const lowFreq = parseFloat(params.lowFreq);
  const lowQ = parseFloat(params.lowQ);
  if (lowGain !== 0) {
    out = biquadLowShelf(out, sampleRate, lowFreq, lowGain, lowQ);
  }

  const midGain = parseFloat(params.midGainDb);
  const midFreq = parseFloat(params.midFreq);
  const midQ = parseFloat(params.midQ);
  if (midGain !== 0) {
    out = biquadPeak(out, sampleRate, midFreq, midGain, midQ);
  }

  const highGain = parseFloat(params.highGainDb);
  const highFreq = parseFloat(params.highFreq);
  const highQ = parseFloat(params.highQ);
  if (highGain !== 0) {
    out = biquadHighShelf(out, sampleRate, highFreq, highGain, highQ);
  }

  return out;
}

export function applyCompressor(
  samples: Float32Array,
  params: CompressorParams
): Float32Array {
  const output = new Float32Array(samples.length);
  const threshold = parseFloat(params.thresholdDb);
  const ratio = parseFloat(params.ratio);
  const attack = parseFloat(params.attackMs) / 1000;
  const release = parseFloat(params.releaseMs) / 1000;
  const makeupGain = Math.pow(10, parseFloat(params.makeupGainDb) / 20);
  const knee = parseFloat(params.knee);
  const thresholdLinear = Math.pow(10, threshold / 20);

  const attackCoeff = Math.exp(-1 / (Math.max(attack, 0.001) * 44100));
  const releaseCoeff = Math.exp(-1 / (Math.max(release, 0.001) * 44100));
  let envelope = 0;

  for (let i = 0; i < samples.length; i++) {
    const absSample = Math.abs(samples[i]);
    envelope =
      absSample > envelope
        ? attackCoeff * envelope + (1 - attackCoeff) * absSample
        : releaseCoeff * envelope + (1 - releaseCoeff) * absSample;

    const levelDb = 20 * Math.log10(Math.max(envelope, 1e-10));
    let gainReductionDb = 0;

    if (levelDb > threshold + knee / 2) {
      gainReductionDb =
        (1 - 1 / ratio) * (levelDb - threshold + knee / 2);
    } else if (levelDb > threshold - knee / 2) {
      const overshoot = levelDb - (threshold - knee / 2);
      gainReductionDb =
        (1 - 1 / ratio) * (overshoot * overshoot) / (2 * knee);
    }

    const gr = Math.pow(10, -gainReductionDb / 20);
    output[i] = samples[i] * gr * makeupGain;
  }

  return output;
}

export function applyReverb(
  samples: Float32Array,
  sampleRate: number,
  params: ReverbParams
): Float32Array {
  const wet = parseFloat(params.wetLevel);
  const dry = parseFloat(params.dryLevel);
  const roomSize = parseFloat(params.roomSize);
  const damping = parseFloat(params.damping);
  const preDelaySamples = Math.floor(
    (parseFloat(params.preDelayMs) / 1000) * sampleRate
  );

  const output = new Float32Array(samples.length);

  const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
  const combBuffers: Float32Array[] = combDelays.map(
    (d) => new Float32Array(d)
  );
  const combIndices = new Int32Array(combDelays.length);

  const allpassDelays = [225, 556, 441, 341];
  const allpassBuffers: Float32Array[] = allpassDelays.map(
    (d) => new Float32Array(d)
  );
  const allpassIndices = new Int32Array(allpassDelays.length);

  for (let i = 0; i < samples.length; i++) {
    const input = samples[i];

    let wetSignal = 0;
    for (let c = 0; c < combDelays.length; c++) {
      const delayLen = combDelays[c];
      const idx = combIndices[c];
      const delayed = combBuffers[c][idx];

      const damped = delayed * (1 - damping);
      combBuffers[c][idx] = input + damped * roomSize;
      combIndices[c] = (idx + 1) % delayLen;
      wetSignal += delayed;
    }
    wetSignal /= combDelays.length;

    for (let a = 0; a < allpassDelays.length; a++) {
      const delayLen = allpassDelays[a];
      const idx = allpassIndices[a];
      const delayed = allpassBuffers[a][idx];

      allpassBuffers[a][idx] = wetSignal + delayed * 0.5;
      allpassIndices[a] = (idx + 1) % delayLen;
      wetSignal = delayed - wetSignal * 0.5;
    }

    const delayIdx = Math.max(0, i - preDelaySamples);
    output[i] = samples[delayIdx] * dry + wetSignal * wet;
  }

  return output;
}

export function applyDelay(
  samples: Float32Array,
  sampleRate: number,
  params: DelayParams
): Float32Array {
  const timeMs = parseFloat(params.timeMs);
  const feedback = parseFloat(params.feedback);
  const wetLevel = parseFloat(params.wetLevel);
  const pingPong = params.pingPong;
  const lowCutHz = parseFloat(params.lowCutHz);
  const highCutHz = parseFloat(params.highCutHz);

  const delaySamples = Math.floor((timeMs / 1000) * sampleRate);
  if (delaySamples <= 0) {
    return samples;
  }

  const output = new Float32Array(samples.length);
  const bufferLen = pingPong ? delaySamples * 2 : delaySamples;
  const buffer = new Float32Array(bufferLen);
  let writeIdx = 0;

  let lowStateL = 0, lowStateR = 0;
  let highStateL = 0, highStateR = 0;

  const lowCoeff =
    lowCutHz > 0
      ? Math.exp(-2 * Math.PI * lowCutHz / sampleRate)
      : 1;
  const highCoeff =
    highCutHz < sampleRate / 2
      ? Math.exp(-2 * Math.PI * highCutHz / sampleRate)
      : 1;

  for (let i = 0; i < samples.length; i++) {
    const input = samples[i];

    const readIdxL =
      (writeIdx - delaySamples + bufferLen) % bufferLen;
    const readIdxR = pingPong
      ? (writeIdx - delaySamples * 2 + bufferLen) % bufferLen
      : readIdxL;

    const delayedL = buffer[readIdxL];
    const delayedR = pingPong ? buffer[readIdxR] : delayedL;

    // Simple low/high cut on delayed signal
    lowStateL = lowCoeff * lowStateL + (1 - lowCoeff) * delayedL;
    const filteredL = lowStateL;
    highStateL = highCoeff * highStateL + (1 - highCoeff) * (filteredL - highStateL);

    output[i] = input + highStateL * wetLevel;

    buffer[writeIdx] = input + delayedL * feedback;
    writeIdx = (writeIdx + 1) % bufferLen;

    if (pingPong) {
      lowStateR = lowCoeff * lowStateR + (1 - lowCoeff) * delayedR;
      const filteredR = lowStateR;
      highStateR = highCoeff * highStateR + (1 - highCoeff) * (filteredR - highStateR);

      buffer[writeIdx] = input + delayedR * feedback;
      writeIdx = (writeIdx + 1) % bufferLen;
    }
  }

  return output;
}

export function applyLimiter(
  samples: Float32Array,
  ceiling: number
): Float32Array {
  const output = new Float32Array(samples.length);
  const absCeiling = Math.max(0, Math.min(1, ceiling));
  for (let i = 0; i < samples.length; i++) {
    output[i] = Math.max(-absCeiling, Math.min(absCeiling, samples[i]));
  }
  return output;
}

export function processFXChain(
  input: Float32Array,
  sampleRate: number,
  chain: FXChain
): Float32Array {
  let out = input;
  for (const slot of chain.slots) {
    if (!slot.enabled) continue;

    switch (slot.type) {
      case "eq": {
        const eqParams: EQParams = {
          lowGainDb: slot.params.lowGainDb ?? "0",
          lowFreq: slot.params.lowFreq ?? "200",
          lowQ: slot.params.lowQ ?? "0.7",
          midGainDb: slot.params.midGainDb ?? "0",
          midFreq: slot.params.midFreq ?? "1000",
          midQ: slot.params.midQ ?? "1.0",
          highGainDb: slot.params.highGainDb ?? "0",
          highFreq: slot.params.highFreq ?? "5000",
          highQ: slot.params.highQ ?? "0.7",
        };
        out = applyEQ(out, sampleRate, eqParams);
        break;
      }
      case "compressor": {
        const compParams: CompressorParams = {
          thresholdDb: slot.params.thresholdDb ?? "-20",
          ratio: slot.params.ratio ?? "4",
          attackMs: slot.params.attackMs ?? "10",
          releaseMs: slot.params.releaseMs ?? "100",
          makeupGainDb: slot.params.makeupGainDb ?? "0",
          knee: slot.params.knee ?? "2",
        };
        out = applyCompressor(out, compParams);
        break;
      }
      case "reverb": {
        const revParams: ReverbParams = {
          roomSize: slot.params.roomSize ?? "0.5",
          damping: slot.params.damping ?? "0.5",
          width: slot.params.width ?? "1.0",
          wetLevel: slot.params.wetLevel ?? "0.3",
          dryLevel: slot.params.dryLevel ?? "0.7",
          preDelayMs: slot.params.preDelayMs ?? "20",
        };
        out = applyReverb(out, sampleRate, revParams);
        break;
      }
      case "delay": {
        const delParams: DelayParams = {
          timeMs: slot.params.timeMs ?? "300",
          feedback: slot.params.feedback ?? "0.3",
          wetLevel: slot.params.wetLevel ?? "0.3",
          pingPong: slot.params.pingPong === "true",
          lowCutHz: slot.params.lowCutHz ?? "200",
          highCutHz: slot.params.highCutHz ?? "8000",
        };
        out = applyDelay(out, sampleRate, delParams);
        break;
      }
      case "limiter": {
        const ceiling = parseFloat(slot.params.ceiling ?? "1");
        out = applyLimiter(out, ceiling);
        break;
      }
      case "saturator":
        break;
    }
  }
  return out;
}
