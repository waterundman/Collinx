import { describe, it, expect } from "vitest";
import { chordPitches, pitchClassOf, CHORD_BASE_MIDI } from "../chord-voicing";

/**
 * 和弦 → 音高（v2.9.1）。
 *
 * 背景：和弦轨此前只写 ChordEvent、不产生音符 → 点了没声音。
 * 现在写和弦会生成真实 NoteSpan，本文件锁定展开规则。
 */
describe("pitchClassOf", () => {
  it("自然音与升降号都能解析", () => {
    expect(pitchClassOf("C")).toBe(0);
    expect(pitchClassOf("F#")).toBe(6);
    expect(pitchClassOf("Gb")).toBe(6);
    expect(pitchClassOf("Bb")).toBe(10);
  });

  it("大小写不敏感", () => {
    expect(pitchClassOf("c")).toBe(0);
    expect(pitchClassOf("bb")).toBe(10);
  });

  it("无法识别返回 null（调用方跳过，不写错音）", () => {
    expect(pitchClassOf("H")).toBeNull();
    expect(pitchClassOf(undefined)).toBeNull();
    expect(pitchClassOf("")).toBeNull();
  });
});

describe("chordPitches", () => {
  it("大三和弦 = 根音 + 大三度 + 纯五度", () => {
    expect(chordPitches({ root: "C", quality: "maj" })).toEqual([48, 52, 55]);
  });

  it("小三和弦 = 根音 + 小三度 + 纯五度", () => {
    expect(chordPitches({ root: "A", quality: "min" })).toEqual([57, 60, 64]);
  });

  it("属七和弦有四个音", () => {
    expect(chordPitches({ root: "G", quality: "7" })).toEqual([55, 59, 62, 65]);
  });

  it("所有音落在基准八度附近（跨度 ≤ 12 半音）", () => {
    for (const chord of [
      { root: "C", quality: "maj" },
      { root: "B", quality: "maj" },
      { root: "G", quality: "7" },
      { root: "C", quality: "maj7" },
    ]) {
      const pitches = chordPitches(chord);
      expect(pitches[0]).toBeGreaterThanOrEqual(CHORD_BASE_MIDI);
      expect(pitches[pitches.length - 1] - pitches[0]).toBeLessThanOrEqual(12);
    }
  });

  it("升序排列（声部顺序稳定）", () => {
    for (const quality of ["maj", "min", "7", "maj7", "min7", "dim", "aug", "sus4"]) {
      const pitches = chordPitches({ root: "D", quality });
      expect([...pitches].sort((a, b) => a - b)).toEqual(pitches);
    }
  });

  it("斜线和弦：bass 音放到最低声部", () => {
    const pitches = chordPitches({ root: "C", quality: "maj", bass: "E" });
    expect(pitches[0] % 12).toBe(4); // E
    expect(pitches[0]).toBeLessThan(48);
  });

  it("未知根音返回空（宁缺勿错）", () => {
    expect(chordPitches({ root: "H", quality: "maj" })).toEqual([]);
  });

  it("未知性质退回大三和弦（不抛错、不留空）", () => {
    expect(chordPitches({ root: "C", quality: "nonsense" })).toEqual([48, 52, 55]);
  });
});
