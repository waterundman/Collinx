/**
 * ⚠️ 尚未挂载 —— 但**不是死代码**，请勿按零引用删除。
 *
 * 规格来源：spec/v1.5.0/main.md — Stage 3「扫描进度 UI」（明确列出 ScanProgressDialog.tsx）
 * 存在理由：插件扫描、健康指示与扫描进度。依赖 packages/audio 的 scan 模块（AsyncScanner / ScanCache / ScanProgressReporter，2246 行）。
 * 当前状态：阻塞于：C++ 引擎编译到绿 + N-API 插件宿主接通。
 *
 * 历史教训（v2.8.0）：这些目录曾因当前零引用被判定为死代码并删除，
 * 随后在 Obsidian 规格库（spec/ 与 bayesian/）中查到它们都是历次迭代
 * Stage 的明确交付物 —— 只是还没接线。判断标准应是「规格里有没有它」，
 * 而不是「当前有没有人 import」。已恢复。
 */
export { PluginBrowser } from "./PluginBrowser";
export { ScanProgressDialog } from "./ScanProgressDialog";
export type { ScanProgress, ScanResult } from "./ScanProgressDialog";
