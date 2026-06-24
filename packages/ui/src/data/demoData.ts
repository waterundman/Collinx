import {
  NoteEvent,
  MixerState,
  MixerTrack,
  createNoteEvent,
  createTrack,
  TasteStore,
  TasteGenome,
  DiffEnvelope,
  randomUUID,
} from "@collinx/core";
import i18n from "../i18n";
import type { Layout } from "../components/Score";
import type { HouseStyle } from "../components/Score";
import type { GraphData } from "../components/KnowledgeGraph";
import type { ChatMessage } from "../components/Agent";

export function createDemoMixer(): MixerState {
  return {
    tracks: [
      createTrack(i18n.t("app.tracks.melody"), "melody"),
      createTrack(i18n.t("app.tracks.bass"), "bass"),
      createTrack(i18n.t("app.tracks.chords"), "chords"),
    ],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

export function createDemoNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64, pitchSpelling: "E4", velocity: 0.8, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 2, durQn: 0.5, pitchMidi: 66, pitchSpelling: "F#4", velocity: 0.75, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 2.5, durQn: 0.5, pitchMidi: 67, pitchSpelling: "G4", velocity: 0.7, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 3, durQn: 1, pitchMidi: 69, pitchSpelling: "A4", velocity: 0.85, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 2, pitchMidi: 71, pitchSpelling: "B4", velocity: 0.8, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 3, durQn: 0.5, pitchMidi: 69, pitchSpelling: "A4", velocity: 0.7, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 3.5, durQn: 0.5, pitchMidi: 67, pitchSpelling: "G4", velocity: 0.7, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 3, beat: 1, durQn: 1, pitchMidi: 66, pitchSpelling: "F#4", velocity: 0.8, voice: "rh" }),
    createNoteEvent({ trackId: "melody", bar: 3, beat: 2, durQn: 2, pitchMidi: 64, pitchSpelling: "E4", velocity: 0.75, voice: "rh" }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 4, pitchMidi: 40, pitchSpelling: "E2", velocity: 0.7, voice: "lh" }),
    createNoteEvent({ trackId: "bass", bar: 2, beat: 1, durQn: 4, pitchMidi: 43, pitchSpelling: "G2", velocity: 0.7, voice: "lh" }),
    createNoteEvent({ trackId: "bass", bar: 3, beat: 1, durQn: 2, pitchMidi: 42, pitchSpelling: "F#2", velocity: 0.7, voice: "lh" }),
    createNoteEvent({ trackId: "bass", bar: 3, beat: 3, durQn: 2, pitchMidi: 40, pitchSpelling: "E2", velocity: 0.65, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 1, beat: 1, durQn: 4, pitchMidi: 52, pitchSpelling: "E3", velocity: 0.6, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 1, beat: 1, durQn: 4, pitchMidi: 56, pitchSpelling: "G#3", velocity: 0.6, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 1, beat: 1, durQn: 4, pitchMidi: 59, pitchSpelling: "B3", velocity: 0.6, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 2, beat: 1, durQn: 4, pitchMidi: 50, pitchSpelling: "D3", velocity: 0.55, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 2, beat: 1, durQn: 4, pitchMidi: 55, pitchSpelling: "G3", velocity: 0.55, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 2, beat: 1, durQn: 4, pitchMidi: 59, pitchSpelling: "B3", velocity: 0.55, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 3, beat: 1, durQn: 4, pitchMidi: 54, pitchSpelling: "F#3", velocity: 0.6, voice: "lh" }),
    createNoteEvent({ trackId: "chords", bar: 3, beat: 1, durQn: 4, pitchMidi: 57, pitchSpelling: "A3", velocity: 0.6, voice: "lh" }),
  ];
}

export const demoPhrases = [
  { id: "intro", name: "Intro", startBar: 1, endBar: 1, formRole: "intro" },
  { id: "verse1", name: "Verse A", startBar: 2, endBar: 3, formRole: "verse" },
  { id: "chorus1", name: "Chorus", startBar: 4, endBar: 5, formRole: "chorus" },
  { id: "verse2", name: "Verse B", startBar: 6, endBar: 7, formRole: "verse" },
  { id: "bridge", name: "Bridge", startBar: 8, endBar: 9, formRole: "bridge" },
  { id: "chorus2", name: "Final Chorus", startBar: 10, endBar: 12, formRole: "outro_chorus" },
  { id: "outro", name: "Outro", startBar: 13, endBar: 14, formRole: "outro" },
];

export const demoMotifs = [
  { id: "motif_a", name: "Melody Motif", notes: [] },
  { id: "motif_b", name: "Bass Groove", notes: [] },
  { id: "motif_c", name: "Harmony Progression", notes: [] },
];

export function createDefaultLayout(): Layout {
  return {
    id: randomUUID(),
    name: "Default Layout",
    type: "full_score",
    staves: [],
    players: [],
    systemBreaks: [],
    globalStaffSize: 7,
    pageWidth: 210,
    pageHeight: 297,
    margins: { top: 15, bottom: 15, left: 20, right: 20 },
    stavesPerPage: 10,
    staffDistance: 12,
    staffConfig: [
      { clef: "treble", name: i18n.t("app.tracks.melody"), bars: 4 },
      { clef: "bass", name: i18n.t("common.track"), bars: 4 },
    ],
  };
}

export const defaultHouseStyle: HouseStyle = {
  id: "default",
  name: "Default House Style",
  rules: [
    { path: "note.spacing", value: "1.0" },
    { path: "slur.thickness", value: "0.16" },
    { path: "beam.thickness", value: "0.5" },
  ],
  smuflFont: "Bravura",
  fontFamily: "Bravura",
  stemDirection: "auto",
  beamStyle: "modern",
  tieStyle: "curved",
  notationSize: 3.2,
};

