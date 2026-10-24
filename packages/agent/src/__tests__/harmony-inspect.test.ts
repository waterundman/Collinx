import { describe, it, expect, beforeEach } from "vitest";
import { AgentBus, ProjectGraph, ToolRegistry } from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * harmony.inspect（v2.9.1）—— 让 AI 看见和弦轨。
 *
 * 和弦此前只存在于图里，`project.stats` 只数音符/轨道，
 * 模型无法回答「第 2 小节是什么和弦」，也无法据此配器。
 */
function makeGraph(): ProjectGraph {
  const g = ProjectGraph.create("Harmony Test").withMeta({
    tempo_map: [{ bar: 1, bpm: 120 }],
    key_map: [{ bar: 1, tonic: "E", mode: "minor" }],
  });
  g.addNode("ChordEvent", { bar: 2, beat: 1, durationQn: 4, chord: { root: "A", quality: "min" } });
  g.addNode("ChordEvent", { bar: 1, beat: 1, durationQn: 4, chord: { root: "E", quality: "maj" } });
  g.addNode("ChordEvent", { bar: 3, beat: 1, durationQn: 4, chord: { root: "B", quality: "7", bass: "D#" } });
  // 噪声：没有根音的和弦节点应被跳过
  g.addNode("ChordEvent", { bar: 4, beat: 1, durationQn: 4, chord: {} });
  return g;
}

describe("harmony.inspect tool", () => {
  let registry: ToolRegistry;
  const ctx = { type: "agent" as const, name: "test" };

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  it("T01: 返回按小节排序的和弦与调性", async () => {
    const result = await registry.call("harmony.inspect", {}, ctx, {
      readGraph: () => makeGraph(),
    });

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("data");
    expect(result.requiresUserConfirmation).toBe(false);

    const data = result.data as {
      key: { tonic: string; mode: string };
      chords: { bar: number; root: string; quality: string; bass?: string }[];
    };
    expect(data.key).toEqual({ tonic: "E", mode: "minor" });
    expect(data.chords.map((c) => c.bar)).toEqual([1, 2, 3]);
    expect(data.chords[0]).toMatchObject({ root: "E", quality: "maj" });
    expect(data.chords[2]).toMatchObject({ root: "B", quality: "7", bass: "D#" });
  });

  it("T02: 没有和弦时返回空数组而不是报错", async () => {
    const result = await registry.call("harmony.inspect", {}, ctx, {
      readGraph: () => ProjectGraph.create("Empty"),
    });
    const data = result.data as { chords: unknown[] };
    expect(result.status).toBe("ok");
    expect(data.chords).toEqual([]);
  });

  it("T03: 没有图上下文时明确报错", async () => {
    const result = await registry.call("harmony.inspect", {}, ctx);
    expect(result.status).toBe("error");
    expect(String(result.data ?? "")).toMatch(/图|graph/i);
  });

  it("T04: 只读工具不产出 diff", async () => {
    const result = await registry.call("harmony.inspect", {}, ctx, {
      readGraph: () => makeGraph(),
    });
    expect(result.status).toBe("ok");
    expect(result.diff).toBeFalsy();
  });
});
