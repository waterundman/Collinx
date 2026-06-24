/** 通用设置 */
export interface GeneralSettings {
  language: string;
  theme: 'light' | 'dark' | 'system';
  autoSave: {
    enabled: boolean;
    interval: number;
  };
  undoHistory: {
    maxLevels: number | 'unlimited';
  };
}

/** 音频设置 */
export interface AudioSettings {
  audioDevice: {
    input: string;
    output: string;
  };
  sampleRate: number;
  bufferSize: number;
  latency: number;
}

/** MIDI设置 */
export interface MidiSettings {
  midiDevice: {
    input: string;
    output: string;
  };
  midiMapping: Record<string, string>;
  midiChannel: number; // MIDI通道 (1-16)
}

/** 混音设置 */
export interface MixerSettings {
  defaultFXChain: string[];
  loudnessNormalization: boolean;
}

/** 记谱设置 */
export interface ScoreSettings {
  scoreFont: string;
  scoreSize: number;
  exportFormat: 'pdf' | 'musicxml' | 'midi';
}

/** Agent设置 */
export interface AgentSettings {
  autoSuggest: boolean;
  explanationLevel: 'brief' | 'normal' | 'detailed';
  confirmationMode: 'always' | 'risky' | 'never';
}

/** Taste设置 */
export interface TasteSettings {
  autoLearn: boolean;
  askConfirmation: boolean;
  projectOverlay: boolean;
}

/** 完整设置类型 */
export interface AppSettings {
  general: GeneralSettings;
  audio: AudioSettings;
  midi: MidiSettings;
  mixer: MixerSettings;
  score: ScoreSettings;
  agent: AgentSettings;
  taste: TasteSettings;
}

/** 设置类别键 */
export type SettingsCategory = keyof AppSettings;

/** 局部设置更新类型 */
export type PartialSettings = {
  [K in SettingsCategory]?: Partial<AppSettings[K]>;
};

/** 默认设置值 */
export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'zh-CN',
    theme: 'system',
    autoSave: {
      enabled: true,
      interval: 300,
    },
    undoHistory: {
      maxLevels: 'unlimited',
    },
  },
  audio: {
    audioDevice: {
      input: 'default',
      output: 'default',
    },
    sampleRate: 44100,
    bufferSize: 256,
    latency: 10,
  },
  midi: {
    midiDevice: {
      input: 'default',
      output: 'default',
    },
    midiMapping: {},
    midiChannel: 1,
  },
  mixer: {
    defaultFXChain: [],
    loudnessNormalization: true,
  },
  score: {
    scoreFont: 'Bravura',
    scoreSize: 3.2,
    exportFormat: 'pdf',
  },
  agent: {
    autoSuggest: true,
    explanationLevel: 'normal',
    confirmationMode: 'risky',
  },
  taste: {
    autoLearn: true,
    askConfirmation: true,
    projectOverlay: false,
  },
};

/** localStorage存储键 */
export const SETTINGS_STORAGE_KEY = 'collinx_settings';
