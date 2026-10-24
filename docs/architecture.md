# Collinx 架构（现行）

> 更新：2026-10-24（v2.9.0）｜ 本文是**唯一权威**的架构描述。
> `docs/v2.*` 是历史版本存档，与本文冲突时以本文为准；存档里的过期结论见
> `docs/architecture-review.md`。
> 每条结论都注明核对位置；任何没能核实的都会显式标「未核实」，不写成事实。

---

## 一、分层与依赖方向

```
ui ──▶ agent ──▶ core          图模型 / Diff / 工具注册表 / IO / Taste
 │                 ▲
 └─────────────────┘            ui 也直接使用 core（类型、导出器、DiffEngine）

desktop（Electron 壳）──▶ ui（渲染进程）
       └──────────────▶ audio（C++/JUCE，编译成 @collinx/audio-native，经 N-API）

audio-engine（引擎契约，纯类型）── 当前无任何包引用
```

| 包 | 职责 | 关键入口 | 规模（实测） |
|---|---|---|---|
| `core` | 领域内核：`ProjectGraph`、`DiffEngine`、`TempoMap`、Taste Genome、IO 导入导出、`ToolRegistry` | `src/index.ts` | 51 个测试文件 |
| `agent` | 19 个工具 + 8 个域实现（composer / arranger / orchestrator / mixing / engraving / teaching / taste-memory / planner） | `src/tools.ts`、`src/index.ts` | 21 个测试文件 |
| `ui` | React 应用：9 个标签页、Web Audio 播放、Canvas 钢琴卷与图谱、LLM 对话 | `src/App.tsx` | 74 个测试文件 + 21 个 e2e spec（90 用例） |
| `desktop` | Electron 外壳：窗口、IPC、原生引擎桥、播放驱动 | `src/main.ts`、`src/preload.ts` | 6 个 .ts + 1 个 worklet + 2 个测试 |
| `audio` | C++/JUCE 引擎：合成器、VST3/CLAP 宿主、presets、sandbox | `src/audio-engine.h`、`src/napi/` | 10 个 C++ 测试，CI `ci-audio.yml` |
| `audio-engine` | 引擎契约（`AudioEngine` 接口 + `VoiceEvent`） | `src/engine/types.ts` | 4 个源文件，**无任何包引用它** |

**硬约束**

1. 依赖单向：`ui → agent → core`；`agent` 不 import `ui`，`core` 不 import 其它包。
2. `ui` 不得绕过 `ProjectProvider` 直接改图 —— 图是可变类，绕过即失去 revision 与 undo。
3. `audio-engine` 只导出类型，不依赖任何包（可换原生 / WASM / Web Audio 实现）。
4. `ui` 目前**没有**使用 `audio-engine`：实际发声走 `ui/src/services/audio-preview.ts`。
   契约与实现的分叉是已知债务，不是设计意图。

---

## 二、数据流：ProjectGraph 是唯一真相源

```
用户操作 / AI 工具
      │
      ▼
DiffEnvelope{ ops[] }            ← 8 种 op：add_node / remove_node / update_node /
      │                            add_edge / remove_edge / update_meta /
      │                            set_tempo / add_note_group
      ▼
ProjectProvider.alignRevision()  ← 入队前把 baseRevision 对齐到当前图
      │
      ▼
pendingDiffs ──▶ Agent 面板 / DiffCard ──▶ 用户审批
      │  拒绝                                  │  应用
      ▼                                        ▼
rejectedDiffs                          DiffEngine.apply(diff, graph)
                                               │ 二次对齐 + 幂等守卫
                                               ▼
                                        ProjectGraph（revision 递增）
                                               │
                            ┌──────────────────┴──────────────────┐
                            ▼                                     ▼
                 deriveNotes(graph)                    deriveTempoProjection(graph)
                                               → 走带 / 钢琴卷 / 谱面 / 图谱重渲染
```

