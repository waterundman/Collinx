/**
 * 音频生产节奏的纯计算。
 *
 * 单独成文件（而非常驻 audio-driver.ts）的原因有两个：
 * 1. 零依赖 → 可以被 `node --test --experimental-strip-types` 直接加载测试
 *    （ESM 模式要求 import 带扩展名，而 driver 里的相对 import 是按 CommonJS
 *    编译产物写的，不能带 .ts）
 * 2. 这是整条驱动链里唯一会导致**永久性欠载**的决策点，独立出来便于单测
 */

/**
 * 由「已过去多少毫秒」算出本轮应生产几块音频。
 *
 * 若实现成「每 tick 固定生产一块」，而定时器周期大于块长
 * （Windows 上 setInterval 最小粒度约 15ms > 512 帧的 11.6ms），
 * 缓冲水位会单调下降，直到周期性爆音 —— 这正是本函数要防的故障。
 *
 * @param elapsedMs 距上次生产的毫秒数
 * @param blockMs   一块音频对应的毫秒数
 * @param cap       单次上限（防止系统休眠恢复后狂渲）
 * @returns 应生产的块数，非负整数
 */
export function computeBlocksToProduce(elapsedMs: number, blockMs: number, cap = 8): number {
  if (!(blockMs > 0) || !(elapsedMs > 0) || !Number.isFinite(elapsedMs)) return 0;
  return Math.min(Math.max(0, Math.round(elapsedMs / blockMs)), Math.max(0, cap));
}
