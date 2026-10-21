/**
 * 音频引擎桥接（主进程侧）。
 *
 * ## ⚠️ 核心约束：不要在 Electron 主进程直接同步调用 JUCE
 *
 * 参考开源项目 slopsmith-desktop（Electron + JUCE VST3 宿主）的公开设计文档：
 *
 *   > JUCE requires the MessageManager to be created on the OS main thread.
 *   > In the Node.js addon, **V8 owns the main thread, which can lead to
 *   > deadlocks or initialization failures.**
 *
 * 也就是说：`binding.gyp` 编出来的 addon 如果在 Electron 主进程里直接
 * `require` 并同步调用，JUCE 的 MessageManager 与 V8 会争夺 OS 主线程 →
 * 死锁或初始化失败。这不是理论风险，是该开源项目实测踩过的坑。
 *
 * ## 本文件采用的策略（阶段 1：先能跑通，进程模型从简）
 *
 * 1. **惰性加载**：addon 只在真正需要发声时 require，不在启动路径上加载
 * 2. **调用全部异步化**：所有跨边界调用返回 Promise，避免阻塞主线程事件循环
 * 3. **可降级**：addon 不存在（未构建 / 平台不支持）时进入 `unavailable` 状态，
 *    界面照常可用（编辑、导出 MIDI 不受影响），只是不出声
 *
 * ## 阶段 2/3（见 docs/architecture.md §五）
 *
 * 把引擎移出主进程：音频引擎跑在独立子进程，通过共享内存环形缓冲传音频、
 * 命名管道传控制消息。届时本文件的实现整体替换，**对外的 API 形状不变**。
 */

import { AudioDriver } from "./audio-driver";

export type AudioEngineStatus = "unavailable" | "ready" | "error";

export interface AudioEngineBridgeInfo {
  status: AudioEngineStatus;
  /** 未就绪时的人类可读原因（用于界面提示，不静默失败） */
  reason?: string;
  sampleRate?: number;
  backend?: string;
}

type NativeAddon = {
  SynthBridge?: new () => NativeSynthBridge;
  AudioProcessorBridge?: unknown;
  PluginManagerBridge?: unknown;
};

/**
 * addon 里 SynthBridge 的形状（对应 packages/audio/src/napi/index.d.ts）。
 * 这里只声明桌面壳用到的子集 —— 不用 `import type` 引用 C++ 包，
 * 因为那个包没有 package.json，不属于 TS 模块图。
 */
export interface NativeSynthBridge {
  prepare(sampleRate: number, blockSize: number): boolean;
  isPrepared(): boolean;
  reset(): void;
  noteOn(midi: number, velocity?: number, channel?: number): void;
  noteOff(midi: number, channel?: number): void;
  allNotesOff(channel?: number): void;
  /** 交织立体声 Float32Array，长度 = numSamples * 2 */
  render(numSamples?: number): Float32Array;
  setEngine(engine: "builtin" | "wavetable"): void;
  setVolume(volume: number): void;
  getVolume(): number;
  setTempo(bpm: number): void;
  setTimeSignature(numerator: number, denominator: number): void;
  play(): void;
  pause(): void;
  stop(): void;
  setPosition(bar: number, beat?: number): void;
  getTransportState(): { bar: number; beat: number; bpm: number; state: string };
}

export class AudioEngineBridge {
  private addon: NativeAddon | null = null;
  private synth: NativeSynthBridge | null = null;
  private status: AudioEngineStatus = "unavailable";
  /** 未接通/失败原因；接通成功后会被清空，故类型含 undefined */
  private reason: string | undefined = "音频引擎尚未接通（packages/audio 需先构建出 N-API 产物）";
  private sampleRate = 44100;
  /** 播放驱动（仅在 startPlayback 后存在） */
  private driver: AudioDriver | null = null;

