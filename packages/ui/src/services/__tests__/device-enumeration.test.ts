/**
 * S0-T01~T06: device-enumeration service 单测
 * 音频（Web Audio enumerateDevices）与 MIDI（Web MIDI requestMIDIAccess）
 * 枚举的映射、降级与三态 permission 语义。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  enumerateAudioDevices,
  enumerateMidiDevices,
} from '../device-enumeration';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── D2-1: enumerateAudioDevices ──
describe('enumerateAudioDevices (S0-T01~T03)', () => {
  it('S0-T01: 2 audioinput + 1 audiooutput → 字段映射正确 (critical)', async () => {
    const rawDevices = [
      {
        deviceId: 'in-1',
        kind: 'audioinput',
        label: 'Focusrite Scarlett 2i2',
        groupId: 'g1',
        toJSON() {},
      },
      {
        deviceId: 'in-2',
        kind: 'audioinput',
        label: 'Built-in Microphone',
        groupId: 'g2',
        toJSON() {},
      },
      {
        deviceId: 'out-1',
        kind: 'audiooutput',
        label: 'Default - Speakers',
        groupId: 'g3',
        toJSON() {},
      },
    ];
    const enumerateDevices = vi.fn().mockResolvedValue(rawDevices);
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } });

    const result = await enumerateAudioDevices();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    expect(result.permission).toBe('granted');
    expect(result.input).toHaveLength(2);
    expect(result.output).toHaveLength(1);

    expect(result.input[0]).toEqual({
      id: 'in-1',
      name: 'Focusrite Scarlett 2i2',
      isDefault: false,
    });
    expect(result.input[1]).toEqual({
      id: 'in-2',
      name: 'Built-in Microphone',
      isDefault: false,
    });
    expect(result.output[0]).toEqual({
      id: 'out-1',
      name: 'Default - Speakers',
      isDefault: true,
    });
    // MediaDeviceInfo 无 manufacturer 字段 → 省略
    expect(result.input[0].manufacturer).toBeUndefined();
  });

  it('S0-T02: 无授权（label 空串）→ name 降级 / id 占位; "Default -"/"默认 -" 前缀 → isDefault (critical)', async () => {
    const rawDevices = [
      // 无授权：deviceId 与 label 均为空串
      { deviceId: '', kind: 'audioinput', label: '', groupId: 'g1', toJSON() {} },
      // "Default - ..." 前缀
      {
        deviceId: 'd2',
        kind: 'audioinput',
        label: 'Default - Microphone (Realtek)',
        groupId: 'g2',
        toJSON() {},
      },
      // "默认 - ..." 前缀
      { deviceId: 'd3', kind: 'audioinput', label: '默认 - 麦克风', groupId: 'g3', toJSON() {} },
    ];
    vi.stubGlobal('navigator', {
      mediaDevices: { enumerateDevices: vi.fn().mockResolvedValue(rawDevices) },
    });

    const result = await enumerateAudioDevices();

    expect(result.permission).toBe('granted');
    expect(result.input).toHaveLength(3);

    // name 降级为空串（调用方补 i18n 文案），id 降级为占位序号
    expect(result.input[0]).toEqual({
      id: 'unknown-audioinput-0',
      name: '',
      isDefault: false,
    });
    // isDefault 前缀判定（en / zh 两种惯例）
    expect(result.input[1].isDefault).toBe(true);
    expect(result.input[2].isDefault).toBe(true);
  });

  it('S0-T03: navigator.mediaDevices undefined → unavailable, 不 throw (critical)', async () => {
    vi.stubGlobal('navigator', {});

    await expect(enumerateAudioDevices()).resolves.toEqual({
      input: [],
      output: [],
      permission: 'unavailable',
    });
  });
});

// ── D2-2: enumerateMidiDevices ──
describe('enumerateMidiDevices (S0-T04~T06)', () => {
  it('S0-T04: MIDIPort 映射正确, isAvailable = state === "connected" (critical)', async () => {
    const makePort = (
      id: string,
      name: string,
      manufacturer: string,
      state: string
    ) => ({ id, name, manufacturer, state });

    const inputs = new Map([
      ['p1', makePort('p1', 'AKM320', 'MIDIPLUS', 'connected')],
      ['p2', makePort('p2', 'Virtual In', 'LoopMIDI', 'disconnected')],
    ]);
    const outputs = new Map([
      ['p3', makePort('p3', 'UM-1 OUT', 'Roland', 'connected')],
    ]);

    const requestMIDIAccess = vi.fn().mockResolvedValue({ inputs, outputs });
    vi.stubGlobal('navigator', { requestMIDIAccess });

    const result = await enumerateMidiDevices();

    // 授权请求参数: sysex: false
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(result.permission).toBe('granted');
    expect(result.input).toHaveLength(2);
    expect(result.output).toHaveLength(1);

    expect(result.input[0]).toEqual({
      id: 'p1',
      name: 'AKM320',
      manufacturer: 'MIDIPLUS',
      isAvailable: true,
    });
    expect(result.input[1].isAvailable).toBe(false);
    expect(result.output[0]).toEqual({
      id: 'p3',
      name: 'UM-1 OUT',
      manufacturer: 'Roland',
      isAvailable: true,
    });
  });

  it('S0-T05: requestMIDIAccess reject NotAllowedError → denied, 不 throw (critical)', async () => {
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi
        .fn()
        .mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    });

    await expect(enumerateMidiDevices()).resolves.toEqual({
      input: [],
      output: [],
      permission: 'denied',
    });
  });

  it('S0-T06: navigator.requestMIDIAccess undefined → unavailable, 不 throw (critical)', async () => {
    vi.stubGlobal('navigator', {});

    await expect(enumerateMidiDevices()).resolves.toEqual({
      input: [],
      output: [],
      permission: 'unavailable',
    });
  });
});
