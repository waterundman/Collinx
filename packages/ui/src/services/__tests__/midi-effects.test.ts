import { describe, it, expect } from "vitest";
import { TempoMap, createNoteEvent } from "@collinx/core";
import {
  applyMidiEffects,
  createMidiEffect,
  normalizeMidiEffects,
  MIDI_EFFECT_LIMITS,
  type MidiEffect,
} from "../midi-effects";
import { buildPlaybackEvents } from "../midi-schedule";

/**
 * v3.1.0：MIDI 效果链的红线。
 *
 * 三条必须锁住的性质：
 * 1. 纯函数 —— 不改入参（工程音符不能被效果链污染）
 * 2. 越界钳制 —— 移调后 pitch 仍落在 0..127，力度仍在 0..1
 * 3. 真的作用到调度器 —— buildPlaybackEvents 输出的事件音高/力度确实变了
 */

const note = createNoteEvent({
  trackId: "melody",
  bar: 1,
  beat: 1,
  durQn: 1,
  pitchMidi: 60,
  velocity: 0.5,
});

function fx(type: "transpose" | "velocity", value: number, enabled = true): MidiEffect {
  return { ...createMidiEffect(type), value, enabled };
}

describe("applyMidiEffects", () => {
  it("returns a copy when the chain is empty and leaves input untouched", () => {
    const out = applyMidiEffects([note], []);
    expect(out).toHaveLength(1);
    expect(out).not.toBe([note]);
    expect(note.pitchMidi).toBe(60);
    expect(note.velocity).toBe(0.5);
  });

  it("transposes without mutating the source note", () => {
    const out = applyMidiEffects([note], [fx("transpose", 12)]);
    expect(out[0].pitchMidi).toBe(72);
    expect(note.pitchMidi).toBe(60);
  });

  it("chains transpose then velocity in declaration order", () => {
    const out = applyMidiEffects([note], [fx("transpose", -5), fx("velocity", 2)]);
    expect(out[0].pitchMidi).toBe(55);
    expect(out[0].velocity).toBe(1); // 0.5 * 2 = 1，钳到上限
  });

  it("clamps pitch to 0..127 and velocity to 0..1", () => {
    const high = applyMidiEffects([{ pitchMidi: 120, velocity: 0.9 }], [fx("transpose", 24), fx("velocity", 2)]);
    expect(high[0].pitchMidi).toBe(127);
    expect(high[0].velocity).toBe(1);

    const low = applyMidiEffects([{ pitchMidi: 2, velocity: 0.1 }], [fx("transpose", -24)]);
    expect(low[0].pitchMidi).toBe(0);
  });

  it("skips disabled effects", () => {
    const out = applyMidiEffects([note], [fx("transpose", 12, false)]);
    expect(out[0].pitchMidi).toBe(60);
  });
});

describe("normalizeMidiEffects", () => {
  it("drops malformed entries instead of letting NaN through", () => {
    const cleaned = normalizeMidiEffects([
      { id: "a", type: "transpose", enabled: true, value: Number.NaN },
      { id: "b", type: "bogus", enabled: true, value: 3 },
      null,
      { id: "c", type: "velocity", value: 5 },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned[0].value).toBe(MIDI_EFFECT_LIMITS.transpose.defaultValue);
    expect(cleaned[1].value).toBe(MIDI_EFFECT_LIMITS.velocity.max); // 5 钳到上限
  });

  it("returns an empty array for non-arrays (old settings without the field)", () => {
    expect(normalizeMidiEffects(undefined)).toEqual([]);
    expect(normalizeMidiEffects(null)).toEqual([]);
  });
});

describe("buildPlaybackEvents + MIDI effects", () => {
  const tempoMap = new TempoMap();

  it("applies the chain to the scheduled events", () => {
    const plain = buildPlaybackEvents([note], tempoMap, { bar: 1, beat: 1 });
    const effected = buildPlaybackEvents([note], tempoMap, { bar: 1, beat: 1 }, [fx("transpose", 12)]);

    const plainOn = plain.find((e) => e.kind === "on")!;
    const effectedOn = effected.find((e) => e.kind === "on")!;

    expect(plainOn.pitchMidi).toBe(60);
    expect(effectedOn.pitchMidi).toBe(72);
    // on/off 仍成对出现，且时间不变
    expect(effected.filter((e) => e.kind === "on")).toHaveLength(1);
    expect(effected.filter((e) => e.kind === "off")).toHaveLength(1);
    expect(effectedOn.atSeconds).toBe(plainOn.atSeconds);
  });

  it("does not modify the incoming notes array", () => {
    buildPlaybackEvents([note], tempoMap, { bar: 1, beat: 1 }, [fx("transpose", -12)]);
    expect(note.pitchMidi).toBe(60);
  });
});
