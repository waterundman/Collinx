export interface MidiEffectParam {
  index: number;
  name: string;
  value: number;
  displayText: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface MidiEffectInfo {
  id: number;
  name: string;
  bypassed: boolean;
  active: boolean;
  prepared: boolean;
  midiChannel: number;
  params: MidiEffectParam[];
  filterNoteOn: boolean;
  filterNoteOff: boolean;
  filterControlChange: boolean;
  filterProgramChange: boolean;
  filterPitchBend: boolean;
  filterAftertouch: boolean;
}

export interface MidiEffectChainState {
  effects: MidiEffectInfo[];
  chainBypassed: boolean;
  isPrepared: boolean;
}

export interface ChannelMapping {
  inputChannel: number;
  outputChannel: number;
}

export interface ControllerMapping {
  inputCC: number;
  outputCC: number;
  channel: number;
}

export interface MidiRouterState {
  channelMappings: ChannelMapping[];
  controllerMappings: ControllerMapping[];
  filterNoteOn: boolean;
  filterNoteOff: boolean;
  filterControlChange: boolean;
  filterProgramChange: boolean;
  filterPitchBend: boolean;
  filterAftertouch: boolean;
  filterSysEx: boolean;
  outputIds: number[];
  isPrepared: boolean;
}

export interface MidiEffectType {
  id: string;
  name: string;
  description: string;
  defaultParams: MidiEffectParam[];
}

export const MIDI_EFFECT_TYPES: MidiEffectType[] = [
  {
    id: "transposer",
    name: "Transposer",
    description: "Transpose MIDI notes by semitones",
    defaultParams: [
      { index: 0, name: "Semitones", value: 0, displayText: "0", min: -24, max: 24, step: 1, unit: " st" },
    ],
  },
  {
    id: "velocity_scaler",
    name: "Velocity Scaler",
    description: "Scale MIDI velocity values",
    defaultParams: [
      { index: 0, name: "Scale", value: 1, displayText: "100%", min: 0, max: 2, step: 0.01, unit: "" },
      { index: 1, name: "Offset", value: 0, displayText: "0", min: -127, max: 127, step: 1, unit: "" },
    ],
  },
  {
    id: "note_filter",
    name: "Note Filter",
    description: "Filter MIDI notes by range",
    defaultParams: [
      { index: 0, name: "Low Note", value: 0, displayText: "C-1", min: 0, max: 127, step: 1, unit: "" },
      { index: 1, name: "High Note", value: 127, displayText: "G9", min: 0, max: 127, step: 1, unit: "" },
    ],
  },
  {
    id: "cc_mapper",
    name: "CC Mapper",
    description: "Remap one MIDI CC to another",
    defaultParams: [
      { index: 0, name: "Input CC", value: 1, displayText: "CC1", min: 0, max: 127, step: 1, unit: "" },
      { index: 1, name: "Output CC", value: 11, displayText: "CC11", min: 0, max: 127, step: 1, unit: "" },
    ],
  },
  {
    id: "arpeggiator",
    name: "Arpeggiator",
    description: "Generate arpeggiated patterns from held notes",
    defaultParams: [
      { index: 0, name: "Rate", value: 0.5, displayText: "1/8", min: 0, max: 1, step: 0.01, unit: "" },
      { index: 1, name: "Gate", value: 0.5, displayText: "50%", min: 0, max: 1, step: 0.01, unit: "" },
      { index: 2, name: "Octave Range", value: 1, displayText: "1", min: 1, max: 4, step: 1, unit: " oct" },
    ],
  },
  {
    id: "chord_generator",
    name: "Chord Generator",
    description: "Generate chords from single notes",
    defaultParams: [
      { index: 0, name: "Voicing", value: 0, displayText: "Major", min: 0, max: 7, step: 1, unit: "" },
      { index: 1, name: "Spread", value: 0, displayText: "Close", min: 0, max: 3, step: 1, unit: "" },
    ],
  },
];

export const MIDI_CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

export const MIDI_CC_NAMES: Record<number, string> = {
  0: "Bank Select",
  1: "Mod Wheel",
  2: "Breath",
  4: "Foot Ctrl",
  5: "Portamento",
  7: "Volume",
  8: "Balance",
  10: "Pan",
  11: "Expression",
  64: "Sustain",
  65: "Portamento Sw",
  66: "Sostenuto",
  67: "Soft Pedal",
  71: "Resonance",
  74: "Cutoff",
  91: "Reverb",
  92: "Tremolo",
  93: "Chorus",
  94: "Detune",
  95: "Phaser",
};
