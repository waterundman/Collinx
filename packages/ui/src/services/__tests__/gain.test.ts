import { describe, it, expect } from "vitest";
import { dbToLinear, linearToDb, GAIN_DB_MIN, GAIN_DB_MAX } from "../gain";

/**
 * 分贝换算单测。
 *
 * 这里守的是**一个很容易写错且不会报错**的公式：
 * 振幅换算用 10^(dB/20)，混成 10^(dB/10)（功率公式）会让 -6dB 变成 0.25，
 * 听感上像 -12dB —— 推子推了但音量变化不对，只能靠耳朵发现。
 */
describe("dbToLinear", () => {
  it("T01: 0 dB = 1.0（不增不减）", () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 6);
  });

  it("T02: -6 dB ≈ 0.501 —— 用振幅公式而非功率公式 (critical)", () => {
    // 功率公式 10^(-6/10) = 0.251 是错的；振幅公式 10^(-6/20) = 0.5012
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 5);
    expect(dbToLinear(-6)).toBeGreaterThan(0.4);
  });

  it("T03: +6 dB ≈ 1.995", () => {
    expect(dbToLinear(6)).toBeCloseTo(1.99526, 4);
  });

  it("T04: 12 dB 是两倍多一点（12dB ≈ ×3.98）", () => {
    expect(dbToLinear(12)).toBeCloseTo(3.98107, 4);
  });

  it("T05: 拉到下限是**真静音**（0），不是 0.001", () => {
    // 0.001 在推子最低时仍能听见一丝声音，不符合直觉
    expect(dbToLinear(GAIN_DB_MIN)).toBe(0);
    expect(dbToLinear(-80)).toBe(0);
  });

  it("T06: 超过上限被钳制，不产生无穷大增益", () => {
    expect(dbToLinear(100)).toBe(dbToLinear(GAIN_DB_MAX));
    expect(Number.isFinite(dbToLinear(100))).toBe(true);
  });

  it("T07: NaN / Infinity 不产生 NaN 增益", () => {
    // NaN 会一路污染 GainNode.gain，表现为静默无声且不报错
    expect(dbToLinear(Number.NaN)).toBe(0);
    expect(dbToLinear(Number.POSITIVE_INFINITY)).toBe(0);
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("T08: 单调递增 —— 推子往上推，增益必须变大", () => {
    const series = [-40, -24, -12, -6, 0, 6, 12].map(dbToLinear);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThan(series[i - 1]);
    }
  });
});

describe("linearToDb", () => {
  it("T09: 与 dbToLinear 互为逆运算", () => {
    for (const db of [-30, -12, -6, 0, 6]) {
      expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 5);
    }
  });

  it("T10: 0 / 负数 / NaN 落到下限", () => {
    expect(linearToDb(0)).toBe(GAIN_DB_MIN);
    expect(linearToDb(-1)).toBe(GAIN_DB_MIN);
    expect(linearToDb(Number.NaN)).toBe(GAIN_DB_MIN);
  });
});
