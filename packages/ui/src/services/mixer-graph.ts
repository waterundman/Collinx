/**
 * 混音图（v2.9.0）—— 播放与导出共用的唯一混音链路。
 *
 * ## 为什么必须共用
 *
 * v2.8.0 立了「听到的 = 导出的」这条约束，但只覆盖了音色与母带：
 * 导出时 `renderNotesToWav` 拿到的是裸音符列表，推子/静音/独奏/声像/FX
 * 全部丢失（实测：混完再导出，和没混一样）。
 *
 * 现在两侧都调用本模块：实时用 `AudioContext`，导出用 `OfflineAudioContext`，
 * 节点拓扑与参数写入来自同一份代码。任何「导出忘了某条分支」的偏差
 * 都会在结构签名与数值验收里暴露。
 *
 * ## 单轨拓扑
 *
 * ```
 * voices ─▶ sum ─▶ [FX 链] ─▶ fader ─▶ panner ─▶ analyser? ─▶ destination(master)
 * ```
 *
 * FX 在推子**之前**（insert 惯例：效果器吃原始电平），推子之后才是声像。
 * 静音通过 fader = 0 实现（`-Infinity` → `dbToLinear` → 0），不是断开节点——
 * 断开会让播放中的音符瞬间消失并在重连时爆音。
 */

import type { FXSlot, MixerState, SendConfig } from "@collinx/core";
import { createFxChain, type FxChainNodes } from "./fx-chain";
import { busKeyOf, effectiveGainDb, hasAnySolo, parseGainDb, parsePan } from "./mix-resolver";
import { dbToLinear } from "./gain";

/** 音符没有 trackId 时的兜底总线键 */
export const DEFAULT_BUS_KEY = "__default__";

export interface TrackBusNodes {
  key: string;
  /** 该轨所有 voice 汇入这里 */
  sum: GainNode;
  /** 推子（静音 = 0） */
  fader: GainNode;
  /** 声像；环境不支持时为 null（退化为中心，不抛错） */
  panner: StereoPannerNode | null;
  /** 电平分析（仅播放链路创建；导出不需要） */
  analyser: AnalyserNode | null;
  fx: FxChainNodes;
  /** 送出发送：目标总线键 → 增益节点与连接状态 */
  sends: Map<string, { gain: GainNode; level: number; connected: boolean; preFader: boolean }>;
  gainDb: number;
  pan: number;
}

export interface MixerGraphOptions {
  /** 是否创建电平分析节点（播放 = true，导出 = false） */
  withAnalysers?: boolean;
  /**
   * 参数立即生效（导出用）。
   *
   * 播放用 `setTargetAtTime` 平滑过渡防拉链噪声；但离线渲染是一次性静态混音，
   * 平滑会带来两个可测偏差：静音的头 ~30ms 有泄漏、-6dB 实测只有 -5.45dB
   * （起始 1.0 的尾巴混进了 RMS）。导出直接写终值，结果可逐样本复现。
   */
  instantParams?: boolean;
}

