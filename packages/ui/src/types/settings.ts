import type { MidiEffect } from "../services/midi-effects";

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
  /** v1.26.0 录入设置 */
  recording: {
    quantizeGrid: 0 | 0.25 | 0.5 | 1;
    velocityMode: 'live' | 'fixed';
    fixedVelocity: number; // 1-127
  };
  /** v2.0.0 Stage 2 (D2-5) 播放设置 */
  playback: {
    /** 播放头越视口时自动滚动跟随（原 v1.28 硬编码 true 的开关化） */
    followPlayhead: boolean;
    /** count-in 预备小节数（S3 消费；0 = 无 count-in） */
    countInBars: 0 | 1 | 2;
    /** v2.1.0 S2 (D12-4)：播放期节拍器（S2 消费；false = 仅 count-in 响） */
    metronome: boolean;
  };
  /**
   * v3.1.0：演奏期 MIDI 效果链（移调 / 力度）。
   * 只作用于发送前的事件流，不改工程音符 —— 因此属于会话设置而非工程数据。
   */
  effects: MidiEffect[];
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

/** v2.4.0 S1: LLM 提供方配置（密钥仅存本机，不落仓库） */
export interface AgentLlmSettings {
  provider: 'deepseek' | 'openai' | 'custom';
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  stream: boolean;
}

/** Agent设置 */
export interface AgentSettings {
  autoSuggest: boolean;
  explanationLevel: 'brief' | 'normal' | 'detailed';
  confirmationMode: 'always' | 'risky' | 'never';
  llm: AgentLlmSettings;
}

/** Taste设置 */
export interface TasteSettings {
  autoLearn: boolean;
  askConfirmation: boolean;
  projectOverlay: boolean;
}

/** 插件设置（v3.1.0） */
export interface PluginSettings {
  /** 自定义扫描目录；为空时用宿主默认目录（mac/Linux/Windows 各自的 VST3/CLAP 标准路径） */
  scanPaths: string[];
  /** 扫描到的插件是否记住「已忽略」状态（仅界面层，不影响宿主） */
  hideWithoutBinary: boolean;
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
  plugins: PluginSettings;
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
    // v1.26.0 (D2-2): 默认值 = v1.25 行为零回归（grid off + live velocity）
    recording: {
      quantizeGrid: 0,
      velocityMode: 'live',
      fixedVelocity: 100,
    },
    // v2.0.0 Stage 2 (D2-5): followPlayhead=true 与 v1.28 硬编码接线一致（零回归）；
    // countInBars=1 为 DAW 惯例默认（S3 消费）。
    playback: {
      followPlayhead: true,
      countInBars: 1,
      // v2.1.0 S2 (D12-4): 默认 false —— 与 v2.0.0 行为逐字一致（仅 count-in 响）
      metronome: false,
    },
    effects: [],
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
    // v2.4.0 S1：默认 DeepSeek；apiKey 留空（运行时由用户在设置页填写，
    // 或由构建期 VITE_DEEPSEEK_API_KEY 注入）。任何情况下都不得写入真实密钥。
    llm: {
      provider: 'deepseek',
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 0.7,
      stream: true,
    },
  },
  taste: {
    autoLearn: true,
    askConfirmation: true,
    projectOverlay: false,
  },
  plugins: {
    scanPaths: [],
    hideWithoutBinary: false,
  },
};

/** localStorage存储键 */
export const SETTINGS_STORAGE_KEY = 'collinx_settings';
