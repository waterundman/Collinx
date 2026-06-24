import { describe, it, expect, beforeEach } from "vitest";
import {
  mixerToDiff,
  diffToMixer,
  computeMixerDiff,
  FXPresetLibrary,
  type MixerChange,
  type FXPreset,
} from "../mixer-diff";
import {
  createTrack,
  createFXSlot,
  addSlotToChain,
  type MixerState,
} from "../audio-routes";

function makeMixerState(overrides?: Partial<MixerState>): MixerState {
  const master = createTrack("Master", "master", "master");
  master.id = "master-1";

  const track1 = createTrack("Vocal", "vocal-1", "group");
  track1.id = "track-1";
  const track2 = createTrack("Drums", "drums-1", "group");
  track2.id = "track-2";

  return {
    tracks: [track1, track2],
    masterTrack: master,
    routingMatrix: {},
    ...overrides,
  };
}

function makeMixerChange(
  trackId: string,
  overrides?: Partial<MixerChange>,
): MixerChange {
  return {
    trackId,
    changes: {},
    ...overrides,
  };
}

describe("mixer-diff", () => {
  describe("mixerToDiff / diffToMixer round-trip", () => {
    it("should convert changes to a DiffEnvelope and back", () => {
      const mixer = makeMixerState();
      const changes: MixerChange[] = [
        makeMixerChange("track-1", {
          changes: { gainDb: "-3", pan: "10" },
        }),
      ];

      const diff = mixerToDiff(changes, "rev-1");
      expect(diff.diffId).toBeTruthy();
      expect(diff.baseRevision).toBe("rev-1");
      expect(diff.ops).toHaveLength(1);

      const updated = diffToMixer(diff, mixer);
      const track = updated.tracks.find((t) => t.id === "track-1")!;
      expect(track.gainDb).toBe("-3");
      expect(track.pan).toBe("10");
    });

    it("should apply fxChanges correctly", () => {
      const mixer = makeMixerState();
      const eqSlot = createFXSlot("eq", "default");
      const track = mixer.tracks[0];
      addSlotToChain(track.fxChain, eqSlot);

      const changes: MixerChange[] = [
        {
          trackId: "track-1",
          changes: {},
          fxChanges: [
            { slotIndex: 0, changes: { preset: "warm_keys", enabled: false } },
          ],
        },
      ];

      const diff = mixerToDiff(changes, "rev-1");
      const updated = diffToMixer(diff, mixer);
      const slot = updated.tracks[0].fxChain.slots[0];
      expect(slot.preset).toBe("warm_keys");
      expect(slot.enabled).toBe(false);
    });

    it("should apply sendChanges correctly", () => {
      const mixer = makeMixerState();
      mixer.tracks[0].sends.push({
        targetBusId: "bus-1",
        level: "50",
        preFader: false,
      });

      const changes: MixerChange[] = [
        {
          trackId: "track-1",
          changes: {},
          sendChanges: [{ index: 0, changes: { level: "75", preFader: true } }],
        },
      ];

      const diff = mixerToDiff(changes, "rev-1");
      const updated = diffToMixer(diff, mixer);
      const send = updated.tracks[0].sends[0];
      expect(send.level).toBe("75");
      expect(send.preFader).toBe(true);
    });

    it("should handle mute/solo changes", () => {
      const mixer = makeMixerState();
      const changes: MixerChange[] = [
        makeMixerChange("track-1", {
          changes: { mute: true, solo: true },
        }),
      ];

      const diff = mixerToDiff(changes, "rev-2");
      const updated = diffToMixer(diff, mixer);
      const track = updated.tracks.find((t) => t.id === "track-1")!;
      expect(track.mute).toBe(true);
      expect(track.solo).toBe(true);
    });

    it("should skip tracks not found in mixer", () => {
      const mixer = makeMixerState();
      const changes: MixerChange[] = [
        makeMixerChange("non-existent-track", {
          changes: { gainDb: "-10" },
        }),
      ];

      const diff = mixerToDiff(changes, "rev-1");
      const updated = diffToMixer(diff, mixer);
      expect(updated.tracks[0].gainDb).toBe("0");
    });

    it("should round-trip multiple tracks with mixed changes", () => {
      const mixer = makeMixerState();
      const eqSlot = createFXSlot("eq");
      addSlotToChain(mixer.tracks[0].fxChain, eqSlot);
      mixer.tracks[0].sends.push({
        targetBusId: "reverb-bus",
        level: "30",
        preFader: false,
      });

      const changes: MixerChange[] = [
        {
          trackId: "track-1",
          changes: { gainDb: "-6", pan: "-20" },
          fxChanges: [{ slotIndex: 0, changes: { preset: "bright_guitar" } }],
          sendChanges: [{ index: 0, changes: { level: "60" } }],
        },
        {
          trackId: "track-2",
          changes: { mute: true },
        },
      ];

      const diff = mixerToDiff(changes, "rev-multi");
      const updated = diffToMixer(diff, mixer);

      const t1 = updated.tracks.find((t) => t.id === "track-1")!;
      expect(t1.gainDb).toBe("-6");
      expect(t1.pan).toBe("-20");
      expect(t1.fxChain.slots[0].preset).toBe("bright_guitar");
      expect(t1.sends[0].level).toBe("60");

      const t2 = updated.tracks.find((t) => t.id === "track-2")!;
      expect(t2.mute).toBe(true);
    });
  });

  describe("computeMixerDiff", () => {
    it("should detect gain and pan changes", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      after.tracks[0].gainDb = "-4";
      after.tracks[0].pan = "25";

      const changes = computeMixerDiff(before, after);
      expect(changes).toHaveLength(1);
      expect(changes[0].trackId).toBe("track-1");
      expect(changes[0].changes.gainDb).toBe("-4");
      expect(changes[0].changes.pan).toBe("25");
    });

    it("should detect mute/solo changes", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      after.tracks[1].mute = true;
      after.tracks[1].solo = true;

      const changes = computeMixerDiff(before, after);
      expect(changes).toHaveLength(1);
      expect(changes[0].changes.mute).toBe(true);
      expect(changes[0].changes.solo).toBe(true);
    });

    it("should detect fx slot changes", () => {
      const before = makeMixerState();
      const slot = createFXSlot("eq", "flat");
      addSlotToChain(before.tracks[0].fxChain, slot);

      const after = makeMixerState();
      const slot2 = createFXSlot("eq", "warm_keys");
      addSlotToChain(after.tracks[0].fxChain, slot2);

      const changes = computeMixerDiff(before, after);
      expect(changes[0].fxChanges).toBeDefined();
      expect(changes[0].fxChanges![0].changes.preset).toBe("warm_keys");
    });

    it("should detect new fx slot added", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      const slot = createFXSlot("compressor", "gentle_glue");
      addSlotToChain(after.tracks[0].fxChain, slot);

      const changes = computeMixerDiff(before, after);
      expect(changes[0].fxChanges).toBeDefined();
      expect(changes[0].fxChanges![0].changes.type).toBe("compressor");
    });

    it("should detect send changes", () => {
      const before = makeMixerState();
      before.tracks[0].sends.push({
        targetBusId: "bus-1",
        level: "40",
        preFader: false,
      });

      const after = makeMixerState();
      after.tracks[0].sends.push({
        targetBusId: "bus-1",
        level: "80",
        preFader: true,
      });

      const changes = computeMixerDiff(before, after);
      expect(changes[0].sendChanges).toBeDefined();
      expect(changes[0].sendChanges![0].changes.level).toBe("80");
      expect(changes[0].sendChanges![0].changes.preFader).toBe(true);
    });

    it("should detect new send added", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      after.tracks[0].sends.push({
        targetBusId: "bus-2",
        level: "50",
        preFader: false,
      });

      const changes = computeMixerDiff(before, after);
      expect(changes[0].sendChanges).toBeDefined();
      expect(changes[0].sendChanges![0].changes.targetBusId).toBe("bus-2");
    });

    it("should return empty array when nothing changed", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      const changes = computeMixerDiff(before, after);
      expect(changes).toHaveLength(0);
    });

    it("should ignore tracks that exist only in one state", () => {
      const before = makeMixerState();
      const after = makeMixerState();
      after.tracks.push(createTrack("Bass", "bass-1"));

      const changes = computeMixerDiff(before, after);
      expect(changes).toHaveLength(0);
    });

    it("should detect fx params changes", () => {
      const before = makeMixerState();
      const slot = createFXSlot("eq", "default");
      slot.params = { freq: "1000", gain: "0" };
      addSlotToChain(before.tracks[0].fxChain, slot);

      const after = makeMixerState();
      const slot2 = createFXSlot("eq", "default");
      slot2.params = { freq: "3000", gain: "+3" };
      addSlotToChain(after.tracks[0].fxChain, slot2);

      const changes = computeMixerDiff(before, after);
      expect(changes[0].fxChanges).toBeDefined();
      expect(changes[0].fxChanges![0].changes.params).toEqual({
        freq: "3000",
        gain: "+3",
      });
    });
  });

  describe("FXPresetLibrary", () => {
    let lib: FXPresetLibrary;

    beforeEach(() => {
      lib = new FXPresetLibrary();
    });

    describe("addPreset / getPreset", () => {
      it("should add and retrieve a preset", () => {
        const preset: FXPreset = {
          id: "test-1",
          name: "Test Preset",
          fxType: "eq",
          description: "A test",
          category: "eq",
          params: { freq: "1000" },
          createdAt: new Date().toISOString(),
        };
        lib.addPreset(preset);
        expect(lib.getPreset("test-1")).toEqual(preset);
      });

      it("should return undefined for unknown preset", () => {
        expect(lib.getPreset("missing")).toBeUndefined();
      });

      it("should overwrite preset with same id", () => {
        const p1: FXPreset = {
          id: "dup",
          name: "Original",
          fxType: "eq",
          description: "First",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        };
        const p2: FXPreset = {
          ...p1,
          name: "Updated",
          description: "Second",
        };
        lib.addPreset(p1);
        lib.addPreset(p2);
        expect(lib.getPreset("dup")!.name).toBe("Updated");
      });
    });

    describe("listByType", () => {
      it("should filter presets by fx type", () => {
        lib.addPreset({
          id: "eq-1",
          name: "EQ1",
          fxType: "eq",
          description: "EQ",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "comp-1",
          name: "Comp1",
          fxType: "compressor",
          description: "Comp",
          category: "dynamics",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "eq-2",
          name: "EQ2",
          fxType: "eq",
          description: "EQ",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });

        const eqPresets = lib.listByType("eq");
        expect(eqPresets).toHaveLength(2);

        const compPresets = lib.listByType("compressor");
        expect(compPresets).toHaveLength(1);

        const none = lib.listByType("delay");
        expect(none).toHaveLength(0);
      });
    });

    describe("listByCategory", () => {
      it("should filter presets by category", () => {
        lib.addPreset({
          id: "p1",
          name: "P1",
          fxType: "eq",
          description: "EQ",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "p2",
          name: "P2",
          fxType: "reverb",
          description: "Verb",
          category: "spatial",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "p3",
          name: "P3",
          fxType: "delay",
          description: "Delay",
          category: "modulation",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });

        expect(lib.listByCategory("eq")).toHaveLength(1);
        expect(lib.listByCategory("spatial")).toHaveLength(1);
        expect(lib.listByCategory("modulation")).toHaveLength(1);
        expect(lib.listByCategory("utility")).toHaveLength(0);
      });
    });

    describe("search", () => {
      it("should search by name", () => {
        lib.addPreset({
          id: "p1",
          name: "vocal_presence",
          fxType: "eq",
          description: "Boosts vocal clarity",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "p2",
          name: "bright_guitar",
          fxType: "eq",
          description: "Bright sound",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });

        const results = lib.search("vocal");
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("vocal_presence");
      });

      it("should search by description", () => {
        lib.addPreset({
          id: "p1",
          name: "test",
          fxType: "eq",
          description: "adds warmth to keys",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "p2",
          name: "test2",
          fxType: "eq",
          description: "bright guitar tone",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });

        const results = lib.search("warmth");
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("test");
      });

      it("should be case-insensitive", () => {
        lib.addPreset({
          id: "p1",
          name: "Vocal_Presence",
          fxType: "eq",
          description: "Sound",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        expect(lib.search("vocal")).toHaveLength(1);
        expect(lib.search("VOCAL")).toHaveLength(1);
      });

      it("should return empty array when no matches", () => {
        lib.addPreset({
          id: "p1",
          name: "eq preset",
          fxType: "eq",
          description: "eq",
          category: "eq",
          params: {},
          createdAt: "2025-01-01T00:00:00.000Z",
        });
        expect(lib.search("nonexistent")).toHaveLength(0);
      });
    });

    describe("builtin presets", () => {
      it("should have at least 12 built-in presets", () => {
        expect(FXPresetLibrary.BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(
          12,
        );
      });

      it("should include expected EQ presets", () => {
        const eqNames = FXPresetLibrary.BUILTIN_PRESETS.filter(
          (p) => p.fxType === "eq",
        ).map((p) => p.name);
        expect(eqNames).toContain("vocal_presence");
        expect(eqNames).toContain("warm_keys");
        expect(eqNames).toContain("bright_guitar");
        expect(eqNames).toContain("cut_mud");
      });

      it("should include expected compressor presets", () => {
        const compNames = FXPresetLibrary.BUILTIN_PRESETS.filter(
          (p) => p.fxType === "compressor",
        ).map((p) => p.name);
        expect(compNames).toContain("gentle_glue");
        expect(compNames).toContain("punchy_drums");
        expect(compNames).toContain("vocal_ride");
        expect(compNames).toContain("brickwall_limit");
      });

      it("should include expected reverb presets", () => {
        const verbNames = FXPresetLibrary.BUILTIN_PRESETS.filter(
          (p) => p.fxType === "reverb",
        ).map((p) => p.name);
        expect(verbNames).toContain("small_room");
        expect(verbNames).toContain("large_hall");
        expect(verbNames).toContain("plate_verb");
      });

      it("should include expected delay presets", () => {
        const delayNames = FXPresetLibrary.BUILTIN_PRESETS.filter(
          (p) => p.fxType === "delay",
        ).map((p) => p.name);
        expect(delayNames).toContain("slapback");
        expect(delayNames).toContain("ping_pong_quarter");
      });

      it("should have valid preset ids", () => {
        for (const preset of FXPresetLibrary.BUILTIN_PRESETS) {
          expect(preset.id).toBeTruthy();
          expect(preset.id).toContain("builtin:");
        }
      });

      it("should be loadable into a library", () => {
        const lib = new FXPresetLibrary(FXPresetLibrary.BUILTIN_PRESETS);
        expect(lib.listByType("eq")).toHaveLength(4);
        expect(lib.listByType("compressor")).toHaveLength(4);
        expect(lib.listByType("reverb")).toHaveLength(3);
        expect(lib.listByType("delay")).toHaveLength(2);
        expect(lib.listByCategory("eq")).toHaveLength(4);
        expect(lib.listByCategory("dynamics")).toHaveLength(4);
        expect(lib.listByCategory("spatial")).toHaveLength(3);
        expect(lib.listByCategory("modulation")).toHaveLength(2);
      });
    });

    describe("serialization", () => {
      it("should round-trip through JSON", () => {
        lib.addPreset({
          id: "p1",
          name: "My Preset",
          fxType: "eq",
          description: "Custom EQ",
          category: "eq",
          params: { freq: "2000", gain: "+4" },
          createdAt: "2025-06-01T00:00:00.000Z",
        });
        lib.addPreset({
          id: "p2",
          name: "My Comp",
          fxType: "compressor",
          description: "Custom comp",
          category: "dynamics",
          params: { ratio: "4:1" },
          createdAt: "2025-06-01T00:00:00.000Z",
        });

        const json = lib.toJSON();
        const restored = FXPresetLibrary.fromJSON(json);

        const p1 = restored.getPreset("p1");
        expect(p1).toBeDefined();
        expect(p1!.name).toBe("My Preset");
        expect(p1!.params).toEqual({ freq: "2000", gain: "+4" });

        const p2 = restored.getPreset("p2");
        expect(p2).toBeDefined();
        expect(p2!.fxType).toBe("compressor");
      });

      it("should handle invalid JSON gracefully", () => {
        const lib1 = FXPresetLibrary.fromJSON(null);
        expect(lib1.getPreset("any")).toBeUndefined();

        const lib2 = FXPresetLibrary.fromJSON({});
        expect(lib2.getPreset("any")).toBeUndefined();

        const lib3 = FXPresetLibrary.fromJSON({ presets: "invalid" });
        expect(lib3.getPreset("any")).toBeUndefined();
      });

      it("should skip invalid preset entries", () => {
        const lib = FXPresetLibrary.fromJSON({
          presets: [
            { id: "ok", name: "OK", fxType: "eq", description: "d", category: "eq", params: {}, createdAt: "2025-01-01T00:00:00.000Z" },
            { not: "valid" },
            { id: "bad-cat", name: "Bad", fxType: "eq", description: "d", category: "invalid_cat", params: {} },
          ],
        });
        expect(lib.getPreset("ok")).toBeDefined();
        expect(lib.getPreset("bad-cat")).toBeUndefined();
      });
    });
  });
});
