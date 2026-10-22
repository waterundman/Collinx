/**
 * 音色表 —— 让不同轨道听起来是不同乐器。
 *
 * ## 为什么需要它
 *
 * 此前 AudioPreview 与 WAV 导出都用**固定的**「锯齿 + 方波失谐 4 cents」，
 * 于是旋律、贝斯、和弦三条轨音色完全相同，叠在一起只是同一种声音变响。
 * 成熟 DAW 里"像不像一首歌"很大程度取决于**音色的层次**（低音饱满、
 * 和弦铺底、旋律明亮），而不是音符本身。
 *
 * ## 边界
 *
 * 这里只用 Web Audio 的基础振荡器 + 包络模拟乐器，不采样、不接 VST。
 * 目标是"能听出层次"，不是"以假乱真"。真正的音源要等 VST3 宿主接进 UI。
 *
 * ## 一致性要求
 *
 * 播放（AudioPreview）与导出（renderNotesToWav）**必须**读同一份 spec，
 * 否则"听到的"和"导出的"是两个声音 —— 这是最容易被忽略的一致性缺陷。
 */

/** 振荡器配置：波形 + 相对失谐（cents）+ 相对增益 */
export interface OscillatorSpec {
  type: OscillatorType;
  detune: number;
  gain: number;
}

export interface InstrumentSpec {
  /** 展示名（混音台音色下拉用）；缺省时调用方回落显示 id */
  label?: string;
  /** 振荡器叠加（音色的"厚薄"由数量与波形决定） */
  oscillators: OscillatorSpec[];
  /** 起音秒数（越长越"软"） */
  attack: number;
  /** 释音秒数 */
  release: number;
  /** 稳态电平相对峰值的比例（< 1 表示有自然衰减，如拨弦） */
  sustain: number;
  /** 该音色的基础增益（平衡不同波形的响度差异） */
  level: number;
}

/**
 * 五种基础音色。
 *
 * 参数不是随便调的，各对应一种听觉特征：
 * - `lead`：亮（锯齿）+ 轻微失谐增厚 → 旋律能"钻出来"
 * - `bass`：正弦打底保证低频能量，叠一点锯齿给音头 → 不浑浊
 * - `pad`：三角波柔和 + 长起音长释音 → 和弦铺底不抢旋律
 * - `keys`：方波 + 中等释音 → 有"敲击"感又不像拨弦那么短
 * - `pluck`：极短起音 + 低稳态 → 明显的衰减，适合节奏型
 */
export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  lead: {
    label: "主奏 Lead",
    oscillators: [
      { type: "sawtooth", detune: 0, gain: 1 },
      { type: "square", detune: 4, gain: 0.5 },
    ],
    attack: 0.005,
    release: 0.08,
    sustain: 0.7,
    level: 0.35,
  },
  bass: {
    label: "贝斯 Bass",
    oscillators: [
      { type: "sine", detune: 0, gain: 1 },
      { type: "sawtooth", detune: -4, gain: 0.35 },
    ],
    attack: 0.004,
    release: 0.06,
    sustain: 0.8,
    level: 0.45,
  },
  pad: {
    label: "铺底 Pad",
    oscillators: [
      { type: "triangle", detune: 0, gain: 1 },
      { type: "sawtooth", detune: 7, gain: 0.3 },
      { type: "sawtooth", detune: -7, gain: 0.3 },
    ],
    attack: 0.4,
    release: 0.6,
    sustain: 0.9,
    level: 0.22,
  },
  keys: {
    label: "键盘 Keys",
    oscillators: [
      { type: "square", detune: 0, gain: 1 },
      { type: "sine", detune: 7, gain: 0.4 },
    ],
    attack: 0.008,
    release: 0.3,
    sustain: 0.5,
    level: 0.28,
  },
  pluck: {
    label: "拨弦 Pluck",
    oscillators: [
      { type: "sawtooth", detune: 0, gain: 1 },
      { type: "triangle", detune: -7, gain: 0.4 },
    ],
    attack: 0.002,
    release: 0.18,
    sustain: 0.15,
    level: 0.32,
  },
};

/** 兜底音色 —— 未知轨道不能静音，否则用户会以为"没声音"是 bug */
export const DEFAULT_INSTRUMENT = "lead";

/**
 * 轨道 ID → 音色。
 *
 * 用名称匹配而不是引入新字段：现有工程的 `NoteSpan.data.trackId` 就是
 * `melody` / `bass` / `chords` 这类语义名，加字段需要迁移旧工程，
 * 收益不抵成本。匹配不到就兜底到 lead。
 */
export function instrumentForTrack(trackId: string | undefined): string {
  if (!trackId) return DEFAULT_INSTRUMENT;
  const id = trackId.toLowerCase();

  if (id.includes("bass")) return "bass";
  if (id.includes("chord") || id.includes("harmony") || id.includes("pad")) return "pad";
  if (id.includes("pluck") || id.includes("arp")) return "pluck";
  if (id.includes("key") || id.includes("piano")) return "keys";
  if (id.includes("melody") || id.includes("lead")) return "lead";

  return DEFAULT_INSTRUMENT;
}

/**
 * 解析一个轨道实际该用的音色（v2.8.0）。
 *
 * 优先级：**MixerTrack 上显式指定的 instrument** > 按 trackId 名称推断 > 默认。
 *
 * 为什么要这个函数而不是直接用 instrumentForTrack：后者只看名称，
 * 用户无法改变（「无法选音色」正是最初可行性报告的 ❌ 项之一）。
 * MixerTrack.instrument 是可选字段，老工程没有 → 自动回落到名称推断，
 * 行为与改动前完全一致。
 *
 * @param explicit 轨道上显式指定的音色 id（MixerTrack.instrument）
 * @param trackId  音符的 trackId（回落用）
 */
export function resolveInstrument(
  explicit: string | undefined,
  trackId: string | undefined,
): string {
  const want = (explicit ?? "").trim();
  if (want) {
    const spec = INSTRUMENTS[want as keyof typeof INSTRUMENTS];
    // 只接受真实存在的音色 id —— 脏数据不该让整条轨道静音
    if (spec) return want;
  }
  return instrumentForTrack(trackId);
}

/** 取音色 spec（未知 id 兜底，避免调用方到处判空） */
export function getInstrument(id: string | undefined): InstrumentSpec {
  if (!id) return INSTRUMENTS[DEFAULT_INSTRUMENT];
  return INSTRUMENTS[id] ?? INSTRUMENTS[DEFAULT_INSTRUMENT];
}

/**
 * 音符峰值增益。
 *
 * 力度曲线是平方（接近人耳对响度的幂律感知），再乘音色自身的 level
 * —— 不同波形的实际响度差很多，不归一化会让 pad 盖过 lead。
 */
export function notePeakGain(velocity: number, spec: InstrumentSpec): number {
  if (!Number.isFinite(velocity)) return 0;
  const v = Math.max(0, Math.min(1, velocity));
  return Math.max(0.0002, v * v * spec.level);
}
