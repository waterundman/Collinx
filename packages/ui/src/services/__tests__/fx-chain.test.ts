import { describe, it, expect } from "vitest";
import type { FXSlot } from "@collinx/core";
import {
  FX_DEFAULTS,
  createFxChain,
  createImpulseResponse,
  createSaturationCurve,
} from "../fx-chain";
import { createFakeAudioContext } from "../../test-utils/fake-audio-context";

function slot(type: FXSlot["type"], params: Record<string, string> = {}, over: Partial<FXSlot> = {}): FXSlot {
  return { id: `${type}-1`, type, preset: "default", params, enabled: true, ...over };
}

describe("createFxChain —— 空链也要直通", () => {
  it("无 FX 时 input 直连 output", () => {
    const { ctx, connections } = createFakeAudioContext();
    const chain = createFxChain(ctx, []);
    expect(chain.signature).toBe("");
    expect(connections).toContainEqual({ from: "Gain", to: "Gain" });
  });
});

describe("createFxChain —— 6 类 FX 的节点拓扑", () => {
  it("EQ 创建 3 个 biquad（lowshelf / peaking / highshelf）", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("eq")]);
    const filters = nodesOfKind("BiquadFilter");
    expect(filters).toHaveLength(3);
    expect(filters.map((f) => f.type)).toEqual(["lowshelf", "peaking", "highshelf"]);
  });

  it("压缩器用 DynamicsCompressor + makeup 增益", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("compressor")]);
    expect(nodesOfKind("DynamicsCompressor")).toHaveLength(1);
  });

  it("混响用 Convolver，并写入确定性 IR", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("reverb", { mix: "0.4", decay: "0.7" })]);
    const convolver = nodesOfKind("Convolver")[0];
    expect(convolver.buffer).toBeTruthy();
    expect((convolver.buffer as AudioBuffer).numberOfChannels).toBe(2);
  });

  it("延迟用 DelayNode + 反馈支路", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("delay")]);
    expect(nodesOfKind("Delay")).toHaveLength(1);
  });

  it("饱和器用 WaveShaper", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("saturator", { drive: "12" })]);
    const shaper = nodesOfKind("WaveShaper")[0];
    expect(shaper.curve).toBeTruthy();
  });

  it("限幅器用高比例压缩", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("limiter")]);
    const comp = nodesOfKind("DynamicsCompressor")[0];
    expect((comp.ratio as { value: number }).value).toBeCloseTo(20, 5);
  });
});

describe("FX 参数映射 —— 单位换错会让效果听起来没生效", () => {
  it("压缩器 attack/release 从毫秒换到秒", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("compressor", { attack: "10", release: "200" })]);
    const comp = nodesOfKind("DynamicsCompressor")[0];
    expect((comp.attack as { value: number }).value).toBeCloseTo(0.01, 6);
    expect((comp.release as { value: number }).value).toBeCloseTo(0.2, 6);
  });

  it("延迟时间毫秒 → 秒", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("delay", { time: "250" })]);
    const delay = nodesOfKind("Delay")[0];
    expect((delay.delayTime as { value: number }).value).toBeCloseTo(0.25, 6);
  });

  it("延迟反馈钳到 0.95，避免自激", () => {
    const { ctx, nodesOfKind, sourcesInto } = createFakeAudioContext();
    createFxChain(ctx, [slot("delay", { feedback: "1.8" })]);
    // 反馈增益是连进 DelayNode 的 Gain 之一（另一路是 shell input，增益 1）
    const gainsIntoDelay = sourcesInto("Delay")
      .filter((n) => n.kind === "Gain")
      .map((n) => (n.gain as { value: number }).value);
    expect(gainsIntoDelay).toContain(0.95);
    expect(gainsIntoDelay).not.toContain(1.8);
  });

  it("EQ 兼容 UI 键（lowGain）与 core 旧键（lowGainDb）", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("eq", { lowGain: "-12" })]);
    expect(nodesOfKind("BiquadFilter")[0].gain).toBeTruthy();
    expect((nodesOfKind("BiquadFilter")[0].gain as { value: number }).value).toBeCloseTo(-12, 5);
  });

  it("缺省参数使用 FX_DEFAULTS", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    createFxChain(ctx, [slot("eq")]);
    expect((nodesOfKind("BiquadFilter")[0].frequency as { value: number }).value).toBeCloseTo(
      FX_DEFAULTS.eq.lowFreq,
      5,
    );
  });
});

