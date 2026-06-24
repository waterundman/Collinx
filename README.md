<p align="center">
  <img src="icon.png" alt="Collinx" width="128" />
</p>

# Collinx

> Agent 原生的编曲软件 —— 将创作目标、音乐对象、视图、渲染和审美记忆统一纳入一张工程图。

Collinx 不是传统 DAW。它是一个基于 **Project Graph**（有类型属性图）的音乐创作环境，由 8 个专职 **Agent** 直接操作图结构来完成作曲、编曲、配器、混音、记谱、教学和审美学习。每一步 Agent 操作都产出结构化的 **DiffEnvelope**，经用户确认后写入主分支，支持审计、回滚和领域解释。

---

## 核心概念

### Project Graph

所有音乐数据（音符、和弦、曲式、轨道、效果、谱面、审美证据）存在于同一张有类型属性图中。节点类型包括 `CompositionUnit`、`Phrase`、`Motif`、`Track`、`Player`、`PartLayout`、`NoteSpan`、`AutomationCurve`、`AudioBus`、`RenderArtifact`、`TasteEvidence`、`ExportVersion`；边类型包括 `contains`、`realizes`、`notates`、`performed_as`、`routed_to`、`rendered_to`、`derived_from`、`suggested_by_agent`、`confirmed_by_user`、`updates_taste`。支持版本控制和分支管理。

### DiffEnvelope

Agent 操作的输出格式，包含操作摘要、领域解释、证据引用、风险标记和回滚令牌。权限范围默认为 `proposal_only`——Agent 只能提案，用户确认后才写入主图。

### Taste Genome

用户审美在三个层面上的长期记忆模型：
- **可解释层**：人类可读参数（如 `harmony.chromatic_color = 0.33`）
- **分布层**：贝叶斯分布（Beta、Dirichlet、Bernoulli、Gaussian）
- **嵌入层**：基于标签的嵌入向量

覆盖 8 个审美域：和声、旋律、节奏、织体、音色、曲式、混音、排斥。

### 四层音乐管线

| 层 | 保存内容 |
|----|---------|
| Composition Layer | 写了什么 — 音符、和弦、节奏、曲式结构 |
| Notation Layer | 怎么看 — 谱面、布局、分谱 |
| Performance Layer | 怎么演 — 演奏控制、速度曲线、力度变化 |
| Audio Layer | 怎么听 — 混音、效果、导出 |

---

## 架构

```
Collinx/
├── packages/
│   ├── core/        @collinx/core       领域模型、图、Diff、Taste、IO
│   ├── agent/       @collinx/agent      8 个专职 Agent
│   ├── ui/          @collinx/ui         React + Vite 前端（9 个标签页）
│   └── audio/       collinx-audio-engine  C++20/JUCE 音频引擎
├── docs/            文档
└── .github/         CI 流水线
```

**技术栈**：TypeScript、React 18、Vite 5、pnpm 9 + Turborepo 2、Zod、pdfkit、fflate、VexFlow 5、i18next、Vitest、Playwright、JUCE 8（C++20）

---

## 包说明

### @collinx/core

核心领域层，包含：
- **模型**（16 个模块）：NoteEvent、TempoMap、HarmonyPlan、Motif、Phrase、Section、FormRole、FormTemplate、EnergyCurve、Instrument、MixerState、FXChain、DSP 效果、ScoreModel、EngravingEngine、StemRenderer
- **图系统**：ProjectGraph（增删查改、遍历、验证、序列化）、RevisionStore（提交、检查点、恢复）
- **Diff 系统**：DiffEnvelope、DiffEngine（应用、回滚、验证、合并、冲突检测）、DiffLog
- **Taste 系统**（12 个模块）：TasteGenome、TasteStore、EvidenceExtractor、ExportAnalyzer、UpdateEngine、ScoringEngine、ReportGenerator、TentativeBuffer、ProjectOverlay、ABPlayer
- **IO**：MIDI 导入/导出、MusicXML 4.0、PDF 乐谱、WAV 音频、`.agentmusic` 容器格式
- **Agent 基础设施**：ToolRegistry（14 个内置工具）、AgentBus（点对点、请求/响应、发布/订阅）

### @collinx/agent

8 个专职 Agent：

| Agent | 职责 |
|-------|------|
| **Planner** | 将自然语言目标拆解为任务图，匹配关键词到工具 |
| **Composer** | 生成旋律、和声（13 种音阶、6 种风格模板、8 种节奏模板） |
| **Arranger** | 将动机扩展为完整编曲，设计曲式结构、能量曲线 |
| **Orchestrator** | 配器、声部分配、音域冲突检测、可演奏性验证（30+ 乐器、7 个乐器族） |
| **EngravingAgent** | 谱面布局、碰撞检测、分谱提取（4 种 house style） |
| **MixingAgent** | 建议增益结构、FX 链、声像定位 |
| **TeachingAgent** | 以 4 级难度解释音乐决策（入门/进阶/高级/专业） |
| **TasteMemoryAgent** | 分析导出、确认/拒绝审美证据、回滚品味基因组、按品味排序候选 |

### @collinx/ui

React 18 + Vite 5 前端，9 个标签页：

