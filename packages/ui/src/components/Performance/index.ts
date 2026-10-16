/**
 * ⚠️ 尚未挂载 —— 但**不是死代码**，请勿按零引用删除。
 *
 * 规格来源：spec/v1.5.0/main.md — Stage 3（断言「显示 CPU 使用率 / 内存使用 / 处理延迟」）
 * 存在理由：引擎性能监控。CPU/内存/缓冲欠载这些指标只有真实音频引擎才能提供（浏览器端 useTransport 明确不引入 AudioContext，故无法取材）。
 * 当前状态：阻塞于：C++ 引擎编译到绿 + 能采集真实指标。
 *
 * 历史教训（v2.8.0）：这些目录曾因当前零引用被判定为死代码并删除，
 * 随后在 Obsidian 规格库（spec/ 与 bayesian/）中查到它们都是历次迭代
 * Stage 的明确交付物 —— 只是还没接线。判断标准应是「规格里有没有它」，
 * 而不是「当前有没有人 import」。已恢复。
 */
export { PerformanceDashboard } from "./PerformanceDashboard";
export type { PerformanceMetrics } from "./PerformanceDashboard";
