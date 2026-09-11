/**
 * MIDI 输入 hook (v1.25.0 Stage 0 / D1-2；v1.26.0 扩展 timeStamp)
 *
 * 读取 settings.midi.midiDevice.input 的 deviceId，绑定对应 MIDIInput 端口，
 * 将 onmidimessage 解析结果（services/midi-input.parseMidiMessage）分发到
 * onNoteOn / onNoteOff 回调。
 *
 * timeStamp 语义（v1.26.0）：onNoteOn / onNoteOff 第三参透传
 * event.timeStamp（DOMHighResTimeStamp 毫秒）。Web MIDI 规范强制其值为
 * "系统接收到该消息的时刻"（继承自 DOM Event；规范中 MIDIMessageEvent
 * 无 receivedTime 属性，Wad.js 用法是 2015 草案遗留）。量化精度即此
 * 接收时刻，非应用处理时刻。jsdom / 异常场景下 timeStamp 缺失或非
 * 有限数时，以 performance.now() 兜底。
 *
 * 失败语义（对齐 v1.24 device-enumeration 风格，全程静默不 throw）：
 * - navigator.requestMIDIAccess 缺失（不支持 Web MIDI / jsdom）→ 不绑定
 * - requestMIDIAccess reject（权限拒绝等）→ 静默 catch
 * - deviceId 空 / !enabled / inputs 中无匹配端口 → 不绑定
 *
 * 清理与重绑：卸载或 [deviceId, enabled] 变更时先解绑旧端口
 * （port.onmidimessage = null）并移除 statechange 监听
 * （access.onstatechange = null）再重绑。回调经 useRef 包裹，
 * 回调引用变化不触发 effect 重绑。
 */

import { useEffect, useRef } from 'react';
import { useSettings } from './useSettings';
import { parseMidiMessage } from '../services/midi-input';

export interface UseMidiInputOptions {
  /** 默认 true */
  enabled?: boolean;
  /** 第三参 timeStamp：系统接收到消息的时刻（ms），见头部 JSDoc */
  onNoteOn?: (note: number, velocity: number, timeStamp: number) => void;
  onNoteOff?: (note: number, timeStamp: number) => void;
}

/** MIDIInput 最小结构（避免依赖 lib.dom 的 Web MIDI 类型）。
 *  onmidimessage 的 (event: never) => any 变体用于结构兼容 lib.dom 的
 *  MIDIInput（其 handler 形参为 MIDIMessageEvent，超集事件类型经参数逆变
 *  无法直接赋给 {data: Uint8Array} 形参；never 形参可接受任何 handler）。
 *  本 hook 只写不读该属性，运行时行为不变。 */
interface MidiInputPortLike {
  id: string;
  state?: string;
  onmidimessage:
    | ((event: { data: Uint8Array }) => void)
    | ((event: never) => any)
    | null;
}

interface MidiAccessLike {
  inputs: { values(): Iterable<MidiInputPortLike> };
  /** (event: never) => any 变体兼容 lib.dom MIDIAccess.onstatechange
   *  （形参 MIDIConnectionEvent，参数逆变同上）；本 hook 只写不读。 */
  onstatechange: (() => void) | ((event: never) => any) | null;
}

type RequestMidiAccess = (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;

export function useMidiInput(options: UseMidiInputOptions = {}): void {
  const { enabled = true, onNoteOn, onNoteOff } = options;

  const deviceId = useSettings().settings.midi.midiDevice.input;

  // 回调用 ref 包裹：避免回调引用变化导致 effect 频繁解绑/重绑
  const onNoteOnRef = useRef(onNoteOn);
  const onNoteOffRef = useRef(onNoteOff);
  onNoteOnRef.current = onNoteOn;
  onNoteOffRef.current = onNoteOff;

  useEffect(() => {
    if (!enabled || !deviceId) {
      return;
    }

    let cancelled = false;
    let access: MidiAccessLike | null = null;
    let boundPort: MidiInputPortLike | null = null;

    const handleMidiMessage = (event: {
      data: Uint8Array;
      timeStamp?: number;
    }): void => {
      const parsed = parseMidiMessage(event.data);
      if (!parsed) {
        return;
      }
      // Web MIDI 规范：timeStamp = 系统接收到消息的时刻；缺失时兜底
      const ts =
        typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp)
          ? event.timeStamp
          : performance.now();
      if (parsed.type === 'noteon') {
        onNoteOnRef.current?.(parsed.note, parsed.velocity, ts);
      } else if (parsed.type === 'noteoff') {
        onNoteOffRef.current?.(parsed.note, ts);
      }
      // other → 忽略
    };

    const bindPort = (port: MidiInputPortLike): void => {
      port.onmidimessage = handleMidiMessage;
      boundPort = port;
    };

    const unbindPort = (): void => {
      if (boundPort) {
        boundPort.onmidimessage = null;
        boundPort = null;
      }
    };

    // 依据 access 当前状态重新评估绑定：断连 → 解绑；重连 → 重绑
    const syncBinding = (a: MidiAccessLike): void => {
      let target: MidiInputPortLike | undefined;
      for (const port of a.inputs.values()) {
        if (port.id === deviceId) {
          target = port;
          break;
        }
      }
      if (target && target.state !== 'disconnected') {
        bindPort(target);
      } else {
        unbindPort();
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
        a.onstatechange = () => syncBinding(a);
      })
      .catch(() => {
        // 权限拒绝等 → 静默
      });

    return () => {
      cancelled = true;
      if (access) {
        access.onstatechange = null;
      }
      unbindPort();
    };
  }, [deviceId, enabled]);
}
