/**
 * S0-T01: midi-output 编码 service 单测 (v1.29.0 Stage 0 / D1-3)
 *
 * 覆盖：status/note/velocity 三段编码矩阵、clamp 边界、纯函数语义
 * （同输入幂等、不 throw、入参不变），以及与 parseMidiMessage 的互逆性。
 */
import { describe, it, expect } from 'vitest';
import { encodeNoteOn, encodeNoteOff } from '../midi-output';
import { parseMidiMessage } from '../midi-input';

// MIDI 1.0 status 高半字节（midi.org MIDI 1.0 规范）
const NOTE_OFF_KIND = 0x80; // 1000nnnn
const NOTE_ON_KIND = 0x90; // 1001nnnn

describe('midi-output 编码 (S0-T01)', () => {
  describe('encodeNoteOn', () => {
    it('status/note/velocity 基础编码：channel 0 → 0x90', () => {
      // data[0] = 0x90 | 0（channel 0），data[1] = note 60 (0x3C, 中央 C)，
      // data[2] = velocity 100 (0x64)
      expect(encodeNoteOn(60, 100, 0)).toEqual(
        new Uint8Array([NOTE_ON_KIND | 0x00, 60, 100])
      );
    });

    it('channel 15 → status 低 4 位全 1（0x9F）', () => {
      // 0x90 | 15 = 0x9F
      expect(encodeNoteOn(60, 100, 15)[0]).toBe(0x9f);
      expect(encodeNoteOn(60, 100, 15)).toEqual(
        new Uint8Array([NOTE_ON_KIND | 0x0f, 60, 100])
      );
    });

    it('channel clamp：-1 → 0；20 → 15（status 低 4 位不可溢出）', () => {
      expect(encodeNoteOn(60, 100, -1)[0]).toBe(NOTE_ON_KIND | 0);
      expect(encodeNoteOn(60, 100, 0)[0]).toBe(NOTE_ON_KIND | 0);
      expect(encodeNoteOn(60, 100, 20)[0]).toBe(NOTE_ON_KIND | 0x0f);
      expect(encodeNoteOn(60, 100, 15)[0]).toBe(NOTE_ON_KIND | 0x0f);
    });

    it('note clamp：-5 → 0；200 → 127', () => {
      expect(encodeNoteOn(-5, 100, 0)[1]).toBe(0);
      expect(encodeNoteOn(0, 100, 0)[1]).toBe(0);
      expect(encodeNoteOn(200, 100, 0)[1]).toBe(127);
      expect(encodeNoteOn(127, 100, 0)[1]).toBe(127);
    });

    it('note round：60.4 → 60；60.6 → 61（7 bit 整数音符）', () => {
      expect(encodeNoteOn(60.4, 100, 0)[1]).toBe(60);
      expect(encodeNoteOn(60.6, 100, 0)[1]).toBe(61);
    });

    it('velocity clamp 下限为 1：velocity 0 → 1（MIDI 惯例 note on velocity=0 ≡ note off，试听需发声）', () => {
      // 关键语义：MIDI 1.0 中 0x9n + velocity 0 被接收端判定为 note off，
      // 与 parseMidiMessage 的 velocity=0 → noteoff 判定对偶；
      // 试听必须实际发声，故下限 clamp 至 1，而非 0。
      expect(encodeNoteOn(60, 0, 0)[2]).toBe(1);
      expect(encodeNoteOn(60, -3, 0)[2]).toBe(1);
      expect(encodeNoteOn(60, 1, 0)[2]).toBe(1);
    });

    it('velocity clamp 上限 127：200 → 127', () => {
      expect(encodeNoteOn(60, 200, 0)[2]).toBe(127);
      expect(encodeNoteOn(60, 127, 0)[2]).toBe(127);
    });

    it('velocity round：99.5 → 100', () => {
      expect(encodeNoteOn(60, 99.5, 0)[2]).toBe(100);
    });

    it('返回长度为 3 的 Uint8Array', () => {
      const bytes = encodeNoteOn(60, 100, 0);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(3);
    });
  });

  describe('encodeNoteOff', () => {
    it('status/note/velocity 基础编码：channel 0 → 0x80，velocity 恒为 0', () => {
      expect(encodeNoteOff(60, 0)).toEqual(
        new Uint8Array([NOTE_OFF_KIND | 0x00, 60, 0])
      );
    });

    it('channel 15 → status 0x8F', () => {
      expect(encodeNoteOff(60, 15)).toEqual(
        new Uint8Array([NOTE_OFF_KIND | 0x0f, 60, 0])
      );
    });

    it('channel clamp：-1 → 0；20 → 15', () => {
      expect(encodeNoteOff(60, -1)[0]).toBe(NOTE_OFF_KIND | 0);
      expect(encodeNoteOff(60, 20)[0]).toBe(NOTE_OFF_KIND | 0x0f);
    });

    it('note clamp 与 round 同 note on 语义', () => {
      expect(encodeNoteOff(-5, 0)[1]).toBe(0);
      expect(encodeNoteOff(200, 0)[1]).toBe(127);
      expect(encodeNoteOff(60.4, 0)[1]).toBe(60);
    });

    it('长度为 3 的 Uint8Array', () => {
      expect(encodeNoteOff(60, 0).length).toBe(3);
    });
  });

  describe('纯函数语义', () => {
    it('同输入两次调用 deep equal（无内部状态）', () => {
      expect(encodeNoteOn(60, 100, 3)).toEqual(encodeNoteOn(60, 100, 3));
      expect(encodeNoteOff(60, 3)).toEqual(encodeNoteOff(60, 3));
    });

    it('不 throw：极值 / 非整数 / NaN 输入均返回 3 字节', () => {
      const cases: Array<[number, number, number]> = [
        [-1e9, -1e9, -1e9],
        [1e9, 1e9, 1e9],
        [NaN, NaN, NaN],
        [0, 0, 0],
      ];
      for (const [note, velocity, channel] of cases) {
        expect(() => encodeNoteOn(note, velocity, channel)).not.toThrow();
        expect(encodeNoteOn(note, velocity, channel).length).toBe(3);
      }
      expect(() => encodeNoteOff(NaN, NaN)).not.toThrow();
      expect(encodeNoteOff(NaN, NaN).length).toBe(3);
    });

    it('不修改入参：数值与对象入参均无突变', () => {
      const note = 60;
      const velocity = 100;
      const channel = 3;
      encodeNoteOn(note, velocity, channel);
      expect(note).toBe(60);
      expect(velocity).toBe(100);
      expect(channel).toBe(3);

      // 对象入参不被读取/修改（拷贝语义由调用方负责，本 service 只接受原始值）
      const payload = { note: 60 };
      const snapshot = JSON.stringify(payload);
      encodeNoteOn(payload.note, velocity, channel);
      expect(JSON.stringify(payload)).toBe(snapshot);
    });
  });

  describe('与 parseMidiMessage 互逆 (encode → parse 还原语义)', () => {
    it('encodeNoteOn(60,100,3) → {type:noteon, note:60, velocity:100, channel:3}', () => {
      expect(parseMidiMessage(encodeNoteOn(60, 100, 3))).toEqual({
        type: 'noteon',
        note: 60,
        velocity: 100,
        channel: 3,
      });
    });

    it('encodeNoteOff(60,3) → {type:noteoff, note:60, velocity:0, channel:3}', () => {
      const parsed = parseMidiMessage(encodeNoteOff(60, 3));
      expect(parsed).toEqual({
        type: 'noteoff',
        note: 60,
        velocity: 0,
        channel: 3,
      });
    });

    it('velocity clamp 至 1 保证 note on 不被解析为 noteoff（对偶性验证）', () => {
      // 若 velocity 允许为 0，则 parseMidiMessage 会将其判定为 noteoff；
      // clamp 至 1 后必然解析为 noteon。
      expect(parseMidiMessage(encodeNoteOn(60, 0, 0))?.type).toBe('noteon');
    });
  });
});
