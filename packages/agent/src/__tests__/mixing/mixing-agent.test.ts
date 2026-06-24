import { describe, it, expect, beforeEach } from "vitest";
import { MixingAgent, type MixAnalysis } from "../../mixing/mixing-agent";
import type { MixerTrack, MixerState, NoteEvent } from "@collinx/core";
import { randomUUID } from "@collinx/core";

function makeTrack(name: string, sourceId: string): MixerTrack {
  return {
    id: randomUUID(),
    name,
    sourceTrackId: sourceId,
    busType: "group",
    gainDb: "0",
    pan: "0",
    mute: false,
    solo: false,
    fxChain: { id: randomUUID(), name: "FX", slots: [] },
    sends: [],
    meterLevel: "0",
  };
}

function makeNote(trackId: string): NoteEvent {
  return {
    id: randomUUID(),
    trackId,
    phraseId: null,
    bar: 1,
    beat: 1,
    durQn: 1,
    pitchMidi: 60,
    pitchSpelling: "C4",
    velocity: 0.8,
    voice: "rh",
    tags: [],
  };
}

function makeMixer(tracks: MixerTrack[]): MixerState {
  const master: MixerTrack = {
    id: randomUUID(),
    name: "Master",
    sourceTrackId: "master",
    busType: "master",
    gainDb: "0",
    pan: "0",
    mute: false,
    solo: false,
    fxChain: { id: randomUUID(), name: "Master FX", slots: [] },
    sends: [],
    meterLevel: "0",
  };
  return { tracks, masterTrack: master, routingMatrix: {} };
}

