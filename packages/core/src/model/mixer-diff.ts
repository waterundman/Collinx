import { randomUUID } from "../util/random-uuid";
import {
  createDiffEnvelope,
  type DiffEnvelope,
} from "../diff/diff-envelope";
import type { MixerTrack, MixerState, FXSlot, SendConfig } from "./audio-routes";
import { MixerChangeSchema } from "./zod-schemas";

export interface FXPreset {
  id: string;
  name: string;
  fxType: string;
  description: string;
  category: "dynamics" | "eq" | "spatial" | "modulation" | "utility";
  params: Record<string, string>;
  createdAt: string;
}

export interface MixerChange {
  trackId: string;
  changes: Partial<Pick<MixerTrack, "gainDb" | "pan" | "mute" | "solo">>;
  fxChanges?: { slotIndex: number; changes: Partial<FXSlot> }[];
  sendChanges?: { index: number; changes: Partial<SendConfig> }[];
}

export function mixerToDiff(
  changes: MixerChange[],
  baseRevision: string,
): DiffEnvelope {
  const ops = changes.map((change) => ({
    op: "update_node" as const,
    path: `/tracks/${change.trackId}`,
    nodeId: change.trackId,
    data: JSON.parse(JSON.stringify(change)) as Record<string, unknown>,
  }));

  return createDiffEnvelope({
    baseRevision,
    actor: { type: "system", name: "mixer" },
    permissionScope: "write_direct",
    summary: `Mixer diff: ${changes.length} track(s) changed`,
    ops,
  });
}

export function diffToMixer(
  diff: DiffEnvelope,
  mixer: MixerState,
): MixerState {
  const updated: MixerState = structuredClone(mixer);

  for (const op of diff.ops) {
    if (op.op !== "update_node") continue;

    const result = MixerChangeSchema.safeParse(op.data);
    if (!result.success) {
      console.warn(`Invalid MixerChange data: ${result.error.message}`);
      continue;
    }
    const change = result.data as MixerChange;
    const track =
      updated.tracks.find((t) => t.id === change.trackId) ??
      (change.trackId === updated.masterTrack.id
        ? updated.masterTrack
        : undefined);
    if (!track) continue;

    if (change.changes.gainDb !== undefined)
      track.gainDb = change.changes.gainDb;
    if (change.changes.pan !== undefined) track.pan = change.changes.pan;
    if (change.changes.mute !== undefined) track.mute = change.changes.mute;
    if (change.changes.solo !== undefined) track.solo = change.changes.solo;

    if (change.fxChanges) {
      for (const fxChange of change.fxChanges) {
        const slot = track.fxChain.slots[fxChange.slotIndex];
        if (slot) Object.assign(slot, fxChange.changes);
      }
    }

    if (change.sendChanges) {
      for (const sendChange of change.sendChanges) {
        const send = track.sends[sendChange.index];
        if (send) Object.assign(send, sendChange.changes);
      }
    }
  }

  return updated;
}

