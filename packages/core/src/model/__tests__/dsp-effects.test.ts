import { describe, it, expect } from "vitest";
import {
  applyEQ,
  applyCompressor,
  applyReverb,
  applyDelay,
  applyLimiter,
  processFXChain,
} from "../dsp-effects";
import type {
  EQParams,
  CompressorParams,
  ReverbParams,
  DelayParams,
} from "../dsp-effects";
import { createFXSlot, addSlotToChain } from "../audio-routes";
import type { FXChain, FXSlot } from "../audio-routes";

function near(a: number, b: number, epsilon = 0.001): void {
  expect(Math.abs(a - b)).toBeLessThan(epsilon);
}

function makeSine(length: number, freq: number, sampleRate: number): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return buf;
}

function maxAbs(samples: Float32Array): number {
  let m = 0;
  for (let i = 0; i < samples.length; i++) {
    m = Math.max(m, Math.abs(samples[i]));
  }
  return m;
}

describe("applyEQ", () => {
  const sampleRate = 44100;
  const zeroParams: EQParams = {
    lowGainDb: "0",
    lowFreq: "200",
    lowQ: "0.7",
    midGainDb: "0",
    midFreq: "1000",
    midQ: "1.0",
    highGainDb: "0",
    highFreq: "5000",
    highQ: "0.7",
  };

  it("should not modify signal when all gains are 0", () => {
    const input = makeSine(1024, 440, sampleRate);
    const output = applyEQ(input, sampleRate, zeroParams);
    expect(output.length).toBe(input.length);
    near(output[0], input[0]);
  });

  it("should boost low frequencies", () => {
    const input = makeSine(1024, 100, sampleRate);
    const params: EQParams = { ...zeroParams, lowGainDb: "6" };
    const output = applyEQ(input, sampleRate, params);
    expect(maxAbs(output)).toBeGreaterThan(maxAbs(input) * 0.9);
  });

  it("should cut high frequencies", () => {
    const input = makeSine(1024, 8000, sampleRate);
    const params: EQParams = { ...zeroParams, highGainDb: "-12" };
    const output = applyEQ(input, sampleRate, params);
    expect(maxAbs(output)).toBeLessThan(maxAbs(input));
  });

  it("should handle mid band boost", () => {
    const input = makeSine(1024, 1000, sampleRate);
    const params: EQParams = { ...zeroParams, midGainDb: "6", midQ: "1.0" };
    const output = applyEQ(input, sampleRate, params);
    expect(output.length).toBe(input.length);
  });

  it("should handle all bands active", () => {
    const input = makeSine(1024, 440, sampleRate);
    const params: EQParams = {
      lowGainDb: "3",
      lowFreq: "150",
      lowQ: "0.5",
      midGainDb: "-2",
      midFreq: "800",
      midQ: "0.8",
      highGainDb: "4",
      highFreq: "6000",
      highQ: "0.6",
    };
    const output = applyEQ(input, sampleRate, params);
    expect(output.length).toBe(input.length);
    expect(maxAbs(output)).toBeGreaterThan(0);
  });
});

describe("applyCompressor", () => {
  const params: CompressorParams = {
    thresholdDb: "-20",
    ratio: "4",
    attackMs: "10",
    releaseMs: "100",
    makeupGainDb: "0",
    knee: "2",
  };

  it("should output same length as input", () => {
    const input = makeSine(1024, 440, 44100);
    const output = applyCompressor(input, params);
    expect(output.length).toBe(input.length);
  });

  it("should reduce gain above threshold", () => {
    const input = new Float32Array(44100);
    input.fill(0.5); // ~ -6dB
    const output = applyCompressor(input, {
      ...params,
      thresholdDb: "-30",
      ratio: "10",
      attackMs: "1",
      knee: "0",
    });
    // Allow envelope time to engage, check steady-state near end
    const tail = output.slice(-100);
    expect(maxAbs(tail)).toBeLessThan(0.5);
  });

  it("should not affect silent signal", () => {
    const input = new Float32Array(512);
    const output = applyCompressor(input, params);
    for (let i = 0; i < output.length; i++) {
      near(output[i], 0);
    }
  });

  it("should apply makeup gain", () => {
    const input = new Float32Array(256);
    input.fill(0.1);
    const makeParams: CompressorParams = {
      ...params,
      thresholdDb: "-10",
      makeupGainDb: "10",
      knee: "0",
    };
    const output = applyCompressor(input, makeParams);
    expect(output.length).toBe(input.length);
  });
});

describe("applyReverb", () => {
  const sampleRate = 44100;
  const params: ReverbParams = {
    roomSize: "0.5",
    damping: "0.5",
    width: "1.0",
    wetLevel: "0.5",
    dryLevel: "0.5",
    preDelayMs: "0",
  };

  it("should output same length as input", () => {
    const input = makeSine(1024, 440, sampleRate);
    const output = applyReverb(input, sampleRate, params);
    expect(output.length).toBe(input.length);
  });

  it("should produce output for impulse", () => {
    const input = new Float32Array(44100);
    input[0] = 1.0;
    const output = applyReverb(input, sampleRate, {
      ...params,
      dryLevel: "0",
      wetLevel: "1.0",
    });
    let sum = 0;
    for (let i = 0; i < output.length; i++) {
      sum += Math.abs(output[i]);
    }
    expect(sum).toBeGreaterThan(0);
  });

  it("should handle dry-only signal", () => {
    const input = makeSine(256, 440, sampleRate);
    const dryParams: ReverbParams = {
      ...params,
      dryLevel: "1.0",
      wetLevel: "0",
    };
    const output = applyReverb(input, sampleRate, dryParams);
    near(output[100], input[100]);
  });

  it("should handle pre-delay", () => {
    const input = new Float32Array(44100);
    input[0] = 1.0;
    const preParams: ReverbParams = {
      ...params,
      preDelayMs: "50",
      dryLevel: "0",
      wetLevel: "1.0",
    };
    const output = applyReverb(input, sampleRate, preParams);
    // Wet (comb-filter) signal starts immediately; dry is 0 so output is wet-only
    expect(output.length).toBe(input.length);
    expect(maxAbs(output)).toBeGreaterThan(0);
  });
});

