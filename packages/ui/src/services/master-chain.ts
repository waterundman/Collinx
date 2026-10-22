/**
 * 母带处理链（v2.8.0）。
 *
 * 用途：把「音符总线」到「输出」之间补上真实的母带级联 ——
 * 此前 master 增益直接接 destination，多轨叠加的瞬态会一路冲到底，
 * 只能靠导出时的峰值归一化事后补救。
 *
 * 链路：
 *   input → compressor（总线压缩，收住动态）→ limiter（砖墙，防瞬态过载）→ output
 *
 * 为什么用两个 DynamicsCompressor 而不是一个：
 * - 第一个是「音乐性」的压缩：阈值 -18dB、比例 3:1、软拐点 12dB，
 *   把整首的响度差收拢，听起来更"成型"而不是忽大忽小。
 * - 第二个是「安全」的限幅：阈值 -2dB、比例 20:1、几乎硬拐点，
 *   专门削掉压缩后仍逃逸的瞬态峰值，避免后面归一化时被整体压小。
 *
 * ⚠️ **播放（AudioPreview）与导出（renderNotesToWav）必须用同一份实现** ——
 * 否则「听到的」和「导出的」是两个声音（本项目已在音色规格上踩过一次）。
 */
export interface MasterChain {
  input: AudioNode;
  output: AudioNode;
}

/** 母带链的固定参数（导出与实时共用的唯一真源） */
export const MASTER_CHAIN_PARAMS = {
  compressor: {
    threshold: -18,
    knee: 12,
    ratio: 3,
    attack: 0.01,
    release: 0.25,
  },
  limiter: {
    threshold: -2,
    knee: 0,
    ratio: 20,
    attack: 0.002,
    release: 0.1,
  },
} as const;

/**
 * 在给定 ctx 上创建母带链。
 *
 * @param ctx AudioContext 或 OfflineAudioContext
 * @param input 上游节点（通常是 master gain）
 * @param output 下游节点（通常是 ctx.destination）
 */
export function createMasterChain(
  ctx: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
): MasterChain {
  const compressor = ctx.createDynamicsCompressor();
  const c = MASTER_CHAIN_PARAMS.compressor;
  compressor.threshold.value = c.threshold;
  compressor.knee.value = c.knee;
  compressor.ratio.value = c.ratio;
  compressor.attack.value = c.attack;
  compressor.release.value = c.release;

  const limiter = ctx.createDynamicsCompressor();
  const l = MASTER_CHAIN_PARAMS.limiter;
  limiter.threshold.value = l.threshold;
  limiter.knee.value = l.knee;
  limiter.ratio.value = l.ratio;
  limiter.attack.value = l.attack;
  limiter.release.value = l.release;

  input.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(output);

  return { input: compressor, output: limiter };
}
