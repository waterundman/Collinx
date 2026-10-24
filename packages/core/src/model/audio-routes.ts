import { randomUUID } from "../util/random-uuid";

export type BusType = "master" | "group" | "fx_send" | "fx_return";
export type InsertPosition = "pre_fader" | "post_fader" | "post_pan";

export const FX_TYPES = [
  "eq",
  "compressor",
  "reverb",
  "delay",
  "saturator",
  "limiter",
] as const;

export type FXType = (typeof FX_TYPES)[number];

export interface FXSlot {
  id: string;
  type: FXType;
  preset: string;
  params: Record<string, string>;
  enabled: boolean;
}

export interface FXChain {
  id: string;
  name: string;
  slots: FXSlot[];
}

export interface SendConfig {
  targetBusId: string;
  level: string;
  preFader: boolean;
}

export interface MixerTrack {
  id: string;
  name: string;
  sourceTrackId: string;
  busType: BusType;
  parentBusId?: string;

  gainDb: string;
  pan: string;
  mute: boolean;
  solo: boolean;
  fxChain: FXChain;
  sends: SendConfig[];
  meterLevel: string;
  /**
   * 音色 id（见 ui/src/services/instruments.ts，如 "lead" / "bass" / "pad"）。
   *
   * **可选，向后兼容**：老工程没有这个字段 → 消费方回落到「按 trackId 名称推断」
   * （`instrumentForTrack`）。显式指定后即以它为准，不再看名称。
   *
   * 放在 MixerTrack 而不是引入独立字段，是因为 MixerState 已经整体进
   * `.agentmusic`（agentmusic-bridge.ts:60）—— 加在这里持久化自动生效，
   * 不需要另开一条序列化路径。
   */
  instrument?: string;
}

export interface MixerState {
  tracks: MixerTrack[];
  masterTrack: MixerTrack;
  routingMatrix: Record<string, string[]>;
}

/**
 * 只读混音快照（v2.9.0）——给 Agent 工具层读混音状态用。
 *
 * 为什么不直接把 `MixerState` 交给工具：工具是只读的，不需要（也不应该）
 * 拿到可变的 FX 链引用；快照同时把「独奏是否生效」这种派生语义固定下来，
 * 避免模型自己推算 `solo` 与 `mute` 的优先级。
 */
export interface MixerSnapshotTrack {
  id: string;
  name: string;
  sourceTrackId: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** 实际是否静音（已计入独奏并集与 mute 优先） */
  effectiveMute: boolean;
  instrument?: string;
  fx: { type: string; enabled: boolean }[];
}

export interface MixerSnapshot {
  anySolo: boolean;
  tracks: MixerSnapshotTrack[];
  master: { gainDb: number };
}

function parseDb(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) ? 0 : n;
}

/** 从可变混音状态生成只读快照。 */
export function toMixerSnapshot(mixer: MixerState): MixerSnapshot {
  const anySolo = mixer.tracks.some((t) => t.solo);
  return {
    anySolo,
    tracks: mixer.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      sourceTrackId: t.sourceTrackId,
      gainDb: parseDb(t.gainDb),
      pan: Number.isNaN(Number.parseFloat(t.pan)) ? 0 : Number.parseFloat(t.pan),
      mute: t.mute,
      solo: t.solo,
      effectiveMute: t.mute || (anySolo && !t.solo),
      instrument: t.instrument,
      fx: t.fxChain.slots.map((s) => ({ type: s.type, enabled: s.enabled })),
    })),
    master: { gainDb: parseDb(mixer.masterTrack.gainDb) },
  };
}

export function createTrack(
  name: string,
  sourceId: string,
  busType?: BusType
): MixerTrack {
  return {
    id: randomUUID(),
    name,
    sourceTrackId: sourceId,
    busType: busType ?? "group",
    gainDb: "0",
    pan: "0",
    mute: false,
    solo: false,
    fxChain: { id: randomUUID(), name: "FX", slots: [] },
    sends: [],
    meterLevel: "0",
  };
}

export function createFXSlot(type: FXType, preset?: string): FXSlot {
  return {
    id: randomUUID(),
    type,
    preset: preset ?? "default",
    params: {},
    enabled: true,
  };
}

export function addSlotToChain(
  chain: FXChain,
  slot: FXSlot,
  index?: number
): void {
  if (index !== undefined && index >= 0 && index <= chain.slots.length) {
    chain.slots.splice(index, 0, slot);
  } else {
    chain.slots.push(slot);
  }
}

export function removeSlot(chain: FXChain, slotId: string): void {
  chain.slots = chain.slots.filter((s) => s.id !== slotId);
}

export function reorderSlots(
  chain: FXChain,
  fromIndex: number,
  toIndex: number
): void {
  if (
    fromIndex < 0 ||
    fromIndex >= chain.slots.length ||
    toIndex < 0 ||
    toIndex >= chain.slots.length
  ) {
    return;
  }
  const [removed] = chain.slots.splice(fromIndex, 1);
  chain.slots.splice(toIndex, 0, removed);
}
