/**
 * synth-worklet.js — 在渲染进程的音频线程上从环形缓冲取 PCM 播放。
 *
 * ⚠️ 这里不能 import 任何模块（AudioWorkletGlobalScope 没有模块加载器），
 * 所以环形缓冲的读取逻辑与 src/audio-ring-buffer.ts 是**两份实现**。
 * 两边共享同一套内存布局（由 src/audio-ring-buffer.ts 的 RING_LAYOUT 定义）：
 *
 *   [ writeIndex(Int32) | readIndex(Int32) | underrun(Int32) | overflow(Int32) | capacity(Int32) | Float32 采样 ]
 *   offset 0            4               8              12            16            20 字节起
 *
 * 改布局时必须同时改两处，并跑 audio-ring-buffer.test.ts 验证。
 *
 * ## 为什么不用 postMessage 送音频
 *
 * 音频线程每 128 帧就要一份数据（44.1kHz 下约 2.9ms）。用消息传会有两个问题：
 * 1. 消息到达时间不可控 → 抖动直接变成爆音
 * 2. 主线程一忙（GC、IPC）就断供
 * 共享内存让音频线程**自己按需取**，主线程只需要保证缓冲里始终有货。
 */

const SLOT_WRITE = 0;
const SLOT_READ = 1;
const SLOT_UNDERRUN = 2;
const SLOT_CAPACITY = 4;

class SynthWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    const sab = opts.buffer;

    if (!(sab instanceof SharedArrayBuffer)) {
      // 没有共享内存就什么都不做（保持静音），并让主线程知道
      this.ready = false;
      this.port.postMessage({ type: "unavailable", reason: "SharedArrayBuffer 缺失" });
      return;
    }

    this.ready = true;
    this.indices = new Int32Array(sab, 0, 5);
    this.capacity = Atomics.load(this.indices, SLOT_CAPACITY);
    this.samples = new Float32Array(sab, 20, this.capacity * 2);

    // 通知主线程：可以开始灌数据了
    this.port.postMessage({ type: "ready", capacity: this.capacity });

    // 定期把欠载情况回报给主线程（每约 0.5 秒），用于界面健康显示
    this.framesSinceReport = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!this.ready || !out || out.length === 0) return true;

    const frames = out[0].length;
    const left = out[0];
    const right = out.length > 1 ? out[1] : null;

    const w = Atomics.load(this.indices, SLOT_WRITE);
    const r = Atomics.load(this.indices, SLOT_READ);
    let diff = w - r;
    if (diff < 0) diff += this.capacity;

    const available = diff;
    const toRead = Math.min(frames, available);

    // 从环形缓冲搬数据到输出（可能跨回绕点，分两段）
    if (toRead > 0) {
      let pos = r;
      let copied = 0;
      while (copied < toRead) {
        const contiguous = Math.min(toRead - copied, this.capacity - pos);
        for (let i = 0; i < contiguous; i++) {
          const src = (pos + i) * 2;
          left[copied + i] = this.samples[src];
          if (right) right[copied + i] = this.samples[src + 1];
        }
        pos = (pos + contiguous) % this.capacity;
        copied += contiguous;
      }
      Atomics.store(this.indices, SLOT_READ, pos);
    }

    // 不够就补静音并计数 —— 静音比重复上一帧的爆音好听
    if (toRead < frames) {
      left.fill(0, toRead);
      if (right) right.fill(0, toRead);
      Atomics.add(this.indices, SLOT_UNDERRUN, 1);
    }

    // 周期回报水位（音频线程里不要做重活，只发个数字）
    this.framesSinceReport += frames;
    if (this.framesSinceReport >= sampleRate / 2) {
      this.framesSinceReport = 0;
      const wNow = Atomics.load(this.indices, SLOT_WRITE);
      const rNow = Atomics.load(this.indices, SLOT_READ);
      let d = wNow - rNow;
      if (d < 0) d += this.capacity;
      this.port.postMessage({
        type: "level",
        availableFrames: d,
        underruns: Atomics.load(this.indices, SLOT_UNDERRUN),
      });
    }

    return true;
  }
}

registerProcessor("synth-worklet", SynthWorkletProcessor);
