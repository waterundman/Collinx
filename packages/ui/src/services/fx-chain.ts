/**
 * FX 链 → Web Audio 节点图（v2.9.0）。
 *
 * ## 背景
 *
 * 混音台的 FX 编辑器（6 类、参数、旁通、AI 提案）从 v1.x 起就齐全，
 * 但音频路径里**一个 biquad / convolver / waveshaper 都没有**——
 * 用户加 EQ 没有任何变化，AI 生成的 FX 链应用后也听不见。
 * 这是典型的「数据改了但没接到执行端」，单测与 tsc 都发现不了。
 *
 * ## 结构
 *
 * 每个槽都是「旁通支路 + 处理支路」的并联：
 *
 * ```
 * input ──▶ bypassGain(0/1) ───────────────▶ output
 *       └─▶ [处理节点…] ──▶ wetGain ───────▶ output
 *       └─▶ dryGain（仅混响/延迟）─────────▶ output
 * ```
 *
 * 为什么旁通用增益而不是断开重连：断开重连会在播放中瞬间归零/爆音，
 * 且无法平滑过渡。两路并联 + `setTargetAtTime` 可以无咔哒切换。
 *
 * ## 播放与导出同源
 *
 * 本模块只依赖 `BaseAudioContext`，因此实时（AudioContext）与离线
 * （OfflineAudioContext）走**同一份实现**。混响 IR 由参数派生的确定性
 * 伪随机生成（同参数 → 同 IR），否则「听到的」和「导出的」是两个混响。
 */

import type { FXSlot } from "@collinx/core";
import { fxParam, fxSignature } from "./mix-resolver";
import { dbToLinear } from "./gain";

/** 各类 FX 的默认参数（UI 未填时使用；与 MixerConsole 的滑杆范围一致） */
export const FX_DEFAULTS = {
  eq: { lowGain: 0, lowFreq: 120, midGain: 0, midFreq: 1000, midQ: 1, highGain: 0, highFreq: 6000 },
  compressor: { threshold: -24, ratio: 3, attack: 10, release: 200, makeup: 0 },
  reverb: { mix: 0.25, decay: 0.5 },
  delay: { mix: 0.25, time: 250, feedback: 0.35 },
  saturator: { drive: 6 },
  limiter: { ceiling: -0.3, release: 50 },
} as const;

interface SlotNodes {
  input: GainNode;
  output: GainNode;
  update(slot: FXSlot): void;
}

const SMOOTH = 0.01;

function setParam(param: AudioParam, value: number): void {
  param.setTargetAtTime(value, 0, SMOOTH);
}

/**
 * 确定性混响脉冲响应。
 *
 * 用 LCG 而不是 Math.random：导出必须是样本级确定的产物，
 * 随机 IR 会让同一工程两次导出得到不同的混响尾音。
 * 长度与衰减由 decay 参数派生，左/右声道用不同的种子偏移（去相关）。
 */
export function createImpulseResponse(
  ctx: BaseAudioContext,
  decay: number,
  sampleRate: number,
): AudioBuffer {
  const d = Math.max(0, Math.min(1, decay));
  const seconds = 0.2 + d * 2.3;
  const length = Math.max(1, Math.floor(seconds * sampleRate));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let seed = (0x9e3779b9 ^ (channel * 2654435761) ^ Math.round(d * 1000)) >>> 0;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff) * 2 - 1;
      const env = Math.pow(1 - i / length, 2 + (1 - d) * 2);
      data[i] = noise * env;
    }
  }
  return buffer;
}

