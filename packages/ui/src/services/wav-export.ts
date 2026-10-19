/**
 * WAV 导出 —— 让用户拿到能播的成品。
 *
 * 真实验收发现：Collinx 只能导出 MIDI / MusicXML / PDF，没有音频。
 * 而"做出一首歌"的终点是一个能播的文件 —— 这个文件缺了，
 * 前八步做得再好也交不出去。
 *
 * 实现分两层：
 * 1. `encodeWav`：纯函数（Float32 采样 → 16-bit PCM WAV 字节）。
 *    可单测，且不依赖任何浏览器 API。
 * 2. `renderNotesToWav`：用 OfflineAudioContext 把音符渲染成采样，
 *    复用 AudioPreview 的振荡器配置，再交给编码器。
 *    依赖浏览器，只能在真实环境验证（jsdom 没有 OfflineAudioContext）。
 */

/** 16-bit PCM WAV 的固定头长度：44 字节 */
export const WAV_HEADER_BYTES = 44;

export interface WavOptions {
  sampleRate?: number;
  /** 声道数，1 = 单声道，2 = 立体声 */
  channels?: number;
}

/**
 * 把交织的 Float32 采样编码成 16-bit PCM WAV。
 *
 * @param interleaved 交织采样（[L,R,L,R,...] 或单声道 [M,M,...]），范围 -1..1
 */
export function encodeWav(interleaved: Float32Array, opts: WavOptions = {}): Uint8Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const channels = opts.channels ?? 2;

  if (channels !== 1 && channels !== 2) {
    throw new Error(`channels 只支持 1 或 2，收到 ${channels}`);
  }
  if (interleaved.length % channels !== 0) {
    throw new Error(
      `采样数 ${interleaved.length} 不是声道数 ${channels} 的整数倍（交织数据不完整）`,
    );
  }

  const frames = interleaved.length / channels;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = frames * blockAlign;

  const buf = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buf);

  // ── RIFF 头 ──
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // 文件总长 - 8
  writeAscii(view, 8, "WAVE");

  // ── fmt 子块 ──
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM 的 fmt 块长度固定 16
  view.setUint16(20, 1, true); // audioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bitsPerSample = 16

  // ── data 子块 ──
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // ── 采样：Float32 [-1,1] → Int16 ──
  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < interleaved.length; i++) {
    // 钳制：超出 ±1 的采样（总线叠加时常见）必须截断，否则会因整数回绕
    // 变成刺耳的爆音 —— 这是音频导出最典型的翻车点
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    // 正负区间不对称：Int16 是 -32768..32767。负数用 0x8000 缩放（-1 → -32768），
    // 正数用 0x7fff（+1 → +32767）。若正数也用 0x8000，满幅信号会溢出成 -32768
    // —— 听感上是突然反相的爆音，而文件本身仍是合法 WAV，极难排查。
    //
    // 另外必须**显式四舍五入**：DataView.setInt16 对浮点入参做的是截断（ToInt16），
    // 会系统性偏低 0.5 LSB；而 round 之后又可能把 0x7fff*1 抬到 32768，
    // 所以再钳一次上界。
    const scaled = s < 0 ? s * 0x8000 : s * 0x7fff;
    const clamped = Math.max(-0x8000, Math.min(0x7fff, Math.round(scaled)));
    view.setInt16(offset, clamped, true);
    offset += 2;
  }

  return new Uint8Array(buf);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** 解析 WAV 头（用于自检与测试断言） */
export interface WavHeader {
  riff: string;
  wave: string;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  totalBytes: number;
}

export function parseWavHeader(bytes: Uint8Array): WavHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    riff: String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]),
    wave: String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
    totalBytes: bytes.byteLength,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 离线渲染：把排好时间的音符渲染成交织立体声采样
// ─────────────────────────────────────────────────────────────────────────

export interface RenderableNote {
  pitchMidi: number;
  /** 0..1 */
  velocity: number;
  /** 相对工程开头的秒数 */
  startSec: number;
  /** 持续秒数 */
  durSec: number;
}

export interface RenderOptions {
  sampleRate?: number;
  /** 总时长（秒）；默认取最后一个音符的结束时间 + 1.5s 尾巴 */
  durationSec?: number;
  masterGain?: number;
}

/**
 * 用 OfflineAudioContext 离线渲染音符（比实时播放快，且结果确定）。
 *
 * 为什么用离线渲染而不是录音：导出必须是**样本级确定**的产物，
 * 实时录音会受设备缓冲与调度抖动影响，同一工程两次导出长度都不同。
 *
 * 音色配置与 AudioPreview 保持一致（锯齿 + 方波，失谐 4 cents），
 * 这样"听到的"与"导出的"是同一个声音。
 */
export async function renderNotesToWav(
  notes: RenderableNote[],
  opts: RenderOptions = {},
): Promise<Uint8Array> {
  const sampleRate = opts.sampleRate ?? 44100;
  const masterGain = opts.masterGain ?? 0.8;

  const lastEnd = notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 0);
  const durationSec = opts.durationSec ?? lastEnd + 1.5;

  const Ctor =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
      .OfflineAudioContext;
  if (!Ctor) {
    throw new Error("当前环境不支持 OfflineAudioContext，无法渲染音频");
  }

  const ctx = new Ctor(2, Math.ceil(durationSec * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = masterGain;
  master.connect(ctx.destination);

  for (const note of notes) {
    if (note.durSec <= 0) continue;

    const t0 = Math.max(0, note.startSec);
    const peak = Math.max(0.0002, Math.min(1, note.velocity) ** 2 * 0.35);

    const env = ctx.createGain();
    // 5ms 起音防爆音；音符结束前 80ms 释音（与 AudioPreview 的 release 一致）
    const release = 0.08;
    const attack = 0.005;
    const end = t0 + Math.max(note.durSec, attack + release + 0.001);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.setValueAtTime(peak, Math.max(t0 + attack, end - release));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(master);

    const freq = 440 * Math.pow(2, (note.pitchMidi - 69) / 12);
    for (const [type, detune] of [
      ["sawtooth", 0],
      ["square", 4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(env);
      osc.start(t0);
      osc.stop(end + 0.01);
    }
  }

  const rendered = await ctx.startRendering();

  // 交织成立体声（左 = 右 = 单声道内容；后续可做真实声像）
  const frames = rendered.length;
  const interleaved = new Float32Array(frames * 2);
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = left[i];
    interleaved[i * 2 + 1] = right[i];
  }

  return encodeWav(interleaved, { sampleRate, channels: 2 });
}
