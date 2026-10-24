/**
 * 分轨导出（v2.9.1）。
 *
 * ## 为什么现在才做
 *
 * `packages/core` 里有一套离线的 `StemRenderer` + `AudioExporter`（自己实现
 * 振荡器与 DSP），但它**在生产代码里零引用** —— 产品导出早就走
 * `wav-export.ts`（Web Audio 离线渲染 + `MixerGraph`）。
 * 两套渲染路径长期并存是典型技术债：同一条轨经两套实现会得到不同的声音。
 *
 * v2.9.1 用 `MixerGraph` 重新实现分轨导出（逐轨 solo 后走同一条渲染管线），
 * 然后删掉那套离线孤岛 —— 能力保留、实现归一。
 *
 * ## 语义
 *
 * 每一轨单独渲染：其余轨全部静音，**保留该轨的推子/声像/FX 与送出**
 * （送出到总线会一并渲染进去，与整曲导出的听感一致）。
 */

import type { MixerState } from "@collinx/core";
import { renderNotesToWav, type RenderableNote, type RenderOptions } from "./wav-export";

export interface StemResult {
  /** 混音条 id（稳定，不随导出顺序变） */
  trackId: string;
  /** 文件名友好的轨道名 */
  name: string;
  wav: Uint8Array;
}

/**
 * 逐轨离线渲染。
 *
 * @param notes 与整曲导出相同的音符列表（含 trackId）
 * @param mixer 混音状态（推子/声像/FX/送出都会应用到每一轨的渲染）
 */
export async function renderStems(
  notes: RenderableNote[],
  mixer: MixerState,
  opts: Omit<RenderOptions, "mixer"> = {},
): Promise<StemResult[]> {
  const results: StemResult[] = [];
  for (const track of mixer.tracks) {
    const key = track.sourceTrackId || track.id;
    const trackNotes = notes.filter((n) => (n.trackId ?? "") === key);
    if (trackNotes.length === 0) continue;

    // 只留这一轨：用 solo 而不是 mute 其它轨 —— 这样该轨的送出（send）仍生效，
    // 与「在混音台里 solo 听这一轨」完全等价。
    const soloed: MixerState = {
      ...mixer,
      tracks: mixer.tracks.map((t) => ({ ...t, solo: t.id === track.id, mute: false })),
    };

    const wav = await renderNotesToWav(trackNotes, { ...opts, mixer: soloed });
    results.push({ trackId: track.id, name: track.name, wav });
  }
  return results;
}

/** 文件名：把轨道名里不安全的字符换掉 */
export function stemFileName(name: string, trackId: string): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, "_").trim() || trackId;
  return `${safe}.wav`;
}
