import {
  type MixerTrack,
  type MixerState,
  type FXSlot,
  type NoteEvent,
  type DiffEnvelope,
  type MixerChange,
  createFXSlot,
  mixerToDiff,
} from "@collinx/core";

export interface MixSuggestion {
  trackId: string;
  trackName: string;
  gainDb: number;
  pan: number;
  fxChain: FXSlot[];
  sends: Array<{ targetBus: string; levelDb: number }>;
  reasoning: string;
}

export interface MixAnalysis {
  suggestions: MixSuggestion[];
  masterGainDb: number;
  masterFxChain: FXSlot[];
  domainExplanations: Array<{ label: string; text: string }>;
  riskFlags: string[];
}

type SourceRole = "melody" | "bass" | "chords" | "drums" | "default";

function classifySource(sourceId: string): SourceRole {
  const id = sourceId.toLowerCase();
  if (id.includes("melody") || id.includes("lead") || id.includes("vocal")) return "melody";
  if (id.includes("bass") || id.includes("sub") || id.includes("kick")) return "bass";
  if (id.includes("chord") || id.includes("pad") || id.includes("keys")) return "chords";
  if (id.includes("drum") || id.includes("perc") || id.includes("hat") || id.includes("snare")) return "drums";
  return "default";
}

function buildMelodyChain(): FXSlot[] {
  const eq = createFXSlot("eq", "builtin:warm_keys");
  eq.params = { lowGainDb: "+2", midGainDb: "+1", highGainDb: "-1", lowFreq: "200", midFreq: "2500", highFreq: "8000", lowQ: "0.7", midQ: "1.0", highQ: "0.7" };
  const comp = createFXSlot("compressor", "builtin:gentle_glue");
  comp.params = { thresholdDb: "-18", ratio: "2", attackMs: "30", releaseMs: "100", makeupGainDb: "2", knee: "6" };
  return [eq, comp];
}

function buildBassChain(): FXSlot[] {
  const eq = createFXSlot("eq", "custom:bass_boost");
  eq.params = { lowGainDb: "+4", midGainDb: "+1", highGainDb: "-2", lowFreq: "80", midFreq: "200", highFreq: "2000", lowQ: "0.7", midQ: "1.0", highQ: "0.7" };
  const comp = createFXSlot("compressor", "builtin:gentle_glue");
  comp.params = { thresholdDb: "-18", ratio: "2", attackMs: "30", releaseMs: "100", makeupGainDb: "2", knee: "6" };
  return [eq, comp];
}

function buildChordsChain(): FXSlot[] {
  const eq = createFXSlot("eq", "builtin:warm_keys");
  eq.params = { lowGainDb: "+2", midGainDb: "+1", highGainDb: "-1", lowFreq: "200", midFreq: "1500", highFreq: "6000", lowQ: "0.7", midQ: "1.0", highQ: "0.7" };
  const rev = createFXSlot("reverb", "builtin:small_room");
  rev.params = { roomSize: "0.3", damping: "0.5", width: "1.0", wetLevel: "0.2", dryLevel: "0.8", preDelayMs: "10" };
  return [eq, rev];
}

function buildDrumsChain(): FXSlot[] {
  const eq = createFXSlot("eq", "custom:presence_lift");
  eq.params = { lowGainDb: "+1", midGainDb: "-2", highGainDb: "+3", lowFreq: "100", midFreq: "400", highFreq: "5000", lowQ: "0.7", midQ: "1.0", highQ: "0.7" };
  const comp = createFXSlot("compressor", "builtin:punchy_drums");
  comp.params = { thresholdDb: "-12", ratio: "4", attackMs: "10", releaseMs: "60", makeupGainDb: "4", knee: "2" };
  return [eq, comp];
}

function buildDefaultChain(): FXSlot[] {
  const eq = createFXSlot("eq", "custom:flat");
  eq.params = { lowGainDb: "0", midGainDb: "0", highGainDb: "0", lowFreq: "200", midFreq: "1000", highFreq: "5000", lowQ: "0.7", midQ: "1.0", highQ: "0.7" };
  return [eq];
}

function chainForSource(sourceId: string): FXSlot[] {
  const role = classifySource(sourceId);
  switch (role) {
    case "melody": return buildMelodyChain();
    case "bass": return buildBassChain();
    case "chords": return buildChordsChain();
    case "drums": return buildDrumsChain();
    default: return buildDefaultChain();
  }
}

function gainForSource(sourceId: string): number {
  const role = classifySource(sourceId);
  switch (role) {
    case "melody": return -3;
    case "bass": return -4;
    case "chords": return -6;
    default: return -8;
  }
}

function panForTrack(track: MixerTrack, index: number, total: number): number {
  const role = classifySource(track.sourceTrackId);
  if (role === "melody") return 0;
  if (role === "bass") return 0;
  if (role === "chords") return -0.3;

  const others = total - 3;
  if (others <= 0) return 0;
  const pos = (index / Math.max(others - 1, 1)) * 2 - 1;
  return Math.round(Math.max(-1, Math.min(1, pos)) * 100) / 100;
}

export class MixingAgent {
  suggestChain(sourceId: string, _notes?: NoteEvent[]): FXSlot[] {
    return chainForSource(sourceId);
  }

