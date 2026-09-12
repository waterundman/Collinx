/**
 * MIDI 输出 hook (v1.29.0 Stage 0 / D1-2)
 *
 * 读取 settings.midi.midiDevice.output 的 deviceId，绑定对应 MIDIOutput 端口，
 * 提供 playNote(note, velocity, durationMs) —— 点击音符即出声的最小闭环
 * （v1.29.0 首次真实消费 output 设置；与未来 C++ 引擎回放不冲突）。
 *
 * 编码与调度语义：
 * - 字节流由 services/midi-output.encodeNoteOn / encodeNoteOff 生成（纯函数）
 * - noteOn 立即发送（send 省略 timestamp）；noteOff 以
 *   performance.now() + durationMs 作为 timestamp 调度 —— Web MIDI 规范中
 *   timestamp 为 DOMHighResTimeStamp 绝对时刻，过去值/省略 = 立即发送
 *   （webmidi.js options.time 同语义）；由端口/驱动端调度，避免 setTimeout 抖动
 * - 设备通道换算：settings.midi.midiChannel 为 1-16（人类语义），编码前 -1
 *   转为 MIDI status 低 4 位的 0-15（hook 内完成，service 只接受 0-15）
 *
 * 失败语义（对齐 useMidiInput，全程静默不 throw）：
 * - navigator.requestMIDIAccess 缺失（不支持 Web MIDI / jsdom）→ 不绑定
 * - requestMIDIAccess reject（权限拒绝等）→ 静默 catch
 * - deviceId 空 / outputs 中无匹配端口 / 端口 disconnected → 不绑定
 * - playNote 无绑定端口 → 静默 no-op
 *
 * 清理与重绑：卸载或 [deviceId, channel] 变更时移除 statechange 监听，
 * 并对已绑定端口 clear()（取消已调度未发出的消息）+ 逐条补发 noteOff ——
 * clear() 无法取消已经发出的 noteOn，不补发 noteOff 会留卡音。
 *
 * 多音补发（v1.29.0 D2-4，S0 验证登记的 P2 缺陷清偿）：已发出的音符以
 * note → 已换算 channel 的 Map 记录（同名 note 重复播放时 set 覆盖，旧
 * noteOff 仍在队列中，语义可接受）。清理时遍历 Map 逐条补发，避免"300ms
 * 内连点多个音后立刻卸载/切设备，clear() 取消除最后一条外的全部 noteOff
 * → 卡音"。顺序裁决：先 clear() 再补发 —— clear() 只清空"尚未发出"的
 * 待发队列（含已调度 noteOff），随后无 timestamp 的 send 为立即发送，
 * 必不被本次 clear 取消；若先补发再 clear 则补发消息可能仍在待队列中被
 * 一并取消，故取"先 clear 后补发"。
 *
 * 登记取舍：noteOff 自然到期（300ms 后）不会从 Map 删除条目，故卸载时可能
 * 对已结束的音符补发一条冗余 noteOff（幂等，无副作用）。不引入清理策略
 * （定时删除 / 上限淘汰）以保持最小实现：试听场景同时按键数有限、Map 规模
 * 受同时发声音符数约束，量级可忽略。
 *
 * statechange 必须用 addEventListener('statechange', handler) 注册而非写
 * access.onstatechange 属性：Chrome 中多次 requestMIDIAccess 返回同一
 * MIDIAccess 对象，属性赋值会覆盖 useMidiInput 注册的 handler → 输入侧
 * 热插拔重绑失效。
 *
 * playNote 经 ref 读取端口与通道，引用稳定（deps 为空），不因渲染重建。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from './useSettings';
import { encodeNoteOn, encodeNoteOff } from '../services/midi-output';

export interface UseMidiOutputResult {
  /** 输出端口已绑定 */
  isAvailable: boolean;
  /** 立即发 noteOn，并在 performance.now() + durationMs 时刻调度 noteOff（timestamp 调度，无 setTimeout 抖动） */
  playNote: (note: number, velocity: number, durationMs: number) => void;
}

/** MIDIOutput 最小结构（避免依赖 lib.dom 的 Web MIDI 类型）。
 *  clear 可选：部分实现/旧浏览器无此方法。 */
