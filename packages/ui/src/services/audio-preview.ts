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

import { getInstrument, notePeakGain } from "./instruments";
import { createMasterChain } from "./master-chain";
import { dbToLinear } from "./gain";

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

/**
 * 读一个 AnalyserNode 的时域峰值（0..1）。
 *
 * 用峰值而不是 RMS：削波是峰值造成的。RMS 会让已经爆掉的信号
 * 看起来还有余量，混音时容易误判。
 */
function readPeak(analyser: AnalyserNode): number {
  const buf = new Float32Array(analyser.fftSize);
  try {
    analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  } catch {
    return 0;
  }
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

interface Voice {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

/** 单条轨道的总线：入口增益（推子）→ 电平分析 → master */
interface TrackBus {
  /** 该轨所有 voice 汇入这里；gain 由混音台推子（gainDb）控制 */
  entry: GainNode;
  analyser: AnalyserNode;
  /** 当前线性增益对应的 dB，用于避免重复设置 */
  gainDb: number;
}

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  /**
   * v2.8.0 重构：**轨道级总线**。
   *
   * 重构前所有音符直接连 master —— 于是混音台的推子只改了 `gainDb` 数字，
   * 声音完全不受影响（实测：gainDb 从未出现在音频路径里）。
   * 推子转了、电平没动，混音形同虚设。
   *
   * 现在每条轨道有自己的 GainNode（电平由推子控制）与 AnalyserNode
   * （独立电平显示），voice 先连轨道总线再汇入 master。
   */
  private trackBuses = new Map<string, TrackBus>();
  /** trackId 缺失时的兜底总线键 —— 不能让没有 trackId 的音符失去音量控制 */
  private static readonly DEFAULT_BUS = "__default__";
  /**
   * v2.8.0：电平分析器（接在 master 之后、destination 之前）。
   * 混音台此前没有电平显示 —— 用户拖推子时无法判断是否削波，
   * 混音等于盲调。AnalyserNode 是 pass-through，不影响声音。
   */
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Float32Array = new Float32Array(512);
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

        this.analyser = this.ctx.createAnalyser();
        // fftSize 只影响频率分辨率；这里只要时域峰值，取最小值即可
        this.analyser.fftSize = 512;
        this.levelBuffer = new Float32Array(this.analyser.fftSize);

        // v2.8.0：母带链插在 master 与 analyser 之间 ——
        // ① 与 WAV 导出共用同一份实现（听到的 = 导出的）
        // ② analyser 接在母带之后，电平表显示的是**母线真实电平**
        //    （此前是压缩前的电平，用户看到的峰值会比导出实际更"炸"）
        createMasterChain(this.ctx, this.master, this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  /** 取（必要时创建）轨道总线 */
  private ensureTrackBus(trackId?: string): TrackBus | null {
    if (!this.ctx || !this.master) return null;
    const key = trackId && trackId.length > 0 ? trackId : AudioPreview.DEFAULT_BUS;

    const existing = this.trackBuses.get(key);
    if (existing) return existing;

    const entry = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    entry.connect(analyser);
    analyser.connect(this.master);

    const bus: TrackBus = { entry, analyser, gainDb: 0 };
    this.trackBuses.set(key, bus);
    return bus;
  }

  /**
   * 设置某轨道的音量（dB）。混音台推子改  后必须调它，
   * 否则推子只是个数字 —— 这正是重构前的问题。
   */
  setTrackGain(trackId: string, db: number): void {
    if (!this.ctx) return;
    const bus = this.ensureTrackBus(trackId);
    if (!bus) return;
    const linear = dbToLinear(db);
    // 用 setTargetAtTime 平滑过渡，避免拖动推子时产生 zipper noise（拉链噪声）
    bus.entry.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.01);
    bus.gainDb = db;
  }

  /** 设置总输出音量（dB）。Mixer 的 Master 推子必须走这里。 */
  setMasterGain(db: number): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(dbToLinear(db) * this.masterGain, this.ctx.currentTime, 0.01);
  }

  /** 某轨道的当前电平（0..1 峰值） */
  getTrackLevel(trackId: string): number {
    const key = trackId && trackId.length > 0 ? trackId : AudioPreview.DEFAULT_BUS;
    const bus = this.trackBuses.get(key);
    if (!bus) return 0;
    return readPeak(bus.analyser);
  }

  /**
   * 触发一个音符。
   *
   * @param voiceId 同一音符的标识（用于 noteOff 配对）；应为稳定 key
   * @param pitchMidi MIDI 音高
   * @param velocity 0..1
   * @param whenSec 相对 AudioContext.currentTime 的延迟（秒），默认立即
   */
  noteOn(
    voiceId: string,
    pitchMidi: number,
    velocity = 0.8,
    whenSec = 0,
    /** 音色 id（见 instruments.ts）；省略时用 DEFAULT_INSTRUMENT */
    instrumentId?: string,
    /** 来源轨道 —— 决定它汇入哪条轨道总线（推子/电平按轨独立） */
    trackId?: string,
  ): void {
    if (!this.ctx || !this.master || this.ctx.state !== "running") return;

    // 同一个 voiceId 重复触发时先停旧的，避免叠音
    this.noteOff(voiceId);

    // v2.8.0：包络与振荡器都取自音色表 —— 播放与 WAV 导出读同一份 spec，
    // 否则"听到的"和"导出的"会是两个声音。
    const spec = getInstrument(instrumentId);
    const t0 = this.ctx.currentTime + Math.max(0, whenSec);
    const peak = notePeakGain(velocity, spec);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + spec.attack);
    // 从峰值衰减到音色的稳态电平（< 1 表示有自然衰减，如拨弦）
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peak * spec.sustain, 0.0002),
      t0 + spec.attack + 0.15,
    );
    // 连到**轨道总线**而不是 master —— 这样推子才能影响这条轨的声音
    const bus = this.ensureTrackBus(trackId);
    if (bus) gain.connect(bus.entry);
    else gain.connect(this.master);

    const freq = midiToFrequency(pitchMidi);
    const oscs: OscillatorNode[] = [];

    for (const o of spec.oscillators) {
      const osc = this.ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = freq;
      osc.detune.value = o.detune;

      // 每个振荡器单独一个增益节点：spec.gain 是相对权重，
      // 用来控制音色的"厚薄"比例（如 bass 用正弦打底 + 少量锯齿给音头）
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = o.gain;
      osc.connect(oscGain);
      oscGain.connect(gain);

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

  /**
   * 当前输出电平（0..1，取时域峰值的绝对值）。
   *
   * 为什么用峰值而不是 RMS：削波是峰值造成的。RMS 会让已经爆掉的信号
   * 看起来还有余量，混音时容易误判。
   *
   * 未启动 / 无 analyser 时返回 0（而不是抛错）—— 调用方可以安全地
   * 按 rAF 轮询而不必先判空。
   */
  getLevel(): number {
    if (!this.analyser) return 0;
    return readPeak(this.analyser);
  }

  /** 停止全部发声（stop / 切歌 / 卸载时调用） */
  allNotesOff(): void {
    for (const id of [...this.voices.keys()]) this.noteOff(id);
  }

  /** 关闭并释放 AudioContext */
  async dispose(): Promise<void> {
    this.allNotesOff();
    // 断开并丢弃所有轨道总线，避免 AudioContext 关闭后仍持有节点引用
    for (const bus of this.trackBuses.values()) {
      try { bus.entry.disconnect(); bus.analyser.disconnect(); } catch { /* ignore */ }
    }
    this.trackBuses.clear();
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
