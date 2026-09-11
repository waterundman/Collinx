/**
 * S0-T01~T02: midi-input service 单测（parseMidiMessage 纯函数）
 * 解析矩阵（noteon / noteoff / velocity=0 惯例双路 / other / 不完整消息 /
 * channel 断言）与纯函数无副作用语义。
 */
import { describe, it, expect } from 'vitest';
import { parseMidiMessage } from '../midi-input';

describe('parseMidiMessage (S0-T01)', () => {
  it('S0-T01: 解析矩阵 (critical)', () => {
    // Note On: 0x90 ch0, note 60, velocity 100
    expect(parseMidiMessage(new Uint8Array([0x90, 0x3c, 0x64]))).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 100,
      channel: 0,
    });

    // Note Off: 0x80 ch0, note 60, velocity 40
    expect(parseMidiMessage(new Uint8Array([0x80, 0x3c, 0x28]))).toEqual({
      type: 'noteoff',
      note: 60,
      velocity: 40,
      channel: 0,
    });

    // velocity=0 的 Note On → noteoff（行业惯例双路）
    expect(parseMidiMessage(new Uint8Array([0x90, 0x3c, 0x00]))).toEqual({
      type: 'noteoff',
      note: 60,
      velocity: 0,
      channel: 0,
    });

    // CC（0xB0）→ other
    expect(parseMidiMessage(new Uint8Array([0xb0, 0x07, 0x64]))).toMatchObject({
      type: 'other',
    });

    // 不完整消息（len 2）→ null，不 throw
    expect(parseMidiMessage(new Uint8Array([0x90, 0x3c]))).toBeNull();

    // channel 断言：0x91 → ch1
    expect(parseMidiMessage(new Uint8Array([0x91, 0x3c, 0x64]))!.channel).toBe(1);
  });
});

describe('parseMidiMessage purity (S0-T02)', () => {
  it('S0-T02: 纯函数无副作用——入参字节不变 + 同输入两次结果 deep equal (non-critical)', () => {
    // 注：Node 对带元素的 TypedArray 禁用 Object.freeze（引擎限制），
    // 无副作用改用字节快照断言：调用前后 data 完全不变（纯函数不写入）
    const data = new Uint8Array([0x90, 0x3c, 0x64]);
    const snapshot = Array.from(data);

    expect(() => parseMidiMessage(data)).not.toThrow();
    expect(parseMidiMessage(data)).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 100,
      channel: 0,
    });
    expect(Array.from(data)).toEqual(snapshot);

    // 同输入两次结果 deep equal
    const a = parseMidiMessage(new Uint8Array([0x90, 0x3c, 0x64]));
    const b = parseMidiMessage(new Uint8Array([0x90, 0x3c, 0x64]));
    expect(a).toEqual(b);
  });
});
