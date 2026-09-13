/**
 * S0-T01~T03: midi-schedule 调度纯函数单测 (v2.0.0 Stage 0 / D0-1~D0-3)
 *
 * 覆盖：
 * - 顺序音符 → on/off 成对、atSeconds 单调
 * - velocity 归一化 0-1 → MIDI 原始 0-127（下限 1）
 * - 起点过滤：过去已结束音符丢弃、跨起点长音仅留 off、恰在起点起音保留 on
 * - 同刻 off 排在 on 之前（防同音重触发被同刻 off 掐断）
 * - 纯函数语义：同输入同输出、不改入参
 *
 * 时间轴基准：TempoMap.default() = 120bpm / 4/4 → 1 beat = 60/120 = 0.5s。
 * 所有期望数值均由公式推导（见注释），不使用魔法数。
 */
import { describe, it, expect } from 'vitest';
import { createNoteEvent, TempoMap, type NoteEvent } from '@collinx/core';
import { buildPlaybackEvents, buildClickEvents } from '../midi-schedule';

function mkNote(
  partial: Partial<NoteEvent> & Pick<NoteEvent, 'trackId' | 'bar' | 'beat'>
): NoteEvent {
  return createNoteEvent(partial);
}

// 120bpm / 4/4：四分音符 = 1 beat = 60/120 = 0.5s
const BEAT_SECONDS = 60 / 120;

