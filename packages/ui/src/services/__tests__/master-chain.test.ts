import { describe, it, expect } from "vitest";
import { createMasterChain, MASTER_CHAIN_PARAMS } from "../master-chain";

/**
 * 用一个假 ctx 记录节点创建与连接顺序。
 *
 * jsdom 没有真实的 Web Audio（`createDynamicsCompressor` 不存在），
 * 这里只验证**拓扑与参数**——那正是"播放与导出共用同一份实现"的关键。
 */
function fakeCtx() {
  const created: string[] = [];
  const connections: string[][] = [];
  const makeNode = (kind: string) => {
    const node = {
      kind,
      // 真实 AudioParam 的 `.value` 是可写的；假节点必须提供同样的形状
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
      connect(target: { kind?: string }) {
        connections.push([kind, target?.kind ?? "?"]);
        return target;
      },
    };
    return node;
  };
  const ctx = {
    createDynamicsCompressor() {
      created.push("compressor");
      return makeNode("compressor");
    },
  } as unknown as BaseAudioContext;
  return { ctx, created, connections };
}

describe("createMasterChain（母带链拓扑）", () => {
  it("串接 compressor → limiter，且 input/output 各接一端", () => {
    const { ctx, created, connections } = fakeCtx();
    const input = { kind: "master", connect: (t: { kind?: string }) => { connections.push(["master", t?.kind ?? "?"]); return t; } };
    const output = { kind: "destination" };

    createMasterChain(ctx, input as unknown as AudioNode, output as unknown as AudioNode);

    expect(created).toEqual(["compressor", "compressor"]);
    // 顺序：master → compressor → compressor(limiter) → destination
    expect(connections).toEqual([
      ["master", "compressor"],
      ["compressor", "compressor"],
      ["compressor", "destination"],
    ]);
  });

  it("压缩与限幅参数按固定常量设置（导出/播放共用的唯一真源）", () => {
    const nodes: Array<{ params: Record<string, number> }> = [];
    const ctx = {
      createDynamicsCompressor() {
        const params: Record<string, number> = {};
        const node = {
          get threshold() { return { set value(v: number) { params.threshold = v; } }; },
          get knee() { return { set value(v: number) { params.knee = v; } }; },
          get ratio() { return { set value(v: number) { params.ratio = v; } }; },
          get attack() { return { set value(v: number) { params.attack = v; } }; },
          get release() { return { set value(v: number) { params.release = v; } }; },
          connect: () => null,
        };
        nodes.push({ params });
        return node;
      },
    } as unknown as BaseAudioContext;
    const sink = { connect: () => null } as unknown as AudioNode;

    createMasterChain(ctx, sink, sink);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.params).toMatchObject(MASTER_CHAIN_PARAMS.compressor);
    expect(nodes[1]!.params).toMatchObject(MASTER_CHAIN_PARAMS.limiter);
    // 限幅必须是"砖墙"：几乎无拐点、高比例
    expect(MASTER_CHAIN_PARAMS.limiter.knee).toBe(0);
    expect(MASTER_CHAIN_PARAMS.limiter.ratio).toBeGreaterThanOrEqual(20);
  });
});