| 事实 | 位置 | 说明 |
|---|---|---|
| 图是唯一真相源，`notes` / `tempo` / `meter` 是派生投影 | `packages/ui/src/store/project-store.ts:954` `createInitialState` | undo/redo 恢复后重新派生，防止图与投影漂移 |
| revision 对齐必须在**两处**做 | `ProjectProvider.tsx:498` `alignRevision`（入队）、`:509` `applyDiff`（应用） | 只做入队对齐时，连续应用第二条必被 DiffEngine 拒绝 |
| 应用幂等 | reducer `APPLY_DIFF` | 连点两次不产生重复节点 / 重复 React key |
| 撤销 / 重做是整快照 | `snapshotProjectStore` / `restoreProjectSnapshot` | 含图 JSON + 混音 + 提案 + genome |
| 提案可回滚 | `rollbackToken` + `ROLLBACK_DIFF` + DiffCard 的 rollback 按钮 | `Agent/DiffCard.tsx:103` |

**图模型规模**（`core/src/schema/graph-schema.ts:3,21`）：13 种节点类型、10 种边类型。

**视图层派生边**（v2.8.0）：真实图里仍几乎没有边（只有 diff 的 `add_edge` 与 agent 证据边），
因此 `App.tsx` 在**视图层**派生「同轨音列」边（同一 `trackId` 的音符按 bar/beat 顺序相连），
Graph 页从散点变成三条清晰的音列线。派生逻辑在 UI，不污染图模型。

---

## 三、音频链路

### 3.1 实时播放（今天真正出声的那条路）

```
NoteEvent[]（图派生）
   │ buildPlaybackEvents(notes, tempoMap, from)        ui/src/services/midi-schedule.ts:88
   ▼
ScheduledEvent[]（atSeconds = TempoMap 绝对秒）
   │ useTransport 调度循环：26ms tick / 180ms lookahead / performance.now 时钟域
   ├──────────────▶ ① Web MIDI 端口（外接音源；无设备则跳过）
   └──────────────▶ ② AudioPreview（内部合成器，AudioContext 时钟域）
                        │ noteOn(pitch, vel, delaySec, 音色, trackId)
                        ▼
                  MixerGraph（ui/src/services/mixer-graph.ts，v2.9.0）
                  每轨：sum → FX 链 → fader(推子/静音) → panner → analyser
                        ▼
                  master GainNode → 母带链 → master AnalyserNode → destination
```

| 事实 | 位置 |
|---|---|
| 时钟域转换**只在一处**：`delaySec = (timestamp - performance.now()) / 1000` | `useTransport.ts:407-420` |
| 无 MIDI 端口时调度器不停：仍推进水位与播放头 | `useTransport.ts`（`if (!port) continue`） |
| 轨道总线是 v2.8.0 重构产物：重构前所有音符直连 master，推子只是数字 | `audio-preview.ts:92-104` |
| 电平取**时域峰值**而非 RMS（削波由峰值造成） | `audio-preview.ts:59` |
| 5 种音色：`lead` / `bass` / `pad` / `keys` / `pluck`，数据驱动（振荡器叠加 + ADSR + sustain + level） | `services/instruments.ts:52` |
| 音色按 `trackId` **名称**自动映射（`bass`→bass、`chord/harmony/pad`→pad…），未知兜底 `lead` | `instruments.ts:116` |
| 播放与导出读同一份音色 spec（否则「听到的」≠「导出的」） | `audio-preview.ts:232`、`wav-export.ts:182` |
| v2.9.0：**混音图是播放与导出的共用实现**（`MixerGraph`），推子/静音/独奏/声像/FX 六类全部进链路 | `services/mixer-graph.ts`、`services/fx-chain.ts` |
| 静音 = fader 0（不是断开节点）；独奏是并集、mute 优先 | `services/mix-resolver.ts` |
| FX 结构签名不变时只改参数不重建；重建必须先断开直通支路 | `services/fx-chain.ts` |
| 节拍器 / count-in / 量化 / MIDI 录制 | `useTransport.ts`、`midi-quantize.ts`、`recorded-take.ts` |

