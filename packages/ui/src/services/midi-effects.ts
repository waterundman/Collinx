/**
 * v3.1.0：MIDI 效果链（演奏期处理）。
 *
 * 定位：作用在**发送前的事件流**上，不改工程里的音符。所以它是会话级
 * 设置（`settings.midi.effects`），不是工程数据 —— 与「导出时是否应用」
 * 解耦，避免用户以为改了工程。
 *
 * 朴素实现：只有两条真效果（移调 / 力度），都是纯函数、可逐值断言。
 * 不引入效果器插件协议（那是另一件事）。
 */

export type MidiEffectType = "transpose" | "velocity";

export interface MidiEffect {
  id: string;
  type: MidiEffectType;
  enabled: boolean;
  /**
   * transpose：半音数（-24..24）
   * velocity：力度倍率（0.1..2）
   */
  value: number;
}

export const MIDI_EFFECT_LIMITS = {
  transpose: { min: -24, max: 24, step: 1, defaultValue: 0 },
  velocity: { min: 0.1, max: 2, step: 0.05, defaultValue: 1 },
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function uid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMidiEffect(type: MidiEffectType): MidiEffect {
  return {
    id: uid(),
    type,
    enabled: true,
    value: MIDI_EFFECT_LIMITS[type].defaultValue,
  };
}

/** 防御性归一：坏存档里的非法项直接丢弃，不让 NaN 流进调度器 */
export function normalizeMidiEffects(input: unknown): MidiEffect[] {
  if (!Array.isArray(input)) return [];
  const out: MidiEffect[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<MidiEffect>;
    if (item.type !== "transpose" && item.type !== "velocity") continue;
    const lim = MIDI_EFFECT_LIMITS[item.type];
    const value = typeof item.value === "number" && Number.isFinite(item.value) ? item.value : lim.defaultValue;
    out.push({
      id: typeof item.id === "string" && item.id ? item.id : uid(),
      type: item.type,
      enabled: item.enabled !== false,
      value: clamp(value, lim.min, lim.max),
    });
  }
  return out;
}

/**
 * 依次应用启用的效果。纯函数：不修改入参、不改顺序。
 * 只处理 `pitchMidi` / `velocity` 两个字段，其余字段原样保留。
 */
export function applyMidiEffects<T extends { pitchMidi: number; velocity: number }>(
  notes: readonly T[],
  effects: readonly MidiEffect[],
): T[] {
  if (effects.length === 0) return notes.slice();
  return notes.map((note) => {
    let pitchMidi = note.pitchMidi;
    let velocity = note.velocity;
    for (const fx of effects) {
      if (!fx.enabled) continue;
      if (fx.type === "transpose") {
        pitchMidi = clamp(Math.round(pitchMidi + fx.value), 0, 127);
      } else {
        velocity = clamp(velocity * fx.value, 0, 1);
      }
    }
    return { ...note, pitchMidi, velocity };
  });
}