export function computeMixerDiff(
  before: MixerState,
  after: MixerState,
): MixerChange[] {
  const changes: MixerChange[] = [];

  for (const afterTrack of after.tracks) {
    const beforeTrack = before.tracks.find((t) => t.id === afterTrack.id);
    if (!beforeTrack) continue;

    const trackChanges: Partial<
      Pick<MixerTrack, "gainDb" | "pan" | "mute" | "solo">
    > = {};

    if (beforeTrack.gainDb !== afterTrack.gainDb)
      trackChanges.gainDb = afterTrack.gainDb;
    if (beforeTrack.pan !== afterTrack.pan)
      trackChanges.pan = afterTrack.pan;
    if (beforeTrack.mute !== afterTrack.mute)
      trackChanges.mute = afterTrack.mute;
    if (beforeTrack.solo !== afterTrack.solo)
      trackChanges.solo = afterTrack.solo;

    const fxChanges: {
      slotIndex: number;
      changes: Partial<FXSlot>;
    }[] = [];

    const maxSlots = Math.max(
      beforeTrack.fxChain.slots.length,
      afterTrack.fxChain.slots.length,
    );

    for (let i = 0; i < maxSlots; i++) {
      const beforeSlot = beforeTrack.fxChain.slots[i];
      const afterSlot = afterTrack.fxChain.slots[i];

      if (!beforeSlot && afterSlot) {
        fxChanges.push({
          slotIndex: i,
          changes: {
            type: afterSlot.type,
            preset: afterSlot.preset,
            params: afterSlot.params,
            enabled: afterSlot.enabled,
          },
        });
        continue;
      }

      if (!beforeSlot || !afterSlot) continue;

      const slotChanges: Partial<FXSlot> = {};

      if (beforeSlot.type !== afterSlot.type) slotChanges.type = afterSlot.type;
      if (beforeSlot.preset !== afterSlot.preset)
        slotChanges.preset = afterSlot.preset;
      if (beforeSlot.enabled !== afterSlot.enabled)
        slotChanges.enabled = afterSlot.enabled;
      if (
        JSON.stringify(beforeSlot.params) !==
        JSON.stringify(afterSlot.params)
      )
        slotChanges.params = afterSlot.params;

      if (Object.keys(slotChanges).length > 0) {
        fxChanges.push({ slotIndex: i, changes: slotChanges });
      }
    }

    const sendChanges: {
      index: number;
      changes: Partial<SendConfig>;
    }[] = [];

    const maxSends = Math.max(
      beforeTrack.sends.length,
      afterTrack.sends.length,
    );

    for (let i = 0; i < maxSends; i++) {
      const beforeSend = beforeTrack.sends[i];
      const afterSend = afterTrack.sends[i];

      if (!beforeSend && afterSend) {
        sendChanges.push({
          index: i,
          changes: {
            targetBusId: afterSend.targetBusId,
            level: afterSend.level,
            preFader: afterSend.preFader,
          },
        });
        continue;
      }

      if (!beforeSend || !afterSend) continue;

      const sc: Partial<SendConfig> = {};

      if (beforeSend.targetBusId !== afterSend.targetBusId)
        sc.targetBusId = afterSend.targetBusId;
      if (beforeSend.level !== afterSend.level) sc.level = afterSend.level;
      if (beforeSend.preFader !== afterSend.preFader)
        sc.preFader = afterSend.preFader;

      if (Object.keys(sc).length > 0) {
        sendChanges.push({ index: i, changes: sc });
      }
    }

    if (
      Object.keys(trackChanges).length > 0 ||
      fxChanges.length > 0 ||
      sendChanges.length > 0
    ) {
      const mc: MixerChange = {
        trackId: afterTrack.id,
        changes: trackChanges,
      };
      if (fxChanges.length > 0) mc.fxChanges = fxChanges;
      if (sendChanges.length > 0) mc.sendChanges = sendChanges;
      changes.push(mc);
    }
  }

  return changes;
}

function buildPresetId(name: string): string {
  return `builtin:${name}`;
}

export class FXPresetLibrary {
  private presets: Map<string, FXPreset>;

  constructor(presets: FXPreset[] = []) {
    this.presets = new Map();
    for (const p of presets) {
      this.presets.set(p.id, p);
    }
  }

  addPreset(preset: FXPreset): void {
    this.presets.set(preset.id, preset);
  }

  getPreset(id: string): FXPreset | undefined {
    return this.presets.get(id);
  }

  listByType(fxType: string): FXPreset[] {
    return [...this.presets.values()].filter((p) => p.fxType === fxType);
  }

  listByCategory(cat: string): FXPreset[] {
    return [...this.presets.values()].filter((p) => p.category === cat);
  }

  search(query: string): FXPreset[] {
    const q = query.toLowerCase();
    return [...this.presets.values()].filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }

