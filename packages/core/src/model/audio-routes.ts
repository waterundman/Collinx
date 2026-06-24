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
}

export interface MixerState {
  tracks: MixerTrack[];
  masterTrack: MixerTrack;
  routingMatrix: Record<string, string[]>;
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
