import { describe, it, expect } from "vitest";
import { encodeWav } from "../wav-export";

/**
 * v2.9.4：峰值归一化可以关（设置 mixer.loudnessNormalization）。
 *
 * 旧行为：encodeWav 永远把峰值压到 -1dBFS —— 设置页的开关是摆设。
 * 关掉后只做硬钳制，保持原始动态（A/B 对比时需要）。
 */
function decodeMaxAbsSample(wav: Uint8Array): number {
  // 44 字节头，之后是 Int16 交织采样
  let max = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const v = wav[i]! | (wav[i + 1]! << 8);
    const signed = v >= 0x8000 ? v - 0x10000 : v;
    max = Math.max(max, Math.abs(signed));
  }
  return max / 32767;
}

function tone(peak: number, n = 256): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((i / n) * Math.PI * 2) * peak;
  return out;
}

describe("encodeWav normalize 开关", () => {
  it("默认（true）：0.95 峰值被压到 ≈0.891", () => {
    const wav = encodeWav(tone(0.95), { sampleRate: 44100, channels: 1 });
    const max = decodeMaxAbsSample(wav);
    expect(max).toBeGreaterThan(0.85);
    expect(max).toBeLessThanOrEqual(0.9);
  });

  it("normalize:false：保持原峰值（仅硬钳制）", () => {
    const wav = encodeWav(tone(0.95), { sampleRate: 44100, channels: 1, normalize: false });
    const max = decodeMaxAbsSample(wav);
    expect(max).toBeGreaterThan(0.93);
    expect(max).toBeLessThanOrEqual(1);
  });

  it("峰值低于目标时两种模式都不抬升", () => {
    const quiet = tone(0.3);
    const on = decodeMaxAbsSample(encodeWav(quiet, { sampleRate: 44100, channels: 1 }));
    const off = decodeMaxAbsSample(
      encodeWav(quiet, { sampleRate: 44100, channels: 1, normalize: false }),
    );
    expect(on).toBeCloseTo(0.3, 1);
    expect(off).toBeCloseTo(0.3, 1);
  });
});
