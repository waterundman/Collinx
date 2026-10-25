# docs — 文档索引

> 命名规则：**全小写 + 连字符**；版本化文档用 `vX.Y.Z-<主题>.md`。

## 现行（改代码前先读这两份）

| 文件 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | **现行架构总览**（唯一权威）：分层与依赖方向 / ProjectGraph 唯一真相源 / 音频链路 / AI 链路 / 桌面外壳 / 当前能力的真实边界 / 不可回退的约束 / 验证方法 |
| [architecture-review.md](./architecture-review.md) | 文档审查报告：登记 21 处过期描述（含文件+行号+源码位置），并给出整理建议 |
| [context.md](./context.md) | 领域语言表（术语定义） |

## 版本记录（存档，不修改）

| 文件 | 主题 |
|---|---|
| [v2.4.0-audit.md](./v2.4.0-audit.md) | 审计 |
| [v2.5.0-polish.md](./v2.5.0-polish.md) | 打磨 |
| [v2.6.0-fixes.md](./v2.6.0-fixes.md) | 修复 |
| [v2.8.0-acceptance.md](./v2.8.0-acceptance.md) | 验收 |
| [v2.8.0-audio-engine-spec.md](./v2.8.0-audio-engine-spec.md) | 音频引擎规格 |
| [v2.8.0-full-song.md](./v2.8.0-full-song.md) | 全功能长曲验收（2 分 01 秒 / 466 音符 / 四件导出） |
| [v2.8.0-song-feasibility.md](./v2.8.0-song-feasibility.md) | 作曲可行性 |
| [v2.8.0-song-session.md](./v2.8.0-song-session.md) | 作曲会话记录 |
| [v2.8.0-capability-diff.md](./v2.8.0-capability-diff.md) | **能力对比**：当前实现 vs 最初判断（九项能力逐条） |
| [v2.9.0-iteration-plan.md](./v2.9.0-iteration-plan.md) | v2.9.0 迭代方案：混音闭环 |
| [v2.9.0-mixer.md](./v2.9.0-mixer.md) | **v2.9.0 交付**：M/S/P + FX + 导出同源 + 删轨 + AI 读混音（含数值验收） |
| [v2.9.1-debt.md](./v2.9.1-debt.md) | **v2.9.1 技术债清算**：全模块/接口审计、18 项已消解、3 项阻塞 |
| [v2.9.3-debt.md](./v2.9.3-debt.md) | **v2.9.3 债务盘点**：设置假旋钮 13 个、导出采样率、类型逃逸/大文件登记 |
| [v2.9.4-debt.md](./v2.9.4-debt.md) | **v2.9.4 续消解**：采样率/延迟档位/输出设备/默认FX链/归一化开关 |
| [v2.9.5-click-session.md](./v2.9.5-click-session.md) | **v2.9.5 点击会话**：42 次点击做出 65s 悲伤钢琴曲；修 manifest 统计 |
| [v2.9.6-score-mix.md](./v2.9.6-score-mix.md) | **v2.9.6 谱面乐理修复**（和弦聚合/整组谱表）+ 奇幻混音会话 |
| [engraving-rules.md](./engraving-rules.md) | **记谱法规则**：渲染器遵守的 11 条规范（来源+实现+测试） |
| [deep-research-report.md](./deep-research-report.md) | 深度调研 |

## 归档

| 位置 | 说明 |
|---|---|
| [archive/v1.1.0-iteration-plan.md](./archive/v1.1.0-iteration-plan.md) | v1.1.0 迭代计划（2026-06-12），文件名此前无版本 |
| [bayesian-history/](./bayesian-history/) | 各 Stage 的贝叶斯规划与验证记录 |
| [audio/](./audio/) | 音频子系统专题 |
| [ui/](./ui/) | UI 子系统专题 |

## 命名规范

- ✅ `v2.8.0-full-song.md`、`architecture.md`、`context.md`
- ❌ `CONTEXT.md`（全大写，已改名）、`ITERATION-PLAN.md`（无版本号，已移入 `archive/`）
- 新增版本文档：`vX.Y.Z-<主题>.md`，主题用连字符小写
- 专题目录：`<领域>/`，内部文件同样小写连字符
