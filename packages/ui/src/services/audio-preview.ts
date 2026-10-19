/**
 * Web Audio 预览合成器 —— 让浏览器在没有外部 MIDI 设备时也能出声。
 *
 * ## 为什么需要它
 *
 * 真实验收发现：按播放键时 AudioContext 创建 0 次、振荡器 0 个，
 * 但播放头正常推进 —— Collinx 目前是**会走时间的无声播放器**。
 * 原因是 `useTransport` 明确"不引入 AudioContext"，全程依赖 Web MIDI
 * 输出到外部音源。没有 MIDI 设备时，用户完全听不到自己写的音符。
 *
 * 这直接切断创作闭环：听不到就无法判断旋律好不好听。
 *
 * ## 设计边界
 *
 * - **不改 transport 的时钟**：本模块只负责"把音符变成声音"，
 *   时间轴仍由既有 lookahead 调度器掌管（它已经过 v2.0.0~v2.3.0 验证）
 * - **纯加法**：MIDI 设备仍在时照常输出；本模块是**并行**的第二条通路
 * - **失败即静音**：`AudioContext` 不可用 / 未获用户手势时静默降级，
 *   绝不抛错打断播放
 */

/** MIDI 音高 → 频率（A4 = 69 = 440Hz） */
export function midiToFrequency(pitchMidi: number): number {
  return 440 * Math.pow(2, (pitchMidi - 69) / 12);
}

/**
 * 根据力度算峰值增益。
 *
 * 用平方曲线（velocity²）而不是线性：人耳对响度的感知接近幂律，
 * 线性映射会让弱奏听起来太响、强奏不够突出。
 */
export function velocityToGain(velocity: number): number {
  // NaN 必须挡掉：Math.min/max 对 NaN 返回 NaN，会一路传到 GainNode.gain
  // 让整条链路失效（且不报错，静默无声）
  if (!Number.isFinite(velocity)) return 0;
  const v = Math.max(0, Math.min(1, velocity));
  return v * v * 0.35;
}

export interface AudioPreviewOptions {
  /** 主输出增益，默认 0.8 */
  masterGain?: number;
  /** 起音时间（秒），默认 0.005（5ms，避免爆音） */
  attack?: number;
  /** 释音时间（秒），默认 0.08 */
  release?: number;
}

interface Voice {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private readonly masterGain: number;
  private readonly attack: number;
  private readonly release: number;

  constructor(opts: AudioPreviewOptions = {}) {
    this.masterGain = opts.masterGain ?? 0.8;
    this.attack = opts.attack ?? 0.005;
    this.release = opts.release ?? 0.08;
  }

  get isReady(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /**
   * 创建/恢复 AudioContext。
   *
   * 必须在**用户手势**的调用栈里执行 —— 浏览器自动播放策略下，
   * 非手势创建的 AudioContext 会停留在 suspended，不会发声。
   * 返回 false 表示当前环境不可用（SSR / 测试 / 被策略拒绝），调用方应静默降级。
   */
  async ensureStarted(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor =
          (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
          (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.masterGain;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  /**
   * 触发一个音符。
   *
   * @param voiceId 同一音符的标识（用于 noteOff 配对）；应为稳定 key
   * @param pitchMidi MIDI 音高
   * @param velocity 0..1
   * @param whenSec 相对 AudioContext.currentTime 的延迟（秒），默认立即
   */
  noteOn(voiceId: string, pitchMidi: number, velocity = 0.8, whenSec = 0): void {
    if (!this.ctx || !this.master || this.ctx.state !== "running") return;

    // 同一个 voiceId 重复触发时先停旧的，避免叠音
    this.noteOff(voiceId);

    const t0 = this.ctx.currentTime + Math.max(0, whenSec);
    const peak = velocityToGain(velocity);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + this.attack);
    // 轻微衰减到 70%，模拟自然衰减（不做完整 ADSR 的 sustain 段，
    // 因为本项目音符长度由 noteOff 决定，不需要额外的 gate）
    gain.gain.exponentialRampToValueAtTime(Math.max(peak * 0.7, 0.0002), t0 + this.attack + 0.15);
    gain.connect(this.master);

    const freq = midiToFrequency(pitchMidi);
    const oscs: OscillatorNode[] = [];

    // 两个略微失谐的振荡器（锯齿 + 方波）比纯正弦更像"乐器"，
    // 也让和弦更容易被听清。失谐 4 cents 产生轻微 chorus。
    for (const [type, detune] of [
      ["sawtooth", 0],
      ["square", 4],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(t0);
      oscs.push(osc);
    }

    this.voices.set(voiceId, { oscillators: oscs, gain });
  }

  /** 松开音符（带释音淡出，避免爆音） */
  noteOff(voiceId: string, whenSec = 0): void {
    const voice = this.voices.get(voiceId);
    if (!voice || !this.ctx) return;
    this.voices.delete(voiceId);

    const t = this.ctx.currentTime + Math.max(0, whenSec);
    try {
      voice.gain.gain.cancelScheduledValues(t);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0002), t);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + this.release);
      for (const osc of voice.oscillators) osc.stop(t + this.release + 0.01);
    } catch {
      // 已经停止过的振荡器重复 stop 会抛错；忽略即可
    }
  }

  /** 停止全部发声（stop / 切歌 / 卸载时调用） */
  allNotesOff(): void {
    for (const id of [...this.voices.keys()]) this.noteOff(id);
  }

  /** 关闭并释放 AudioContext */
  async dispose(): Promise<void> {
    this.allNotesOff();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
      this.master = null;
    }
  }
}
