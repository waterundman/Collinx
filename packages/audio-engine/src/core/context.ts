/**
 * AudioContext 生命周期管理。
 *
 * 浏览器自动播放策略：`AudioContext` 初始为 `suspended`，必须由**用户手势**
 * 恢复，否则 `noteOn` 静默失败（业界最常见的 Web Audio 生产 bug）。
 * 这里把解锁收口到一个地方，业务侧只需 `await engine.unlock()`。
 */

export interface AudioContextLike {
  state: AudioContextState;
  currentTime: number;
  sampleRate: number;
  destination: AudioNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createBiquadFilter(): BiquadFilterNode;
  createStereoPanner(): StereoPannerNode;
  createAnalyser(): AnalyserNode;
  createBufferSource(): AudioBufferSourceNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createConstantSource(): ConstantSourceNode;
}

export type ContextFactory = () => AudioContextLike;

const defaultFactory: ContextFactory = () =>
  new (globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)() as unknown as AudioContextLike;

/**
 * 持有唯一的 AudioContext，并负责解锁。
 *
 * 复用单例的原因：多个 AudioContext 会互相争抢音频线程，且部分浏览器对
 * 同时存在的上下文数量有限制。
 */
export class AudioContextHolder {
  private context: AudioContextLike | null = null;
  private readonly factory: ContextFactory;
  /** 记录"用户手势已发生"，供 UI 决定是否显示"点击启用声音" */
  private gestureSeen = false;

  constructor(factory: ContextFactory = defaultFactory) {
    this.factory = factory;
  }

  get exists(): boolean {
    return this.context !== null;
  }

  get isRunning(): boolean {
    return this.context?.state === "running";
  }

  get now(): number {
    return this.context?.currentTime ?? 0;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  /** 标记用户已交互（不创建上下文，纯标记） */
  markGesture(): void {
    this.gestureSeen = true;
  }

  get userGestured(): boolean {
    return this.gestureSeen;
  }

  /** 取上下文，未创建则创建（可能处于 suspended） */
  ensure(): AudioContextLike {
    if (!this.context) this.context = this.factory();
    return this.context;
  }

  /** 解锁：必须在用户手势的调用栈里触发 */
  async unlock(): Promise<boolean> {
    this.gestureSeen = true;
    const ctx = this.ensure();
    if (ctx.state === "running") return true;
    if (ctx.state === "closed") {
      // 关闭过的上下文无法复用，重建
      this.context = null;
      return this.unlock();
    }
    try {
      await ctx.resume();
    } catch {
      return false;
    }
    // 重新读一次状态：await 之后 TS 仍保留上面的窄化（"interrupted" | "suspended"），
    // 直接比较会被判为「无重叠类型」。经函数调用读取可打破窄化。
    const readState = (c: AudioContextLike) => c.state;
    return readState(ctx) === "running";
  }

  async dispose(): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;
    this.context = null;
    try {
      await ctx.close();
    } catch {
      /* 已关闭 */
    }
  }
}
