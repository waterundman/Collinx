import { describe, it, expect } from "vitest";
import type { FXSlot, MixerState, MixerTrack } from "@collinx/core";
import {
  DEFAULT_BUS_KEY,
  MixerGraph,
  masterGainDb,
} from "../mixer-graph";
import { applyMixerToAudio, type MixerAudioTarget } from "../mix-resolver";
import { createFakeAudioContext } from "../../test-utils/fake-audio-context";

function track(over: Partial<MixerTrack> = {}): MixerTrack {
  return {
    id: "mix-1",
    name: "Melody",
    sourceTrackId: "melody",
    busType: "group",
    gainDb: "0",
    pan: "0",
    mute: false,
    solo: false,
    fxChain: { id: "fx-1", name: "FX", slots: [] },
    sends: [],
    meterLevel: "0",
    ...over,
  };
}

function mixer(tracks: MixerTrack[], masterOver: Partial<MixerTrack> = {}): MixerState {
  return {
    tracks,
    masterTrack: track({ id: "master", sourceTrackId: "master", busType: "master", ...masterOver }),
    routingMatrix: {},
  };
}

function slot(over: Partial<FXSlot> = {}): FXSlot {
  return { id: "eq-1", type: "eq", preset: "default", params: {}, enabled: true, ...over };
}

function build(mixerState?: MixerState, withAnalysers = true) {
  const fake = createFakeAudioContext();
  const graph = new MixerGraph(fake.ctx, fake.ctx.destination, { withAnalysers });
  if (mixerState) graph.apply(mixerState);
  return { ...fake, graph };
}

describe("MixerGraph —— 单轨拓扑", () => {
  it("每条总线都有 sum / fader / panner（缺一即说明接线不完整）", () => {
    const { graph } = build();
    const bus = graph.bus("melody");
    const kindOf = (node: unknown) => (node as { kind?: string }).kind;
    expect(kindOf(bus.sum)).toBe("Gain");
    expect(kindOf(bus.fader)).toBe("Gain");
    expect(kindOf(bus.panner)).toBe("StereoPanner");
  });

  it("播放链路带电平分析，导出链路不带（同一份图，仅差 analyser）", () => {
    const playback = build(undefined, true);
    const exported = build(undefined, false);
    expect(playback.graph.bus("melody").analyser).not.toBeNull();
    expect(exported.graph.bus("melody").analyser).toBeNull();
    // 除了 analyser，两条链的结构签名必须一致
    playback.graph.apply(mixer([track({ gainDb: "-6", pan: "0.3" })]));
    exported.graph.apply(mixer([track({ gainDb: "-6", pan: "0.3" })]));
    expect(playback.graph.signature()).toBe(exported.graph.signature());
  });

  it("未知轨也会拿到独立总线（不许掉进默认总线被别人控制）", () => {
    const { graph } = build(mixer([track()]));
    const stray = graph.bus("violin");
    expect(stray).not.toBe(graph.bus("melody"));
    expect(stray.fader.gain.value).toBe(1);
  });
});

