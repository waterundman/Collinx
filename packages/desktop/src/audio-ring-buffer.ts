/**
 * AudioRingBuffer — 生产者/消费者共享的定长环形缓冲，用于把合成器渲染出的
 * PCM 交给 AudioWorklet。
 *
 * ## 为什么需要它
 *
 * 合成器（SynthBridge.render）跑在主进程，播放（AudioContext）在渲染进程。
 * 两边速率不可能精确匹配：主进程靠定时器驱动（抖动可达毫秒级），音频硬件
 * 靠固定采样时钟。中间必须有一个缓冲吸收抖动，否则不是爆音就是卡顿。
 *
 * ## 布局
 *
 * ```
 * [ writeIndex | readIndex | underrunCount | overflowCount | capacity | 采样数据 ]
 *    Int32         Int32          Int32            Int32         Int32     Float32 × N
 * ```
 *
 * 把索引放在同一块 SharedArrayBuffer 里，两个线程直接读写，不需要额外的
 * IPC 消息——这正是它比"postMessage 传 Float32Array"更快的原因：
 * **零拷贝、零消息**。
 *
 * ## 为什么不加锁
 *
 * 单生产者单消费者（SPSC）场景下，用 Atomics 维护读写指针就够了：
 * 生产者只写 writeIndex，消费者只写 readIndex，各自读对方的指针判断余量。
 * 加锁会让音频线程有可能被阻塞，那是实时音频的大忌。
 *
 * ## 线程归属
 *
 * - `write()` 只在**生产者线程**（这里是 Electron 主进程）调用
 * - `read()` 只在**消费者线程**（AudioWorklet 的 process 回调）调用
 * 两个方法都**不可重入**，也不要在同一个线程里混用。
 */
export class AudioRingBuffer {
  /** Int32 的字节数（4）。注意不能用 Float64Array —— Atomics 只接受整数类型数组 */
  private static readonly INDEX_BYTES = 4;

  /** 索引槽位：写指针 / 读指针 / 欠载计数 / 溢出计数 / 容量 */
  private static readonly SLOT_WRITE = 0;
  private static readonly SLOT_READ = 1;
  private static readonly SLOT_UNDERRUN = 2;
  private static readonly SLOT_OVERFLOW = 3;
  private static readonly SLOT_CAPACITY = 4;

  private readonly sab: SharedArrayBuffer;
  private readonly indices: Int32Array;
  private readonly samples: Float32Array;
  readonly capacity: number;
  readonly channels: number;

  /**
   * @param capacityFrames 容量（以「帧」计，一帧 = channels 个采样）
   * @param channels 声道数（本引擎固定 2）
   */
  constructor(capacityFrames: number, channels = 2) {
    if (!Number.isInteger(capacityFrames) || capacityFrames <= 0) {
      throw new Error("capacityFrames 必须是正整数");
    }
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new Error("channels 必须是正整数");
    }

    this.capacity = capacityFrames;
    this.channels = channels;

    const indexRegion = 5 * AudioRingBuffer.INDEX_BYTES;
    const sampleRegion = capacityFrames * channels * 4;
    this.sab = new SharedArrayBuffer(indexRegion + sampleRegion);

    this.indices = new Int32Array(this.sab, 0, 5);
    this.samples = new Float32Array(this.sab, indexRegion, capacityFrames * channels);

