# Collinx 架构书

> 生成时间：2026-10-16（v2.8.0）｜数据来源：代码审计 + CI 实测 + 开源项目对照
> 本文中所有规模数字均来自 `.audit/asset-audit.mjs` 的实测输出，不是估计值。

---

## 一、项目定位

**Agent-native Music IDE** —— 用自然语言驱动音乐工程的创作工具。
差异化不在"能编辑音符"，而在**AI 与工程图的双向闭环**：AI 提出的改动以「提案」形式进入工程图，
经用户审批后才落盘，全程可审计、可回滚。

---

## 二、包结构与依赖方向

```
packages/
├── core/           28,094 行 · 50 测试 · 领域内核（ProjectGraph / DiffEngine / TempoMap）
├── agent/           8,305 行 · 15 测试 · AI 工具层（ToolRegistry / 各 domain 工具）
├── ui/             44,561 行 · 82 测试 · React 应用（9 个标签页 + 设置）
├── audio/          22,576 行 · 11 测试 · JUCE C++ 引擎（DSP/VST3/CLAP/MIDI/presets/sandbox）
└── audio-engine/      490 行 ·  0 测试 · 引擎契约（实现无关接口，实现暂停）
```

**依赖方向（单向，不可逆）**：

```
ui ──▶ agent ──▶ core
 │                 ▲
 └──▶ audio（C++，Electron 侧，尚未接线）
audio-engine（纯类型契约，任何实现都可挂载）
```

**硬约束**：`audio-engine` 只导出类型，不依赖任何包 —— 换实现不动业务代码。

---

## 三、核心数据流

### 3.1 提案闭环（产品的立身之本）

```
用户自然语言
   ↓ LLM 决定调用工具
ToolRegistry.call(name, args)
   ↓ 工具产出 DiffEnvelope[]（键名是 diffs，复数）
ProjectProvider.alignRevision()   ← 关键：把 baseRevision 对齐到当前图 revision
   ↓
pendingDiffs  →  Agent 面板展示  →  用户审批
   ↓ applyDiff
DiffEngine.apply(diff, graph)     ← 二次对齐 + 幂等守卫
   ↓
ProjectGraph（单一真相源）→ notes / tempo / mixer 派生投影
   ↓
UI 各视图重渲染
```

**三个曾经出错的点**（已修复，勿回退）：
1. 入队时不对齐 revision → 用户点「应用」无反应
2. 只在入队对齐 → 连续应用第二条失败（第一条已改变 revision）
3. 无幂等守卫 → 连点两次应用，计数 +2 且产生重复 React key

### 3.2 时钟域（两套时钟，混用即 bug）

| 时钟 | 用途 | 禁止 |
|---|---|---|
| `performance.now()` | UI / 事件时间戳 / **Web MIDI 时间戳** | 不可用于音频调度 |
| `AudioContext.currentTime` | 音频调度（未来 C++ 引擎接入后） | 不可与 performance.now 混算 |

现有代码（`useTransport`、`midi-schedule.ts`）已在注释中明确警告这条。

---

## 四、音频引擎架构（本文重点）

### 4.1 现状：一个从未被构建的引擎

`packages/audio` 是 **initial commit 就在**的 JUCE 8.0.1 C++ 引擎：

| 模块 | 行数 | 模块 | 行数 |
|---|---|---|---|
| scan | 2,246 | presets | 2,063 |
| clap | 1,835 | sandbox | 1,865 |
| vst3 | 1,921 | napi | 1,628 |
| midi | 1,489 | perf | 1,142 |
| dsp | 1,114 | plugins | 1,124 |
| automation | 859 | 根 | audio-engine / transport / wavetable-synth / builtin-synth |

合计 **22,576 行 + 11 个测试文件（3,499 行）**。

**它从未被构建过**：本机无 cmake/编译器/MSVC/node-gyp；CI 也从不跑它。
这直接导致两个真实缺陷在 2026-10-16 才第一次被发现：

| 缺陷 | 表现 |
|---|---|
| `juce_generate_juce_header` 调在 `add_executable` 目标上 | CMake 直接报错，根本编不了 |
| `main.cpp` 调用不存在的 `engine->requestAudioFocus()` | 该代码路径从未被执行过 |

> **教训**：18k 行代码没有构建，就没有"质量"可言，只能算"意图"。
> 已补 `.github/workflows/ci-audio.yml` 建立基线。

### 4.2 能力缺口：N-API 只有插件宿主，没有合成器

`src/napi/` 只暴露了两个类：

- `PluginManagerBridge` —— VST3/CLAP 插件的扫描、加载、参数管理
- `AudioProcessorBridge` —— 插件链的音频处理（`process(Float32Array, …)`）

**没有 `noteOn` / `noteOff` / `transport` 接口** —— 即使编译通过，Electron 也无法让它发声。

好消息是引擎顶层接口已经完整（`audio-engine.h`）：

```cpp
class AudioEngine : public juce::AudioAppComponent {
  void prepareToPlay(int samplesPerBlock, double sampleRate) override;
  void getNextAudioBlock(const juce::AudioSourceChannelInfo&) override;
  void handleMidiMessage(const juce::MidiMessage&);   // ← 标准 MIDI 入口
  std::unique_ptr<BuiltinSynth>     synth;
  std::unique_ptr<Transport>        transport;   // play/pause/stop/loop/position
  std::unique_ptr<PluginChain>      pluginChain;
  std::unique_ptr<Vst3HostManager>  vst3Host;
};
```

→ **补 N-API 合成器绑定只需映射这一层**（约 200 行 C++），不必新写引擎。

### 4.3 关键架构风险：Node/Electron 直挂 JUCE 会死锁

参考 `slopsmith-desktop`（Electron + JUCE VST3 宿主）的架构文档，其明确指出：

