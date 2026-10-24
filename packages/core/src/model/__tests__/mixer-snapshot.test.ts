import { describe, it, expect } from "vitest";
import { createTrack, toMixerSnapshot, type MixerState } from "../index";

/**
 * toMixerSnapshot（v2.9.0）—— 给 Agent 工具层读的只读混音快照。
 *
 * 关键语义都收在这里，工具层只负责搬运：
 * 1. `-Infinity`（推子拉到底）必须原样保留，不能当无效值回 0dB
 * 2. `effectiveMute` 已经算好「独奏并集 + mute 优先」，模型不必自己推
 * 3. FX 只暴露 type/enabled（占位信息），不泄漏可变引用
 */
function mixer(): MixerState {
  const melody = createTrack("Melody", "melody");
  melody.gainDb = "-Infinity";
  melody.pan = "0.5";
  melody.instrument = "lead";
  melody.fxChain.slots.push({
    id: "eq-1",
    type: "eq",
    preset: "default",
    params: { lowGain: "-3" },
    enabled: true,
  });
  melody.fxChain.slots.push({
    id: "rev-1",
    type: "reverb",
    preset: "default",
    params: {},
    enabled: false,
  });
  const bass = createTrack("Bass", "bass");
  bass.solo = true;
  const chords = createTrack("Chords", "chords");
  chords.mute = true;
  chords.solo = true;
  return {
    tracks: [melody, bass, chords],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

describe("toMixerSnapshot", () => {
  it("保留 -Infinity（真静音），不退回 0dB", () => {
    const snap = toMixerSnapshot(mixer());
    expect(snap.tracks[0].gainDb).toBe(-Infinity);
  });

  it("声像与音色原样带出", () => {
    const snap = toMixerSnapshot(mixer());
    expect(snap.tracks[0].pan).toBe(0.5);
    expect(snap.tracks[0].instrument).toBe("lead");
  });

  it("FX 只带 type/enabled，且保持链上顺序", () => {
    const snap = toMixerSnapshot(mixer());
    expect(snap.tracks[0].fx).toEqual([
      { type: "eq", enabled: true },
      { type: "reverb", enabled: false },
    ]);
  });

  it("独奏并集：anySolo=true 时非 solo 轨 effectiveMute", () => {
    const snap = toMixerSnapshot(mixer());
    expect(snap.anySolo).toBe(true);
    expect(snap.tracks.find((t) => t.sourceTrackId === "melody")!.effectiveMute).toBe(true);
    expect(snap.tracks.find((t) => t.sourceTrackId === "bass")!.effectiveMute).toBe(false);
  });

  it("mute 优先于 solo：同时 mute+solo 仍静音", () => {
    const snap = toMixerSnapshot(mixer());
    expect(snap.tracks.find((t) => t.sourceTrackId === "chords")!.effectiveMute).toBe(true);
  });

  it("空混音台不抛错", () => {
    const snap = toMixerSnapshot({
      tracks: [],
      masterTrack: createTrack("Master", "master", "master"),
      routingMatrix: {},
    });
    expect(snap.tracks).toEqual([]);
    expect(snap.anySolo).toBe(false);
  });
});