/** 读 AnalyserNode 的时域峰值（0..1）。峰值而非 RMS：削波由峰值造成。 */
export function peakOf(analyser: AnalyserNode): number {
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

export class MixerGraph {
  private buses = new Map<string, TrackBusNodes>();
  /** 当前的送出邻接表，用于环路保护（A→B 时若 B→A 已存在则丢弃） */
  private sendEdges = new Map<string, Set<string>>();
  private readonly withAnalysers: boolean;
  private readonly instantParams: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    opts: MixerGraphOptions = {},
  ) {
    this.withAnalysers = opts.withAnalysers ?? false;
    this.instantParams = opts.instantParams ?? false;
  }

  /** 取（必要时创建）某条总线。未知轨也会得到一条独立总线（0dB / 居中 / 无 FX）。 */
  bus(key: string): TrackBusNodes {
    const existing = this.buses.get(key);
    if (existing) return existing;

    const ctx = this.ctx;
    const sum = ctx.createGain();
    const fx = createFxChain(ctx, []);
    const fader = ctx.createGain();
    fader.gain.value = 1;

    const panner =
      typeof (ctx as BaseAudioContext & { createStereoPanner?: unknown }).createStereoPanner === "function"
        ? ctx.createStereoPanner()
        : null;
    const analyser = this.withAnalysers ? ctx.createAnalyser() : null;
    if (analyser) analyser.fftSize = 256;

    sum.connect(fx.input);
    fx.output.connect(fader);
    if (panner) {
      fader.connect(panner);
      if (analyser) panner.connect(analyser);
      else panner.connect(this.destination);
    } else if (analyser) {
      fader.connect(analyser);
    } else {
      fader.connect(this.destination);
    }
    if (analyser) analyser.connect(this.destination);

    const bus: TrackBusNodes = {
      key,
      sum,
      fader,
      panner,
      analyser,
      fx,
      sends: new Map(),
      gainDb: 0,
      pan: 0,
    };
    this.buses.set(key, bus);
    return bus;
  }

  setGain(key: string, db: number): void {
    const bus = this.bus(key);
    const linear = dbToLinear(db);
    if (this.instantParams) {
      // 导出：静态终值。静音必须是**真 0**（平滑会漏头 ~30ms）
      bus.fader.gain.setValueAtTime(linear, this.ctx.currentTime);
    } else if (db === -Infinity) {
      // 播放：静音也直接置 0 —— 平滑逼近 0 会永远差一点点，
      // 电平表上看起来"静音了但还有底噪"，导出侧也会漏出可测能量。
      bus.fader.gain.cancelScheduledValues(this.ctx.currentTime);
      bus.fader.gain.setValueAtTime(0, this.ctx.currentTime);
    } else {
      bus.fader.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.01);
    }
    bus.gainDb = db;
  }

  setPan(key: string, pan: number): void {
    if (!Number.isFinite(pan)) return;
    const bus = this.bus(key);
    const clamped = Math.max(-1, Math.min(1, pan));
    if (bus.panner) {
      if (this.instantParams) bus.panner.pan.setValueAtTime(clamped, this.ctx.currentTime);
      else bus.panner.pan.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
    bus.pan = pan;
  }

  setFx(key: string, slots: FXSlot[]): void {
    const bus = this.bus(key);
    bus.fx.update(slots);
  }

  /**
   * 设置某轨的送出发送（v2.9.1）。
   *
   * 此前 `MixerTrack.sends` 只是混音台里的展示数据 —— 音频路径完全不读，
   * 用户/AI 设了发送也听不出任何变化。
   *
   * 语义：
   * - 默认**推子后**（`preFader: false`）从 fader 取信号，静音/推子当然影响送出；
   *   `preFader: true` 从 sum（推子前）取，静音不切断送出（监听/混响返送的常见做法）
   * - 电平是 0..1 线性比值（与 `SendConfig.level` 的字符串语义一致）
   * - 自送与 A↔B 直接环路会被丢弃（Web Audio 环路会静音整条支路）
   */
  setSends(key: string, sends: SendConfig[]): void {
    const bus = this.bus(key);
    const next = new Map<string, SendConfig>();
    for (const send of sends) {
      const target = send.targetBusId;
      if (!target || target === key) continue;
      if (this.sendEdges.get(target)?.has(key)) continue; // A→B 已存在时拒绝 B→A
      if (next.has(target)) continue;
      next.set(target, send);
    }

    // 移除不再存在的送出。⚠️ 必须同时断开**源端**：Web Audio 里同一对节点
    // 重复 connect 会形成并联（信号翻倍），只断增益节点的出边会留下孤儿支路。
    for (const [target, node] of bus.sends) {
      if (next.has(target)) continue;
      try {
        (node.preFader ? bus.sum : bus.fader).disconnect(node.gain);
        node.gain.disconnect();
      } catch {
        /* ignore */
      }
      bus.sends.delete(target);
    }

    const edges = new Set<string>();
    for (const [target, send] of next) {
      let node = bus.sends.get(target);
      if (!node) {
        const gain = this.ctx.createGain();
        bus.sends.set(target, { gain, level: Number.NaN, connected: false, preFader: false });
        node = bus.sends.get(target)!;
      }
      const level = Math.max(0, Math.min(1, Number.parseFloat(send.level)));
      const safeLevel = Number.isFinite(level) ? level : 0;
      if (node.level !== safeLevel) {
        if (this.instantParams) node.gain.gain.setValueAtTime(safeLevel, this.ctx.currentTime);
        else node.gain.gain.setTargetAtTime(safeLevel, this.ctx.currentTime, 0.01);
        node.level = safeLevel;
      }

      // 源端：推子后（默认）或推子前。只在首次连接或切换源端时接线 ——
      // 每帧重复 connect 会让同一支路叠加多次（实测会变成 +6dB）。
      if (!node.connected) {
        (send.preFader ? bus.sum : bus.fader).connect(node.gain);
        node.gain.connect(this.bus(target).sum);
        node.connected = true;
        node.preFader = send.preFader;
      } else if (node.preFader !== send.preFader) {
        try {
          (node.preFader ? bus.sum : bus.fader).disconnect(node.gain);
        } catch {
          /* ignore */
        }
        (send.preFader ? bus.sum : bus.fader).connect(node.gain);
        node.preFader = send.preFader;
      }
      edges.add(target);
    }
    this.sendEdges.set(key, edges);
  }

  /**
   * 把整份混音状态应用到图（静音/独奏/声像/FX 一次算完）。
   *
   * master 推子不在这里处理：调用方持有 master 节点，
   * 播放走 `AudioPreview.setMasterGain`，导出在建图时写一次。
   */
  apply(mixer: MixerState): void {
    const anySolo = hasAnySolo(mixer);
    for (const track of mixer.tracks) {
      const key = busKeyOf(track);
      this.setGain(key, effectiveGainDb(track, anySolo));
      this.setPan(key, parsePan(track.pan));
      this.setFx(key, track.fxChain.slots);
      this.setSends(key, track.sends ?? []);
    }
  }

  getLevel(key: string): number {
    const bus = this.buses.get(key);
    if (!bus?.analyser) return 0;
    return peakOf(bus.analyser);
  }

  /** 删除一条总线（删轨时调用），避免死节点继续占用输出 */
  removeBus(key: string): void {
    const bus = this.buses.get(key);
    if (!bus) return;
    this.buses.delete(key);
    try {
      bus.sum.disconnect();
      bus.fx.dispose();
      bus.fader.disconnect();
      bus.panner?.disconnect();
      bus.analyser?.disconnect();
      for (const node of bus.sends.values()) node.gain.disconnect();
      bus.sends.clear();
      this.sendEdges.delete(key);
      for (const edges of this.sendEdges.values()) edges.delete(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * 结构签名：每条总线的键 + 增益 + 声像 + FX 结构。
   * 用于验收「播放链与导出链是否同构」——两边不一致即说明有一条分支没接。
   */
  signature(): string {
    return [...this.buses.keys()]
      .sort()
      .map((key) => {
        const bus = this.buses.get(key)!;
        const sends = [...bus.sends.entries()]
          .map(([target, node]) => `${target}=${node.level}`)
          .sort()
          .join(",");
        return `${key}:${bus.gainDb}:${bus.pan.toFixed(3)}:${bus.fx.signature}:${sends}`;
      })
      .join(" || ");
  }

  dispose(): void {
    for (const key of [...this.buses.keys()]) this.removeBus(key);
  }
}

/** 从混音轨取总线键（供 UI/导出侧统一调用，避免两处各写一遍） */
export function busKeyForTrack(track: MixerState["tracks"][number]): string {
  return busKeyOf(track);
}

/** master 推子 dB 解析（NaN 回 0；-Infinity 保留为真静音） */
export function masterGainDb(mixer: MixerState): number {
  return parseGainDb(mixer.masterTrack.gainDb);
}
