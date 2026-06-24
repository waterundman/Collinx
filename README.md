<p align="center">
  <img src="icon.png" alt="Collinx" width="96" />
</p>

<h1 align="center">Collinx</h1>

<p align="center">
  <strong>Agent-native Music IDE</strong><br/>
  <sub>创作目标 / 音乐对象 / 视图 / 渲染 / 审美记忆 — 一张图</sub>
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.de.md">Deutsch</a>
</p>

---

Collinx 不代替你点按钮。它把你的音乐工程变成一张有类型的属性图，然后让 8 个专职 Agent 直接操作这张图——作曲、编曲、配器、混音、记谱、教学、审美学习。每一步操作都产出结构化的 DiffEnvelope，你确认后才写入主分支。不想接受？回滚。

这不是聊天机器人包装的 DAW。Agent 拥有工具权限、操作审计和领域解释能力。它们做的事情你可以审查、可以回溯、可以教它们做得更好。

---

## 它怎么工作

```
┌─────────────────────────────────────────────────────────┐
│                     Project Graph                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │Composition│  │ Notation │  │Performance│  │  Audio  │ │
│  │  Layer    │→│  Layer   │→│   Layer   │→│  Layer  │ │
│  │写了什么   │  │怎么看    │  │怎么演     │  │怎么听   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│       ↑              ↑              ↑            ↑      │
│  ┌────┴──────────────┴──────────────┴────────────┴────┐ │
│  │              Agent Bus (pub/sub)                   │ │
│  └────┬──────┬──────┬──────┬──────┬──────┬──────┬────┘ │
│     Plan  Compose Arrange Orch.  Mix  Engr. Teach  Taste│
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   DiffEnvelope                        Taste Genome
   (提案 → 确认 → 写入)              (贝叶斯审美记忆)
```

**Project Graph** — 12 种节点类型、10 种边类型、支持版本控制和分支管理。所有音乐数据（音符、和弦、曲式、轨道、效果、谱面、审美证据）都在同一张图里。

**DiffEnvelope** — Agent 操作的输出格式。包含操作摘要、领域解释、证据引用、风险标记和回滚令牌。默认权限 `proposal_only`：Agent 只能提案，你说了算。

**Taste Genome** — 你的审美在三个层面上的长期记忆：可解释层（人类可读参数）、分布层（Beta / Dirichlet / Bernoulli 分布）、嵌入层（标签向量）。覆盖和声、旋律、节奏、织体、音色、曲式、混音、排斥 8 个域。用得越多，Agent 越懂你。

---

## 8 个 Agent

| | Agent | 做什么 |
|---|---|---|
| 1 | **Planner** | 把「写一段副歌」拆解成任务图，匹配到具体工具 |
| 2 | **Composer** | 生成旋律和声 — 13 种音阶、6 种风格、8 种节奏模板 |
| 3 | **Arranger** | 动机 → 完整编曲。曲式结构、能量曲线、变体生成 |
| 4 | **Orchestrator** | 配器 — 30+ 乐器、7 个族、音域冲突检测、可演奏性验证 |
| 5 | **Engraving** | 谱面布局、碰撞检测、分谱提取（4 种 house style） |
| 6 | **Mixing** | 增益结构、FX 链、声像定位 — 规则驱动，非黑盒 |
| 7 | **Teaching** | 以 4 级难度解释每一个音乐决策（入门 → 专业） |
| 8 | **Taste Memory** | 分析导出、积累审美证据、按品味排序候选方案 |

每个 Agent 操作都是一个 DiffEnvelope——你可以审查、接受、拒绝或回滚。

---

## UI — 9 个标签页

| Tab | 干什么 |
|---|---|
| **compose** | 钢琴卷帘 + 紧凑谱面 + 编排时间线 |
| **arrange** | 段落编排 + Diff 预览 |
| **orchestrate** | 乐器分配 + 冲突显示 |
| **mixer** | 完整混音台 — 增益、声像、静音、独奏、FX 链 |
| **score** | 完整谱面 — 自动布局、分谱提取、MusicXML 导出 |
| **taste** | 品味基因组时间线 + 参数库 + Diff 报告 |
| **teaching** | 多级音乐理论解释 |
| **agent** | Diff 队列 + 聊天界面 |
| **graph** | 工程图可视化 — Canvas 2D 力导向布局 |

---

## 快速开始

```bash
# 环境要求：Node.js >= 18, pnpm 9

pnpm install          # 安装依赖
pnpm dev              # 启动所有开发服务器
pnpm dev:ui           # 仅启动 UI（端口 5180）
pnpm build            # 构建所有包
pnpm test             # 单元测试（Vitest）
pnpm test:e2e         # E2E 测试（Playwright, 84 用例）
pnpm typecheck        # 类型检查
```

---

## 测试

```
62+ 单元测试文件    覆盖所有模型、图、Diff、Taste、IO、Agent
12  E2E 测试文件    覆盖全部 9 个标签页的核心交互
5   集成测试        音符→导出、混音链、图→Diff、曲式编排、Agent 工具链
2   专项套件        性能测试 + 稳定性测试
```

---

## 技术栈

```
TypeScript · React 18 · Vite 5 · pnpm 9 · Turborepo 2
Zod · pdfkit · fflate · VexFlow 5 · i18next
Vitest · Playwright · JUCE 8 (C++20)
```

---

## 项目结构

```
Collinx/
├── packages/
│   ├── core/          领域模型、图、Diff、Taste、IO
│   ├── agent/         8 个 Agent + 工具注册 + Agent Bus
│   ├── ui/            React 前端 + 15 个组件目录 + E2E 测试
│   └── audio/         C++20/JUCE 音频引擎（VST3/CLAP）
├── docs/              术语、迭代计划、研究文档
└── .github/           CI 流水线
```

---

## 迭代进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 — PoC | 图 + Diff + Agent | Done |
| Phase 1 — MVP | 编排 + 钢琴卷帘 + 谱面 + 混音 + Taste + 导出 | 99% |
| Phase 2 — 可用性 | 刻版 + A/B + 覆盖 + 性能 | 95% |
| Phase 3 — 插件 | VST3 + 沙箱 | 25% |
| Phase 4 — 生态 | CLAP + 市场 + SDK | — |

---

<p align="center">
  <sub>Private — 未公开发布</sub>
</p>
