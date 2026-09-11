/**
 * MIDI 输入消息解析 service (v1.25.0 Stage 0 / D1-1)
 *
 * 纯函数：解析 Web MIDI MIDIMessageEvent.data 字节流，与 React / DOM 解耦、
 * 独立可测。不修改入参、无副作用、不 throw。
 *
 * 字节语义（midi.org MIDI 1.0）：
 * - data[0] = status：高半字节为消息类型，低 4 位为 channel（0-15）
 * - data[1] = note（7 bit，0-127）
 * - data[2] = velocity（7 bit，0-127）
 * - 0x8n = Note Off；0x9n = Note On；velocity=0 的 Note On 按行业惯例
 *   视作 Note Off（部分键盘只发这种）——双路处理
 * - 其余 status（0xAn / 0xBn / 0xCn / 0xDn / 0xEn / 0xFn）→ other
 */

export type MidiMessageType = 'noteon' | 'noteoff' | 'other';

export interface ParsedMidiMessage {
  type: MidiMessageType;
  /** data[1]，0-127 */
  note: number;
  /** data[2]，0-127；velocity=0 的 Note On 判定为 noteoff 时保留原值 0 */
  velocity: number;
  /** status 低 4 位，0-15 */
  channel: number;
}

/**
 * 解析一条 MIDI 消息。
 * data.length < 3（Running Status 等非完整消息）→ null，不 throw。
 */
export function parseMidiMessage(data: Uint8Array): ParsedMidiMessage | null {
  if (data.length < 3) {
    return null;
  }

  const status = data[0];
  const kind = status >> 4;
  const note = data[1];
  const velocity = data[2];
  const channel = status & 0x0f;

  if (kind === 0x8) {
    return { type: 'noteoff', note, velocity, channel };
  }
  if (kind === 0x9) {
    if (velocity > 0) {
      return { type: 'noteon', note, velocity, channel };
    }
    // velocity=0 的 Note On 视作 Note Off（行业惯例）
    return { type: 'noteoff', note, velocity, channel };
  }
  return { type: 'other', note, velocity, channel };
}
