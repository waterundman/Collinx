import { describe, it, expect } from "vitest";
import { createMasterChain, MASTER_CHAIN_PARAMS } from "../master-chain";
import { createFakeAudioContext } from "../../test-utils/fake-audio-context";

/**
 * 母带链拓扑与参数（播放与导出共用的唯一实现）。
 *
 * v2.9.1：本文件原先自带一份私有 fake ctx（只实现 createDynamicsCompressor）。
 * 已与 `test-utils/fake-audio-context.ts` 合并 —— 两份假实现会让"记录行为"
 * 逐渐分叉，测试之间互相不认账。
 */
describe("createMasterChain（母带链拓扑）", () => {
  it("串接 compressor → limiter，且 input/output 各接一端", () => {
    const fake = createFakeAudioContext();
    const input = fake.makeNode("master");
    const output = fake.makeNode("destination");

    createMasterChain(fake.ctx, input as unknown as AudioNode, output as unknown as AudioNode);

    expect(fake.nodesOfKind("DynamicsCompressor")).toHaveLength(2);
    // 顺序：master → compressor → compressor(limiter) → destination
    expect(fake.connections).toEqual([
      { from: "master", to: "DynamicsCompressor" },
      { from: "DynamicsCompressor", to: "DynamicsCompressor" },
      { from: "DynamicsCompressor", to: "destination" },
    ]);
  });

  it("压缩与限幅参数按固定常量设置（导出/播放共用的唯一真源）", () => {
    const fake = createFakeAudioContext();
    const input = fake.makeNode("master");
    const output = fake.makeNode("destination");

    createMasterChain(fake.ctx, input as unknown as AudioNode, output as unknown as AudioNode);

    const [compressor, limiter] = fake.nodesOfKind("DynamicsCompressor");
    const read = (node: typeof compressor, p: string) =>
      (node[p] as { value: number }).value;

    expect(read(compressor, "threshold")).toBe(MASTER_CHAIN_PARAMS.compressor.threshold);
    expect(read(compressor, "knee")).toBe(MASTER_CHAIN_PARAMS.compressor.knee);
    expect(read(compressor, "ratio")).toBe(MASTER_CHAIN_PARAMS.compressor.ratio);
    expect(read(compressor, "attack")).toBe(MASTER_CHAIN_PARAMS.compressor.attack);
    expect(read(compressor, "release")).toBe(MASTER_CHAIN_PARAMS.compressor.release);

    expect(read(limiter, "threshold")).toBe(MASTER_CHAIN_PARAMS.limiter.threshold);
    expect(read(limiter, "ratio")).toBe(MASTER_CHAIN_PARAMS.limiter.ratio);
    // 限幅必须是"砖墙"：几乎无拐点、高比例
    expect(MASTER_CHAIN_PARAMS.limiter.knee).toBe(0);
    expect(MASTER_CHAIN_PARAMS.limiter.ratio).toBeGreaterThanOrEqual(20);
  });
});
