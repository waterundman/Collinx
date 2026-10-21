# Collinx 架构（现行）

> 更新：2026-10-21 ｜ 本文是**唯一权威**的架构描述。
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
| `agent` | 17 个创作工具 + 8 个域实现（composer / arranger / orchestrator / mixing / engraving / teaching / taste-memory / planner） | `src/tools.ts`、`src/index.ts` | 19 个测试文件 |
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

**实测缺口**：实际工程里几乎没有边 —— 只有 diff 里的 `add_edge` op
（`diff-engine.ts:257`）和一条 agent 决策证据边（`project-store.ts:1167`）会建边。
所以 Graph 标签页基本是「孤立节点散点图」，不表达结构。这是设计问题，不是渲染 bug。

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
                  轨道总线（每轨一个 GainNode = 推子，一个 AnalyserNode = 电平）
                        ▼
                  master GainNode → master AnalyserNode → destination
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
| 节拍器 / count-in / 量化 / MIDI 录制 | `useTransport.ts`、`midi-quantize.ts`、`recorded-take.ts` |

### 3.2 离线渲染与导出

```
ProjectGraph → notes → RenderableNote[]（带 instrumentId）
   │ renderNotesToWav(notes)          OfflineAudioContext，2ch / 44.1kHz
   ▼
Float32 采样 → encodeWav() → 16-bit PCM WAV → Blob 下载
```

| 事实 | 位置 |
|---|---|
| 用离线渲染而不是录音：导出必须样本级确定 | `wav-export.ts:146-154` |
| Int16 正负区间不对称 + 显式四舍五入（否则满幅反相爆音） | `wav-export.ts:78-88` |
| 导出入口在 Score 面板：WAV / MIDI / PDF / MusicXML + 工程存档 `.agentmusic` | `App.tsx:1366-1369`、`ScorePanel.tsx:154` |

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
| 工具总数 **17**：9 个 `proposal_only` + 8 个 `read_only` | `packages/agent/src/tools.ts` |
| system prompt **不含**工具清单，只声明「本次 tools 就是全部能力」 | `services/llm/agent-loop.ts:110` |
| 只读工具靠 `ToolContext.readGraph()` 读图，不写图 | `core/src/agent/tool-registry.ts:47` |
| 工具结果回灌模型时标注「提案已入队，用户确认后才写入」 | `agent-loop.ts:147` |
| 提案从工具结果到队列：`ToolResult` 只类型化单数 `diff`，部分工具挂 `diffs`（复数，未类型化）；`runAgentTool` 两者都取 | `ProjectProvider.tsx:862-871` |
| 覆盖：作曲 2 · 编排 1 · 配器 1 · 混音 2 · 记谱 3 · 教学 3 · 品味 2 · 工程 2 · 规划 1 | 同上 |

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
| 每轨推子**真的改变声音** + 实时电平表 | ✅ | `audio-preview.ts:183`、`getTrackLevel` |
| 加轨道（不限 3 条） | ✅ | `ADD_MIXER_TRACK`（`project-store.ts:1466`）；配器后实测 5 轨 |
| 删轨道 | ❌ | `MixerConsole` 声明了 `onRemoveTrack`，`App.tsx:1335` 未传入 |
| 手动选音色 | ❌ | 按 `trackId` 名称自动映射，设置页无音色项 |
| FX 链**影响声音** | ❌ | FX 只是 `MixerState` 里的数据；音频路径无 `createBiquadFilter` / `createConvolver` / `createDynamicsCompressor`（全仓 grep 为 0） |
| 导出 WAV / MIDI / MusicXML / PDF / `.agentmusic` | ✅ | `App.tsx:780,830`、`ScorePanel`；实测 121.5s WAV（`v2.8.0-full-song.md:13`） |
| 自动保存 + 损坏快照降级 | ✅ | `services/autosave.ts`、`persistence.ts` |
| AI 读统计 / 改速度 / 生成动机 / 和声 / 配器 / 混音建议 / 记谱 / 讲解 | ✅ | 17 工具，见 §四 |
| AI 对「建议」措辞偶尔只讨论不执行 | ⚠️ | 模型行为，见 §四 末 |
| Graph 视图表达工程结构 | ❌ | 无边、力导向退化为散点（§二 末） |
| VST3 / CLAP 插件、SF2 / SFZ 采样 | ❌ | C++ 侧有宿主实现，UI 通路未接；`packages/ui` 无 SF2 加载器 |
| 桌面原生引擎发声 | ❌ | 见 §五 |
| 混响 / 压缩 / 母带处理 | ❌ | 无实现 |

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

---

## 八、怎么验证本文的每条结论

```bash
# 分层与规模
find packages/core/src -name "*.test.ts" | wc -l      # 51
find packages/agent/src -name "*.test.ts" | wc -l     # 19
find packages/ui/src -name "*.test.ts*" | wc -l       # 74

# 工具清单与权限
grep -n 'name: "\|permission:' packages/agent/src/tools.ts

# 音频链路
grep -rn "AudioPreview\|buildPlaybackEvents\|renderNotesToWav" packages/ui/src --include=*.ts* | grep -v __tests__

# 未接线的证据（应当只有声明、没有调用方）
grep -rn "startPlayback" packages/ui/src
grep -rn "createBiquadFilter\|createConvolver" packages/ui/src

# 全量校验
pnpm typecheck && pnpm test
pnpm test:e2e                                    # Playwright，21 spec / 90 用例
gh run list --workflow="ci-audio.yml"            # C++ 引擎构建 + ctest + N-API 冒烟
```
