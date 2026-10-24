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
import { MixerGraph, DEFAULT_BUS_KEY, peakOf } from "./mixer-graph";
import { dbToLinear } from "./gain";
import type { FXSlot, MixerState } from "@collinx/core";

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

/**
 * 真实可采集的音频性能指标（v2.9.2）。
 *
 * 只报**能真拿到**的东西：浏览器不暴露 CPU 占用与缓冲欠载次数，
 * 所以这两个字段不在这里出现 —— 调用方显示「—」而不是编一个数字。
 */
export interface AudioPerformanceInfo {
  ready: boolean;
  state: AudioContextState | "uninitialized";
  sampleRate: number;
  /** 输出基础延迟（ms），AudioContext.baseLatency；Safari 可能为 undefined */
  baseLatencyMs: number;
  /** 端到端输出延迟（ms），AudioContext.outputLatency；不支持时为 0 */
  outputLatencyMs: number;
  /** 当前正在发声的声部数（每轨每音一个） */
  activeVoices: number;
  /** master 后的实时峰值（0..1） */
  level: number;
}

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  /**
   * 轨道级混音图（v2.9.0 由 `MixerGraph` 接管）。
   *
   * 演进史：v2.8.0 之前所有音符直连 master（推子只是数字）；
   * v2.8.0 加了轨道总线（推子生效）；v2.9.0 把总线升级成
   * 「FX → 推子 → 声像 → 电平」并抽成与导出共用的 MixerGraph。
   */
  private mixerGraph: MixerGraph | null = null;
  /**
   * v2.8.0：电平分析器（接在 master 之后、destination 之前）。
   * 混音台此前没有电平显示 —— 用户拖推子时无法判断是否削波，
   * 混音等于盲调。AnalyserNode 是 pass-through，不影响声音。
   */
  private analyser: AnalyserNode | null = null;
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

        // v2.8.0：母带链插在 master 与 analyser 之间 ——
        // ① 与 WAV 导出共用同一份实现（听到的 = 导出的）
        // ② analyser 接在母带之后，电平表显示的是**母线真实电平**
        //    （此前是压缩前的电平，用户看到的峰值会比导出实际更"炸"）
        createMasterChain(this.ctx, this.master, this.analyser);
        this.analyser.connect(this.ctx.destination);

        // v2.9.0：轨道总线升级为混音图（FX → 推子 → 声像 → 电平）。
        // 与 WAV 导出共用同一个类 —— 否则「听到的」和「导出的」又是两个声音。
        this.mixerGraph = new MixerGraph(this.ctx, this.master, { withAnalysers: true });
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  /** 归一化总线键：没有 trackId 的音符也要有自己的总线 */
  private static busKey(trackId?: string): string {
    return trackId && trackId.length > 0 ? trackId : DEFAULT_BUS_KEY;
  }

  /**
   * 设置某轨道的音量（dB）。混音台推子改了必须调它，
   * 否则推子只是个数字 —— 这正是 v2.8.0 之前的问题。
   *
   * `db = -Infinity`（静音）交给 `dbToLinear` 得到 0，是**真静音**。
   */
  setTrackGain(trackId: string, db: number): void {
    this.mixerGraph?.setGain(AudioPreview.busKey(trackId), db);
  }

  /** 设置某轨道的声像（-1 左 .. 1 右）。此前旋钮可转但音频路径没有 panner。 */
  setTrackPan(trackId: string, pan: number): void {
    this.mixerGraph?.setPan(AudioPreview.busKey(trackId), pan);
  }

  /** 设置某轨道的 FX 链（结构变化才重建，只改参数不重建）。 */
  setTrackFx(trackId: string, slots: FXSlot[]): void {
    this.mixerGraph?.setFx(AudioPreview.busKey(trackId), slots);
  }

  /** 一次应用整份混音状态（静音/独奏/声像/FX） */
  applyMixer(mixer: MixerState): void {
    this.mixerGraph?.apply(mixer);
  }

  /** 删轨后释放该轨总线，避免死节点继续挂在 master 上 */
  removeTrack(trackId: string): void {
    this.mixerGraph?.removeBus(AudioPreview.busKey(trackId));
  }

  /** 设置总输出音量（dB）。Mixer 的 Master 推子必须走这里。 */
  setMasterGain(db: number): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(dbToLinear(db) * this.masterGain, this.ctx.currentTime, 0.01);
  }

  /** 某轨道的当前电平（0..1 峰值） */
  getTrackLevel(trackId: string): number {
    return this.mixerGraph?.getLevel(AudioPreview.busKey(trackId)) ?? 0;
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
    // 连到**轨道总线**而不是 master —— 这样推子/声像/FX 才能影响这条轨的声音
    if (this.mixerGraph) {
      gain.connect(this.mixerGraph.bus(AudioPreview.busKey(trackId)).sum);
    } else {
      gain.connect(this.master);
    }

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
    return peakOf(this.analyser);
  }

  /**
   * 真实现状快照（v2.9.2）。未启动时返回 ready:false + 全 0，
   * 调用方可安全轮询（性能面板每秒一次）。
   */
  getPerformanceInfo(): AudioPerformanceInfo {
    if (!this.ctx) {
      return {
        ready: false,
        state: "uninitialized",
        sampleRate: 0,
        baseLatencyMs: 0,
        outputLatencyMs: 0,
        activeVoices: 0,
        level: 0,
      };
    }
    const ctx = this.ctx;
    return {
      ready: ctx.state === "running",
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      baseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000,
      activeVoices: this.voices.size,
      level: this.analyser ? peakOf(this.analyser) : 0,
    };
  }

  /** 停止全部发声（stop / 切歌 / 卸载时调用） */
  allNotesOff(): void {
    for (const id of [...this.voices.keys()]) this.noteOff(id);
  }

  /** 关闭并释放 AudioContext */
  async dispose(): Promise<void> {
    this.allNotesOff();
    // 断开并丢弃所有混音总线，避免 AudioContext 关闭后仍持有节点引用
    this.mixerGraph?.dispose();
    this.mixerGraph = null;
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
