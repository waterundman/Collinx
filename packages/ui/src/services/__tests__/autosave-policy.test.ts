import { describe, it, expect } from "vitest";
import { autosavePolicy, AUTOSAVE_INTERVAL_MS, MIN_AUTOSAVE_INTERVAL_MS } from "../autosave";

/**
 * v2.9.3：自动保存此前写死 5 分钟，设置页的开关/间隔完全不生效。
 * 这里锁定「设置 → 策略」的单位与边界（单位是秒）。
 */
describe("autosavePolicy", () => {
  it("默认 300 秒 = 5 分钟（与旧的固定间隔一致）", () => {
    const p = autosavePolicy({ enabled: true, interval: 300 });
    expect(p.intervalMs).toBe(AUTOSAVE_INTERVAL_MS);
    expect(p.intervalMs).toBe(5 * 60 * 1000);
  });

  it("设置页的 1 分钟 / 30 分钟分别对应 60s / 1800s", () => {
    expect(autosavePolicy({ enabled: true, interval: 60 }).intervalMs).toBe(60_000);
    expect(autosavePolicy({ enabled: true, interval: 1800 }).intervalMs).toBe(1_800_000);
  });

  it("开关原样传递（false 时调用方不排期）", () => {
    expect(autosavePolicy({ enabled: false, interval: 300 }).enabled).toBe(false);
    expect(autosavePolicy({ enabled: true, interval: 300 }).enabled).toBe(true);
  });

  it("间隔过小被抬到下限，避免写爆 localStorage", () => {
    expect(autosavePolicy({ enabled: true, interval: 1 }).intervalMs).toBe(MIN_AUTOSAVE_INTERVAL_MS);
  });

  it("非法/缺失值回退到默认 5 分钟", () => {
    expect(autosavePolicy({ enabled: true, interval: 0 }).intervalMs).toBe(AUTOSAVE_INTERVAL_MS);
    expect(autosavePolicy({ enabled: true, interval: Number.NaN }).intervalMs).toBe(AUTOSAVE_INTERVAL_MS);
  });
});
