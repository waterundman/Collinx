/**
 * @collinx/audio-engine —— 实验性音频引擎骨架。
 *
 * ⚠️ **当前没有任何包引用它**（v2.9.1 审计实测），产品发声走
 * `packages/ui/src/services/audio-preview.ts` + `instruments.ts`。
 *
 * 保留理由：这里沉淀的是「引擎契约 + 时钟桥 + ADSR」三块与实现无关的部分，
 * 是将来把 Web Audio 合成器与原生（C++/JUCE）引擎收敛到同一接口的落点。
 *
 * 三处音色定义各自不同义（v2.9.1 已改名去歧义）：
 * - 本包 `EngineInstrumentSpec`：引擎契约（SF2/滤波/瞬态/回退）
 * - `ui/services/instruments.ts` 的 `InstrumentSpec`：当前 5 个合成音色的播放参数
 * - `core/model/instrument.ts` 的 `Instrument`：音乐元数据（音域/家族/移调）
 * 收敛时机 = 真正开始接线时，**不要**为了「看起来统一」提前改动，
 * 否则会同时动到已验证的发声链（v2.8.0~v2.9.0 的数值验收基线）。
 *
 * 本文件此前缺失：package.json 的 `main`/`types` 指向 `src/index.ts`，
 * 但文件不存在 —— 任何 import 都会解析失败。v2.9.1 补齐 barrel。
 */
export * from "./core/clock";
export * from "./core/context";
export * from "./engine/types";
export * from "./voice/adsr";
