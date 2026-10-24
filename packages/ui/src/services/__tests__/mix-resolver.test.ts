import { describe, it, expect } from "vitest";
import type { FXSlot, MixerState, MixerTrack } from "@collinx/core";
import {
  activeFxSlots,
  busKeyOf,
  effectiveGainDb,
  effectiveMute,
  fxParam,
  fxSignature,
  hasAnySolo,
  panGains,
  parseGainDb,
  parsePan,
  resolveBusKey,
  trackByBusKey,
} from "../mix-resolver";

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
    masterTrack: track({ id: "master", name: "Master", sourceTrackId: "master", busType: "master", ...masterOver }),
    routingMatrix: {},
  };
}

function slot(over: Partial<FXSlot> = {}): FXSlot {
  return { id: "s1", type: "eq", preset: "default", params: {}, enabled: true, ...over };
}

describe("parseGainDb —— -Infinity 是合法语义，不是无效值", () => {
  it("推子拉到底的字符串 '-Infinity' 原样保留", () => {
    // 若这里回退成 0（isFinite 的写法），拉到最低反而变成不衰减——
    // v2.8.0 实测过这个 bug（电平 55% → 0% 的修复就靠这一条）
    expect(parseGainDb("-Infinity")).toBe(-Infinity);
  });

  it("数字形式的 -Infinity 也保留", () => {
    expect(parseGainDb(-Infinity)).toBe(-Infinity);
  });

  it("非法字符串与 NaN 回退 0 dB", () => {
    expect(parseGainDb("abc")).toBe(0);
    expect(parseGainDb("")).toBe(0);
    expect(parseGainDb(undefined)).toBe(0);
    expect(parseGainDb(Number.NaN)).toBe(0);
  });

  it("正常 dB 原样解析（含负值）", () => {
    expect(parseGainDb("-6.5")).toBeCloseTo(-6.5, 6);
    expect(parseGainDb("3")).toBe(3);
  });
});

describe("parsePan", () => {
  it("钳制到 [-1, 1]", () => {
    expect(parsePan("2")).toBe(1);
    expect(parsePan("-9")).toBe(-1);
  });
  it("非法值居中", () => {
    expect(parsePan("abc")).toBe(0);
    expect(parsePan(Number.NaN)).toBe(0);
    expect(parsePan(Infinity)).toBe(0);
  });
});

describe("独奏语义（solo 是并集，mute 优先）", () => {
  it("无 solo 时只看 mute", () => {
    const m = mixer([track(), track({ id: "b", sourceTrackId: "bass", mute: true })]);
    expect(hasAnySolo(m)).toBe(false);
    expect(effectiveMute(m.tracks[0], false)).toBe(false);
    expect(effectiveMute(m.tracks[1], false)).toBe(true);
  });

  it("任一 solo → 非 solo 轨全部静音", () => {
    const m = mixer([track({ solo: true }), track({ id: "b", sourceTrackId: "bass" })]);
    const anySolo = hasAnySolo(m);
    expect(anySolo).toBe(true);
    expect(effectiveMute(m.tracks[0], anySolo)).toBe(false);
    expect(effectiveMute(m.tracks[1], anySolo)).toBe(true);
  });

  it("多轨 solo 是并集（两条都能听见）", () => {
    const m = mixer([
      track({ solo: true }),
      track({ id: "b", sourceTrackId: "bass", solo: true }),
      track({ id: "c", sourceTrackId: "chords" }),
    ]);
    const anySolo = hasAnySolo(m);
    expect(effectiveMute(m.tracks[0], anySolo)).toBe(false);
    expect(effectiveMute(m.tracks[1], anySolo)).toBe(false);
    expect(effectiveMute(m.tracks[2], anySolo)).toBe(true);
  });

  it("既 mute 又 solo → 仍然静音（mute 优先）", () => {
    const m = mixer([track({ solo: true, mute: true }), track({ id: "b", sourceTrackId: "bass" })]);
    const anySolo = hasAnySolo(m);
    expect(effectiveMute(m.tracks[0], anySolo)).toBe(true);
  });

  it("master 不参与独奏判定（master.solo 不会让所有轨静音）", () => {
    const m = mixer([track()], { solo: true });
    expect(hasAnySolo(m)).toBe(false);
    expect(effectiveMute(m.tracks[0], hasAnySolo(m))).toBe(false);
  });

  it("静音轨的最终增益是 -Infinity，而不是 0 dB", () => {
    const m = mixer([track({ mute: true })]);
    expect(effectiveGainDb(m.tracks[0], false)).toBe(-Infinity);
  });

  it("正常轨返回自身 dB（-Infinity 推子仍保留）", () => {
    const m = mixer([track({ gainDb: "-Infinity" })]);
    expect(effectiveGainDb(m.tracks[0], false)).toBe(-Infinity);
  });
});