interface MidiOutputPortLike {
  id: string;
  state?: string;
  send(data: Uint8Array, timestamp?: number): void;
  clear?(): void;
}

/** MIDIAccess 最小结构。
 *  addEventListener / removeEventListener 的 (type: string, handler: () => void)
 *  形参为 lib.dom EventTarget 签名的子集，结构兼容；本 hook 只注册/移除
 *  statechange，不写 onstatechange 属性（原因见文件头）。 */
interface MidiAccessLike {
  outputs: { values(): Iterable<MidiOutputPortLike> };
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

type RequestMidiAccess = (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;

export function useMidiOutput(): UseMidiOutputResult {
  const midiSettings = useSettings().settings.midi;
  const deviceId = midiSettings.midiDevice.output;
  const channel = midiSettings.midiChannel;

  const [isAvailable, setIsAvailable] = useState(false);

  // playNote 从 ref 读端口：设备热插拔/重绑不改变 playNote 引用
  const portRef = useRef<MidiOutputPortLike | null>(null);
  // 已发出的音符：note → 已换算 channel（0-15），供清理时逐条补发 noteOff 防卡音
  const soundingNotesRef = useRef<Map<number, number>>(new Map());
  // settings 通道为 1-16，编码需要 0-15；每渲染同步，保证 playNote 引用稳定
  const channelRef = useRef(channel - 1);
  channelRef.current = channel - 1;

  useEffect(() => {
    if (!deviceId) {
      return;
    }

    let cancelled = false;
    let access: MidiAccessLike | null = null;
    let handleStateChange: (() => void) | null = null;

    // 依据 access 当前状态重新评估绑定：匹配 id 且未断连 → 绑定；否则解绑
    const syncBinding = (a: MidiAccessLike): void => {
      let target: MidiOutputPortLike | undefined;
      for (const port of a.outputs.values()) {
        if (port.id === deviceId) {
          target = port;
          break;
        }
      }
      if (target && target.state !== 'disconnected') {
        portRef.current = target;
        setIsAvailable(true);
      } else {
        portRef.current = null;
        setIsAvailable(false);
      }
    };

    const requestMIDIAccess =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { requestMIDIAccess?: RequestMidiAccess })
            .requestMIDIAccess
        : undefined;

    if (typeof requestMIDIAccess !== 'function') {
      return;
    }

    requestMIDIAccess({ sysex: false })
      .then((a) => {
        if (cancelled) {
          return;
        }
        access = a;
        syncBinding(a);
        handleStateChange = () => syncBinding(a);
        a.addEventListener('statechange', handleStateChange);
      })
      .catch(() => {
        // 权限拒绝等 → 静默
      });

    return () => {
      cancelled = true;
      if (access && handleStateChange) {
        access.removeEventListener('statechange', handleStateChange);
      }
      const port = portRef.current;
      if (port) {
        // 先 clear() 取消全部"已调度未发出"的消息（原生实现会一并取消各音
        // 的 noteOff），再逐条补发立即 noteOff —— 补发必不被本次 clear 取消。
        port.clear?.();
        for (const [note, channel] of soundingNotesRef.current) {
          try {
            port.send(encodeNoteOff(note, channel));
          } catch {
            // 静默
          }
        }
        soundingNotesRef.current.clear();
        portRef.current = null;
      }
      setIsAvailable(false);
    };
  }, [deviceId, channel]);

  const playNote = useCallback(
    (note: number, velocity: number, durationMs: number): void => {
      const port = portRef.current;
      if (!port) {
        return; // 静默 no-op
      }
      try {
        const ch = channelRef.current;
        port.send(encodeNoteOn(note, velocity, ch)); // 立即（省略 timestamp）
        const offAt = performance.now() + durationMs; // 绝对时刻
        port.send(encodeNoteOff(note, ch), offAt); // 调度
        // 同名 note 重复播放：set 覆盖（旧 noteOff 仍在队列，新 noteOff 亦调度）
        soundingNotesRef.current.set(note, ch);
      } catch {
        // 静默
      }
    },
    []
  );

  return { isAvailable, playNote };
}
