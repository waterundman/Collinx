/**
 * MIDI 播放调度纯函数 (v2.0.0 Stage 0 / D0-1~D0-3)
 *
 * 将谱面 NoteEvent[] 编译为端口可直接投递的 ScheduledEvent[]（on/off 时间戳事件），
 * 与 React / DOM / Web MIDI 完全解耦、独立可测。纯函数：不 throw、不改入参、
 * 同输入同输出。
 *
 * 时间基准（D0-1 / D0-2）：
 * - 全部使用 TempoMap 的"谱面秒"时间轴（timeAt / barBeatAt / bpmAt），
 *   不新增任何时间数学。
 * - onSeconds = timeAt(note.bar, note.beat)
 * - offSeconds = onSeconds + durQn * (60 / bpmAt(note.bar, note.beat))
 *   其中 durQn 为四分音符数（1 beat ≡ 1 四分音符），(60 / bpm) 即该处每拍秒数，
 *   故二者相乘得到持续时长（秒）。
 *   【已知简化】单个音符跨度内的速度变化不做插值：当前 TempoMap 恒为常数速度，
 *   该简化无实际影响；若未来支持变速，需改为对跨度积分，留待后续版本。
 *
 * velocity（D0-1 / D0-3）：输出 MIDI 原始 0-127 值：
 *   Math.max(1, Math.min(127, Math.round(note.velocity * 127)))
 * 下限取 1 的依据：MIDI 1.0 惯例中 note-on 且 velocity=0 被接收端判定为 note-off，
 * 播放必须实际发声，故 clamp 至 1 —— 与 services/midi-output.encodeNoteOn 的
 * velocity 下限语义一致（见该文件头说明）。
 *
 * 起点过滤与排序（D0-2，本模块正确性核心）：
 * 1. offSeconds <= fromSeconds → 整个音符丢弃（已在过去结束）
 * 2. onSeconds < fromSeconds < offSeconds → 仅保留 off 事件（跨起点长音：
 *    起音已在过去，但仍在鸣响，须保留其结束点；不含 onSeconds === fromSeconds，
 *    该情形属"正好从起点起音"，落入第 3 类）
 * 3. 其余 → 保留 on 与 off 两个事件
 * 4. 按 atSeconds 升序稳定排序；atSeconds 相同时 off 排在 on 之前
 *    （防止同音重复起音的 on 被同刻的 off 提前掐断）
 */

import type { NoteEvent, TempoMap } from "@collinx/core";

/** 单个调度事件：端口按 atSeconds 换算时间戳后投递 */
export interface ScheduledEvent {
  /** 绝对秒（TempoMap 时间轴），on 为起音时刻、off 为结束时刻 */
  atSeconds: number;
  /** 事件类型：on = note on，off = note off */
  kind: "on" | "off";
  /** 音高（MIDI note number），原样取自 NoteEvent.pitchMidi */
  pitchMidi: number;
  /** 已换算为 MIDI 原始 0-127 的力度（下限 1，见文件头） */
  velocity: number;
  /**
   * v2.8.0：来源轨道 id（如 melody / bass / chords）。
   * 供内部合成器选音色用 —— MIDI 侧不需要它（通道已足够）。
   * 可选：count-in click 事件没有轨道。
   */
  trackId?: string;
  /**
   * 目标 MIDI 通道（0-15，可选）。
   * - count-in click 事件显式带 9（GM 打击乐通道 10，A1 决策，独立于
   *   settings.midi.midiChannel），使调用方无需隐式编码即可断言"通道 10"
   *   （T19 直接断言 channel === 9）。
   * - 音符事件省略本字段，由 useTransport 按 settings.midi.midiChannel
   *   解析（D0-4）；调度器投递时 `ev.channel ?? (channel - 1)` 兜底。
   */
  channel?: number;
}

/** GM 打击乐通道 10 的 0-based 通道号（A1 决策；节拍器独立于音符试听通道） */
export const CLICK_CHANNEL = 9;

/** 力度归一化下限：note-on velocity 0 在 MIDI 惯例中等价于 note-off */
const VELOCITY_MIN = 1;
const VELOCITY_MAX = 127;

/** 归一化 velocity（0-1）→ MIDI 原始 0-127，clamp [1,127] */
function toMidiVelocity(velocity: number): number {
  // 非有限防御：NaN / ±Infinity 穿过 Math.round 会成 NaN → 编成 0 → 静音。
  if (!Number.isFinite(velocity)) return VELOCITY_MIN;
  return Math.max(
    VELOCITY_MIN,
    Math.min(VELOCITY_MAX, Math.round(velocity * VELOCITY_MAX))
  );
}

/**
 * 将 notes 编译为自 from 位置起播的调度事件序列。
 *
 * @param notes   谱面音符（不被修改）
 * @param tempoMap 速度/拍号表（提供 timeAt / bpmAt 时间换算）
 * @param from    起播位置（bar/beat 均从 1 开始，不被修改）
 * @returns 按 atSeconds 升序的事件数组（同刻 off 在前）
 */
