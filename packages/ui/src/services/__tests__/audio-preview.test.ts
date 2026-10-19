import { describe, it, expect } from "vitest";
import { midiToFrequency, velocityToGain } from "../audio-preview";

/**
 * 只测纯函数 —— AudioPreview 类依赖真实 AudioContext，
 * jsdom 里没有，硬测只能测 mock 的行为（没有价值）。
 * 真正"能不能出声"由浏览器端实测把关（见 docs 的验收记录）。
 */
describe("audio-preview 纯函数", () => {
  it("midiToFrequency: A4(69) = 440Hz，八度关系成立", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
    expect(midiToFrequency(81)).toBeCloseTo(880, 5); // 高八度
    expect(midiToFrequency(57)).toBeCloseTo(220, 5); // 低八度
  });

  it("midiToFrequency: 半音比例为 2^(1/12)", () => {
    const ratio = midiToFrequency(70) / midiToFrequency(69);
    expect(ratio).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });

  it("midiToFrequency: 中央 C(60) ≈ 261.63Hz", () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 2);
  });

  it("velocityToGain: 0 力度不发声，1 力度为满值", () => {
    expect(velocityToGain(0)).toBe(0);
    expect(velocityToGain(1)).toBeCloseTo(0.35, 5);
  });

  it("velocityToGain: 平方曲线 —— 半力度只有满值的 1/4（不是 1/2）", () => {
    // 线性映射会让弱奏听起来太响；平方曲线更接近人耳感知
    expect(velocityToGain(0.5)).toBeCloseTo(0.35 * 0.25, 5);
  });

  it("velocityToGain: 越界输入被钳制，不产生 NaN / 负增益", () => {
    expect(velocityToGain(-1)).toBe(0);
    expect(velocityToGain(2)).toBeCloseTo(0.35, 5);
    expect(Number.isNaN(velocityToGain(Number.NaN))).toBe(false);
  });
});
