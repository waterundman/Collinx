/**
 * 分贝 ↔ 线性增益换算。
 *
 * ## 为什么要单独抽出来
 *
 * 混音台的推子存的是 dB（`MixerTrack.gainDb`），而 Web Audio 的
 * `GainNode.gain` 要的是线性倍数。这个换算一旦写错，听感就是"推子动了
 * 但音量几乎没变"或者"轻轻一推就爆掉"——而且**没有任何报错**，
 * 只能靠耳朵发现，是最难排查的一类问题。
 *
 * ## 换算公式
 *
 * 振幅分贝：`linear = 10^(dB / 20)`
 * - 0 dB → 1.0（不增不减）
 * - -6 dB → 0.501（约一半振幅，听感"小一点"）
 * - +6 dB → 1.995（约两倍振幅）
 *
 * 注意**不是** `10^(dB/10)` —— 那是功率分贝，用错会让 -6dB 变成 0.25，
 * 听起来像 -12dB。
 */

/** 混音台的增益范围（与 MixerTrack / UI 推子一致） */
export const GAIN_DB_MIN = -60;
export const GAIN_DB_MAX = 12;

/**
 * 分贝 → 线性增益。
 *
 * 钳制到 [-60, +12]：超出范围的值（损坏的工程文件、越界输入）不应让
 * 增益变成无穷大（+∞ 会直接炸掉输出）或负数。
 *
 * 低于下限直接返回 0（真静音），而不是 10^(-60/20)≈0.001 ——
 * 后者在推子拉到最低时仍能听见一丝声音，不符合"拉到最低就是静音"的直觉。
 */
export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= GAIN_DB_MIN) return 0;
  const clamped = Math.min(GAIN_DB_MAX, db);
  return Math.pow(10, clamped / 20);
}

/** 线性增益 → 分贝（用于从电平反推动作量，如"需衰减多少才能不削波"） */
export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return GAIN_DB_MIN;
  return 20 * Math.log10(linear);
}
