# 文档审查报告（2026-10-21）

> 对象：`docs/` 全部 17 个 md + 4 个 `README.*.md`
> 方法：逐篇阅读 + 对照当前代码核对（每个结论都跑了 grep / 读源码验证）
> 原则：**历史版本记录是存档，不改**。过期项只在此登记，现行描述以
> `docs/architecture.md` 为准。只有面向用户的 README 与直接误导读者的代码注释被修正。

---

## 一、结论摘要

| 类别 | 数量 | 处置 |
|---|---|---|
| 能力描述已过期（文档说没有，实际已有） | 21 | 仅登记 |
| 规格描述与实现不符（写的是从未落地的设计） | 5 | 仅登记 |
| README 数字 / 结构过期（面向用户） | 10（4 个语种各 5 处中的重复项） | **已修正** |
| 代码内注释过期（会再次误导文档作者） | 5 | 修正 3 处，2 处待改 |
| 命名不一致 | 7 个文件 | 仅登记 + 建议 |
| 归档文档未入版本库 | 7 个文件 | 已修 `.gitignore` 白名单 |

**最重要的一条**：`docs/v2.8.0-song-feasibility.md` 与 `docs/v2.8.0-acceptance.md`
是「无声 / 固定 3 轨 / 只有 MIDI 导出」这组过期结论的源头，而它们的依据是一条
**代码注释**（`useTransport.ts:8`）。注释在 v2.8.0 接入 `AudioPreview` 后没同步更新，
于是文档把「设计选择」写成了「当前事实」，后续所有引用它的文档一起错。

---

## 二、能力描述已过期（21 处）

### 2.1 `docs/v2.8.0-song-feasibility.md`（12 处）

| 行 | 原文（节选） | 现状（核对位置） |
|---|---|---|
| 41 | 「**固定 3 轨**（旋律/贝斯/和弦）」 | 默认是 3 轨，但可增轨：`ADD_MIXER_TRACK`（`project-store.ts:1466`），配器后实测 5 轨（`v2.8.0-full-song.md:30`） |
| 42 | 「**无法选音色**」 | 部分过期：已有 5 种音色（`services/instruments.ts:52`），但**仍无手动选择 UI**，按 trackId 名称自动分配 |
| 43 | 「推子（自绘 div）+ FX 建议，**无电平表**」 | 电平表已存在：`AudioPreview.getTrackLevel()` + 每轨 `AnalyserNode`（`audio-preview.ts:200`）。「推子自绘 div」仍成立 |
| 45 | 「**无声**（见下）」 | 已出声：`AudioPreview` 接入 `useTransport`（`useTransport.ts:410-428`） |
| 46 | 「MIDI / MusicXML / PDF（无音频）」 | 已有 WAV：`renderNotesToWav`（`wav-export.ts:155`），`ScorePanel` 有 `export-wav` 按钮 |
| 59 | 「Collinx 目前是「会走时间的无声播放器」」 | 同上，已失效 |
| 72 | 「听到一首歌 ❌ **完全无声**」 | 已失效 |
| 73 | 「拿到能听的成品 ❌ 只有 MIDI/PDF」 | 已失效（WAV 实测 121.5s） |
| 74 | 「做出有层次的编曲 ❌ 固定 3 轨、无音色选择」 | 部分过期：可加轨、有 5 音色；「无音色选择」仍成立 |
| 88 | 「P1 轨道可增（不限 3 条）｜固定 3 轨」 | 已实现 |
| 97 | 「Web Audio 双振荡器（锯齿 + 方波，失谐 4 cents）」 | 已升级为 5 音色 × 2~3 振荡器 + 每音色独立 ADSR/sustain/level |
| 102 | 「**接入点**（下一步）：`useMidiOutput` 的 `send()` …」 | 实际接入点在 `useTransport` 的调度循环，不是 `useMidiOutput.send()` |

### 2.2 `docs/v2.8.0-acceptance.md`（6 处）

| 行 | 原文（节选） | 现状 |
|---|---|---|
| 38 | 「**仍缺**：无 **WAV/MP3 音频导出**」 | WAV 已交付（`App.tsx:830`）；MP3 仍无 |
| 67 | 「改 BPM ❌ **无**」 | 有 `transport.setTempo`（`tools.ts:147`） |
| 68 | 「查工程统计 ❌ **无**」 | 有 `project.stats`（`tools.ts:91`） |
| 79 | 「提案无撤销」 | DiffCard 已有 rollback 按钮（`DiffCard.tsx:103`）+ `rollbackToken` |
| 132 | 「Mixer 无电平表」 | 已有（见 2.1 第 43 行） |
| 146 | 「P0 AI 工具补「改 BPM / 查工程统计」」 | 已完成 |

### 2.3 历史审查报告中的连带过期（2 处）

