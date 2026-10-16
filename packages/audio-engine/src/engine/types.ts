/**
 * 引擎契约 —— 本包对外的**唯一**稳定面。
 *
 * ## 状态（v2.8.0，2026-10-16）
 *
 * ⚠️ **本包尚未接入产品，实现处于暂停状态。**
 *
 * 起因：仓库里早已存在一个基于 JUCE 的 C++ 引擎 `packages/audio`（约 18k 行，
 * DSP / VST3 / CLAP / MIDI / presets / sandbox / perf），它是 initial commit
 * 就在的资产，只是从未被构建过。本包最初是打算另起炉灶写一个 Web Audio 引擎，
 * 在得知 C++ 引擎的存在与规模后改为：**无论最终采用哪种实现，这份契约都成立**。
 *
 * 因此现在：
 * - `engine/types.ts`（本文件）—— **保留**，它是实现无关的契约；
 * - `core/`、`voice/` 下的 Web Audio 实现 —— **暂停**，等形态决策后再决定是否继续；
 * - C++ 引擎的可构建性验证改由 `.github/workflows/ci-audio.yml` 承担。
 *
 * 解耦规则（不变）：
 * 1. UI / 业务代码只允许依赖本文件的类型，禁止 import 引擎内部路径。
 * 2. 任何实现（原生 C++、WASM、Web Audio、第三方库）只要满足 `AudioEngine`
 *    即可替换，业务代码零改动。
 * 3. 本文件不引用任何 Web Audio 类型 —— 调用方不需要 DOM 音频知识。
 */

/** 一个待发声的音符。 */
export interface VoiceEvent {
  /** 调用方生成的唯一 id；`noteOff` 用它回收声部 */
  id: string;
  /** MIDI 音高（60 = C4） */
  midi: number;
  /** 力度 0..1 */
  velocity: number;
  /** 触发时刻（秒）。`undefined` = 立即；否则以引擎音频时钟为准 */
  at?: number;
  /** 发声时长（秒）；给了就自动 noteOff，优先于引擎默认 */
  durationSec?: number;
  /** 覆盖当前音色；不给则用引擎当前音色 */
  instrumentId?: string;
  /** 声像 -1..1 */
  pan?: number;
}

/** ADSR 包络参数（秒 / 0..1 保持电平） */
export interface EnvelopeSpec {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** 单个振荡器层的描述（合成音色用） */
export interface OscillatorLayer {
  wave: OscillatorType;
  /** 相对音高的倍频；1 = 同度，2 = 高八度，0.5 = 低八度 */
  ratio: number;
  gain: number;
  /** 失谐（音分），用于合唱/加厚 */
  detuneCents?: number;
  /** 音高是否跟随包络滑向（打击乐用） */
  pitchDropOctaves?: number;
  /** 噪声层（鼓组打击声用） */
  noise?: boolean;
  /** 噪声滤波起始频率（Hz） */
  noiseFilterHz?: number;
}

/** 音色来源：纯合成，或采样（SF2）。 */
export type InstrumentSource = "synth" | "soundfont";

/** 音色定义 —— **数据驱动**，新增音色只加一条，不改引擎代码。 */
export interface InstrumentSpec {
  id: string;
  name: string;
  source: InstrumentSource;
  /** 合成音色：振荡器层 */
  layers?: OscillatorLayer[];
  /** 合成音色：包络 */
  envelope?: EnvelopeSpec;
  /** 低通滤波截止（Hz），随包络开合 */
  filter?: {
    cutoffHz: number;
    /** 包络对滤波的调制量 0..1 */
    envAmount: number;
    q?: number;
  };
  /** 采样音色：对应 SF2 的音色名/预设名 */
  soundfont?: { presetName: string; fallbackTo: string };
  /** 无 SF2 时回退到哪个合成音色 */
  fallbackInstrumentId?: string;
  /** 触发时的噪声（击弦/拨弦瞬态） */
  transient?: { noise: boolean; level: number; filterHz: number };
  gain: number;
}

/** 引擎运行统计（用于真实性能面板，不填假数据） */
export interface EngineStats {
  /** 是否已解锁（浏览器手势后才有音频输出） */
  ready: boolean;
  sampleRate: number;
  /** 当前活跃声部数 */
  activeVoices: number;
  /** 峰值（声部池上限） */
  maxVoices: number;
  /** 主输出实测峰值电平 0..1（由 AnalyserNode 得出） */
  outputPeak: number;
  /** 当前音色 id */
  instrumentId: string;
  /** 已加载的 SF2 音色库数量 */
  loadedSoundfonts: number;
}

/**
 * 引擎接口 —— UI 与引擎之间的全部契约。
 *
 * 时钟约定：所有 `at` 都是**引擎音频时钟**（AudioContext.currentTime）秒，
 * 与业务侧使用的 `performance.now()` 是两个时钟域，跨域换算必须显式进行
 * （见 `core/clock.ts`），绝不可混用。
 */
export interface AudioEngine {
  readonly ready: boolean;

  /** 用户手势后调用以解锁音频；重复调用无副作用 */
  unlock(): Promise<void>;

  /** 立即发声 */
  noteOn(event: VoiceEvent): void;

  /** 回收声部（id 来自 noteOn） */
  noteOff(id: string): void;

  /** 精确调度一批事件；atSec 为音频时钟秒 */
  schedule(events: VoiceEvent[], atSec: number): void;

  /** 全部停止（立即释放所有声部） */
  allNotesOff(): void;

  setMasterVolume(volume: number): void;

  /** 切换当前音色 */
  setInstrument(instrumentId: string): void;

  /** 列出可用音色（含未加载采样的合成回退） */
  listInstruments(): InstrumentSpec[];

  /**
   * 加载 SF2 音色库。成功后 `soundfont` 类型的音色开始使用真实采样，
   * 失败时保持合成回退（不抛错 —— 音频不可用不应中断编辑）。
   */
  loadSoundfont(url: string): Promise<boolean>;

  /** 离线渲染（导出音频），与实时播放同一套合成逻辑 */
  renderOffline(events: VoiceEvent[], sampleRate: number): Promise<AudioBuffer>;

  getStats(): EngineStats;

  dispose(): void;
}
