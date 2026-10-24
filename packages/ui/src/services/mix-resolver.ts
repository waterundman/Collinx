/**
 * 混音状态解析（v2.9.0）——纯函数层。
 *
 * ## 为什么单独一层
 *
 * 「静音点了没反应 / 声像拧了不偏 / FX 加了不变声」这三类缺陷的共同形态是
 * **数据改了但没进音频路径**。这类问题单测和 tsc 都发现不了，只有真点一次才暴露。
 *
 * 所以把所有判定（静音/独奏/声像/总线键/FX 结构签名）抽成不依赖 Web Audio 的
 * 纯函数：音频实现只负责「照着结果设参数」，判定本身可以被逐条断言。
 *
 * ## 三条硬约定
 *
 * 1. `gainDb` 可能是字符串 `"-Infinity"`（推子拉到底）。**不能用 isFinite 判无效**
 *    —— -Infinity 在增益语义里是合法的「真静音」，判成无效会回退 0dB（反而更响）。
 * 2. 独奏是**并集**：任一轨 solo 时，非 solo 轨全部静音；master 不参与。
 * 3. mute 优先于 solo：既 mute 又 solo 的轨仍然静音。
 */

import type { FXSlot, MixerState, MixerTrack } from "@collinx/core";

/** 解析 dB 字符串/数字。非法值回 0；`-Infinity` 原样保留（= 真静音）。 */
export function parseGainDb(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isNaN(raw) ? 0 : raw;
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const n = Number.parseFloat(raw);
  // parseFloat("-Infinity") === -Infinity，必须保留；只有 NaN 才回退
  return Number.isNaN(n) ? 0 : n;
}

/** 解析声像：钳到 [-1, 1]，非法值回 0（居中）。 */
export function parsePan(raw: string | number | null | undefined): number {
  if (typeof raw === "number") {
    if (Number.isNaN(raw) || !Number.isFinite(raw)) return 0;
    return Math.max(-1, Math.min(1, raw));
  }
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

/** 是否存在任何 solo 轨（master 不参与独奏判定）。 */
export function hasAnySolo(mixer: Pick<MixerState, "tracks">): boolean {
  return mixer.tracks.some((t) => t.solo);
}

/** 该轨是否实际静音。solo 状态由调用方算好传入，避免每条轨重复扫描。 */
export function effectiveMute(track: MixerTrack, anySolo: boolean): boolean {
  return track.mute || (anySolo && !track.solo);
}

/** 该轨最终送进音频的 dB。静音返回 -Infinity（`dbToLinear` 会得到 0）。 */
export function effectiveGainDb(track: MixerTrack, anySolo: boolean): number {
  if (effectiveMute(track, anySolo)) return -Infinity;
  return parseGainDb(track.gainDb);
}

/**
 * 等功率声像增益（左, 右）。
 *
 * 用等功率而不是线性：线性衰减在居中时两侧各 0.5，总功率只有 0.5，
 * 听感上「拧到中间音量掉一半」。等功率满足 `L² + R² = 1`，
 * 居中时两侧各 √2/2。`StereoPannerNode` 用的就是这条曲线。
 *
 * 本函数不参与实际发声（实际由 `StereoPannerNode` 完成），
 * 作用是给断言与文档一个逐值可核对的真源。
 */
export function panGains(pan: number): { left: number; right: number } {
  const p = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  const theta = ((p + 1) * Math.PI) / 4; // 0..π/2
  return { left: Math.cos(theta), right: Math.sin(theta) };
}

/**
 * 混音轨 → 音频总线键。
 *
 * 音符的 `trackId` 与 `MixerTrack.sourceTrackId` 是同一套标识；
 * 不能直接用 `track.id`（那是混音条自己的 uuid），否则音符会落到另一条总线上，
 * 推子/静音全部失效——而且不报错。
 */
export function busKeyOf(track: Pick<MixerTrack, "id" | "sourceTrackId">): string {
  return track.sourceTrackId && track.sourceTrackId.length > 0
    ? track.sourceTrackId
    : track.id;
}

/**
 * 音符的 trackId → 总线键，按混音台解析。
 *
 * 先按 `sourceTrackId` 精确匹配，其次按混音条 `id` 匹配（@agentmusic 里可能出现
 * 直接写条 id 的旧数据），都没有则原样使用——保证「未知轨」仍有一条独立总线，
 * 而不是掉进默认总线被别人的推子控制。
 */
export function resolveBusKey(noteTrackId: string | undefined, mixer: MixerState): string {
  if (!noteTrackId) return "";
  const bySource = mixer.tracks.find((t) => t.sourceTrackId === noteTrackId);
  if (bySource) return busKeyOf(bySource);
  const byId = mixer.tracks.find((t) => t.id === noteTrackId);
  if (byId) return busKeyOf(byId);
  return noteTrackId;
}

/** 按总线键找混音条（用于 App 侧统一解析音色/增益）。 */
export function trackByBusKey(mixer: MixerState, key: string): MixerTrack | undefined {
  return (
    mixer.tracks.find((t) => busKeyOf(t) === key) ??
    mixer.tracks.find((t) => t.id === key || t.sourceTrackId === key)
  );
}

/**
 * FX 链的**结构签名**（id + 类型 + 顺序 + 开关）。
 *
 * 结构变化才需要重建节点图；只改参数不重建（重建会短暂断音并可能爆音）。
 * 开关也算结构：旁通走的是独立的 bypass 支路，不重建但需要重连增益。
 */
export function fxSignature(slots: FXSlot[]): string {
  return slots.map((s) => `${s.id}:${s.type}:${s.enabled ? 1 : 0}`).join("|");
}

/** 参与发声音的 FX 槽（enabled 的），保持链上顺序。 */
export function activeFxSlots(slots: FXSlot[]): FXSlot[] {
  return slots.filter((s) => s.enabled);
}

/** 解析 FX 参数（字符串 → 数字），支持 UI 键与 core 旧键两套命名。 */
export function fxParam(
  params: Record<string, string> | undefined,
  keys: string[],
  fallback: number,
): number {
  if (!params) return fallback;
  for (const key of keys) {
    const raw = params[key];
    if (raw === undefined || raw === "") continue;
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 混音状态的下游（AudioPreview / 录制回放器 / 测试桩） */
export interface MixerAudioTarget {
  setTrackGain(key: string, db: number): void;
  setTrackPan(key: string, pan: number): void;
  setTrackFx(key: string, slots: FXSlot[]): void;
  setMasterGain(db: number): void;
}

/**
 * 把整份混音状态推给音频目标。
 *
 * 这是「混音台 → 声音」的**唯一入口**：App 只在 mixer 变化时调它一次，
 * 判定逻辑（独奏并集 / 静音优先 / 声像 / 总线键）全在纯函数里，
 * 因此可被逐条断言，而不是散落在组件里、只能靠真机点。
 */
export function applyMixerToAudio(mixer: MixerState, target: MixerAudioTarget): void {
  const anySolo = hasAnySolo(mixer);
  for (const track of mixer.tracks) {
    const key = busKeyOf(track);
    target.setTrackGain(key, effectiveGainDb(track, anySolo));
    target.setTrackPan(key, parsePan(track.pan));
    target.setTrackFx(key, track.fxChain.slots);
  }
  target.setMasterGain(parseGainDb(mixer.masterTrack.gainDb));
}

