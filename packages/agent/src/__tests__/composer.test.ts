import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus } from "@collinx/core";
import { Composer, normalizeScaleName, normalizeKeyName } from "../composer";
import { registerBuiltinTools } from "../tools";

describe("Composer", () => {
  let registry: ToolRegistry;
  let composer: Composer;

  beforeEach(() => {
    registry = new ToolRegistry();
    composer = new Composer(registry);
  });

  describe("generateMotif", () => {
    it("should generate notes for default parameters", () => {
      const result = composer.generateMotif({
        bars: 4,
        register: "mid",
      });

      expect(result.status).toBe("ok");
      expect(result.resultType).toBe("proposal");
      expect(result.requiresUserConfirmation).toBe(true);

      const data = result.data as { notes: unknown[]; motif: Record<string, unknown> };
      expect(data.notes).toBeDefined();
      expect(Array.isArray(data.notes)).toBe(true);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    it("should generate notes in the correct register", () => {
      const lowResult = composer.generateMotif({ bars: 2, register: "low" });
      const midResult = composer.generateMotif({ bars: 2, register: "mid" });
      const highResult = composer.generateMotif({ bars: 2, register: "high" });

      const lowData = lowResult.data as { notes: { pitchMidi: number }[] };
      const midData = midResult.data as { notes: { pitchMidi: number }[] };
      const highData = highResult.data as { notes: { pitchMidi: number }[] };

      const lowAvg = lowData.notes.reduce((s, n) => s + n.pitchMidi, 0) / lowData.notes.length;
      const midAvg = midData.notes.reduce((s, n) => s + n.pitchMidi, 0) / midData.notes.length;
      const highAvg = highData.notes.reduce((s, n) => s + n.pitchMidi, 0) / highData.notes.length;

      expect(lowAvg).toBeLessThan(midAvg);
      expect(midAvg).toBeLessThan(highAvg);
    });

    it("should respect bar count", () => {
      const result2bar = composer.generateMotif({ bars: 2, register: "mid" });
      const result8bar = composer.generateMotif({ bars: 8, register: "mid" });

      const data2 = result2bar.data as { notes: { bar: number }[] };
      const data8 = result8bar.data as { notes: { bar: number }[] };

      const maxBar2 = Math.max(...data2.notes.map((n) => n.bar));
      const maxBar8 = Math.max(...data8.notes.map((n) => n.bar));

      expect(maxBar2).toBeLessThanOrEqual(2);
      expect(maxBar8).toBeLessThanOrEqual(8);
      expect(data8.notes.length).toBeGreaterThan(data2.notes.length);
    });

    it("should handle different keys", () => {
      const resultC = composer.generateMotif({ bars: 2, register: "mid", key: "C" });
      const resultG = composer.generateMotif({ bars: 2, register: "mid", key: "G" });

      const dataC = resultC.data as { notes: { pitchMidi: number }[] };
      const dataG = resultG.data as { notes: { pitchMidi: number }[] };

      // G major should generally be 7 semitones higher than C major
      expect(dataC.notes.length).toBeGreaterThan(0);
      expect(dataG.notes.length).toBeGreaterThan(0);
    });

    it("should handle different scales", () => {
      const majorResult = composer.generateMotif({
        bars: 2,
        register: "mid",
        key: "C",
        scale: "major",
      });
      const minorResult = composer.generateMotif({
        bars: 2,
        register: "mid",
        key: "C",
        scale: "minor",
      });

      expect(majorResult.status).toBe("ok");
      expect(minorResult.status).toBe("ok");
    });

    it("should handle pentatonic scale", () => {
      const result = composer.generateMotif({
        bars: 2,
        register: "mid",
        scale: "pentatonic_major",
      });
      expect(result.status).toBe("ok");
      const data = result.data as { notes: unknown[] };
      expect(data.notes.length).toBeGreaterThan(0);
    });

    it("should generate notes with valid pitch ranges", () => {
      const result = composer.generateMotif({ bars: 4, register: "mid" });
      const data = result.data as { notes: { pitchMidi: number }[] };

      for (const note of data.notes) {
        expect(note.pitchMidi).toBeGreaterThanOrEqual(21);
        expect(note.pitchMidi).toBeLessThanOrEqual(108);
      }
    });

    it("should generate notes with proper structure", () => {
      const result = composer.generateMotif({ bars: 2, register: "mid" });
      const data = result.data as { notes: { id: string; bar: number; beat: number; durQn: number; pitchMidi: number; velocity: number }[] };

      for (const note of data.notes) {
        expect(note.id).toBeTruthy();
        expect(note.bar).toBeGreaterThanOrEqual(1);
        expect(note.bar).toBeLessThanOrEqual(2);
        expect(note.beat).toBeGreaterThanOrEqual(1);
        expect(note.durQn).toBeGreaterThan(0);
        expect(note.velocity).toBeGreaterThanOrEqual(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
      }
    });

    it("should include motif metadata", () => {
      const result = composer.generateMotif({ bars: 4, register: "mid", key: "D", scale: "minor" });
      const data = result.data as { motif: { name: string; bars: number; instrumentRole: string; tags: string[]; noteIds: string[] } };

      expect(data.motif.name).toContain("Motif");
      expect(data.motif.bars).toBe(4);
      expect(data.motif.instrumentRole).toBe("melody");
      expect(Array.isArray(data.motif.noteIds)).toBe(true);
    });

    it("should handle different style hints", () => {
      const styles = ["classical", "jazz", "pop", "rock", "electronic", "minimal"];
      for (const style of styles) {
        const result = composer.generateMotif({
          bars: 2,
          register: "mid",
          styleHint: style,
        });
        expect(result.status).toBe("ok");
      }
    });

    it("should have confidence score", () => {
      const result = composer.generateMotif({ bars: 2, register: "mid" });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("suggestHarmony", () => {
    it("should generate harmony entries", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });

      expect(result.status).toBe("ok");
      expect(result.resultType).toBe("proposal");

      const data = result.data as { entries: unknown[]; key: string; pattern: string };
      expect(data.entries).toBeDefined();
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.length).toBeGreaterThan(0);
      expect(data.key).toBe("C");
    });

    it("should generate harmony for different keys", () => {
      const keys = ["C", "G", "D", "F", "Bb", "A", "E"];
      for (const key of keys) {
        const result = composer.suggestHarmony({ bars: 4, key });
        expect(result.status).toBe("ok");
      }
    });

    it("should generate harmony with style hint", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C", style: "jazz" });
      expect(result.status).toBe("ok");
    });

    it("should limit harmony entries to bar count", () => {
      const result = composer.suggestHarmony({ bars: 2, key: "C" });
      const data = result.data as { entries: { bar: number }[] };

      for (const entry of data.entries) {
        expect(entry.bar).toBeLessThanOrEqual(2);
      }
    });

    it("should include roman numeral analysis", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      const data = result.data as { entries: { romanNumeral: string }[] };

      for (const entry of data.entries) {
        expect(entry.romanNumeral).toBeTruthy();
      }
    });

    it("should have confidence score", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should require user confirmation", () => {
      const result = composer.suggestHarmony({ bars: 4, key: "C" });
      expect(result.requiresUserConfirmation).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// v2.8.0：旋律质量 —— 级进而非随机跳
// 验收时用户看到密集谱面的原话是「这音符写的什么东西？这合规吗？」。
// 原实现从 style.intervals 随机取音级，interval >= 7 时还会随机跳八度，
// 相邻音完全无关，听感是随机音阶练习而不是动机。
// ---------------------------------------------------------------------------
describe("generateMotif 旋律质量（v2.8.0）", () => {
  const call = async (params: Record<string, unknown>) => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
    return registry.call("composer.generateMotif", params, { type: "agent", name: "test" });
  };

  it("相邻音跨度不超过 7 半音（不再随机跳八度）(critical)", async () => {
    const result = await call({ bars: 4, register: "mid", key: "E", scale: "minor", styleHint: "classical" });
    expect(result.status).toBe("ok");
    const notes = (result.data as { notes: { pitchMidi: number }[] }).notes;
    expect(notes.length).toBeGreaterThan(2);

    const leaps: number[] = [];
    for (let i = 1; i < notes.length; i++) {
      leaps.push(Math.abs(notes[i].pitchMidi - notes[i - 1].pitchMidi));
    }
    // 修复前会出现 12（整八度）的跳进；修复后上限 7（纯五度）
    for (const d of leaps) {
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  it("多数相邻音在级进/三度范围内（≤4 半音）", async () => {
    const result = await call({ bars: 8, register: "mid", key: "C", scale: "major", styleHint: "pop" });
    const notes = (result.data as { notes: { pitchMidi: number }[] }).notes;
    const leaps = notes.slice(1).map((n, i) => Math.abs(n.pitchMidi - notes[i].pitchMidi));
    const stepwise = leaps.filter((d) => d <= 4).length;
    // 80% 概率走 ≤4 半音，样本足够大时应明显过半
    expect(stepwise / leaps.length).toBeGreaterThan(0.6);
  });

  it("所有音都在调内（音高类属于该音阶）", async () => {
    const result = await call({ bars: 4, register: "mid", key: "E", scale: "minor" });
    const notes = (result.data as { notes: { pitchMidi: number }[] }).notes;
    const eMinorPcs = new Set([4, 6, 7, 9, 11, 0, 2]); // E F# G A B C D
    for (const n of notes) {
      expect(eMinorPcs.has(((n.pitchMidi % 12) + 12) % 12)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// v2.8.1：旋律密度与乐句呼吸
//
// 验收时用户看着钢琴卷帘的原话是「钢琴窗口这根本不符合逻辑啊，一个小节里面
// 怎么有那么多音符」。原实现每拍随机挑一个节奏模板，模板池里混着
// [0.25,0.25,0.25,0.25]（16 分），48 小节实测每小节 8~16 个音 —— 谱面密到
// 不可读，也没有任何长音呼吸。
//
// 现在的约束：
//   1. 以四分/二分音符为主、八分为辅、16 分只作点缀；melody 轨硬上限 8 音/小节
//   2. 每 4 小节至少 1 小节以 ≥2 拍的长音收尾（乐句呼吸）
// ---------------------------------------------------------------------------
describe("generateMotif 密度与呼吸（v2.8.1）", () => {
  type N = { bar: number; beat: number; durQn: number; pitchMidi: number };

  const call = async (params: Record<string, unknown>) => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
    const result = await registry.call("composer.generateMotif", params, {
      type: "agent",
      name: "test",
    });
    expect(result.status).toBe("ok");
    return (result.data as { notes: N[] }).notes;
  };

  const countByBar = (notes: N[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const n of notes) m.set(n.bar, (m.get(n.bar) ?? 0) + 1);
    return m;
  };

  it("每小节音符数不超过 8（所有风格）(critical)", async () => {
    for (const styleHint of ["classical", "jazz", "pop", "rock", "electronic", "minimal"]) {
      const notes = await call({ bars: 16, register: "mid", key: "E", scale: "minor", styleHint });
      const perBar = countByBar(notes);
      for (let bar = 1; bar <= 16; bar++) {
        expect(perBar.get(bar) ?? 0).toBeLessThanOrEqual(8);
      }
    }
  });

  it("平均每小节 2~6 个音（不再密到不可读）", async () => {
    const notes = await call({ bars: 48, register: "mid", key: "C", scale: "major", styleHint: "pop" });
    const perBar = countByBar(notes);
    expect(perBar.size).toBe(48);
    const avg = notes.length / 48;
    expect(avg).toBeGreaterThanOrEqual(2);
    expect(avg).toBeLessThanOrEqual(6);
  });

  it("每 4 小节至少有一小节以 ≥2 拍长音收尾（乐句呼吸）(critical)", async () => {
    for (const styleHint of ["classical", "pop", "jazz", "electronic"]) {
      const notes = await call({ bars: 16, register: "mid", key: "E", scale: "minor", styleHint });
      for (let groupStart = 1; groupStart <= 16; groupStart += 4) {
        const groupEnd = groupStart + 3;
        const lastNoteDurInGroup = notes
          .filter((n) => n.bar >= groupStart && n.bar <= groupEnd)
          .map((n) => {
            // 只取每小节最后一个音
            const sameBar = notes.filter((m) => m.bar === n.bar);
            const lastBeat = Math.max(...sameBar.map((m) => m.beat));
            return { bar: n.bar, beat: n.beat, durQn: n.durQn, isLast: n.beat === lastBeat };
          })
          .filter((n) => n.isLast)
          .map((n) => n.durQn);
        expect(Math.max(...lastNoteDurInGroup)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("每个小节的时值总和不超过 4 拍（不越界写谱）", async () => {
    const notes = await call({ bars: 8, register: "mid", key: "G", scale: "major", styleHint: "jazz" });
    const byBar = new Map<number, N[]>();
    for (const n of notes) byBar.set(n.bar, [...(byBar.get(n.bar) ?? []), n]);
    for (const [, barNotes] of byBar) {
      const end = Math.max(...barNotes.map((n) => n.beat - 1 + n.durQn));
      expect(end).toBeLessThanOrEqual(4.001);
    }
  });

  it("相邻音跨度仍不超过 7 半音（回退保护）", async () => {
    const notes = await call({ bars: 8, register: "mid", key: "E", scale: "minor" });
    for (let i = 1; i < notes.length; i++) {
      expect(Math.abs(notes[i].pitchMidi - notes[i - 1].pitchMidi)).toBeLessThanOrEqual(7);
    }
  });
});

// ---------------------------------------------------------------------------
// v2.8.1：scale 参数不生效（端到端实测 AI 说 E 小调、落进工程是 E 大调）
//
// 根因在工具层：SCALE_MAP 只认精确小写 key。AI 按自然语言习惯传
// "E minor" / "e minor" / "natural minor" / "minor（自然小调）" 时全部 miss，
// 静默 fallback 到 MAJOR_SCALE —— 于是 E 大调。key 也可能是合成串 "E minor"。
// ---------------------------------------------------------------------------
describe("generateMotif 调式归一化（v2.8.1）", () => {
  const E_MINOR_PCS = new Set([4, 6, 7, 9, 11, 0, 2]); // E F# G A B C D

  const call = async (params: Record<string, unknown>) => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
    const result = await registry.call("composer.generateMotif", params, {
      type: "agent",
      name: "test",
    });
    expect(result.status).toBe("ok");
    return result.data as { notes: { pitchMidi: number }[]; motif: { name: string } };
  };

  const assertEMinor = (notes: { pitchMidi: number }[]) => {
    expect(notes.length).toBeGreaterThan(3);
    for (const n of notes) {
      expect(E_MINOR_PCS.has(((n.pitchMidi % 12) + 12) % 12)).toBe(true);
    }
  };

  it("scale 传 'minor' 得到小调音高类", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E", scale: "minor" });
    assertEMinor(data.notes);
  });

  it("scale 传 'aeolian' 得到小调音高类", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E", scale: "aeolian" });
    assertEMinor(data.notes);
  });

  it("scale 传 'E minor'（调名+调式合成串）得到小调音高类", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E", scale: "E minor" });
    assertEMinor(data.notes);
  });

  it("scale 传大小写/空格不规范的 '  Natural Minor ' 得到小调音高类", async () => {
    const data = await call({ bars: 4, register: "mid", key: "e", scale: "  Natural Minor " });
    assertEMinor(data.notes);
  });

  it("key 传 'E minor'（AI 常把调式塞进 key）也能解析出 E 小调", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E minor" });
    assertEMinor(data.notes);
  });

  it("mode 传 'minor'（AI 从 suggestHarmony 迁移过来的字段）也生效", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E", mode: "minor" });
    assertEMinor(data.notes);
  });

  it("明确的 major 仍是自然大调（不误伤）", async () => {
    const data = await call({ bars: 4, register: "mid", key: "E", scale: "major" });
    const E_MAJOR_PCS = new Set([4, 6, 8, 9, 11, 1, 3]); // E F# G# A B C# D#
    const pcs = new Set(data.notes.map((n) => ((n.pitchMidi % 12) + 12) % 12));
    expect(pcs.size).toBeGreaterThan(1);
    for (const pc of pcs) {
      expect(E_MAJOR_PCS.has(pc)).toBe(true);
    }
    // 大调的三度/七度必须是 G#(8)/D#(3)，不能是小调的 G(7)/D(2)
    expect(pcs.has(7) || pcs.has(2)).toBe(false);
  });

  it("无法识别的 scale 回退大调且不抛错", async () => {
    const data = await call({ bars: 2, register: "mid", key: "C", scale: "quantum_lydian" });
    expect(data.notes.length).toBeGreaterThan(0);
  });

  it("别名归一化表：小调的各种写法都能识别", () => {
    const minorNames = ["minor", "Minor", " MINOR ", "natural minor", "Natural_Minor", "aeolian", "E minor", "e-minor", "minor（自然小调）", "自然小调"];
    for (const raw of minorNames) {
      expect(["minor", "natural_minor", "aeolian"]).toContain(normalizeScaleName(raw));
    }
    expect(normalizeScaleName("harmonic minor")).toBe("harmonic_minor");
    expect(normalizeScaleName("和声小调")).toBe("harmonic_minor");
    expect(normalizeScaleName("major")).toBe("major");
    expect(normalizeScaleName("quantum_lydian")).toBeNull();
    expect(normalizeScaleName(undefined)).toBeNull();
  });

  it("调名解析：带调式的合成串 / 升降号 / 大小写", () => {
    expect(normalizeKeyName("E")).toEqual({ key: "E", mode: null });
    expect(normalizeKeyName("e")).toEqual({ key: "E", mode: null });
    expect(normalizeKeyName("E minor")).toEqual({ key: "E", mode: "minor" });
    expect(normalizeKeyName("Bb")).toEqual({ key: "Bb", mode: null });
    expect(normalizeKeyName("f# minor")).toEqual({ key: "F#", mode: "minor" });
    expect(normalizeKeyName("F sharp")).toEqual({ key: "F#", mode: null });
  });
});