describe("MixingAgent", () => {
  let agent: MixingAgent;

  beforeEach(() => {
    agent = new MixingAgent();
  });

  describe("suggestChain", () => {
    it("returns EQ + compressor for melody source", () => {
      const chain = agent.suggestChain("melody_lead");
      expect(chain.length).toBe(2);
      expect(chain[0].type).toBe("eq");
      expect(chain[1].type).toBe("compressor");
    });

    it("returns EQ + compressor for bass source", () => {
      const chain = agent.suggestChain("bass_sub");
      expect(chain.length).toBe(2);
      expect(chain[0].type).toBe("eq");
      expect(chain[1].type).toBe("compressor");
    });

    it("returns EQ + reverb for chords source", () => {
      const chain = agent.suggestChain("chords_pad");
      expect(chain.length).toBe(2);
      expect(chain[0].type).toBe("eq");
      expect(chain[1].type).toBe("reverb");
    });

    it("returns EQ + compressor for drums source", () => {
      const chain = agent.suggestChain("drums_kit");
      expect(chain.length).toBe(2);
      expect(chain[0].type).toBe("eq");
      expect(chain[1].type).toBe("compressor");
    });

    it("returns flat EQ for unknown source", () => {
      const chain = agent.suggestChain("synth_fx");
      expect(chain.length).toBe(1);
      expect(chain[0].type).toBe("eq");
      expect(chain[0].params.lowGainDb).toBe("0");
    });

    it("returns valid FXSlot structure", () => {
      const chain = agent.suggestChain("melody");
      for (const slot of chain) {
        expect(slot.id).toBeTruthy();
        expect(slot.type).toBeTruthy();
        expect(slot.preset).toBeTruthy();
        expect(typeof slot.params).toBe("object");
        expect(slot.enabled).toBe(true);
      }
    });

    it("classifies source IDs case-insensitively", () => {
      const chain1 = agent.suggestChain("MELODY_LEAD");
      const chain2 = agent.suggestChain("Bass_Synth");
      expect(chain1.length).toBe(2);
      expect(chain2.length).toBe(2);
    });
  });

  describe("suggestGain", () => {
    it("returns -3dB for melody tracks", () => {
      const tracks = [makeTrack("Lead", "melody_vocal")];
      const result = agent.suggestGain(tracks);
      expect(result[0].gainDb).toBe(-3);
    });

    it("returns -4dB for bass tracks", () => {
      const tracks = [makeTrack("Bass", "bass_synth")];
      const result = agent.suggestGain(tracks);
      expect(result[0].gainDb).toBe(-4);
    });

    it("returns -6dB for chord tracks", () => {
      const tracks = [makeTrack("Pads", "chords_pad")];
      const result = agent.suggestGain(tracks);
      expect(result[0].gainDb).toBe(-6);
    });

    it("returns -8dB for default/unknown tracks", () => {
      const tracks = [makeTrack("FX", "ambient_texture")];
      const result = agent.suggestGain(tracks);
      expect(result[0].gainDb).toBe(-8);
    });

    it("returns results for all tracks", () => {
      const tracks = [
        makeTrack("Lead", "melody"),
        makeTrack("Bass", "bass"),
        makeTrack("Pads", "chords"),
        makeTrack("FX", "texture"),
      ];
      const result = agent.suggestGain(tracks);
      expect(result.length).toBe(4);
    });
  });

  describe("suggestPan", () => {
    it("centers melody at 0", () => {
      const tracks = [makeTrack("Lead", "melody")];
      const result = agent.suggestPan(tracks);
      expect(result[0].pan).toBe(0);
    });

    it("centers bass at 0", () => {
      const tracks = [makeTrack("Bass", "bass")];
      const result = agent.suggestPan(tracks);
      expect(result[0].pan).toBe(0);
    });

    it("pans chords slightly left at -0.3", () => {
      const tracks = [makeTrack("Pads", "chords")];
      const result = agent.suggestPan(tracks);
      expect(result[0].pan).toBe(-0.3);
    });

    it("returns pan values in [-1, 1] for all tracks", () => {
      const tracks = [
        makeTrack("Lead", "melody"),
        makeTrack("Bass", "bass"),
        makeTrack("Pads", "chords"),
        makeTrack("FX1", "texture"),
        makeTrack("FX2", "atmosphere"),
        makeTrack("Perc", "percussion"),
      ];
      const result = agent.suggestPan(tracks);
      for (const r of result) {
        expect(r.pan).toBeGreaterThanOrEqual(-1);
        expect(r.pan).toBeLessThanOrEqual(1);
      }
    });

    it("returns results for all tracks", () => {
      const tracks = [makeTrack("A", "melody"), makeTrack("B", "bass"), makeTrack("C", "other")];
      const result = agent.suggestPan(tracks);
      expect(result.length).toBe(3);
    });
  });

  describe("suggestMix", () => {
    it("returns complete analysis with suggestions for each track", () => {
      const tracks = [makeTrack("Lead", "melody"), makeTrack("Bass", "bass"), makeTrack("Pads", "chords")];
      const notes = tracks.map((t) => makeNote(t.id));
      const result = agent.suggestMix(tracks, notes);

      expect(result.suggestions.length).toBe(3);
      expect(result.masterGainDb).toBe(-0.3);
      expect(result.masterFxChain.length).toBeGreaterThan(0);
    });

    it("includes domain explanations", () => {
      const tracks = [makeTrack("Lead", "melody")];
      const result = agent.suggestMix(tracks, []);

      expect(result.domainExplanations.length).toBeGreaterThanOrEqual(3);
      expect(result.domainExplanations[0].label).toBeTruthy();
      expect(result.domainExplanations[0].text).toBeTruthy();
    });

    it("includes genre context when genre is provided", () => {
      const tracks = [makeTrack("Lead", "melody")];
      const result = agent.suggestMix(tracks, [], "jazz");

      const genreExplanation = result.domainExplanations.find((e) => e.label === "genre_hint");
      expect(genreExplanation).toBeDefined();
      expect(genreExplanation!.text).toContain("jazz");
    });

    it("each suggestion has reasoning", () => {
      const tracks = [makeTrack("Lead", "melody"), makeTrack("Bass", "bass")];
      const result = agent.suggestMix(tracks, []);

      for (const s of result.suggestions) {
        expect(s.reasoning).toBeTruthy();
        expect(s.reasoning.length).toBeGreaterThan(10);
      }
    });

    it("warns about multiple bass tracks", () => {
      const tracks = [makeTrack("Bass1", "bass"), makeTrack("Sub", "bass_sub")];
      const result = agent.suggestMix(tracks, []);

      expect(result.riskFlags.length).toBeGreaterThanOrEqual(1);
      expect(result.riskFlags.some((f) => f.includes("bass"))).toBe(true);
    });

    it("returns empty risk flags for normal mixes", () => {
      const tracks = [makeTrack("Lead", "melody"), makeTrack("Bass", "bass")];
      const result = agent.suggestMix(tracks, []);

      expect(result.riskFlags.length).toBe(0);
    });
  });

  describe("toDiffEnvelope", () => {
    it("returns a valid DiffEnvelope", () => {
      const tracks = [makeTrack("Lead", "melody"), makeTrack("Bass", "bass")];
      const mixer = makeMixer(tracks);
      const analysis = agent.suggestMix(tracks, []);
      const diff = agent.toDiffEnvelope(analysis, mixer);

      expect(diff.diffId).toBeTruthy();
      expect(diff.baseRevision).toBe("HEAD");
      expect(diff.actor.type).toBe("agent");
      expect(diff.actor.name).toBe("mixing");
      expect(diff.permissionScope).toBe("proposal_only");
      expect(diff.summary).toBeTruthy();
      expect(diff.ops.length).toBeGreaterThan(0);
      expect(diff.rollbackToken).toBeTruthy();
      expect(diff.createdAt).toBeTruthy();
    });

    it("includes ops for each track plus master", () => {
      const tracks = [makeTrack("Lead", "melody"), makeTrack("Bass", "bass")];
      const mixer = makeMixer(tracks);
      const analysis = agent.suggestMix(tracks, []);
      const diff = agent.toDiffEnvelope(analysis, mixer);

      expect(diff.ops.length).toBe(3);
    });

    it("carries domain explanations from analysis", () => {
      const tracks = [makeTrack("Lead", "melody")];
      const mixer = makeMixer(tracks);
      const analysis = agent.suggestMix(tracks, []);
      const diff = agent.toDiffEnvelope(analysis, mixer);

      expect(diff.domainExplanations.length).toBe(analysis.domainExplanations.length);
    });

    it("converts risk flags to DiffEnvelope format", () => {
      const tracks = [makeTrack("Bass1", "bass"), makeTrack("Sub", "bass_sub")];
      const mixer = makeMixer(tracks);
      const analysis = agent.suggestMix(tracks, []);
      const diff = agent.toDiffEnvelope(analysis, mixer);

      if (analysis.riskFlags.length > 0) {
        expect(diff.riskFlags.length).toBe(analysis.riskFlags.length);
        expect(diff.riskFlags[0].severity).toBe("medium");
      }
    });

    it("ops contain update_node with track data", () => {
      const tracks = [makeTrack("Lead", "melody")];
      const mixer = makeMixer(tracks);
      const analysis = agent.suggestMix(tracks, []);
      const diff = agent.toDiffEnvelope(analysis, mixer);

      for (const op of diff.ops) {
        expect(op.op).toBe("update_node");
        expect(op.path).toContain("/tracks/");
        if (op.op === "update_node") {
          expect(op.nodeId).toBeTruthy();
        }
      }
    });
  });
});
