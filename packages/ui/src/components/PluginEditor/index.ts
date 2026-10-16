/**
 * ⚠️ 尚未挂载 —— 但**不是死代码**，请勿按零引用删除。
 *
 * 规格来源：配套 PluginBrowser 的插件编辑能力（参数编辑 / 调制矩阵 / 音符表情）
 * 存在理由：插件 GUI 窗口管理。依赖 N-API 的 PluginManagerBridge（已实现：扫描/加载/参数管理）。
 * 当前状态：阻塞于：C++ 引擎编译到绿 + Electron 壳。
 *
 * 历史教训（v2.8.0）：这些目录曾因当前零引用被判定为死代码并删除，
 * 随后在 Obsidian 规格库（spec/ 与 bayesian/）中查到它们都是历次迭代
 * Stage 的明确交付物 —— 只是还没接线。判断标准应是「规格里有没有它」，
 * 而不是「当前有没有人 import」。已恢复。
 */
export { PluginEditorWindow } from "./PluginEditorWindow";
export { PluginWindowManager } from "./PluginWindowManager";
export { PluginParamEditor } from "./PluginParamEditor";
export { NoteExpressionEditor } from "./NoteExpressionEditor";
export { ModulationMatrix } from "./ModulationMatrix";
