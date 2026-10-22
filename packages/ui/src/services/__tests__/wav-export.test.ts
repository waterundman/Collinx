import { describe, it, expect } from "vitest";
import { encodeWav, parseWavHeader, WAV_HEADER_BYTES } from "../wav-export";

/**
 * WAV 编码器单测。
 *
 * 之所以重点测这三类，是因为它们对应音频导出的经典翻车点：
 * 1. 头字段写错 → 播放器直接不认（文件"能下载但打不开"）
 * 2. 采样超出 ±1 未钳制 → Int16 回绕成刺耳爆音
 * 3. 满幅 +1 用 0x8000 缩放 → 溢出成 -32768，满幅信号突然反相
 */
describe("encodeWav", () => {
  it("T01: 文件头是合法的 RIFF/WAVE (critical)", () => {
    const wav = encodeWav(new Float32Array(4), { sampleRate: 44100, channels: 2 });
    const h = parseWavHeader(wav);

    expect(h.riff).toBe("RIFF");
    expect(h.wave).toBe("WAVE");
    expect(h.channels).toBe(2);
    expect(h.sampleRate).toBe(44100);
    expect(h.bitsPerSample).toBe(16);
  });

  it("T02: 长度 = 头 + 帧数 × 声道 × 2 字节", () => {
    const frames = 100;
    const wav = encodeWav(new Float32Array(frames * 2), { channels: 2 });
    const h = parseWavHeader(wav);
    expect(h.totalBytes).toBe(WAV_HEADER_BYTES + frames * 2 * 2);
    expect(h.dataBytes).toBe(frames * 2 * 2);
  });

  it("T03: 采样值正确往返（±0.5 → ±16383 附近）", () => {
    const wav = encodeWav(new Float32Array([0.5, -0.5]), { channels: 2 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(Math.round(-0.5 * 0x8000));
  });

  it("T04: 超出 ±1 的采样经归一化后不产生回绕爆音（v2.8.0 改为峰值归一）", () => {
    // 总线叠加后出现 +3 / -2 很常见。**v2.8.0 起不再硬钳制**：
    // 整段先缩放到 -1 dBFS（0.891），保留动态且不产生失真 ——
    // 「不产生回绕爆音」这个用户可见的保证更强了，而不是被削弱。
    const wav = encodeWav(new Float32Array([3, -2]), { channels: 2 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const hi = view.getInt16(WAV_HEADER_BYTES, true);
    const lo = view.getInt16(WAV_HEADER_BYTES + 2, true);

    // 关键不变量：绝不回绕（+3 不能变成负数，-2 不能变成正数）
    expect(hi).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0);
    // 峰值被规整到 -1 dBFS 附近（0.891 × 0x7fff ≈ 28543）
    expect(hi).toBeCloseTo(Math.round(0.891 * 0x7fff), -2);
    // 正负比例保持（3 : 2）
    expect(Math.abs(hi / lo)).toBeCloseTo(1.5, 1);
  });

  it("T05: 满幅 +1 归一化到 -1 dBFS 且不会溢出成负数", () => {
    // 满幅也要降到 0.891 留 headroom：导出后整体不过载，
    // 用户再拿去加效果或转码时不会立刻爆
    const wav = encodeWav(new Float32Array([1, 0]), { channels: 2 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const v = view.getInt16(WAV_HEADER_BYTES, true);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeCloseTo(Math.round(0.891 * 0x7fff), -2);
  });

  it("T05b: 安静的作品不会被硬拉响（peak < 0.891 时不放大）", () => {
    const wav = encodeWav(new Float32Array([0.2, -0.1]), { channels: 2 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    // 0.2 原样缩放，不乘 4.45 拉满
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(Math.round(0.2 * 0x7fff));
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(Math.round(-0.1 * 0x8000));
  });

  it("T06: 采样数不是声道整数倍时报错，而不是写出坏文件", () => {
    expect(() => encodeWav(new Float32Array([0, 0, 0]), { channels: 2 })).toThrow(/整数倍/);
  });

  it("T07: 单声道也支持", () => {
    const wav = encodeWav(new Float32Array([0.1, 0.2, 0.3]), { channels: 1 });
    const h = parseWavHeader(wav);
    expect(h.channels).toBe(1);
    expect(h.dataBytes).toBe(3 * 2);
  });
});
