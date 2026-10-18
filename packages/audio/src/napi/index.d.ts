/**
 * Type definitions for Collinx VST3 Host N-API addon.
 *
 * Usage:
 *   import { PluginManagerBridge, AudioProcessorBridge } from '@collinx/audio-native';
 */

export interface PluginDescription {
  name: string;
  identifier: string;
  manufacturerName: string;
  version: string;
  category: string;
  isInstrument: boolean;
  numInputChannels: number;
  numOutputChannels: number;
  pluginFormatName: string;
  fileOrIdentifier: string;
  uniqueId: number;
}

export interface LoadedPluginInfo {
  index: number;
  name: string;
  vendor: string;
  category: string;
  isInstrument: boolean;
  numInputChannels: number;
  numOutputChannels: number;
  isActive: boolean;
  isPrepared: boolean;
  identifier: string;
}

export interface PluginInfo {
  id: number;
  name: string;
  isPrepared: boolean;
  isActive: boolean;
  isBypassed: boolean;
  isSilent: boolean;
  numParameters: number;
}

export interface ParameterInfo {
  index: number;
  name: string;
  value: number;
  text: string;
}

export interface MidiMessage {
  status: number;
  data1: number;
  data2: number;
  timestamp: number;
}

export declare class PluginManagerBridge {
  constructor();

  /** Initialize the VST3 host manager. Returns true on success. */
  initialize(): boolean;

  /** Shutdown the host manager and unload all plugins. */
  shutdown(): void;

  /** Check if the host manager is initialized. */
  isInitialized(): boolean;

  /** Scan for plugins in default VST3 directories. Returns Promise<PluginDescription[]>. */
  scanDefaultPaths(): Promise<PluginDescription[]>;

  /** Scan for plugins in a specific directory. Returns Promise<PluginDescription[]>. */
  scanDirectory(directoryPath: string): Promise<PluginDescription[]>;

  /** Get cached scan results. */
  getCachedResults(): PluginDescription[];

  /** Clear the scan cache. */
  clearCache(): void;

  /** Get default VST3 scan paths for the current platform. */
  getDefaultScanPaths(): string[];

  /**
   * Load a plugin by its description ID from scan results.
   * @param descriptionId - Plugin ID or name from scan results.
   * @param sampleRate - Sample rate for initialization (default: 44100).
   * @param blockSize - Block size for initialization (default: 512).
   * @returns Plugin index, or -1 on failure.
   */
  loadPlugin(descriptionId: string, sampleRate?: number, blockSize?: number): number;

  /**
   * Load a plugin from a file path.
   * @param filePath - Path to the .vst3 file.
   * @param sampleRate - Sample rate for initialization (default: 44100).
   * @param blockSize - Block size for initialization (default: 512).
   * @returns Plugin index, or -1 on failure.
   */
  loadPluginFromFile(filePath: string, sampleRate?: number, blockSize?: number): number;

  /** Unload a plugin by index. */
  unloadPlugin(index: number): void;

  /** Unload all plugins. */
  unloadAll(): void;

  /** Activate a plugin. */
  activatePlugin(index: number): void;

  /** Deactivate a plugin. */
  deactivatePlugin(index: number): void;

  /** Prepare a plugin for playback. */
  preparePlugin(index: number, sampleRate: number, blockSize: number): void;

  /** Release a plugin's resources. */
  releasePlugin(index: number): void;

  /** Get the number of loaded plugins. */
  getNumPlugins(): number;

  /** Check if a plugin is loaded at the given index. */
  isPluginLoaded(index: number): boolean;

  /** Get plugin info by index. */
  getPluginInfo(index: number): LoadedPluginInfo | null;

  /** Get all loaded plugins info. */
  getAllPluginsInfo(): LoadedPluginInfo[];
}

export declare class AudioProcessorBridge {
  constructor(pluginManager: PluginManagerBridge);

  /**
   * Prepare the audio processor for playback.
   * @param sampleRate - e.g. 44100
   * @param samplesPerBlock - e.g. 512
   * @param numChannels - e.g. 2 for stereo
   */
  prepare(sampleRate: number, samplesPerBlock: number, numChannels: number): void;

  /** Release audio resources. */
  release(): void;

  /** Activate all plugins in the chain. */
  activateAll(): void;

  /** Deactivate all plugins in the chain. */
  deactivateAll(): void;

  /**
   * Remove a plugin from the chain by index.
   * @param chainIndex - Index in the chain.
   */
  removePlugin(chainIndex: number): void;

  /**
   * Remove a plugin from the chain by its unique ID.
   * @param pluginId - Unique plugin ID.
   */
  removePluginById(pluginId: number): void;

  /**
   * Move a plugin within the chain.
   * @param fromIndex - Current index.
   * @param toIndex - Target index.
   */
  movePlugin(fromIndex: number, toIndex: number): void;