/** 软削波曲线：tanh 归一化到满幅，drive 越大拐点越硬 */
export function createSaturationCurve(driveDb: number): Float32Array<ArrayBuffer> {
  const k = Math.max(0.01, dbToLinear(driveDb));
  // 显式用 ArrayBuffer 构造：WaveShaperNode.curve 的类型要求 Float32Array<ArrayBuffer>，
  // 而 `new Float32Array(n)` 推导成 ArrayBufferLike（TS 5.7 的泛型 TypedArray）。
  // 长度取奇数（1025）：中心点正好对应 x = 0，偶数长度会让 0 落在两格之间。
  const curve = new Float32Array(new ArrayBuffer(1025 * 4));
  const norm = Math.tanh(k);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** 每个槽共用的骨架：input → bypass/wet/dry → output */
function createSlotShell(
  ctx: BaseAudioContext,
  hasDry: boolean,
): {
  input: GainNode;
  output: GainNode;
  bypass: GainNode;
  wet: GainNode;
  dry: GainNode | null;
} {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const bypass = ctx.createGain();
  const wet = ctx.createGain();
  bypass.gain.value = 0;
  wet.gain.value = 1;
  input.connect(bypass);
  bypass.connect(output);
  wet.connect(output);
  const dry = hasDry ? ctx.createGain() : null;
  if (dry) {
    dry.gain.value = 0;
    input.connect(dry);
    dry.connect(output);
  }
  return { input, output, bypass, wet, dry };
}

function setRouting(
  shell: ReturnType<typeof createSlotShell>,
  enabled: boolean,
  wetLevel: number,
): void {
  // 旁通：全直通；启用：全走处理支路
  shell.bypass.gain.value = enabled ? 0 : 1;
  shell.wet.gain.value = enabled ? 1 : 0;
  if (shell.dry) shell.dry.gain.value = enabled ? Math.max(0, 1 - wetLevel) : 0;
}

function createEq(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, false);
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";

  shell.input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(shell.wet);

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      setParam(low.frequency, fxParam(p, ["lowFreq"], FX_DEFAULTS.eq.lowFreq));
      setParam(low.gain, fxParam(p, ["lowGain", "lowGainDb"], FX_DEFAULTS.eq.lowGain));
      setParam(mid.frequency, fxParam(p, ["midFreq"], FX_DEFAULTS.eq.midFreq));
      setParam(mid.gain, fxParam(p, ["midGain", "midGainDb"], FX_DEFAULTS.eq.midGain));
      setParam(mid.Q, fxParam(p, ["midQ"], FX_DEFAULTS.eq.midQ));
      setParam(high.frequency, fxParam(p, ["highFreq"], FX_DEFAULTS.eq.highFreq));
      setParam(high.gain, fxParam(p, ["highGain", "highGainDb"], FX_DEFAULTS.eq.highGain));
      setRouting(shell, slot.enabled, 1);
    },
  };
}

function createCompressor(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, false);
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  shell.input.connect(comp);
  comp.connect(makeup);
  makeup.connect(shell.wet);
  // 压缩器节点没有「关闭」开关，旁通靠 shell 的两路并联
  comp.ratio.value = 1;

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      setParam(comp.threshold, fxParam(p, ["threshold", "thresholdDb"], FX_DEFAULTS.compressor.threshold));
      setParam(comp.ratio, fxParam(p, ["ratio"], FX_DEFAULTS.compressor.ratio));
      // UI 用毫秒，Web Audio 用秒 —— 单位换错会让 attack 慢 1000 倍（听起来"没压住"）
      setParam(comp.attack, fxParam(p, ["attack", "attackMs"], FX_DEFAULTS.compressor.attack) / 1000);
      setParam(comp.release, fxParam(p, ["release", "releaseMs"], FX_DEFAULTS.compressor.release) / 1000);
      setParam(comp.knee, 12);
      makeup.gain.value = dbToLinear(fxParam(p, ["makeup", "makeupGainDb"], FX_DEFAULTS.compressor.makeup));
      setRouting(shell, slot.enabled, 1);
    },
  };
}

function createReverb(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, true);
  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = 0.01;
  const convolver = ctx.createConvolver();
  shell.input.connect(preDelay);
  preDelay.connect(convolver);
  convolver.connect(shell.wet);

  let irKey = "";

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      const decay = fxParam(p, ["decay"], FX_DEFAULTS.reverb.decay);
      const mix = fxParam(p, ["mix", "wetLevel"], FX_DEFAULTS.reverb.mix);
      const key = `${ctx.sampleRate}:${decay.toFixed(2)}`;
      if (key !== irKey) {
        convolver.buffer = createImpulseResponse(ctx, decay, ctx.sampleRate);
        irKey = key;
      }
      setRouting(shell, slot.enabled, Math.max(0, Math.min(1, mix)));
    },
  };
}

function createDelay(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, true);
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 6000;

  shell.input.connect(delay);
  delay.connect(damp);
  damp.connect(shell.wet);
  damp.connect(feedback);
  feedback.connect(delay);

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      setParam(delay.delayTime, Math.max(0.001, fxParam(p, ["time", "timeMs"], FX_DEFAULTS.delay.time) / 1000));
      // 反馈必须 < 1，否则自激振荡直到削顶
      setParam(feedback.gain, Math.min(0.95, Math.max(0, fxParam(p, ["feedback"], FX_DEFAULTS.delay.feedback))));
      setRouting(shell, slot.enabled, Math.max(0, Math.min(1, fxParam(p, ["mix", "wetLevel"], FX_DEFAULTS.delay.mix))));
    },
  };
}

