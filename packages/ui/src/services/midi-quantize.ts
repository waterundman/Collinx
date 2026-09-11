/**
 * MIDI 量化 service (v1.26.0 Stage 0 / D1-1)
 *
 * 纯函数：MIDI 录入的时间戳（毫秒）→ 拍数 → grid 对齐，
 * 与 React / DOM / 音频引擎解耦、独立可测。
 * 不修改入参、无副作用、不 throw（非法入参走边界归零 / 原样返回，
 * 调用方负责 clamp 兜底与小节回绕）。
 */

/**
 * 毫秒时长 → 拍数：elapsedMs * bpm / 60000。
 * 例：500ms @ 120bpm = 1 拍；1000ms @ 60bpm = 1 拍。
 * 边界：elapsedMs <= 0 → 0；bpm <= 0 → 0（调用方 clamp 兜底）。
 */
export function elapsedToBeats(elapsedMs: number, bpm: number): number {
  if (elapsedMs <= 0 || bpm <= 0) {
    return 0;
  }
  return (elapsedMs * bpm) / 60000;
}

/**
 * beat 量化到 grid：round-to-nearest（DAW input quantize 惯例）。
 * 例：grid=0.25 时 1.1 → 1、3.9 → 4.0；grid=0.5 时 1.26 → 1.5。
 * 半值精确落点（如 4.75 @ grid=0.5）按 Math.round 半值向上。
 * 边界：grid <= 0 → beat 原样返回（off / 非法 grid）。
 * 不含小节回绕（beat > 4 由调用方处理）。
 */
export function snapBeat(beat: number, grid: number): number {
  if (grid <= 0) {
    return beat;
  }
  return Math.round(beat / grid) * grid;
}