| 标签 | 组件 | 功能 |
|------|------|------|
| **compose** | PianoRollView、ScorePanel、ArrangementView | 钢琴卷帘编辑 + 紧凑谱面 + 编排时间线 |
| **arrange** | ArrangementView、ArrangerPanel | 段落编排 + Diff 预览 |
| **orchestrate** | ArrangementView、OrchestratorPanel | 乐器分配 + 冲突显示 |
| **mixer** | MixerConsole | 完整混音台（增益、声像、静音、独奏、FX 链） |
| **score** | ScorePanel | 完整谱面（自动布局、分谱提取、MusicXML 导出） |
| **taste** | TasteTimelineView、TasteLibraryPanel、TasteDiffPanel | 品味基因组时间线 + 参数库 + Diff 报告 |
| **teaching** | TeachingPanel | 多级音乐理论解释 |
| **agent** | AgentPanel、AgentChat | Diff 队列 + 聊天界面 |
| **graph** | GraphView、NodeDetail | 工程图可视化（Canvas 2D，力导向布局） |

### collinx-audio-engine

C++20 音频引擎（JUCE 8.0.1）：
- VST3 和 CLAP 插件托管（沙箱崩溃检测）
- 内置波表合成器
- DSP：并行处理、延迟补偿
- MIDI 效果链和路由
- 预设管理
- 异步插件扫描
- 性能监控和分析
- 自动化曲线

---

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm 9.0.0
- CMake 3.22+（音频引擎）
- C++20 编译器（音频引擎）

### 安装

```bash
pnpm install
```

### 开发

```bash
pnpm dev          # 启动所有开发服务器
pnpm dev:ui       # 仅启动 UI（端口 5180）
```

### 构建

```bash
pnpm build        # 通过 Turborepo 构建所有包
```

### 测试

```bash
pnpm test         # 运行所有测试（Vitest 单元测试）
pnpm test:core    # 仅核心包测试
pnpm test:agent   # 仅 Agent 包测试
pnpm test:e2e     # Playwright E2E 测试（84 个用例）
```

### 其他

```bash
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint
pnpm format       # Prettier 格式化
```

---

## 测试覆盖

- **62+ 单元测试文件**：覆盖所有模型、图系统、Diff 系统、Taste 系统、IO、Agent 基础设施、8 个 Agent
- **12 个 E2E 测试文件**（Playwright）：覆盖全部 9 个标签页的核心交互流程
- **集成测试**：音符到导出、混音渲染链、图到 Diff、曲式编排、Agent 工具链
- **性能和稳定性测试套件**

---

## 迭代计划

当前版本：v0.6.0（UI）/ v0.1.0（包）

| 阶段 | 描述 | 状态 |
|------|------|------|
| Phase 0 (PoC) | 图 + Diff + Agent | 100% |
| Phase 1 (MVP) | 编排 + 钢琴卷帘 + 谱面 + 混音台 + Taste + 导出 | 99% |
| Phase 2 (可用性) | 刻版 + A/B + 覆盖 + 性能 | 95% |
| Phase 3 (插件) | VST3 + 沙箱 | 25% |
| Phase 4 (生态) | CLAP + 市场 + SDK | 0% |

---

## 项目结构

```
Collinx/
├── .github/workflows/       CI 流水线
├── .playwright-mcp/         Playwright MCP 日志
├── docs/
│   ├── CONTEXT.md           术语和概念定义
│   ├── ITERATION-PLAN.md    迭代计划
│   ├── deep-research-report.md
│   ├── audio/               音频研究文档
│   ├── bayesian-history/    贝叶斯规划历史
│   └── ui/                  UI 开发文档
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── schema/      Zod 图模式定义
│   │       ├── graph/       ProjectGraph + RevisionStore
│   │       ├── model/       16 个领域模型
│   │       ├── diff/        DiffEnvelope + DiffEngine + DiffLog
│   │       ├── taste/       Taste Genome 系统（12 模块）
│   │       ├── agent/       ToolRegistry + AgentBus
│   │       ├── io/          MIDI/MusicXML/PDF/WAV/.agentmusic
│   │       └── util/        工具函数
│   ├── agent/
│   │   └── src/
│   │       ├── planner.ts       任务规划
│   │       ├── composer.ts      旋律/和声生成
│   │       ├── arranger/        编曲（变体、动机变形、能量曲线）
│   │       ├── orchestrator/    配器（声部、冲突检测）
│   │       ├── engraving/       记谱（布局、碰撞、分谱）
│   │       ├── mixing/          混音建议
│   │       ├── teaching/        教学解释
│   │       ├── taste-memory/    审美记忆
│   │       └── tools.ts         工具注册
│   ├── ui/
│   │   ├── e2e/             Playwright E2E 测试
│   │   └── src/
│   │       ├── components/  15 个组件目录
│   │       ├── contexts/    React Context
│   │       ├── hooks/       自定义 Hook
│   │       ├── i18n/        国际化
│   │       ├── styles/      设计令牌 + 主题
│   │       └── data/        演示数据
│   └── audio/
│       └── src/             C++20/JUCE 音频引擎
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## 许可证

Private — 未公开发布。