| 文件:行 | 原文 | 现状 |
|---|---|---|
| `v2.4.0-audit.md:94` | 「其余孤儿工具仍不产提案：`composer.suggestHarmony` …」 | suggestHarmony 已产 diff（`5567430`）；reflowLayout 已产 diff（`tools.ts`）；planTask / teaching.\* / taste.\* 按设计为 `read_only`，本就不该产 diff |
| `v2.6.0-fixes.md:55` | 「5 个孤儿工具仍不产提案」 | 同上；「孤儿」一词也已不准确（均已进 tools schema） |

### 2.4 `docs/v2.8.0-full-song.md`（1 处）

| 行 | 原文 | 现状 |
|---|---|---|
| 69 | 「`generateMotif` 的 `scale` 传 `"minor"` 仍出大调 … **未修**」 | 已修：`composer.ts` 对 scale 做归一化（`"E minor"` / `"Natural Minor"` / `"自然小调"`），`tools.ts` 另透传 `mode` 字段 |

---

## 三、规格与实现不符（5 处，均在 `v2.8.0-audio-engine-spec.md`）

| 行 | 原文 | 实际 |
|---|---|---|
| 10 | 「Collinx 只能编辑与导出 MIDI，**不产生任何声音**」 | 已失效（同 2.1） |
| 37-56 | 包结构列出 14 个文件：`index.ts` / `engine/engine.ts` / `voice/voice.ts` / `voice/unison.ts` / `instrument/*` / `core/noise.ts` / `render/offline.ts` | `packages/audio-engine` 只有 4 个文件：`core/clock.ts`、`core/context.ts`、`engine/types.ts`、`voice/adsr.ts`，且**没有任何包引用它** |
| 88-100 | 5 音色 `piano` / `epiano` / `strings` / `bass` / `drum`（含采样、低通、击弦噪声） | 实际 5 音色是 `lead` / `bass` / `pad` / `keys` / `pluck`（`ui/src/services/instruments.ts`），纯振荡器 + 包络，无采样、无滤波器 |
| 144、152 | 决策「混合：采样 + 合成」，引擎支持 SF2 加载器与回退 | **无任何 SF2 / SFZ / 采样实现**（全仓无加载器）；`ui` 无音频采样代码 |
| 162-164 | M0 / M1 标「本轮」 | 未落地：实现处于暂停状态（`audio-engine/src/engine/types.ts` 顶部自述），UI 走的是另一套 `audio-preview.ts` |

> 该文档是「待 Gate 确认」的提案，本身不构成事实错误；但它描述的实现路径已被放弃，
> 若被当作现状引用会严重误导。建议在文首加一行「**已被 `architecture.md` 取代**」
> （未执行，等你确认）。

---

## 四、README（面向用户，已直接修正）

| 文件:行 | 原文 | 改为 | 依据 |
|---|---|---|---|
| `README.md:46`（en:47 / ja:47 / de:47） | 「12 种节点类型」 | 13 种 | `core/src/schema/graph-schema.ts:3` 共 13 项 |
| `README.md:97`（en:98 / ja:98 / de:98） | 「E2E 测试（Playwright, 84 用例）」 | 90 用例 | `grep -c "test(" packages/ui/e2e/*.spec.ts` |
| `README.md:106`（en:107 / ja:107 / de:107） | 「62+ 单元测试文件」 | 144（core 51 / agent 19 / ui 74） | `find … -name "*.test.ts*" \| wc -l` |
| `README.md:107`（en:108 / ja:108 / de:108） | 「12 E2E 测试文件」 | 21 | `ls packages/ui/e2e/*.spec.ts` |
| `README.md:131`（en:132 / ja:132 / de:132） | 「15 个组件目录」 | 21 个 | `find packages/ui/src/components -maxdepth 1 -type d`（22 − 1） |
| `README.md:78` | 「完整混音台 — 增益、声像、静音、独奏、FX 链」 | 补注「推子与电平表作用于真实音频；FX 链目前仅数据」 | FX 不进音频路径（见 §六 边界表） |
| `README.md:79` | 「MusicXML 导出」 | 「四类导出（WAV / MIDI / PDF / MusicXML）」 | `ScorePanel` 四个导出按钮 |
| `README.md:83` 后新增段 | — | 播放/音色现状 + 尚未接入项指向 `architecture.md §六` | 用户第一眼就该知道边界 |

英文 / 日文 / 德文 README 同步了同样的 5 处数字与结构（内容一致性），未改叙事文案。

---

## 五、代码内注释过期（会再次污染文档）

