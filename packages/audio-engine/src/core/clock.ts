/**
 * 时钟换算 —— 全包**唯一**允许跨时钟域的地方。
 *
 * 两个时钟域（混用是经典 bug）：
 * - `performance.now()`：单调的毫秒时钟，用于 UI / 事件时间戳 / Web MIDI 时间戳
 * - `AudioContext.currentTime`：以秒计、只在音频线程推进，用于**精确调度**
 *
 * 换算必须以一次同步采样为基准，否则两钟的偏移与漂移会累积成音画不同步。
 */

export interface ClockSample {
  /** performance.now() 读数（毫秒） */
  perfMs: number;
  /** 对应的 audioTime（秒） */
  audioSec: number;
}

export type PerfNow = () => number;

export class ClockBridge {
  private base: ClockSample | null = null;

  constructor(private readonly perfNow: PerfNow = () => performance.now()) {}

  /** 建立/刷新基准 */
  sync(audioTime: number): void {
    this.base = { perfMs: this.perfNow(), audioSec: audioTime };
  }

  /** 基准是否已建立 */
  get synced(): boolean {
    return this.base !== null;
  }

  /** 把 `performance.now()` 毫秒换算成音频时钟秒 */
  perfToAudio(perfMs: number): number {
    if (!this.base) return 0;
    return this.base.audioSec + (perfMs - this.base.perfMs) / 1000;
  }

  /** 当前时刻在音频时钟域的秒数（未同步时返回 0） */
  now(): number {
    return this.perfToAudio(this.perfNow());
  }

  /** 把音频时钟秒换算回 `performance.now()` 毫秒 */
  audioToPerf(audioSec: number): number {
    if (!this.base) return 0;
    return this.base.perfMs + (audioSec - this.base.audioSec) * 1000;
  }
}

/** MIDI 音高 → 频率（Hz），A4 = 69 = 440Hz */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 频率 → MIDI 音高 */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** 音分 → 频率倍率 */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}