  static readonly BUILTIN_PRESETS: FXPreset[] = [
    {
      id: buildPresetId("vocal_presence"),
      name: "vocal_presence",
      fxType: "eq",
      description: "Boosts vocal clarity around 3-5kHz with a gentle high-shelf",
      category: "eq",
      params: { lowCut: "80", presence: "+4.5", highShelf: "+2.0" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("warm_keys"),
      name: "warm_keys",
      fxType: "eq",
      description: "Adds warmth and body to keys and pianos",
      category: "eq",
      params: { lowBoost: "+3.0", lowMid: "+1.5", highCut: "10000" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("bright_guitar"),
      name: "bright_guitar",
      fxType: "eq",
      description: "Brightens acoustic guitar with presence boost",
      category: "eq",
      params: { lowCut: "100", midScoop: "-2.0", highBoost: "+5.0" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("cut_mud"),
      name: "cut_mud",
      fxType: "eq",
      description: "Cuts muddy low-mids to clean up a dense mix",
      category: "eq",
      params: { lowMidCut: "-4.0", freq: "300", q: "1.2" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("gentle_glue"),
      name: "gentle_glue",
      fxType: "compressor",
      description: "Light bus compression for subtle mix cohesion",
      category: "dynamics",
      params: {
        ratio: "2:1",
        threshold: "-18",
        attack: "30",
        release: "100",
        makeupGain: "+2.0",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("punchy_drums"),
      name: "punchy_drums",
      fxType: "compressor",
      description: "Adds punch and attack to drum bus",
      category: "dynamics",
      params: {
        ratio: "4:1",
        threshold: "-12",
        attack: "10",
        release: "60",
        makeupGain: "+4.0",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("vocal_ride"),
      name: "vocal_ride",
      fxType: "compressor",
      description: "Smooth vocal leveling for consistent lead vox",
      category: "dynamics",
      params: {
        ratio: "3:1",
        threshold: "-20",
        attack: "5",
        release: "80",
        makeupGain: "+3.0",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("brickwall_limit"),
      name: "brickwall_limit",
      fxType: "compressor",
      description: "Hard limiter with fast attack for mastering safety",
      category: "dynamics",
      params: {
        ratio: "inf:1",
        threshold: "-1",
        attack: "0.1",
        release: "50",
        ceiling: "-0.3",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("small_room"),
      name: "small_room",
      fxType: "reverb",
      description: "Tight small-room ambience for intimate sources",
      category: "spatial",
      params: { size: "0.3", decay: "0.8", damping: "0.6", mix: "25" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("large_hall"),
      name: "large_hall",
      fxType: "reverb",
      description: "Spacious concert hall with long tail",
      category: "spatial",
      params: { size: "0.9", decay: "3.5", damping: "0.3", mix: "35" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("plate_verb"),
      name: "plate_verb",
      fxType: "reverb",
      description: "Classic plate reverb for vocals and snare",
      category: "spatial",
      params: { size: "0.6", decay: "1.8", damping: "0.5", mix: "30" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("slapback"),
      name: "slapback",
      fxType: "delay",
      description: "Quick slapback echo for rockabilly and guitars",
      category: "modulation",
      params: { time: "120ms", feedback: "15", mix: "30" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: buildPresetId("ping_pong_quarter"),
      name: "ping_pong_quarter",
      fxType: "delay",
      description: "Ping-pong delay synced to quarter notes",
      category: "modulation",
      params: { time: "1/4", feedback: "35", mix: "25", pingPong: "on" },
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  toJSON(): object {
    return {
      presets: [...this.presets.values()],
    };
  }

  static fromJSON(json: unknown): FXPresetLibrary {
    if (!json || typeof json !== "object") {
      return new FXPresetLibrary();
    }

    const obj = json as Record<string, unknown>;
    if (!Array.isArray(obj.presets)) {
      return new FXPresetLibrary();
    }

    const presets: FXPreset[] = [];
    for (const item of obj.presets) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;

      if (
        typeof p.id !== "string" ||
        typeof p.name !== "string" ||
        typeof p.fxType !== "string" ||
        typeof p.description !== "string" ||
        typeof p.category !== "string" ||
        typeof p.params !== "object"
      ) {
        continue;
      }

      const validCategories = [
        "dynamics",
        "eq",
        "spatial",
        "modulation",
        "utility",
      ];
      if (!validCategories.includes(p.category)) continue;

      presets.push({
        id: p.id,
        name: p.name,
        fxType: p.fxType,
        description: p.description,
        category: p.category as FXPreset["category"],
        params: p.params as Record<string, string>,
        createdAt:
          typeof p.createdAt === "string"
            ? p.createdAt
            : new Date().toISOString(),
      });
    }

    return new FXPresetLibrary(presets);
  }
}