### 3.2 离线渲染与导出

```
ProjectGraph → notes → RenderableNote[]（带 instrumentId + trackId）
   │ renderNotesToWav(notes, { mixer })   OfflineAudioContext，2ch / 44.1kHz
   │   └─ 同一份 MixerGraph（instantParams=true：写静态终值，静音为真 0）
   ▼
Float32 采样 → 母带链 → encodeWav() → 16-bit PCM WAV → Blob 下载
```

| 事实 | 位置 |
|---|---|
| 用离线渲染而不是录音：导出必须样本级确定 | `wav-export.ts:146-154` |
| Int16 正负区间不对称 + 显式四舍五入（否则满幅反相爆音） | `wav-export.ts:78-88` |
| 导出入口在 Score 面板：WAV / MIDI / PDF / MusicXML + 工程存档 `.agentmusic` | `App.tsx:1366-1369`、`ScorePanel.tsx:154` |
| v2.9.0：导出带混音（此前混完再导出 = 没混） | `wav-export.ts` `RenderOptions.mixer` |

---

## 四、AI 链路

```
AgentChat（流式 / 多轮 / sessionStorage 会话）
   │ runAgentLoop(config, messages, executor, systemPrompt, maxRounds=3)
   ▼
chatCompletion（DeepSeek，OpenAI 兼容，SSE + tools）
   │ 工具名 composer.generateMotif → 函数名 composer_generateMotif（点号非法）
   ▼
tool_calls → executor.execute → ToolRegistry.call
   │ 权限校验 + 参数校验 + 审计（AuditEntry）+ onToolCall 上报
   ▼
handler(params, ctx) → { data, diffs }
   │ Provider alignRevision → ADD_PENDING_DIFFS
   ▼
pendingDiffs → 审批 → DiffEngine.apply → 图
```

| 事实 | 位置 |
|---|---|
| 工具总数 **19**：9 个 `proposal_only` + 10 个 `read_only`（v2.9.1 增 `harmony.inspect`） | `packages/agent/src/tools.ts` |
| system prompt **不含**工具清单，只声明「本次 tools 就是全部能力」 | `services/llm/agent-loop.ts:110` |
| 只读工具靠 `ToolContext.readGraph()` 读图 / `readMixer()` 读混音，不写状态 | `core/src/agent/tool-registry.ts` |
| 工具结果回灌模型时标注「提案已入队，用户确认后才写入」 | `agent-loop.ts:147` |
| 提案从工具结果到队列：`ToolResult.diff`（单数）与 `ToolResult.diffs`（复数，v2.9.1 已类型化）；`runAgentTool` 两者都取 | `ProjectProvider.tsx`、`core/src/agent/tool-registry.ts` |
| 覆盖：作曲 2 · 编排 1 · 配器 1 · 混音 3（含 `mixer.inspect`） · 和声 1（`harmony.inspect`） · 记谱 3 · 教学 3 · 品味 2 · 工程 2 · 规划 1 | 同上 |

**已知行为缺陷（不是工具缺陷）**：对「给个建议」这类措辞，模型有时只讨论不调用工具
（`docs/v2.8.0-song-session.md:45-52` 实测）。属模型行为选择，可被更明确的指令绕过。

---

## 五、桌面外壳与原生引擎（第二条路，尚未接入 UI）

```
[渲染进程] desktop-bridge.ts ──IPC(audio:*)──▶ [主进程] audio-bridge.ts
                                                     │ require('@collinx/audio-native')
                                                     ▼
                                           SynthBridge（N-API，纯渲染，不自开设备）
                                                     │ render(blockSize) → Float32 交织立体声
                                                     ▼
                                           AudioDriver（setInterval 按经过时间补齐生产）
                                                     ▼
                                           SharedArrayBuffer 环形缓冲
                                                     ▼
                                           synth-worklet.js（AudioWorklet 自主取数）→ 扬声器
```