describe("MixerGraph.apply —— 静音/独奏/声像/FX 真的落到节点上", () => {
  it("推子 dB 落到 fader 增益（-6dB ≈ 0.501）", () => {
    const { graph } = build(mixer([track({ gainDb: "-6" })]));
    expect(graph.bus("melody").fader.gain.value).toBeCloseTo(0.501, 3);
  });

  it("静音 → fader = 0（不是 1，也不是 -Infinity 原样）", () => {
    const { graph } = build(mixer([track({ gainDb: "0", mute: true })]));
    expect(graph.bus("melody").fader.gain.value).toBe(0);
  });

  it("独奏：solo 轨保留原增益，其余轨归零", () => {
    const { graph } = build(
      mixer([
        track({ solo: true, gainDb: "-3" }),
        track({ id: "b", sourceTrackId: "bass", gainDb: "0" }),
      ]),
    );
    expect(graph.bus("melody").fader.gain.value).toBeCloseTo(0.708, 3);
    expect(graph.bus("bass").fader.gain.value).toBe(0);
  });

  it("声像落到 StereoPanner.pan", () => {
    const { graph } = build(mixer([track({ pan: "-1" })]));
    expect(graph.bus("melody").panner?.pan.value).toBeCloseTo(-1, 6);
  });

  it("FX 链结构进入总线（此前音频路径完全不读 FX）", () => {
    const { graph, nodesOfKind } = build(
      mixer([track({ fxChain: { id: "fx", name: "FX", slots: [slot()] } })]),
    );
    expect(graph.bus("melody").fx.signature).toBe("eq-1:eq:1");
    expect(nodesOfKind("BiquadFilter")).toHaveLength(3);
  });

  it("只改 FX 参数不重建节点", () => {
    const state = mixer([track({ fxChain: { id: "fx", name: "FX", slots: [slot()] } })]);
    const { graph, nodesOfKind } = build(state);
    const before = nodesOfKind("BiquadFilter").length;
    graph.apply(
      mixer([track({ fxChain: { id: "fx", name: "FX", slots: [slot({ params: { lowGain: "-9" } })] } })]),
    );
    expect(nodesOfKind("BiquadFilter").length).toBe(before);
  });

  it("master 推子单独由 masterGainDb 解析（NaN 回 0，-Infinity 保留）", () => {
    expect(masterGainDb(mixer([], { gainDb: "-Infinity" }))).toBe(-Infinity);
    expect(masterGainDb(mixer([], { gainDb: "abc" }))).toBe(0);
  });
});

describe("结构签名 —— 导出与播放同构的证据", () => {
  it("同一混音状态 → 签名相同", () => {
    const state = mixer([track({ gainDb: "-6", pan: "0.5" })]);
    expect(build(state).graph.signature()).toBe(build(state).graph.signature());
  });

  it("静音状态不同 → 签名不同（静音必须进链，而不是只改 UI）", () => {
    const loud = mixer([track()]);
    const muted = mixer([track({ mute: true })]);
    expect(build(loud).graph.signature()).not.toBe(build(muted).graph.signature());
  });
});

describe("applyMixerToAudio —— App 的唯一入口", () => {
  function recorder() {
    const calls: { method: string; key: string; value: unknown }[] = [];
    const target: MixerAudioTarget = {
      setTrackGain: (key, db) => calls.push({ method: "gain", key, value: db }),
      setTrackPan: (key, pan) => calls.push({ method: "pan", key, value: pan }),
      setTrackFx: (key, slots) => calls.push({ method: "fx", key, value: slots }),
      setMasterGain: (db) => calls.push({ method: "master", key: "", value: db }),
    };
    return { calls, target };
  }

  it("按 sourceTrackId 推总线键（不是混音条 uuid）", () => {
    const { calls, target } = recorder();
    applyMixerToAudio(mixer([track()]), target);
    expect(calls.filter((c) => c.method === "gain")[0]).toMatchObject({ key: "melody" });
  });

  it("静音推 -Infinity（交给 dbToLinear 变 0）", () => {
    const { calls, target } = recorder();
    applyMixerToAudio(mixer([track({ mute: true })]), target);
    expect(calls.find((c) => c.method === "gain")?.value).toBe(-Infinity);
  });

  it("独奏时非 solo 轨推到 -Infinity", () => {
    const { calls, target } = recorder();
    applyMixerToAudio(
      mixer([track({ solo: true }), track({ id: "b", sourceTrackId: "bass", gainDb: "-6" })]),
      target,
    );
    const bass = calls.find((c) => c.method === "gain" && c.key === "bass");
    expect(bass?.value).toBe(-Infinity);
  });

  it("声像与 FX 都推给音频（缺一条就是装饰）", () => {
    const { calls, target } = recorder();
    applyMixerToAudio(
      mixer([track({ pan: "0.25", fxChain: { id: "fx", name: "FX", slots: [slot()] } })]),
      target,
    );
    expect(calls.find((c) => c.method === "pan")?.value).toBeCloseTo(0.25, 6);
    expect((calls.find((c) => c.method === "fx")?.value as FXSlot[])).toHaveLength(1);
  });

  it("master 推子也同步", () => {
    const { calls, target } = recorder();
    applyMixerToAudio(mixer([track()], { gainDb: "-9" }), target);
    expect(calls.find((c) => c.method === "master")?.value).toBe(-9);
  });
});

