/**
 * ⚠️ 尚未挂载 —— 但**不是死代码**，请勿按零引用删除。
 *
 * 规格来源：bayesian/v1.3.0/plan.md — Stage 3「崩溃恢复 UI」（C_impl 0.85）
 * 存在理由：插件崩溃通知与恢复对话框。依赖 packages/audio 的 sandbox 模块（PluginCrashDetector / PluginHealthMonitor / CrashRecoveryManager，1865 行）与插件运行时。
 * 当前状态：阻塞于：C++ 引擎编译到绿 + Electron 壳接通插件宿主。
 *
 * 历史教训（v2.8.0）：这些目录曾因当前零引用被判定为死代码并删除，
 * 随后在 Obsidian 规格库（spec/ 与 bayesian/）中查到它们都是历次迭代
 * Stage 的明确交付物 —— 只是还没接线。判断标准应是「规格里有没有它」，
 * 而不是「当前有没有人 import」。已恢复。
 */
export { CrashNotification } from "./CrashNotification";
export type { CrashInfo, CrashSeverity } from "./CrashNotification";

export { RecoveryDialog } from "./RecoveryDialog";
export type { RecoveryAction } from "./RecoveryDialog";