  /** Get the number of plugins in the chain. */
  getNumPlugins(): number;

  /** Check if the chain is empty. */
  isEmpty(): boolean;

  /** Get the names of all plugins in chain order. */
  getPluginNames(): string[];

  /**
   * Process audio through the plugin chain.
   * @param inputBuffer - Interleaved audio data as Float32Array.
   * @param numChannels - Number of channels.
   * @param numSamples - Number of samples per channel.
   * @param midiData - Optional MIDI messages.
   * @returns Processed interleaved audio data.
   */
  process(
    inputBuffer: Float32Array | number[],
    numChannels: number,
    numSamples: number,
    midiData?: MidiMessage[]
  ): Float32Array;

  /**
   * Process audio asynchronously (for batch/offline processing).
   * Same params as process(), returns Promise<Float32Array>.
   */
  processAsync(
    inputBuffer: Float32Array | number[],
    numChannels: number,
    numSamples: number,
    midiData?: MidiMessage[]
  ): Promise<Float32Array>;

  /** Set bypass for the entire chain. */
  setChainBypassed(bypassed: boolean): void;

  /** Check if the chain is bypassed. */
  isChainBypassed(): boolean;

  /**
   * Get the number of parameters for a plugin.
   * @param pluginIndex - Chain index.
   */
  getNumParameters(pluginIndex: number): number;

  /**
   * Get a parameter value (0..1).
   * @param pluginIndex - Chain index.
   * @param paramIndex - Parameter index.
   */
  getParameter(pluginIndex: number, paramIndex: number): number;

  /**
   * Set a parameter value (0..1).
   * @param pluginIndex - Chain index.
   * @param paramIndex - Parameter index.
   * @param value - Parameter value (0..1).
   */
  setParameter(pluginIndex: number, paramIndex: number, value: number): void;

  /**
   * Get parameter name.
   * @param pluginIndex - Chain index.
   * @param paramIndex - Parameter index.
   */
  getParameterName(pluginIndex: number, paramIndex: number): string;

  /**
   * Get parameter display text.
   * @param pluginIndex - Chain index.
   * @param paramIndex - Parameter index.
   */
  getParameterText(pluginIndex: number, paramIndex: number): string;

  /**
   * Get all parameters for a plugin.
   * @param pluginIndex - Chain index.
   * @returns Array of parameter info objects.
   */
  getAllParameters(pluginIndex: number): ParameterInfo[];

  /** Check if any plugin in the chain is active. */
  isAnyPluginActive(): boolean;

  /**
   * Get plugin info by chain index.
   * @param chainIndex - Index in the chain.
   */
  getPluginInfo(chainIndex: number): PluginInfo | null;
}

/** Module version */
export declare const version: string;

/** Engine type */
export declare const engineType: string;

/** Get default VST3 scan paths for the current platform. */
export declare function getDefaultScanPaths(): string[];

/** Check if a file is a VST3 plugin by extension. */
export declare function isVst3File(filePath: string): boolean;

// ─────────────────────────────────────────────────────────────────────────
// SynthBridge —— 合成器桥（v2.8.0）
//
// 纯渲染：不打开音频设备、不碰 MessageManager。调用方负责驱动
// `render(numSamples)`（实时音频线程或离线导出循环）。
// 之所以不包装 AudioEngine，是因为它继承 juce::AudioAppComponent，
// 在 Node addon 里会与 V8 争夺 OS 主线程（死锁风险，见 SynthBridge.h）。
// ─────────────────────────────────────────────────────────────────────────

export interface TransportState {
  bar: number;
  beat: number;
  bpm: number;
  state: "stopped" | "playing" | "paused";
}

export declare class SynthBridge {
  constructor();

  /** 初始化渲染参数。sampleRate 8000..384000，blockSize 16..8192 */
  prepare(sampleRate: number, blockSize: number): boolean;
  isPrepared(): boolean;
  /** 清空全部声部与待发 MIDI */
  reset(): void;

  noteOn(midi: number, velocity?: number, channel?: number): void;
  noteOff(midi: number, channel?: number): void;
  allNotesOff(channel?: number): void;

  /**
   * 渲染音频块。
   * @returns **交织立体声** Float32Array，长度 = numSamples * 2，格式 [L,R,L,R,...]
   */
  render(numSamples?: number): Float32Array;

  setEngine(engine: "builtin" | "wavetable"): void;
  setVolume(volume: number): void;
  getVolume(): number;
  /** 仅 wavetable 引擎有效 */
  setWaveform(index: number): void;

  setTempo(bpm: number): void;
  setTimeSignature(numerator: number, denominator: number): void;
  play(): void;
  pause(): void;
  stop(): void;
  setPosition(bar: number, beat?: number): void;
  getTransportState(): TransportState;
  setLoop(startBar: number, endBar: number, enable: boolean): void;
}
