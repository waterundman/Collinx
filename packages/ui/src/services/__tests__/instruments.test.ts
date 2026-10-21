import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  DEFAULT_INSTRUMENT,
  getInstrument,
  instrumentForTrack,
  notePeakGain,
} from "../instruments";

/**
 * 音色表单测。
 *
 * 重点不是"表里有几条"，而是这三点：
 * 1. 映射正确 —— 轨道名要落到对的音色
 * 2. 兜底安全 —— 未知轨道不能静音（否则用户以为坏了）
 * 3. **层次是真的** —— 五种音色的包络/波形/电平必须确实不同，
 *    否则"分音色"只是换了个名字，叠在一起还是同一种声音
 */
describe("instrumentForTrack 映射", () => {
  it("T01: 三条默认轨道各自落到不同音色 (critical)", () => {
    expect(instrumentForTrack("melody")).toBe("lead");
    expect(instrumentForTrack("bass")).toBe("bass");
    expect(instrumentForTrack("chords")).toBe("pad");
  });

  it("T02: 别名也能识别（大小写 / 同义名）", () => {
    expect(instrumentForTrack("Melody")).toBe("lead");
    expect(instrumentForTrack("LEAD")).toBe("lead");
    expect(instrumentForTrack("harmony")).toBe("pad");
    expect(instrumentForTrack("arp")).toBe("pluck");
    expect(instrumentForTrack("piano")).toBe("keys");
  });

  it("T03: 未知 / 空轨道兜底到 lead，绝不返回空", () => {
    expect(instrumentForTrack(undefined)).toBe(DEFAULT_INSTRUMENT);
    expect(instrumentForTrack("")).toBe(DEFAULT_INSTRUMENT);
    expect(instrumentForTrack("trumpet-1")).toBe(DEFAULT_INSTRUMENT);
  });
});

describe("音色 spec", () => {
  it("T04: 五种音色都存在且结构完整", () => {
    for (const id of ["lead", "bass", "pad", "keys", "pluck"]) {
      const spec = INSTRUMENTS[id];
      expect(spec, `${id} 应存在`).toBeTruthy();
      expect(spec.oscillators.length, `${id} 至少要有一个振荡器`).toBeGreaterThan(0);
      expect(spec.attack).toBeGreaterThan(0);
      expect(spec.release).toBeGreaterThan(0);
      expect(spec.sustain).toBeGreaterThan(0);
      expect(spec.sustain).toBeLessThanOrEqual(1);
      expect(spec.level).toBeGreaterThan(0);
    }
  });

  it("T05: 包络确实不同 —— pad 慢起、pluck 快衰减", () => {
    // 若这些值都相同，"分层"就只是换名字
    expect(INSTRUMENTS.pad.attack).toBeGreaterThan(INSTRUMENTS.pluck.attack * 50);
    expect(INSTRUMENTS.pad.release).toBeGreaterThan(INSTRUMENTS.pluck.release * 2);
    expect(INSTRUMENTS.pluck.sustain).toBeLessThan(INSTRUMENTS.pad.sustain);
  });

  it("T06: 波形组成不同 —— bass 用正弦打底，lead 用锯齿", () => {
    const bassTypes = INSTRUMENTS.bass.oscillators.map((o) => o.type);
    const leadTypes = INSTRUMENTS.lead.oscillators.map((o) => o.type);
    expect(bassTypes).toContain("sine");
    expect(leadTypes).toContain("sawtooth");
    expect(bassTypes).not.toEqual(leadTypes);
  });

  it("T07: 电平不同 —— 避免 pad 盖过 lead", () => {
    const levels = Object.values(INSTRUMENTS).map((s) => s.level);
    expect(new Set(levels).size).toBeGreaterThan(1);
    expect(INSTRUMENTS.pad.level).toBeLessThan(INSTRUMENTS.lead.level);
  });

  it("T08: getInstrument 对未知 id 兜底而非返回 undefined", () => {
    expect(getInstrument("不存在的音色")).toBe(INSTRUMENTS[DEFAULT_INSTRUMENT]);
    expect(getInstrument(undefined)).toBe(INSTRUMENTS[DEFAULT_INSTRUMENT]);
  });
});

describe("notePeakGain", () => {
  it("T09: 平方力度曲线 × 音色 level", () => {
    const lead = INSTRUMENTS.lead;
    expect(notePeakGain(1, lead)).toBeCloseTo(lead.level, 5);
    expect(notePeakGain(0.5, lead)).toBeCloseTo(lead.level * 0.25, 5);
  });

  it("T10: NaN / 越界不产生 NaN，也不产生超过音色电平的增益", () => {
    const lead = INSTRUMENTS.lead;
    // NaN 必须落回下限而不是 NaN —— NaN 会一路污染 GainNode.gain，
    // 表现为"静默无声且不报错"
    const nanGain = notePeakGain(Number.NaN, lead);
    expect(Number.isNaN(nanGain)).toBe(false);
    expect(nanGain).toBeLessThanOrEqual(lead.level);

    expect(notePeakGain(-1, lead)).toBeLessThanOrEqual(lead.level);
    expect(notePeakGain(-1, lead)).toBeGreaterThanOrEqual(0);
    expect(notePeakGain(2, lead)).toBeCloseTo(lead.level, 5);
  });

  it("T11: 即使力度为 0 也返回正的下限，避免 exponentialRamp 的目标为 0 抛错", () => {
    // Web Audio 的 exponentialRampToValueAtTime 不接受 0 作为目标值
    expect(notePeakGain(0, INSTRUMENTS.lead)).toBeGreaterThan(0);
  });
});
