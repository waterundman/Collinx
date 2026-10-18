/**
 * AudioRingBuffer 单元测试。
 *
 * 运行：node --test --experimental-strip-types src/audio-ring-buffer.test.ts
 *
 * 这里刻意覆盖四类**真实故障模式**，而不是只测「写进去能读出来」：
 * 1. 绕回 —— 写指针越过容量后必须正确回到 0
 * 2. 溢出 —— 空间不足时整体丢弃（部分写入会让左右声道错位）
 * 3. 欠载 —— 读不足时补零（静音优于重复爆音）
 * 4. 声道对齐 —— 第 i 帧的 L 永远在第 i*2 个位置
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioRingBuffer } from "./audio-ring-buffer.ts";

/** 生成 [L,R] 交织数据，L 与 R 用不同公式，便于检测声道错位 */
function makeInterleaved(frames: number, startFrame = 0): Float32Array {
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = startFrame + i; // 左声道
    out[i * 2 + 1] = -(startFrame + i); // 右声道 = 左声道的相反数
  }
  return out;
}

test("基本读写：内容与声道严格一致", () => {
  const ring = new AudioRingBuffer(1024);
  const src = makeInterleaved(512);
  assert.equal(ring.write(src), 512);
  assert.equal(ring.available, 512);

  const dst = new Float32Array(512 * 2);
  assert.equal(ring.read(dst), 512);
  assert.deepEqual(Array.from(dst), Array.from(src));
  assert.equal(ring.available, 0);
  assert.equal(ring.underrunCount, 0);
  assert.equal(ring.overflowCount, 0);
});

test("绕回：写指针越过容量后回到 0，数据不错乱", () => {
  const ring = new AudioRingBuffer(100);
  // 先读掉一部分，制造一个非零读指针，再写满触发绕回
  ring.write(makeInterleaved(60, 0));
  const sink = new Float32Array(60 * 2);
  ring.read(sink);

  const src = makeInterleaved(80, 1000);
  assert.equal(ring.write(src), 80, "80 帧应能写入（容量 100，已读空）");
  assert.equal(ring.available, 80);

  const dst = new Float32Array(80 * 2);
  assert.equal(ring.read(dst), 80);
  assert.deepEqual(Array.from(dst), Array.from(src));
});

test("溢出：空间不足时整体丢弃，不做部分写入", () => {
  const ring = new AudioRingBuffer(10);
  ring.write(makeInterleaved(8, 0));
  assert.equal(ring.available, 8);

  // 只剩 2 帧空间，写 5 帧必须整体失败
  const leftover = makeInterleaved(5, 900);
  assert.equal(ring.write(leftover), 0, "空间不足应整体丢弃");
  assert.equal(ring.overflowCount, 1);
  assert.equal(ring.available, 8, "已有数据不能被破坏");

  // 原有 8 帧内容必须完好（验证「不部分写入」）
  const dst = new Float32Array(8 * 2);
  ring.read(dst);
  assert.deepEqual(Array.from(dst), Array.from(makeInterleaved(8, 0)));
});

test("欠载：读不足时补零并计数，不重复旧数据", () => {
  const ring = new AudioRingBuffer(64);
  ring.write(makeInterleaved(10, 0));

  const dst = new Float32Array(20 * 2);
  dst.fill(999); // 预填垃圾值，确认补的是 0 而不是残留
  const got = ring.read(dst);

  assert.equal(got, 10, "只读到 10 帧");
  assert.equal(ring.underrunCount, 1);
  // 前 10 帧是数据
  assert.deepEqual(Array.from(dst.subarray(0, 20)), Array.from(makeInterleaved(10, 0)));
  // 后 10 帧必须是 0
  assert.ok(
    Array.from(dst.subarray(20)).every((v) => v === 0),
    "欠载部分必须补零，不能留垃圾值或重复上一帧",
  );
});

test("共享内存：两个视图看到同一块数据", () => {
  const ring = new AudioRingBuffer(32);
  // 模拟消费者：用同一个 SAB 另建视图（等价于 worklet 侧的做法）
  const consumer = new Float32Array(ring.buffer, 5 * 4, 32 * 2);
  const indices = new Int32Array(ring.buffer, 0, 5);

  ring.write(makeInterleaved(4, 42));
  // 消费者直接看内存：写指针应为 4
  assert.equal(indices[0], 4);
  // 前 8 个采样应是 42,-42,43,-43,...
  assert.deepEqual(Array.from(consumer.subarray(0, 8)), [42, -42, 43, -43, 44, -44, 45, -45]);
});

test("available/free 守恒：可用 + 空闲恒等于容量", () => {
  const ring = new AudioRingBuffer(128);
  for (const n of [0, 1, 37, 128, 0]) {
    if (n > 0) ring.write(makeInterleaved(n, 0));
    assert.equal(ring.available + ring.free, ring.capacity, `写 ${n} 帧后应守恒`);
    ring.read(new Float32Array(n * 2));
  }
});

test("reset：清空指针与计数", () => {
  const ring = new AudioRingBuffer(16);
  ring.write(makeInterleaved(16, 0));
  ring.read(new Float32Array(4 * 2));
  ring.write(makeInterleaved(20, 0)); // 触发一次溢出

  ring.reset();
  assert.equal(ring.available, 0);
  assert.equal(ring.free, ring.capacity);
  assert.equal(ring.underrunCount, 0);
  assert.equal(ring.overflowCount, 0);
});
