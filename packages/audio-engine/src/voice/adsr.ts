import type { EnvelopeSpec } from "../engine/types";

/**
 * ADSR 包络（线性分段）。
 *
 * 为什么自己算而不用 `GainNode.setTargetAtTime`：Web Audio 的指数/线性时间
 * 曲线不透明，无法在无浏览器环境下断言时序。这里用纯函数 `levelAt(t)`，
 * 既是调度用的真值，也是单测的观测点 —— 包络行为因此可被客观验证，
 * 而不是"听起来差不多"。
 */
export type EnvelopeStage = "idle" | "attack" | "decay" | "sustain" | "release";

export const DEFAULT_ENVELOPE: EnvelopeSpec = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.25,
};

export class Envelope {
  private spec: EnvelopeSpec;
  private _stage: EnvelopeStage = "idle";
  /** 触发时刻（秒）；release 时为 noteOff 时刻 */
  private startTime = 0;
  /** noteOff 时刻 */
  private releaseTime = 0;
  private value = 0;

  constructor(spec: Partial<EnvelopeSpec> = {}) {
    this.spec = { ...DEFAULT_ENVELOPE, ...spec };
  }

  get stage(): EnvelopeStage {
    return this._stage;
  }

  get currentValue(): number {
    return this.value;
  }

  get envelopeSpec(): EnvelopeSpec {
    return { ...this.spec };
  }

  /** 包络是否仍在发声（idle / release 结束后为 false） */
  get active(): boolean {
    return this._stage !== "idle";
  }

  noteOn(atSec: number, velocity = 1): void {
    this.startTime = atSec;
    this._stage = "attack";
    // 力度越大起音越快（模拟击弦瞬态），并按力度缩放峰值
    this.peak = clamp01(velocity);
    this.value = 0;
  }

  noteOff(atSec: number): void {
    if (this._stage === "idle") return;
    // 延音模式：还没走完 attack/decay 就松开时，从当前值直接进入 release
    this.releaseTime = atSec;
    this.releaseStartValue = this.levelAt(atSec);
    this._stage = "release";
  }

  private peak = 1;
  private releaseStartValue = 0;

  /** 某时刻的电平 0..1 */
  levelAt(t: number): number {
    const { attack, decay, sustain, release } = this.spec;
    switch (this._stage) {
      case "idle":
        return 0;

      case "attack": {
        if (attack <= 0) {
          this._stage = "decay";
          return this.levelAt(t);
        }
        const p = (t - this.startTime) / attack;
        if (p >= 1) {
          this._stage = "decay";
          return this.levelAt(t);
        }
        return this.peak * p;
      }

      case "decay": {
        const decayEnd = this.startTime + attack + decay;
        if (t < this.startTime + attack) return this.peak;
        if (decay <= 0) {
          this._stage = "sustain";
          return this.peak * sustain;
        }
        if (t >= decayEnd) {
          this._stage = "sustain";
          return this.levelAt(t);
        }
        const p = (t - this.startTime - attack) / decay;
        return this.peak * (1 + (sustain - 1) * p);
      }

      case "sustain":
        return this.peak * sustain;

      case "release": {
        if (release <= 0) {
          this._stage = "idle";
          this.value = 0;
          return 0;
        }
        const p = (t - this.releaseTime) / release;
        if (p >= 1) {
          this._stage = "idle";
          this.value = 0;
          return 0;
        }
        if (p < 0) return this.releaseStartValue;
        return this.releaseStartValue * (1 - p);
      }
    }
  }

  /** 采样求值并推进内部状态（渲染线程用） */
  update(t: number): number {
    const v = this.levelAt(t);
    this.value = v;
    return v;
  }

  /** 估算包络结束时刻（用于声部提前回收） */
  endTime(): number {
    const { attack, decay, release } = this.spec;
    switch (this._stage) {
      case "attack":
      case "decay":
        return this.startTime + attack + decay + (this._stage === "decay" ? 0 : 0);
      case "sustain":
        return Number.POSITIVE_INFINITY;
      case "release":
        return this.releaseTime + release;
      case "idle":
        return this.startTime;
    }
  }

  setSpec(spec: Partial<EnvelopeSpec>): void {
    this.spec = { ...this.spec, ...spec };
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
