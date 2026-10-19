import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus } from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * mixer.setTrackVolume —— 让 AI 能调音量。
 *
 * 与 transport.setTempo 同源的缺口：真实验收里 AI 能"建议 FX 链"，
 * 却不能把某条轨的音量调到 -6 dB。
 *
 * 注意 mixer 的架构特殊性：
 * - 混音状态**不在 ProjectGraph 里**，是 store 的独立状态 `state.mixer`
 * - 它有独立的 diff 通道（baseRevision 用 `mixer://state-v1`）
 * - 工具侧沿用 mixing agent 的既有做法：`mixerToDiff(changes, "HEAD")`，
 *   由 UI 的 alignRevision 在入队时对齐 —— 不要在工具里猜 revision
 */
describe("mixer.setTrackVolume tool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  const ctx = { type: "agent" as const, name: "test" };

  it("T01: 产出改为指定 gainDb 的 mixer diff (critical)", async () => {
    const result = await registry.call(
      "mixer.setTrackVolume",
      { trackId: "melody", gainDb: -6 },
      ctx,
    );

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("proposal");
    expect(result.requiresUserConfirmation).toBe(true);

    const diff = result.diff;
    expect(diff).toBeTruthy();
    expect(diff!.ops).toHaveLength(1);

    const op = diff!.ops[0] as {
      op: string;
      nodeId: string;
      data: { trackId: string; changes: { gainDb?: string } };
    };
    expect(op.op).toBe("update_node");
    expect(op.nodeId).toBe("melody");
    // MixerTrack.gainDb 是字符串（模型里就是 string），工具收 number 再转换
    expect(op.data.changes.gainDb).toBe("-6");
  });

  it("T02: 支持同时改 pan（同一次提案里）", async () => {
    const result = await registry.call(
      "mixer.setTrackVolume",
      { trackId: "bass", gainDb: -3, pan: 0.25 },
      ctx,
    );
    expect(result.status).toBe("ok");

    const op = result.diff!.ops[0] as { data: { changes: { gainDb?: string; pan?: string } } };
    expect(op.data.changes.gainDb).toBe("-3");
    expect(op.data.changes.pan).toBe("0.25");
  });

  it("T03: gainDb 越界时拒绝（只允许 +12 ~ -60 dB）", async () => {
    for (const gainDb of [13, 60, -61]) {
      const result = await registry.call(
        "mixer.setTrackVolume",
        { trackId: "melody", gainDb },
        ctx,
      );
      expect(result.status, `gainDb=${gainDb} 应被拒绝`).toBe("error");
      expect(result.diff).toBeFalsy();
      expect(String(result.data ?? "")).toMatch(/gainDb/i);
    }
  });

  it("T04: 缺 trackId 时拒绝", async () => {
    const result = await registry.call("mixer.setTrackVolume", { gainDb: -6 }, ctx);
    expect(result.status).toBe("error");
    expect(String(result.data ?? "")).toMatch(/trackId/i);
  });

  it("T05: 既没给 gainDb 也没给 pan 时拒绝（空操作没有意义）", async () => {
    const result = await registry.call("mixer.setTrackVolume", { trackId: "melody" }, ctx);
    expect(result.status).toBe("error");
    // 必须是「没有可改的参数」而拒绝，不能是「工具不存在」碰巧也返回 error
    expect(String(result.data ?? "")).toMatch(/gainDb|pan/i);
  });
});
