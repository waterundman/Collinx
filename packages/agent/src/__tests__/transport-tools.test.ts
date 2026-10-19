import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus } from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * transport.setTempo —— 让 AI 能改速度。
 *
 * 为什么需要它：真实点击验收时，用户说「把速度改成 90 BPM」，
 * AI 回答「我没有改 BPM 的工具，你去面板手动改」。
 * 最高频的参数修改反而没有工具，是 AI 能力面最大的缺口。
 *
 * 设计约束（写测试时就已确认，会驱动出正确的实现）：
 * - 图上 TEMPO 存在 `meta.tempo_map`，类型是数组 `[{ bar, bpm, curve? }]`
 * - `DiffOperation` 里没有 set_tempo，只能用 `update_meta`
 * - 而 `update_meta` 的语义是 `meta.tempo_map = op.data.tempo_map`（整体替换）
 * - agent 工具是无状态纯函数，**拿不到当前图**，因此不能"读现有 map 再合并"
 * → 所以本工具的契约是：**只表达"在 bar N 设为 bpm X"这一意图**，
 *   多 tempo 点的合并必须由应用侧（diff 应用逻辑）负责，不能靠工具猜。
 */
describe("transport.setTempo tool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  const ctx = { type: "agent" as const, name: "test" };

  it("T01: 产出可审批的 diff，且意图为「bar 1 设为 96 BPM」(critical)", async () => {
    const result = await registry.call("transport.setTempo", { bpm: 96 }, ctx);

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("proposal");
    expect(result.requiresUserConfirmation).toBe(true);

    const diff = result.diff;
    expect(diff).toBeTruthy();
    expect(diff!.ops.length).toBeGreaterThan(0);

    // 意图必须能被应用侧还原成「bar 1 = 96」
    const op = diff!.ops[0] as { op: string; bar?: number; bpm?: number };
    expect(op.op).toBe("set_tempo");
    expect(op.bar).toBe(1);
    expect(op.bpm).toBe(96);
  });

  it("T02: 支持在指定 bar 改速度", async () => {
    const result = await registry.call("transport.setTempo", { bpm: 140, bar: 9 }, ctx);
    expect(result.status).toBe("ok");

    const op = result.diff!.ops[0] as { op: string; bar?: number; bpm?: number };
    expect(op.op).toBe("set_tempo");
    expect(op.bar).toBe(9);
    expect(op.bpm).toBe(140);
  });

  it("T03: bpm 越界时拒绝，不产出 diff（不能把非法值写进工程）", async () => {
    for (const bpm of [19, 0, -5, 401, 1000]) {
      const result = await registry.call("transport.setTempo", { bpm }, ctx);
      expect(result.status, `bpm=${bpm} 应被拒绝`).toBe("error");
      expect(result.diff).toBeFalsy();
      // 必须是因为 bpm 越界而拒绝 —— 不能是「工具不存在」碰巧也返回 error
      expect(String(result.data ?? "")).toMatch(/bpm/i);
    }
  });

  it("T04: bar 非法时拒绝（非正整数）", async () => {
    for (const bar of [0, -1, 1.5]) {
      const result = await registry.call("transport.setTempo", { bpm: 100, bar }, ctx);
      expect(result.status, `bar=${bar} 应被拒绝`).toBe("error");
      expect(String(result.data ?? "")).toMatch(/bar/i);
    }
  });

  it("T05: 缺 bpm 时拒绝并给出可读错误", async () => {
    const result = await registry.call("transport.setTempo", {}, ctx);
    expect(result.status).toBe("error");
    expect(String(result.data ?? "")).toMatch(/bpm/i);
  });
});