function createSaturator(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, false);
  const drive = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";
  shell.input.connect(drive);
  drive.connect(shaper);
  shaper.connect(shell.wet);

  let lastDrive = Number.NaN;

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      const driveDb = fxParam(p, ["drive", "driveDb"], FX_DEFAULTS.saturator.drive);
      if (driveDb !== lastDrive) {
        shaper.curve = createSaturationCurve(driveDb);
        lastDrive = driveDb;
      }
      setParam(drive.gain, dbToLinear(driveDb));
      // drive = 0dB 时 tanh 仍会轻微压缩 → 视为「不处理」，交给旁通
      setRouting(shell, slot.enabled && driveDb > 0.05, 1);
    },
  };
}

function createLimiter(ctx: BaseAudioContext): SlotNodes {
  const shell = createSlotShell(ctx, false);
  const comp = ctx.createDynamicsCompressor();
  shell.input.connect(comp);
  comp.connect(shell.wet);

  return {
    input: shell.input,
    output: shell.output,
    update(slot) {
      const p = slot.params;
      setParam(comp.threshold, fxParam(p, ["ceiling", "thresholdDb"], FX_DEFAULTS.limiter.ceiling));
      setParam(comp.ratio, 20);
      setParam(comp.knee, 0);
      setParam(comp.attack, 0.001);
      setParam(comp.release, fxParam(p, ["release", "releaseMs"], FX_DEFAULTS.limiter.release) / 1000);
      setRouting(shell, slot.enabled, 1);
    },
  };
}

function createSlot(ctx: BaseAudioContext, type: FXSlot["type"]): SlotNodes {
  switch (type) {
    case "eq":
      return createEq(ctx);
    case "compressor":
      return createCompressor(ctx);
    case "reverb":
      return createReverb(ctx);
    case "delay":
      return createDelay(ctx);
    case "saturator":
      return createSaturator(ctx);
    case "limiter":
      return createLimiter(ctx);
  }
}

export interface FxChainNodes {
  input: AudioNode;
  output: AudioNode;
  /** 结构签名（id+type+顺序+开关），用于判断是否需要重建 */
  signature: string;
  /** 就地更新参数（结构不变时不重建） */
  update(slots: FXSlot[]): void;
  dispose(): void;
}

/**
 * 按槽列表构建 FX 链。
 *
 * 空链也要有 input/output（直通），调用方无需分支处理。
 */
export function createFxChain(ctx: BaseAudioContext, slots: FXSlot[]): FxChainNodes {
  const input = ctx.createGain();
  const output = ctx.createGain();

  let nodes: SlotNodes[] = [];
  let signature = "";

  const rebuild = (next: FXSlot[]) => {
    // ⚠️ 必须先断开链头与旧槽的输出：空链时 input 直连 output，
    // 重建若只连新节点，直通支路会**与新链并联** → 信号叠加（实测 4kHz +6dB、
    // 100Hz 该衰减却变成增益）。这个问题靠节点计数断言看不出来，只有数值验收能抓到。
    try {
      input.disconnect();
    } catch {
      /* ignore */
    }
    for (const node of nodes) {
      try {
        node.output.disconnect();
      } catch {
        /* ignore */
      }
    }
    nodes = next.map((slot) => createSlot(ctx, slot.type));
    if (nodes.length === 0) {
      input.connect(output);
    } else {
      input.connect(nodes[0].input);
      for (let i = 1; i < nodes.length; i++) nodes[i - 1].output.connect(nodes[i].input);
      nodes[nodes.length - 1].output.connect(output);
    }
    next.forEach((slot, i) => nodes[i].update(slot));
    signature = fxSignature(next);
  };

  rebuild(slots);

  return {
    input,
    output,
    get signature() {
      return signature;
    },
    update(next) {
      const nextSig = fxSignature(next);
      if (nextSig !== signature) {
        rebuild(next);
        return;
      }
      next.forEach((slot, i) => nodes[i]?.update(slot));
    },
    dispose() {
      try {
        input.disconnect();
        output.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
