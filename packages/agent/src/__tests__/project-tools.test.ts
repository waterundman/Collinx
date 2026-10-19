import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus, ProjectGraph } from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * project.stats —— 让 AI 能回答「工程里现在有多少音符/几轨」。
 *
 * 这是本轮最有架构意义的一条：真实验收里 AI 明确说
 * 「同样无法查询，没有音符统计类工具」，因为 **tool handler 只收 params，
 * 拿不到图**。所有只读能力（统计、查当前速度、列轨道）都被这个签名卡住。
 *
 * 因此本测试同时约束两件事：
 * 1. 工具本身：返回真实的 notes / tracks / bars 数字
 * 2. 框架改动：`registry.call` 接受可选的只读图上下文，且**只读**
 *    （工具不能借它改图 —— 改必须走 diff，这是可审计性的根基）
 */
function makeGraph(): ProjectGraph {
  const g = ProjectGraph.create("Stats Test").withMeta({
    tempo_map: [{ bar: 1, bpm: 120 }],
  });
  g.addNode("NoteSpan", { pitchMidi: 60, bar: 1, beat: 1, trackId: "melody" });
  g.addNode("NoteSpan", { pitchMidi: 64, bar: 1, beat: 2, trackId: "melody" });
  g.addNode("NoteSpan", { pitchMidi: 48, bar: 1, beat: 1, trackId: "bass" });
  g.addNode("NoteSpan", { pitchMidi: 67, bar: 5, beat: 1, trackId: "melody" });
  return g;
}

describe("project.stats tool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  const ctx = { type: "agent" as const, name: "test" };

  it("T01: 返回真实的音符数与轨道数 (critical)", async () => {
    const graph = makeGraph();
    const result = await registry.call("project.stats", {}, ctx, { readGraph: () => graph });

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("data");
    // 只读工具不需要用户审批
    expect(result.requiresUserConfirmation).toBe(false);

    const data = result.data as { notes: number; tracks: number; bars: number; bpm: number };
    expect(data.notes).toBe(4);
    expect(data.tracks).toBe(2); // melody + bass
    expect(data.bars).toBe(5); // 最后一个音符在 bar 5
    expect(data.bpm).toBe(120);
  });

  it("T02: 空工程返回 0，而不是报错", async () => {
    const graph = ProjectGraph.create("Empty");
    const result = await registry.call("project.stats", {}, ctx, { readGraph: () => graph });

    expect(result.status).toBe("ok");
    const data = result.data as { notes: number; tracks: number };
    expect(data.notes).toBe(0);
    expect(data.tracks).toBe(0);
  });

  it("T03: 没有图上下文时明确报错，不返回假数据", async () => {
    const result = await registry.call("project.stats", {}, ctx);
    expect(result.status).toBe("error");
    // 必须说清"缺少图上下文"，而不是返回 0 让人误以为工程是空的
    expect(String(result.data ?? "")).toMatch(/图|graph/i);
  });

  it("T04: 只读工具不产出 diff", async () => {
    const graph = makeGraph();
    const result = await registry.call("project.stats", {}, ctx, { readGraph: () => graph });
    // 先确认工具真的成功了 —— 否则"没有 diff"只是因为工具不存在
    expect(result.status).toBe("ok");
    expect(result.diff).toBeFalsy();
  });
});