describe('buildPlaybackEvents (S0-T01~T03)', () => {
  const tempoMap = TempoMap.default();

  it('T01: 3 音符顺序 → 6 事件；atSeconds 单调、on/off 成对、velocity=round(v*127) (critical)', () => {
    const notes = [
      mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: 0.8 }),
      mkNote({ trackId: 't', bar: 1, beat: 2, durQn: 1, pitchMidi: 62, velocity: 0.5 }),
      mkNote({ trackId: 't', bar: 1, beat: 3, durQn: 0.5, pitchMidi: 64, velocity: 1 }),
    ];

    const events = buildPlaybackEvents(notes, tempoMap, { bar: 1, beat: 1 });

    // velocity 换算：round(v*127) → 0.8→101.6→102、0.5→63.5→64、1→127
    const v60 = 102;
    const v62 = 64;
    const v64 = 127;

    // 时间：note1 on@0 / off@0+1*0.5=0.5
    //       note2 on@0.5 / off@0.5+1*0.5=1.0
    //       note3 on@1.0 / off@1.0+0.5*0.5=1.25
    expect(events).toEqual([
      { atSeconds: 0 * BEAT_SECONDS, kind: 'on', pitchMidi: 60, velocity: v60 },
      { atSeconds: 1 * BEAT_SECONDS, kind: 'off', pitchMidi: 60, velocity: v60 },
      { atSeconds: 1 * BEAT_SECONDS, kind: 'on', pitchMidi: 62, velocity: v62 },
      { atSeconds: 2 * BEAT_SECONDS, kind: 'off', pitchMidi: 62, velocity: v62 },
      { atSeconds: 2 * BEAT_SECONDS, kind: 'on', pitchMidi: 64, velocity: v64 },
      { atSeconds: 2.5 * BEAT_SECONDS, kind: 'off', pitchMidi: 64, velocity: v64 },
    ]);

    // 单调不减
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.atSeconds).toBeGreaterThanOrEqual(events[i - 1]!.atSeconds);
    }
    // on / off 数量相等（每音符成对）
    const onCount = events.filter((e) => e.kind === 'on').length;
    const offCount = events.filter((e) => e.kind === 'off').length;
    expect(onCount).toBe(3);
    expect(offCount).toBe(3);
  });

  it('T01b: velocity 归一化 0-1 → MIDI 原始值，下限 1（note-on velocity 0 ≡ note-off）', () => {
    const velAt = (v: number): number =>
      buildPlaybackEvents(
        [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: v })],
        tempoMap,
        { bar: 1, beat: 1 }
      )[0]!.velocity;

    // round(v*127) 后 clamp [1,127]（下限 1：MIDI 惯例 note-on velocity=0 ≡ note-off）
    expect(velAt(0)).toBe(1);
    expect(velAt(-0.5)).toBe(1);
    expect(velAt(0.5)).toBe(64);
    expect(velAt(1)).toBe(127);
    expect(velAt(2)).toBe(127);
  });

  it('T-S4-5a: 非有限 velocity（NaN/±Infinity）→ 输出有限整数 [1,127]（防御；有限输入不变） (critical)', () => {
    const mk = (v: number) =>
      buildPlaybackEvents(
        [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: v })],
        tempoMap,
        { bar: 1, beat: 1 }
      );
    for (const v of [NaN, Infinity, -Infinity]) {
      const evs = mk(v);
      expect(evs.length).toBeGreaterThan(0);
      for (const e of evs) {
        expect(Number.isFinite(e.velocity)).toBe(true);
        expect(Number.isInteger(e.velocity)).toBe(true);
        expect(e.velocity).toBeGreaterThanOrEqual(1);
        expect(e.velocity).toBeLessThanOrEqual(127);
      }
    }
    // 有限输入不变（回归 T01b）
    expect(mk(0.8)[0]!.velocity).toBe(102);
    expect(mk(0)[0]!.velocity).toBe(1);
    expect(mk(1)[0]!.velocity).toBe(127);
  });

  it('T01c: 纯函数——不改入参、同输入同输出', () => {
    const notes = [
      mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: 0.8 }),
      mkNote({ trackId: 't', bar: 1, beat: 2, durQn: 0.5, pitchMidi: 67, velocity: 0.3 }),
    ];
    const from = { bar: 1, beat: 1 };
    const notesSnapshot = JSON.stringify(notes);
    const fromSnapshot = JSON.stringify(from);

    const a = buildPlaybackEvents(notes, tempoMap, from);
    const b = buildPlaybackEvents(notes, tempoMap, from);

    expect(JSON.stringify(notes)).toBe(notesSnapshot);
    expect(JSON.stringify(from)).toBe(fromSnapshot);
    expect(a).toEqual(b);
  });

  it('T02: 从 {bar:2,beat:1} 起播——过去已结束音符零事件、跨起点长音仅产 off、恰在起点保留 on (critical)', () => {
    // bar2 起点 = timeAt(2,1) = 4 拍 * 0.5s = 2.0s
    const bar2Start = tempoMap.timeAt(2, 1);
    expect(bar2Start).toBe(4 * BEAT_SECONDS);

    const ended = mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: 0.8 });
    // 跨起点长音：on@0 < 2.0 且 off@0+8*0.5=4.0 > 2.0 → 仅留 off@4.0
    const crossing = mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 8, pitchMidi: 62, velocity: 0.8 });
    // 恰在起点起音：on@2.0 === fromSeconds → 保留 on（不落入"跨起点"分支）
    const atStart = mkNote({ trackId: 't', bar: 2, beat: 1, durQn: 1, pitchMidi: 64, velocity: 0.8 });

    const events = buildPlaybackEvents([ended, crossing, atStart], tempoMap, { bar: 2, beat: 1 });

    expect(events).toEqual([
      { atSeconds: 4 * BEAT_SECONDS, kind: 'on', pitchMidi: 64, velocity: 102 },
      { atSeconds: 5 * BEAT_SECONDS, kind: 'off', pitchMidi: 64, velocity: 102 },
      { atSeconds: 8 * BEAT_SECONDS, kind: 'off', pitchMidi: 62, velocity: 102 },
    ]);
    // 已结束音符（pitch 60）零事件
    expect(events.some((e) => e.pitchMidi === 60)).toBe(false);
    // 跨起点长音只产 off，不产 on
    expect(events.filter((e) => e.pitchMidi === 62).map((e) => e.kind)).toEqual(['off']);
  });

  it('T03: 同刻 off 与 on 并存时 off 排序在前 (critical)', () => {
    const note1 = mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: 0.8 });
    // note2 于 note1 结束同刻（0.5s）起音
    const note2 = mkNote({ trackId: 't', bar: 1, beat: 2, durQn: 1, pitchMidi: 62, velocity: 0.8 });

    const events = buildPlaybackEvents([note1, note2], tempoMap, { bar: 1, beat: 1 });

    expect(events).toHaveLength(4);
    // 同刻 0.5s：off(60) 必须排在 on(62) 之前
    expect(events[1]).toEqual({
      atSeconds: BEAT_SECONDS,
      kind: 'off',
      pitchMidi: 60,
      velocity: 102,
    });
    expect(events[2]).toEqual({
      atSeconds: BEAT_SECONDS,
      kind: 'on',
      pitchMidi: 62,
      velocity: 102,
    });
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 3（S3-T19）：buildClickEvents 节拍器 click 纯函数（D3-1）。
//   - 4/4 一小节 4 拍 → 4 事件
//   - note 序列 [34,33,33,33]（强拍 34 / 弱拍 33，A1）
//   - 通道 === 9（GM 打击乐通道 10，0-based）
//   - 相邻间隔 = 60/bpm 秒（由 TempoMap.timeAt 逐拍推进）
//   - 强拍力度 > 弱拍力度（均有限整数、区间 [1,127]）
// ---------------------------------------------------------------------------