export function buildPlaybackEvents(
  notes: NoteEvent[],
  tempoMap: TempoMap,
  from: { bar: number; beat: number }
): ScheduledEvent[] {
  const fromSeconds = tempoMap.timeAt(from.bar, from.beat);
  const events: ScheduledEvent[] = [];

  for (const note of notes) {
    const onSeconds = tempoMap.timeAt(note.bar, note.beat);
    // (60 / bpm) = 每拍秒数；durQn 为四分音符数（1 beat ≡ 1 四分音符）
    const secondsPerBeat = 60 / tempoMap.bpmAt(note.bar, note.beat);
    const offSeconds = onSeconds + note.durQn * secondsPerBeat;
    const velocity = toMidiVelocity(note.velocity);

    if (offSeconds <= fromSeconds) {
      // 已在过去结束 → 丢弃整个音符
      continue;
    }

    if (onSeconds < fromSeconds) {
      // 跨起点长音：起音已过去，仅保留结束点
      events.push({
        atSeconds: offSeconds,
        kind: "off",
        pitchMidi: note.pitchMidi,
        velocity,
        // v2.8.0：跨起点分支也要带 trackId —— 漏了会让这条音符在播放时
        // 用兜底音色（lead）而不是它自己的音色，听感上"从中间开始的那条
        // 长音突然换了音色"。测试 T03 专门守这一点。
        trackId: note.trackId,
      });
      continue;
    }

    // 起音在起点之后（或恰在起点）→ on 与 off 均保留
    events.push({
      atSeconds: onSeconds,
      kind: "on",
      pitchMidi: note.pitchMidi,
      velocity,
      trackId: note.trackId,
    });
    events.push({
      atSeconds: offSeconds,
      kind: "off",
      pitchMidi: note.pitchMidi,
      velocity,
      trackId: note.trackId,
    });
  }

  // 升序稳定排序；Array.prototype.sort 自 ES2019 起保证稳定，
  // 同 kind 同刻保持原始遍历顺序，同刻 off 优先于 on。
  events.sort((a, b) => {
    if (a.atSeconds !== b.atSeconds) {
      return a.atSeconds - b.atSeconds;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === "off" ? -1 : 1;
  });

  return events;
}

/**
 * 节拍器 click 事件编译（v2.0.0 Stage 3 / D3-1，S3-T19）
 *
 * 与 buildPlaybackEvents 同风格：纯函数、不 throw / 不改入参、独立可测；
 * 在既有 TempoMap 时间轴上**逐拍推进**，不自行做 bpm 连乘（SPEC D3-1）。
 *
 * 决策（A1 / SPEC §S3 D3-1）：
 * - GM 打击乐通道 10（0-based 9）：节拍器独立于 `settings.midi.midiChannel`
 *   （后者默认 1 用于音符试听）。返回事件**显式带 channel = 9**，使调用方
 *   无需隐式编码即可断言"通道 10"（T19 直接断言 channel === 9）。
 * - 强拍（每小节第 1 拍）note = 34（Metronome Bell）；其余拍 note = 33
 *   （Metronome Click）。力度：强拍 > 弱拍（均有限整数、区间 [1,127]）。
 * - 绝对秒由 `tempoMap.timeAt` 自 `from` 逐拍推进：第 k 拍位置 = `from`
 *   前进 k 拍，atSeconds = timeAt(bar_k, beat_k)。beatsPerBar 由 meter 推出
 *   （numerator * 4 / denominator）；meter 缺省按 4/4。
 * - 每个拍产一个 on 事件（kind:'on'）。节拍器为 GM 打击乐，音符一经 noteOn
 *   即触发、靠鼓组自带衰减收尾（noteOff 对打击乐非必需），故不额外产 off
 *   事件；stop()/pause() 中断时由 useTransport.allSoundOff 统一补 noteOff
 *   防卡音（click 的 noteOn 进入在鸣 Map，见 useTransport 抗卡音设计）。
 */
export const CLICK_STRONG_VELOCITY = 120;
export const CLICK_WEAK_VELOCITY = 90;

export function buildClickEvents(
  tempoMap: TempoMap,
  from: { bar: number; beat: number },
  beats: number,
  meter?: { numerator: number; denominator: number }
): ScheduledEvent[] {
  // 注：meter 形参保留为对外兼容（D3-1 既有签名：T19/T19b 仍按 4/4 传参，
  // 本文件回归门要求签名与断言逐字不变）。拍号位置现由 tempoMap.meterAt(bar)
  // 逐小节推导 —— 旧实现以单个传入 meter 恒推 beatsPerBar，跨拍号变化处
  // 强/弱拍判定错位（见 S4-T-S4-3）。4/4 下 meterAt 恒 4/4，结果与旧行为逐字相同。
  const count = Math.max(0, Math.floor(beats));
  const events: ScheduledEvent[] = [];

  // 逐拍推进：每拍依据其所在小节的 meter（tempoMap.meterAt）判定强/弱拍与进位。
  let bar = from.bar;
  let beat = from.beat; // 当前拍（1-based），从 from.beat 起
  for (let k = 0; k < count; k++) {
    const m = tempoMap.meterAt(bar);
    const beatsPerBar = m.numerator * (4 / m.denominator);
    const isDownbeat = beat === 1;
    const atSeconds = tempoMap.timeAt(bar, beat);
    events.push({
      atSeconds,
      kind: "on",
      pitchMidi: isDownbeat ? 34 : 33,
      velocity: isDownbeat ? CLICK_STRONG_VELOCITY : CLICK_WEAK_VELOCITY,
      channel: CLICK_CHANNEL,
    });
    // 前进一拍，越过本小节末尾则进位到下一小节第 1 拍
    beat += 1;
    if (beat > beatsPerBar) {
      beat = 1;
      bar += 1;
    }
  }

  // 逐拍推进 → atSeconds 已单调不减；稳定排序保险（同刻 off 优先于 on，
  // 与 buildPlaybackEvents 一致，click 仅 on 故此处 off 分支不会触发）。
  events.sort((a, b) => {
    if (a.atSeconds !== b.atSeconds) {
      return a.atSeconds - b.atSeconds;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === "off" ? -1 : 1;
  });

  return events;
}