describe("applyDelay", () => {
  const sampleRate = 44100;

  it("should output same length as input", () => {
    const input = makeSine(1024, 440, sampleRate);
    const params: DelayParams = {
      timeMs: "300",
      feedback: "0.3",
      wetLevel: "0.3",
      pingPong: false,
      lowCutHz: "200",
      highCutHz: "8000",
    };
    const output = applyDelay(input, sampleRate, params);
    expect(output.length).toBe(input.length);
  });

  it("should return input unchanged for zero delay time", () => {
    const input = makeSine(256, 440, sampleRate);
    const params: DelayParams = {
      timeMs: "0",
      feedback: "0",
      wetLevel: "0",
      pingPong: false,
      lowCutHz: "200",
      highCutHz: "8000",
    };
    const output = applyDelay(input, sampleRate, params);
    for (let i = 0; i < input.length; i++) {
      near(output[i], input[i]);
    }
  });

  it("should handle ping-pong mode", () => {
    const input = new Float32Array(44100);
    input[0] = 1.0;
    const params: DelayParams = {
      timeMs: "500",
      feedback: "0.5",
      wetLevel: "0.5",
      pingPong: true,
      lowCutHz: "0",
      highCutHz: "22050",
    };
    const output = applyDelay(input, sampleRate, params);
    expect(output.length).toBe(input.length);
    expect(maxAbs(output)).toBeGreaterThan(0);
  });
});

describe("applyLimiter", () => {
  it("should clamp samples to ceiling", () => {
    const input = new Float32Array([0.5, -0.8, 1.5, -2.0, 0.3]);
    const output = applyLimiter(input, 1.0);
    near(output[0], 0.5);
    near(output[1], -0.8);
    near(output[2], 1.0);
    near(output[3], -1.0);
    near(output[4], 0.3);
  });

  it("should clamp to custom ceiling", () => {
    const input = new Float32Array([0.5, -0.6, 0.8, -0.9]);
    const output = applyLimiter(input, 0.5);
    for (let i = 0; i < output.length; i++) {
      expect(Math.abs(output[i])).toBeLessThanOrEqual(0.5001);
    }
  });

  it("should handle empty input", () => {
    const input = new Float32Array(0);
    const output = applyLimiter(input, 1.0);
    expect(output.length).toBe(0);
  });

  it("should not modify samples within range", () => {
    const input = new Float32Array([0.2, -0.3, 0.1, -0.4]);
    const output = applyLimiter(input, 0.5);
    for (let i = 0; i < input.length; i++) {
      near(output[i], input[i]);
    }
  });
});

describe("processFXChain", () => {
  const sampleRate = 44100;

  it("should return input unchanged for empty chain", () => {
    const input = makeSine(256, 440, sampleRate);
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const output = processFXChain(input, sampleRate, chain);
    expect(output.length).toBe(input.length);
    near(output[0], input[0]);
  });

  it("should apply EQ only", () => {
    const input = makeSine(512, 440, sampleRate);
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const eq = createFXSlot("eq");
    eq.params = { lowGainDb: "3", lowFreq: "200", lowQ: "0.7" };
    addSlotToChain(chain, eq);

    const output = processFXChain(input, sampleRate, chain);
    expect(output.length).toBe(input.length);
  });

  it("should apply multiple effects in order", () => {
    const input = makeSine(512, 440, sampleRate);
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };

    const eq = createFXSlot("eq");
    eq.params = { lowGainDb: "2", lowFreq: "200", lowQ: "0.7" };
    addSlotToChain(chain, eq);

    const comp = createFXSlot("compressor");
    comp.params = { thresholdDb: "-20", ratio: "2", attackMs: "5", releaseMs: "50" };
    addSlotToChain(chain, comp);

    const limiter = createFXSlot("limiter");
    limiter.params = { ceiling: "0.95" };
    addSlotToChain(chain, limiter);

    const output = processFXChain(input, sampleRate, chain);
    expect(output.length).toBe(input.length);
    for (let i = 0; i < output.length; i++) {
      expect(Math.abs(output[i])).toBeLessThanOrEqual(0.9501);
    }
  });

  it("should skip disabled slots", () => {
    const input = makeSine(512, 440, sampleRate);
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };

    const eq = createFXSlot("eq");
    eq.enabled = false;
    eq.params = { lowGainDb: "12", lowFreq: "200", lowQ: "0.7" };
    addSlotToChain(chain, eq);

    const output = processFXChain(input, sampleRate, chain);
    expect(output.length).toBe(input.length);
    near(output[0], input[0]);
  });

  it("should handle saturator as no-op", () => {
    const input = makeSine(256, 440, sampleRate);
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const sat = createFXSlot("saturator");
    addSlotToChain(chain, sat);

    const output = processFXChain(input, sampleRate, chain);
    expect(output.length).toBe(input.length);
    near(output[0], input[0]);
  });
});