describe("旁通与重建", () => {
  it("disabled 的槽：旁通增益拉满、处理支路静音", () => {
    const { ctx, nodes } = createFakeAudioContext();
    createFxChain(ctx, [slot("eq", {}, { enabled: false })]);
    const gains = nodes.filter((n) => n.kind === "Gain").map((n) => (n.gain as { value: number }).value);
    // 三个 shell 节点（input/output/bypass）+ chain 的 input/output 共 5 个为 1，wet 为 0
    expect(gains.filter((v) => v === 0)).toHaveLength(1);
    expect(gains.filter((v) => v === 1)).toHaveLength(5);
  });

  it("只改参数不重建节点", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    const chain = createFxChain(ctx, [slot("eq")]);
    const before = nodesOfKind("BiquadFilter").length;
    chain.update([slot("eq", { lowGain: "-6" })]);
    expect(nodesOfKind("BiquadFilter").length).toBe(before);
    expect(chain.signature).toBe("eq-1:eq:1");
  });

  it("结构变化（加槽）会重建并把新节点接上", () => {
    const { ctx, nodesOfKind } = createFakeAudioContext();
    const chain = createFxChain(ctx, [slot("eq")]);
    chain.update([slot("eq"), slot("delay")]);
    expect(nodesOfKind("Delay")).toHaveLength(1);
    expect(chain.signature).toBe("eq-1:eq:1|delay-1:delay:1");
  });

  it("空链加槽时必须先断开直通支路（否则信号并联叠加 +6dB）", () => {
    const { ctx, detailedConnections } = createFakeAudioContext();
    const chain = createFxChain(ctx, []);
    chain.update([slot("eq")]);

    const fromInput = detailedConnections.filter(
      (c) => c.fromNode === (chain.input as unknown),
    );
    expect(fromInput).toHaveLength(1);
    // 唯一出口是处理链接头，而不是 output（直通残留会让干湿两路相加）
    expect(fromInput[0].toNode === (chain.output as unknown)).toBe(false);
  });

  it("切旁通（enabled 翻转）也会重建 —— 签名把它算作结构", () => {
    const { ctx } = createFakeAudioContext();
    const chain = createFxChain(ctx, [slot("eq")]);
    chain.update([slot("eq", {}, { enabled: false })]);
    expect(chain.signature).toBe("eq-1:eq:0");
  });
});

describe("确定性生成（导出必须是同一份声音）", () => {
  it("同 decay 的 IR 逐样本相同", () => {
    const a = createFakeAudioContext();
    const b = createFakeAudioContext();
    const irA = createImpulseResponse(a.ctx, 0.6, 44100);
    const irB = createImpulseResponse(b.ctx, 0.6, 44100);
    expect(Array.from(irA.getChannelData(0).slice(0, 64))).toEqual(
      Array.from(irB.getChannelData(0).slice(0, 64)),
    );
  });

  it("不同 decay 的 IR 不同；左右声道去相关", () => {
    const { ctx } = createFakeAudioContext();
    const a = createImpulseResponse(ctx, 0.2, 44100);
    const b = createImpulseResponse(ctx, 0.9, 44100);
    expect(a.length).toBeLessThan(b.length);
    expect(Array.from(a.getChannelData(0).slice(0, 8))).not.toEqual(
      Array.from(a.getChannelData(1).slice(0, 8)),
    );
  });

  it("饱和曲线以 0 为中心、满幅归一", () => {
    const curve = createSaturationCurve(12);
    expect(curve.length).toBe(1025);
    expect(curve[512]).toBeCloseTo(0, 6);
    expect(curve[1024]).toBeCloseTo(1, 5);
    expect(curve[0]).toBeCloseTo(-1, 5);
  });
});
