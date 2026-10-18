/**
 * AudioDriver — 在主进程里按固定节奏驱动合成器渲染，把 PCM 灌进环形缓冲。
 *
 * ## 拓扑
 *
 * ```
 * [主进程]                      [渲染进程音频线程]
 * SynthBridge.render(512)  →  AudioRingBuffer  →  synth-worklet  →  扬声器
 *      ↑ setInterval 驱动            (SharedArrayBuffer)
 * ```
 *
 * ## 为什么主进程用定时器而不是音频硬件时钟
 *
 * 硬件时钟在渲染进程的 AudioContext 里。主进程只能"尽量按节奏生产"，
 * 由环形缓冲吸收节奏误差。因此：
 * - 缓冲容量要大（这里 500ms），能扛住主线程卡顿（GC、IPC、窗口操作）
 * - 水位要监控：长期偏低说明生产不足（会欠载），长期偏高说明生产过剩（会溢出）
 *
 * ## 已知限制（阶段 1）
 *
 * `setInterval` 在 Windows 上最小粒度约 15ms，而 512 帧 @44.1kHz 只需 11.6ms。
 * 用 512 帧会持续生产不足。这里改为**按经过时间补齐**：定时器每 tick 检查
 * 距离上次生产过了多久，需要几块就渲染几块。这样定时器抖动不会变成欠载。
 */

import { AudioRingBuffer } from "./audio-ring-buffer";
import type { NativeSynthBridge } from "./audio-bridge";
import { computeBlocksToProduce } from "./audio-timing";

export interface AudioDriverOptions {
  sampleRate?: number;
  /** 单次渲染块大小（必须与 SynthBridge.prepare 的一致） */
  blockSize?: number;
  /** 环形缓冲容量（帧）—— 默认 500ms */
  capacityFrames?: number;
  /** 定时器周期（毫秒） */
  tickMs?: number;
}

export interface AudioDriverStats {
  /** 已生产的总帧数 */
  producedFrames: number;
  /** 当前缓冲水位（帧） */
  availableFrames: number;
  /** 生产过剩被丢弃的次数 */
  overflowCount: number;
  /** 累计欠载次数（由 worklet 侧统计） */
  underrunCount: number;
  /** 运行时长（毫秒） */
  uptimeMs: number;
}

export class AudioDriver {
  private ring: AudioRingBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private producedFrames = 0;
  private startedAt = 0;
  /** 每块对应的毫秒数 */
  private readonly blockMs: number;
  /** 定时器周期（毫秒） */
  private readonly tickMs: number;

  readonly sampleRate: number;
  readonly blockSize: number;

  /** 合成器（构造时注入；不用 TS 参数属性，因为 Node strip-only 模式不支持） */
  private readonly synth: NativeSynthBridge;

  constructor(synth: NativeSynthBridge, opts: AudioDriverOptions = {}) {
    this.synth = synth;
    this.sampleRate = opts.sampleRate ?? 44100;
    this.blockSize = opts.blockSize ?? 512;
    this.blockMs = (this.blockSize / this.sampleRate) * 1000;

    const capacity = opts.capacityFrames ?? Math.round(this.sampleRate * 0.5);
    this.ring = new AudioRingBuffer(capacity, 2);
    this.tickMs = opts.tickMs ?? Math.max(4, Math.floor(this.blockMs / 2));
  }


  /** 共享内存，交给渲染进程构造 AudioWorkletNode */
  get buffer(): SharedArrayBuffer {
    return this.ring.buffer;
  }

  start(): { buffer: SharedArrayBuffer; sampleRate: number; blockSize: number } {
    if (this.timer) return { buffer: this.ring.buffer, sampleRate: this.sampleRate, blockSize: this.blockSize };

    // 预填充 ~120ms，避免一开始就欠载
    const prefillBlocks = Math.max(2, Math.round(120 / this.blockMs));
    for (let i = 0; i < prefillBlocks; i++) this.produceBlock();

    this.startedAt = Date.now();
    this.lastTick = this.startedAt;
    this.timer = setInterval(() => this.tick(), this.tickMs);

    return { buffer: this.ring.buffer, sampleRate: this.sampleRate, blockSize: this.blockSize };
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ring.reset();
  }

  stats(): AudioDriverStats {
    return {
      producedFrames: this.producedFrames,
      availableFrames: this.ring.available,
      overflowCount: this.ring.overflowCount,
      underrunCount: this.ring.underrunCount,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  /**
   * 定时器回调：按**实际经过的时间**决定需要生产几块。
   *
   * 这是本文件最关键的一行逻辑 —— 如果每 tick 只固定渲染一块，
   * 定时器一延迟（Windows 默认 15ms 粒度 > 11.6ms 的块长）就会永久性欠载。
   * 按时间补齐能把抖动转成"一次多渲几块"，缓冲水位自己会回到稳态。
   */
  private tick(): void {
    const now = Date.now();
    const elapsed = now - this.lastTick;
    if (elapsed <= 0) return;

    // 上限防止长时间挂起后一次性狂渲（比如系统休眠恢复）
    const capped = computeBlocksToProduce(elapsed, this.blockMs, 8);

    for (let i = 0; i < capped; i++) this.produceBlock();

    // 只在真正生产后才推进基准时间，避免"欠下的时间"被丢弃
    if (capped > 0) this.lastTick = now;
  }

  private produceBlock(): void {
    const pcm = this.synth.render(this.blockSize);
    if (!pcm || pcm.length === 0) return;
    const written = this.ring.write(pcm);
    if (written > 0) this.producedFrames += written;
  }
}