| 环节 | 状态 |
|---|---|
| N-API 合成器接口（23 方法：prepare/noteOn/noteOff/render/transport/音量/引擎切换） | ✅ CI `build-napi` 构建后冒烟断言输出非静音 |
| 主进程播放驱动 + 环形缓冲 + worklet | ✅ 已实现，有单测（`audio-driver.test.ts`、`audio-ring-buffer.test.ts`） |
| UI 侧接线 | ❌ `desktop-bridge.ts:23` 只暴露 `load/info/start/stop`，**没有** `startPlayback`；`main.ts` 也未加载 worklet |
| VST3 / CLAP 宿主（C++ 侧已实现） | ❌ 未进 N-API 的 UI 通路，产品内不可用 |

**结论**：原生链路各段都在，最后一公里没接。今天用户听到的声音**全部**来自
Web Audio 的 `AudioPreview`，与 C++ 引擎无关。

---

## 六、当前能力的真实边界

✅ 可用 ｜ ⚠️ 可用但有保留 ｜ ❌ 没有

| 能力 | 状态 | 证据 / 核对位置 |
|---|---|---|
| 钢琴卷编辑、双击加音符、量化、MIDI 录制 | ✅ | `PianoRollView.tsx`、`usePianoRollInteraction.ts`、`recorded-take.ts` |
| 播放**真的出声**（内部合成器，5 音色） | ✅ | `audio-preview.ts`；实测「播放 6s → AudioContext 1 / 振荡器 92 / 4 种波形」（`v2.8.0-full-song.md:33`） |
| 节拍器 / count-in / loop / seek | ✅ | `useTransport.ts` |
| 每轨推子**真的改变声音** + 实时电平表 | ✅ | `mixer-graph.ts` `setGain`、`getLevel` |
| 送出（Sends）**真的生效**（推子后/推子前、环路保护） | ✅ | `mixer-graph.ts` `setSends`；数值验收 +6.02dB |
| 静音 / 独奏 / 声像**真的改变声音** | ✅ | `mix-resolver.ts` 判定 → `MixerGraph`；实测静音 0、全左 R=0、居中 L=R（`v2.9.0-mixer.md`） |
| FX 链**影响声音**（EQ/压缩/混响/延迟/饱和/限幅） | ✅ | `services/fx-chain.ts`；实测 EQ −12dB@100Hz 在 50Hz 测到 −11.1dB |
| 加轨道（不限 3 条） | ✅ | `ADD_MIXER_TRACK`（`project-store.ts`）；配器后实测 5 轨 |
| 删轨道（级联删音符 + undo） | ✅ | `REMOVE_MIXER_TRACK`（`project-store.ts`）、`MixerConsole` × 按钮、App 传 `onRemoveTrack` |
| 手动选音色 | ✅ | 混音台每轨下拉 → `MixerTrack.instrument`（随 `.agentmusic` 持久化） |
| 导出 WAV / MIDI / MusicXML / PDF / `.agentmusic` | ✅ | `App.tsx:780,830`、`ScorePanel`；实测 121.5s WAV（`v2.8.0-full-song.md:13`） |
| 导出**带混音**（推子/静音/独奏/声像/FX/送出） | ✅ | `renderNotesToWav(notes, { mixer })`；静音轨导出能量 = 0 |
| 分轨导出（每轨一个 WAV） | ✅ | `services/stem-export.ts` + Score 面板「分轨导出」 |
| 自动保存 + 损坏快照降级 | ✅ | `services/autosave.ts`、`persistence.ts` |
| AI 读统计 / 改速度 / 生成动机 / 和声 / 配器 / 混音建议 / 记谱 / 讲解 / **读混音台** | ✅ | 18 工具，见 §四 |
| AI 对「建议」措辞偶尔只讨论不执行 | ⚠️ | 模型行为，见 §四 末 |
| Graph 视图表达工程结构 | ✅ | 视图层派生「同轨音列」边（§二 末） |
| VST3 / CLAP 插件、SF2 / SFZ 采样 | ❌ | C++ 侧有宿主实现，UI 通路未接；`packages/ui` 无 SF2 加载器 |
| 桌面原生引擎发声 | ❌ | 见 §五 |
| 母带压缩 / 限幅 | ✅ | `services/master-chain.ts`（播放与导出共用） |
| 和弦轨**发声**（写和弦即生成真实音符） | ✅ | `SET_CHORD` + `chord-voicing.ts`（带 `chordGenerated` 标记） |
| AI 读和弦 | ✅ | `harmony.inspect` 工具 |

