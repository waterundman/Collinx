import { midiToSpelling } from "./note-event";

export type InstrumentFamily =
  | "woodwind"
  | "brass"
  | "strings"
  | "percussion"
  | "keyboard"
  | "voice"
  | "electronic";

export interface InstrumentRange {
  minMidi: number;
  maxMidi: number;
  comfortableLow: number;
  comfortableHigh: number;
}

export interface Instrument {
  id: string;
  name: string;
  family: InstrumentFamily;
  range: InstrumentRange;
  transposition: number;
  clef: "treble" | "bass" | "alto" | "tenor" | "treble_8vb";
  techniques: string[];
  isPolyphonic: boolean;
  defaultVelocity: number;
}

export interface Player {
  id: string;
  name: string;
  instrumentId: string;
}

export const INSTRUMENTS: Record<string, Instrument> = {
  // ── Woodwinds ──
  flute: {
    id: "flute",
    name: "Flute",
    family: "woodwind",
    range: { minMidi: 72, maxMidi: 108, comfortableLow: 76, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "flutter_tongue", "trill"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  piccolo: {
    id: "piccolo",
    name: "Piccolo",
    family: "woodwind",
    range: { minMidi: 74, maxMidi: 108, comfortableLow: 78, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble_8vb",
    techniques: ["legato", "staccato", "trill"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  oboe: {
    id: "oboe",
    name: "Oboe",
    family: "woodwind",
    range: { minMidi: 58, maxMidi: 91, comfortableLow: 60, comfortableHigh: 84 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "trill", "vibrato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  english_horn: {
    id: "english_horn",
    name: "English Horn",
    family: "woodwind",
    range: { minMidi: 52, maxMidi: 77, comfortableLow: 55, comfortableHigh: 72 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "trill", "vibrato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  clarinet_bb: {
    id: "clarinet_bb",
    name: "Clarinet (Bb)",
    family: "woodwind",
    range: { minMidi: 50, maxMidi: 94, comfortableLow: 54, comfortableHigh: 84 },
    transposition: -2,
    clef: "treble",
    techniques: ["legato", "staccato", "trill", "glissando"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  bass_clarinet: {
    id: "bass_clarinet",
    name: "Bass Clarinet (Bb)",
    family: "woodwind",
    range: { minMidi: 37, maxMidi: 78, comfortableLow: 40, comfortableHigh: 70 },
    transposition: -2,
    clef: "treble",
    techniques: ["legato", "staccato", "trill"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  bassoon: {
    id: "bassoon",
    name: "Bassoon",
    family: "woodwind",
    range: { minMidi: 34, maxMidi: 72, comfortableLow: 38, comfortableHigh: 65 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato", "trill", "vibrato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  contrabassoon: {
    id: "contrabassoon",
    name: "Contrabassoon",
    family: "woodwind",
    range: { minMidi: 23, maxMidi: 53, comfortableLow: 29, comfortableHigh: 48 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },

  // ── Brass ──
  trumpet_bb: {
    id: "trumpet_bb",
    name: "Trumpet (Bb)",
    family: "brass",
    range: { minMidi: 55, maxMidi: 82, comfortableLow: 58, comfortableHigh: 77 },
    transposition: -2,
    clef: "treble",
    techniques: ["legato", "staccato", "mute", "trill", "glissando"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  horn_f: {
    id: "horn_f",
    name: "French Horn (F)",
    family: "brass",
    range: { minMidi: 34, maxMidi: 69, comfortableLow: 38, comfortableHigh: 65 },
    transposition: -7,
    clef: "treble",
    techniques: ["legato", "staccato", "mute", "stopped"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  trombone: {
    id: "trombone",
    name: "Trombone",
    family: "brass",
    range: { minMidi: 34, maxMidi: 67, comfortableLow: 38, comfortableHigh: 62 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato", "mute", "glissando"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  bass_trombone: {
    id: "bass_trombone",
    name: "Bass Trombone",
    family: "brass",
    range: { minMidi: 31, maxMidi: 58, comfortableLow: 34, comfortableHigh: 53 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato", "mute", "glissando"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  tuba: {
    id: "tuba",
    name: "Tuba",
    family: "brass",
    range: { minMidi: 28, maxMidi: 52, comfortableLow: 30, comfortableHigh: 48 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },

  // ── Strings ──
  violin: {
    id: "violin",
    name: "Violin",
    family: "strings",
    range: { minMidi: 55, maxMidi: 103, comfortableLow: 60, comfortableHigh: 91 },
    transposition: 0,
    clef: "treble",
    techniques: ["arco", "pizzicato", "con_sordino", "tremolo", "harmonics", "spiccato"],
    isPolyphonic: true,
    defaultVelocity: 0.7,
  },
  viola: {
    id: "viola",
    name: "Viola",
    family: "strings",
    range: { minMidi: 48, maxMidi: 81, comfortableLow: 55, comfortableHigh: 76 },
    transposition: 0,
    clef: "alto",
    techniques: ["arco", "pizzicato", "con_sordino", "tremolo", "harmonics", "spiccato"],
    isPolyphonic: true,
    defaultVelocity: 0.7,
  },
  cello: {
    id: "cello",
    name: "Cello",
    family: "strings",
    range: { minMidi: 36, maxMidi: 76, comfortableLow: 43, comfortableHigh: 72 },
    transposition: 0,
    clef: "bass",
    techniques: ["arco", "pizzicato", "con_sordino", "tremolo", "harmonics", "spiccato"],
    isPolyphonic: true,
    defaultVelocity: 0.7,
  },
  double_bass: {
    id: "double_bass",
    name: "Double Bass",
    family: "strings",
    range: { minMidi: 28, maxMidi: 55, comfortableLow: 31, comfortableHigh: 52 },
    transposition: -12,
    clef: "bass",
    techniques: ["arco", "pizzicato", "con_sordino", "tremolo", "harmonics"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  harp: {
    id: "harp",
    name: "Harp",
    family: "strings",
    range: { minMidi: 24, maxMidi: 103, comfortableLow: 36, comfortableHigh: 88 },
    transposition: 0,
    clef: "treble",
    techniques: ["arpeggio", "glissando", "harmonics", "bisbigliando"],
    isPolyphonic: true,
    defaultVelocity: 0.65,
  },
  classical_guitar: {
    id: "classical_guitar",
    name: "Classical Guitar",
    family: "strings",
    range: { minMidi: 48, maxMidi: 79, comfortableLow: 55, comfortableHigh: 76 },
    transposition: -12,
    clef: "treble_8vb",
    techniques: ["arpeggio", "rasgueado", "pizzicato", "tremolo"],
    isPolyphonic: true,
    defaultVelocity: 0.65,
  },

  // ── Keyboard ──
  piano: {
    id: "piano",
    name: "Piano",
    family: "keyboard",
    range: { minMidi: 21, maxMidi: 108, comfortableLow: 27, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "sustain", "soft_pedal"],
    isPolyphonic: true,
    defaultVelocity: 0.7,
  },
  harpsichord: {
    id: "harpsichord",
    name: "Harpsichord",
    family: "keyboard",
    range: { minMidi: 41, maxMidi: 89, comfortableLow: 48, comfortableHigh: 84 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "ornamentation"],
    isPolyphonic: true,
    defaultVelocity: 0.8,
  },
  organ: {
    id: "organ",
    name: "Pipe Organ",
    family: "keyboard",
    range: { minMidi: 36, maxMidi: 96, comfortableLow: 48, comfortableHigh: 84 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato"],
    isPolyphonic: true,
    defaultVelocity: 0.75,
  },
  celesta: {
    id: "celesta",
    name: "Celesta",
    family: "keyboard",
    range: { minMidi: 60, maxMidi: 108, comfortableLow: 67, comfortableHigh: 96 },
    transposition: -12,
    clef: "treble",
    techniques: ["legato", "staccato"],
    isPolyphonic: true,
    defaultVelocity: 0.65,
  },

  // ── Percussion ──
  timpani: {
    id: "timpani",
    name: "Timpani",
    family: "percussion",
    range: { minMidi: 33, maxMidi: 61, comfortableLow: 36, comfortableHigh: 57 },
    transposition: 0,
    clef: "bass",
    techniques: ["roll", "dampen", "glissando"],
    isPolyphonic: false,
    defaultVelocity: 0.8,
  },
  drum_kit: {
    id: "drum_kit",
    name: "Drum Kit",
    family: "percussion",
    range: { minMidi: 35, maxMidi: 81, comfortableLow: 36, comfortableHigh: 72 },
    transposition: 0,
    clef: "bass",
    techniques: [],
    isPolyphonic: false,
    defaultVelocity: 0.85,
  },
  xylophone: {
    id: "xylophone",
    name: "Xylophone",
    family: "percussion",
    range: { minMidi: 65, maxMidi: 108, comfortableLow: 72, comfortableHigh: 96 },
    transposition: -12,
    clef: "treble",
    techniques: ["roll", "staccato"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  vibraphone: {
    id: "vibraphone",
    name: "Vibraphone",
    family: "percussion",
    range: { minMidi: 53, maxMidi: 89, comfortableLow: 60, comfortableHigh: 84 },
    transposition: 0,
    clef: "treble",
    techniques: ["roll", "staccato", "motor"],
    isPolyphonic: true,
    defaultVelocity: 0.65,
  },
  marimba: {
    id: "marimba",
    name: "Marimba",
    family: "percussion",
    range: { minMidi: 45, maxMidi: 96, comfortableLow: 52, comfortableHigh: 84 },
    transposition: 0,
    clef: "treble",
    techniques: ["roll", "staccato"],
    isPolyphonic: true,
    defaultVelocity: 0.65,
  },

  // ── Voice ──
  voice_soprano: {
    id: "voice_soprano",
    name: "Soprano",
    family: "voice",
    range: { minMidi: 60, maxMidi: 81, comfortableLow: 65, comfortableHigh: 77 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "vibrato", "falsetto"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  voice_alto: {
    id: "voice_alto",
    name: "Alto",
    family: "voice",
    range: { minMidi: 55, maxMidi: 74, comfortableLow: 60, comfortableHigh: 72 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "vibrato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  voice_tenor: {
    id: "voice_tenor",
    name: "Tenor",
    family: "voice",
    range: { minMidi: 48, maxMidi: 69, comfortableLow: 53, comfortableHigh: 65 },
    transposition: -12,
    clef: "treble_8vb",
    techniques: ["legato", "staccato", "vibrato", "falsetto"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },
  voice_bass: {
    id: "voice_bass",
    name: "Bass",
    family: "voice",
    range: { minMidi: 40, maxMidi: 60, comfortableLow: 45, comfortableHigh: 57 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato", "vibrato"],
    isPolyphonic: false,
    defaultVelocity: 0.7,
  },

  // ── Electronic ──
  electric_guitar: {
    id: "electric_guitar",
    name: "Electric Guitar",
    family: "electronic",
    range: { minMidi: 40, maxMidi: 84, comfortableLow: 48, comfortableHigh: 76 },
    transposition: -12,
    clef: "treble_8vb",
    techniques: ["legato", "staccato", "bend", "slide", "harmonics", "palm_mute"],
    isPolyphonic: true,
    defaultVelocity: 0.75,
  },
  electric_bass: {
    id: "electric_bass",
    name: "Electric Bass",
    family: "electronic",
    range: { minMidi: 28, maxMidi: 55, comfortableLow: 31, comfortableHigh: 52 },
    transposition: -12,
    clef: "bass",
    techniques: ["legato", "staccato", "slap", "pop", "slide"],
    isPolyphonic: false,
    defaultVelocity: 0.8,
  },
  synth_lead: {
    id: "synth_lead",
    name: "Synth Lead",
    family: "electronic",
    range: { minMidi: 36, maxMidi: 108, comfortableLow: 48, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "portamento", "glide"],
    isPolyphonic: false,
    defaultVelocity: 0.75,
  },
  synth_pad: {
    id: "synth_pad",
    name: "Synth Pad",
    family: "electronic",
    range: { minMidi: 36, maxMidi: 108, comfortableLow: 48, comfortableHigh: 96 },
    transposition: 0,
    clef: "treble",
    techniques: ["legato", "staccato", "swell"],
    isPolyphonic: true,
    defaultVelocity: 0.6,
  },
  synth_bass: {
    id: "synth_bass",
    name: "Synth Bass",
    family: "electronic",
    range: { minMidi: 28, maxMidi: 60, comfortableLow: 31, comfortableHigh: 53 },
    transposition: 0,
    clef: "bass",
    techniques: ["legato", "staccato", "portamento"],
    isPolyphonic: false,
    defaultVelocity: 0.8,
  },
};

export function getInstrument(id: string): Instrument | undefined {
  return INSTRUMENTS[id];
}

export function getInstrumentsByFamily(family: InstrumentFamily): Instrument[] {
  return Object.values(INSTRUMENTS).filter((inst) => inst.family === family);
}

export function getAllInstruments(): Instrument[] {
  return Object.values(INSTRUMENTS);
}

export function midiInInstrumentRange(
  midi: number,
  instrument: Instrument,
): boolean {
  return midi >= instrument.range.minMidi && midi <= instrument.range.maxMidi;
}

export function midiInComfortableRange(
  midi: number,
  instrument: Instrument,
): boolean {
  return (
    midi >= instrument.range.comfortableLow &&
    midi <= instrument.range.comfortableHigh
  );
}

export function instrumentRangeLabel(instrument: Instrument): string {
  const low = midiToSpelling(instrument.range.minMidi);
  const high = midiToSpelling(instrument.range.maxMidi);
  return `${low}–${high}`;
}
