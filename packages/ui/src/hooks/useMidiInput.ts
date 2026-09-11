/**
 * MIDI 输入 hook (v1.25.0 Stage 0 / D1-2)
 *
 * 读取 settings.midi.midiDevice.input 的 deviceId，绑定对应 MIDIInput 端口，
 * 将 onmidimessage 解析结果（services/midi-input.parseMidiMessage）分发到
 * onNoteOn / onNoteOff 回调。
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
  onNoteOn?: (note: number, velocity: number) => void;
  onNoteOff?: (note: number) => void;
}

/** MIDIInput 最小结构（避免依赖 lib.dom 的 Web MIDI 类型） */
interface MidiInputPortLike {
  id: string;
  state?: string;
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

interface MidiAccessLike {
  inputs: { values(): Iterable<MidiInputPortLike> };
  onstatechange: (() => void) | null;
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

    const handleMidiMessage = (event: { data: Uint8Array }): void => {
      const parsed = parseMidiMessage(event.data);
      if (!parsed) {
        return;
      }
      if (parsed.type === 'noteon') {
        onNoteOnRef.current?.(parsed.note, parsed.velocity);
      } else if (parsed.type === 'noteoff') {
        onNoteOffRef.current?.(parsed.note);
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