---

## 七、不可回退的约束（都是踩过的坑）

| # | 约束 | 违约后果 |
|---|---|---|
| 1 | `performance.now()` 域与 `AudioContext.currentTime` 域不可混算，换算只在 `useTransport` 一处 | 音符错位 / 静默无声，且不报错 |
| 2 | 提案入队与应用**两处**都要对齐 `baseRevision` | 用户点「应用」无反应（被 DiffEngine 拒绝） |
| 3 | 应用必须幂等 | 连点两次计数 +2、React 重复 key |
| 4 | 播放与导出必须共享同一份音色 spec | 「听到的」与「导出的」是两个声音 |
| 5 | 推子必须落在音频路径上（轨道总线），不能只改数字 | 混音台形同虚设（v2.8.0 前真实存在） |
| 6 | system prompt 不得硬编码工具清单 | 与 tools schema 成为双真相源，AI 会否认自己有的工具 |
| 7 | 判死代码看「规格里有没有它」，不看「当前有没有 import」 | v2.7.0 曾误删 9 个 Stage 交付组件 |
| 8 | 播放与导出必须共用 `MixerGraph`（不许另写一套混音连接） | 混完导出 = 没混（v2.9.0 前真实存在） |
| 9 | 重建 FX 链前必须先断开直通支路（`input.disconnect()`） | 干湿两路并联，信号叠加 +6dB（实测 4kHz 翻倍） |
| 10 | 静音必须是**真 0**（`setValueAtTime(0)`），不能用 `setTargetAtTime` 逼近 0 | 指数逼近永远差一点，导出漏出 −52dBFS 底噪 |
| 11 | flex 容器里的「大内容预览」必须显式 `min-height: 0` | flex item 默认 `min-height:auto` 会被内容撑开，把兄弟区域压成 0（编曲页钢琴卷曾整体消失） |
| 12 | CI 触发分支必须包含默认分支 `master` | 写成 `[main, develop]` 时整份 CI 从未运行（v2.9.1 前真实存在） |

---

## 八、怎么验证本文的每条结论

```bash
# 分层与规模
find packages/core/src -name "*.test.ts" | wc -l      # 48
find packages/agent/src -name "*.test.ts" | wc -l     # 21
find packages/ui/src -name "*.test.ts*" | wc -l       # 84

# 工具清单与权限
grep -n 'name: "\|permission:' packages/agent/src/tools.ts

# 音频链路
grep -rn "AudioPreview\|MixerGraph\|buildPlaybackEvents\|renderNotesToWav" packages/ui/src --include=*.ts* | grep -v __tests__

# 未接线的证据（应当只有声明、没有调用方）
grep -rn "startPlayback" packages/ui/src

# 混音数值验收（真浏览器 + OfflineAudioContext）
node .audit/scripts/mix-acceptance.mjs            # 输出 .audit/acceptance/mix/evidence.json

# 全量校验
pnpm typecheck && pnpm test
pnpm test:e2e                                    # Playwright，22 spec / 99 用例（本机实测；CI 见 ci-e2e.yml）
gh run list --workflow="ci-audio.yml"            # C++ 引擎构建 + ctest + N-API 冒烟
```
