/**
 * AudioDriver 的时间补偿逻辑测试。
 *
 * 运行：node --test --experimental-strip-types src/audio-driver.test.ts
 *
 * 只测纯函数 computeBlocksToProduce —— 定时器本身难测且会引入不确定性，
 * 而"该生产几块"的决策才是正确性所在。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBlocksToProduce } from "./audio-timing.ts";

const BLOCK_MS = (512 / 44100) * 1000; // ≈ 11.61ms

test("准点：过了正好一块的时间就生产一块", () => {
  assert.equal(computeBlocksToProduce(BLOCK_MS, BLOCK_MS), 1);
});

test("定时器延迟：过了 15ms（Windows 常见粒度）应生产 1 块", () => {
  // 15 / 11.61 ≈ 1.29 → round = 1
  assert.equal(computeBlocksToProduce(15, BLOCK_MS), 1);
});

test("长延迟：按时间补齐，不会永久欠载", () => {
  // 这是关键用例：如果实现是「每 tick 固定一块」，23ms 也只产 1 块，
  // 缓冲会单调下降。按时间算应产 2 块。
  assert.equal(computeBlocksToProduce(23.2, BLOCK_MS), 2);
  assert.equal(computeBlocksToProduce(46.4, BLOCK_MS), 4);
});

test("上限：系统休眠恢复后不会一次性狂渲", () => {
  assert.equal(computeBlocksToProduce(10_000, BLOCK_MS, 8), 8, "上限应生效");
  assert.equal(computeBlocksToProduce(10_000, BLOCK_MS), 8, "默认上限也是 8");
});

test("不足半块：不生产（避免把整块时间切碎）", () => {
  assert.equal(computeBlocksToProduce(BLOCK_MS * 0.4, BLOCK_MS), 0);
});

test("非法输入：返回 0 而不是 NaN/负数", () => {
  assert.equal(computeBlocksToProduce(0, BLOCK_MS), 0);
  assert.equal(computeBlocksToProduce(-5, BLOCK_MS), 0);
  assert.equal(computeBlocksToProduce(100, 0), 0);
  assert.equal(computeBlocksToProduce(100, -1), 0);
  assert.equal(computeBlocksToProduce(Number.NaN, BLOCK_MS), 0);
});

test("单次上限为 1 时可退化成逐块生产", () => {
  assert.equal(computeBlocksToProduce(100, BLOCK_MS, 1), 1);
});
