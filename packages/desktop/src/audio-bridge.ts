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
 * ## 阶段 2/3（见 docs/ARCHITECTURE.md §4.3）
 *
 * 把引擎移出主进程：音频引擎跑在独立子进程，通过共享内存环形缓冲传音频、
 * 命名管道传控制消息。届时本文件的实现整体替换，**对外的 API 形状不变**。
 */

export type AudioEngineStatus = "unavailable" | "ready" | "error";

export interface AudioEngineBridgeInfo {
  status: AudioEngineStatus;
  /** 未就绪时的人类可读原因（用于界面提示，不静默失败） */
  reason?: string;
  sampleRate?: number;
  backend?: string;
}

type NativeAddon = {
  AudioProcessorBridge?: unknown;
  PluginManagerBridge?: unknown;
};

export class AudioEngineBridge {
  private addon: NativeAddon | null = null;
  private status: AudioEngineStatus = "unavailable";
  private reason = "音频引擎尚未接通（packages/audio 需先构建出 N-API 产物）";

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nativePath = process.env.COLLINX_AUDIO_ADDON ?? "@collinx/audio-native";
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.addon = require(nativePath) as NativeAddon;
      this.status = "ready";
      this.reason = undefined;
    } catch (err) {
      this.status = "unavailable";
      this.reason =
        err instanceof Error
          ? `加载 ${"@collinx/audio-native"} 失败：${err.message}`
          : "音频引擎加载失败";
    }
    return this.info();
  }

  info(): AudioEngineBridgeInfo {
    return {
      status: this.status,
      reason: this.reason,
      // 采样率等参数要等 N-API 合成器接口补齐后才能真实返回，
      // 现在不填假值（v2.7.0 已清理过一批假指标面板）。
      sampleRate: undefined,
      backend: this.addon ? "juce-native" : undefined,
    };
  }

  /**
   * 打开音频设备。
   *
   * 注意：这里**只是把请求转交给原生层**，实际的音频线程由 JUCE 在
   * 它自己的线程上管理；本方法不阻塞等待设备就绪（否则又会踩主线程的坑）。
   */
  async start(): Promise<boolean> {
    if (!this.addon) return false;
    // TODO(v2.9.0)：N-API 合成器接口补齐后接入
    //   - engine.prepare(sampleRate, blockSize, channels)
    //   - engine.setAudioChannels(0, 2)
    return false;
  }

  async stop(): Promise<void> {
    if (!this.addon) return;
    // TODO(v2.9.0)：engine.shutdownAudio()
  }
}
