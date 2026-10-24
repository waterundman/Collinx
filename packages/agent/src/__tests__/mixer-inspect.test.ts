import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentBus,
  ToolRegistry,
  createTrack,
  toMixerSnapshot,
  type MixerState,
} from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * mixer.inspect（v2.9.0）—— 让 AI 看见混音台。
 *
 * 此前 `project.stats` 只有 notes/tracks/bars/bpm：增益、声像、静音、独奏、FX
 * 全在图外，模型对「把贝斯静音」「现在哪条轨最响」只能空谈。
 */
function makeMixer(): MixerState {
  const melody = createTrack("Melody", "melody");
  melody.gainDb = "-6";
  melody.pan = "-0.5";
  melody.instrument = "lead";
  melody.fxChain.slots.push({
    id: "eq-1",
    type: "eq",
    preset: "default",
    params: { lowGain: "-3" },
    enabled: true,
  });
  const bass = createTrack("Bass", "bass");
  bass.mute = true;
  const chords = createTrack("Chords", "chords");
  chords.solo = true;
  return {
    tracks: [melody, bass, chords],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

describe("mixer.inspect tool", () => {
  let registry: ToolRegistry;
  const ctx = { type: "agent" as const, name: "test" };

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  it("T01: 返回每轨增益/声像/静音/独奏/音色/FX", async () => {
    const mixer = makeMixer();
    const result = await registry.call("mixer.inspect", {}, ctx, {
      readMixer: () => toMixerSnapshot(mixer),
    });

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("data");
    expect(result.requiresUserConfirmation).toBe(false);

    const data = result.data as {
      anySolo: boolean;
      tracks: { sourceTrackId: string; gainDb: number; pan: number; mute: boolean; solo: boolean; instrument?: string; fx: { type: string }[] }[];
    };
    expect(data.tracks).toHaveLength(3);
    const melody = data.tracks.find((t) => t.sourceTrackId === "melody")!;
    expect(melody.gainDb).toBe(-6);
    expect(melody.pan).toBe(-0.5);
    expect(melody.instrument).toBe("lead");
    expect(melody.fx.map((f) => f.type)).toEqual(["eq"]);
    expect(data.tracks.find((t) => t.sourceTrackId === "bass")!.mute).toBe(true);
    expect(data.tracks.find((t) => t.sourceTrackId === "chords")!.solo).toBe(true);
  });

  it("T02: 独奏并集与实际静音由快照算好（模型不必自己推优先级）", async () => {
    const mixer = makeMixer();
    const result = await registry.call("mixer.inspect", {}, ctx, {
      readMixer: () => toMixerSnapshot(mixer),
    });

    const data = result.data as {
      anySolo: boolean;
      tracks: { sourceTrackId: string; effectiveMute: boolean }[];
    };
    expect(data.anySolo).toBe(true);
    expect(data.tracks.find((t) => t.sourceTrackId === "melody")!.effectiveMute).toBe(true);
    // chords 是 solo 轨 → 不静音；bass 同时 mute → 仍静音（mute 优先）
    expect(data.tracks.find((t) => t.sourceTrackId === "chords")!.effectiveMute).toBe(false);
    expect(data.tracks.find((t) => t.sourceTrackId === "bass")!.effectiveMute).toBe(true);
  });

  it("T03: 没有混音上下文时明确报错，而不是编造数据", async () => {
    const result = await registry.call("mixer.inspect", {}, ctx);
    expect(result.status).toBe("error");
    expect(String(result.data ?? "")).toMatch(/混音|mixer/i);
  });

  it("T04: 只读工具不产出 diff", async () => {
    const result = await registry.call("mixer.inspect", {}, ctx, {
      readMixer: () => toMixerSnapshot(makeMixer()),
    });
    expect(result.status).toBe("ok");
    expect(result.diff).toBeFalsy();
  });
});