  suggestGain(tracks: MixerTrack[]): Array<{ trackId: string; gainDb: number }> {
    return tracks.map((t) => ({ trackId: t.id, gainDb: gainForSource(t.sourceTrackId) }));
  }

  suggestPan(tracks: MixerTrack[]): Array<{ trackId: string; pan: number }> {
    return tracks.map((t, i) => ({ trackId: t.id, pan: panForTrack(t, i, tracks.length) }));
  }

  suggestMix(tracks: MixerTrack[], notes: NoteEvent[], genre?: string): MixAnalysis {
    const gains = this.suggestGain(tracks);
    const pans = this.suggestPan(tracks);

    const suggestions: MixSuggestion[] = tracks.map((track, i) => {
      const role = classifySource(track.sourceTrackId);
      const fxChain = chainForSource(track.sourceTrackId);
      const gainDb = gains[i]?.gainDb ?? -8;
      const pan = pans[i]?.pan ?? 0;

      let reasoning: string;
      switch (role) {
        case "melody":
          reasoning = "Melody track: gentle EQ tilt for warmth, light compression for cohesion, centered pan for focus.";
          break;
        case "bass":
          reasoning = "Bass track: boost low frequencies for foundation, gentle compression to even out dynamics, centered for mono compatibility.";
          break;
        case "chords":
          reasoning = "Chords track: warm EQ shaping, short reverb for depth, slightly panned left for stereo width.";
          break;
        case "drums":
          reasoning = "Drums track: presence lift in highs, parallel compression for punch and impact.";
          break;
        default:
          reasoning = "Default track: flat EQ starting point, adjust to taste.";
      }

      return {
        trackId: track.id,
        trackName: track.name,
        gainDb,
        pan,
        fxChain,
        sends: [],
        reasoning,
      };
    });

    const masterFxChain: FXSlot[] = [
      (() => { const s = createFXSlot("eq", "builtin:cut_mud"); s.params = { lowGainDb: "0", midGainDb: "-1", highGainDb: "+1", lowFreq: "100", midFreq: "300", highFreq: "8000", lowQ: "0.7", midQ: "1.2", highQ: "0.7" }; return s; })(),
      (() => { const s = createFXSlot("compressor", "builtin:gentle_glue"); s.params = { thresholdDb: "-6", ratio: "1.5", attackMs: "50", releaseMs: "200", makeupGainDb: "1", knee: "10" }; return s; })(),
      (() => { const s = createFXSlot("limiter", "custom:ceiling"); s.params = { ceiling: "0.95" }; return s; })(),
    ];

    const domainExplanations: Array<{ label: string; text: string }> = [
      { label: "gain_structure", text: "Headroom distribution: melody -3dB, bass -4dB, chords -6dB, others -8dB. Keeps the mix clean with room for transients." },
      { label: "stereo_image", text: "Melody and bass centered for focus and power. Chords slightly left, other elements spread across the stereo field." },
      { label: "fx_chain", text: "EQ shapes the tonal balance, compressors control dynamics, reverb adds spatial depth. Each chain is tailored to the instrument role." },
    ];

    if (genre) {
      domainExplanations.push({ label: "genre_hint", text: `Genre "${genre}" noted. Preset selection uses general-purpose defaults; genre-specific chains can be layered in future iterations.` });
    }

    const riskFlags: string[] = [];
    const bassCount = tracks.filter((t) => classifySource(t.sourceTrackId) === "bass").length;
    if (bassCount > 1) riskFlags.push("Multiple bass-classified tracks may cause low-end masking");
    if (tracks.length > 16) riskFlags.push("Large track count may require subgroup routing for manageability");

    return {
      suggestions,
      masterGainDb: -0.3,
      masterFxChain,
      domainExplanations,
      riskFlags,
    };
  }

  toDiffEnvelope(analysis: MixAnalysis, currentMixer: MixerState): DiffEnvelope {
    const changes: MixerChange[] = [];

    for (const s of analysis.suggestions) {
      const fxChanges = s.fxChain.map((slot, idx) => ({
        slotIndex: idx,
        changes: { type: slot.type, preset: slot.preset, params: slot.params, enabled: slot.enabled },
      }));

      changes.push({
        trackId: s.trackId,
        changes: { gainDb: String(s.gainDb), pan: String(s.pan) },
        fxChanges,
      });
    }

    const masterFxChanges = analysis.masterFxChain.map((slot, idx) => ({
      slotIndex: idx,
      changes: { type: slot.type, preset: slot.preset, params: slot.params, enabled: slot.enabled },
    }));

    changes.push({
      trackId: currentMixer.masterTrack.id,
      changes: { gainDb: String(analysis.masterGainDb) },
      fxChanges: masterFxChanges,
    });

    const diff = mixerToDiff(changes, "HEAD");

    return {
      ...diff,
      actor: { type: "agent", name: "mixing" },
      permissionScope: "proposal_only",
      summary: `Mix suggestion: ${analysis.suggestions.length} tracks + master`,
      domainExplanations: analysis.domainExplanations,
      riskFlags: analysis.riskFlags.map((r) => ({ type: "mix_risk", severity: "medium" as const, description: r })),
    };
  }
}
