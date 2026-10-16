/**
 * MIDI 效果链（MIDI 效果 / 路由）。
 *
 * ⚠️ **未挂载，且目前无法挂载**（v2.6.0 复核结论）
 *
 * 组件本身是完整的（效果卡、参数编辑、旁通、拖拽排序、路由视图），但它需要的
 * `MidiEffectChainState` 在生产代码里**没有任何来源** —— 全仓找不到构造这个
 * 状态的地方，也没有把效果应用到 MIDI 流的处理链。
 *
 * 接入的前置条件（缺一不可）：
 * 1. store 侧持有 `MidiEffectChainState`（增删改查 + 旁通持久化）；
 * 2. `services/midi-output.ts` / `midi-schedule.ts` 在发送前按链路应用效果
 *    （力度重映射 / 音移 / 延音 / CC 映射 / 滤波）；
 * 3. 效果参数变更需要走既有的持久化通道（否则刷新即丢）。
 *
 * 在此之前把它挂进 UI 只会得到"看得见但点了没反应"的假功能，所以刻意不挂。
 * 删除或补齐前置条件之前，请保留本目录。
 */
export { MidiEffectPanel } from "./MidiEffectPanel";
export type { MidiEffectPanelProps } from "./MidiEffectPanel";
export { MidiEffectCard } from "./MidiEffectCard";
export type { MidiEffectCardProps } from "./MidiEffectCard";
export { MidiRouterView } from "./MidiRouterView";
export type { MidiRouterViewProps } from "./MidiRouterView";
export type {
  MidiEffectParam,
  MidiEffectInfo,
  MidiEffectChainState,
  ChannelMapping,
  ControllerMapping,
  MidiRouterState,
  MidiEffectType,
} from "./types";
export { MIDI_EFFECT_TYPES, MIDI_CHANNELS, MIDI_CC_NAMES } from "./types";