describe('buildClickEvents (S3-T19)', () => {
  const tempoMap = TempoMap.default(); // 120bpm / 4/4 → 1 beat = 0.5s

  it('T19: 4/4 一小节 4 拍 → 4 事件、[34,33,33,33]、通道 9、间隔 = 60/bpm (critical)', () => {
    const events = buildClickEvents(
      tempoMap,
      { bar: 1, beat: 1 },
      4,
      { numerator: 4, denominator: 4 }
    );

    // 4 拍 → 4 事件
    expect(events).toHaveLength(4);

    // note 序列：强拍(每小节第 1 拍) 34、其余 33（A1 决策）
    expect(events.map((e) => e.pitchMidi)).toEqual([34, 33, 33, 33]);

    // 通道：显式带 9（GM 打击乐通道 10，0-based）
    for (const e of events) {
      expect(e.channel).toBe(9);
    }

    // 绝对秒由 timeAt 逐拍推进：atSeconds = [0, 0.5, 1.0, 1.5]
    const expectedSeconds = [0, 0.5, 1.0, 1.5];
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.atSeconds).toBeCloseTo(expectedSeconds[i]!, 6);
    }

    // 相邻间隔 = 60/bpm = 0.5s（手算断言，不依赖魔法数）
    const interval = 60 / 120;
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.atSeconds - events[i - 1]!.atSeconds).toBeCloseTo(interval, 6);
    }

    // 力度：强拍 > 弱拍，且均为有限整数、区间 [1,127]
    expect(events[0]!.velocity).toBeGreaterThan(events[1]!.velocity);
    for (const e of events) {
      expect(Number.isFinite(e.velocity)).toBe(true);
      expect(Number.isInteger(e.velocity)).toBe(true);
      expect(e.velocity).toBeGreaterThanOrEqual(1);
      expect(e.velocity).toBeLessThanOrEqual(127);
    }

    // kind 均为 on（节拍器靠鼓组衰减收尾，不产 off）
    expect(events.every((e) => e.kind === 'on')).toBe(true);
  });

  it('T19b: 跨小节 count-in（countInBars=1 @ 4/4）→ 8 拍、第 5 拍为强拍（下一小节第 1 拍）', () => {
    const events = buildClickEvents(
      tempoMap,
      { bar: 1, beat: 1 },
      8,
      { numerator: 4, denominator: 4 }
    );
    expect(events).toHaveLength(8);
    // 第 1、5 拍为强拍（34），其余弱拍（33）
    expect(events.map((e) => e.pitchMidi)).toEqual([34, 33, 33, 33, 34, 33, 33, 33]);
    // 间隔恒定 0.5s
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.atSeconds - events[i - 1]!.atSeconds).toBeCloseTo(0.5, 6);
    }
  });

  it('T19c: 纯函数——不改入参、同输入同输出', () => {
    const from = { bar: 1, beat: 1 };
    const fromSnapshot = JSON.stringify(from);
    const a = buildClickEvents(tempoMap, from, 4, { numerator: 4, denominator: 4 });
    const b = buildClickEvents(tempoMap, from, 4, { numerator: 4, denominator: 4 });
    expect(JSON.stringify(from)).toBe(fromSnapshot);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 4（S4）：S3 验证期定点修复（D-s4）。
//   T-S4-3 — P3：buildClickEvents 逐小节取 tempoMap.meterAt(bar) 推导每拍；
//            拍号变化时（4/4→3/4）旧实现以单 meter 恒推 beatsPerBar 错位，
//            跨变拍处的强/弱拍判定错误。构造变拍 TempoMap 验证（签名不变，
//            4/4 下结果与 T19/T19b 逐字相同）。
//   T-S4-5a/b — P3：buildPlaybackEvents 对非有限 velocity 输出有限 integer
//            ∈[1,127]；有限输入结果完全不变。
// ---------------------------------------------------------------------------

describe('buildClickEvents 变拍 + buildPlaybackEvents 非有限 velocity（v2.0.0 S4 / T-S4-3 / T-S4-5）', () => {
  // 变拍 TempoMap：bar1=4/4、bar2=3/4（120bpm 恒速 → 1 beat = 0.5s）
  const mixed = new TempoMap(
    [],
    [
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 3, denominator: 4 },
    ]
  );

  it('T-S4-3: 4/4→3/4 变拍 —— 从 bar2(3/4) 起 4 拍，跨变拍强拍判定正确 (critical)', () => {
    // 变拍前：timeAt(2,1) = 4*0.5 = 2.0s；bar2(3/4) 仅 3 拍 → timeAt(3,1) = 2.0+3*0.5 = 3.5s。
    // 从 bar2 beat1 起 4 拍 = bar2(1,2,3) + bar3 beat1（下一小节强拍）。
    const events = buildClickEvents(mixed, { bar: 2, beat: 1 }, 4);
    expect(events).toHaveLength(4);
    // 强拍（每小节第 1 拍）= bar2:1 与 bar3:1 → pitch 34；弱拍 → 33
    expect(events.map((e) => e.pitchMidi)).toEqual([34, 33, 33, 34]);
    // 通道恒为 GM 打击乐 9
    for (const e of events) expect(e.channel).toBe(9);
    // 绝对秒由 timeAt 逐拍推进（跨变拍仍连续单调）
    const expected = [2.0, 2.5, 3.0, 3.5];
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.atSeconds).toBeCloseTo(expected[i]!, 6);
    }
  });

  it('T-S4-3b: 4/4 下结果逐字等于旧行为（回归 T19/T19b）', () => {
    const tm4 = TempoMap.default();
    const ev4 = buildClickEvents(tm4, { bar: 1, beat: 1 }, 4, {
      numerator: 4,
      denominator: 4,
    });
    expect(ev4.map((e) => e.pitchMidi)).toEqual([34, 33, 33, 33]);
    expect(ev4.map((e) => e.atSeconds)).toEqual([0, 0.5, 1.0, 1.5]);
    const ev8 = buildClickEvents(tm4, { bar: 1, beat: 1 }, 8, {
      numerator: 4,
      denominator: 4,
    });
    expect(ev8.map((e) => e.pitchMidi)).toEqual([
      34, 33, 33, 33, 34, 33, 33, 33,
    ]);
  });

  it('T-S4-5a: buildPlaybackEvents 非有限 velocity → 有限 integer ∈[1,127]（NaN/±Infinity）', () => {
    const tm = TempoMap.default();
    for (const v of [NaN, Infinity, -Infinity] as number[]) {
      const events = buildPlaybackEvents(
        [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: v })],
        tm,
        { bar: 1, beat: 1 }
      );
      for (const e of events) {
        expect(Number.isFinite(e.velocity)).toBe(true);
        expect(Number.isInteger(e.velocity)).toBe(true);
        expect(e.velocity).toBeGreaterThanOrEqual(1);
        expect(e.velocity).toBeLessThanOrEqual(127);
      }
    }
  });

  it('T-S4-5b: buildPlaybackEvents 有限输入结果完全不变（回归 T01b）', () => {
    const tm = TempoMap.default();
    const velAt = (v: number): number =>
      buildPlaybackEvents(
        [mkNote({ trackId: 't', bar: 1, beat: 1, durQn: 1, pitchMidi: 60, velocity: v })],
        tm,
        { bar: 1, beat: 1 }
      )[0]!.velocity;
    expect(velAt(0)).toBe(1);
    expect(velAt(0.5)).toBe(64);
    expect(velAt(1)).toBe(127);
    expect(velAt(2)).toBe(127);
  });
});