describe("默认总线与释放", () => {
  it("缺 trackId 的音符落到 __default__", () => {
    const { graph } = build();
    expect(graph.bus(DEFAULT_BUS_KEY).key).toBe(DEFAULT_BUS_KEY);
  });

  it("removeBus 后该轨电平归零，再次调用会重建", () => {
    const { graph } = build(mixer([track()]));
    graph.removeBus("melody");
    expect(graph.getLevel("melody")).toBe(0);
    expect(graph.bus("melody").fader.gain.value).toBe(1);
  });
});

// ── v2.9.1：送出发送（Sends）真的接到音频 ─────────────────────────────────
describe("MixerGraph.setSends —— 送出", () => {
  const withSend = (over: Partial<MixerTrack> = {}) =>
    mixer([
      track({
        sends: [{ targetBusId: "reverb", level: "0.5", preFader: false }],
        ...over,
      }),
    ]);

  it("创建送增益，推子后接目标总线", () => {
    const { graph, detailedConnections } = build(withSend());
    const bus = graph.bus("melody");
    const send = bus.sends.get("reverb");
    expect(send).toBeTruthy();
    expect(send!.gain.gain.value).toBeCloseTo(0.5, 6);

    const fromFader = detailedConnections.filter(
      (c) => c.fromNode === (bus.fader as unknown),
    );
    expect(fromFader.some((c) => c.toNode === (send!.gain as unknown))).toBe(true);
    expect(
      detailedConnections.some(
        (c) => c.fromNode === (send!.gain as unknown) && c.toNode === (graph.bus("reverb").sum as unknown),
      ),
    ).toBe(true);
  });

  it("重复 apply 不会重复接线（并联会让送出翻倍）", () => {
    const state = withSend();
    const { graph, detailedConnections } = build(state);
    const bus = graph.bus("melody");
    const send = bus.sends.get("reverb")!;

    graph.apply(state);
    graph.apply(state);

    const links = detailedConnections.filter(
      (c) => c.fromNode === (bus.fader as unknown) && c.toNode === (send.gain as unknown),
    );
    expect(links).toHaveLength(1);
  });

  it("移除送出后节点与连接都清掉", () => {
    const { graph } = build(withSend());
    const bus = graph.bus("melody");
    expect(bus.sends.size).toBe(1);

    graph.apply(mixer([track()]));
    expect(bus.sends.size).toBe(0);
  });

  it("preFader 从 sum 取信号（静音不切断送出）", () => {
    const { graph, detailedConnections } = build(
      mixer([
        track({ sends: [{ targetBusId: "reverb", level: "1", preFader: true }] }),
      ]),
    );
    const bus = graph.bus("melody");
    const send = bus.sends.get("reverb")!;
    expect(
      detailedConnections.some(
        (c) => c.fromNode === (bus.sum as unknown) && c.toNode === (send.gain as unknown),
      ),
    ).toBe(true);
  });

  it("自送与 A↔B 环路被丢弃", () => {
    const { graph } = build(
      mixer([
        track({ sends: [{ targetBusId: "melody", level: "1", preFader: false }] }),
        track({
          id: "b",
          sourceTrackId: "bass",
          sends: [{ targetBusId: "melody", level: "1", preFader: false }],
        }),
      ]),
    );
    expect(graph.bus("melody").sends.size).toBe(0);
    expect(graph.bus("bass").sends.size).toBe(1);

    // 反向再设：melody → bass 应被拒绝（bass → melody 已存在）
    graph.apply(
      mixer([
        track({ sends: [{ targetBusId: "bass", level: "1", preFader: false }] }),
        track({
          id: "b",
          sourceTrackId: "bass",
          sends: [{ targetBusId: "melody", level: "1", preFader: false }],
        }),
      ]),
    );
    expect(graph.bus("melody").sends.size).toBe(0);
  });

  it("结构签名包含送出（导出/播放同构的证据）", () => {
    const { graph } = build(withSend());
    expect(graph.signature()).toContain("reverb=0.5");
  });
});
