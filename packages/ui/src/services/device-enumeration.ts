/**
 * 设备枚举 service (v1.24.0 Stage 0 / D2-1, D2-2)
 *
 * 纯函数封装 Web Audio / Web MIDI 设备枚举，与 React 解耦、独立可测。
 * 所有失败路径（API 缺失 / 权限拒绝）均返回三态结果，不 throw。
 *
 * 设备热插拔监听（mediaDevices.ondevicechange / MIDIAccess.onstatechange）
 * 本版不做（YAGNI），刷新按钮覆盖需求（v1.24 裁决）。
 */

/** 设备信息（与 DeviceSelector 的 DeviceInfo 结构兼容） */
export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
  isDefault?: boolean;
  isAvailable?: boolean;
}

/** 权限三态：granted（枚举成功）/ denied（用户或策略拒绝）/ unavailable（API 缺失） */
export type DevicePermission = 'granted' | 'denied' | 'unavailable';

/** 枚举结果 */
export interface EnumerationResult {
  input: DeviceInfo[];
  output: DeviceInfo[];
  permission: DevicePermission;
}

/** 空结果常量 */
function emptyResult(permission: DevicePermission): EnumerationResult {
  return { input: [], output: [], permission };
}

/**
 * Web MIDI MIDIPort 最小结构（避免依赖 lib.dom 的 WebMIDI 类型）。
 * inputs/outputs 是 Map<string, MidiPortLike>，用 values() 迭代。
 */
interface MidiPortLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state?: string;
}

interface MidiAccessLike {
  inputs: { values(): Iterable<MidiPortLike> };
  outputs: { values(): Iterable<MidiPortLike> };
}

type RequestMidiAccess = (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;

/**
 * D2-1: 枚举音频设备。
 *
 * 调用 navigator.mediaDevices.enumerateDevices()，按 kind 过滤映射。
 * - enumerateDevices 本身不触发权限弹窗；无授权时浏览器会自动省略
 *   非默认设备（label 为空串）——这是平台语义，不是错误，枚举成功即
 *   permission = 'granted'。
 * - navigator.mediaDevices 缺失（非 secure context / jsdom）→
 *   permission = 'unavailable'，不 throw。
 */
export async function enumerateAudioDevices(): Promise<EnumerationResult> {
  const mediaDevices: MediaDevices | undefined =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
    return emptyResult('unavailable');
  }

  let devices: MediaDeviceInfo[];
  try {
    devices = await mediaDevices.enumerateDevices();
  } catch {
    return emptyResult('unavailable');
  }

  const counters = { audioinput: 0, audiooutput: 0 };
  const input: DeviceInfo[] = [];
  const output: DeviceInfo[] = [];

  for (const device of devices) {
    if (device.kind !== 'audioinput' && device.kind !== 'audiooutput') {
      continue;
    }
    const kind = device.kind as 'audioinput' | 'audiooutput';
    const label = device.label || '';
    const info: DeviceInfo = {
      // deviceId 为空（无授权）时降级为带序号的占位 id
      id: device.deviceId || `unknown-${kind}-${counters[kind]}`,
      // label 为空时留空串，由调用方按需补 i18n 文案
      name: label,
      // MediaDeviceInfo 无 manufacturer 字段，省略；
      // default 设备的 label 前缀惯例为 "Default - ..." / "默认 - ..."
      isDefault: label.startsWith('Default') || label.startsWith('默认'),
    };
    counters[kind] += 1;
    if (kind === 'audioinput') {
      input.push(info);
    } else {
      output.push(info);
    }
  }

  return { input, output, permission: 'granted' };
}

/**
 * D2-2: 枚举 MIDI 设备。
 *
 * 调用 navigator.requestMIDIAccess({ sysex: false }) 并迭代
 * access.inputs / access.outputs 中的 MIDIPort。
 *
 * 注意：调用此函数会触发浏览器 MIDI 授权弹窗（预期行为）。
 * 若用户拒绝授权，requestMIDIAccess 以 NotAllowedError reject，
 * 我们捕获后返回 permission = 'denied'，不向上抛出。
 *
 * - NotAllowedError / AbortError / InvalidStateError / NotSupportedError
 *   → { input: [], output: [], permission: 'denied' }，不 throw。
 * - navigator.requestMIDIAccess 缺失（不支持 Web MIDI）→
 *   permission = 'unavailable'，不 throw。
 */
export async function enumerateMidiDevices(): Promise<EnumerationResult> {
  const requestMIDIAccess =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { requestMIDIAccess?: RequestMidiAccess })
          .requestMIDIAccess
      : undefined;

  if (typeof requestMIDIAccess !== 'function') {
    return emptyResult('unavailable');
  }

  let access: MidiAccessLike;
  try {
    access = await requestMIDIAccess({ sysex: false });
  } catch {
    return emptyResult('denied');
  }

  const toInfo = (port: MidiPortLike): DeviceInfo => ({
    id: port.id,
    name: port.name ?? '',
    manufacturer: port.manufacturer ?? undefined,
    isAvailable: port.state === 'connected',
  });

  const input: DeviceInfo[] = [];
  for (const port of access.inputs.values()) {
    input.push(toInfo(port));
  }
  const output: DeviceInfo[] = [];
  for (const port of access.outputs.values()) {
    output.push(toInfo(port));
  }

  return { input, output, permission: 'granted' };
}