describe("panGains —— 等功率曲线", () => {
  it("居中：两侧各 √2/2，总功率 1", () => {
    const { left, right } = panGains(0);
    expect(left).toBeCloseTo(Math.SQRT1_2, 6);
    expect(right).toBeCloseTo(Math.SQRT1_2, 6);
    expect(left * left + right * right).toBeCloseTo(1, 6);
  });

  it("全左：L=1、R≈0", () => {
    const { left, right } = panGains(-1);
    expect(left).toBeCloseTo(1, 6);
    expect(right).toBeCloseTo(0, 6);
  });

  it("全右：R=1、L≈0", () => {
    const { left, right } = panGains(1);
    expect(left).toBeCloseTo(0, 6);
    expect(right).toBeCloseTo(1, 6);
  });

  it("任意位置都满足 L²+R²=1（等功率，不是线性衰减）", () => {
    for (const p of [-0.9, -0.5, -0.1, 0, 0.25, 0.7, 0.95]) {
      const { left, right } = panGains(p);
      expect(left * left + right * right).toBeCloseTo(1, 6);
    }
  });

  it("越界与 NaN 被夹到合法范围（居中）", () => {
    expect(panGains(Number.NaN)).toEqual(panGains(0));
    expect(panGains(5)).toEqual(panGains(1));
  });
});

describe("总线键解析", () => {
  it("busKeyOf 优先 sourceTrackId（音符的 trackId 与它是同一套标识）", () => {
    expect(busKeyOf(track())).toBe("melody");
  });

  it("sourceTrackId 为空时退回混音条 id", () => {
    expect(busKeyOf(track({ sourceTrackId: "" }))).toBe("mix-1");
  });

  it("resolveBusKey：按 sourceTrackId 命中", () => {
    expect(resolveBusKey("melody", mixer([track()]))).toBe("melody");
  });

  it("resolveBusKey：按混音条 id 命中（旧数据可能直接写条 id）", () => {
    expect(resolveBusKey("mix-1", mixer([track()]))).toBe("melody");
  });

  it("resolveBusKey：未知轨原样返回（不许掉进默认总线）", () => {
    expect(resolveBusKey("violin", mixer([track()]))).toBe("violin");
    expect(resolveBusKey(undefined, mixer([track()]))).toBe("");
  });

  it("trackByBusKey 能反查", () => {
    const m = mixer([track()]);
    expect(trackByBusKey(m, "melody")?.id).toBe("mix-1");
    expect(trackByBusKey(m, "nope")).toBeUndefined();
  });
});

describe("FX 结构签名与参数解析", () => {
  it("签名包含 id/类型/顺序/开关", () => {
    const a = fxSignature([slot({ id: "a", type: "eq" }), slot({ id: "b", type: "delay" })]);
    const b = fxSignature([slot({ id: "b", type: "delay" }), slot({ id: "a", type: "eq" })]);
    expect(a).not.toBe(b);
  });

  it("只改参数不改变签名（不应触发重建）", () => {
    expect(fxSignature([slot({ params: { lowGain: "-3" } })])).toBe(
      fxSignature([slot({ params: { lowGain: "6" } })]),
    );
  });

  it("旁通开关改变签名", () => {
    expect(fxSignature([slot({ enabled: true })])).not.toBe(fxSignature([slot({ enabled: false })]));
  });

  it("activeFxSlots 只留启用的槽", () => {
    expect(activeFxSlots([slot({ id: "a" }), slot({ id: "b", enabled: false })])).toHaveLength(1);
  });

  it("fxParam 支持 UI 键与 core 旧键两套命名", () => {
    expect(fxParam({ lowGain: "-3" }, ["lowGain", "lowGainDb"], 0)).toBe(-3);
    expect(fxParam({ lowGainDb: "-4" }, ["lowGain", "lowGainDb"], 0)).toBe(-4);
  });

  it("fxParam 缺省/非法时回退默认值", () => {
    expect(fxParam({}, ["mix"], 0.25)).toBe(0.25);
    expect(fxParam({ mix: "" }, ["mix"], 0.25)).toBe(0.25);
    expect(fxParam({ mix: "abc" }, ["mix"], 0.25)).toBe(0.25);
    expect(fxParam(undefined, ["mix"], 0.25)).toBe(0.25);
  });
});