| 文件:行 | 原文 | 问题 | 处置 |
|---|---|---|---|
| `ui/src/hooks/useTransport.ts:8-9` | 「本实现不引入 AudioContext」 | 该文件 `:46` 就 import 了 `AudioPreview`，后者创建 AudioContext。**这正是本报告第一节所有错误结论的源头** | 待改（不在本次授权范围，见 §七） |
| `ui/src/services/wav-export.ts:152` | 「音色配置与 AudioPreview 保持一致（锯齿 + 方波，失谐 4 cents）」 | 实际已改为读 `getInstrument(spec)`，与音色表一致 | 待改 |
| `desktop/README.md:59-74` | 「当前状态（v2.8.0）」表：阻塞项「需补 N-API 合成器接口」 | N-API 合成器已补齐并过 CI 冒烟；另有 audio-driver / ring-buffer / worklet 未列入 | 待改 |
| `desktop/README.md:25`、`desktop/src/audio-bridge.ts:23` | 「见 `docs/ARCHITECTURE.md` §4.3」 | 架构书重构后该章节已变为 §五，锚点失效 | 待改 |
| `docs/architecture.md`（原 `ARCHITECTURE.md`） | 全文 | 已有 6 处与现状冲突（见下） | **已整体重写** |

原 `ARCHITECTURE.md`（13.8KB）中与现状冲突的部分：

| 原章节 | 原文 | 现状 |
|---|---|---|
| §4.1 | 「它**从未被构建过**」 | `ci-audio.yml` 已在 CI 构建 + ctest |
| §4.1 | 「22,576 行 + **11** 个测试文件」 | `packages/audio/tests/` 是 **10** 个 .cpp |
| §七（第一个） | P0「`packages/audio` 编译到绿」「补 N-API 合成器接口」 | 均已完成 |
| §六 | 「201 条测试」 | 已远超（core 51 + agent 19 + ui 74 个测试文件） |
| §4.2.1 | 把「没有 noteOn/noteOff」当作现状 | 已补齐 23 个方法 |
| §二 | 包结构缺 `desktop`；`audio-engine` 标注「0 测试」正确但未说明「零引用」 | 已补 |

---

## 六、命名一致性

**已统一的部分**：`docs/v2.4.0-audit.md`、`v2.5.0-polish.md`、`v2.6.0-fixes.md`、
`v2.8.0-acceptance.md`、`v2.8.0-audio-engine-spec.md`、`v2.8.0-full-song.md`、
`v2.8.0-song-feasibility.md`、`v2.8.0-song-session.md` —— 8 个文件符合
`vX.Y.Z-<主题>.md`。

**不一致的 7 个**：

| 文件 | 问题 | 建议 |
|---|---|---|
| `docs/architecture.md` | 长期资产，无版本号（合理） | 保留；已顺带把 `ARCHITECTURE.md` 改为全小写以匹配其它文件名 |
| `docs/context.md` | 同上，但全大写 | 建议改 `context.md`（纯改名，未执行） |
| `docs/archive/v1.1.0-iteration-plan.md` | 内容是 **v1.1.0**（2026-06-12）的计划，文件名无版本 | 建议 `v1.1.0-iteration-plan.md` 移入 `docs/archive/` |
| `docs/deep-research-report.md` | 56KB 研究报告，无版本无日期（正文有） | 同上 |
| `docs/ui/STAGE3_COMPLETE.md` | 内容是 **v1.2.0 Stage 3**，文件名不含版本，且与根目录 `v2.*` 体系不同 | 建议 `v1.2.0-stage3-settings.md` |
| `docs/audio/soundfont-integration-plan.md`、`soundfont-research.md` | 内容标注 **v1.7.0 Stage 4**，文件名是主题式 | 建议加版本前缀 |
| `docs/bayesian-history/v1.2.0-stage-0.md`、`v1.2.0-stage-5.md` | 用 `stage-N` 而非主题 | 可接受（快照性质），或补主题 |

**附带发现（已修）**：`.gitignore:33` 是 `docs/*` + 白名单，白名单只放行了
`ARCHITECTURE.md` / `context.md` / `v2.*.md`，其余 7 个文档全部游离在版本库之外
（`git check-ignore` 确认）。已把白名单改为放行 `architecture.md` 与
`architecture-review.md`。归档文档是否入库由你决定（它们是过程材料，不入库也合理）。

---

## 七、未做的事（需你确认）

1. **没有改任何 `docs/v2.*` 历史文件** —— 它们是存档，按要求只登记。
2. **没有改上面 4 处代码注释** —— 属代码改动，应与对应功能提交一起改，避免混入文档 PR：
   `useTransport.ts:8-9`、`wav-export.ts:152`、`desktop/README.md:25,59-74`、
   `audio-bridge.ts:23`。其中第 1 条最该先改，它是错误结论的源头。
3. **没有移动/重命名归档文档**（`archive/v1.1.0-iteration-plan.md`、`deep-research-report.md`、
   `docs/ui/`、`docs/audio/`、`docs/bayesian-history/`）。
4. **`audio-engine` 契约与 `audio-preview` 实现的分叉**未处置 —— 只在新架构书
   §一 与 §六 标注为「已知债务」。合并两者是一轮独立工作。
