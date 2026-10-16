/**
 * ⚠️ 尚未挂载 —— 但**不是死代码**，请勿按零引用删除。
 *
 * 规格来源：配套插件系统的预设浏览（packages/audio/src/presets 有 PresetFormat/PresetStorage/PresetManager，2063 行）
 * 存在理由：预设浏览与编辑。依赖 C++ 侧的 presets 模块与插件元数据。
 * 当前状态：阻塞于：C++ 引擎编译到绿 + 插件宿主接通。组件内目前有 mock 数据，接线时需替换。
 *
 * 历史教训（v2.8.0）：这些目录曾因当前零引用被判定为死代码并删除，
 * 随后在 Obsidian 规格库（spec/ 与 bayesian/）中查到它们都是历次迭代
 * Stage 的明确交付物 —— 只是还没接线。判断标准应是「规格里有没有它」，
 * 而不是「当前有没有人 import」。已恢复。
 */
export { PresetBrowser } from "./PresetBrowser";
export type { PresetBrowserProps, PresetInfo, PresetFilter } from "./PresetBrowser";
export { PresetCard } from "./PresetCard";
export type { PresetCardProps } from "./PresetCard";
export { PresetEditor } from "./PresetEditor";
export type { PresetEditorProps } from "./PresetEditor";