> JUCE requires the `MessageManager` to be created on the OS main thread.
> In the Node.js addon, **V8 owns the main thread, which can lead to deadlocks
> or initialization failures.**

**而 `binding.gyp`（N-API 直挂）正是这个模式。**

slopsmith 的解法是 **out-of-process 沙箱**：

| 组件 | 职责 |
|---|---|
| 宿主子进程（`vst-host.exe`） | 独占 JUCE MessageManager + 高优先级音频线程 |
| `SandboxedProcessor` | 主进程侧的 `juce::AudioProcessor` 代理，对上层看起来是普通插件 |
| 控制通道 | 命名管道，32 位长度前缀 + JSON：初始化握手、预设存取、编辑器窗口、参数自动化 |
| 音频通道 | 共享内存环形缓冲（输入/输出双环），Win32 Event 唤醒；MIDI 事件内联在共享内存 |

**Collinx 的现状与差距**：`packages/audio/src/sandbox/` 已有 1,865 行
（`PluginCrashDetector` 用 SEH/signal 捕获崩溃、`PluginHealthMonitor` 心跳检测、
`CrashRecoveryManager` 状态恢复），**架构方向一致，但停留在"进程内捕获"，
没有进程隔离**。

**建议的演进路径**（不在本轮实施）：

| 阶段 | 内容 |
|---|---|
| 阶段 1 | 补 N-API 合成器接口，Electron 直连（先验证出声，进程模型从简） |
| 阶段 2 | 引擎移出主进程：音频引擎独立子进程 + 共享内存环形缓冲 |
| 阶段 3 | 插件按需沙箱化（崩溃只杀子进程），复用现有 sandbox 模块 |

### 4.4 引擎契约（跨实现）

`packages/audio-engine/src/engine/types.ts` 定义了实现无关的接口：

```ts
interface AudioEngine {
  unlock(): Promise<void>;                      // 浏览器手势解锁
  noteOn(event: VoiceEvent): void;
  noteOff(id: string): void;
  schedule(events: VoiceEvent[], atSec: number): void;
  setMasterVolume(v: number): void;
  setInstrument(instrumentId: string): void;
  renderOffline(events: VoiceEvent[], sampleRate: number): Promise<AudioBuffer>;
  getStats(): EngineStats;                      // 真实指标，不填假数据
}
```

**无论最终用 C++、WASM 还是 Web Audio 实现，这个契约都不变。**
TS 实现（`core/context.ts`、`voice/adsr.ts`）已写但**暂停**。

---

## 五、审计发现的"被忽略架构"

用 `.audit/` 下的脚本做全量体检，发现三类问题：

### 5.1 影子架构（有实现、无集成、无验证）

| 资产 | 规模 | 问题 |
|---|---|---|
| `packages/audio` | 22,576 行 | 从未构建、从未进 CI；N-API 缺合成器接口 |
| i18n `settings.*` | 869 键 | 文案已写好但**没有任何代码引用** —— 内容资产，未接线 |
| `src/main-with-vst3-example.cpp` | — | 调用不存在的方法，且不在 CMake SOURCES 里，永不编译 |

### 5.2 死代码（已删除）

| 文件 | 行数 |
|---|---|
| `components/Score/ScoreView.tsx` | 129 |
| `components/Taste/ABPlayerUI.tsx` | 303 |
| `components/Taste/ABPlayer.module.css` | — |
| i18n 死键 133 个 | — |

### 5.3 审计脚本自身踩过的坑（方法论，勿重蹈）

| # | 坑 | 后果 |
|---|---|---|
| 1 | `grep --include=*.ts` 漏掉 `.tsx` | 把在用的 `recorded-take.ts` 误判为死代码 |
| 2 | `grep -v "路径"` 把**引用方的 import 行本身**也滤掉 | 证据自我抹除 |
| 3 | 带 `/g` 的正则调 `.test()` 推进 `lastIndex` | 隔一个漏一个，误删 4 个键中的 2 个 |

**共同点：都是"用文本匹配代替结构判定"**。审计脚本本身也需要被审计。
为此补了运行时验证脚本（`.audit/i18n-runtime-audit.mjs`）——
遍历所有界面检测 raw key，作为删除 i18n 前的安全网。

---

## 六、结构重整建议（待执行）

| 优先级 | 建议 | 理由 |
|---|---|---|
| P0 | `packages/audio` 编译到绿 | 18k 行代码当前处于"不可验证"状态 |
| P0 | 补 N-API 合成器接口 | 引擎能出声是产品级缺口 |
| P1 | 建立"改动即验证"的 CI 矩阵 | 避免再次出现长期未构建的资产 |
| P1 | `settings.*` 869 键的处置决策 | 接进设置页，或明确标记为"暂存文案" |
| P2 | `.audit/` 脚本纳入 CI | 让死代码/i18n 漂移在 PR 阶段就被发现 |
| P2 | `docs/` 补构建说明 | 目前无"如何构建 C++ 引擎"的文档 |

---

## 七、如何验证本架构书里的每个数字

```bash
cd packages/ui
node ../../.audit/asset-audit.mjs        # 包画像 / 死代码 / i18n 使用率
node ../../.audit/asset-audit2.mjs       # 精确版（含 .tsx、C++ 测试）
node ../../.audit/component-audit.mjs    # 未挂载组件
node ../../.audit/token-audit.mjs       # CSS token 引用与同值多名
node ../../.audit/i18n-prune.mjs         # i18n 死键分析（--apply 才删）
node ../../.audit/emoji-audit.mjs       # DOM 途径的 emoji 检测（grep 不可靠）
node ../../.audit/graph-fit-check.mjs    # 图谱节点是否越界
```

C++ 引擎：`gh run list --workflow="ci-audio.yml"`