export function createDemoGraph(translatedMotifs: { id: string; name: string }[], t: (key: string) => string): GraphData {
  return {
    nodes: [
      ...demoPhrases.map((p) => ({ id: p.id, type: "Phrase", data: { name: p.name, formRole: p.formRole } })),
      ...translatedMotifs.map((m) => ({ id: m.id, type: "Motif", data: { name: m.name } })),
      { id: "track_melody", type: "Track", data: { name: t("app.tracks.melody") } },
      { id: "track_bass", type: "Track", data: { name: t("app.tracks.bass") } },
      { id: "track_chords", type: "Track", data: { name: t("app.tracks.chords") } },
      { id: "export_v1", type: "ExportVersion", data: { name: "Export v1", format: "wav" } },
      { id: "taste_e1", type: "TasteEvidence", data: { name: "User Preference", confidence: "0.85" } },
    ],
    edges: [
      { source: "intro", target: "motif_a", type: "uses" },
      { source: "verse1", target: "motif_a", type: "uses" },
      { source: "verse1", target: "motif_b", type: "uses" },
      { source: "chorus1", target: "motif_a", type: "uses" },
      { source: "chorus1", target: "motif_c", type: "uses" },
      { source: "bridge", target: "motif_c", type: "uses" },
      { source: "motif_a", target: "track_melody", type: "rendered_on" },
      { source: "motif_b", target: "track_bass", type: "rendered_on" },
      { source: "motif_c", target: "track_chords", type: "rendered_on" },
      { source: "track_melody", target: "export_v1", type: "exported_in" },
      { source: "track_bass", target: "export_v1", type: "exported_in" },
      { source: "taste_e1", target: "motif_a", type: "influences" },
      { source: "chorus2", target: "chorus1", type: "derived_from" },
      { source: "verse2", target: "verse1", type: "derived_from" },
    ],
  };
}

export const agentPendingDiffs: DiffEnvelope[] = [
  {
    diffId: "agent-diff-001",
    baseRevision: "rev-10",
    actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
    permissionScope: "proposal_only",
    summary: "Add secondary dominants to bridge section (bars 8-9) for stronger harmonic drive",
    ops: [
      { op: "add_node", path: "/tracks/chords", nodeType: "chord_track", data: { bars: [8, 9] } },
      { op: "update_node", path: "/tracks/melody", nodeId: "mel-bridge", data: { velocity: 0.85 } },
    ],
    domainExplanations: [
      { label: "Harmony", text: "Applied V/V → V → I progression in bars 8-9, creating stronger pull to the chorus" },
      { label: "Voice Leading", text: "Soprano line moves by step; bass uses descending fifths" },
    ],
    evidenceRefs: [],
    rollbackToken: "rb-agent-001",
    riskFlags: [],
    createdAt: new Date().toISOString(),
  },
  {
    diffId: "agent-diff-002",
    baseRevision: "rev-10",
    actor: { type: "agent", name: "BassAgent", model: "claude-3" },
    permissionScope: "proposal_only",
    summary: "Redesign bass line with syncopated rhythm and passing tones",
    ops: [
      { op: "remove_node", path: "/tracks/bass", nodeId: "bass-old" },
      { op: "add_node", path: "/tracks/bass", nodeType: "bass_track", data: { style: "syncopated" } },
      { op: "add_note_group", path: "/tracks/bass/notes", notes: [] },
      { op: "update_meta", path: "/project", data: { title: "Updated Project" } },
    ],
    domainExplanations: [
      { label: "Rhythm", text: "Shifted bass hits to off-beats for a funkier groove" },
      { label: "Bass Technique", text: "Added ghost notes and slides between chord tones" },
    ],
    evidenceRefs: [],
    rollbackToken: "rb-agent-002",
    riskFlags: [
      { type: "tempo_change", severity: "medium", description: "Tempo change from 120 to 128 BPM affects all tracks" },
    ],
    createdAt: new Date(Date.now() - 60000).toISOString(),
  },
];

export const agentHistoryDiffs: DiffEnvelope[] = [
  {
    diffId: "agent-diff-h001",
    baseRevision: "rev-8",
    actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
    permissionScope: "proposal_only",
    summary: "Added ii-V-I progression to verse section",
    ops: [
      { op: "add_node", path: "/tracks/chords", nodeType: "chord_track", data: {} },
    ],
    domainExplanations: [
      { label: "Harmony", text: "Standard jazz ii-V-I with tritone substitution on the V" },
    ],
    evidenceRefs: [],
    rollbackToken: "rb-hist-001",
    riskFlags: [],
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    diffId: "agent-diff-h004",
    baseRevision: "rev-7",
    actor: { type: "agent", name: "DrumBot", model: "gpt-4o-mini" },
    permissionScope: "read_only",
    summary: "Suggested breakbeat pattern for intro",
    ops: [
      { op: "add_node", path: "/tracks/drums", nodeType: "drum_pattern", data: { style: "breakbeat" } },
    ],
    domainExplanations: [],
    evidenceRefs: [],
    rollbackToken: "rb-hist-002",
    riskFlags: [
      { type: "style_mismatch", severity: "low", description: "Breakbeat may not fit the ambient intro" },
    ],
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export function createTasteStore(): TasteStore {
  const tasteStore = new TasteStore();
  const defaultGenome = TasteGenome.createDefault();
  tasteStore.save(defaultGenome.clone());
  return tasteStore;
}