    // 容量写进共享区，消费者（worklet）靠它算余量，不需要额外传参
    Atomics.store(this.indices, AudioRingBuffer.SLOT_CAPACITY, capacityFrames);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_WRITE, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_READ, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_UNDERRUN, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_OVERFLOW, 0);
  }

  /** 共享内存本体 —— 通过 IPC 传给渲染进程 */
  get buffer(): SharedArrayBuffer {
    return this.sab;
  }

  /** 当前可读帧数 */
  get available(): number {
    const w = Atomics.load(this.indices, AudioRingBuffer.SLOT_WRITE);
    const r = Atomics.load(this.indices, AudioRingBuffer.SLOT_READ);
    // 允许写指针因绕回而「小于」读指针
    const diff = w - r;
    return diff < 0 ? diff + this.capacity : diff;
  }

  /** 当前空闲帧数 */
  get free(): number {
    return this.capacity - this.available;
  }

  get underrunCount(): number {
    return Atomics.load(this.indices, AudioRingBuffer.SLOT_UNDERRUN);
  }

  get overflowCount(): number {
    return Atomics.load(this.indices, AudioRingBuffer.SLOT_OVERFLOW);
  }

  /**
   * 生产者写入交织立体声数据（[L,R,L,R,...]）。
   *
   * @returns 实际写入的帧数；空间不足时**整体丢弃**本次写入并累加 overflow，
   *          不做部分写入 —— 部分写入会造成左右声道错位（更难听的破音）。
   */
  write(interleaved: Float32Array, frameOffset = 0, frameCount?: number): number {
    const frames = frameCount ?? Math.floor(interleaved.length / this.channels);
    if (frames <= 0) return 0;

    if (frames > this.free) {
      Atomics.add(this.indices, AudioRingBuffer.SLOT_OVERFLOW, 1);
      return 0;
    }

    let w = Atomics.load(this.indices, AudioRingBuffer.SLOT_WRITE);
    let src = frameOffset * this.channels;
    let remaining = frames;

    while (remaining > 0) {
      const contiguous = Math.min(remaining, this.capacity - w);
      const dstStart = w * this.channels;
      const dstEnd = dstStart + contiguous * this.channels;
      this.samples.set(interleaved.subarray(src, src + contiguous * this.channels), dstStart);

      w = (w + contiguous) % this.capacity;
      src += contiguous * this.channels;
      remaining -= contiguous;
      void dstEnd;
    }

    // 只在数据写完之后推进写指针 —— 否则消费者可能读到半截数据
    Atomics.store(this.indices, AudioRingBuffer.SLOT_WRITE, w);
    return frames;
  }

  /**
   * 消费者读取交织数据到目标数组。
   *
   * @returns 实际读到的帧数。不足时**补零**并累加 underrun ——
   *          静音比重复上一帧的爆音更可接受。
   */
  read(dest: Float32Array, frameOffset = 0, frameCount?: number): number {
    const frames = frameCount ?? Math.floor(dest.length / this.channels);
    if (frames <= 0) return 0;

    const avail = this.available;
    const toRead = Math.min(frames, avail);

    let r = Atomics.load(this.indices, AudioRingBuffer.SLOT_READ);
    let dst = frameOffset * this.channels;
    let remaining = toRead;

    while (remaining > 0) {
      const contiguous = Math.min(remaining, this.capacity - r);
      const srcStart = r * this.channels;
      dest.set(this.samples.subarray(srcStart, srcStart + contiguous * this.channels), dst);

      r = (r + contiguous) % this.capacity;
      dst += contiguous * this.channels;
      remaining -= contiguous;
    }

    Atomics.store(this.indices, AudioRingBuffer.SLOT_READ, r);

    // 不够的部分补零（静音），并记录欠载
    if (toRead < frames) {
      dest.fill(0, dst, dst + (frames - toRead) * this.channels);
      Atomics.add(this.indices, AudioRingBuffer.SLOT_UNDERRUN, 1);
    }

    return toRead;
  }

  /** 清空（生产者侧调用；消费者不应在播放中调用） */
  reset(): void {
    Atomics.store(this.indices, AudioRingBuffer.SLOT_WRITE, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_READ, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_UNDERRUN, 0);
    Atomics.store(this.indices, AudioRingBuffer.SLOT_OVERFLOW, 0);
    this.samples.fill(0);
  }
}

/**
 * 消费者侧（AudioWorklet）用的只读视图。
 *
 * worklet 全局里没有模块加载器，所以它不能 import 这个类 —— 那边有一份
 * 等价的实现（见 synth-worklet.js）。两边共享同一套内存布局常量，
 * 改布局时必须同时改两处，并跑 `audio-ring-buffer.test.ts` 验证。
 */
export const RING_LAYOUT = {
  slotWrite: 0,
  slotRead: 1,
  slotUnderrun: 2,
  slotOverflow: 3,
  slotCapacity: 4,
  indexRegionBytes: 5 * 8,
} as const;
