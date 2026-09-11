/**
 * S0-T01~T03: midi-quantize 纯函数单测 (v1.26.0 Stage 0 / D1-3)
 *
 * 纯函数语义：不 throw、不修改入参、同输入同输出。
 * 数值断言用 toBeCloseTo / 精确倍数断言规避浮点误差。
 */
import { describe, it, expect } from 'vitest';
import { elapsedToBeats, snapBeat } from '../midi-quantize';

// ── S0-T01: elapsedToBeats 矩阵 ──
describe('elapsedToBeats (S0-T01)', () => {
  it('critical: 120bpm×500ms=1；60bpm×1000ms=1', () => {
    expect(elapsedToBeats(500, 120)).toBeCloseTo(1, 10);
    expect(elapsedToBeats(1000, 60)).toBeCloseTo(1, 10);
  });

  it('critical: elapsedMs <= 0 → 0（0 与负数均归零）', () => {
    expect(elapsedToBeats(0, 120)).toBe(0);
    expect(elapsedToBeats(-1, 120)).toBe(0);
    expect(elapsedToBeats(-1000, 120)).toBe(0);
  });

  it('critical: bpm <= 0 → 0', () => {
    expect(elapsedToBeats(500, 0)).toBe(0);
    expect(elapsedToBeats(500, -120)).toBe(0);
  });

  it('critical: 一般值符合 elapsedMs * bpm / 60000', () => {
    // 250ms@120bpm = 0.5 拍；2000ms@90bpm = 3 拍
    expect(elapsedToBeats(250, 120)).toBeCloseTo(0.5, 10);
    expect(elapsedToBeats(2000, 90)).toBeCloseTo(3, 10);
  });
});

// ── S0-T02: snapBeat 矩阵 ──
describe('snapBeat (S0-T02)', () => {
  it('critical: grid <= 0 → 原样返回（off / 非法 grid）', () => {
    expect(snapBeat(1.1, 0)).toBe(1.1);
    expect(snapBeat(3.9, 0)).toBe(3.9);
    expect(snapBeat(1.26, -0.25)).toBe(1.26);
  });

  it('critical: grid=0.25 → round-to-nearest', () => {
    expect(snapBeat(1.1, 0.25)).toBeCloseTo(1, 10);
    expect(snapBeat(3.9, 0.25)).toBeCloseTo(4, 10);
  });

  it('critical: grid=0.5 → round-to-nearest', () => {
    expect(snapBeat(4.6, 0.5)).toBeCloseTo(4.5, 10);
    expect(snapBeat(1.26, 0.5)).toBeCloseTo(1.5, 10);
    // 4.75 为精确半值（4.75/0.5=9.5）：Math.round 半值向上 → 5.0
    // （任务矩阵原写 4.75→4.5 与规范裁决公式冲突，以公式为准，已登记）
    expect(snapBeat(4.75, 0.5)).toBeCloseTo(5, 10);
  });

  it('critical: grid=1 → round-to-nearest', () => {
    expect(snapBeat(1.49, 1)).toBeCloseTo(1, 10);
    expect(snapBeat(1.51, 1)).toBeCloseTo(2, 10);
  });

  it('critical: 整数倍输入 → 精确倍数结果（浮点安全断言）', () => {
    expect(snapBeat(2, 0.25)).toBeCloseTo(2, 10);
    expect(snapBeat(0.5, 0.5)).toBeCloseTo(0.5, 10);
  });
});

// ── S0-T03: 纯函数语义 ──
describe('midi-quantize 纯函数语义 (S0-T03)', () => {
  it('non-critical: 同输入两次调用 deep equal', () => {
    expect(elapsedToBeats(500, 120)).toEqual(elapsedToBeats(500, 120));
    expect(snapBeat(1.1, 0.25)).toEqual(snapBeat(1.1, 0.25));
  });

  it('non-critical: 边界输入不 throw', () => {
    expect(() => elapsedToBeats(NaN, 120)).not.toThrow();
    expect(() => elapsedToBeats(500, NaN)).not.toThrow();
    expect(() => elapsedToBeats(Infinity, 120)).not.toThrow();
    expect(() => snapBeat(NaN, 0.25)).not.toThrow();
    expect(() => snapBeat(Infinity, 0.25)).not.toThrow();
    expect(() => snapBeat(1.1, NaN)).not.toThrow();
  });

  it('non-critical: number 入参不可变（值语义，浅比较不变）', () => {
    const ms = 500;
    const bpm = 120;
    elapsedToBeats(ms, bpm);
    expect(ms).toBe(500);
    expect(bpm).toBe(120);
    const beat = 1.1;
    const grid = 0.25;
    snapBeat(beat, grid);
    expect(beat).toBe(1.1);
    expect(grid).toBe(0.25);
  });
});
