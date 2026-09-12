/**
 * MIDI 输出消息编码 service (v1.29.0 Stage 0 / D1-1)
 *
 * 纯函数：将音符语义编码为 Web MIDI 字节流，与 React / DOM 解耦、独立可测。
 * 不修改入参、无副作用、不 throw。
 *
 * 字节语义（midi.org MIDI 1.0）：
 * - data[0] = status：高半字节为消息类型，低 4 位为 channel（0-15）
 * - data[1] = note（7 bit，0-127）
 * - data[2] = velocity（7 bit，0-127）
 * - 0x8n = Note Off（velocity 惯例为 0）；0x9n = Note On
 * - 行业惯例：0x9n 且 velocity=0 被接收端视作 Note Off，故试听编码
 *   将 velocity 下限 clamp 至 1 —— 与 parseMidiMessage 的
 *   velocity=0 → noteoff 判定对偶（services/midi-input.ts）
 *
 * 与输入侧 parseMidiMessage 构成互逆对：encodeNoteOn/encodeNoteOff 的输出
 * 经 parseMidiMessage 解析可还原出 { type, note, velocity, channel }。
 */

/** Note Off 消息类型高半字节（1000nnnn） */
const NOTE_OFF_KIND = 0x80;
/** Note On 消息类型高半字节（1001nnnn） */
const NOTE_ON_KIND = 0x90;

/** 7 bit 取值范围 */
const NOTE_MIN = 0;
const NOTE_MAX = 127;

/** channel 0-15（status 低 4 位） */
const CHANNEL_MIN = 0;
const CHANNEL_MAX = 15;

/**
 * velocity 下限：MIDI 1.0 中 0x9n + velocity=0 ≡ Note Off，
 * 试听必须实际发声，故 clamp 至 1（而非 0）。
 */
const VELOCITY_MIN = 1;
const VELOCITY_MAX = 127;

/** 数值 clamp（NaN 经此仍为 NaN，最终由 Uint8Array 归一为 0，不 throw） */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 编码 Note On。
 *
 * - data[0] = 0x90 | clamp(channel, 0, 15)
 * - data[1] = clamp(round(note), 0, 127)
 * - data[2] = clamp(round(velocity), 1, 127) —— 下限 1，见文件头说明
 */
export function encodeNoteOn(
  note: number,
  velocity: number,
  channel: number
): Uint8Array {
  const status = NOTE_ON_KIND | clamp(Math.round(channel), CHANNEL_MIN, CHANNEL_MAX);
  const noteByte = clamp(Math.round(note), NOTE_MIN, NOTE_MAX);
  const velocityByte = clamp(Math.round(velocity), VELOCITY_MIN, VELOCITY_MAX);
  return new Uint8Array([status, noteByte, velocityByte]);
}

/**
 * 编码 Note Off（velocity 恒为 0，MIDI 1.0 惯例）。
 *
 * - data[0] = 0x80 | clamp(channel, 0, 15)
 * - data[1] = clamp(round(note), 0, 127)
 * - data[2] = 0
 */
export function encodeNoteOff(note: number, channel: number): Uint8Array {
  const status =
    NOTE_OFF_KIND | clamp(Math.round(channel), CHANNEL_MIN, CHANNEL_MAX);
  const noteByte = clamp(Math.round(note), NOTE_MIN, NOTE_MAX);
  return new Uint8Array([status, noteByte, 0]);
}
