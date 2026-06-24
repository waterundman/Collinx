import { describe, it, expect } from "vitest";
import {
  createTrack,
  createFXSlot,
  addSlotToChain,
  removeSlot,
  reorderSlots,
} from "../audio-routes";
import type {
  MixerTrack,
  FXChain,
  FXSlot,
  SendConfig,
  MixerState,
} from "../audio-routes";

describe("createTrack", () => {
  it("should create a track with defaults", () => {
    const track = createTrack("Kick", "source-1");
    expect(track.name).toBe("Kick");
    expect(track.sourceTrackId).toBe("source-1");
    expect(track.busType).toBe("group");
    expect(track.gainDb).toBe("0");
    expect(track.pan).toBe("0");
    expect(track.mute).toBe(false);
    expect(track.solo).toBe(false);
    expect(track.meterLevel).toBe("0");
    expect(track.sends).toEqual([]);
    expect(track.id).toBeTruthy();
    expect(track.fxChain.id).toBeTruthy();
    expect(track.fxChain.slots).toEqual([]);
  });

  it("should create a track with custom busType", () => {
    const track = createTrack("Reverb", "source-2", "fx_return");
    expect(track.busType).toBe("fx_return");
  });
});

describe("createFXSlot", () => {
  it("should create an FX slot with defaults", () => {
    const slot = createFXSlot("eq");
    expect(slot.type).toBe("eq");
    expect(slot.preset).toBe("default");
    expect(slot.enabled).toBe(true);
    expect(slot.params).toEqual({});
    expect(slot.id).toBeTruthy();
  });

  it("should create an FX slot with custom preset", () => {
    const slot = createFXSlot("compressor", "vocal");
    expect(slot.type).toBe("compressor");
    expect(slot.preset).toBe("vocal");
  });
});

describe("addSlotToChain", () => {
  it("should append slot to end of chain", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("compressor");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2);
    expect(chain.slots).toHaveLength(2);
    expect(chain.slots[0].type).toBe("eq");
    expect(chain.slots[1].type).toBe("compressor");
  });

  it("should insert slot at specific index", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("reverb");
    const slot3 = createFXSlot("delay");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot3);
    addSlotToChain(chain, slot2, 1);
    expect(chain.slots).toHaveLength(3);
    expect(chain.slots[1].type).toBe("reverb");
  });

  it("should insert at index 0", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("compressor");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2, 0);
    expect(chain.slots[0].type).toBe("compressor");
    expect(chain.slots[1].type).toBe("eq");
  });
});

describe("removeSlot", () => {
  it("should remove a slot by id", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("reverb");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2);
    removeSlot(chain, slot1.id);
    expect(chain.slots).toHaveLength(1);
    expect(chain.slots[0].type).toBe("reverb");
  });

  it("should not remove anything for non-matching id", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot = createFXSlot("eq");
    addSlotToChain(chain, slot);
    removeSlot(chain, "nonexistent");
    expect(chain.slots).toHaveLength(1);
  });

  it("should handle empty chain", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    removeSlot(chain, "any-id");
    expect(chain.slots).toEqual([]);
  });
});

describe("reorderSlots", () => {
  it("should move slot from one position to another", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("compressor");
    const slot3 = createFXSlot("reverb");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2);
    addSlotToChain(chain, slot3);

    reorderSlots(chain, 0, 2);
    expect(chain.slots[0].type).toBe("compressor");
    expect(chain.slots[1].type).toBe("reverb");
    expect(chain.slots[2].type).toBe("eq");
  });

  it("should move slot to earlier position", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("compressor");
    const slot3 = createFXSlot("reverb");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2);
    addSlotToChain(chain, slot3);

    reorderSlots(chain, 2, 0);
    expect(chain.slots[0].type).toBe("reverb");
    expect(chain.slots[1].type).toBe("eq");
    expect(chain.slots[2].type).toBe("compressor");
  });

  it("should not change chain when indices are out of bounds", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    addSlotToChain(chain, slot1);

    reorderSlots(chain, -1, 0);
    expect(chain.slots[0].type).toBe("eq");

    reorderSlots(chain, 0, 5);
    expect(chain.slots[0].type).toBe("eq");
  });

  it("should not change chain when fromIndex equals toIndex", () => {
    const chain: FXChain = { id: "c1", name: "FX", slots: [] };
    const slot1 = createFXSlot("eq");
    const slot2 = createFXSlot("compressor");
    addSlotToChain(chain, slot1);
    addSlotToChain(chain, slot2);

    reorderSlots(chain, 0, 0);
    expect(chain.slots[0].type).toBe("eq");
    expect(chain.slots[1].type).toBe("compressor");
  });
});

describe("MixerTrack FX chain integration", () => {
  it("should allow building a full FX chain on a track", () => {
    const track = createTrack("Vocals", "src-vox");
    const eq = createFXSlot("eq", "vocal");
    eq.params = { lowGainDb: "-3", lowFreq: "150", lowQ: "0.7" };
    const comp = createFXSlot("compressor", "vocal");
    comp.params = { thresholdDb: "-24", ratio: "3", attackMs: "5" };
    const rev = createFXSlot("reverb", "plate");
    rev.params = { roomSize: "0.6", wetLevel: "0.25" };

    addSlotToChain(track.fxChain, eq);
    addSlotToChain(track.fxChain, comp);
    addSlotToChain(track.fxChain, rev);

    expect(track.fxChain.slots).toHaveLength(3);
    expect(track.fxChain.slots[0].type).toBe("eq");
    expect(track.fxChain.slots[2].type).toBe("reverb");
  });
});