  /**
   * 尝试加载原生引擎。
   *
   * 刻意不在构造函数里做 —— 构造发生在应用启动路径上，而 addon 加载
   * （尤其首次 dlopen JUCE）可能耗时且可能失败，不该拖慢窗口显示。
   */
  async load(): Promise<AudioEngineBridgeInfo> {
    if (this.addon) return this.info();

    try {
      // 运行时动态 require：装不上/编不出时不能让整个应用启动失败
      const nativePath = process.env.COLLINX_AUDIO_ADDON ?? "@collinx/audio-native";
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.addon = require(nativePath) as NativeAddon;
      this.status = "ready";
      this.reason = undefined;
    } catch (err) {
      this.status = "unavailable";
      this.reason =
        err instanceof Error
          ? `加载音频 addon 失败：${err.message}`
          : "音频引擎加载失败";
    }
    return this.info();
  }

  info(): AudioEngineBridgeInfo {
    return {
      status: this.status,
      reason: this.reason,
      sampleRate: this.synth ? this.sampleRate : undefined,
      backend: this.synth ? "juce-synthbridge" : undefined,
    };
  }

  /**
   * 初始化合成器（不打开音频设备）。
   *
   * 音频设备由调用方驱动：桌面壳后续用 SharedArrayBuffer 环形缓冲把
   * render() 的音频交给渲染进程的 AudioWorklet 播放（见 README「阶段 2」）。
   * 本轮只保证：addon 能加载、合成器能初始化、能渲染出非静音音频。
   */
  async start(sampleRate = 44100, blockSize = 512): Promise<boolean> {
    if (!this.addon?.SynthBridge) {
      this.reason = "addon 中没有 SynthBridge 导出";
      return false;
    }
    try {
      this.synth = new this.addon.SynthBridge();
      const ok = this.synth.prepare(sampleRate, blockSize);
      if (!ok) {
        this.reason = "SynthBridge.prepare() 返回 false";
        this.synth = null;
        return false;
      }
      this.sampleRate = sampleRate;
      return true;
    } catch (err) {
      this.reason = err instanceof Error ? err.message : "合成器初始化失败";
      this.synth = null;
      return false;
    }
  }

  /** 渲染一块音频（交织立体声）；未初始化时返回 null */
  render(numSamples?: number): Float32Array | null {
    return this.synth ? this.synth.render(numSamples) : null;
  }

  noteOn(midi: number, velocity = 0.8): void {
    this.synth?.noteOn(midi, velocity);
  }

  noteOff(midi: number): void {
    this.synth?.noteOff(midi);
  }

  setTempo(bpm: number): void {
    this.synth?.setTempo(bpm);
  }

  play(): void {
    this.synth?.play();
  }

  /** 停止传输（不释放合成器） */
  transportStop(): void {
    this.synth?.stop();
  }

  transportState(): { bar: number; beat: number; bpm: number; state: string } | null {
    return this.synth ? this.synth.getTransportState() : null;
  }

  /**
   * 启动播放驱动：按固定节奏渲染 → 写入环形缓冲。
   *
   * 返回共享内存与参数，渲染进程据此创建 AudioWorkletNode：
   *   const node = new AudioWorkletNode(ctx, 'synth-worklet',
   *     { processorOptions: { buffer: sab } });
   *
   * 注意：SharedArrayBuffer 在 Chromium 里要求 crossOriginIsolated，
   * 主进程已通过 COOP/COEP 响应头满足该条件（见 main.ts）。
   */
  startPlayback(): { buffer: SharedArrayBuffer; sampleRate: number; blockSize: number } | null {
    if (!this.synth) return null;
    if (!this.driver) {
      this.driver = new AudioDriver(this.synth, { sampleRate: this.sampleRate });
    }
    return this.driver.start();
  }

  stopPlayback(): void {
    this.driver?.stop();
    this.driver = null;
  }

  /** 播放健康度：水位、溢出、欠载 */
  playbackStats(): ReturnType<AudioDriver["stats"]> | null {
    return this.driver ? this.driver.stats() : null;
  }

  async stop(): Promise<void> {
    if (!this.synth) return;
    this.stopPlayback();
    this.synth.allNotesOff();
    this.synth.stop();
    this.synth = null;
  }
}
